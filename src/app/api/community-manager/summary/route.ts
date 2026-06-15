import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const XP_PER_LEVEL     = 500;
const MILESTONE_LEVELS = [5, 15, 30, 50];
const PRIO_ORDER       = { high: 0, medium: 1, low: 2 } as const;

const BOT_ACTIVITY_TYPES = [
  'COMMUNITY_MVP_SELECTED',
  'COMMUNITY_MVP_SKIPPED_NO_ACTIVITY',
  'COMMUNITY_HYPE_SENT',
  'COMMUNITY_HYPE_SKIPPED_MISSING_CHANNEL',
  'COMMUNITY_HYPE_SKIPPED_DAILY_LIMIT',
  'COMMUNITY_HYPE_SKIPPED_NO_ACTIVITY',
  'COMMUNITY_ACTIVITY_PROMPT_SENT',
  'COMMUNITY_ACTIVITY_SKIPPED_MISSING_CHANNEL',
  'COMMUNITY_ACTIVITY_SKIPPED_RATE_LIMIT',
  'COMMUNITY_ACTIVITY_SKIPPED_RECENT_ACTIVITY',
  'COMMUNITY_IDLE_DETECTED',
  'COMMUNITY_REWARD_ROLE_MISSING',
] as const;

interface Rec {
  priority: 'high' | 'medium' | 'low';
  type: 'config' | 'activity' | 'reward' | 'info';
  message: string;
}

const EMPTY_RESPONSE = {
  health: {
    activeMembers24h: 0,
    activeMembers7d:  0,
    xpGranted7d:      0,
    levelUps7d:       0,
    lastBotPostAt:    null as string | null,
    lastBotPostType:  null as string | null,
    idleStatus:       'unknown' as 'active' | 'idle' | 'unknown',
    idleMinutes:      null as number | null,
  },
  topMembers7d:    [] as any[],
  recentLevelUps:  [] as any[],
  botActivity:     [] as any[],
  recommendations: [] as Rec[],
  diagnostics: {
    communityKanalKonfigurert: false,
    adminKanalKonfigurert:     false,
    communityAktiv:            false,
    xpAktiv:                   false,
    hypeAktiv:                 false,
    idleAktiv:                 false,
    idleThresholdMinutes:      120,
    rewardRolesCount:          0,
  },
};

