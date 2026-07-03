import { NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const STORAGE_BUCKET = process.env.STORAGE_BUCKET ?? 'glenvex-assets';

// DELETE /api/content-factory/jobs?status=failed
// Sletter alle feilede VODs (og tilhørende data) for gjeldende workspace.
// Returnerer { deleted: number }
export async function DELETE() {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  const workspaceId = getWorkspaceId();

  // Hent alle feilede VODs for dette workspace-et
  const { data: failedVods, error: fetchErr } = await db
    .from('content_vods')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'FAILED');

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!failedVods || failedVods.length === 0) {
    return NextResponse.json({ deleted: 0 });
  }

  const vodIds = failedVods.map((v: { id: string }) => v.id);

  // Slett storage-filer for eventuelle highlights (feilede VODs kan ha delvise highlights)
  const { data: highlights } = await db
    .from('content_highlights')
    .select('id,vod_id')
    .in('vod_id', vodIds);

  if (highlights && highlights.length > 0) {
    const stier = highlights.flatMap((h: { id: string; vod_id: string }) => [
      `content-factory/clips/${h.vod_id}/${h.id}_16x9.mp4`,
      `content-factory/clips/${h.vod_id}/${h.id}_9x16.mp4`,
    ]);
    await db.storage.from(STORAGE_BUCKET).remove(stier).catch(() => {});
  }

  // Slett i FK-trygg rekkefølge: barnestabeller først, foreldre sist
  const highlightIds = (highlights ?? []).map((h: { id: string }) => h.id);

  await db.from('content_review_queue').delete().in('vod_id', vodIds);
  if (highlightIds.length > 0) {
    await db.from('content_captions').delete().in('highlight_id', highlightIds);
  }
  await db.from('content_assets').delete().in('vod_id', vodIds);
  await db.from('content_copy').delete().in('vod_id', vodIds);
  await db.from('content_transcripts').delete().in('vod_id', vodIds);
  await db.from('content_highlights').delete().in('vod_id', vodIds);
  await db.from('content_pipeline_logs').delete().in('vod_id', vodIds);

  const { error: slettErr } = await db
    .from('content_vods')
    .delete()
    .in('id', vodIds)
    .eq('workspace_id', workspaceId)
    .eq('status', 'FAILED'); // dobbel sikkerhet: kun FAILED

  if (slettErr) {
    return NextResponse.json({ error: slettErr.message }, { status: 500 });
  }

  // Logg hendelsen
  try {
    await db.from('system_events').insert({
      workspace_id: workspaceId,
      source: 'content_factory',
      event_type: 'FAILED_JOBS_DELETED',
      title: `${vodIds.length} feilede VOD-jobber slettet`,
      severity: 'info',
      metadata: { vodIds, count: vodIds.length },
    });
  } catch {}

  return NextResponse.json({ deleted: vodIds.length });
}

export async function GET() {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ vods: [], logs: [] });

  const [vodsRes, logsRes] = await Promise.all([
    db.from('content_vods')
      .select('id,title,category,status,created_at,twitch_vod_id,duration_seconds')
      .eq('workspace_id', getWorkspaceId())
      .order('created_at', { ascending: false })
      .limit(20),
    db.from('content_pipeline_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  const vods = vodsRes.data ?? [];
  const logs = logsRes.data ?? [];

  // Grupper logger per VOD
  const vodMedLogger = vods.map(v => {
    const vodLogs = logs.filter(l => l.vod_id === v.id);
    const steg = ['DOWNLOAD', 'TRANSCRIBE', 'DISCOVER', 'RANK', 'COPYWRITE', 'QUEUE'];
    const stegStatus = steg.map(s => {
      const stegLogs = vodLogs.filter(l => l.step === s);
      const siste = stegLogs[0];
      return {
        steg: s,
        status: siste?.status ?? 'IKKE_STARTET',
        melding: siste?.message,
        durationMs: siste?.duration_ms,
        kostnad: siste?.cost_estimate,
        output: siste?.output_count,
        tid: siste?.created_at,
      };
    });

    const startTid = vodLogs[vodLogs.length - 1]?.created_at;
    const sluttTid = vodLogs[0]?.created_at;
    const totalMs = startTid && sluttTid
      ? new Date(sluttTid).getTime() - new Date(startTid).getTime()
      : null;
    const totalKostnad = vodLogs.reduce((s, l) => s + (l.cost_estimate ?? 0), 0);

    return { ...v, stegStatus, startTid, sluttTid, totalMs, totalKostnad, antallLogs: vodLogs.length };
  });

  return NextResponse.json({ vods: vodMedLogger });
}
