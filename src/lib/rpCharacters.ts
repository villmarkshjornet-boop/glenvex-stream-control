import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const FILE = path.join(process.cwd(), 'data', 'rp-characters.json');

export type RPStatus = 'aktiv' | 'inaktiv' | 'arkivert' | 'slettet';

export interface RPRelasjon {
  navn: string;
  type: 'venn' | 'fiende' | 'nøytral' | 'familie' | 'kollega';
  beskrivelse: string;
}

export interface RPCharacter {
  id: string;
  navn: string;
  kallenavn?: string;
  server: string;
  rolle: string;
  beskrivelse: string;
  backstory: string;
  fraksjon?: string;
  relasjoner: RPRelasjon[];
  konflikter: string[];
  bildeUrl?: string;
  status: RPStatus;
  sisteStream?: string;
  discordMsgId?: string;
  discordKanalId?: string;
  publiseringsHistorikk: { dato: string; kanalId: string; msgId?: string }[];
  opprettet: string;
  endret: string;
}

function load(): RPCharacter[] {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return [];
}

function save(data: RPCharacter[]) {
  try {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

export function getCharacters(): RPCharacter[] {
  return load().filter(c => c.status !== 'slettet');
}

export function addCharacter(data: Omit<RPCharacter, 'id' | 'opprettet' | 'endret' | 'publiseringsHistorikk' | 'relasjoner' | 'konflikter'>): RPCharacter {
  const chars = load();
  const ny: RPCharacter = {
    ...data,
    id: randomUUID(),
    relasjoner: [],
    konflikter: [],
    publiseringsHistorikk: [],
    opprettet: new Date().toISOString(),
    endret: new Date().toISOString(),
  };
  chars.unshift(ny);
  save(chars);
  return ny;
}

export function updateCharacter(id: string, updates: Partial<RPCharacter>): RPCharacter | null {
  const chars = load();
  const idx = chars.findIndex(c => c.id === id);
  if (idx < 0) return null;
  chars[idx] = { ...chars[idx], ...updates, endret: new Date().toISOString() };
  save(chars);
  return chars[idx];
}

export function deleteCharacter(id: string) {
  const chars = load();
  const idx = chars.findIndex(c => c.id === id);
  if (idx >= 0) {
    chars[idx].status = 'slettet';
    save(chars);
    return chars[idx].discordMsgId;
  }
  return null;
}
