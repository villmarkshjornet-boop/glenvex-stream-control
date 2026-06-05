import http from 'http';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

function readFile(navn: string): any {
  const file = path.join(DATA_DIR, `${navn}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
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
        } catch (err: any) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ── Content Factory: VOD-nedlasting → FFmpeg → Supabase Storage ──────────
    if (url === '/content-factory/process' && method === 'POST') {
      let body = '';
      req.on('data', (chunk: any) => { body += chunk; });
      req.on('end', async () => {
        if (process.env.CONTENT_FACTORY_ENABLED !== 'true') {
          res.writeHead(403);
          res.end(JSON.stringify({ error: 'FEATURE_DISABLED' }));
          return;
        }
        try {
          const parsed = JSON.parse(body) as { vodId: string; twitchVodUrl: string; userOauth?: string };
          const { execSync } = require('child_process');
          const pathMod = require('path');
          const fsMod = require('fs');
          const execAsync = require('util').promisify(require('child_process').exec);

          let ytDlpOk = false;
          try { execSync('yt-dlp --version', { stdio: 'ignore' }); ytDlpOk = true; } catch {}
          if (!ytDlpOk) {
            res.writeHead(503);
            res.end(JSON.stringify({ error: 'yt-dlp ikke tilgjengelig' }));
            return;
          }

          const outDir = pathMod.join(process.cwd(), 'data', 'content-factory', 'raw-vods');
          const audioDir = pathMod.join(process.cwd(), 'data', 'content-factory', 'audio');
          if (!fsMod.existsSync(outDir)) fsMod.mkdirSync(outDir, { recursive: true });
          if (!fsMod.existsSync(audioDir)) fsMod.mkdirSync(audioDir, { recursive: true });

          const videoPath = pathMod.join(outDir, `${parsed.vodId}.mp4`);
          const audioPath = pathMod.join(audioDir, `${parsed.vodId}.mp3`);
          const cookieArg = parsed.userOauth ? `--add-header "Authorization:OAuth ${parsed.userOauth}"` : '';

          await execAsync(
            `yt-dlp -f "bestvideo[height<=720]+bestaudio/best[height<=720]" --merge-output-format mp4 --no-playlist ${cookieArg} -o "${videoPath}" "${parsed.twitchVodUrl}"`,
            { maxBuffer: 1024 * 1024 * 100 }
          );

          if (!fsMod.existsSync(videoPath)) throw new Error('Videofil ikke funnet etter nedlasting');

          await execAsync(`ffmpeg -y -i "${videoPath}" -vn -ar 16000 -ac 1 -c:a libmp3lame -q:a 4 "${audioPath}"`);
          if (!fsMod.existsSync(audioPath)) throw new Error('Lydfil ikke funnet etter ekstraksjon');

          const { createClient } = require('@supabase/supabase-js');
          const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
          const storagePath = `content-factory/audio/${parsed.vodId}.mp3`;
          const buf = fsMod.readFileSync(audioPath);

          const { error: upErr } = await sb.storage.from('glenvex-assets').upload(storagePath, buf, { contentType: 'audio/mpeg', upsert: true });
          if (upErr) {
            await sb.storage.createBucket('glenvex-assets', { public: false }).catch(() => {});
            const { error: retry } = await sb.storage.from('glenvex-assets').upload(storagePath, buf, { contentType: 'audio/mpeg', upsert: true });
            if (retry) throw new Error(`Supabase Storage: ${retry.message}`);
          }

          const { data: sd } = await sb.storage.from('glenvex-assets').createSignedUrl(storagePath, 3600);
          if (!sd?.signedUrl) throw new Error('Kunne ikke generere signed URL');

          await sb.from('content_vods').update({
            audio_storage_path: storagePath,
            audio_signed_url: sd.signedUrl,
            audio_url_expires_at: new Date(Date.now() + 3600000).toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('id', parsed.vodId);

          try { fsMod.unlinkSync(videoPath); } catch {}

          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, storagePath, signedUrl: sd.signedUrl, audioSize: fsMod.statSync(audioPath).size }));
        } catch (err: any) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // ── Datafiler ────────────────────────────────────────────────────────────
    const endpointMap: Record<string, string> = {
      '/members':        'members',
      '/events':         'events',
      '/stream-history': 'stream-history',
      '/rp-notes':       'rp-notes',
      '/moderation':     'moderation',
      '/schedule':       'schedule',
      '/goals':          'goals',
    };

    const filNavn = endpointMap[url];
    if (filNavn) {
      const data = readFile(filNavn);
      res.writeHead(data !== null ? 200 : 404);
      res.end(JSON.stringify(data ?? { error: 'Ingen data' }));
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'GLENVEX Bot Data API', endpoints: [...Object.keys(endpointMap), '/generate-image', '/content-factory/process'] }));
    }
  });

  server.listen(port, () => {
    console.log(`  ✓ Data API kjører på port ${port}`);
  });
}
