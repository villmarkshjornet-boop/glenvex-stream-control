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
    const endpointMap: Record<string, string> = {
      '/members':       'members',
      '/events':        'events',
      '/stream-history':'stream-history',
      '/rp-notes':      'rp-notes',
      '/moderation':    'moderation',
      '/schedule':      'schedule',
      '/goals':         'goals',
    };

    const filNavn = endpointMap[url];
    if (filNavn) {
      const data = readFile(filNavn);
      res.writeHead(data !== null ? 200 : 404);
      res.end(JSON.stringify(data ?? { error: 'Ingen data' }));
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'GLENVEX Bot Data API', endpoints: Object.keys(endpointMap) }));
    }
  });

  server.listen(port, () => {
    console.log(`  ✓ Data API kjører på port ${port}`);
  });
}
