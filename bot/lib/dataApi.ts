import http from 'http';
import fs from 'fs';
import path from 'path';
import { triggerClipNow, forceKlippHighlight, getWorkerStatus } from './clipWorker';
import { logBotEvent, updateStreamSyklus } from './botEvents';
import { logSystemEvent } from './systemEvents';

// Registered by bot/index.ts after Twitch bot starts — avoids circular deps
let _sendTwitchChat: ((msg: string) => void) | null = null;
export function registerTwitchChat(fn: (msg: string) => void): void {
  _sendTwitchChat = fn;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'glenvex-default';

function readFile(navn: string): any {
  const file = path.join(DATA_DIR, `${navn}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

function oppdaterJobbStatus(vodId: string, status: string, melding: string, ekstra?: any) {
  const dir = path.join(DATA_DIR, 'content-factory');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fil = path.join(dir, `status_${vodId}.json`);
  const ts = new Date().toISOString();
  fs.writeFileSync(fil, JSON.stringify({ jobId: vodId, status, melding, ...ekstra, oppdatert: ts, sisteOppdatering: ts }));
  console.log(`[CF] ${vodId} → ${status}: ${melding}`);

  // Skriv til Supabase – all fremdrift vises i UI
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (sbUrl && sbKey) {
    const update: any = { status_message: melding, updated_at: new Date().toISOString() };
    if (status === 'FAILED') {
      update.status = 'FAILED';
      update.error_message = melding;
      update.progress_percent = 0;
      update.current_step = 'DOWNLOAD';
    } else if (status === 'DOWNLOADING') {
      update.status = 'ANALYZING';
      update.current_step = 'DOWNLOAD';
      update.progress_percent = ekstra?.progress ?? 15;
    } else if (status === 'TRANSCRIBING') {
      update.status = 'ANALYZING';
      update.current_step = 'TRANSCRIBING';
      update.progress_percent = ekstra?.progress ?? 40;
    } else if (status === 'PENDING_RETRY') {
      update.status = 'PENDING';
      update.error_message = melding;
      update.progress_percent = 0;
      update.current_step = 'DOWNLOAD';
    }
    // Bruk Supabase JS-klient for pålitelig oppdatering (håndterer auth riktig)
    try {
      const { createClient } = require('@supabase/supabase-js');
      const ws = require('ws');
      const sb = createClient(sbUrl, sbKey, { realtime: { transport: ws }, auth: { persistSession: false, autoRefreshToken: false } });
      sb.from('content_vods').update(update).eq('id', vodId).then(({ error }: any) => {
        if (error) console.warn(`[CF] Supabase status-oppdatering feilet for ${vodId}: ${error.message}`);
      }, (err: any) => {
        console.warn(`[CF] Supabase status-oppdatering nettverksfeil:`, err?.message);
      });
    } catch (e: any) {
      console.warn(`[CF] Supabase klient feil:`, e?.message);
    }
  }
}

async function prosesserVodAsynkront(vodId: string, twitchVodUrl: string, userOauth?: string) {
  try {
    logSystemEvent({ source: 'content_factory', event_type: 'DOWNLOAD_STARTED', title: 'Railway: Nedlasting startet', description: `yt-dlp starter for VOD ${vodId}`, severity: 'info', metadata: { vodId, twitchVodUrl } });
    oppdaterJobbStatus(vodId, 'DOWNLOADING', 'Sjekker yt-dlp...');

    const { execSync } = require('child_process');
    const execAsync = require('util').promisify(require('child_process').exec);

    let ytDlpOk = false;
    try { execSync('yt-dlp --version', { stdio: 'ignore' }); ytDlpOk = true; } catch {}
    if (!ytDlpOk) {
      // Prøv å installere yt-dlp via pip
      try {
        execSync('pip install -U yt-dlp', { stdio: 'ignore', timeout: 60_000 });
        execSync('yt-dlp --version', { stdio: 'ignore' });
        ytDlpOk = true;
        console.log('[CF] yt-dlp installert via pip');
      } catch {}
    }
    if (!ytDlpOk) { oppdaterJobbStatus(vodId, 'FAILED', 'yt-dlp ikke tilgjengelig på Railway. Legg til yt-dlp i Railway-tjenestens avhengigheter (pip install yt-dlp)'); return; }

    // Prøv å oppdatere yt-dlp (Twitch endrer API hyppig – gammel versjon feiler)
    try { execSync('yt-dlp -U 2>/dev/null || pip install -U yt-dlp 2>/dev/null', { stdio: 'ignore', timeout: 30_000, shell: true }); } catch {}

    const audioDir = path.join(DATA_DIR, 'content-factory', 'audio');
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

    const audioPath = path.join(audioDir, `${vodId}.mp3`);
    const cookieArg = userOauth ? `--add-header "Authorization:OAuth ${userOauth}"` : '';

    let nedlastingOk = false;

    let sisteYtDlpFeil = '';

    // ── Strategi 1: audio_only / bestaudio (raskest, minst data) ────────────
    oppdaterJobbStatus(vodId, 'DOWNLOADING', 'yt-dlp: laster ned lydspor (strategi 1/3)...');
    const hb1 = setInterval(() => oppdaterJobbStatus(vodId, 'DOWNLOADING', 'yt-dlp strategi 1 pågår...'), 30_000);
    try {
      await execAsync(
        `yt-dlp -f "audio_only/bestaudio" --retries 2 --fragment-retries 2 --no-playlist -x --audio-format mp3 --audio-quality 4 ${cookieArg} -o "${audioPath}" "${twitchVodUrl}"`,
        { maxBuffer: 1024 * 1024 * 200, timeout: 25 * 60 * 1000 }
      );
      if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 50_000) nedlastingOk = true;
    } catch (e: any) {
      sisteYtDlpFeil = (e.stderr ?? e.message ?? '').slice(0, 300);
      console.error(`[CF] Strategi 1 feilet: ${sisteYtDlpFeil}`);
      try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch {}
    } finally { clearInterval(hb1); }

    // ── Strategi 2: bestaudio fra video-track (mer robust) ──────────────────
    if (!nedlastingOk) {
      oppdaterJobbStatus(vodId, 'DOWNLOADING', 'yt-dlp: strategi 2 (bestaudio/best)...');
      const hb2 = setInterval(() => oppdaterJobbStatus(vodId, 'DOWNLOADING', 'yt-dlp strategi 2 pågår...'), 30_000);
      try {
        await execAsync(
          `yt-dlp -f "bestaudio[ext=mp4]/bestaudio/best" --retries 2 --fragment-retries 2 --no-playlist -x --audio-format mp3 --audio-quality 4 ${cookieArg} -o "${audioPath}" "${twitchVodUrl}"`,
          { maxBuffer: 1024 * 1024 * 200, timeout: 30 * 60 * 1000 }
        );
        if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 50_000) nedlastingOk = true;
      } catch (e: any) {
        sisteYtDlpFeil = (e.stderr ?? e.message ?? '').slice(0, 300);
        console.error(`[CF] Strategi 2 feilet: ${sisteYtDlpFeil}`);
        try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch {}
      } finally { clearInterval(hb2); }
    }

    // ── Strategi 3: laveste video-format + trekk ut lyd ────────────────────
    if (!nedlastingOk) {
      oppdaterJobbStatus(vodId, 'DOWNLOADING', 'yt-dlp: strategi 3 (lavest video-format)...');
      const hb3 = setInterval(() => oppdaterJobbStatus(vodId, 'DOWNLOADING', 'yt-dlp strategi 3 pågår...'), 30_000);
      try {
        await execAsync(
          `yt-dlp -f "worst[ext=mp4]/worst/best" --retries 2 --fragment-retries 2 --no-playlist -x --audio-format mp3 --audio-quality 4 ${cookieArg} -o "${audioPath}" "${twitchVodUrl}"`,
          { maxBuffer: 1024 * 1024 * 500, timeout: 45 * 60 * 1000 }
        );
        if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 50_000) nedlastingOk = true;
      } catch (e: any) {
        sisteYtDlpFeil = (e.stderr ?? e.message ?? '').slice(0, 300);
        console.error(`[CF] Strategi 3 feilet: ${sisteYtDlpFeil}`);
        try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch {}
      } finally { clearInterval(hb3); }
    }

    if (!nedlastingOk) {
      // Lag en forklarende feilmelding med faktisk yt-dlp-output
      const isAuth = /403|subscription|subscriber|private|login|oauth/i.test(sisteYtDlpFeil);
      const isGone = /404|not found|deleted|removed/i.test(sisteYtDlpFeil);
      const hint = isAuth
        ? 'VOD krever Twitch-autentisering. Sett TWITCH_USER_OAUTH i Railway env.'
        : isGone
          ? 'VOD er slettet eller ikke tilgjengelig lenger.'
          : 'Sjekk Railway-logger for detaljer. Mulig årsak: yt-dlp er utdatert.';
      const melding = sisteYtDlpFeil
        ? `Nedlasting feilet: ${sisteYtDlpFeil.slice(0, 200)} — ${hint}`
        : `Alle 3 nedlastingsstrategier feilet. ${hint}`;
      oppdaterJobbStatus(vodId, 'FAILED', melding);
      logSystemEvent({ source: 'content_factory', event_type: 'DOWNLOAD_FAILED', title: 'Nedlasting feilet – alle strategier utprøvd', severity: 'error', metadata: { vodId, ytDlpFeil: sisteYtDlpFeil.slice(0, 200) } });
      return;
    }

    // Normaliser audio til 16kHz mono (optimal for transkribering) hvis ffmpeg er tilgjengelig
    try {
      const normalAudioPath = audioPath.replace('.mp3', '_norm.mp3');
      await execAsync(`ffmpeg -y -i "${audioPath}" -vn -ar 16000 -ac 1 -c:a libmp3lame -q:a 4 "${normalAudioPath}"`, { timeout: 10 * 60 * 1000 });
      if (fs.existsSync(normalAudioPath)) {
        try { fs.unlinkSync(audioPath); } catch {}
        fs.renameSync(normalAudioPath, audioPath);
      }
    } catch { /* ffmpeg normalisering feilet – bruk rå audio */ }

    logSystemEvent({ source: 'content_factory', event_type: 'DOWNLOAD_DONE', title: 'Railway: Nedlasting fullført', description: `Audio hentet for VOD ${vodId} – starter Deepgram`, severity: 'info', metadata: { vodId } });

    // Transkriber med Deepgram Nova-2 (4-5× billigere enn Whisper, støtter norsk)
    const deepgramKey = process.env.DEEPGRAM_API_KEY;
    if (!deepgramKey) { oppdaterJobbStatus(vodId, 'FAILED', 'DEEPGRAM_API_KEY mangler'); return; }

    const { createClient } = require('@supabase/supabase-js');
    const ws = require('ws');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { realtime: { transport: ws } });

    // Slett gamle transkripsjoner
    await sb.from('content_transcripts').delete().eq('vod_id', vodId);

    // Deepgram håndterer opptil 250MB – del bare ved svært store filer (>180MB)
    const MAX_BYTES = 180 * 1024 * 1024;
    const audioSize = fs.statSync(audioPath).size;
    const segmentPaths: { filePath: string; offset: number }[] = [];

    if (audioSize > MAX_BYTES) {
      oppdaterJobbStatus(vodId, 'TRANSCRIBING', `Stor fil (${Math.round(audioSize/1024/1024)}MB) – deler i 60-min segmenter...`);
      const { stdout: durStr } = await execAsync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`);
      const totalSek = parseFloat(durStr.trim());
      const segSek = 3600; // 60 min per segment
      let start = 0; let idx = 0;
      while (start < totalSek) {
        const segPath = audioPath.replace('.mp3', `_s${idx}.mp3`);
        await execAsync(`ffmpeg -y -ss ${start} -i "${audioPath}" -t ${segSek} -c copy "${segPath}"`);
        segmentPaths.push({ filePath: segPath, offset: start });
        start += segSek; idx++;
      }
    } else {
      segmentPaths.push({ filePath: audioPath, offset: 0 });
    }

    const transcriptionStartMs = Date.now();
    logSystemEvent({ source: 'content_factory', event_type: 'TRANSCRIPTION_STARTED', title: `Deepgram starter transkripsjon`, severity: 'info', metadata: { vodId, segmenter: segmentPaths.length, deepgram_model: 'nova-2', workspace_id: WORKSPACE_ID } });

    let totalSegmenter = 0;
    let detectedLanguage = 'ukjent';
    for (let i = 0; i < segmentPaths.length; i++) {
      const { filePath: segPath, offset } = segmentPaths[i];
      const segSize = Math.round(fs.statSync(segPath).size / 1024 / 1024);
      oppdaterJobbStatus(vodId, 'TRANSCRIBING', `Deepgram transkriberer segment ${i+1}/${segmentPaths.length} (${segSize}MB)...`);

      const segBuf = fs.readFileSync(segPath);

      const dgRes = await fetch(
        'https://api.deepgram.com/v1/listen?model=nova-2&language=no&detect_language=true&punctuate=true&utterances=true&utt_split=2',
        {
          method: 'POST',
          headers: {
            'Authorization': `Token ${deepgramKey}`,
            'Content-Type': 'audio/mpeg',
          },
          body: segBuf,
        }
      );

      if (!dgRes.ok) {
        const errTxt = await dgRes.text();
        oppdaterJobbStatus(vodId, 'FAILED', `Deepgram feil: ${errTxt.slice(0, 200)}`);
        return;
      }

      const dgData = await dgRes.json() as any;

      // Hent detektert språk fra Deepgram-svar
      const segLang: string = dgData.results?.channels?.[0]?.detected_language
        ?? dgData.metadata?.detected_language
        ?? 'ukjent';
      if (segLang !== 'ukjent') detectedLanguage = segLang;

      // Deepgram returnerer utterances (setningsgrupper) eller words – bruk utterances
      const utterances: any[] = dgData.results?.utterances ?? [];
      const paragraphs: any[] = dgData.results?.channels?.[0]?.alternatives?.[0]?.paragraphs?.paragraphs ?? [];
      const segs = utterances.length > 0 ? utterances : paragraphs;

      for (const seg of segs) {
        const text: string = seg.transcript ?? seg.text ?? '';
        if (!text.trim()) continue;
        await sb.from('content_transcripts').insert({
          vod_id: vodId,
          start_time: (seg.start ?? 0) + offset,
          end_time: (seg.end ?? 0) + offset,
          text: text.trim(),
        });
        totalSegmenter++;
      }

      if (segPath !== audioPath) try { fs.unlinkSync(segPath); } catch {}
    }

    try { fs.unlinkSync(audioPath); } catch {}

    const transcriptionDurationMs = Date.now() - transcriptionStartMs;

    if (totalSegmenter === 0) {
      const possibleReason = detectedLanguage === 'ukjent' ? 'language_detection_failed' : 'silent_audio';
      const feilmelding = 'Deepgram returnerte ingen transkripsjonssegmenter. Mulige årsaker: lydsporet er stille/tomt, Deepgram-nøkkelen er utløpt, eller språkdeteksjon feilet.';
      oppdaterJobbStatus(vodId, 'FAILED', feilmelding);
      logSystemEvent({
        source: 'content_factory',
        event_type: 'TRANSCRIPTION_FAILED_ZERO_SEGMENTS',
        title: 'Deepgram completed but returned zero segments.',
        severity: 'error',
        metadata: {
          vod_id: vodId,
          workspace_id: WORKSPACE_ID,
          detected_language: detectedLanguage,
          transcription_duration: transcriptionDurationMs,
          deepgram_model: 'nova-2',
          total_segments: 0,
          possible_reason: possibleReason,
        },
      });
      return;
    }

    logSystemEvent({
      source: 'content_factory',
      event_type: 'TRANSCRIPTION_COMPLETED',
      title: `Transkripsjon fullført: ${totalSegmenter} segmenter`,
      description: `VOD ${vodId} transkribering ferdig – Phase 2 starter automatisk`,
      severity: 'info',
      metadata: {
        vod_id: vodId,
        workspace_id: WORKSPACE_ID,
        total_segments: totalSegmenter,
        language: detectedLanguage,
        duration: transcriptionDurationMs,
        deepgram_model: 'nova-2',
      },
    });

    oppdaterJobbStatus(vodId, 'COMPLETE', `Ferdig! ${totalSegmenter} transkripsjonssegmenter lagret (Deepgram Nova-2).`, {
      transcribed: true,
      segmenter: totalSegmenter,
    });

    // Oppdater Supabase → TRANSCRIBED
    await sb.from('content_vods').update({
      status: 'TRANSCRIBED',
      current_step: 'DISCOVER',
      progress_percent: 30,
      status_message: `Deepgram ferdig (${totalSegmenter} segmenter) – Phase 2 starter...`,
    }).eq('id', vodId);

    console.log(`[ContentFactory] ✓ Transkribering ferdig: ${vodId} – ${totalSegmenter} segmenter. Trigger Phase 2...`);

    // Trigger Phase 2 direkte fra Railway — ikke avhengig av at admin-siden er åpen i browser
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
    if (appUrl) {
      const baseUrl = appUrl.startsWith('http') ? appUrl : `https://${appUrl}`;
      try {
        const p2Res = await fetch(`${baseUrl}/api/content-factory/phase2`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vodId }),
          signal: AbortSignal.timeout(300_000), // 5 min — OpenAI kan ta tid
        });
        const p2Data = await p2Res.json().catch(() => ({}));
        if (p2Res.ok) {
          console.log(`[ContentFactory] ✓ Phase 2 fullført for ${vodId}:`, p2Data);
        } else {
          console.error(`[ContentFactory] ✗ Phase 2 feilet for ${vodId}:`, p2Data);
        }
      } catch (p2Err: any) {
        console.error(`[ContentFactory] ✗ Phase 2 kall feilet for ${vodId}:`, p2Err.message);
      }
    } else {
      console.warn('[ContentFactory] NEXT_PUBLIC_APP_URL ikke satt — Phase 2 må trigges manuelt fra admin-siden');
    }
  } catch (err: any) {
    console.error(`[ContentFactory] ✗ Jobb feilet: ${err.message}`);
    oppdaterJobbStatus(vodId, 'FAILED', err.message);
  }
}

