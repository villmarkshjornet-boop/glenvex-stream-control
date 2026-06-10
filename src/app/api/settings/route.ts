import { NextRequest, NextResponse } from 'next/server';
import { getSettings, saveSettings } from '@/lib/settings';
import { addLog } from '@/lib/logger';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { logSystemEvent } from '@/lib/systemEvents';
import { nullstillKanalCache } from '@/lib/discordChannel';

export const dynamic = 'force-dynamic';

// ── Reads full settings_json from DB (including kanalPreferanser) ─────────────
async function getFullSettingsJson(): Promise<Record<string, any> | null> {
  if (!isDbAvailable()) return null;
  const db = getDb();
  if (!db) return null;
  try {
    const { data, error } = await db
      .from('workspaces')
      .select('settings_json')
      .eq('id', getWorkspaceId())
      .single();
    if (error) return null;
    return (data?.settings_json as Record<string, any>) ?? null;
  } catch {
    return null;
  }
}

// ── Saves settings by MERGING with current settings_json (preserves kanalPreferanser) ─
async function saveSettingsToDb(incoming: Record<string, any>): Promise<{
  ok: boolean;
  merged: Record<string, any>;
  error?: string;
}> {
  if (!isDbAvailable()) return { ok: false, merged: incoming, error: 'DB not available' };
  const db = getDb();
  if (!db) return { ok: false, merged: incoming, error: 'No DB client' };

  const wsId = getWorkspaceId();

  // Read existing row — needed to merge and to know whether to insert or update
  const { data: existing, error: readErr } = await db
    .from('workspaces')
    .select('id, settings_json')
    .eq('id', wsId)
    .single();

  if (readErr && readErr.code !== 'PGRST116') {
    // PGRST116 = row not found — anything else is a real error
    return { ok: false, merged: incoming, error: readErr.message };
  }

  const currentJson = (existing?.settings_json as Record<string, any>) ?? {};

  // MERGE: preserve all existing keys (especially kanalPreferanser from channel-settings panel)
  const merged = { ...currentJson, ...incoming };

  // Always UPDATE — workspace row must exist (created during onboarding).
  // Never INSERT from here: avoids RLS violations and prevents duplicate workspace rows.
  const { error } = await db
    .from('workspaces')
    .update({ settings_json: merged, updated_at: new Date().toISOString() })
    .eq('id', wsId);
  if (error) return { ok: false, merged, error: error.message };

  return { ok: true, merged };
}

// ── Strips internal-only keys before returning to frontend ────────────────────
function toApiResponse(json: Record<string, any>): Record<string, any> {
  // kanalPreferanser is owned by /api/channel-settings — don't expose in /api/settings
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { kanalPreferanser, ...rest } = json;
  return rest;
}

// ── GET /api/settings ─────────────────────────────────────────────────────────

export async function GET() {
  const workspaceId = getWorkspaceId();
  try {
    const fullJson = await getFullSettingsJson();

    // DIAG-4: What is in DB on GET
    console.log('[DIAG settings GET] wsId:', workspaceId);
    console.log('[DIAG settings GET] fullJson from DB:', JSON.stringify(fullJson ?? null));

    if (fullJson && Object.keys(fullJson).length > 0) {
      const fileSettings = getSettings();
      const response = toApiResponse({ ...fileSettings, ...fullJson });
      console.log('[DIAG settings GET] response (after toApiResponse):', JSON.stringify(response));

      logSystemEvent({
        source: 'settings',
        event_type: 'SETTINGS_LOADED',
        title: 'Settings lastet fra Supabase',
        severity: 'info',
        metadata: {
          workspaceId,
          source: 'supabase',
          discordLiveChannelId: (fullJson.discordLiveChannelId as string) ?? null,
          hasKanalPreferanser: !!fullJson.kanalPreferanser,
        },
      }).catch(() => {});

      return NextResponse.json(response);
    }

    // Fallback: file only
    const fileSettings = getSettings();
    logSystemEvent({
      source: 'settings',
      event_type: 'SETTINGS_LOADED',
      title: 'Settings lastet fra fil (ingen DB-data)',
      severity: 'info',
      metadata: { workspaceId, source: 'file' },
    }).catch(() => {});

    return NextResponse.json(fileSettings);
  } catch (err: any) {
    logSystemEvent({
      source: 'settings',
      event_type: 'SETTINGS_LOAD_FAILED',
      title: `Settings-lasting feilet: ${err?.message ?? 'ukjent feil'}`,
      severity: 'error',
      metadata: { workspaceId, error: err?.message },
    }).catch(() => {});
    return NextResponse.json(getSettings());
  }
}

