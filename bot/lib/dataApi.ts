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
          if (!apiKey) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'OPENAI_API_KEY mangler' }));
            return;
          }
          const { default: OpenAI } = await import('openai');
          const client = new OpenAI({ apiKey });
          const response = await client.images.generate({
            model: 'dall-e-3',
            prompt: `GTA RP character portrait, cinematic dark style. ${prompt}. Norwegian RP server GLENVEX. Dark neon green and black, dramatic lighting, no text.`,
            n: 1,
            size: '1024x1024',
            quality: 'standard',
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
      res.end(JSON.stringify({ status: 'GLENVEX Bot Data API', endpoints: [...Object.keys(endpointMap), '/generate-image'] }));
    }
  });

  server.listen(port, () => {
    console.log(`  ✓ Data API kjører på port ${port}`);
  });
}
