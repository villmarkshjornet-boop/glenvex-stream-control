import http from 'http';
import fs from 'fs';
import path from 'path';
import { triggerClipNow } from './clipWorker';
import { logBotEvent, updateStreamSyklus } from './botEvents';

const DATA_DIR = path.join(process.cwd(), 'data');

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
    const update: any = { status_message: melding };
    if (status === 'FAILED') {
      update.status = 'FAILED';
      update.error_message = melding;
      update.progress_percent = 0;
      update.current_step = 'DOWNLOAD';
    } else if (status === 'DOWNLOADING') {
      update.status = 'ANALYZING';
      update.current_step = 'DOWNLOAD';
      update.progress_percent = ekstra?.progress ?? 15;
      update.updated_at = new Date().toISOString();
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
    fetch(`${sbUrl}/rest/v1/content_vods?id=eq.${vodId}`, {
      method: 'PATCH',
      headers: {
        'apikey': sbKey,
        'Authorization': `Bearer ${sbKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(update),
    }).catch(() => {});
  }
}

async function prosesserVodAsynkront(vodId: string, twitchVodUrl: string, userOauth?: string) {
  try {
    oppdaterJobbStatus(vodId, 'DOWNLOADING', 'Sjekker yt-dlp...');

    const { execSync } = require('child_process');
    const execAsync = require('util').promisify(require('child_process').exec);

    let ytDlpOk = false;
    try { execSync('yt-dlp --version', { stdio: 'ignore' }); ytDlpOk = true; } catch {}
    if (!ytDlpOk) { oppdaterJobbStatus(vodId, 'FAILED', 'yt-dlp ikke tilgjengelig på Railway'); return; }

    const audioDir = path.join(DATA_DIR, 'content-factory', 'audio');
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

    const audioPath = path.join(audioDir, `${vodId}.mp3`);
    const cookieArg = userOauth ? `--add-header "Authorization:OAuth ${userOauth}"` : '';

    let nedlastingOk = false;

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
      console.error(`[CF] Strategi 1 feilet: ${(e.message ?? '').slice(0, 200)}`);
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
        console.error(`[CF] Strategi 2 feilet: ${(e.message ?? '').slice(0, 200)}`);
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
        console.error(`[CF] Strategi 3 feilet: ${(e.message ?? '').slice(0, 200)}`);
        try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch {}
      } finally { clearInterval(hb3); }
    }

    if (!nedlastingOk) {
      oppdaterJobbStatus(vodId, 'PENDING_RETRY', 'Alle 3 nedlastingsstrategier feilet – klikk Retry for å prøve igjen');
      return;
    }

    // Normaliser audio til 16kHz mono (Whisper-optimal) hvis ffmpeg er tilgjengelig
    try {
      const normalAudioPath = audioPath.replace('.mp3', '_norm.mp3');
      await execAsync(`ffmpeg -y -i "${audioPath}" -vn -ar 16000 -ac 1 -c:a libmp3lame -q:a 4 "${normalAudioPath}"`, { timeout: 10 * 60 * 1000 });
      if (fs.existsSync(normalAudioPath)) {
        try { fs.unlinkSync(audioPath); } catch {}
        fs.renameSync(normalAudioPath, audioPath);
      }
    } catch { /* ffmpeg normalisering feilet – bruk rå audio */ }

    // Transkriber direkte med Whisper – ingen Supabase Storage (unngår filstørrelsesbegrensning)
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) { oppdaterJobbStatus(vodId, 'FAILED', 'OPENAI_API_KEY mangler'); return; }

    const { createClient } = require('@supabase/supabase-js');
    const ws = require('ws');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { realtime: { transport: ws } });

    // Slett gamle transkripsjoner
    await sb.from('content_transcripts').delete().eq('vod_id', vodId);

    const MAX_BYTES = 24 * 1024 * 1024; // 24MB Whisper-grense
    const audioSize = fs.statSync(audioPath).size;
    const segmentPaths: { filePath: string; offset: number }[] = [];

    if (audioSize > MAX_BYTES) {
      oppdaterJobbStatus(vodId, 'TRANSCRIBING', `Stor fil (${Math.round(audioSize/1024/1024)}MB) – deler i 20-min segmenter...`);
      const { stdout: durStr } = await execAsync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`);
      const totalSek = parseFloat(durStr.trim());
      const segSek = 1200;
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

    let totalSegmenter = 0;
    for (let i = 0; i < segmentPaths.length; i++) {
      const { filePath: segPath, offset } = segmentPaths[i];
      oppdaterJobbStatus(vodId, 'TRANSCRIBING', `Whisper transkriberer segment ${i+1}/${segmentPaths.length}...`);

      const segBuf = fs.readFileSync(segPath);
      const boundary = `----formdata-${Date.now()}`;
      const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`;
      const middle = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n--${boundary}--\r\n`;
      const bodyBuf = Buffer.concat([Buffer.from(header), segBuf, Buffer.from(middle)]);

      const wRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: bodyBuf,
      });

      if (!wRes.ok) {
        const errTxt = await wRes.text();
        oppdaterJobbStatus(vodId, 'FAILED', `Whisper feil: ${errTxt.slice(0, 200)}`);
        return;
      }

      const wData = await wRes.json() as any;
      const segs = wData.segments ?? [];

      for (const seg of segs) {
        await sb.from('content_transcripts').insert({
          vod_id: vodId,
          start_time: seg.start + offset,
          end_time: seg.end + offset,
          text: seg.text,
        });
        totalSegmenter++;
      }

      if (segPath !== audioPath) try { fs.unlinkSync(segPath); } catch {}
    }

    try { fs.unlinkSync(audioPath); } catch {}

    oppdaterJobbStatus(vodId, 'COMPLETE', `Ferdig! ${totalSegmenter} transkripsjonssegmenter lagret.`, {
      transcribed: true,
      segmenter: totalSegmenter,
    });

    // Oppdater Supabase → TRANSCRIBED slik at Vercel auto-trigger Phase 2
    await sb.from('content_vods').update({
      status: 'TRANSCRIBED',
      current_step: 'DISCOVER',
      progress_percent: 30,
      status_message: `Transkribering ferdig (${totalSegmenter} segmenter) – Phase 2 starter automatisk`,
    }).eq('id', vodId);

    console.log(`[ContentFactory] ✓ Jobb ferdig: ${vodId} – ${totalSegmenter} segmenter, status satt til TRANSCRIBED`);
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
            prompt: `GTA RP character portrait, cinematic dark style. ${prompt}. Norwegian RP server GLENVEX. Dark neon green and black, dramatic lighting, no text.`,
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
                  footer: { text: 'GLENVEX Creator OS' },
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
      } else {
        res.writeHead(200); res.end(JSON.stringify({ jobId: vodId, status: 'UNKNOWN' }));
      }
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
      res.end(JSON.stringify({ status: 'GLENVEX Bot Data API', endpoints: [...Object.keys(endpointMap), '/generate-image', '/content-factory/process', '/content-factory/status/:vodId'] }));
    }
  });

  server.listen(port, () => {
    console.log(`  ✓ Data API kjører på port ${port}`);
  });
}
