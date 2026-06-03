import { Guild, GuildMember } from 'discord.js';

export const LEVEL_ROLLER: { level: number; navn: string; farge: number }[] = [
  { level: 5,  navn: 'Aktiv',   farge: 0x00aa44 },
  { level: 10, navn: 'Erfaren', farge: 0x00aaff },
  { level: 25, navn: 'Veteran', farge: 0xff8800 },
  { level: 50, navn: 'Legend',  farge: 0xffd700 },
];

export async function tildeltRolle(guild: Guild, member: GuildMember, level: number): Promise<string | null> {
  const rolleConfig = [...LEVEL_ROLLER].reverse().find(r => level >= r.level);
  if (!rolleConfig) return null;

  try {
    // Finn eller opprett rollen
    let rolle = guild.roles.cache.find(r => r.name === rolleConfig.navn);
    if (!rolle) {
      rolle = await guild.roles.create({
        name: rolleConfig.navn,
        color: rolleConfig.farge,
        reason: 'GLENVEX XP System – auto-opprettet',
      });
    }

    // Fjern gamle XP-roller
    const xpRolleNavn = LEVEL_ROLLER.map(r => r.navn);
    for (const gammelRolle of member.roles.cache.values()) {
      if (xpRolleNavn.includes(gammelRolle.name) && gammelRolle.name !== rolleConfig.navn) {
        await member.roles.remove(gammelRolle).catch(() => {});
      }
    }

    // Legg til ny rolle
    if (!member.roles.cache.has(rolle.id)) {
      await member.roles.add(rolle);
      return rolleConfig.navn;
    }
    return null;
  } catch {
    return null;
  }
}
