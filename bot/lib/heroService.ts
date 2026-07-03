/**
 * HeroService — automated daily Hero of Yesterday.
 * Selection based on community contribution, NOT just XP.
 * Contribution score = messages * 1 + reactions * 2 + voice_minutes * 0.5 + streams_attended * 3
 * Only members active in the last 24h are eligible.
 * One hero per workspace per day. Run via cron or after stream end.
 */

import { getBotDb } from './supabase';

export interface HeroResult {
  discordId:         string;
  contributionScore: number;
  heroDate:          string;
  alreadyExists:     boolean;
}

export async function selectDailyHero(workspaceId: string): Promise<HeroResult | null> {
  const db = getBotDb();
  if (!db) return null;

  const today = new Date().toISOString().slice(0, 10);

  // Check if hero already selected today
  const { data: existing } = await db
    .from('community_hero')
    .select('discord_id,contribution_score')
    .eq('workspace_id', workspaceId)
    .eq('hero_date', today)
    .maybeSingle();

  if (existing) {
    return {
      discordId:         existing.discord_id as string,
      contributionScore: existing.contribution_score as number,
      heroDate:          today,
      alreadyExists:     true,
    };
  }

  // Find top contributor from last 24h activity
  const yesterday = new Date(Date.now() - 86400000).toISOString();

  const { data: members, error } = await db
    .from('community_members')
    .select('discord_id,messages_discord,reactions,voice_minutes,streams_attended,last_discord_activity_at')
    .eq('workspace_id', workspaceId)
    .gte('last_discord_activity_at', yesterday)
    .gt('messages_discord', 0);

  if (error || !members || members.length === 0) {
    console.log(`[HeroService] No active members found for ${workspaceId}`);
    return null;
  }

  // Score each member
  let topScore  = -1;
  let topMember = '';

  for (const m of members) {
    const score = Math.round(
      (m.messages_discord as number)  * 1   +
      (m.reactions as number)          * 2   +
      (m.voice_minutes as number)      * 0.5 +
      (m.streams_attended as number)   * 3,
    );
    if (score > topScore) {
      topScore  = score;
      topMember = m.discord_id as string;
    }
  }

  if (!topMember) return null;

  // Write hero record
  const { error: insertErr } = await db.from('community_hero').insert({
    workspace_id:       workspaceId,
    discord_id:         topMember,
    hero_date:          today,
    contribution_score: topScore,
    selection_metadata: { eligible_count: members.length },
  });

  if (insertErr) {
    console.error('[HeroService] insert failed:', insertErr.message);
    return null;
  }

  // Increment hero_count directly (read-then-write)
  const { data: currentMember } = await db
    .from('community_members')
    .select('hero_count')
    .eq('workspace_id', workspaceId)
    .eq('discord_id', topMember)
    .maybeSingle();

  await db
    .from('community_members')
    .update({ hero_count: ((currentMember?.hero_count as number | null) ?? 0) + 1 })
    .eq('workspace_id', workspaceId)
    .eq('discord_id', topMember);

  // Log to system_events
  await db.from('system_events').insert({
    workspace_id: workspaceId,
    source:       'discord_bot',
    event_type:   'HERO_SELECTED',
    title:        `Hero of the Day: ${topMember} (score: ${topScore})`,
    severity:     'info',
    metadata:     { discordId: topMember, contributionScore: topScore, heroDate: today },
  }).catch(() => {});

  return { discordId: topMember, contributionScore: topScore, heroDate: today, alreadyExists: false };
}

export async function getHeroForDate(workspaceId: string, date?: string): Promise<HeroResult | null> {
  const db = getBotDb();
  if (!db) return null;

  const targetDate = date ?? new Date().toISOString().slice(0, 10);

  const { data, error } = await db
    .from('community_hero')
    .select('discord_id,contribution_score,hero_date')
    .eq('workspace_id', workspaceId)
    .eq('hero_date', targetDate)
    .maybeSingle();

  if (error || !data) return null;

  return {
    discordId:         data.discord_id as string,
    contributionScore: data.contribution_score as number,
    heroDate:          data.hero_date as string,
    alreadyExists:     true,
  };
}

export async function markHeroAnnounced(workspaceId: string, heroDate: string): Promise<void> {
  const db = getBotDb();
  if (!db) return;
  await db
    .from('community_hero')
    .update({ announced_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('hero_date', heroDate);
}

export async function isHeroEnabled(workspaceId: string): Promise<boolean> {
  const db = getBotDb();
  if (!db) return true;
  const { data } = await db
    .from('workspace_feature_flags')
    .select('hero_enabled')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return (data?.hero_enabled as boolean | null) ?? true;
}
