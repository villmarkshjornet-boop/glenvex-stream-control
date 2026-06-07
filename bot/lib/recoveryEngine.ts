import { createClient } from '@supabase/supabase-js';
import { logSystemEvent } from './systemEvents';

const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'glenvex-default';

// Timeouts that trigger recovery (minutes)
const TIMEOUT_VOD_TRANSCRIBING        = 30;
const TIMEOUT_VOD_HIGHLIGHT_DISCOVERY = 15;
const TIMEOUT_CLIPPING                =  15;
const TIMEOUT_THUMBNAIL_GENERATING   =   5;

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function runRecoveryCheck(): Promise<void> {
  const sb = getClient();
  if (!sb) return;

  const now = new Date();

  // ── Stuck VODs ────────────────────────────────────────────────────────────
  const { data: stuckVods } = await sb
    .from('content_vods')
    .select('id,title,status,current_step,updated_at,created_at')
    .in('status', ['ANALYZING', 'PENDING'])
    .eq('workspace_id', WORKSPACE_ID)
    .order('updated_at', { ascending: true })
    .limit(20);

  for (const vod of stuckVods ?? []) {
    const lastUpdate  = new Date(vod.updated_at ?? vod.created_at);
    const minStuck    = (now.getTime() - lastUpdate.getTime()) / 60_000;
    const isTranscrib = (vod.current_step ?? '').toUpperCase().includes('TRANSCRIB') ||
                        (vod.current_step ?? '').toUpperCase().includes('DOWNLOAD');
    const threshold   = isTranscrib ? TIMEOUT_VOD_TRANSCRIBING : TIMEOUT_VOD_HIGHLIGHT_DISCOVERY;

    if (minStuck < threshold) continue;

    logSystemEvent({
      source:      'recovery_engine',
      event_type:  'RECOVERY_TRIGGERED',
      title:       `VOD stuck i ${vod.status} (${Math.round(minStuck)}min) – resetter`,
      description: `"${(vod.title ?? '').slice(0, 80)}"`,
      severity:    'warning',
      metadata:    { vod_id: vod.id, status: vod.status, current_step: vod.current_step, minutes_stuck: Math.round(minStuck) },
    });

    const { error } = await sb.from('content_vods').update({
      status:           'PENDING',
      current_step:     null,
      error_message:    null,
      progress_percent: 0,
    }).eq('id', vod.id);

    logSystemEvent({
      source:     'recovery_engine',
      event_type: error ? 'RECOVERY_FAILED' : 'RECOVERY_SUCCESS',
      title:      error ? `VOD recovery feilet` : `VOD resatt til PENDING`,
      description: error ? error.message : `"${(vod.title ?? '').slice(0, 80)}" er tilbake i køen`,
      severity:   error ? 'error' : 'info',
      metadata:   { vod_id: vod.id, error: error?.message },
    });
  }

  // ── Stuck clips (CLIPPING) ────────────────────────────────────────────────
  const clipCutoff = new Date(now.getTime() - TIMEOUT_CLIPPING * 60_000).toISOString();
  const { data: stuckClips } = await sb
    .from('content_highlights')
    .select('id,title,vod_id,updated_at')
    .eq('clip_status', 'CLIPPING')
    .lt('updated_at', clipCutoff)
    .limit(20);

  for (const clip of stuckClips ?? []) {
    const minStuck = (now.getTime() - new Date(clip.updated_at).getTime()) / 60_000;

    logSystemEvent({
      source:      'recovery_engine',
      event_type:  'RECOVERY_TRIGGERED',
      title:       `Highlight stuck i CLIPPING (${Math.round(minStuck)}min) – resetter`,
      description: `"${(clip.title ?? '').slice(0, 80)}"`,
      severity:    'warning',
      metadata:    { highlight_id: clip.id, vod_id: clip.vod_id, minutes_stuck: Math.round(minStuck) },
    });

    // clip_status røres ALDRI til DONE/CLIPPED — kun tilbake til READY_FOR_CLIP
    const { error } = await sb.from('content_highlights').update({
      clip_status: 'READY_FOR_CLIP',
    }).eq('id', clip.id);

    logSystemEvent({
      source:     'recovery_engine',
      event_type: error ? 'RECOVERY_FAILED' : 'RECOVERY_SUCCESS',
      title:      error ? `Clip recovery feilet` : `Highlight resatt til READY_FOR_CLIP`,
      severity:   error ? 'error' : 'info',
      metadata:   { highlight_id: clip.id, error: error?.message },
    });
  }

  // ── Stuck thumbnails (GENERATING > 5 min) ─────────────────────────────────
  const { data: stuckThumbs } = await sb
    .from('content_highlights')
    .select('id,title,vod_id,thumbnail_started_at,updated_at')
    .eq('thumbnail_status', 'GENERATING')
    .limit(30);

  for (const thumb of stuckThumbs ?? []) {
    const ref      = thumb.thumbnail_started_at ?? thumb.updated_at;
    if (!ref) continue;
    const minStuck = (now.getTime() - new Date(ref).getTime()) / 60_000;
    if (minStuck < TIMEOUT_THUMBNAIL_GENERATING) continue;

    logSystemEvent({
      source:      'recovery_engine',
      event_type:  'RECOVERY_TRIGGERED',
      title:       `Thumbnail stuck i GENERATING (${Math.round(minStuck)}min) – setter FAILED`,
      description: `"${(thumb.title ?? '').slice(0, 80)}"`,
      severity:    'warning',
      metadata:    { highlight_id: thumb.id, vod_id: thumb.vod_id, minutes_stuck: Math.round(minStuck) },
    });

    const { error } = await sb.from('content_highlights').update({
      thumbnail_status: 'FAILED',
      thumbnail_error:  `Recovery: timeout etter ${Math.round(minStuck)} min i GENERATING`,
    }).eq('id', thumb.id);

    logSystemEvent({
      source:     'recovery_engine',
      event_type: error ? 'RECOVERY_FAILED' : 'RECOVERY_SUCCESS',
      title:      error ? `Thumbnail recovery feilet` : `Thumbnail resatt til FAILED`,
      severity:   error ? 'error' : 'info',
      metadata:   { highlight_id: thumb.id, error: error?.message },
    });
  }
}

export function startRecoveryEngine(): void {
  console.log('[RecoveryEngine] Starter – sjekker hvert minutt');
  runRecoveryCheck().catch(err => console.error('[RecoveryEngine]', err?.message));
  setInterval(() => {
    runRecoveryCheck().catch(err => console.error('[RecoveryEngine]', err?.message));
  }, 60_000);
}
