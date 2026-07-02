import { TextChannel, EmbedBuilder } from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { getAllMembers } from './memberTracker';
import { getStreamplan } from './botEvents';
import { logSystemEvent } from './systemEvents';
import { getCommunitySettings } from './botKanalPreferanser';

const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'glenvex-default';
const GUILD_ID     = process.env.DISCORD_GUILD_ID ?? '';
const BOT_BRAND    = process.env.BRAND_NAME ?? process.env.TWITCH_USERNAME ?? 'streameren';

const MAX_HYPE_PER_DAY    = 2;
const MAX_PROMPTS_PER_DAY = 2;
const MIN_BETWEEN_POSTS_MS = 6 * 60 * 60 * 1000; // 6 hours

const DISCORD_REACTIONS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];

// ─── Module-level rate limiting state ────────────────────────────────────────

interface CommunityDayState {
  date: string;
  mvpSentToday: boolean;
  hypeCount: number;
  promptCount: number;
  lastPostAt: number;
}

let dayState: CommunityDayState = {
  date: '', mvpSentToday: false, hypeCount: 0, promptCount: 0, lastPostAt: 0,
};

function osloDateISO(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(new Date());
}

function ensureFreshDay(): void {
  const today = osloDateISO();
  if (dayState.date !== today) {
    dayState = { date: today, mvpSentToday: false, hypeCount: 0, promptCount: 0, lastPostAt: 0 };
  }
}

function gapOk(): boolean {
  return dayState.lastPostAt === 0 || Date.now() - dayState.lastPostAt >= MIN_BETWEEN_POSTS_MS;
}

function minutesSinceLast(): number {
  return Math.round((Date.now() - dayState.lastPostAt) / 60_000);
}

