/**
 * roleManager.ts — LEGACY ROLE MANAGEMENT (DEPRECATED)
 *
 * Deprecated functions and their replacements:
 *
 *   finnEllerOpprettRolle()  →  DEPRECATED — creates Discord roles automatically.
 *                               Use configured role IDs from Community settings instead.
 *
 *   tildeltRolle()           →  DEPRECATED — falls back to auto-create roles by name.
 *                               Replace with: syncRankRole() from roleSyncService.ts
 *
 *   tildeltSpesialRolle()    →  DEPRECATED — auto-creates special roles.
 *                               Replace with: syncBadgeRole() / syncHeroRole() from roleSyncService.ts
 *
 * Migration plan:
 *   1. Configure Discord role IDs in the Dashboard → Community → Rank/Badge Roles section.
 *   2. roleSyncService.ts uses only configured IDs — never auto-creates.
 *   3. DO NOT delete these functions yet — they are still used by /setup (one-time init).
 *      Once all live flows are verified against roleSyncService, remove in a future PR.
 *
 * Functions that remain intentional (NOT deprecated):
 *   tildeltRolleKonfigurert() — the safe wrapper that uses configured IDs first.
 *   sjekkRollePermissions()   — utility, no role creation.
 */

import { Guild, GuildMember } from 'discord.js';
import { logSystemEvent } from './systemEvents';

export const LEVEL_ROLLER: { level: number; navn: string; farge: number }[] = [
  { level: 5,  navn: 'Active Member',   farge: 0x00aa44 },
  { level: 15, navn: 'Regular',         farge: 0x00aaff },
  { level: 30, navn: 'Veteran',         farge: 0xff8800 },
  { level: 50, navn: 'Community Hero',  farge: 0xffd700 },
];

// Spesialroller tildelt basert på aktivitet (ikke bare XP)
export const SPECIAL_ROLLER: Record<string, { navn: string; farge: number }> = {
  new_member:       { navn: 'New Member',       farge: 0x888888 },
  subscriber:       { navn: 'Subscriber',       farge: 0x9147ff },
  stream_supporter: { navn: 'Stream Supporter', farge: 0xff6600 },
  vip:              { navn: 'VIP',               farge: 0xffcc00 },
};

/**
 * @deprecated Auto-creates Discord roles by name. Use configured role IDs from
 * Community settings and roleSyncService.ts instead. Only kept for /setup command.
 */
async function finnEllerOpprettRolle(guild: Guild, navn: string, farge: number) {
  let rolle = guild.roles.cache.find(r => r.name === navn);
  if (!rolle) {
    console.warn(`[DEPRECATED] finnEllerOpprettRolle() auto-creating role "${navn}" — use roleSyncService with configured role IDs instead`);
    rolle = await guild.roles.create({
      name: navn,
      color: farge,
      reason: 'Community Intelligence – auto-opprettet',
    });
  }
  return rolle;
}

/**
 * @deprecated Auto-creates XP roles by name. Use syncRankRole() from roleSyncService.ts
 * with configured role IDs instead. Only called as last-resort fallback from tildeltRolleKonfigurert
 * when rewardRoles is empty — that fallback is now blocked. Kept for reference until migration complete.
 */
export async function tildeltRolle(guild: Guild, member: GuildMember, level: number): Promise<string | null> {
  console.warn(`[DEPRECATED] tildeltRolle() called for ${member.displayName} level ${level} — use roleSyncService instead`);
  const rolleConfig = [...LEVEL_ROLLER].reverse().find(r => level >= r.level);
  if (!rolleConfig) return null;

  try {
    const rolle = await finnEllerOpprettRolle(guild, rolleConfig.navn, rolleConfig.farge);

    const xpRolleNavn = LEVEL_ROLLER.map(r => r.navn);
    for (const gammelRolle of member.roles.cache.values()) {
      if (xpRolleNavn.includes(gammelRolle.name) && gammelRolle.name !== rolleConfig.navn) {
        await member.roles.remove(gammelRolle).catch(() => {});
      }
    }

    if (!member.roles.cache.has(rolle.id)) {
      await member.roles.add(rolle);
      logSystemEvent({
        source: 'role_manager',
        event_type: 'DISCORD_ROLE_ASSIGNED',
        title: `Rolle tildelt: ${member.displayName} → ${rolleConfig.navn}`,
        severity: 'info',
        metadata: { discordId: member.id, username: member.displayName, rolle: rolleConfig.navn, level },
      });
      return rolleConfig.navn;
    }
    return null;
  } catch (err: any) {
    logSystemEvent({
      source: 'role_manager',
      event_type: 'DISCORD_ROLE_ASSIGN_FAILED',
      title: `Rolle-tildeling feilet for ${member.displayName}: ${err.message?.slice(0, 80)}`,
      severity: 'error',
      metadata: { discordId: member.id, rolle: rolleConfig.navn, error: err.message?.slice(0, 200) },
    });
    return null;
  }
}

/**
 * @deprecated Auto-creates special Discord roles by name. Use syncBadgeRole() from
 * roleSyncService.ts with configured role IDs instead. Kept for guildMemberAdd
 * 'new_member' welcome flow until migrated.
 */
