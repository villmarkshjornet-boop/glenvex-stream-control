import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getSettings } from '@/lib/settings';

async function hentSocials(): Promise<{ s: Record<string, string | undefined>; twitchUrl: string | undefined }> {
  const settings = getSettings();
  let s: Record<string, string | undefined> = { ...(settings.socials as any ?? {}) };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
  if (appUrl) {
    try {
      const url = appUrl.startsWith('http') ? appUrl : `https://${appUrl}`;
      const res = await fetch(`${url}/api/settings`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json() as Record<string, any>;
        if (data.socials) s = { ...s, ...(data.socials as Record<string, string | undefined>) };
      }
    } catch {}
  }

  return { s, twitchUrl: settings.twitchUrl };
}

export function byggSocialsEmbed(s: Record<string, string | undefined>, twitchUrl?: string): string[] {
  const links: string[] = [];
  if (s.twitch || twitchUrl) links.push(`🎮 **Twitch** – ${s.twitch || twitchUrl}`);
  if (s.tiktok) links.push(`📱 **TikTok** – ${s.tiktok}`);
  if (s.instagram) links.push(`📸 **Instagram** – ${s.instagram}`);
  if (s.twitter) links.push(`🐦 **Twitter/X** – ${s.twitter}`);
  if (s.youtube) links.push(`▶️ **YouTube** – ${s.youtube}`);
  if (s.discord) links.push(`💬 **Discord** – ${s.discord}`);
  return links;
}

export const socialsCommand = {
  data: new SlashCommandBuilder()
    .setName('socials')
    .setDescription('Viser alle sosiale medier for streameren.'),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    const { s, twitchUrl } = await hentSocials();
    const links = byggSocialsEmbed(s, twitchUrl);

    const embed = new EmbedBuilder()
      .setColor(0x00ff41)
      .setTitle('🔗 Finn oss overalt')
      .setDescription(
        links.length
          ? links.join('\n\n')
          : 'Ingen sosiale medier konfigurert ennå. Bruk dashboardet for å legge til lenker.'
      )
      .setFooter({ text: 'Stream Control' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};
