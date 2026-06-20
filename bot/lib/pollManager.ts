/**
 * Poll Learning Engine — V1
 *
 * Runs alongside Live Agent during streams. Every 5 minutes it evaluates
 * whether a poll should be run. If conditions are met, it runs the poll
 * on Twitch (chat numbers) and Discord (emoji reactions) in parallel.
 * Results are saved to poll_events + ai_agent_memory and logged to system_events.
 *
 * Poll types:
 *   GAME_PREFERENCE   — what games viewers want next
 *   CONTENT_TYPE      — what kind of content they want more of
 *   PARTNER_FIT       — which partner category fits best
 *   GIVEAWAY_CHECK    — should we run a giveaway
 *   STREAM_DIRECTION  — what to do next in the current stream
 *   DISCORD_GROWTH    — discord engagement check
 */

import { getBotDb } from './supabase';
import { logSystemEvent } from './systemEvents';

// ─── Constants ────────────────────────────────────────────────────────────────

const CHECK_INTERVAL_MS          = 5 * 60_000;   // Evaluate every 5 minutes
const POLL_COOLDOWN_MS           = 35 * 60_000;  // Max 1 poll per 35 minutes
const MIN_STREAM_DURATION_MS     = 5 * 60_000;   // Don't poll first 5 minutes
const TWITCH_POLL_DURATION_MS    = 90_000;        // 90 second Twitch poll
const DISCORD_POLL_DURATION_MS   = 5 * 60_000;   // 5 minute Discord poll
const DISCORD_REACTIONS          = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];

// ─── Types ────────────────────────────────────────────────────────────────────

type PollType =
  | 'GAME_PREFERENCE'
  | 'CONTENT_TYPE'
  | 'PARTNER_FIT'
  | 'GIVEAWAY_CHECK'
  | 'STREAM_DIRECTION'
  | 'DISCORD_GROWTH';

const POLL_TYPE_ROTATION: PollType[] = [
  'GAME_PREFERENCE',
  'CONTENT_TYPE',
  'STREAM_DIRECTION',
  'PARTNER_FIT',
  'GIVEAWAY_CHECK',
  'DISCORD_GROWTH',
];

interface PollOption {
  label: string;
  twitchVotes: number;
  discordVotes: number;
}

interface PollContext {
  recentGames:     string[];
  activePartners:  string[];
  currentGame:     string | null;
  aiMemoryHints:   string[];
  lastPollResults: string[];
  chatActivity:    'dead' | 'low' | 'medium' | 'high';
  streamDurationMin: number;
}

export interface PollManagerConfig {
  workspaceId:      string;
  streamId:         string;
  streamStartedAt:  number;
  chatMsgsPerMin:   () => number;    // getter for current chat rate
  // Twitch
  sendTwitchChat:   (msg: string) => void;
  onChatMessage:    (handler: (username: string, msg: string) => void) => void;
  offChatMessage:   (handler: (username: string, msg: string) => void) => void;
  // Discord (all optional — Twitch-only if not provided)
  discordSendPoll?: (embed: object) => Promise<string | null>;    // returns messageId
  discordAddReaction?:     (messageId: string, emoji: string) => Promise<void>;
  discordGetReactionCount?: (messageId: string, emoji: string) => Promise<number>;
}

// ─── Poll Manager Class ───────────────────────────────────────────────────────