// ─── Supabase helper ──────────────────────────────────────────────────────────

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ws = require('ws');
  return createClient(url, key, {
    realtime: { transport: ws },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─── AI Memory reader (for poll context) ─────────────────────────────────────

async function hentAiMemory(): Promise<string> {
  try {
    const db = getDb();
    if (!db) return '';
    const { data } = await db
      .from('ai_agent_memory')
      .select('memory_type, summary, content, occurrence_count')
      .eq('workspace_id', WORKSPACE_ID)
      .in('memory_type', ['game', 'viewer', 'topic', 'partner'])
      .order('occurrence_count', { ascending: false })
      .limit(8);
    if (!data || data.length === 0) return '';
    return data.map(m =>
      `[${m.memory_type}] ${String(m.summary ?? m.content ?? '').slice(0, 150)} (${m.occurrence_count}x)`
    ).join('\n');
  } catch {
    return '';
  }
}

// ─── C1: Dagens MVP ───────────────────────────────────────────────────────────

function osloTodayCutoffUTC(): string {
  const today = osloDateISO();
  for (const ofs of ['+02:00', '+01:00']) {
    const d = new Date(`${today}T00:00:00${ofs}`);
    if (new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(d) === today) {
      return d.toISOString();
    }
  }
  return new Date(Date.now() - 24 * 3_600_000).toISOString();
}

export async function velgDagensMVP(communityKanal: TextChannel): Promise<void> {
  ensureFreshDay();

  if (dayState.mvpSentToday) return;

  // DB-backed idempotency — survives bot restarts
  {
    const dbIdempotency = getDb();
    if (dbIdempotency) {
      try {
        const cutoff = osloTodayCutoffUTC();
        const { data: existing } = await dbIdempotency
          .from('system_events')
          .select('id')
          .eq('workspace_id', WORKSPACE_ID)
          .eq('event_type', 'COMMUNITY_MVP_SELECTED')
          .gte('created_at', cutoff)
          .limit(1);
        if (existing && existing.length > 0) {
          dayState.mvpSentToday = true;
          logSystemEvent({
            source: 'community_manager', event_type: 'MVP_ALREADY_EXISTS',
            title: 'MVP allerede valgt i dag (Europe/Oslo) — hopper over',
            severity: 'info',
            metadata: { date: osloDateISO(), workspaceId: WORKSPACE_ID, guildId: GUILD_ID },
          });
          return;
        }
      } catch {}
    }
  }

  if (!gapOk()) {
    logSystemEvent({
      source: 'community_manager', event_type: 'COMMUNITY_ACTIVITY_SKIPPED_RATE_LIMIT',
      title: `MVP hoppet over – 6t cooldown (${minutesSinceLast()} min siden siste post)`,
      severity: 'info',
      metadata: { type: 'mvp', minutesSinceLast: minutesSinceLast(), requiredMinutes: 360, workspaceId: WORKSPACE_ID, guildId: GUILD_ID },
    });
    return;
  }

  const db = getDb();
  let topUserId: string | null = null;
  let topXpToday = 0;

  // Primary: read system_events for today's XP grants
  if (db) {
    try {
      const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data } = await db
        .from('system_events')
        .select('metadata')
        .eq('workspace_id', WORKSPACE_ID)
        .eq('event_type', 'COMMUNITY_XP_GRANTED')
        .gte('created_at', cutoff);

      if (data && data.length > 0) {
        const xpMap = new Map<string, number>();
        for (const row of data) {
          const uid = (row.metadata as any)?.userId as string | undefined;
          const xp  = Number((row.metadata as any)?.xpGranted ?? 0);
          if (uid) xpMap.set(uid, (xpMap.get(uid) ?? 0) + xp);
        }
        for (const [uid, xp] of xpMap) {
          if (xp > topXpToday) { topXpToday = xp; topUserId = uid; }
        }
      }
    } catch {}
  }

  // Fallback: use members.json — find most active member seen today
  if (!topUserId || topXpToday === 0) {
    const today = osloDateISO();
    const allMembers = getAllMembers();
    const activeToday = allMembers
      .filter(m => m.lastSeen && m.lastSeen.startsWith(today))
      .sort((a, b) => (b.messages + b.streakDays * 10) - (a.messages + a.streakDays * 10));

    if (activeToday.length > 0) {
      const best = activeToday[0];
      topUserId  = best.id;
      topXpToday = 0; // unknown daily, will show streak instead
    }
  }

  if (!topUserId) {
    logSystemEvent({
      source: 'community_manager', event_type: 'COMMUNITY_MVP_SKIPPED_NO_ACTIVITY',
      title: 'MVP hoppet over – ingen aktivitet å hylle i dag',
      severity: 'info',
      metadata: { workspaceId: WORKSPACE_ID, guildId: GUILD_ID },
    });
    return;
  }

  const allMembers = getAllMembers();
  const mvp = allMembers.find(m => m.id === topUserId);
  if (!mvp) {
    logSystemEvent({
      source: 'community_manager', event_type: 'COMMUNITY_MVP_SKIPPED_NO_ACTIVITY',
      title: `MVP hoppet over – userId ${topUserId} ikke i member-profiler`,
      severity: 'warning',
      metadata: { userId: topUserId, workspaceId: WORKSPACE_ID },
    });
    return;
  }

  const streakLine  = mvp.streakDays >= 2 ? `🔥 **Streak:** ${mvp.streakDays} dager på rad!\n` : '';
  const xpLine      = topXpToday > 0
    ? `⚡ **XP i dag:** +${topXpToday}\n💰 **Total XP:** ${mvp.xp}\n`
    : `💰 **Total XP:** ${mvp.xp}\n`;
  const hypeSlogan  = mvp.streakDays >= 7
    ? '🏆 EN LEGENDE I COMMUNITYET! KLINK! 🍾'
    : mvp.level >= 10
    ? '👑 Høy-level spiller — vi vet hvem du er! 🎯'
    : '⭐ Holde det gående, vi ser deg! 💪';

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle('🏆 Dagens Community MVP!')
    .setDescription(
      `## @${mvp.displayName} tok gullet i dag! 🥇\n\n` +
      `🎮 **Level:** ${mvp.level}\n` +
      xpLine +
      streakLine +
      `\n${hypeSlogan}`,
    )
    .setFooter({ text: `${BOT_BRAND} Community • ${new Date().toLocaleDateString('no-NO')}` })
    .setTimestamp();

  await communityKanal.send({ content: `@everyone`, embeds: [embed], allowedMentions: { parse: ['everyone'] } }).catch(() => {});

  dayState.mvpSentToday = true;
  dayState.lastPostAt   = Date.now();

  logSystemEvent({
    source: 'community_manager', event_type: 'MVP_DAILY_AWARDED',
    title: `Dagens MVP tildelt: ${mvp.displayName} (+${topXpToday} XP i dag)`,
    severity: 'info',
    metadata: { userId: mvp.id, username: mvp.displayName, xpToday: topXpToday, level: mvp.level, date: osloDateISO(), workspaceId: WORKSPACE_ID, guildId: GUILD_ID },
  });
  logSystemEvent({
    source: 'community_manager', event_type: 'COMMUNITY_MVP_SELECTED',
    title: `Dagens MVP: ${mvp.displayName} (+${topXpToday} XP i dag)`,
    severity: 'info',
    metadata: { userId: mvp.id, username: mvp.displayName, xpToday: topXpToday, level: mvp.level, kanalId: communityKanal.id, workspaceId: WORKSPACE_ID, guildId: GUILD_ID },
  });
}

// ─── C2: Community Hype ───────────────────────────────────────────────────────

type HypeType = 'level_up' | 'streak' | 'weekly_top';

export async function sendCommunityHype(communityKanal: TextChannel): Promise<void> {
  ensureFreshDay();

  const settings = await getCommunitySettings().catch(() => null);
  if (settings?.communityHypeAktiv === false) return;

  const maxHype = settings?.maxBotPostsPerDay ?? MAX_HYPE_PER_DAY;

  if (dayState.hypeCount >= maxHype) {
    logSystemEvent({
      source: 'community_manager', event_type: 'COMMUNITY_HYPE_SKIPPED_DAILY_LIMIT',
      title: `Community hype hoppet over – daglig grense nådd (${dayState.hypeCount}/${maxHype})`,
      severity: 'info',
      metadata: { hypeCount: dayState.hypeCount, max: maxHype, workspaceId: WORKSPACE_ID, guildId: GUILD_ID },
    });
    return;
  }

  if (!gapOk()) {
    logSystemEvent({
      source: 'community_manager', event_type: 'COMMUNITY_ACTIVITY_SKIPPED_RATE_LIMIT',
      title: `Community hype hoppet over – 6t cooldown (${minutesSinceLast()} min siden siste post)`,
      severity: 'info',
      metadata: { type: 'hype', minutesSinceLast: minutesSinceLast(), requiredMinutes: 360, workspaceId: WORKSPACE_ID },
    });
    return;
  }

  const db = getDb();
  let hypeType: HypeType | null = null;
  let melding = '';

  // Priority 1: recent level-up (last 24h)
  if (db) {
    try {
      const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data } = await db
        .from('system_events')
        .select('metadata')
        .eq('workspace_id', WORKSPACE_ID)
        .eq('event_type', 'COMMUNITY_LEVEL_UP')
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        const meta        = data[0].metadata as any;
        const displayName = meta?.username ?? 'Noen';
        const newLevel    = meta?.newLevel ?? '?';
        hypeType = 'level_up';
        melding = `⭐ YO! **${displayName}** gikk opp til **Level ${newLevel}**!! Det er IKKE hvem som helst 🔥 GRATZ! PogChamp`;
      }
    } catch {}
  }

  // Priority 2: streak >= 5 days
  if (!hypeType) {
    const allMembers = getAllMembers();
    const streakStar = allMembers
      .filter(m => (m.streakDays ?? 0) >= 5)
      .sort((a, b) => (b.streakDays ?? 0) - (a.streakDays ?? 0))[0];

    if (streakStar) {
      hypeType = 'streak';
      const days = streakStar.streakDays;
      const hype = days >= 14 ? '👑 EN LEGENDE!' : days >= 7 ? '🔥 USTOPPELIG!' : '💪 KEEP GOING!';
      melding = `🔥 **${streakStar.displayName}** er aktiv **${days} dager på rad**! ${hype} Det communityet trenger er deg her! 🙌`;
    }
  }

  // Priority 3: weekly top contributor (XP last 7 days)
  if (!hypeType && db) {
    try {
      const cutoff7 = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
      const { data } = await db
        .from('system_events')
        .select('metadata')
        .eq('workspace_id', WORKSPACE_ID)
        .eq('event_type', 'COMMUNITY_XP_GRANTED')
        .gte('created_at', cutoff7);

      if (data && data.length > 0) {
        const xpMap = new Map<string, { xp: number; name: string }>();
        for (const row of data) {
          const uid  = (row.metadata as any)?.userId as string | undefined;
          const xp   = Number((row.metadata as any)?.xpGranted ?? 0);
          const name = (row.metadata as any)?.username as string ?? '';
          if (uid) {
            const prev = xpMap.get(uid) ?? { xp: 0, name };
            xpMap.set(uid, { xp: prev.xp + xp, name: name || prev.name });
          }
        }
        if (xpMap.size > 0) {
          const [, topData] = [...xpMap.entries()].sort((a, b) => b[1].xp - a[1].xp)[0];
          hypeType = 'weekly_top';
          melding = `📊 UKENS MVP: **${topData.name}** dominerte med **${topData.xp} XP** denne uken! 🏅 Communityet er på et annet nivå fordi du er der!`;
        }
      }
    } catch {}
  }

  // Priority 4: fallback — hype the most active member from members.json
  if (!hypeType) {
    const allMembers = getAllMembers().filter(m => m.messages > 0);
    if (allMembers.length > 0) {
      const top = allMembers.sort((a, b) => b.xp - a.xp)[0];
      hypeType = 'weekly_top';
      melding = `💥 Shoutout til **${top.displayName}** – Level ${top.level} og ${top.xp} XP totalt! Det er EKTE dedication 🙌 Takk for at du er her!`;
    }
  }

  if (!hypeType) {
    logSystemEvent({
      source: 'community_manager', event_type: 'COMMUNITY_HYPE_SKIPPED_NO_ACTIVITY',
      title: 'Community hype hoppet over – ingen aktivitet å hylle',
      severity: 'info',
      metadata: { workspaceId: WORKSPACE_ID, guildId: GUILD_ID },
    });
    return;
  }

  await communityKanal.send(melding).catch(() => {});

  dayState.hypeCount++;
  dayState.lastPostAt = Date.now();

  logSystemEvent({
    source: 'community_manager', event_type: 'COMMUNITY_HYPE_SENT',
    title: `Community hype sendt: ${hypeType}`,
    severity: 'info',
    metadata: { hypeType, hypeCount: dayState.hypeCount, max: maxHype, kanalId: communityKanal.id, workspaceId: WORKSPACE_ID, guildId: GUILD_ID },
  });
}

