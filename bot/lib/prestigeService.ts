/**
 * PrestigeService — prestige reset and history.
 *
 * Rules:
 *  - Member must be level 100 (24750+ XP at 250 XP/level).
 *  - On prestige: XP and level reset to 0/1; prestige_level increments.
 *  - Coins, badges, and reputation are preserved.
 *  - Each prestige event is recorded in community_prestige_history.
 *  - All DB calls are fire-safe (non-throwing).
 */

import { getBotDb } from './supabase';
import { awardCoins } from './coinService';

/** XP required to be level 100 (using the same formula as src/lib/xp.ts: level = floor(xp/250)+1). */
const XP_FOR_LEVEL_100 = 99 * 250; // 24 750

export type PrestigeResult =
  | { ok: true;  prestigeLevel: number }
  | { ok: false; error: 'not_level_100' | 'member_not_found' | string };

export async function isPrestigeEnabled(workspaceId: string): Promise<boolean> {
  const db = getBotDb();
  if (!db) return false;
  const { data } = await db
    .from('workspace_feature_flags')
    .select('prestige_enabled')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  // Default to enabled if the flag row doesn't exist
  return (data?.prestige_enabled as boolean | null) !== false;
}

export async function performPrestige(
  workspaceId: string,
  discordId:   string,
): Promise<PrestigeResult> {
  const db = getBotDb();
  if (!db) return { ok: false, error: 'DB ikke tilgjengelig' };

  // Load member
  const { data: member, error: fetchErr } = await db
    .from('community_members')
    .select('xp,level,prestige_level,coins_balance')
    .eq('workspace_id', workspaceId)
    .eq('discord_id', discordId)
    .maybeSingle();

  if (fetchErr) {
    console.error('[PrestigeService] fetchMember failed:', fetchErr.message);
    return { ok: false, error: fetchErr.message };
  }
  if (!member) return { ok: false, error: 'member_not_found' };

  const currentXp      = (member.xp as number | null) ?? 0;
  const currentPrestige = (member.prestige_level as number | null) ?? 0;

  if (currentXp < XP_FOR_LEVEL_100) {
    return { ok: false, error: 'not_level_100' };
  }

  const newPrestigeLevel = currentPrestige + 1;

  // Reset XP and level; increment prestige
  const { error: updateErr } = await db
    .from('community_members')
    .update({
      xp:             0,
      level:          1,
      prestige_level: newPrestigeLevel,
      updated_at:     new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('discord_id', discordId);

  if (updateErr) {
    console.error('[PrestigeService] update failed:', updateErr.message);
    return { ok: false, error: updateErr.message };
  }

  // Record prestige history
  const { error: histErr } = await db.from('community_prestige_history').insert({
    workspace_id:   workspaceId,
    discord_id:     discordId,
    prestige_level: newPrestigeLevel,
    xp_at_prestige: currentXp,
    prestiged_at:   new Date().toISOString(),
  });
  if (histErr) console.error('[PrestigeService] history insert failed:', histErr.message);

  // Award prestige bonus coins (500 base, scales with prestige level)
  const bonusCoins = 500 * newPrestigeLevel;
  await awardCoins(discordId, bonusCoins, 'achievement_card', {
    workspaceId,
    reason:        'prestige_bonus',
    prestigeLevel: newPrestigeLevel,
  });

  return { ok: true, prestigeLevel: newPrestigeLevel };
}

export interface PrestigeRecord {
  prestigeLevel: number;
  xpAtPrestige:  number;
  prestigedAt:   string;
}

export async function getPrestigeHistory(
  workspaceId: string,
  discordId:   string,
): Promise<PrestigeRecord[]> {
  const db = getBotDb();
  if (!db) return [];

  const { data, error } = await db
    .from('community_prestige_history')
    .select('prestige_level,xp_at_prestige,prestiged_at')
    .eq('workspace_id', workspaceId)
    .eq('discord_id', discordId)
    .order('prestiged_at', { ascending: false });

  if (error) {
    console.error('[PrestigeService] getPrestigeHistory failed:', error.message);
    return [];
  }

  return (data ?? []).map(r => ({
    prestigeLevel: r.prestige_level as number,
    xpAtPrestige:  r.xp_at_prestige as number,
    prestigedAt:   r.prestiged_at as string,
  }));
}
