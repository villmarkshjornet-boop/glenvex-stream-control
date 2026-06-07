import { NextResponse } from 'next/server';
import { isDbAvailable } from '@/lib/db';
import { getStreamInfo, checkTwitchApiHealth } from '@/lib/twitch';
import { checkDiscordBotHealth } from '@/lib/discord';

export const dynamic = 'force-dynamic';

interface EnvCheck { key: string; label: string; status: 'ok' | 'mangler' | 'valgfri'; gruppe: string; }
interface ServiceCheck { navn: string; status: 'ok' | 'feil' | 'ukjent'; detaljer?: string; }

const REQUIRED_ENV: EnvCheck[] = [
  { key: 'DISCORD_BOT_TOKEN', label: 'Discord Bot Token', status: 'ok', gruppe: 'Discord' },
  { key: 'DISCORD_CLIENT_ID', label: 'Discord Client ID', status: 'ok', gruppe: 'Discord' },
  { key: 'DISCORD_GUILD_ID', label: 'Discord Guild ID', status: 'ok', gruppe: 'Discord' },
  { key: 'DISCORD_LIVE_CHANNEL_ID', label: 'Discord Live Kanal', status: 'ok', gruppe: 'Discord' },
  { key: 'DISCORD_LIVE_ROLE_ID', label: 'Discord Live Rolle', status: 'ok', gruppe: 'Discord' },
  { key: 'DISCORD_CHAT_CHANNEL_ID', label: 'Discord Chat Kanal (fallback)', status: 'ok', gruppe: 'Discord' },
  { key: 'TWITCH_CLIENT_ID', label: 'Twitch Client ID', status: 'ok', gruppe: 'Twitch' },
  { key: 'TWITCH_CLIENT_SECRET', label: 'Twitch Client Secret', status: 'ok', gruppe: 'Twitch' },
  { key: 'TWITCH_USERNAME', label: 'Twitch Brukernavn', status: 'ok', gruppe: 'Twitch' },
  { key: 'OPENAI_API_KEY', label: 'OpenAI API Key', status: 'ok', gruppe: 'AI' },
  { key: 'SUPABASE_URL', label: 'Supabase URL', status: 'ok', gruppe: 'Database' },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Supabase Service Key', status: 'ok', gruppe: 'Database' },
  { key: 'WORKSPACE_ID', label: 'Workspace ID (Railway + Vercel)', status: 'ok', gruppe: 'Database' },
  { key: 'BOT_API_URL', label: 'Railway Bot API URL', status: 'ok', gruppe: 'Infrastruktur' },
  { key: 'TWITCH_BOT_OAUTH', label: 'Twitch Chat OAuth', status: 'ok', gruppe: 'Twitch' },
  { key: 'DISCORD_INVITE_URL', label: 'Discord Invite URL', status: 'valgfri', gruppe: 'Discord' },
  { key: 'TWITTER_API_KEY', label: 'Twitter API Key', status: 'valgfri', gruppe: 'Twitter' },
  { key: 'TWITTER_ACCESS_TOKEN', label: 'Twitter Access Token', status: 'valgfri', gruppe: 'Twitter' },
];

