/**
 * PrestigeService — level reset at 100.
 * Resets XP to 0, level to 1. Preserves coins, badges, reputation.
 * History stored in community_prestige_log.
 * Prestige shown as ⭐I, ⭐⭐II etc.
 */

import { getBotDb } from './supabase';

export interface PrestigeResult {
  ok:            boolean;
  prestigeLevel: number;
  error?:        string;
}

export async function performPrestige(
  workspaceId: string,
  discordId:   string,
): Promise<PrestigeResult> {
  const db = getBotDb();
  if (!db) return { ok: false, prestigeLevel: 0, error: 'no_db' };

  // Verify level 100
  const { data: member, error: fetchErr } = await db
    .from('community_members')
    .select('level,xp,prestige_level')
    .eq('workspace_id', workspaceId)
    .eq('discord_id', discordId)
    .maybeSingle();

  if (fetchErr || !member) {
    return { ok: false, prestigeLevel: 0, error: 'member_not_found' };
  }

  if ((member.level as number) < 100) {
    return { ok: false, prestigeLevel: member.prestige_level as number, error: 'not_level_100' };
  }

  const currentPrestige = (member.prestige_level as number) ?? 0;
  const newPrestige = currentPrestige + 1;

  // Write prestige log
  await db.from('community_prestige_log').insert({
    workspace_id:   workspaceId,
    discord_id:     discordId,
    prestige_level: newPrestige,
    level_at_reset: member.level as number,
    xp_at_reset:    member.xp as number,
  });

  // Reset level and XP, increment prestige
  const { error: updateErr } = await db
    .from('community_members')
    .update({
      level:          1,
      xp:             0,
      prestige_level: newPrestige,
      updated_at:     new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('discord_id', discordId);

  if (updateErr) {
    console.error('[PrestigeService] reset failed:', updateErr.message);
    return { ok: false, prestigeLevel: currentPrestige, error: updateErr.message };
  }

  // Log to system_events
  await db.from('system_events').insert({
    workspace_id: workspaceId,
    source:       'discord_bot',
    event_type:   'PRESTIGE_ACHIEVED',
    title:        `${discordId} achieved Prestige ${newPrestige}`,
    severity:     'info',
    metadata:     { discordId, prestigeLevel: newPrestige, levelAtReset: member.level, xpAtReset: member.xp },
  }).catch(() => {});

  return { ok: true, prestigeLevel: newPrestige };
}

export async function getPrestigeHistory(
  workspaceId: string,
  discordId:   string,
): Promise<Array<{ prestigeLevel: number; levelAtReset: number; prestigedAt: string }>> {
  const db = getBotDb();
  if (!db) return [];

  const { data, error } = await db
    .from('community_prestige_log')
    .select('prestige_level,level_at_reset,prestiged_at')
    .eq('workspace_id', workspaceId)
    .eq('discord_id', discordId)
    .order('prestige_level', { ascending: true });

  if (error || !data) return [];

  return data.map(r => ({
    prestigeLevel: r.prestige_level as number,
    levelAtReset:  r.level_at_reset as number,
    prestigedAt:   r.prestiged_at as string,
  }));
}

/** Check if feature is enabled for this workspace. */
export async function isPrestigeEnabled(workspaceId: string): Promise<boolean> {
  const db = getBotDb();
  if (!db) return true;
  const { data } = await db
    .from('workspace_feature_flags')
    .select('prestige_enabled')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return (data?.prestige_enabled as boolean | null) ?? true;
}