export async function tildeltSpesialRolle(
  guild: Guild,
  member: GuildMember,
  type: keyof typeof SPECIAL_ROLLER
): Promise<string | null> {
  console.warn(`[DEPRECATED] tildeltSpesialRolle() called for type="${type}" on ${member.displayName} — use roleSyncService instead`);
  const config = SPECIAL_ROLLER[type];
  if (!config) return null;

  try {
    const rolle = await finnEllerOpprettRolle(guild, config.navn, config.farge);
    if (!member.roles.cache.has(rolle.id)) {
      await member.roles.add(rolle);
      logSystemEvent({
        source: 'role_manager',
        event_type: 'DISCORD_ROLE_ASSIGNED',
        title: `Spesialrolle tildelt: ${member.displayName} → ${config.navn}`,
        severity: 'info',
        metadata: { discordId: member.id, username: member.displayName, rolle: config.navn, type },
      });
      return config.navn;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Configurable reward roles ────────────────────────────────────────────────

export interface RewardRole {
  level: number;
  roleId: string;
  roleName: string;
}

/**
 * Assign role by configured reward role (Discord role ID).
 * Falls back to default LEVEL_ROLLER behavior when rewardRoles is empty.
 * Logs COMMUNITY_REWARD_ROLE_MISSING if configured role ID doesn't exist in guild.
 */
export async function tildeltRolleKonfigurert(
  guild: Guild,
  member: GuildMember,
  level: number,
  rewardRoles: RewardRole[],
): Promise<{ rolleNavn: string | null }> {
  if (rewardRoles.length === 0) {
    // ROLE_AUTO_CREATE_BLOCKED: The old fallback called tildeltRolle() which used
    // guild.roles.create() to auto-create roles by name. This is incompatible with
    // roleSyncService which requires configured role IDs. Block the auto-create and
    // log so the operator knows to configure reward roles in Community settings.
    logSystemEvent({
      source:     'role_manager',
      event_type: 'ROLE_AUTO_CREATE_BLOCKED',
      title:      `Rolle-tildeling blokkert: rewardRoles er tom for ${member.displayName} (level ${level})`,
      severity:   'warning',
      metadata:   {
        discordId: member.id,
        username:  member.displayName,
        level,
        reason:    'rewardRoles not configured — auto-create disabled',
        fix:       'Configure reward role IDs in Dashboard → Community → Reward Roles',
      },
    });
    return { rolleNavn: null };
  }

  const matching = [...rewardRoles]
    .filter(r => level >= r.level)
    .sort((a, b) => b.level - a.level)[0];

  if (!matching) return { rolleNavn: null };

  const rolle = guild.roles.cache.get(matching.roleId);
  if (!rolle) {
    logSystemEvent({
      source:     'community_manager',
      event_type: 'COMMUNITY_REWARD_ROLE_MISSING',
      title:      `Reward-rolle ikke funnet i guild: "${matching.roleName}" (ID: ${matching.roleId})`,
      severity:   'warning',
      metadata:   { level, configuredRoleId: matching.roleId, roleName: matching.roleName, fix: 'Sjekk at Discord-rolle-ID er korrekt i Community-innstillinger' },
    });
    return { rolleNavn: null };
  }

  try {
    if (!member.roles.cache.has(rolle.id)) {
      await member.roles.add(rolle);
      logSystemEvent({
        source:     'community_manager',
        event_type: 'DISCORD_ROLE_ASSIGNED',
        title:      `Reward-rolle tildelt: ${member.displayName} → ${matching.roleName} (Level ${level})`,
        severity:   'info',
        metadata:   { discordId: member.id, username: member.displayName, rolle: matching.roleName, level },
      });
    }
    return { rolleNavn: matching.roleName };
  } catch (err: any) {
    logSystemEvent({
      source:     'community_manager',
      event_type: 'COMMUNITY_REWARD_ROLE_MISSING',
      title:      `Rolle-tildeling feilet for ${member.displayName}: ${err.message?.slice(0, 80)}`,
      severity:   'error',
      metadata:   { discordId: member.id, rolleId: matching.roleId, error: err.message?.slice(0, 200) },
    });
    return { rolleNavn: null };
  }
}

// Sjekk om boten har MANAGE_ROLES og at botens rolle er over rollene den tildeler
export async function sjekkRollePermissions(guild: Guild): Promise<{
  ok: boolean;
  manageRoles: boolean;
  botRolePos: number;
  issues: string[];
}> {
  const issues: string[] = [];
  const botMember = guild.members.me;
  if (!botMember) return { ok: false, manageRoles: false, botRolePos: 0, issues: ['Bot ikke i guild'] };

  const manageRoles = botMember.permissions.has('ManageRoles');
  if (!manageRoles) issues.push('Mangler MANAGE_ROLES permission');

  const botRolePos = botMember.roles.highest.position;
  const alleRolleNavn = [...LEVEL_ROLLER.map(r => r.navn), ...Object.values(SPECIAL_ROLLER).map(r => r.navn)];

  for (const navn of alleRolleNavn) {
    const rolle = guild.roles.cache.find(r => r.name === navn);
    if (rolle && rolle.position >= botRolePos) {
      issues.push(`Bot-rollen er UNDER "${navn}" (pos ${rolle.position} ≥ ${botRolePos}) – kan ikke tildele denne`);
    }
  }

  return { ok: issues.length === 0, manageRoles, botRolePos, issues };
}