// ─── C3: Idle Detection + Poll + @everyone ───────────────────────────────────

export async function sjekkIdleOgPrompt(
  communityKanal: TextChannel,
  botUserId: string,
  idleThresholdMinutes: number,
): Promise<void> {
  ensureFreshDay();

  const settings = await getCommunitySettings().catch(() => null);
  if (settings?.idlePromptsAktiv === false) return;

  if (dayState.promptCount >= MAX_PROMPTS_PER_DAY) {
    logSystemEvent({
      source: 'community_manager', event_type: 'COMMUNITY_ACTIVITY_SKIPPED_RATE_LIMIT',
      title: `Idle-prompt hoppet over – daglig grense nådd (${dayState.promptCount}/${MAX_PROMPTS_PER_DAY})`,
      severity: 'info',
      metadata: { type: 'prompt', promptCount: dayState.promptCount, max: MAX_PROMPTS_PER_DAY, workspaceId: WORKSPACE_ID },
    });
    return;
  }

  if (!gapOk()) {
    logSystemEvent({
      source: 'community_manager', event_type: 'COMMUNITY_ACTIVITY_SKIPPED_RATE_LIMIT',
      title: `Idle-prompt hoppet over – 6t cooldown (${minutesSinceLast()} min siden siste post)`,
      severity: 'info',
      metadata: { type: 'prompt', minutesSinceLast: minutesSinceLast(), requiredMinutes: 360, workspaceId: WORKSPACE_ID },
    });
    return;
  }

  // Detect idle: find last non-bot message in last 10 messages
  let minutesSinceHuman = idleThresholdMinutes + 1; // default: treat as idle if fetch fails
  try {
    const msgs = await communityKanal.messages.fetch({ limit: 10 });
    const humanMsgs = [...msgs.values()].filter(m => !m.author.bot && m.author.id !== botUserId);
    if (humanMsgs.length > 0) {
      const latestHumanTs = Math.max(...humanMsgs.map(m => m.createdTimestamp));
      minutesSinceHuman = (Date.now() - latestHumanTs) / 60_000;
    }
  } catch {}

  if (minutesSinceHuman < idleThresholdMinutes) {
    logSystemEvent({
      source: 'community_manager', event_type: 'COMMUNITY_ACTIVITY_SKIPPED_RECENT_ACTIVITY',
      title: `Idle-sjekk: ikke stille nok (${Math.round(minutesSinceHuman)} min, terskel ${idleThresholdMinutes} min)`,
      severity: 'info',
      metadata: { minutesSinceLastMessage: Math.round(minutesSinceHuman), threshold: idleThresholdMinutes, kanalId: communityKanal.id, workspaceId: WORKSPACE_ID },
    });
    return;
  }

  logSystemEvent({
    source: 'community_manager', event_type: 'COMMUNITY_IDLE_DETECTED',
    title: `Community-kanal stille i ${Math.round(minutesSinceHuman)} min – sender poll`,
    severity: 'info',
    metadata: { minutesSinceLastMessage: Math.round(minutesSinceHuman), threshold: idleThresholdMinutes, kanalId: communityKanal.id, workspaceId: WORKSPACE_ID },
  });

  const sent = await genererOgSendIdlePoll(communityKanal, Math.round(minutesSinceHuman));
  if (!sent) return;

  dayState.promptCount++;
  dayState.lastPostAt = Date.now();

  logSystemEvent({
    source: 'community_manager', event_type: 'COMMUNITY_ACTIVITY_PROMPT_SENT',
    title: 'Idle-poll sendt til community-kanal med @everyone',
    severity: 'info',
    metadata: { promptCount: dayState.promptCount, minutesIdle: Math.round(minutesSinceHuman), kanalId: communityKanal.id, workspaceId: WORKSPACE_ID, guildId: GUILD_ID },
  });
}

