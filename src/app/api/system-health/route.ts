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
  { key: 'DISCORD_CHAT_CHANNEL_ID', label: 'Discord Chat Kanal', status: 'ok', gruppe: 'Discord' },
  { key: 'TWITCH_CLIENT_ID', label: 'Twitch Client ID', status: 'ok', gruppe: 'Twitch' },
  { key: 'TWITCH_CLIENT_SECRET', label: 'Twitch Client Secret', status: 'ok', gruppe: 'Twitch' },
  { key: 'TWITCH_USERNAME', label: 'Twitch Brukernavn', status: 'ok', gruppe: 'Twitch' },
  { key: 'OPENAI_API_KEY', label: 'OpenAI API Key', status: 'ok', gruppe: 'AI' },
  { key: 'SUPABASE_URL', label: 'Supabase URL', status: 'ok', gruppe: 'Database' },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Supabase Service Key', status: 'ok', gruppe: 'Database' },
  { key: 'BOT_API_URL', label: 'Railway Bot API URL', status: 'ok', gruppe: 'Infrastruktur' },
  { key: 'TWITCH_BOT_OAUTH', label: 'Twitch Chat OAuth', status: 'ok', gruppe: 'Twitch' },
  { key: 'DISCORD_INVITE_URL', label: 'Discord Invite URL', status: 'ok', gruppe: 'Discord' },
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

  const tjenester: ServiceCheck[] = [
    { navn: 'Twitch API', status: twitchOk ? 'ok' : 'feil', detaljer: twitchOk ? undefined : 'Sjekk TWITCH_CLIENT_ID og TWITCH_CLIENT_SECRET' },
    { navn: 'Discord Bot', status: discordOk ? 'ok' : 'feil', detaljer: discordOk ? undefined : 'Sjekk DISCORD_BOT_TOKEN og DISCORD_GUILD_ID' },
    { navn: 'Supabase Database', status: dbStatus, detaljer: dbOk ? undefined : 'Legg til SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY for delt database' },
    { navn: 'OpenAI', status: process.env.OPENAI_API_KEY ? 'ok' : 'feil', detaljer: process.env.OPENAI_API_KEY ? undefined : 'OPENAI_API_KEY mangler – AI-funksjoner vil ikke fungere' },
    { navn: 'Bot API (Railway)', status: process.env.BOT_API_URL ? 'ukjent' : 'feil', detaljer: process.env.BOT_API_URL ? 'Satt, men ikke verifisert' : 'BOT_API_URL mangler – Community Manager og Statistikk viser ingen data' },
    { navn: 'Twitch Chat Bot', status: process.env.TWITCH_BOT_OAUTH ? 'ok' : 'feil', detaljer: process.env.TWITCH_BOT_OAUTH ? undefined : 'TWITCH_BOT_OAUTH mangler – Twitch chat-bot inaktiv' },
  ];

  // Kjente bugs / advarsler
  const advarsler: string[] = [];
  if (!dbOk) advarsler.push('KRITISK: Ingen felles database – data deles ikke mellom Railway og Vercel. Sett opp Supabase.');
  if (!process.env.BOT_API_URL) advarsler.push('KRITISK: BOT_API_URL ikke satt – Community Manager, Statistikk og Stream Coach viser ingen data.');
  if (!process.env.SUPABASE_URL) advarsler.push('VIKTIG: Role Rules når ikke boten fordi det ikke finnes en felles database.');
  if (!process.env.TWITCH_BOT_OAUTH) advarsler.push('VIKTIG: Twitch chat-bot ikke aktiv – ingen automatiske chat-meldinger.');
  if (!process.env.DISCORD_CHAT_CHANNEL_ID) advarsler.push('ADVARSEL: DISCORD_CHAT_CHANNEL_ID mangler – proaktive meldinger og partner-promo postes ikke.');
  if (!process.env.OPENAI_API_KEY) advarsler.push('ADVARSEL: OPENAI_API_KEY mangler – all AI-generering vil falle tilbake til maler.');

  const helseScore = Math.round(
    (tjenester.filter(t => t.status === 'ok').length / tjenester.length) * 100
  );

  return NextResponse.json({
    helseScore,
    tjenester,
    envSjekk,
    manglerKritiske: manglerKritiske.length,
    advarsler,
    dbStatus: dbOk ? 'tilkoblet' : 'ikke_konfigurert',
    timestamp: new Date().toISOString(),
  });
}
