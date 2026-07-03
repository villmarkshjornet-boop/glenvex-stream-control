/**
 * BadgeService — auto/manual/admin badge management.
 * H4ckerman (⚡) badge is admin-only with audit log.
 * All DB writes are fire-and-forget (never throw).
 */

import { getBotDb } from './supabase';

export interface BadgeDefinition {
  badgeKey:    string;
  badgeName:   string;
  badgeIcon:   string;
  badgeType:   'auto' | 'manual' | 'admin';
  description: string | null;
  autoRules:   Record<string, unknown> | null;
}

export interface MemberBadge {
  badgeKey:  string;
  badgeName: string;
  badgeIcon: string;
  awardedAt: string;
}

/** Built-in system badges seeded for each workspace. */
const SYSTEM_BADGES: Array<Omit<BadgeDefinition, 'autoRules'> & { autoRules: Record<string,unknown>|null }> = [
  { badgeKey: 'h4ckerman',   badgeName: 'H4ckerman',     badgeIcon: '⚡',  badgeType: 'admin',  description: 'Elite hacker of the community', autoRules: null },
  { badgeKey: 'veteran_1yr', badgeName: 'Veteran 1 år',  badgeIcon: '📅',  badgeType: 'auto',   description: 'Member for 1 year', autoRules: { type: 'days_since_join', threshold: 365 } },
  { badgeKey: 'veteran_2yr', badgeName: 'Veteran 2 år',  badgeIcon: '📆',  badgeType: 'auto',   description: 'Member for 2 years', autoRules: { type: 'days_since_join', threshold: 730 } },
  { badgeKey: 'sub_loyalty', badgeName: 'Sub Loyalist',  badgeIcon: '💜',  badgeType: 'auto',   description: '12+ months Twitch sub', autoRules: { type: 'twitch_sub_months', threshold: 12 } },
  { badgeKey: 'chatty',      badgeName: 'Chatty',         badgeIcon: '💬',  badgeType: 'auto',   description: '1000 messages', autoRules: { type: 'messages', threshold: 1000 } },
  { badgeKey: 'og',          badgeName: 'OG',             badgeIcon: '🏅',  badgeType: 'manual', description: 'Original community member', autoRules: null },
  { badgeKey: 'raider',      badgeName: 'Raider',         badgeIcon: '⚔️',   badgeType: 'auto',   description: 'Participated in 3+ raids', autoRules: { type: 'raids', threshold: 3 } },
];

export async function seedSystemBadges(workspaceId: string): Promise<void> {
  const db = getBotDb();
  if (!db) return;

  const rows = SYSTEM_BADGES.map(b => ({
    workspace_id: workspaceId,
    badge_key:    b.badgeKey,
    badge_name:   b.badgeName,
    badge_icon:   b.badgeIcon,
    badge_type:   b.badgeType,
    description:  b.description,
    auto_rules:   b.autoRules,
    is_active:    true,
  }));

  const { error } = await db
    .from('community_badges')
    .upsert(rows, { onConflict: 'workspace_id,badge_key', ignoreDuplicates: true });
  if (error) console.error('[BadgeService] seedSystemBadges failed:', error.message);
}

export async function getMemberBadges(workspaceId: string, discordId: string): Promise<MemberBadge[]> {
  const db = getBotDb();
  if (!db) return [];

  const { data, error } = await db
    .from('community_member_badges')
    .select('badge_key, awarded_at')
    .eq('workspace_id', workspaceId)
    .eq('discord_id', discordId)
    .order('awarded_at', { ascending: false });

  if (error || !data) return [];

  const keys = data.map(r => r.badge_key as string);
  if (keys.length === 0) return [];

  const { data: defs } = await db
    .from('community_badges')
    .select('badge_key,badge_name,badge_icon')
    .eq('workspace_id', workspaceId)
    .in('badge_key', keys);

  const defMap = new Map((defs ?? []).map(d => [d.badge_key as string, d]));

  return data.map(r => {
    const def = defMap.get(r.badge_key as string);
    return {
      badgeKey:  r.badge_key as string,
      badgeName: (def?.badge_name as string | undefined) ?? r.badge_key as string,
      badgeIcon: (def?.badge_icon as string | undefined) ?? '🏷️',
      awardedAt: r.awarded_at as string,
    };
  });
}

