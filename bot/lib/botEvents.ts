import { createClient } from '@supabase/supabase-js';

const WORKSPACE_ID = process.env.WORKSPACE_ID || 'glenvex-default';

const eventQueue: Array<Record<string, any>> = [];
let flushTimeout: ReturnType<typeof setTimeout> | null = null;

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const ws = require('ws');
  return createClient(url, key, { realtime: { transport: ws } });
}

async function doFlush(): Promise<void> {
  if (eventQueue.length === 0) return;
  const db = getDb();
  if (!db) return;
  const batch = eventQueue.splice(0);
  try {
    const { data: ws_ } = await db.from('workspaces').select('settings_json').eq('id', WORKSPACE_ID).single();
    const existing = ws_?.settings_json ?? {};
    const events: any[] = existing.live_events ?? [];
    events.unshift(...batch);
    if (events.length > 200) events.length = 200;
    await db.from('workspaces').update({ settings_json: { ...existing, live_events: events } }).eq('id', WORKSPACE_ID);
  } catch {
    eventQueue.unshift(...batch);
  }
}

setInterval(() => doFlush().catch(() => {}), 15_000);

export function logBotEvent(type: string, data: Record<string, any> = {}): void {
  eventQueue.push({ type, ts: new Date().toISOString(), ...data });
  if (!flushTimeout) {
    flushTimeout = setTimeout(() => { flushTimeout = null; doFlush().catch(() => {}); }, 3_000);
  }
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
