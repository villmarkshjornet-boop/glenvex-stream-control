import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const FILE = path.join(process.cwd(), 'data', 'content-library.json');

export type ContentStatus = 'draft' | 'klar' | 'godkjent' | 'publisert' | 'feilet' | 'arkivert' | 'slettet';
export type ContentType =
  | 'live-varsel' | 'rp-karakter' | 'promo' | 'partner-post' | 'giveaway'
  | 'poll' | 'clip-post' | 'streamplan' | 'discord-melding' | 'twitch-melding'
  | 'kanal-oppsett' | 'event' | 'velkomst' | 'annet';

export interface ContentItem {
  id: string;
  tittel: string;
  type: ContentType;
  status: ContentStatus;
  tekst: string;
  bildeUrl?: string;
  embedData?: Record<string, any>;
  kanalId?: string;
  kanalNavn?: string;
  modul: string;
  opprettetAv: string;
  godkjentAv?: string;
  discordMsgId?: string;
  opprettet: string;
  endret: string;
  publisert?: string;
  planlagtPublisering?: string;
  tags?: string[];
  feilmelding?: string;
}

function load(): ContentItem[] {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return [];
}

function save(data: ContentItem[]) {
  try {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

export function getAllContent(): ContentItem[] {
  return load().filter(c => c.status !== 'slettet');
}

export function addContent(item: Omit<ContentItem, 'id' | 'opprettet' | 'endret'>): ContentItem {
  const items = load();
  const ny: ContentItem = {
    ...item,
    id: randomUUID(),
    opprettet: new Date().toISOString(),
    endret: new Date().toISOString(),
  };
  items.unshift(ny);
  save(items.slice(0, 500)); // Maks 500 items
  return ny;
}

export function updateContent(id: string, updates: Partial<ContentItem>): ContentItem | null {
  const items = load();
  const idx = items.findIndex(i => i.id === id);
  if (idx < 0) return null;
  items[idx] = { ...items[idx], ...updates, endret: new Date().toISOString() };
  save(items);
  return items[idx];
}

export function publishContent(id: string, discordMsgId?: string): ContentItem | null {
  return updateContent(id, {
    status: 'publisert',
    publisert: new Date().toISOString(),
    discordMsgId,
  });
}

export function getContentByType(type: ContentType): ContentItem[] {
  return getAllContent().filter(c => c.type === type);
}

export function getDrafts(): ContentItem[] {
  return getAllContent().filter(c => c.status === 'draft' || c.status === 'klar');
}