export async function GET() {
  const wsId = getWorkspaceId();
  const db   = getDb();

  if (!db) return NextResponse.json(EMPTY_RESPONSE);

  try {
    const now      = Date.now();
    const cut24hMs = now - 24 * 3_600_000;
    const cut7d    = new Date(now - 7  * 24 * 3_600_000).toISOString();
    const cut30d   = new Date(now - 30 * 24 * 3_600_000).toISOString();

    // ── Workspace settings ─────────────────────────────────────────────────────
    const { data: wsRow } = await db
      .from('workspaces')
      .select('settings_json')
      .eq('id', wsId)
      .single();

    const sj      = (wsRow as any)?.settings_json ?? {};
    const kanaler  = sj.kanalPreferanser  ?? {};
    const cs       = sj.communitySettings ?? {};
    const rewardRoles: any[] = cs.rewardRoles ?? [];
    const idleThreshold: number = cs.idleThresholdMinutes ?? 120;

    const diagnostics = {
      communityKanalKonfigurert: !!kanaler.community,
      adminKanalKonfigurert:     !!kanaler.admin,
      communityAktiv: cs.aktiv              !== false,
      xpAktiv:        cs.xpAktiv            !== false,
      hypeAktiv:      cs.communityHypeAktiv !== false,
      idleAktiv:      cs.idlePromptsAktiv   !== false,
      idleThresholdMinutes: idleThreshold,
      rewardRolesCount:     rewardRoles.length,
    };

    // ── XP events last 7d (active members + top members data) ─────────────────
    const { data: xpRows } = await db
      .from('system_events')
      .select('metadata, created_at')
      .eq('workspace_id', wsId)
      .eq('event_type', 'COMMUNITY_XP_GRANTED')
      .gte('created_at', cut7d);

    const active24h = new Set<string>();
    const active7d  = new Set<string>();
    const xpByUser  = new Map<string, { xp: number; name: string }>();
    let xpGranted7d = 0;
    let lastXpMs    = 0;

    for (const r of (xpRows ?? []) as any[]) {
      const uid  = r.metadata?.userId  as string | undefined;
      const xp   = Number(r.metadata?.xpGranted ?? 0);
      const name = (r.metadata?.username as string) ?? '';
      const ts   = new Date(r.created_at).getTime();
      if (!uid) continue;
      active7d.add(uid);
      xpGranted7d += xp;
      if (ts > lastXpMs) lastXpMs = ts;
      if (ts >= cut24hMs) active24h.add(uid);
      const prev = xpByUser.get(uid) ?? { xp: 0, name };
      xpByUser.set(uid, { xp: prev.xp + xp, name: name || prev.name });
    }

    const idleMinutes = lastXpMs > 0 ? Math.round((now - lastXpMs) / 60_000) : null;
    const idleStatus: 'active' | 'idle' | 'unknown' =
      idleMinutes === null ? 'unknown'
      : idleMinutes < idleThreshold ? 'active' : 'idle';

    // ── Level-ups last 7d (count) ─────────────────────────────────────────────
    const { data: lu7dRows } = await db
      .from('system_events')
      .select('id')
      .eq('workspace_id', wsId)
      .eq('event_type', 'COMMUNITY_LEVEL_UP')
      .gte('created_at', cut7d);
    const levelUps7d = (lu7dRows ?? []).length;

    // ── Last bot post ─────────────────────────────────────────────────────────
    const { data: lpRows } = await db
      .from('system_events')
      .select('event_type, created_at')
      .eq('workspace_id', wsId)
      .in('event_type', ['COMMUNITY_MVP_SELECTED', 'COMMUNITY_HYPE_SENT', 'COMMUNITY_ACTIVITY_PROMPT_SENT'])
      .order('created_at', { ascending: false })
      .limit(1);

    const lp = ((lpRows ?? []) as any[])[0];
    const lastBotPostAt   = lp?.created_at ?? null;
    const lastBotPostType = !lp ? null
      : lp.event_type === 'COMMUNITY_MVP_SELECTED' ? 'mvp'
      : lp.event_type === 'COMMUNITY_HYPE_SENT'    ? 'hype'
      : 'prompt';

    const health = {
      activeMembers24h: active24h.size,
      activeMembers7d:  active7d.size,
      xpGranted7d,
      levelUps7d,
      lastBotPostAt,
      lastBotPostType,
      idleStatus,
      idleMinutes,
    };

    // ── Top members 7d (merge system_events XP + member profiles) ─────────────
    const topIds = Array.from(xpByUser.entries())
      .sort((a, b) => b[1].xp - a[1].xp)
      .slice(0, 10)
      .map(([uid]) => uid);

    let topMembers7d: any[] = [];
    if (topIds.length > 0) {
      const { data: mRows } = await db
        .from('community_members')
        .select('discord_id, display_name, level, xp, streak_days, badges')
        .eq('workspace_id', wsId)
        .in('discord_id', topIds);

      const mmap = new Map<string, any>();
      for (const m of (mRows ?? []) as any[]) mmap.set(m.discord_id as string, m);

      topMembers7d = topIds.map(uid => {
        const d = xpByUser.get(uid)!;
        const p = mmap.get(uid);
        return {
          userId:      uid,
          displayName: (p?.display_name as string) || d.name || uid.slice(0, 8),
          level:       (p?.level    as number) ?? 1,
          totalXp:     (p?.xp       as number) ?? 0,
          xp7d:        d.xp,
          streakDays:  (p?.streak_days as number) ?? 0,
          badges:      (p?.badges as string[])  ?? [],
        };
      });
    }

    // ── Recent level-ups (last 30d) ────────────────────────────────────────────
    const { data: lvlRows } = await db
      .from('system_events')
      .select('metadata, created_at')
      .eq('workspace_id', wsId)
      .eq('event_type', 'COMMUNITY_LEVEL_UP')
      .gte('created_at', cut30d)
      .order('created_at', { ascending: false })
      .limit(10);

    const recentLevelUps = ((lvlRows ?? []) as any[]).map(r => ({
      userId:    (r.metadata?.userId   as string) ?? '',
      username:  (r.metadata?.username as string) ?? (r.metadata?.displayName as string) ?? '',
      newLevel:  (r.metadata?.newLevel as number) ?? 1,
      rolleNavn: (r.metadata?.rolleNavn as string | null) ?? null,
      timestamp: r.created_at as string,
    }));

    // ── Bot activity feed (last 7d) ────────────────────────────────────────────
    const { data: actRows } = await db
      .from('system_events')
      .select('event_type, title, severity, created_at, metadata')
      .eq('workspace_id', wsId)
      .in('event_type', [...BOT_ACTIVITY_TYPES])
      .gte('created_at', cut7d)
      .order('created_at', { ascending: false })
      .limit(20);

    const botActivity = ((actRows ?? []) as any[]).map(r => ({
      eventType: r.event_type as string,
      title:     r.title      as string,
      severity:  (r.severity  as string) ?? 'info',
      timestamp: r.created_at as string,
      metadata:  (r.metadata  as Record<string, any>) ?? {},
    }));

    // ── Rule-based recommendations ─────────────────────────────────────────────
    const recs: Rec[] = [];

    if (!diagnostics.communityKanalKonfigurert) {
      recs.push({
        priority: 'high', type: 'config',
        message: 'Community-kanal er ikke satt — hype og idle-prompts er deaktivert. Gå til Innstillinger → Discord Kanaler.',
      });
    }

    const recentRoleError = botActivity.some(
      e => e.eventType === 'COMMUNITY_REWARD_ROLE_MISSING' &&
           new Date(e.timestamp).getTime() >= cut24hMs
    );
    if (recentRoleError) {
      recs.push({
        priority: 'high', type: 'reward',
        message: 'En reward role finnes ikke i Discord Guild — sjekk Role ID-ene under Community-innstillinger.',
      });
    }

    if (diagnostics.communityAktiv && diagnostics.xpAktiv && active24h.size === 0 && active7d.size > 0) {
      recs.push({
        priority: 'medium', type: 'activity',
        message: 'Ingen aktive community-membres siste 24 timer. Vurder en poll eller aktivitetsprompt.',
      });
    }

    if (idleMinutes !== null && idleMinutes > idleThreshold * 2) {
      const t = idleMinutes >= 60 ? `${Math.round(idleMinutes / 60)}t` : `${idleMinutes} min`;
      recs.push({
        priority: 'medium', type: 'activity',
        message: `Community-kanalen har vært stille i ${t}. Neste idle-prompt sendes automatisk.`,
      });
    }

    if (rewardRoles.length === 0 && diagnostics.communityAktiv) {
      recs.push({
        priority: 'low', type: 'reward',
        message: 'Ingen reward roles konfigurert — boten bruker standard LEVEL_ROLLER automatisk.',
      });
    }

    for (const m of topMembers7d.slice(0, 5)) {
      if (m.totalXp <= 0) continue;
      const nextMilestone = MILESTONE_LEVELS.find(lvl => lvl === m.level + 1);
      if (nextMilestone) {
        const xpToNext = nextMilestone * XP_PER_LEVEL - m.totalXp;
        if (xpToNext > 0 && xpToNext <= 80) {
          recs.push({
            priority: 'low', type: 'info',
            message: `${m.displayName} er ${xpToNext} XP unna Level ${nextMilestone} — vurder en hype-melding.`,
          });
          break;
        }
      }
    }

    recs.sort((a, b) => PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority]);

    return NextResponse.json({ health, topMembers7d, recentLevelUps, botActivity, recommendations: recs, diagnostics });

  } catch (err: any) {
    console.error('[community-manager/summary]', err?.message);
    return NextResponse.json(EMPTY_RESPONSE);
  }
}
