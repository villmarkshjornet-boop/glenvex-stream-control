import fs from 'fs';
import path from 'path';

const BOT_API = process.env.BOT_API_URL;

export async function hentBotData(endpoint: string): Promise<any> {
  // Prøv Railway bot API først
  if (BOT_API) {
    try {
      const res = await fetch(`${BOT_API}/${endpoint}`, { next: { revalidate: 30 } } as any);
      if (res.ok) return res.json();
    } catch {}
  }

  // Fallback: les fra lokal fil (fungerer i dev og Railway-miljø)
  const file = path.join(process.cwd(), 'data', `${endpoint}.json`);
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {}

  return null;
}
