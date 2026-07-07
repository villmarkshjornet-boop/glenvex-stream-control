/**
 * Cross-Platform Context
 *
 * Henter ferske Twitch/Discord-events fra ai_agent_events og bygger
 * tekstlig kontekst for AI-svar. Brukes av begge bots.
 *
 * IKKE hardkodet workspaceId – bruker WORKSPACE_ID env.
 * DM-er og private kanaler logges ikke (filtreres i botene).
 */

import OpenAI from 'openai';

const WORKSPACE_ID = process.env.WORKSPACE_ID || '';

export interface CrossPlatformOptions {
  includeTwitch?: boolean;
  includeDiscord?: boolean;
  minutesBack?: number;
  maxMessages?: number;
}

interface RawEvent {
  source: string;
  event_type: string;
  username: string | null;
  message_text: string | null;
  importance_score: number;
  metadata: Record<string, any>;
  created_at: string;
}

function getSb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = require('@supabase/supabase-js');
  return createClient(url, key, { realtime: { transport: require('ws') } });
}

function hhMM(iso: string): string {
  return new Date(iso).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });
}

function formatEvent(e: RawEvent): string | null {
  const ts = hhMM(e.created_at);
  const u = e.username ?? '?';
  switch (e.event_type) {
    case 'chat_message':
    case 'discord_message':
      return e.message_text ? `[${ts}] ${u}: "${e.message_text}"` : null;
    case 'raid':       return `[${ts}] [RAID] ${u} raida med ${e.metadata?.viewers ?? '?'} viewers`;
    case 'sub':
    case 'resub':      return `[${ts}] [SUB] ${u} abonnerte`;
    case 'giftsub':    return `[${ts}] [GIFTSUB] ${u} ga sub til ${e.metadata?.recipient ?? '?'}`;
    case 'mystery_gift': return `[${ts}] [GIFTSUB x${e.metadata?.count ?? '?'}] ${u}`;
    case 'cheer':      return `[${ts}] [BITS] ${u} – ${e.metadata?.bits ?? '?'} bits`;
    case 'active_chatter': return `[${ts}] [AKTIV] ${u} (${e.metadata?.messageCount ?? '?'} meldinger)`;
    case 'active_member':  return `[${ts}] [AKTIV] ${u} (Discord Level ${e.metadata?.level ?? '?'})`;
    case 'member_join':    return `[${ts}] [JOIN] ${u} ble med i Discord`;
    default: return null;
  }
}

/**
 * Henter fersk kryssplattform-kontekst som tekstblokk for AI-prompts.
 */
export async function getRecentCrossPlatformContext(
  options: CrossPlatformOptions = {}
): Promise<string> {
  const {
    includeTwitch = true,
    includeDiscord = true,
    minutesBack    = 60,
    maxMessages    = 40,
  } = options;

  const sb = getSb();
  if (!sb) return '';

  try {
    const sources: string[] = [];
    if (includeTwitch) sources.push('twitch');
    if (includeDiscord) sources.push('discord');
    if (sources.length === 0) return '';

    const cutoff = new Date(Date.now() - minutesBack * 60_000).toISOString();

    const { data: events } = await sb
      .from('ai_agent_events')
      .select('source,event_type,username,message_text,importance_score,metadata,created_at')
      .eq('workspace_id', WORKSPACE_ID)
      .in('source', sources)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(maxMessages);

    if (!events || events.length === 0) return '';

    const twitchEvents  = (events as RawEvent[]).filter(e => e.source === 'twitch');
    const discordEvents = (events as RawEvent[]).filter(e => e.source === 'discord');
    const linjer: string[] = [];

    if (includeTwitch && twitchEvents.length > 0) {
      linjer.push(`=== Twitch-aktivitet (siste ${minutesBack} min) ===`);
      for (const e of twitchEvents.slice(0, 20)) {
        const linje = formatEvent(e);
        if (linje) linjer.push(linje);
      }
    }

    if (includeDiscord && discordEvents.length > 0) {
      linjer.push(`=== Discord-aktivitet (siste ${minutesBack} min) ===`);
      for (const e of discordEvents.slice(0, 20)) {
        const linje = formatEvent(e);
        if (linje) linjer.push(linje);
      }
    }

    return linjer.join('\n');
  } catch { return ''; }
}

/**
 * GPT-sammendrag av fersk aktivitet fra én plattform.
 * Brukes av !discordsiste, !twitchsiste etc.
 */