/** Awards a badge. For admin badges, also writes to system_events as audit log. */
export async function awardBadge(
  workspaceId: string,
  discordId:   string,
  badgeKey:    string,
  awardedBy:   string | null,
  note:        string | null,
): Promise<{ ok: boolean; alreadyHas: boolean; error?: string }> {
  const db = getBotDb();
  if (!db) return { ok: false, alreadyHas: false, error: 'no_db' };

  const { error } = await db
    .from('community_member_badges')
    .insert({ workspace_id: workspaceId, discord_id: discordId, badge_key: badgeKey, awarded_by: awardedBy, note });

  if (error) {
    if (error.code === '23505') return { ok: false, alreadyHas: true };
    console.error('[BadgeService] awardBadge failed:', error.message);
    return { ok: false, alreadyHas: false, error: error.message };
  }

  // Audit log for admin badges (especially H4ckerman)
  const { data: def } = await db
    .from('community_badges')
    .select('badge_type')
    .eq('workspace_id', workspaceId)
    .eq('badge_key', badgeKey)
    .maybeSingle();

  if ((def?.badge_type as string | null) === 'admin') {
    await db.from('system_events').insert({
      workspace_id: workspaceId,
      source:       'discord_bot',
      event_type:   'BADGE_ADMIN_AWARDED',
      title:        `Admin badge '${badgeKey}' awarded to ${discordId} by ${awardedBy ?? 'system'}`,
      severity:     'info',
      metadata:     { badgeKey, discordId, awardedBy, note },
    }).then(null, () => {});
  }

  return { ok: true, alreadyHas: false };
}

export async function revokeBadge(
  workspaceId: string,
  discordId:   string,
  badgeKey:    string,
  revokedBy:   string,
): Promise<{ ok: boolean }> {
  const db = getBotDb();
  if (!db) return { ok: false };

  const { error } = await db
    .from('community_member_badges')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('discord_id', discordId)
    .eq('badge_key', badgeKey);

  if (error) {
    console.error('[BadgeService] revokeBadge failed:', error.message);
    return { ok: false };
  }

  await db.from('system_events').insert({
    workspace_id: workspaceId,
    source:       'discord_bot',
    event_type:   'BADGE_REVOKED',
    title:        `Badge '${badgeKey}' revoked from ${discordId} by ${revokedBy}`,
    severity:     'info',
    metadata:     { badgeKey, discordId, revokedBy },
  }).then(null, () => {});

  return { ok: true };
}

/** Check auto-badge eligibility and award any that the member qualifies for. */
export async function checkAndAwardAutoBadges(
  workspaceId: string,
  discordId:   string,
  stats: {
    messages:        number;
    raids:           number;
    twitchSubMonths: number;
    daysSinceJoin:   number;
  },
): Promise<string[]> {
  const db = getBotDb();
  if (!db) return [];

  const { data: autoBadges } = await db
    .from('community_badges')
    .select('badge_key,auto_rules')
    .eq('workspace_id', workspaceId)
    .eq('badge_type', 'auto')
    .eq('is_active', true);

  if (!autoBadges) return [];

  const { data: existing } = await db
    .from('community_member_badges')
    .select('badge_key')
    .eq('workspace_id', workspaceId)
    .eq('discord_id', discordId);

  const owned = new Set((existing ?? []).map(r => r.badge_key as string));
  const newlyAwarded: string[] = [];

  for (const badge of autoBadges) {
    if (owned.has(badge.badge_key as string)) continue;
    const rules = badge.auto_rules as Record<string,unknown> | null;
    if (!rules) continue;

    const type      = rules.type as string;
    const threshold = rules.threshold as number;
    let qualifies   = false;

    if (type === 'messages'          && stats.messages        >= threshold) qualifies = true;
    if (type === 'raids'             && stats.raids           >= threshold) qualifies = true;
    if (type === 'twitch_sub_months' && stats.twitchSubMonths >= threshold) qualifies = true;
    if (type === 'days_since_join'   && stats.daysSinceJoin   >= threshold) qualifies = true;

    if (qualifies) {
      const { ok } = await awardBadge(workspaceId, discordId, badge.badge_key as string, null, 'auto-award');
      if (ok) newlyAwarded.push(badge.badge_key as string);
    }
  }

  return newlyAwarded;
}