// ─── Idle Poll Generator ──────────────────────────────────────────────────────

async function genererOgSendIdlePoll(
  communityKanal: TextChannel,
  idleMinutes: number,
): Promise<boolean> {
  const plan         = await getStreamplan().catch(() => [] as Awaited<ReturnType<typeof getStreamplan>>);
  const activeGames  = [...new Set(plan.filter(e => e.aktiv).map(e => e.spill).filter(Boolean))].slice(0, 3);
  const sisteSpill   = activeGames[0] || 'stream';
  const aiMemory     = await hentAiMemory();
  const apiKey       = process.env.OPENAI_API_KEY;

  // Fetch recent Discord conversation to create context-aware polls
  let recentChatContext = '';
  try {
    const msgs = await communityKanal.messages.fetch({ limit: 30 });
    const humanMsgs = [...msgs.values()]
      .filter(m => !m.author.bot && m.content.trim().length > 3)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .slice(-20);
    if (humanMsgs.length > 0) {
      recentChatContext = humanMsgs
        .map(m => `${m.author.username}: ${m.content.slice(0, 120)}`)
        .join('\n');
    }
  } catch {}

  interface PollData { question: string; options: string[] }

  let poll: PollData | null = null;

  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content:
            `Du er community-bot for ${BOT_BRAND}. Discord har vært stille i ${idleMinutes} minutter.\n\n` +
            `Streamers spill/innhold: ${activeGames.join(', ') || 'ukjent'}\n` +
            `AI-læring om communityet:\n${aiMemory || '(ingen data ennå)'}\n\n` +
            (recentChatContext
              ? `Hva som NYLIG ble diskutert i Discord (bruk dette til å lage en relevant poll!):\n${recentChatContext}\n\n`
              : '') +
            `Lag en ENGASJERENDE Discord-poll (norsk) basert på hva som ble diskutert.\n` +
            `Hvis folk snakket om et spill eller et tema — lag poll om DET, ikke noe generisk.\n` +
            `Stil: energisk, direkte, gaming-fokusert.\n\n` +
            `Svar med JSON: { "question": "spørsmål maks 80 tegn med emoji", "options": ["svar1","svar2","svar3","svar4"] }\n` +
            `Maks 4 alternativer, hvert maks 40 tegn. Bruk gjerne emojier i alternativene.`,
        }],
        max_tokens: 200,
        temperature: 0.9,
      });
      const raw = res.choices[0]?.message?.content?.trim() ?? '';
      const parsed = JSON.parse(raw);
      if (typeof parsed?.question === 'string' && Array.isArray(parsed?.options) && parsed.options.length >= 2) {
        poll = { question: parsed.question, options: parsed.options.slice(0, 4) };
      }
    } catch {}
  }

  // Static fallbacks based on game context
  if (!poll) {
    const FALLBACK_POLLS: PollData[] = [
      {
        question: `🎮 Hva vil du se i neste ${sisteSpill}-stream?`,
        options: ['Ranked grind 💥', 'Chill og utforsk 🌍', 'Community-utfordring 🏆', 'Stream stemmer! 🗳️'],
      },
      {
        question: `👀 Hvordan foretrekker du å følge streams?`,
        options: ['Live på Twitch 🔴', 'VOD etterpå ⏪', 'Klipp på Discord 🎬', 'Alt av det! ✅'],
      },
      {
        question: `🏆 Hva liker du BEST med dette communityet?`,
        options: ['Streameren 🎮', 'Gode folk her 👥', 'Giveaways & events 🎁', 'Gaming-innholdet 🕹️'],
      },
      {
        question: `⏰ Når streamer du / ser du på stream?`,
        options: ['Ettermiddag 16-18 ☀️', 'Kveld 19-21 🌆', 'Sen kveld 22+ 🌙', 'Helg kun 📅'],
      },
    ];
    poll = FALLBACK_POLLS[Math.floor(Math.random() * FALLBACK_POLLS.length)];
  }

  const description = poll.options
    .map((o, i) => `${DISCORD_REACTIONS[i]} ${o}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x00e676)
    .setTitle(`📊 ${poll.question}`)
    .setDescription(`${description}\n\n*Stem med emoji under! Hva sier communityet?* 👇`)
    .setFooter({ text: `${BOT_BRAND} Community Poll` })
    .setTimestamp();

  try {
    const msg = await communityKanal.send({
      content: `@everyone 👋 Kanal er stille – vi trenger din mening! 🗣️`,
      embeds: [embed],
      allowedMentions: { parse: ['everyone'] },
    });

    for (const emoji of DISCORD_REACTIONS.slice(0, poll.options.length)) {
      await msg.react(emoji).catch(() => {});
      await new Promise(r => setTimeout(r, 300));
    }

    return true;
  } catch {
    return false;
  }
}

// ─── Diagnostics ──────────────────────────────────────────────────────────────

export function getDayState(): Readonly<CommunityDayState> {
  ensureFreshDay();
  return { ...dayState };
}
