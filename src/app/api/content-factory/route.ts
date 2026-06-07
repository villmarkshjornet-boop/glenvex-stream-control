/**
 * Content Factory API – IKKE offentlig
 * POST: Opprett VOD i DB + start Railway Phase 1 (download + transcribe)
 * GET: List alle VODs
 */

import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { logSystemEvent } from '@/lib/systemEvents';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function sjekkFlag() {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'Content Factory er ikke aktivert', kode: 'FEATURE_DISABLED' }, { status: 403 });
  }
  return null;
}

// GET /api/content-factory – VOD-liste (returnerer snake_case for konsistens med sider)
export async function GET() {
  const feil = sjekkFlag();
  if (feil) return feil;

  const db = getDb();
  if (!db) return NextResponse.json({ vods: [] });

  const { data } = await db
    .from('content_vods')
    .select('id,title,category,status,created_at,twitch_vod_id,duration_seconds,vod_url,started_at,error_message,current_step,progress_percent')
    .eq('workspace_id', getWorkspaceId())
    .order('created_at', { ascending: false })
    .limit(30);

  return NextResponse.json({ status: 'active', vods: data ?? [] });
}

// POST /api/content-factory – Start pipeline: opprett VOD + kall Railway Phase 1
export async function POST(req: NextRequest) {
  const feil = sjekkFlag();
  if (feil) return feil;

  const body = await req.json().catch(() => ({})) as {
    streamId?: string;
    vodUrl?: string;
  };

  const streamId = body.streamId?.trim();
  if (!streamId) return NextResponse.json({ error: 'streamId kreves' }, { status: 400 });

  // Ekstraher ren VOD ID (støtter "2786985500" eller "https://twitch.tv/videos/2786985500")
  const vodIdTall = streamId.replace(/.*\/videos\//,'').replace(/[^0-9]/g,'');
  const twitchVodUrl = `https://www.twitch.tv/videos/${vodIdTall}`;

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  // Hent Twitch-metadata
  let vodMeta: any = { title: `Stream ${vodIdTall}`, category: 'Ukjent', duration_seconds: 0 };
  try {
    const { hentVodMetadata } = await import('@/lib/content-factory/vod/vodService');
    const meta = await hentVodMetadata(streamId);
    if (meta) {
      vodMeta = {
        title: meta.title ?? vodMeta.title,
        category: meta.category ?? vodMeta.category,
        duration_seconds: meta.durationSeconds ?? 0,
        started_at: meta.startedAt,
        vod_url: meta.vodUrl,
        thumbnail_url: meta.thumbnailUrl,
        twitch_vod_id: meta.twitchVodId,
      };
    }
  } catch (e) {
    console.error('[CF] Twitch metadata feil:', (e as Error).message);
  }

  // Opprett VOD-rad med PENDING status
  const { data: vod, error: dbErr } = await db.from('content_vods').insert({
    workspace_id: getWorkspaceId(),
    stream_id: vodIdTall,
    twitch_vod_id: vodMeta.twitch_vod_id ?? vodIdTall,
    title: vodMeta.title,
    category: vodMeta.category,
    duration_seconds: vodMeta.duration_seconds,
    started_at: vodMeta.started_at,
    vod_url: vodMeta.vod_url ?? twitchVodUrl,
    thumbnail_url: vodMeta.thumbnail_url,
    status: 'PENDING',
    current_step: 'DOWNLOAD',
    progress_percent: 5,
    status_message: 'VOD opprettet – starter Railway...',
  }).select().single();

  if (dbErr) return NextResponse.json({ error: `DB-feil: ${dbErr.message}` }, { status: 500 });

  const vodId = vod.id;
  const botApiUrl = process.env.BOT_API_URL;

  if (!botApiUrl) {
    await db.from('content_vods').update({
      status: 'FAILED',
      error_message: 'BOT_API_URL er ikke satt i Vercel – Railway kan ikke nås',
      progress_percent: 0,
    }).eq('id', vodId);
    return NextResponse.json({ ok: false, vodId, railwayFeil: 'BOT_API_URL mangler' });
  }

  // Sett ANALYZING umiddelbart
  await db.from('content_vods').update({
    status: 'ANALYZING',
    current_step: 'DOWNLOAD',
    progress_percent: 10,
    status_message: 'Sendt til Railway – starter nedlasting...',
  }).eq('id', vodId);

  await logSystemEvent({
    source: 'content_factory',
    event_type: 'VOD_DETECTED',
    title: `VOD oppdaget: ${vodMeta.title.slice(0, 60)}`,
    description: `Twitch VOD ${vodIdTall} – sender til Railway for nedlasting`,
    severity: 'info',
    metadata: { vodId, twitchVodId: vodIdTall, title: vodMeta.title, durationSeconds: vodMeta.duration_seconds },
  });

  // Fire-and-forget – ikke vent på Railway (kan være treg ved cold start)
  fetch(`${botApiUrl}/content-factory/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vodId,
      twitchVodUrl,
      userOauth: process.env.TWITCH_USER_OAUTH,
    }),
  }).catch(() => {});

  await logSystemEvent({
    source: 'content_factory',
    event_type: 'DOWNLOAD_STARTED',
    title: 'Download startet på Railway',
    description: `VOD ${vodIdTall} sendt til Railway for nedlasting og transkribering`,
    severity: 'info',
    metadata: { vodId, twitchVodId: vodIdTall },
  });

  return NextResponse.json({
    ok: true,
    vodId,
    vodTitle: vodMeta.title,
    railwayStartet: true,
    railwayFeil: null,
  });
}
