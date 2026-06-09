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

export async function getStreamplan(): Promise<any[]> {
  const db = getDb();
  if (!db) return [];
  try {
    const { data } = await db.from('workspaces').select('settings_json').eq('id', WORKSPACE_ID).single();
    return data?.settings_json?.streamplan ?? [];
  } catch { return []; }
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
