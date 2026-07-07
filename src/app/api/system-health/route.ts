import { NextResponse } from 'next/server';
import { isDbAvailable, getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { checkTwitchApiHealth } from '@/lib/twitch';
import { checkDiscordBotHealth } from '@/lib/discord';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

interface EnvCheck { key: string; label: string; status: 'ok' | 'mangler' | 'valgfri'; gruppe: string; }
interface ServiceCheck { navn: string; status: 'ok' | 'feil' | 'ukjent'; detaljer?: string; }

export interface SystemCheck {
  status: 'ok' | 'warning' | 'error' | 'unknown';
  message: string;
  lastSeen?: string;
  scopes?: string[];
}

export interface SystemChecks {
  workspace: SystemCheck;
  twitchOAuth: SystemCheck;
  discordOAuth: SystemCheck;
  discordBot: SystemCheck;
  railwayBot: SystemCheck;
  creatorBrain: SystemCheck;
  aiProducer: SystemCheck;
  communityManager: SystemCheck;
  pollManager: SystemCheck;
  xpSystem: SystemCheck;
  partnerEngine: SystemCheck;
  learningEngine: SystemCheck;
  contentFactory: SystemCheck;
  streamCoach: SystemCheck;
}

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

// ── System-check helpers ──────────────────────────────────────────────────────

function minutesAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

function hoursAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
}

function pluralTimer(n: number, unit: 'min' | 'time' | 'dag'): string {
  if (unit === 'min')  return `for ${n} min siden`;
  if (unit === 'time') return `for ${n} time${n === 1 ? '' : 'r'} siden`;
  return `for ${n} dag${n === 1 ? '' : 'er'} siden`;
}

type DbClient = NonNullable<ReturnType<typeof getDb>>;

/** Returns the most recent created_at (ISO string) matching the given filter, or null. */
async function latestEventAt(
  db: DbClient,
  workspaceId: string,
  cutoffIso: string,
  opts: {
    source?: string;
    eventType?: string;
    orFilter?: string;
    eventTypeLike?: string;
  },
): Promise<string | null> {
  let q = db
    .from('system_events')
    .select('created_at')
    .eq('workspace_id', workspaceId)
    .gte('created_at', cutoffIso);

  if (opts.orFilter) {
    q = (q as any).or(opts.orFilter);
  } else {
    if (opts.source)        q = q.eq('source', opts.source);
    if (opts.eventType)     q = q.eq('event_type', opts.eventType);
    if (opts.eventTypeLike) q = (q as any).ilike('event_type', opts.eventTypeLike);
  }

  const { data } = await (q as any)
    .order('created_at', { ascending: false })
    .limit(1);

  return (data as any)?.[0]?.created_at ?? null;
}

