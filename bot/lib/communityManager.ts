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

// ─── C1: Dagens MVP ───────────────────────────────────────────────────────────

export async function velgDagensMVP(communityKanal: TextChannel): Promise<void> {
  ensureFreshDay();

  if (dayState.mvpSentToday) return;

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

  if (!topUserId || topXpToday === 0) {
    logSystemEvent({
      source: 'community_manager', event_type: 'COMMUNITY_MVP_SKIPPED_NO_ACTIVITY',
      title: 'MVP hoppet over – ingen COMMUNITY_XP_GRANTED-aktivitet siste 24t',
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

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle('🏆 Dagens Community MVP')
    .setDescription(
      `Takk til **${mvp.displayName}** som har vært ekstra aktiv i dag!\n\n` +
      `**Level:** ${mvp.level}\n` +
      `**XP i dag:** +${topXpToday}\n` +
      `**Total XP:** ${mvp.xp}\n` +
      (mvp.streakDays >= 2 ? `**Streak:** ${mvp.streakDays} dager på rad 🔥\n` : '') +
      `\nFortsett å holde communityet levende! 💪`
    )
    .setFooter({ text: `${BOT_BRAND} Community • ${new Date().toLocaleDateString('no-NO')}` })
    .setTimestamp();

  await communityKanal.send({ embeds: [embed] }).catch(() => {});

  dayState.mvpSentToday = true;
  dayState.lastPostAt   = Date.now();

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
        const meta = data[0].metadata as any;
        const displayName = meta?.username ?? 'Noen';
        const newLevel    = meta?.newLevel ?? '?';
        hypeType = 'level_up';
        melding = `⭐ **${displayName}** nådde nylig **Level ${newLevel}**! Imponerende fremgang 💪`;
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
      melding = `🔥 **${streakStar.displayName}** har vært aktiv **${streakStar.streakDays} dager på rad**! Hold det gående 🙌`;
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
          melding = `📊 Ukens topp-bidragsyter er **${topData.name}** med **${topData.xp} XP** denne uken! Takk for at du holder communityet levende 🏅`;
        }
      }
    } catch {}
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

// ─── C3: Idle Detection + Context-Aware Prompt ───────────────────────────────

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
    title: `Community-kanal stille i ${Math.round(minutesSinceHuman)} min (terskel: ${idleThresholdMinutes} min)`,
    severity: 'info',
    metadata: { minutesSinceLastMessage: Math.round(minutesSinceHuman), threshold: idleThresholdMinutes, kanalId: communityKanal.id, workspaceId: WORKSPACE_ID },
  });

  const prompt = await genererAktivitetsPrompt(Math.round(minutesSinceHuman));
  if (!prompt) return;

  await communityKanal.send(prompt).catch(() => {});

  dayState.promptCount++;
  dayState.lastPostAt = Date.now();

  logSystemEvent({
    source: 'community_manager', event_type: 'COMMUNITY_ACTIVITY_PROMPT_SENT',
    title: `Aktivitetsprompt sendt til community-kanal`,
    severity: 'info',
    metadata: { prompt: prompt.slice(0, 120), promptCount: dayState.promptCount, minutesIdle: Math.round(minutesSinceHuman), kanalId: communityKanal.id, workspaceId: WORKSPACE_ID, guildId: GUILD_ID },
  });
}

// ─── Context-Aware Prompt Generator ──────────────────────────────────────────

async function genererAktivitetsPrompt(idleMinutes: number): Promise<string | null> {
  // Gather context regardless of AI availability
  const plan = await getStreamplan().catch(() => [] as Awaited<ReturnType<typeof getStreamplan>>);
  const activeEntries = plan.filter(e => e.aktiv);
  const sisteSpill    = [...new Set(activeEntries.map(e => e.spill).filter(Boolean))].slice(0, 3).join(', ') || 'stream';

  const topMembers = getAllMembers()
    .slice(0, 5)
    .map(m => m.displayName)
    .join(', ');

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    // Static fallbacks — specific to the game context
    const FALLBACKS = [
      `🎮 Hva var det beste øyeblikket fra siste ${sisteSpill}-stream?`,
      `💬 Hvilken loadout/strategi burde testes i ${sisteSpill} neste gang?`,
      `🏆 Hvem bør vi raida etter neste stream? Kom med forslag!`,
      `🎯 Hva er det én ting i ${sisteSpill} du ønsker å se mer av?`,
      `🔥 Del favorittklippet ditt fra de siste streamene!`,
    ];
    return FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
  }

  try {
    const openai = new OpenAI({ apiKey });

    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content:
          `Du er community-bot for ${BOT_BRAND}. Discord-kanalen har vært stille i ${idleMinutes} minutter.\n\n` +
          `Streamers innhold/spill: ${sisteSpill}\n` +
          `Aktive community-membres: ${topMembers || 'ukjent'}\n\n` +
          `Skriv ETT engasjerende spørsmål på norsk (maks 2 setninger) som er SPESIFIKT for dette community-et og disse spillene.\n` +
          `Eksempler på stil (ikke kopier ordrett):\n` +
          `- "Hva var favorittøyeblikket fra siste ${sisteSpill}-stream?"\n` +
          `- "Hvilken loadout burde testes i ${sisteSpill} neste gang?"\n` +
          `- "Hva er det én ting i ${sisteSpill} du aldri gidder å gjøre igjen? 😅"\n\n` +
          `Krav: Start med emoji. Ingen generiske gaming-spørsmål. Norsk.`,
      }],
      max_tokens: 100,
      temperature: 0.9,
    });

    return res.choices[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

// ─── Diagnostics ──────────────────────────────────────────────────────────────

export function getDayState(): Readonly<CommunityDayState> {
  ensureFreshDay();
  return { ...dayState };
}
