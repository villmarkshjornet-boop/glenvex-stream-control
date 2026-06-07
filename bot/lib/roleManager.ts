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

async function finnEllerOpprettRolle(guild: Guild, navn: string, farge: number) {
  let rolle = guild.roles.cache.find(r => r.name === navn);
  if (!rolle) {
    rolle = await guild.roles.create({
      name: navn,
      color: farge,
      reason: 'GLENVEX Community Intelligence – auto-opprettet',
    });
  }
  return rolle;
}

export async function tildeltRolle(guild: Guild, member: GuildMember, level: number): Promise<string | null> {
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

export async function tildeltSpesialRolle(
  guild: Guild,
  member: GuildMember,
  type: keyof typeof SPECIAL_ROLLER
): Promise<string | null> {
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