export function startDataApi(port = 4242) {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // ── DALL-E 3 bildegenerering ─────────────────────────────────────────────
    if (url === '/generate-image' && method === 'POST') {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk; });
      req.on('end', async () => {
        try {
          const { prompt } = JSON.parse(body);
          const apiKey = process.env.OPENAI_API_KEY;
          if (!apiKey) { res.writeHead(400); res.end(JSON.stringify({ error: 'OPENAI_API_KEY mangler' })); return; }
          const { default: OpenAI } = await import('openai');
          const client = new OpenAI({ apiKey });
          const response = await client.images.generate({
            model: 'dall-e-3',
            prompt: `GTA RP character portrait, cinematic dark style. ${prompt}. Norwegian RP server. Dark neon green and black, dramatic lighting, no text.`,
            n: 1, size: '1024x1024', quality: 'standard',
          });
          res.writeHead(200);
          res.end(JSON.stringify({ bildeUrl: response.data?.[0]?.url ?? null }));
        } catch (err: any) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }
      });
      return;
    }

    // ── Stream-syklus: Discord-varsling når streamplan er lagret ────────────
    if (url === '/stream-syklus/discord-varsling' && method === 'POST') {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk; });
      req.on('end', async () => {
        res.writeHead(202);
        res.end(JSON.stringify({ ok: true }));
        try {
          const { plan } = JSON.parse(body);
          const sbUrl = process.env.SUPABASE_URL;
          const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
          const discordWebhook = process.env.DISCORD_LIVE_WEBHOOK_URL;
          const aktive = (plan ?? []).filter((d: any) => d.aktiv);
          if (aktive.length === 0) return;

          const planTekst = aktive.map((d: any) => `• **${d.dag}** kl. ${d.tid} – ${d.spill}${d.tittel ? ` (${d.tittel})` : ''}`).join('\n');

          if (discordWebhook) {
            await fetch(discordWebhook, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                embeds: [{
                  title: '📅 Streamplan oppdatert',
                  description: planTekst,
                  color: 0x00ff41,
                  footer: { text: 'Creator OS' },
                }],
              }),
            }).catch(() => {});
          } else if (sbUrl && sbKey) {
            const channelId = process.env.DISCORD_LIVE_CHANNEL_ID;
            if (channelId) {
              const { createClient } = require('@supabase/supabase-js');
              const ws = require('ws');
              const sb = createClient(sbUrl, sbKey, { realtime: { transport: ws } });
              await sb.rpc('noop').catch(() => {});
            }
          }

          await updateStreamSyklus({ discord_varslet_at: new Date().toISOString() });
          logBotEvent('discord_varsel', { melding: `Streamplan varslet: ${aktive.length} stream${aktive.length > 1 ? 'er' : ''}` });
          console.log(`[DataApi] Discord-varsling om streamplan sendt (${aktive.length} aktive dager)`);
        } catch (err: any) {
          console.error('[DataApi] Discord-varsling feil:', err.message);
        }
      });
      return;
    }

    // ── Content Factory: Start asynkron jobb ─────────────────────────────────
    if (url === '/content-factory/process' && method === 'POST') {
      if (process.env.CONTENT_FACTORY_ENABLED !== 'true') {
        res.writeHead(403); res.end(JSON.stringify({ error: 'FEATURE_DISABLED' })); return;
      }
      let body = '';
      req.on('data', (chunk: any) => { body += chunk; });
      req.on('end', () => {
        try {
          const { vodId, twitchVodUrl, userOauth } = JSON.parse(body);
          // Returner UMIDDELBART – jobb kjøres i bakgrunnen
          res.writeHead(202);
          res.end(JSON.stringify({ ok: true, jobId: vodId, status: 'PROCESSING' }));
          // Start bakgrunnsjobb (ikke await)
          prosesserVodAsynkront(vodId, twitchVodUrl, userOauth).catch(console.error);
        } catch (err: any) { res.writeHead(400); res.end(JSON.stringify({ error: err.message })); }
      });
      return;
    }

    // ── Content Factory: Statussjekk ─────────────────────────────────────────
    if (url.startsWith('/content-factory/status/') && method === 'GET') {
      const vodId = url.replace('/content-factory/status/', '');
      const statusFil = path.join(DATA_DIR, 'content-factory', `status_${vodId}.json`);
      if (fs.existsSync(statusFil)) {
        res.writeHead(200); res.end(fs.readFileSync(statusFil, 'utf-8'));
        return;
      }
      // Lokal fil mangler (Railway restartet) — sjekk Supabase som fallback
      const sbUrl = process.env.SUPABASE_URL;
      const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      void (async () => {
        if (sbUrl && sbKey) {
          try {
            const sbRes = await fetch(`${sbUrl}/rest/v1/content_vods?id=eq.${encodeURIComponent(vodId)}&select=id,status,status_message,error_message,updated_at`, {
              headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
              signal: AbortSignal.timeout(3_000),
            });
            if (sbRes.ok) {
              const rows = (await sbRes.json()) as any[];
              if (rows?.[0]) {
                const row = rows[0];
                const inProgress = row.status === 'ANALYZING' || row.status === 'PENDING';
                // Hvis Supabase sier den kjører og ble oppdatert de siste 60 min — ikke UNKNOWN
                const updatedAt = new Date(row.updated_at ?? 0).getTime();
                const gammelNok = Date.now() - updatedAt > 60 * 60 * 1000;
                const status = inProgress && gammelNok ? 'UNKNOWN' : (row.status ?? 'UNKNOWN');
                res.writeHead(200);
                res.end(JSON.stringify({ jobId: vodId, status, melding: row.status_message ?? row.error_message, fraSupabase: true }));
                return;
              }
            }
          } catch {}
        }
        res.writeHead(200); res.end(JSON.stringify({ jobId: vodId, status: 'UNKNOWN' }));
      })();
      return;
    }

    // ── Clip Worker: manuell klipp-trigger ───────────────────────────────────
    if (url === '/content-factory/clip' && method === 'POST') {
      if (process.env.CONTENT_FACTORY_ENABLED !== 'true') {
        res.writeHead(403); res.end(JSON.stringify({ error: 'FEATURE_DISABLED' })); return;
      }
      // Svar umiddelbart, trigger clip worker i bakgrunnen
      res.writeHead(202);
      res.end(JSON.stringify({ ok: true, melding: 'Clip worker trigget' }));
      triggerClipNow().catch(console.error);
      return;
    }

    // ── Worker-status: clip worker ───────────────────────────────────────────
    if (url === '/content-factory/worker-status' && method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify(getWorkerStatus()));
      return;
    }

    // ── Force-klipp: klipper ett spesifikt highlight direkte (bypass kø) ────
    if (url.startsWith('/content-factory/clip-force/') && method === 'POST') {
      const highlightId = url.replace('/content-factory/clip-force/', '');
      if (process.env.CONTENT_FACTORY_ENABLED !== 'true') {
        res.writeHead(403); res.end(JSON.stringify({ error: 'FEATURE_DISABLED' })); return;
      }
      // Svar umiddelbart, kjør klipping i bakgrunnen
      res.writeHead(202);
      res.end(JSON.stringify({ ok: true, melding: `Force-klipp startet for ${highlightId}` }));
      forceKlippHighlight(highlightId).catch(console.error);
      return;
    }

    // ── Clip Worker: retry et highlight ──────────────────────────────────────
    if (url.startsWith('/content-factory/clip-retry/') && method === 'POST') {
      const highlightId = url.replace('/content-factory/clip-retry/', '');
      if (process.env.CONTENT_FACTORY_ENABLED !== 'true') {
        res.writeHead(403); res.end(JSON.stringify({ error: 'FEATURE_DISABLED' })); return;
      }
      (async () => {
        const { createClient } = require('@supabase/supabase-js');
        const ws = require('ws');
        const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { realtime: { transport: ws } });
        await sb.from('content_highlights').update({
          clip_status: 'READY_FOR_CLIP',
          clip_error: null,
          clip_url: null,
          vertical_clip_url: null,
        }).eq('id', highlightId);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, melding: `Highlight ${highlightId} resatt til READY_FOR_CLIP` }));
      })().catch((err: any) => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      });
      return;
    }

    // ── Twitch chat: send melding fra dashboard ──────────────────────────────
    // Called by Next.js /api/partners/promote (channel=twitch) and similar.
    if (url === '/twitch-chat' && method === 'POST') {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk; });
      req.on('end', () => {
        try {
          const { message, source } = JSON.parse(body) as { message: string; source?: string };
          if (!message?.trim()) {
            res.writeHead(400); res.end(JSON.stringify({ error: 'message required' })); return;
          }
          if (!_sendTwitchChat) {
            logSystemEvent({ source: 'data_api', event_type: 'TWITCH_CHAT_NOT_READY',
              title: 'Twitch bot ikke klar — kan ikke sende chatmelding', severity: 'warning',
              metadata: { requestedMessage: message.slice(0, 100), source } });
            res.writeHead(503); res.end(JSON.stringify({ error: 'bot_offline', reason: 'Twitch bot ikke koblet til ennå' })); return;
          }
          _sendTwitchChat(message.trim());
          logSystemEvent({ source: source ?? 'dashboard', event_type: 'TWITCH_CHAT_MESSAGE_SENT',
            title: `Twitch chat sendt: ${message.trim().slice(0, 80)}`,
            severity: 'info', metadata: { message: message.trim(), source } });
          res.writeHead(200); res.end(JSON.stringify({ ok: true }));
        } catch (err: any) {
          res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ── Datafiler ────────────────────────────────────────────────────────────
    const endpointMap: Record<string, string> = {
      '/members': 'members', '/events': 'events', '/stream-history': 'stream-history',
      '/rp-notes': 'rp-notes', '/moderation': 'moderation', '/schedule': 'schedule', '/goals': 'goals',
    };

    const filNavn = endpointMap[url];
    if (filNavn) {
      const data = readFile(filNavn);
      res.writeHead(data !== null ? 200 : 404);
      res.end(JSON.stringify(data ?? { error: 'Ingen data' }));
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'Stream Control Bot Data API', endpoints: [...Object.keys(endpointMap), '/generate-image', '/content-factory/process', '/content-factory/status/:vodId'] }));
    }
  });

  server.listen(port, () => {
    console.log(`  ✓ Data API kjører på port ${port}`);
  });
}
