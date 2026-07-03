/**
 * RoleSyncService — bridges rank/badge/hero state to Discord roles.
 *
 * Rules:
 * - Member always has exactly ONE rank role (swapped on level-up).
 * - H4ckerman role is granted by admin command, revoked on revoke command.
 * - Hero of Yesterday role swaps: removed from previous hero, given to new.
 * - Twitch Sub role: granted on sub event, uses configured role ID or name fallback.
 * - Missing role_id config → logs ROLE_MAPPING_MISSING, does NOT throw.
 * - Missing Manage Roles permission → logs ROLE_SYNC_PERMISSION_DENIED.
 * - All DB/Discord calls are fire-and-forget safe (never unhandled rejections).
 */

import { Guild, GuildMember } from 'discord.js';
import { RankRoles, BadgeRoles } from './botKanalPreferanser';
import { getBotDb } from './supabase';
import { getRankForLevel } from './rankService';
import { logSystemEvent } from './systemEvents';

const RANK_NAME_TO_KEY: Record<string, keyof RankRoles> = {
  Noob:     'noob',
  Rookie:   'rookie',
  Explorer: 'explorer',
  Survivor: 'survivor',
  Veteran:  'veteran',
  Elite:    'elite',
  Legend:   'legend',
  Mythic:   'mythic',
};

const ALL_RANK_KEYS: Array<keyof RankRoles> = [
  'noob', 'rookie', 'explorer', 'survivor', 'veteran', 'elite', 'legend', 'mythic',
];

// ─── Rank role sync ───────────────────────────────────────────────────────────

/**
 * Ensures member has exactly the rank role that matches their level.
 * Removes all other rank roles first, then grants the new one.
 */
export async function syncRankRole(
  guild:       Guild,
  member:      GuildMember,
  level:       number,
  workspaceId: string,
  rankRoles:   RankRoles,
): Promise<void> {
  const rankInfo = await getRankForLevel(workspaceId, level);
  const rankKey  = RANK_NAME_TO_KEY[rankInfo.rankName];
  const newRoleId = rankKey ? rankRoles[rankKey] : undefined;

  if (!newRoleId) {
    logSystemEvent({
      workspaceId,
      source:     'role_sync',
      event_type: 'ROLE_MAPPING_MISSING',
      title:      `Rank role not configured: ${rankInfo.rankName} (level ${level})`,
      severity:   'warning',
      metadata:   { rankName: rankInfo.rankName, level, fix: 'Configure rank role IDs in Discord Role Sync settings' },
    });
    return;
  }

  // Remove all other rank roles the member currently holds
  for (const key of ALL_RANK_KEYS) {
    const roleId = rankRoles[key];
    if (roleId && roleId !== newRoleId && member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId).catch(() => {});
    }
  }

  if (member.roles.cache.has(newRoleId)) return; // already correct

  const role = guild.roles.cache.get(newRoleId);
  if (!role) {
    logSystemEvent({
      workspaceId,
      source:     'role_sync',
      event_type: 'ROLE_MAPPING_MISSING',
      title:      `Rank role ID not found in guild: ${newRoleId} (${rankInfo.rankName})`,
      severity:   'warning',
      metadata:   { rankName: rankInfo.rankName, roleId: newRoleId },
    });
    return;
  }

  await member.roles.add(role, `Rank sync – Level ${level} → ${rankInfo.rankName}`).catch((err: Error) => {
    logSystemEvent({
      workspaceId,
      source:     'role_sync',
      event_type: 'ROLE_SYNC_PERMISSION_DENIED',
      title:      `Could not assign rank role ${rankInfo.rankName}: ${err.message.slice(0, 120)}`,
      severity:   'error',
      metadata:   { rankName: rankInfo.rankName, roleId: newRoleId, userId: member.id },
    });
  });

  logSystemEvent({
    workspaceId,
    source:     'role_sync',
    event_type: 'RANK_ROLE_SYNCED',
    title:      `Rank role synced: ${member.displayName} → ${rankInfo.rankName} (Level ${level})`,
    severity:   'info',
    metadata:   { discordId: member.id, rankName: rankInfo.rankName, level, roleId: newRoleId },
  });
}

// ─── Badge role sync ──────────────────────────────────────────────────────────

/**
 * Grants or revokes a single badge role for a member.
 * badgeKey must match a key in BadgeRoles (h4ckerman, hero_yesterday, twitch_sub).
 */
