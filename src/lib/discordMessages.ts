/**
 * Felles håndtering av Discord-meldinger.
 * Lagrer siste message ID per type i Supabase + fil-fallback.
 * Brukes til å slette gamle meldinger før ny postes (ingen duplikater).
 */

import { getDb, isDbAvailable } from './db';
import { getWorkspaceId } from './workspace';
import fs from 'fs';
import path from 'path';

const DISCORD_API = 'https://discord.com/api/v10';
const MSG_FILE = path.join(process.cwd(), 'data', 'discord-messages.json');

function botHeaders() {
  return { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` };
}

// ── Fil-fallback (Railway) ────────────────────────────────────────────────────

function loadFile(): Record<string, { msgId: string; kanalId: string; dato: string }> {
  try {
    if (fs.existsSync(MSG_FILE)) return JSON.parse(fs.readFileSync(MSG_FILE, 'utf-8'));
  } catch {}
  return {};
}

function saveFile(data: Record<string, any>) {
  try {
    const dir = path.dirname(MSG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MSG_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

// ── Supabase ──────────────────────────────────────────────────────────────────

async function hentFraDb(): Promise<Record<string, any>> {
  if (!isDbAvailable()) return {};
  const db = getDb();
  if (!db) return {};
  try {
    const { data } = await db
      .from('workspaces')
      .select('settings_json')
      .eq('id', getWorkspaceId())
      .single();
    return data?.settings_json?.discordMeldinger ?? {};
  } catch { return {}; }
}

async function lagreTilDb(meldinger: Record<string, any>): Promise<boolean> {
  if (!isDbAvailable()) return false;
  const db = getDb();
  if (!db) return false;
  try {
    const wsId = getWorkspaceId();

    // Hent eksisterende eller opprett workspace
    const { data: existing } = await db
      .from('workspaces')
      .select('id, settings_json')
      .eq('id', wsId)
      .single();

    if (!existing) {
      console.warn('[discordMessages] Workspace ikke funnet — fullfør onboarding først.');
      return false;
    }

    const current = existing.settings_json ?? {};
    const { error } = await db
      .from('workspaces')
      .update({
        settings_json: { ...current, discordMeldinger: { ...(current.discordMeldinger ?? {}), ...meldinger } },
        updated_at: new Date().toISOString(),
      })
      .eq('id', wsId);
    return !error;
  } catch { return false; }
}

// ── Offentlige funksjoner ────────────────────────────────────────────────────

export async function hentSisteMsgId(type: string): Promise<{ msgId: string; kanalId: string } | null> {
  // Prøv fil-fallback først (raskere på Railway)
  const fil = loadFile();
  if (fil[type]) return fil[type];

  // Prøv Supabase
  const db = await hentFraDb();
  if (db[type]) return db[type];

  return null;
}

export async function lagreMsgId(type: string, msgId: string, kanalId: string): Promise<void> {
  const entry = { msgId, kanalId, dato: new Date().toISOString() };

  // Lagre i fil alltid
  const fil = loadFile();
  fil[type] = entry;
  saveFile(fil);

  // Lagre i Supabase
  await lagreTilDb({ [type]: entry });
}

export async function slettGammelMelding(type: string): Promise<boolean> {
  const gammel = await hentSisteMsgId(type);
  if (!gammel?.msgId || !gammel.kanalId) return false;

  try {
    const res = await fetch(`${DISCORD_API}/channels/${gammel.kanalId}/messages/${gammel.msgId}`, {
      method: 'DELETE',
      headers: botHeaders(),
    });
    // 200/204 = slettet, 404 = allerede slettet, begge er OK
    return res.ok || res.status === 404;
  } catch { return false; }
}

/** Slett gammel → post ny → lagre ID. Brukes overalt. */
export async function postOgOppdater(
  type: string,
  kanalId: string,
  payload: Record<string, any>
): Promise<{ ok: boolean; msgId?: string; error?: string }> {
  // Alltid slett gammel melding (uavhengig av kanal)
  const slettet = await slettGammelMelding(type);
  if (slettet) console.log(`[Discord] Slettet gammel ${type}-melding`);

  // Post ny
  const res = await fetch(`${DISCORD_API}/channels/${kanalId}/messages`, {
    method: 'POST',
    headers: { ...botHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    return { ok: false, error: `Discord ${res.status}: ${err.slice(0, 100)}` };
  }

  const msg = await res.json() as any;
  await lagreMsgId(type, msg.id, kanalId);
  return { ok: true, msgId: msg.id };
}
