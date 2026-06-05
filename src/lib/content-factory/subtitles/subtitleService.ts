import { assertContentFactoryEnabled } from '../index';
import { hentTranskripsjon } from '../transcripts/whisperService';
import fs from 'fs';
import path from 'path';

function tidTilSRT(sek: number): string {
  const h = Math.floor(sek / 3600);
  const m = Math.floor((sek % 3600) / 60);
  const s = Math.floor(sek % 60);
  const ms = Math.round((sek % 1) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

function tidTilVTT(sek: number): string {
  return tidTilSRT(sek).replace(',', '.');
}

const GAMING_SLANG: Record<string, string> = {
  'pvp': 'PvP', 'pve': 'PvE', 'fps': 'FPS', 'gg': 'GG', 'wp': 'WP',
  'rp': 'RP', 'lol': 'LOL', 'wtf': 'WTF', 'omg': 'OMG',
};

function forbedreGamingTekst(tekst: string): string {
  let res = tekst;
  for (const [fra, til] of Object.entries(GAMING_SLANG)) {
    res = res.replace(new RegExp(`\\b${fra}\\b`, 'gi'), til);
  }
  return res;
}

function bryttLinjer(tekst: string, maxLengde = 42): string {
  if (tekst.length <= maxLengde) return tekst;
  const midt = Math.floor(tekst.length / 2);
  const mellomrom = tekst.indexOf(' ', midt);
  if (mellomrom === -1) return tekst;
  return tekst.slice(0, mellomrom) + '\n' + tekst.slice(mellomrom + 1);
}

export async function genererSRT(
  vodId: string,
  startOffset = 0
): Promise<string> {
  assertContentFactoryEnabled();

  const transkripter = await hentTranskripsjon(vodId);
  const relevante = transkripter.filter(t =>
    t.startTime >= startOffset
  );

  let srt = '';
  for (let i = 0; i < relevante.length; i++) {
    const t = relevante[i];
    const tekst = forbedreGamingTekst(bryttLinjer(t.text.trim()));
    srt += `${i + 1}\n`;
    srt += `${tidTilSRT(t.startTime - startOffset)} --> ${tidTilSRT(t.endTime - startOffset)}\n`;
    srt += `${tekst}\n\n`;
  }
  return srt;
}

export async function genererVTT(
  vodId: string,
  startOffset = 0
): Promise<string> {
  assertContentFactoryEnabled();

  const transkripter = await hentTranskripsjon(vodId);
  const relevante = transkripter.filter(t => t.startTime >= startOffset);

  let vtt = 'WEBVTT\n\n';
  for (const t of relevante) {
    const tekst = forbedreGamingTekst(bryttLinjer(t.text.trim()));
    vtt += `${tidTilVTT(t.startTime - startOffset)} --> ${tidTilVTT(t.endTime - startOffset)}\n`;
    vtt += `${tekst}\n\n`;
  }
  return vtt;
}

export async function genererJSON(
  vodId: string,
  startOffset = 0
): Promise<object[]> {
  assertContentFactoryEnabled();

  const transkripter = await hentTranskripsjon(vodId);
  return transkripter
    .filter(t => t.startTime >= startOffset)
    .map(t => ({
      start: t.startTime - startOffset,
      end: t.endTime - startOffset,
      text: forbedreGamingTekst(t.text.trim()),
    }));
}

export function lagreSRTTilFil(innhold: string, filSti: string): void {
  const dir = path.dirname(filSti);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filSti, innhold, 'utf-8');
}
