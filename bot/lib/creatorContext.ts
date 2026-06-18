// Creator Context — purpose-scoped context assembly
// getCreatorContext(workspaceId, purpose) is the sole entry point for historical context.
// Modules must NOT fetch their own context from Supabase — they call Creator Brain.
// V3 Architecture: Section 4 — Creator Context

import { getBotDb, WORKSPACE_ID } from './supabase';
import type { CachedPartner } from './creatorState';

export type ContextPurpose = 'health' | 'stream' | 'community' | 'content' | 'partner' | 'full';

export interface WorkspaceInfo {
  id: string;
  brandName: string | null;
  twitchChannelName: string | null;
  createdAt: string;
}

export interface RecentEvent {
  eventType: string;
  title: string;
  severity: string;
  source: string;
  createdAt: string;
  metadata: Record<string, any>;
}

export interface RecentDecision {
  id: string;
  agentType: string;
  decisionType: string;
  decisionSummary: string;
  outcome: string | null;
  createdAt: string;
}

export interface CreatorContext {
  purpose: ContextPurpose;
  workspaceId: string;
  fetchedAt: Date;
  workspace: WorkspaceInfo | null;
  recentEvents: RecentEvent[];
  recentDecisions: RecentDecision[];
  recentMemoryKeys: string[];
  // Historical average viewers over the last 30 days — null if no stream_history yet.
  // Only populated when purpose is 'stream' or 'full'.
  avgViewers30d: number | null;
  // Active partners fetched from DB — only populated when purpose is 'partner' or 'full'.
  // Cached in Creator State so modules read from memory, not from this field directly.
  activePartners: CachedPartner[];
}

export async function getCreatorContext(
  workspaceId: string,
  purpose: ContextPurpose
): Promise<CreatorContext> {
  const db = getBotDb();
  const ws = workspaceId ?? WORKSPACE_ID;

  const ctx: CreatorContext = {
    purpose,
    workspaceId: ws,
    fetchedAt: new Date(),
    workspace: null,
    recentEvents: [],
    recentDecisions: [],
    recentMemoryKeys: [],
    avgViewers30d: null,
    activePartners: [],
  };

  if (!db) return ctx;

  const eventLimit = purpose === 'health' || purpose === 'full' ? 20 : 10;
  const needsHistory = purpose === 'stream' || purpose === 'full';
  const needsPartners = purpose === 'partner' || purpose === 'full';
  const cutoff30d = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

  const [workspaceRes, eventsRes, decisionsRes, memoryRes, historyRes, partnersRes] = await Promise.all([
    db.from('workspaces')
      .select('id,brand_name,twitch_channel_name,created_at')
      .eq('id', ws)
      .limit(1),
    db.from('system_events')
      .select('event_type,title,severity,source,created_at,metadata')
      .eq('workspace_id', ws)
      .order('created_at', { ascending: false })
      .limit(eventLimit),
    db.from('ai_agent_decisions')
      .select('id,agent_type,decision_type,decision_summary,outcome,created_at')
      .eq('workspace_id', ws)
      .order('created_at', { ascending: false })
      .limit(5),
    db.from('ai_agent_memory')
      .select('key,memory_type')
      .eq('workspace_id', ws)
      .order('occurrence_count', { ascending: false })
      .limit(10),
    needsHistory
      ? db.from('stream_history')
          .select('avg_viewers')
          .eq('workspace_id', ws)
          .not('ended_at', 'is', null)
          .gte('ended_at', cutoff30d)
          .limit(30)
      : Promise.resolve({ data: [] as Array<{ avg_viewers: number | null }> }),
    needsPartners
      ? db.from('partners')
          .select('id,navn,beskrivelse,affiliate_link,nettadresse,rabattkode,prioritet')
          .eq('aktiv', true)
          .order('prioritet', { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] as Array<Record<string, any>> }),
  ]);

  const w = workspaceRes.data?.[0];
  if (w) {
    ctx.workspace = {
      id: w.id,
      brandName: w.brand_name ?? null,
      twitchChannelName: w.twitch_channel_name ?? null,
      createdAt: w.created_at,
    };
  }

  ctx.recentEvents = (eventsRes.data ?? []).map((e: Record<string, any>) => ({
    eventType: e.event_type,
    title: e.title,
    severity: e.severity ?? 'info',
    source: e.source,
    createdAt: e.created_at,
    metadata: e.metadata ?? {},
  }));

  ctx.recentDecisions = (decisionsRes.data ?? []).map((d: Record<string, any>) => ({
    id: d.id,
    agentType: d.agent_type,
    decisionType: d.decision_type,
    decisionSummary: d.decision_summary,
    outcome: d.outcome ?? null,
    createdAt: d.created_at,
  }));

  ctx.recentMemoryKeys = (memoryRes.data ?? []).map(
    (m: Record<string, any>) => `${m.memory_type}:${m.key}`
  );

  const histRows = (historyRes.data ?? []) as Array<{ avg_viewers: number | null }>;
  if (histRows.length > 0) {
    const sum = histRows.reduce((acc, r) => acc + (r.avg_viewers ?? 0), 0);
    ctx.avgViewers30d = Math.round(sum / histRows.length);
  }

  ctx.activePartners = (partnersRes.data ?? []).map((raw: Record<string, any>) => ({
    id: raw.id,
    navn: raw.navn,
    beskrivelse: raw.beskrivelse ?? null,
    affiliateUrl: raw.affiliate_link?.trim() || null,
    fallbackUrl: raw.nettadresse?.trim() || null,
    rabattkode: raw.rabattkode ?? null,
    prioritet: raw.prioritet ?? 0,
  }));

  return ctx;
}
