/**
 * Lagrer og henter siste Discord meldings-ID per type i Supabase.
 * Brukes for å slette gammel melding før ny postes (unngå duplikater).
 */

import { getDb, isDbAvailable } from './db';
import { getWorkspaceId } from './workspace';

const DISCORD_API = 'https://discord.com/api/v10';

function botHeaders() {
  return { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` };
}

async function getSettings(): Promise<Record<string, any>> {
  if (!isDbAvailable()) return {};
  const db = getDb();
  if (!db) return {};
  const { data } = await db
    .from('workspaces')
    .select('settings_json')
    .eq('id', getWorkspaceId())
    .single();
  return data?.settings_json ?? {};
}

async function saveSettings(updates: Record<string, any>): Promise<void> {
  if (!isDbAvailable()) return;
  const db = getDb();
  if (!db) return;
  const current = await getSettings();
  await db
    .from('workspaces')
    .update({ settings_json: { ...current, ...updates }, updated_at: new Date().toISOString() })
    .eq('id', getWorkspaceId());
}

/** Hent siste meldings-ID for en type (f.eks. 'partner', 'streamplan', 'live') */
export async function hentSisteMsgId(type: string): Promise<{ msgId: string; kanalId: string } | null> {
  const s = await getSettings();
  const key = `lastMsg_${type}`;
  return s[key] ?? null;
}

/** Lagre meldings-ID etter posting */
export async function lagreMsgId(type: string, msgId: string, kanalId: string): Promise<void> {
  const key = `lastMsg_${type}`;
  await saveSettings({ [key]: { msgId, kanalId, dato: new Date().toISOString() } });
}

/** Slett gammel melding og returner om det lyktes */
export async function slettGammelMelding(type: string): Promise<boolean> {
  const gammel = await hentSisteMsgId(type);
  if (!gammel?.msgId || !gammel.kanalId) return false;

  try {
    const res = await fetch(`${DISCORD_API}/channels/${gammel.kanalId}/messages/${gammel.msgId}`, {
      method: 'DELETE',
      headers: botHeaders(),
    });
    return res.ok || res.status === 404; // 404 = allerede slettet
  } catch {
    return false;
  }
}

/** Alt i ett: slett gammel, post ny, lagre ny ID */
export async function postOgOppdater(
  type: string,
  kanalId: string,
  payload: Record<string, any>
): Promise<{ ok: boolean; msgId?: string; error?: string }> {
  // Slett gammel
  await slettGammelMelding(type);

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
