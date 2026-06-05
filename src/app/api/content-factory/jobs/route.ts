import { NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

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