async function computeSystemChecks(workspaceId: string): Promise<SystemChecks> {
  const db = getDb();

  if (!db) {
    const u = (msg: string): SystemCheck => ({ status: 'unknown', message: msg });
    const dbMsg = 'Database ikke tilkoblet';
    return {
      workspace: u(dbMsg), twitchOAuth: u(dbMsg), discordOAuth: u(dbMsg),
      discordBot: u(dbMsg), railwayBot: u(dbMsg), creatorBrain: u(dbMsg),
      aiProducer: u(dbMsg), communityManager: u(dbMsg), pollManager: u(dbMsg),
      xpSystem: u(dbMsg), partnerEngine: u(dbMsg), learningEngine: u(dbMsg),
      contentFactory: u(dbMsg), streamCoach: u(dbMsg),
    };
  }

  const now  = Date.now();
  const cut15m = new Date(now - 15 * 60_000).toISOString();
  const cut24h = new Date(now - 24 * 3_600_000).toISOString();
  const cut48h = new Date(now - 48 * 3_600_000).toISOString();
  const cut72h = new Date(now - 72 * 3_600_000).toISOString();

  const [
    wsRes,
    discordHB,
    railwayHB,
    creatorBrainEv,
    aiProducerEv,
    communityEv,
    pollEv,
    xpEv,
    partnerEv,
    learningEv,
    contentEv,
    streamCoachEv,
  ] = await Promise.all([
    db.from('workspaces')
      .select('id,alpha_enabled,onboarding_completed_at,twitch_connected_at,twitch_access_token,discord_guild_id,discord_connected_at')
      .eq('id', workspaceId)
      .single(),

    latestEventAt(db, workspaceId, cut15m, { source: 'discord_bot', eventType: 'HEARTBEAT' }),
    latestEventAt(db, workspaceId, cut15m, { source: 'twitch_bot',  eventType: 'HEARTBEAT' }),

    latestEventAt(db, workspaceId, cut24h, {
      orFilter: 'event_type.eq.CREATOR_KNOWLEDGE_UPDATED,event_type.eq.LEARNING_STARTED',
    }),

    latestEventAt(db, workspaceId, cut24h, { source: 'ai_producer' }),

    latestEventAt(db, workspaceId, cut48h, {
      orFilter: 'source.eq.community_manager,event_type.ilike.COMMUNITY_%',
    }),

    latestEventAt(db, workspaceId, cut48h, { eventTypeLike: 'POLL_%' }),

    latestEventAt(db, workspaceId, cut48h, {
      orFilter: 'source.eq.xp_system,event_type.ilike.XP_%',
    }),

    latestEventAt(db, workspaceId, cut48h, { source: 'partner_bot' }),
    latestEventAt(db, workspaceId, cut24h, { source: 'learning_engine' }),
    latestEventAt(db, workspaceId, cut48h, { source: 'content_factory' }),

    latestEventAt(db, workspaceId, cut72h, {
      orFilter: 'event_type.eq.STREAM_COACH_LEARNING_SAVED,source.eq.stream_coach',
    }),
  ]);

  const ws = wsRes.data as any;

  // ── Workspace ──────────────────────────────────────────────────────────────
  const workspace: SystemCheck = (() => {
    if (!ws) return { status: 'error', message: 'Workspace ikke funnet — opprett workspace i onboarding' };
    if (!ws.alpha_enabled) return { status: 'warning', message: 'Alpha ikke aktivert for dette workspace' };
    if (!ws.onboarding_completed_at) return { status: 'warning', message: 'Onboarding ikke fullført — gå gjennom oppsettveiviseren' };
    return { status: 'ok', message: 'Workspace er satt opp og aktivert', lastSeen: ws.onboarding_completed_at };
  })();

  // ── Twitch OAuth ───────────────────────────────────────────────────────────
  const twitchOAuth: SystemCheck = (() => {
    if (!ws) return { status: 'unknown', message: 'Workspace ikke funnet' };
    if (!ws.twitch_access_token || !ws.twitch_connected_at) {
      return { status: 'error', message: 'Twitch ikke koblet — gå til Innstillinger og koble til Twitch' };
    }
    return { status: 'ok', message: 'Twitch er koblet til', lastSeen: ws.twitch_connected_at };
  })();

  // ── Discord OAuth ──────────────────────────────────────────────────────────
  const discordOAuth: SystemCheck = (() => {
    if (!ws) return { status: 'unknown', message: 'Workspace ikke funnet' };
    if (!ws.discord_guild_id || !ws.discord_connected_at) {
      return { status: 'error', message: 'Discord ikke koblet — gå til Innstillinger og koble til Discord' };
    }
    return { status: 'ok', message: 'Discord er koblet til', lastSeen: ws.discord_connected_at };
  })();

  // ── Discord Bot heartbeat ──────────────────────────────────────────────────
  const discordBot: SystemCheck = (() => {
    if (!discordHB) return { status: 'error', message: 'Discord-bot ikke aktiv — siste heartbeat for mer enn 15 min siden' };
    return { status: 'ok', message: `Aktiv (heartbeat ${pluralTimer(minutesAgo(discordHB), 'min')})`, lastSeen: discordHB };
  })();

  // ── Railway Bot heartbeat ──────────────────────────────────────────────────
  const railwayBot: SystemCheck = (() => {
    if (!railwayHB) return { status: 'error', message: 'Railway-bot (Twitch chat) ikke aktiv — siste heartbeat for mer enn 15 min siden' };
    return { status: 'ok', message: `Aktiv (heartbeat ${pluralTimer(minutesAgo(railwayHB), 'min')})`, lastSeen: railwayHB };
  })();

  // ── Creator Brain ──────────────────────────────────────────────────────────
  const creatorBrain: SystemCheck = (() => {
    if (!creatorBrainEv) return { status: 'warning', message: 'Creator Brain har ikke kjørt siste 24 timer' };
    return { status: 'ok', message: `Kjørte ${pluralTimer(hoursAgo(creatorBrainEv), 'time')}`, lastSeen: creatorBrainEv };
  })();

  // ── AI Producer ───────────────────────────────────────────────────────────
  const aiProducer: SystemCheck = (() => {
    if (!aiProducerEv) return { status: 'warning', message: 'AI Producer har ikke kjørt siste 24 timer' };
    return { status: 'ok', message: `Aktiv — siste hendelse ${pluralTimer(hoursAgo(aiProducerEv), 'time')}`, lastSeen: aiProducerEv };
  })();

  // ── Community Manager ──────────────────────────────────────────────────────
  const communityManager: SystemCheck = (() => {
    if (!communityEv) return { status: 'warning', message: 'Community Manager ingen aktivitet siste 48 timer' };
    return { status: 'ok', message: `Aktiv — siste hendelse ${pluralTimer(hoursAgo(communityEv), 'time')}`, lastSeen: communityEv };
  })();

  // ── Poll Manager ───────────────────────────────────────────────────────────
  const pollManager: SystemCheck = (() => {
    if (!pollEv) return { status: 'warning', message: 'Ingen avstemninger registrert siste 48 timer' };
    return { status: 'ok', message: `Siste poll ${pluralTimer(hoursAgo(pollEv), 'time')}`, lastSeen: pollEv };
  })();

  // ── XP System ─────────────────────────────────────────────────────────────
  const xpSystem: SystemCheck = (() => {
    if (!xpEv) return { status: 'warning', message: 'XP-systemet ingen aktivitet siste 48 timer' };
    return { status: 'ok', message: `Aktiv — siste XP-hendelse ${pluralTimer(hoursAgo(xpEv), 'time')}`, lastSeen: xpEv };
  })();

  // ── Partner Engine ─────────────────────────────────────────────────────────
  const partnerEngine: SystemCheck = (() => {
    if (!partnerEv) return { status: 'warning', message: 'Partner Engine ingen aktivitet siste 48 timer' };
    return { status: 'ok', message: `Aktiv — siste hendelse ${pluralTimer(hoursAgo(partnerEv), 'time')}`, lastSeen: partnerEv };
  })();

  // ── Learning Engine ────────────────────────────────────────────────────────
  const learningEngine: SystemCheck = (() => {
    if (!learningEv) return { status: 'warning', message: 'Learning Engine ingen aktivitet siste 24 timer' };
    return { status: 'ok', message: `Aktiv — siste lærdom ${pluralTimer(hoursAgo(learningEv), 'time')}`, lastSeen: learningEv };
  })();

  // ── Content Factory ────────────────────────────────────────────────────────
  const contentFactory: SystemCheck = (() => {
    if (!contentEv) return { status: 'warning', message: 'Content Factory ingen aktivitet siste 48 timer' };
    return { status: 'ok', message: `Aktiv — siste innhold ${pluralTimer(hoursAgo(contentEv), 'time')}`, lastSeen: contentEv };
  })();

  // ── Stream Coach ───────────────────────────────────────────────────────────
  const streamCoach: SystemCheck = (() => {
    if (!streamCoachEv) return { status: 'warning', message: 'Stream Coach ingen lærdom siste 72 timer' };
    return { status: 'ok', message: `Aktiv — siste lærdom ${pluralTimer(hoursAgo(streamCoachEv), 'time')}`, lastSeen: streamCoachEv };
  })();

  return {
    workspace, twitchOAuth, discordOAuth, discordBot, railwayBot,
    creatorBrain, aiProducer, communityManager, pollManager, xpSystem,
    partnerEngine, learningEngine, contentFactory, streamCoach,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET() {
  // Sjekk env vars
  const envSjekk = REQUIRED_ENV.map(e => ({
    ...e,
    status: process.env[e.key] ? 'ok' : e.status === 'valgfri' ? 'valgfri' : 'mangler',
  })) as EnvCheck[];

  const manglerKritiske = envSjekk.filter(e => e.status === 'mangler');

  const workspaceId = getWorkspaceId();
  const dbAvailable  = isDbAvailable();

  // Sjekk tjenester + system checks parallelt
  const [twitchOk, discordOk, systemChecks] = await Promise.all([
    checkTwitchApiHealth().catch(() => false),
    checkDiscordBotHealth().catch(() => false),
    (workspaceId && dbAvailable)
      ? computeSystemChecks(workspaceId).catch(() => null)
      : Promise.resolve(null),
  ]);

  const dbOk = dbAvailable;

  let dbStatus: 'ok' | 'feil' | 'ukjent' = 'ukjent';
  if (dbOk) {
    try {
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
    if (dbOk) {
      botApiStatus = 'ok';
      botApiDetaljer = undefined as any;
    } else {
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
  if (!process.env.WORKSPACE_ID) advarsler.push('KRITISK: WORKSPACE_ID ikke satt – Railway-boten vil ikke starte (process.exit). Sett WORKSPACE_ID i Railway Variables til din Supabase workspace UUID.');
  if (!process.env.TWITCH_BOT_OAUTH) advarsler.push('VIKTIG: Twitch chat-bot ikke aktiv – ingen automatiske chat-meldinger.');
  if (!process.env.DISCORD_CHAT_CHANNEL_ID) advarsler.push('VIKTIG: DISCORD_CHAT_CHANNEL_ID ikke satt – brukes som fallback for subs, clips og raid-meldinger. Sett kanalpreferanser i dashboardet eller legg til env var.');
  if (!process.env.OPENAI_API_KEY) advarsler.push('ADVARSEL: OPENAI_API_KEY mangler – all AI-generering vil falle tilbake til maler.');

  const kanalPrefNoter: string[] = [];
  const railwayEnvMangler = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'WORKSPACE_ID'].filter(k => !process.env[k]);
  if (railwayEnvMangler.length > 0) {
    kanalPrefNoter.push(`Railway mangler env vars: ${railwayEnvMangler.join(', ')} – botKanalPreferanser.ts kan ikke lese kanalpreferanser fra Supabase`);
  }

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
    systemChecks,
    timestamp: new Date().toISOString(),
  });
}
