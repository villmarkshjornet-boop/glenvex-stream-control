import http from 'http';
import fs from 'fs';
import path from 'path';

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
  fs.writeFileSync(fil, JSON.stringify({ jobId: vodId, status, melding, ...ekstra, oppdatert: new Date().toISOString() }));
}

async function prosesserVodAsynkront(vodId: string, twitchVodUrl: string, userOauth?: string) {
  try {
    oppdaterJobbStatus(vodId, 'DOWNLOADING', 'Laster ned VOD med yt-dlp...');

    const { execSync } = require('child_process');
    const execAsync = require('util').promisify(require('child_process').exec);

    let ytDlpOk = false;
    try { execSync('yt-dlp --version', { stdio: 'ignore' }); ytDlpOk = true; } catch {}
    if (!ytDlpOk) { oppdaterJobbStatus(vodId, 'FAILED', 'yt-dlp ikke tilgjengelig på Railway'); return; }

    const outDir = path.join(DATA_DIR, 'content-factory', 'raw-vods');
    const audioDir = path.join(DATA_DIR, 'content-factory', 'audio');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

    const videoPath = path.join(outDir, `${vodId}.mp4`);
    const audioPath = path.join(audioDir, `${vodId}.mp3`);
    const cookieArg = userOauth ? `--add-header "Authorization:OAuth ${userOauth}"` : '';

    await execAsync(
      `yt-dlp -f "bestvideo[height<=720]+bestaudio/best[height<=720]" --merge-output-format mp4 --no-playlist ${cookieArg} -o "${videoPath}" "${twitchVodUrl}"`,
      { maxBuffer: 1024 * 1024 * 200 }
    );

    if (!fs.existsSync(videoPath)) { oppdaterJobbStatus(vodId, 'FAILED', 'Videofil ikke funnet etter nedlasting'); return; }

    oppdaterJobbStatus(vodId, 'EXTRACTING_AUDIO', 'Ekstraherer audio med FFmpeg...');
    await execAsync(`ffmpeg -y -i "${videoPath}" -vn -ar 16000 -ac 1 -c:a libmp3lame -q:a 4 "${audioPath}"`);
    if (!fs.existsSync(audioPath)) { oppdaterJobbStatus(vodId, 'FAILED', 'Lydfil ikke funnet'); return; }

    oppdaterJobbStatus(vodId, 'UPLOADING', 'Laster opp til Supabase Storage...');
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const storagePath = `content-factory/audio/${vodId}.mp3`;
    const buf = fs.readFileSync(audioPath);

    const { error: upErr } = await sb.storage.from('glenvex-assets').upload(storagePath, buf, { contentType: 'audio/mpeg', upsert: true });
    if (upErr) {
      await sb.storage.createBucket('glenvex-assets', { public: false }).catch(() => {});
      const { error: retry } = await sb.storage.from('glenvex-assets').upload(storagePath, buf, { contentType: 'audio/mpeg', upsert: true });
      if (retry) { oppdaterJobbStatus(vodId, 'FAILED', `Supabase Storage: ${retry.message}`); return; }
    }

    const { data: sd } = await sb.storage.from('glenvex-assets').createSignedUrl(storagePath, 7200);
    if (!sd?.signedUrl) { oppdaterJobbStatus(vodId, 'FAILED', 'Signed URL generering feilet'); return; }

    await sb.from('content_vods').update({
      audio_storage_path: storagePath,
      audio_signed_url: sd.signedUrl,
      audio_url_expires_at: new Date(Date.now() + 7200000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', vodId);

    try { fs.unlinkSync(videoPath); } catch {}

    oppdaterJobbStatus(vodId, 'COMPLETE', 'Audio klar!', {
      storagePath,
      signedUrl: sd.signedUrl,
      audioSize: fs.statSync(audioPath).size,
    });

    console.log(`[ContentFactory] ✓ Jobb ferdig: ${vodId}`);
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
