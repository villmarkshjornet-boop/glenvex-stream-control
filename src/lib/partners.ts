import fs from 'fs';
import path from 'path';
import { getDb, isDbAvailable } from './db';
import { getWorkspaceId } from './workspace';

export interface Partner {
  id: string;
  workspace_id?: string;
  navn: string;
  logo?: string;
  nettadresse: string;
  affiliateLink: string;
  rabattkode: string;
  beskrivelse: string;
  kategori: string;
  provisjonstype: string;
  provisjon: number;
  avtaleStart?: string;
  avtaleSlutt?: string;
  aktiv: boolean;
  featured: boolean;
  ownedBrand: boolean;
  prioritet: number;
  eksponering: number;
  sistePromotert?: string;
  klikk: number;
  estimertInntekt: number;
  kampanjer: any[];
  opprettet: string;
}

const FILE = path.join(process.cwd(), 'data', 'partners.json');

function loadFile(): Partner[] {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return [];
}

function saveFile(data: Partner[]) {
  try {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

// ── Supabase-versjon ─────────────────────────────────────────────────────────

async function dbGetAll(): Promise<Partner[]> {
  const db = getDb();
  if (!db) return loadFile();
  const { data, error } = await db
    .from('partners')
    .select('*')
    .eq('workspace_id', getWorkspaceId())
    .order('opprettet', { ascending: false });
  if (error) return loadFile();
  return (data ?? []).map(mapFromDb);
}

async function ensureWorkspace() {
  // Workspace opprettes kun i onboarding — ikke her.
}

async function dbInsert(partner: Omit<Partner, 'id' | 'opprettet'>): Promise<Partner | null> {
  const db = getDb();
  const { randomUUID } = await import('crypto');
  const row = mapToDb({ ...partner, id: randomUUID(), opprettet: new Date().toISOString() });

  if (!db) {
    const items = loadFile();
    items.unshift(row as any);
    saveFile(items);
    return row as Partner;
  }

  await ensureWorkspace();

  const { data, error } = await db.from('partners').insert(row).select().single();
  if (error) {
    console.error('[DB] insert partner:', error.message);
    // Fallback til fil
    const items = loadFile();
    items.unshift(row as any);
    saveFile(items);
    return row as Partner;
  }
  return mapFromDb(data);
}

async function dbUpdate(id: string, updates: Partial<Partner>): Promise<Partner | null> {
  const db = getDb();
  if (!db) {
    const items = loadFile();
    const idx = items.findIndex(p => p.id === id);
    if (idx >= 0) { items[idx] = { ...items[idx], ...updates }; saveFile(items); return items[idx]; }
    return null;
  }
  const row = mapToDb(updates as any);
  const { data, error } = await db.from('partners').update(row).eq('id', id).select().single();
  if (error) { console.error('[DB] update partner:', error.message); return null; }
  return mapFromDb(data);
}

async function dbDelete(id: string): Promise<boolean> {
  const db = getDb();
  if (!db) {
    saveFile(loadFile().filter(p => p.id !== id));
    return true;
  }
  const { error } = await db.from('partners').delete().eq('id', id);
  return !error;
}

// Mapping mellom camelCase og snake_case
function mapToDb(p: Partial<Partner>): Record<string, any> {
  return {
    ...(p.id && { id: p.id }),
    workspace_id: p.workspace_id ?? getWorkspaceId(),
    navn: p.navn,
    logo: p.logo,
    nettadresse: p.nettadresse,
    affiliate_link: p.affiliateLink,
    rabattkode: p.rabattkode,
    beskrivelse: p.beskrivelse,
    kategori: p.kategori,
    provisjonstype: p.provisjonstype,
    provisjon: p.provisjon,
    avtale_start: p.avtaleStart,
    avtale_slutt: p.avtaleSlutt,
    aktiv: p.aktiv,
    featured: p.featured,
    owned_brand: p.ownedBrand,
    prioritet: p.prioritet,
    eksponering: p.eksponering ?? 0,
    siste_promotert: p.sistePromotert,
    klikk: p.klikk ?? 0,
    estimert_inntekt: p.estimertInntekt ?? 0,
    kampanjer: p.kampanjer ?? [],
    ...(p.opprettet && { opprettet: p.opprettet }),
  };
}

function mapFromDb(r: any): Partner {
  return {
    id: r.id,
    workspace_id: r.workspace_id,
    navn: r.navn ?? '',
    logo: r.logo,
    nettadresse: r.nettadresse ?? '',
    affiliateLink: r.affiliate_link ?? '',
    rabattkode: r.rabattkode ?? '',
    beskrivelse: r.beskrivelse ?? '',
    kategori: r.kategori ?? 'annet',
    provisjonstype: r.provisjonstype ?? 'prosent',
    provisjon: r.provisjon ?? 0,
    avtaleStart: r.avtale_start,
    avtaleSlutt: r.avtale_slutt,
    aktiv: r.aktiv ?? true,
    featured: r.featured ?? false,
    ownedBrand: r.owned_brand ?? false,
    prioritet: r.prioritet ?? 5,
    eksponering: r.eksponering ?? 0,
    sistePromotert: r.siste_promotert,
    klikk: r.klikk ?? 0,
    estimertInntekt: r.estimert_inntekt ?? 0,
    kampanjer: r.kampanjer ?? [],
    opprettet: r.opprettet ?? new Date().toISOString(),
  };
}

// ── Eksporterte funksjoner ────────────────────────────────────────────────────

export async function getPartners(): Promise<Partner[]> {
  return dbGetAll();
}

export async function createPartner(data: Omit<Partner, 'id' | 'opprettet'>): Promise<Partner | null> {
  return dbInsert(data);
}

export async function updatePartner(id: string, updates: Partial<Partner>): Promise<Partner | null> {
  return dbUpdate(id, updates);
}

export async function deletePartner(id: string): Promise<boolean> {
  return dbDelete(id);
}

export async function getFeaturedPartner(): Promise<Partner | null> {
  const all = await dbGetAll();
  return all.find(p => p.featured && p.aktiv) ?? null;
}