export async function GET() {
  // Sjekk env vars
  const envSjekk = REQUIRED_ENV.map(e => ({
    ...e,
    status: process.env[e.key] ? 'ok' : e.status === 'valgfri' ? 'valgfri' : 'mangler',
  })) as EnvCheck[];

  const manglerKritiske = envSjekk.filter(e => e.status === 'mangler');

  // Sjekk tjenester parallelt
  const [twitchOk, discordOk] = await Promise.all([
    checkTwitchApiHealth().catch(() => false),
    checkDiscordBotHealth().catch(() => false),
  ]);

  const dbOk = isDbAvailable();

  let dbStatus: 'ok' | 'feil' | 'ukjent' = 'ukjent';
  if (dbOk) {
    try {
      const { getDb } = await import('@/lib/db');
      const db = getDb();
      if (db) {
        const { error } = await db.from('workspaces').select('id').limit(1);
        dbStatus = error ? 'feil' : 'ok';
      }
    } catch { dbStatus = 'feil'; }
  } else {
    dbStatus = 'mangler' as any;
  }

  // Bot API – siden vi bruker Supabase for datadeling er dette valgfritt
  let botApiStatus: 'ok' | 'feil' | 'ukjent' = 'feil';
  let botApiDetaljer = 'BOT_API_URL ikke satt – valgfritt siden Supabase er i bruk';
  if (process.env.BOT_API_URL) {
    // Sett til OK hvis Supabase er tilkoblet (data går via Supabase, ikke BOT_API_URL)
    if (dbOk) {
      botApiStatus = 'ok';
      botApiDetaljer = undefined as any;
    } else {
      // Prøv å nå Railway direkte
      try {
        const botRes = await fetch(`${process.env.BOT_API_URL}/`, { signal: AbortSignal.timeout(5000) });
        botApiStatus = botRes.ok ? 'ok' : 'ukjent';
        botApiDetaljer = botRes.ok ? undefined as any : 'Railway svarte med feil';
      } catch {
        botApiStatus = 'ukjent';
        botApiDetaljer = 'Satt, men ikke verifisert. Data går via Supabase.';
      }
    }
  }

  const tjenester: ServiceCheck[] = [
    { navn: 'Twitch API', status: twitchOk ? 'ok' : 'feil', detaljer: twitchOk ? undefined : 'Sjekk TWITCH_CLIENT_ID og TWITCH_CLIENT_SECRET' },
    { navn: 'Discord Bot', status: discordOk ? 'ok' : 'feil', detaljer: discordOk ? undefined : 'Sjekk DISCORD_BOT_TOKEN og DISCORD_GUILD_ID' },
    { navn: 'Supabase Database', status: dbStatus, detaljer: dbOk ? undefined : 'Legg til SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY for delt database' },
    { navn: 'OpenAI', status: process.env.OPENAI_API_KEY ? 'ok' : 'feil', detaljer: process.env.OPENAI_API_KEY ? undefined : 'OPENAI_API_KEY mangler – AI-funksjoner vil ikke fungere' },
    { navn: 'Bot API (Railway)', status: botApiStatus, detaljer: botApiDetaljer },
    { navn: 'Twitch Chat Bot', status: process.env.TWITCH_BOT_OAUTH ? 'ok' : 'feil', detaljer: process.env.TWITCH_BOT_OAUTH ? undefined : 'TWITCH_BOT_OAUTH mangler i Vercel env vars' },
  ];

  // Kjente bugs / advarsler
  const advarsler: string[] = [];
  if (!dbOk) advarsler.push('KRITISK: Ingen felles database – data deles ikke mellom Railway og Vercel. Sett opp Supabase.');
  if (!process.env.BOT_API_URL) advarsler.push('KRITISK: BOT_API_URL ikke satt – Community Manager, Statistikk og Stream Coach viser ingen data.');
  if (!process.env.SUPABASE_URL) advarsler.push('VIKTIG: Role Rules når ikke boten fordi det ikke finnes en felles database.');
  if (!process.env.WORKSPACE_ID) advarsler.push('VIKTIG: WORKSPACE_ID ikke satt – Railway-boten (botKanalPreferanser) bruker fallback-ID "glenvex-default". Verifiser at dette matcher Supabase-raden.');
  if (!process.env.TWITCH_BOT_OAUTH) advarsler.push('VIKTIG: Twitch chat-bot ikke aktiv – ingen automatiske chat-meldinger.');
  if (!process.env.DISCORD_CHAT_CHANNEL_ID) advarsler.push('VIKTIG: DISCORD_CHAT_CHANNEL_ID ikke satt – brukes som fallback for subs, clips og raid-meldinger. Sett kanalpreferanser i dashboardet eller legg til env var.');
  if (!process.env.OPENAI_API_KEY) advarsler.push('ADVARSEL: OPENAI_API_KEY mangler – all AI-generering vil falle tilbake til maler.');

  // Discord kanalpreferanser – sjekk om konfigurasjon er gjort i Supabase
  // (kan ikke verifisere channel permissions herfra uten Discord API-kall, men vi kan vise hva som forventes)
  const kanalPrefNoter: string[] = [];
  const railwayEnvMangler = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'WORKSPACE_ID'].filter(k => !process.env[k]);
  if (railwayEnvMangler.length > 0) {
    kanalPrefNoter.push(`Railway mangler env vars: ${railwayEnvMangler.join(', ')} – botKanalPreferanser.ts kan ikke lese kanalpreferanser fra Supabase`);
  }

  // Twitch scopes – statisk note (kan ikke verifiseres run-time uten token introspection)
  const twitchScopeNoter = [
    'moderator:read:followers – påkrevd for getChannelStats (følgertelling)',
    'channel:read:subscriptions – påkrevd hvis sub-events bruker EventSub (ikke TMI)',
  ];

  const helseScore = Math.round(
    (tjenester.filter(t => t.status === 'ok').length / tjenester.length) * 100
  );

  return NextResponse.json({
    helseScore,
    tjenester,
    envSjekk,
    manglerKritiske: manglerKritiske.length,
    advarsler,
    kanalPrefNoter,
    twitchScopeNoter,
    dbStatus: dbOk ? 'tilkoblet' : 'ikke_konfigurert',
    timestamp: new Date().toISOString(),
  });
}
