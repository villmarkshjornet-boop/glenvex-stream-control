import { createClient } from '@supabase/supabase-js';
import { logSystemEvent } from './systemEvents';

const WORKSPACE_ID = process.env.WORKSPACE_ID || 'glenvex-default';

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const ws = require('ws');
  return createClient(url, key, { realtime: { transport: ws } });
}

const TITTEL_MAP: Record<string, (d: Record<string, any>) => string> = {
  stream_live:      d => `Stream live: ${d.tittel ?? d.spill ?? ''}`.trimEnd(),
  stream_offline:   _  => 'Stream offline',
  pre_hype:         d => `Pre-hype sendt: ${d.spill ?? ''}`.trimEnd(),
  level_up:         d => `Level up: ${d.username ?? '?'} → Level ${d.level ?? '?'}`,
  klipp_ferdig:     d => `Klipp ferdig: ${d.title ?? d.id ?? ''}`.trimEnd(),
  klipp_start:      d => `Klipp starter: ${d.title ?? ''}`.trimEnd(),
  discord_varsel:   d => d.melding ?? 'Discord varslet',
  thumbnail_ferdig: d => `Thumbnail ferdig: ${d.id ?? ''}`.trimEnd(),
};

/** Logg bot-hendelse til system_events (erstatter live_events). */
export function logBotEvent(type: string, data: Record<string, any> = {}): void {
  const tittelFn = TITTEL_MAP[type];
  const title = tittelFn ? tittelFn(data) : `${type}${Object.keys(data).length ? ': ' + JSON.stringify(data).slice(0, 60) : ''}`;
  logSystemEvent({ source: 'bot_events', event_type: type, title, severity: 'info', metadata: data });
}

export async function updateStreamSyklus(updates: Record<string, string | null>): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    const { data: ws_ } = await db.from('workspaces').select('settings_json').eq('id', WORKSPACE_ID).single();
    const existing = ws_?.settings_json ?? {};
    const syklus = existing.stream_syklus ?? {};
    await db.from('workspaces').update({
      settings_json: { ...existing, stream_syklus: { ...syklus, ...updates } },
    }).eq('id', WORKSPACE_ID);
  } catch (err: any) {
    console.error('[BotEvents] updateStreamSyklus feil:', err.message);
  }
}

export async function getStreamSyklus(): Promise<Record<string, string | null>> {
  const db = getDb();
  if (!db) return {};
  try {
    const { data } = await db.from('workspaces').select('settings_json').eq('id', WORKSPACE_ID).single();
    return data?.settings_json?.stream_syklus ?? {};
  } catch { return {}; }
}

// ─── StreamEntry model ────────────────────────────────────────────────────────

export interface StreamEntry {
  id: string;
  type: 'weekly' | 'single';
  // weekly: which weekday (0=sun … 6=sat), single: undefined
  weekday?: number;
  dag?: string;              // legacy weekday name kept for compat
  // single: ISO date string "YYYY-MM-DD"
  date?: string;
  tid: string;               // "HH:MM"
  spill: string;
  tittel: string;
  aktiv: boolean;
  status?: 'upcoming' | 'completed' | 'skipped';
  pre_hype_enabled?: boolean;
  pre_hype_minutes_before?: number;
}

// Migrate legacy StreamDay entries (dag/tid/spill/tittel/aktiv) to StreamEntry
function migrateEntry(raw: any, idx: number): StreamEntry {
  if (raw.type === 'weekly' || raw.type === 'single') {
    return raw as StreamEntry;
  }
  // Legacy: has dag (weekday name), no type
  return {
    id: raw.id ?? `legacy-${idx}`,
    type: 'weekly',
    dag: raw.dag,
    weekday: undefined,
    tid: raw.tid ?? '20:00',
    spill: raw.spill ?? '',
    tittel: raw.tittel ?? '',
    aktiv: raw.aktiv !== false,
    status: 'upcoming',
    pre_hype_enabled: true,
    pre_hype_minutes_before: 60,
  };
}

export async function getStreamplan(): Promise<StreamEntry[]> {
  const db = getDb();
  if (!db) return [];
  try {
    const { data } = await db.from('workspaces').select('settings_json').eq('id', WORKSPACE_ID).single();
    const raw: any[] = data?.settings_json?.streamplan ?? [];
    return raw.map((e, i) => migrateEntry(e, i));
  } catch { return []; }
}

export async function updateStreamEntryStatus(entryId: string, status: StreamEntry['status']): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    const { data: ws_ } = await db.from('workspaces').select('settings_json').eq('id', WORKSPACE_ID).single();
    const existing = ws_?.settings_json ?? {};
    const plan: any[] = existing.streamplan ?? [];
    const updated = plan.map((e: any) => e.id === entryId ? { ...e, status } : e);
    await db.from('workspaces').update({ settings_json: { ...existing, streamplan: updated } }).eq('id', WORKSPACE_ID);
  } catch (err: any) {
    console.error('[BotEvents] updateStreamEntryStatus feil:', err.message);
  }
}

export async function resetStreamSyklus(): Promise<void> {
  await updateStreamSyklus({
    discord_varslet_at: null,
    pre_hype_sendt_at: null,
    stream_start_at: null,
    sist_live_id: null,
  });
  console.log('[BotEvents] Stream-syklus nullstilt');
}