export class PollManager {
  private cfg: PollManagerConfig;
  private stopped          = false;
  private pollInProgress   = false;
  private lastPollAt       = 0;
  private lastPollType: PollType | null = null;
  private pollTypeIndex    = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: PollManagerConfig) {
    this.cfg = config;
  }

  start(): void {
    logSystemEvent({
      workspaceId: this.cfg.workspaceId,
      source: 'poll_manager',
      event_type: 'POLL_MANAGER_STARTED',
      title: 'Poll Manager startet — evaluerer poll-muligheter hvert 5. minutt',
      severity: 'info',
      metadata: { streamId: this.cfg.streamId },
    });
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    logSystemEvent({
      workspaceId: this.cfg.workspaceId,
      source: 'poll_manager',
      event_type: 'POLL_MANAGER_STOPPED',
      title: 'Poll Manager stoppet',
      severity: 'info',
      metadata: { streamId: this.cfg.streamId, lastPollType: this.lastPollType },
    });
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.evaluate().catch(err => {
        console.error('[PollManager] evaluate error:', err?.message);
      }).finally(() => {
        this.scheduleNext();
      });
    }, CHECK_INTERVAL_MS);
  }

  private async evaluate(): Promise<void> {
    if (this.stopped || this.pollInProgress) return;

    const now          = Date.now();
    const streamAgeMs  = now - this.cfg.streamStartedAt;
    const cooldownLeft = this.lastPollAt > 0 ? (this.lastPollAt + POLL_COOLDOWN_MS) - now : 0;
    const msgsPerMin   = this.cfg.chatMsgsPerMin();

    // ── Guard: too early ─────────────────────────────────────────────────────
    if (streamAgeMs < MIN_STREAM_DURATION_MS) {
      this.logSkip('For tidlig i streamen (< 5 min)', { streamAgeMin: Math.round(streamAgeMs / 60_000) });
      return;
    }

    // ── Guard: cooldown ──────────────────────────────────────────────────────
    if (cooldownLeft > 0) {
      this.logSkip(`Cooldown aktiv (${Math.round(cooldownLeft / 60_000)} min igjen)`, { cooldownLeftMin: Math.round(cooldownLeft / 60_000) });
      return;
    }

    // ── Guard: chat dead (skip unless we're trying to wake it) ───────────────
    const chatDead = msgsPerMin === 0;

    // ── Build context ────────────────────────────────────────────────────────
    const context = await this.buildContext(streamAgeMs, msgsPerMin);

    // ── Choose poll type ─────────────────────────────────────────────────────
    const pollType = this.choosePollType(context, chatDead);
    if (!pollType) {
      this.logSkip('Ingen egnet poll-type for nåværende kontekst', { chatDead, recentGames: context.recentGames });
      return;
    }

    // ── Build question ────────────────────────────────────────────────────────
    const poll = this.buildPoll(pollType, context);
    if (!poll || poll.options.length < 2) {
      this.logSkip(`Ikke nok alternativer for ${pollType}`, { pollType });
      return;
    }

    logSystemEvent({
      workspaceId: this.cfg.workspaceId,
      source: 'poll_manager',
      event_type: 'POLL_OPPORTUNITY_EVALUATED',
      title: `Poll klar: ${pollType} — "${poll.question}"`,
      severity: 'info',
      metadata: {
        streamId: this.cfg.streamId, pollType, question: poll.question,
        options: poll.options, reason: poll.reason, chatDead,
      },
    });

    // ── Run poll (non-blocking so stream loop isn't held up) ─────────────────
    this.pollInProgress = true;
    this.runPoll(pollType, poll.question, poll.options, poll.reason, context)
      .catch(err => console.error('[PollManager] runPoll error:', err?.message))
      .finally(() => { this.pollInProgress = false; });
  }

  // ─── Context builder ────────────────────────────────────────────────────────

  private async buildContext(streamAgeMs: number, msgsPerMin: number): Promise<PollContext> {
    const db = getBotDb();
    const ws = this.cfg.workspaceId;

    let recentGames: string[]    = [];
    let activePartners: string[] = [];
    let aiMemoryHints: string[]  = [];
    let lastPollResults: string[] = [];

    if (db) {
      // Last 5 distinct games from stream history
      const { data: history } = await db
        .from('stream_history')
        .select('game')
        .eq('workspace_id', ws)
        .order('ended_at', { ascending: false })
        .limit(8);

      recentGames = [...new Set((history ?? []).map((h: any) => h.game).filter(Boolean))].slice(0, 5);

      // Active partners
      const { data: partners } = await db
        .from('partners')
        .select('navn')
        .eq('workspace_id', ws)
        .eq('status', 'active')
        .limit(4);
      activePartners = (partners ?? []).map((p: any) => p.navn).filter(Boolean);

      // AI Memory hints
      const { data: memory } = await db
        .from('ai_agent_memory')
        .select('memory_type, content')
        .eq('workspace_id', ws)
        .in('memory_type', ['game', 'topic', 'audience_preference', 'stream_pattern'])
        .order('occurrence_count', { ascending: false })
        .limit(5);
      aiMemoryHints = (memory ?? []).map((m: any) => String(m.content).slice(0, 80));

      // Recent poll results (last 3)
      const { data: polls } = await db
        .from('poll_events')
        .select('poll_type, question, winner')
        .eq('workspace_id', ws)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .limit(3);
      lastPollResults = (polls ?? []).map((p: any) => `${p.poll_type}: "${p.winner ?? 'ukjent'}"`);
    }

    const chatActivity: PollContext['chatActivity'] =
      msgsPerMin === 0 ? 'dead' :
      msgsPerMin < 3   ? 'low' :
      msgsPerMin < 10  ? 'medium' : 'high';

    return {
      recentGames,
      activePartners,
      currentGame: null, // populated from CreatorState if available
      aiMemoryHints,
      lastPollResults,
      chatActivity,
      streamDurationMin: Math.round(streamAgeMs / 60_000),
    };
  }

  // ─── Poll type selector ──────────────────────────────────────────────────────

  private choosePollType(ctx: PollContext, chatDead: boolean): PollType | null {
    // Try to go through the rotation, skip types we can't build well
    for (let attempts = 0; attempts < POLL_TYPE_ROTATION.length; attempts++) {
      const type = POLL_TYPE_ROTATION[this.pollTypeIndex % POLL_TYPE_ROTATION.length];
      this.pollTypeIndex++;

      // Don't repeat last type
      if (type === this.lastPollType) continue;

      // GAME_PREFERENCE requires at least 3 recent games
      if (type === 'GAME_PREFERENCE' && ctx.recentGames.length < 2) continue;

      // PARTNER_FIT requires active partners
      if (type === 'PARTNER_FIT' && ctx.activePartners.length < 2) continue;

      // If chat is dead, skip DISCORD_GROWTH (useless) unless it's a wake-chat attempt
      if (chatDead && type === 'DISCORD_GROWTH') continue;

      return type;
    }
    return null;
  }

  // ─── Poll builder per type ──────────────────────────────────────────────────

  private buildPoll(type: PollType, ctx: PollContext): { question: string; options: string[]; reason: string } | null {
    switch (type) {
      case 'GAME_PREFERENCE': {
        const games = ctx.recentGames.slice(0, 4);
        if (games.length < 2) return null;
        return {
          question: 'Hva vil dere se mest av neste stream?',
          options: games,
          reason: 'Hjelper streameren prioritere spill basert på hva community vil ha',
        };
      }

      case 'CONTENT_TYPE':
        return {
          question: 'Hva vil dere ha mer av?',
          options: ['Mer action', 'Morsomme øyeblikk', 'Guides & tips', 'Full VOD'],
          reason: 'Lærer om content-preferanser for fremtidig planlegging',
        };

      case 'PARTNER_FIT': {
        const partners = ctx.activePartners.slice(0, 4);
        if (partners.length < 2) return null;
        return {
          question: 'Hvilken type produkt bruker du mest?',
          options: partners,
          reason: 'Kartlegger hvilke partnere som resonerer med community',
        };
      }

      case 'GIVEAWAY_CHECK':
        return {
          question: 'Skal vi kjøre giveaway snart?',
          options: ['Ja, nå!', 'Ja, neste stream', 'Nei takk', 'Overrask oss'],
          reason: 'Sjekker om community ønsker giveaway og timing',
        };

      case 'STREAM_DIRECTION':
        return {
          question: 'Hva skal vi gjøre videre?',
          options: ['Fortsette her', 'Bytte game mode', 'Spille med viewers', 'Ta en challenge'],
          reason: 'Gir community medbestemmelse over stream-retning',
        };

      case 'DISCORD_GROWTH':
        return {
          question: 'Vil du ha mer aktivitet i Discord?',
          options: ['Ja, absolutt!', 'Nei, bra sånn', 'Bare ved events', 'Hva er Discord?'],
          reason: 'Kartlegger Discord-engasjement og vekstpotensial',
        };
    }
  }

  // ─── Run poll on both platforms ──────────────────────────────────────────────

  private async runPoll(
    pollType: PollType,
    question: string,
    optionLabels: string[],
    reason: string,
    ctx: PollContext,
  ): Promise<void> {
    const ws       = this.cfg.workspaceId;
    const streamId = this.cfg.streamId;

    const options: PollOption[] = optionLabels.map(label => ({ label, twitchVotes: 0, discordVotes: 0 }));

    // Create DB record
    const pollId = await this.createPollRecord({ pollType, question, options, reason, ctx });

    // Run Twitch + Discord in parallel — each fails independently
    const [twitchResult, discordResult] = await Promise.allSettled([
      this.runTwitchChatPoll(options),
      this.runDiscordReactionPoll(question, options),
    ]);

    // Collect results
    if (twitchResult.status === 'fulfilled') {
      twitchResult.value.forEach((votes, i) => { options[i].twitchVotes = votes; });
    } else {
      logSystemEvent({
        workspaceId: ws, source: 'poll_manager', event_type: 'POLL_POST_FAILED',
        title: `Twitch-poll feilet: ${String(twitchResult.reason)?.slice(0, 80)}`,
        severity: 'warning', metadata: { streamId, platform: 'twitch', error: String(twitchResult.reason) },
      });
    }

    if (discordResult.status === 'fulfilled') {
      discordResult.value.forEach((votes, i) => { options[i].discordVotes = votes; });
    } else {
      const discordErr = String((discordResult as PromiseRejectedResult).reason);
      if (!discordErr.includes('mangler Discord')) {
        logSystemEvent({
          workspaceId: ws, source: 'poll_manager', event_type: 'POLL_POST_FAILED',
          title: `Discord-poll feilet: ${discordErr.slice(0, 80)}`,
          severity: 'warning', metadata: { streamId, platform: 'discord', error: discordErr },
        });
      }
    }

    // Merge votes and find winner
    const totalVotes    = options.reduce((s, o) => s + o.twitchVotes + o.discordVotes, 0);
    const winner        = totalVotes > 0
      ? options.reduce((best, o) =>
          (o.twitchVotes + o.discordVotes) > (best.twitchVotes + best.discordVotes) ? o : best
        )
      : null;

    // Save results
    await this.savePollResult({ pollId, pollType, question, options, winner, totalVotes, reason });

    this.lastPollAt   = Date.now();
    this.lastPollType = pollType;

    // Announce result in Twitch chat if we got any votes
    if (totalVotes > 0 && winner) {
      const resultMsg = `📊 Resultat: ${options.map(o => `${o.label} ${o.twitchVotes + o.discordVotes}`).join(' | ')} — Vinner: ${winner.label}! (${totalVotes} stemmer)`;
      try { this.cfg.sendTwitchChat(resultMsg); } catch {}
    }

    logSystemEvent({
      workspaceId: ws, source: 'poll_manager', event_type: 'POLL_RESULT_COLLECTED',
      title: `Poll ferdig: ${pollType} — vinner "${winner?.label ?? 'ingen svar'}" (${totalVotes} stemmer)`,
      severity: 'info',
      metadata: { streamId, pollType, question, winner: winner?.label, totalVotes, options: options.map(o => ({ label: o.label, votes: o.twitchVotes + o.discordVotes })) },
    });
  }

  // ─── Twitch chat poll ────────────────────────────────────────────────────────

  private runTwitchChatPoll(options: PollOption[]): Promise<number[]> {
    return new Promise<number[]>((resolve) => {
      const voteCounts   = new Array(options.length).fill(0) as number[];
      const votedUsers   = new Set<string>();
      const optLines     = options.map((o, i) => `${i + 1}) ${o.label}`).join(' | ');
      const durationSek  = Math.round(TWITCH_POLL_DURATION_MS / 1000);

      const pollMsg = `📊 ${options[0].label !== undefined ? '' : ''}Poll: Svar med tall! ${optLines} (${durationSek}s)`;
      this.cfg.sendTwitchChat(`📊 Poll: ${optLines} — Svar med tall! (${durationSek}s)`);

      const handler = (username: string, msg: string) => {
        const idx = parseInt(msg.trim(), 10) - 1;
        if (idx >= 0 && idx < options.length && !votedUsers.has(username)) {
          votedUsers.add(username);
          voteCounts[idx]++;
        }
      };

      this.cfg.onChatMessage(handler);

      logSystemEvent({
        workspaceId: this.cfg.workspaceId, source: 'poll_manager', event_type: 'POLL_POSTED_TWITCH',
        title: 'Poll postet til Twitch chat', severity: 'info',
        metadata: { streamId: this.cfg.streamId, options: options.map(o => o.label) },
      });

      setTimeout(() => {
        this.cfg.offChatMessage(handler);
        resolve(voteCounts);
      }, TWITCH_POLL_DURATION_MS);
    });
  }

  // ─── Discord reaction poll ───────────────────────────────────────────────────

  private async runDiscordReactionPoll(question: string, options: PollOption[]): Promise<number[]> {
    const { discordSendPoll, discordAddReaction, discordGetReactionCount } = this.cfg;
    if (!discordSendPoll || !discordAddReaction || !discordGetReactionCount) {
      throw new Error('mangler Discord callbacks');
    }

    const usedReactions = DISCORD_REACTIONS.slice(0, options.length);
    const description   = options.map((o, i) => `${usedReactions[i]} ${o.label}`).join('\n');

    const embed = {
      title: `📊 ${question}`,
      description: `${description}\n\nAvstemningen stenger om ${Math.round(DISCORD_POLL_DURATION_MS / 60_000)} minutter.`,
      color: 0x00e676,
      footer: { text: 'Stem med emoji under! GLENVEX Poll' },
      timestamp: new Date().toISOString(),
    };

    const messageId = await discordSendPoll({ embeds: [embed] });
    if (!messageId) throw new Error('Discord send returnerte ingen messageId');

    // Add bot reactions as prompts
    for (const emoji of usedReactions) {
      await discordAddReaction(messageId, emoji).catch(() => {});
      await new Promise(r => setTimeout(r, 400));
    }

    logSystemEvent({
      workspaceId: this.cfg.workspaceId, source: 'poll_manager', event_type: 'POLL_POSTED_DISCORD',
      title: 'Poll postet til Discord', severity: 'info',
      metadata: { streamId: this.cfg.streamId, messageId, options: options.map(o => o.label) },
    });

    await new Promise(r => setTimeout(r, DISCORD_POLL_DURATION_MS));

    // Collect reaction counts (subtract 1 for bot's own reaction)
    const votes: number[] = [];
    for (let i = 0; i < usedReactions.length; i++) {
      const count = await discordGetReactionCount(messageId, usedReactions[i]).catch(() => 0);
      votes.push(Math.max(0, count - 1));
    }

    return votes;
  }

  // ─── DB helpers ──────────────────────────────────────────────────────────────

  private async createPollRecord(opts: {
    pollType: PollType;
    question: string;
    options: PollOption[];
    reason: string;
    ctx: PollContext;
  }): Promise<string | null> {
    const db = getBotDb();
    if (!db) return null;

    try {
      const { data, error } = await db.from('poll_events').insert({
        workspace_id: this.cfg.workspaceId,
        stream_id:    this.cfg.streamId,
        poll_type:    opts.pollType,
        platform:     'both',
        question:     opts.question,
        options:      opts.options.map(o => ({ label: o.label, twitchVotes: 0, discordVotes: 0 })),
        reason:       opts.reason,
        context:      { recentGames: opts.ctx.recentGames, chatActivity: opts.ctx.chatActivity, streamDurationMin: opts.ctx.streamDurationMin },
        status:       'active',
      }).select('id').single();

      if (error) throw error;
      return data?.id ?? null;
    } catch (err: any) {
      console.error('[PollManager] createPollRecord feilet:', err?.message);
      return null;
    }
  }

  private async savePollResult(opts: {
    pollId: string | null;
    pollType: PollType;
    question: string;
    options: PollOption[];
    winner: PollOption | null;
    totalVotes: number;
    reason: string;
  }): Promise<void> {
    const db = getBotDb();
    if (!db) return;

    const ws = this.cfg.workspaceId;
    const now = new Date().toISOString();

    // Close poll record
    if (opts.pollId) {
      await db.from('poll_events').update({
        status:       'closed',
        winner:       opts.winner?.label ?? null,
        total_votes:  opts.totalVotes,
        options:      opts.options.map(o => ({ label: o.label, twitchVotes: o.twitchVotes, discordVotes: o.discordVotes })),
        closed_at:    now,
      }).eq('id', opts.pollId).catch(() => {});
    }

    if (opts.totalVotes === 0 || !opts.winner) return;

    const winnerVotes = opts.winner.twitchVotes + opts.winner.discordVotes;
    const confidence  = Math.min(0.95, 0.4 + opts.totalVotes * 0.03);
    const summary     = `Poll '${opts.question}': "${opts.winner.label}" vant med ${winnerVotes}/${opts.totalVotes} stemmer. Grunn: ${opts.reason}`;

    // Write learning to ai_agent_memory
    await db.from('ai_agent_memory').upsert({
      workspace_id:     ws,
      agent_type:       'poll_learning',
      memory_type:      'audience_preference',
      key:              `poll_${opts.pollType}_latest`,
      summary,
      confidence_score: confidence,
      metadata: {
        pollType: opts.pollType, question: opts.question,
        winner: opts.winner.label, winnerVotes, totalVotes: opts.totalVotes,
        options: opts.options.map(o => ({ label: o.label, votes: o.twitchVotes + o.discordVotes })),
        streamId: this.cfg.streamId,
      },
      updated_at: now,
    }, { onConflict: 'workspace_id,key' }).catch(() => {});

    logSystemEvent({
      workspaceId: ws, source: 'poll_manager', event_type: 'POLL_LEARNING_SAVED',
      title: `AI lærte fra poll: ${opts.pollType} → "${opts.winner.label}"`,
      severity: 'info',
      metadata: { pollType: opts.pollType, winner: opts.winner.label, totalVotes: opts.totalVotes, confidence, streamId: this.cfg.streamId },
    });

    logSystemEvent({
      workspaceId: ws, source: 'poll_manager', event_type: 'AI_MEMORY_UPDATED_FROM_POLL',
      title: `AI Memory oppdatert: ${summary.slice(0, 100)}`,
      severity: 'info',
      metadata: { key: `poll_${opts.pollType}_latest`, summary, confidence },
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private logSkip(reason: string, meta: Record<string, unknown> = {}): void {
    logSystemEvent({
      workspaceId: this.cfg.workspaceId,
      source: 'poll_manager',
      event_type: 'POLL_SKIPPED',
      title: `Poll hoppes over: ${reason}`,
      severity: 'info',
      metadata: { streamId: this.cfg.streamId, reason, ...meta },
    });
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _activePollManager: PollManager | null = null;

export function startPollManager(config: PollManagerConfig): void {
  if (_activePollManager) {
    _activePollManager.stop();
    _activePollManager = null;
  }
  _activePollManager = new PollManager(config);
  _activePollManager.start();
}

export function stopPollManager(): void {
  if (_activePollManager) {
    _activePollManager.stop();
    _activePollManager = null;
  }
}