export async function summarizeRecentActivity(
  source: 'twitch' | 'discord',
  minutesBack = 60
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return 'OpenAI ikke tilkoblet.';

  const ctx = await getRecentCrossPlatformContext({
    includeTwitch:  source === 'twitch',
    includeDiscord: source === 'discord',
    minutesBack,
    maxMessages: 40,
  });

  if (!ctx.trim()) {
    return source === 'twitch'
      ? `Ingen Twitch-aktivitet logget de siste ${minutesBack} minuttene.`
      : `Ingen Discord-aktivitet logget de siste ${minutesBack} minuttene.`;
  }

  try {
    const openai = new OpenAI({ apiKey });
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Du er en community-assistent. Gi et kortfattet norsk sammendrag (2-3 setninger) av hva som skjedde. Nevn hvem som var aktive og hvilke temaer som gikk igjen. Ikke list alle meldingene – gi et menneskelig sammendrag.',
        },
        { role: 'user', content: ctx },
      ],
      max_tokens: 180,
      temperature: 0.3,
    });
    return res.choices[0]?.message?.content?.trim() ?? 'Ingen data.';
  } catch { return 'Feil ved oppsummering.'; }
}

/**
 * Henter hva AI husker om communityet (jokes, topics, innsikter, viewers).
 */
export async function hentCommunityMemorySummary(): Promise<string> {
  const sb = getSb();
  if (!sb) return 'Ingen DB-tilkobling.';
  const apiKey = process.env.OPENAI_API_KEY;

  try {
    const [jokesRes, viewersRes, membersRes, insightsRes] = await Promise.all([
      sb.from('ai_agent_memory').select('memory_type,summary,occurrence_count')
        .eq('workspace_id', WORKSPACE_ID).in('memory_type', ['joke', 'topic'])
        .order('occurrence_count', { ascending: false }).limit(6),
      sb.from('ai_agent_memory').select('key,summary')
        .eq('workspace_id', WORKSPACE_ID).eq('memory_type', 'viewer')
        .order('occurrence_count', { ascending: false }).limit(5),
      sb.from('ai_agent_memory').select('key,summary')
        .eq('workspace_id', WORKSPACE_ID).eq('memory_type', 'member')
        .order('occurrence_count', { ascending: false }).limit(5),
      sb.from('ai_agent_insights').select('title,summary')
        .eq('workspace_id', WORKSPACE_ID).order('created_at', { ascending: false }).limit(3),
    ]);

    const linjer: string[] = ['**AI Community Memory**'];

    const jokes  = (jokesRes.data ?? []).filter((m: any) => m.memory_type === 'joke');
    const topics = (jokesRes.data ?? []).filter((m: any) => m.memory_type === 'topic');

    if (jokes.length > 0) linjer.push(`🎭 **Inside jokes:** ${jokes.map((j: any) => j.summary).join(' · ')}`);
    if (topics.length > 0) linjer.push(`💬 **Community-temaer:** ${topics.map((t: any) => t.summary).join(' · ')}`);
    if (viewersRes.data?.length) linjer.push(`📺 **Twitch-fans:** ${viewersRes.data.map((v: any) => `${v.key} (${v.summary})`).join(', ')}`);
    if (membersRes.data?.length) linjer.push(`💜 **Discord-aktive:** ${membersRes.data.map((m: any) => m.summary).join(', ')}`);
    if (insightsRes.data?.length) linjer.push(`🧠 **AI-innsikter:** ${insightsRes.data.map((i: any) => `${i.title}: ${i.summary}`).join(' | ')}`);

    if (linjer.length === 1) return 'Ingen community-data ennå. Aggregeringen kjøres hvert 15. minutt.';

    if (apiKey) {
      // GPT-sammendrag
      const raw = linjer.slice(1).join('\n');
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Gi et kort, engasjerende norsk sammendrag av hva AI-boten husker om dette gaming-communityet. Maks 3 setninger.' },
          { role: 'user', content: raw },
        ],
        max_tokens: 200,
        temperature: 0.5,
      });
      const oppsummering = res.choices[0]?.message?.content?.trim();
      if (oppsummering) linjer.push(`\n📊 *${oppsummering}*`);
    }

    return linjer.join('\n');
  } catch { return 'Feil ved henting av memory.'; }
}

// ── Rate-limiter for kommandoer ───────────────────────────────────────────────

const _commandCooldowns = new Map<string, number>();
const COMMAND_COOLDOWN_MS = 30_000;

export function isCommandCooldown(channelId: string, command: string): boolean {
  const key = `${channelId}:${command}`;
  const last = _commandCooldowns.get(key);
  return last !== undefined && Date.now() - last < COMMAND_COOLDOWN_MS;
}

export function setCommandCooldown(channelId: string, command: string): void {
  _commandCooldowns.set(`${channelId}:${command}`, Date.now());
}
