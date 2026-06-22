import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export interface StorageCategory {
  label: string;
  tier: 'permanent' | 'media' | 'ephemeral';
  rowCount: number;
  note: string | null;
  warning: string | null;
}

export interface StorageFileGroup {
  prefix: string;
  label: string;
  fileCount: number;
  examplePaths: string[];
}

export interface StorageHealthData {
  databaseCategories: StorageCategory[];
  storageFiles: StorageFileGroup[];
  storageReachable: boolean;
  generatedAt: string;
}

const STORAGE_BUCKET = process.env.STORAGE_BUCKET ?? 'glenvex-assets';

async function countRows(
  db: NonNullable<ReturnType<typeof getDb>>,
  table: string,
  ws: string,
): Promise<number> {
  try {
    const { count } = await db
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', ws);
    return count ?? 0;
  } catch {
    return -1;
  }
}

async function listStoragePrefix(
  db: NonNullable<ReturnType<typeof getDb>>,
  prefix: string,
): Promise<string[]> {
  try {
    const { data } = await db.storage
      .from(STORAGE_BUCKET)
      .list(prefix, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
    return (data ?? []).map(f => `${prefix}/${f.name}`);
  } catch {
    return [];
  }
}

export async function GET() {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB not configured' }, { status: 500 });
  const ws = getWorkspaceId();

  const [
    streamHistoryCount,
    aiMemoryCount,
    aiInsightsCount,
    creatorKnowledgeCount,
    systemEventsCount,
    highlightsCount,
    vodsCount,
    contentCopyCount,
    partnerLogCount,
  ] = await Promise.all([
    countRows(db, 'stream_history', ws),
    countRows(db, 'ai_agent_memory', ws),
    countRows(db, 'ai_agent_insights', ws),
    countRows(db, 'creator_knowledge', ws),
    countRows(db, 'system_events', ws),
    countRows(db, 'content_highlights', ws),
    countRows(db, 'content_vods', ws),
    countRows(db, 'content_copy', ws),
    countRows(db, 'partner_content_log', ws),
  ]);

  const databaseCategories: StorageCategory[] = [
    {
      label: 'Stream-historikk',
      tier: 'permanent',
      rowCount: streamHistoryCount,
      note: 'Aldri slett — grunnlaget for all AI-læring',
      warning: streamHistoryCount === 0 ? 'Ingen streams lagret ennå' : null,
    },
    {
      label: 'AI-minne (Creator Brain)',
      tier: 'permanent',
      rowCount: aiMemoryCount,
      note: 'Viewer-minne, joke-historikk, mønstre',
      warning: null,
    },
    {
      label: 'AI-innsikter',
      tier: 'permanent',
      rowCount: aiInsightsCount,
      note: 'Oppdagede mønstre fra AI-aggregering',
      warning: aiInsightsCount > 500 ? `${aiInsightsCount} rader — vurder å filtrere eldre enn 90 dager` : null,
    },
    {
      label: 'Creator Knowledge',
      tier: 'permanent',
      rowCount: creatorKnowledgeCount,
      note: 'Strukturert kunnskap fra Learning Engine',
      warning: null,
    },
    {
      label: 'System-hendelser',
      tier: 'permanent',
      rowCount: systemEventsCount,
      note: 'Audit-log og bot-aktivitet',
      warning: systemEventsCount > 10000 ? `${systemEventsCount} rader — vurder arkivering av events eldre enn 1 år` : null,
    },
    {
      label: 'Highlights (DB)',
      tier: 'media',
      rowCount: highlightsCount,
      note: 'Metadata for klipp — selve videofilene er i Supabase Storage',
      warning: null,
    },
    {
      label: 'Content VODs',
      tier: 'media',
      rowCount: vodsCount,
      note: 'VOD-metadata — råfiler er lokale på Railway (ephemeral)',
      warning: vodsCount > 0 ? 'Råvideo er IKKE i Supabase Storage — Railway-disk er flyktig' : null,
    },
    {
      label: 'Content Copy',
      tier: 'permanent',
      rowCount: contentCopyCount,
      note: 'AI-generert tekst og captions per highlight',
      warning: null,
    },
    {
      label: 'Partner-logg',
      tier: 'permanent',
      rowCount: partnerLogCount,
      note: 'Historikk over alle partner-promoer sendt',
      warning: null,
    },
  ];

  // List files in Supabase Storage
  let storageReachable = false;
  let storageFiles: StorageFileGroup[] = [];

  try {
    const topLevel = await db.storage.from(STORAGE_BUCKET).list('', { limit: 50 });
    if (!topLevel.error) {
      storageReachable = true;
      const folders = (topLevel.data ?? []).filter(f => !f.metadata); // folders have no metadata

      const prefixResults = await Promise.all(
        folders.map(async f => {
          const paths = await listStoragePrefix(db, f.name);
          return { prefix: f.name, paths };
        }),
      );

      const FOLDER_LABELS: Record<string, string> = {
        'content-factory': 'Content Factory klipp',
        'thumbnails': 'Thumbnails',
      };

      storageFiles = prefixResults
        .filter(r => r.paths.length > 0)
        .map(r => ({
          prefix: r.prefix,
          label: FOLDER_LABELS[r.prefix] ?? r.prefix,
          fileCount: r.paths.length,
          examplePaths: r.paths.slice(0, 3),
        }));

      // If no sub-folders, check for files at root
      if (storageFiles.length === 0) {
        const rootFiles = (topLevel.data ?? []).filter(f => f.metadata);
        if (rootFiles.length > 0) {
          storageFiles = [{
            prefix: '',
            label: 'Rot-nivå filer',
            fileCount: rootFiles.length,
            examplePaths: rootFiles.slice(0, 3).map(f => f.name),
          }];
        }
      }
    }
  } catch { /* storage not reachable */ }

  return NextResponse.json({
    databaseCategories,
    storageFiles,
    storageReachable,
    generatedAt: new Date().toISOString(),
  } satisfies StorageHealthData);
}
