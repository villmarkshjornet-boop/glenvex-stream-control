import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export interface KnowledgeBase {
  channelProfile: string;
  contentStrategy: string;
  communityContext: string;
  gameContext: string;
  streamCount: number;
}

const FALLBACK: KnowledgeBase = {
  channelProfile: 'GLENVEX – norsk gaming streamer. Spiller Tarkov, GTA RP og andre spill.',
  contentStrategy: 'Fokus på genuine reaksjoner, episke øyeblikk og community-interaksjon.',
  communityContext: 'Norsk gaming community, engasjerte tittere.',
  gameContext: 'Escape from Tarkov: boss-kills, rare loot, clutch-ekstraksjon scorer høyt. GTA RP: dramatiske scene-øyeblikk fungerer bra.',
  streamCount: 0,
};

export async function hentKnowledgeBase(): Promise<KnowledgeBase> {
  const db = getDb();
  if (!db) return FALLBACK;

  const { data } = await db
    .from('ai_producer_knowledge')
    .select('*')
    .eq('workspace_id', getWorkspaceId());

  if (!data || data.length === 0) return FALLBACK;

  const get = (cat: string) => data.find((e: any) => e.category === cat)?.content ?? '';
  const streamCount = Math.max(...data.map((e: any) => e.stream_count ?? 0), 0);

  return {
    channelProfile: get('channel_profile') || FALLBACK.channelProfile,
    contentStrategy: get('content_strategy') || FALLBACK.contentStrategy,
    communityContext: get('community_context') || FALLBACK.communityContext,
    gameContext: get('game_context') || FALLBACK.gameContext,
    streamCount,
  };
}

export async function oppdaterKnowledge(
  category: string,
  content: string,
  streamCount: number
): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.from('ai_producer_knowledge').upsert(
    {
      workspace_id: getWorkspaceId(),
      category,
      content,
      stream_count: streamCount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,category' }
  );
}

export async function hentStreamMemory(antall = 5): Promise<any[]> {
  const db = getDb();
  if (!db) return [];
  const { data } = await db
    .from('ai_producer_stream_memory')
    .select('*')
    .eq('workspace_id', getWorkspaceId())
    .order('created_at', { ascending: false })
    .limit(antall);
  return data ?? [];
}

export async function hentContentPatterns(): Promise<any[]> {
  const db = getDb();
  if (!db) return [];
  const { data } = await db
    .from('ai_producer_content_memory')
    .select('*')
    .eq('workspace_id', getWorkspaceId())
    .order('avg_score', { ascending: false });
  return data ?? [];
}

export async function hentCommunityMemory(antall = 20): Promise<any[]> {
  const db = getDb();
  if (!db) return [];
  const { data } = await db
    .from('ai_producer_community_memory')
    .select('*')
    .eq('workspace_id', getWorkspaceId())
    .order('occurrence_count', { ascending: false })
    .limit(antall);
  return data ?? [];
}