// ── POST /api/settings ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const workspaceId = getWorkspaceId();
  let body: Record<string, any>;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }

  // Detect which fields changed (for observability)
  const before = await getFullSettingsJson().catch(() => null);
  const changedFields: string[] = [];
  for (const key of Object.keys(body)) {
    if (before?.[key] !== body[key]) changedFields.push(key);
  }

  logSystemEvent({
    source: 'settings',
    event_type: 'SETTINGS_SAVE_STARTED',
    title: `Settings lagres: ${changedFields.length > 0 ? changedFields.join(', ') : '(ingen endringer)'}`,
    severity: 'info',
    metadata: {
      workspaceId,
      changedFields,
      discordLiveChannelId: (body.discordLiveChannelId as string) ?? null,
      discordLiveChannelName: (body.discordLiveChannelName as string) ?? null,
    },
  }).catch(() => {});

  // ── Detect contentFactoryChannel change for existing log ───────────────────
  const oldChannel = (before?.contentFactoryChannel as string) ?? '';
  const newChannel = (body.contentFactoryChannel as string) ?? '';

  // ── Save to Supabase (merge — preserves kanalPreferanser) ──────────────────
  const { ok: dbOk, merged, error: dbErr } = await saveSettingsToDb(body);

  // ── Save to file as fallback (Railway reads this) ──────────────────────────
  saveSettings(body);

  // ── Invalidate Discord channel cache ──────────────────────────────────────
  nullstillKanalCache();

  addLog('info', `Innstillinger oppdatert${dbOk ? ' (Supabase)' : ' (fil)'}`, 'OK');

  if (dbOk) {
    logSystemEvent({
      source: 'settings',
      event_type: 'SETTINGS_SAVE_SUCCESS',
      title: `Settings lagret: ${changedFields.length > 0 ? changedFields.join(', ') : 'ingen endringer'}`,
      severity: 'info',
      metadata: {
        workspaceId,
        changedFields,
        discordLiveChannelId: (merged.discordLiveChannelId as string) ?? null,
        discordLiveChannelName: (merged.discordLiveChannelName as string) ?? null,
        savedTo: 'supabase',
      },
    }).catch(() => {});
  } else {
    logSystemEvent({
      source: 'settings',
      event_type: 'SETTINGS_SAVE_FAILED',
      title: `Settings-lagring feilet i Supabase: ${dbErr ?? 'ukjent feil'}`,
      severity: 'error',
      metadata: { workspaceId, error: dbErr, savedTo: 'file_only' },
    }).catch(() => {});
  }

  // Log contentFactoryChannel endring
  if (newChannel !== oldChannel) {
    logSystemEvent({
      source: 'content_factory',
      event_type: 'CONTENT_FACTORY_CHANNEL_UPDATED',
      title: 'Content Factory monitoring channel updated.',
      severity: 'info',
      metadata: {
        workspace_id: workspaceId,
        old_channel: oldChannel || '(ikke satt)',
        new_channel: newChannel || '(fjernet)',
        changed_by: 'innstillinger',
      },
    }).catch(() => {});
  }

  // ── Return the actual merged state from DB (not file) ─────────────────────
  // This ensures frontend state matches what was actually persisted.
  const fileSettings = getSettings();
  const responseSettings = dbOk
    ? toApiResponse({ ...fileSettings, ...merged })
    : { ...fileSettings, ...body };

  return NextResponse.json(responseSettings);
}