export async function syncBadgeRole(
  guild:       Guild,
  member:      GuildMember,
  badgeKey:    keyof BadgeRoles,
  badgeRoles:  BadgeRoles,
  grant:       boolean,
  workspaceId: string,
): Promise<void> {
  const roleId = badgeRoles[badgeKey];
  if (!roleId) {
    logSystemEvent({
      workspaceId,
      source:     'role_sync',
      event_type: 'ROLE_MAPPING_MISSING',
      title:      `Badge role not configured: ${badgeKey}`,
      severity:   'warning',
      metadata:   { badgeKey, fix: 'Configure badge role IDs in Discord Role Sync settings' },
    });
    return;
  }

  const role = guild.roles.cache.get(roleId);
  if (!role) {
    logSystemEvent({
      workspaceId,
      source:     'role_sync',
      event_type: 'ROLE_MAPPING_MISSING',
      title:      `Badge role ID not found in guild: ${roleId} (${badgeKey})`,
      severity:   'warning',
      metadata:   { badgeKey, roleId },
    });
    return;
  }

  if (grant && !member.roles.cache.has(roleId)) {
    await member.roles.add(role, `Badge sync: ${badgeKey}`).catch((err: Error) => {
      logSystemEvent({
        workspaceId,
        source:     'role_sync',
        event_type: 'ROLE_SYNC_PERMISSION_DENIED',
        title:      `Could not assign badge role ${badgeKey}: ${err.message.slice(0, 120)}`,
        severity:   'error',
        metadata:   { badgeKey, roleId, userId: member.id },
      });
    });
  } else if (!grant && member.roles.cache.has(roleId)) {
    await member.roles.remove(role, `Badge revoke: ${badgeKey}`).catch((err: Error) => {
      logSystemEvent({
        workspaceId,
        source:     'role_sync',
        event_type: 'ROLE_SYNC_PERMISSION_DENIED',
        title:      `Could not remove badge role ${badgeKey}: ${err.message.slice(0, 120)}`,
        severity:   'error',
        metadata:   { badgeKey, roleId, userId: member.id },
      });
    });
  }
}

// ─── Hero of Yesterday role ───────────────────────────────────────────────────

/**
 * Swaps the Hero of Yesterday role:
 * - Removes from previous hero (if different and still in guild).
 * - Grants to the new hero.
 */
export async function syncHeroRole(
  guild:             Guild,
  newHeroDiscordId:  string,
  prevHeroDiscordId: string | null,
  heroRoleId:        string,
  workspaceId:       string,
): Promise<void> {
  const role = guild.roles.cache.get(heroRoleId);
  if (!role) {
    logSystemEvent({
      workspaceId,
      source:     'role_sync',
      event_type: 'ROLE_MAPPING_MISSING',
      title:      `Hero role ID not found in guild: ${heroRoleId}`,
      severity:   'warning',
      metadata:   { roleId: heroRoleId },
    });
    return;
  }

  // Remove from previous hero
  if (prevHeroDiscordId && prevHeroDiscordId !== newHeroDiscordId) {
    const prev = await guild.members.fetch(prevHeroDiscordId).catch(() => null);
    if (prev?.roles.cache.has(heroRoleId)) {
      await prev.roles.remove(role, 'Hero of Yesterday – old hero').catch(() => {});
    }
  }

  // Grant to new hero
  const newMember = await guild.members.fetch(newHeroDiscordId).catch(() => null);
  if (newMember && !newMember.roles.cache.has(heroRoleId)) {
    await newMember.roles.add(role, 'Hero of Yesterday').catch((err: Error) => {
      logSystemEvent({
        workspaceId,
        source:     'role_sync',
        event_type: 'ROLE_SYNC_PERMISSION_DENIED',
        title:      `Could not assign hero role: ${err.message.slice(0, 120)}`,
        severity:   'error',
        metadata:   { roleId: heroRoleId, userId: newHeroDiscordId },
      });
    });
  }
}

// ─── Periodic full repair ─────────────────────────────────────────────────────

let repairInProgress = false;

/**
 * Reads all active community members from DB, syncs their rank roles
 * and h4ckerman badge role. Designed to run every 30–60 min.
 * Skips members not currently in the guild (they'll sync on next message).
 */
export async function repairAllRoles(
  workspaceId: string,
  guild:       Guild,
  rankRoles:   RankRoles,
  badgeRoles:  BadgeRoles,
): Promise<{ repaired: number; errors: number }> {
  if (repairInProgress) {
    console.log('[RoleSync] repairAllRoles already in progress — skipping concurrent run');
    return { repaired: 0, errors: 0 };
  }
  repairInProgress = true;

  const db = getBotDb();
  if (!db) { repairInProgress = false; return { repaired: 0, errors: 0 }; }

  const { data: members } = await db
    .from('community_members')
    .select('discord_id,level')
    .eq('workspace_id', workspaceId)
    .gt('level', 0);

  if (!members || members.length === 0) return { repaired: 0, errors: 0 };

  let repaired = 0;
  let errors   = 0;

  for (const m of members) {
    const discordId = m.discord_id as string;
    const level     = m.level as number;

    const guildMember = await guild.members.fetch(discordId).catch(() => null);
    if (!guildMember) continue; // not in guild — skip silently

    try {
      await syncRankRole(guild, guildMember, level, workspaceId, rankRoles);

      // Sync h4ckerman badge role
      if (badgeRoles.h4ckerman) {
        const { data: badge } = await db
          .from('community_member_badges')
          .select('badge_key', { count: 'exact', head: true })
          .eq('workspace_id', workspaceId)
          .eq('discord_id', discordId)
          .eq('badge_key', 'h4ckerman')
          .maybeSingle();

        await syncBadgeRole(guild, guildMember, 'h4ckerman', badgeRoles, !!badge, workspaceId);
      }

      repaired++;
    } catch {
      errors++;
    }
  }

  repairInProgress = false;

  logSystemEvent({
    workspaceId,
    source:     'role_sync',
    event_type: 'ROLE_SYNC_REPAIR_COMPLETE',
    title:      `Role repair complete: ${repaired} synced, ${errors} errors`,
    severity:   'info',
    metadata:   { workspaceId, repaired, errors, guildId: guild.id },
  });

  return { repaired, errors };
}
