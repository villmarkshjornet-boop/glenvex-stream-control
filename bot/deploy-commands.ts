import { REST, Routes } from 'discord.js';
import { liveCommand } from './commands/live';
import { twitchCommand } from './commands/twitch';
import { promoCommand } from './commands/promo';
import { setupCommand } from './commands/setup';
import { statusCommand } from './commands/status';
import { socialsCommand } from './commands/socials';
import { clipCommand } from './commands/clip';
import { kanalerCommand } from './commands/kanaler';

const commands = [
  liveCommand.data.toJSON(),
  twitchCommand.data.toJSON(),
  promoCommand.data.toJSON(),
  setupCommand.data.toJSON(),
  statusCommand.data.toJSON(),
  socialsCommand.data.toJSON(),
  clipCommand.data.toJSON(),
  kanalerCommand.data.toJSON(),
];

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error('DISCORD_BOT_TOKEN og DISCORD_CLIENT_ID må settes i .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  console.log(`Registrerer ${commands.length} slash-kommandoer...`);

  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commands,
      });
      console.log(`✓ Kommandoer registrert på guild ${guildId} (øyeblikkelig)`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log('✓ Globale kommandoer registrert (effektiv om ~1 time)');
    }
  } catch (error) {
    console.error('✗ Feil ved registrering:', error);
  }
})();
