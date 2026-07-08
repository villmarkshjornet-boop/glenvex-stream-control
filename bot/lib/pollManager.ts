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
import { logSystemEvent, completeMission } from './systemEvents';

// ─── Constants ────────────────────────────────────────────────────────────────

const CHECK_INTERVAL_MS          = 5 * 60_000;   // Evaluate every 5 minutes
const POLL_COOLDOWN_MS           = 65 * 60_000;  // Max 1 poll per 65 minutes (~3 polls per 4h stream)
const MIN_STREAM_DURATION_MS     = 15 * 60_000;  // Don't poll first 15 minutes
const TWITCH_POLL_DURATION_MS    = 90_000;        // 90 second Twitch poll
const DISCORD_POLL_DURATION_MS   = 5 * 60_000;   // 5 minute Discord poll
const DISCORD_REACTIONS          = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];

// ─── Types ────────────────────────────────────────────────────────────────────

type PollType =
  | 'GAME_PREFERENCE'
  | 'CONTENT_TYPE'
  | 'PARTNER_FIT'
  | 'GIVEAWAY_CHECK'
  | 'STREAM_DIRECTION';

const POLL_TYPE_ROTATION: PollType[] = [
  'STREAM_DIRECTION',
  'CONTENT_TYPE',
  'GAME_PREFERENCE',
  'GIVEAWAY_CHECK',
  'PARTNER_FIT',
];

interface PollOption {
  label: string;
  twitchVotes: number;
  discordVotes: number;
}

interface PollContext {
  recentGames:      string[];
  activePartners:   string[];
  currentGame:      string | null;
  aiMemoryHints:    string[];
  lastPollResults:  string[];
  usedQuestions:    string[];   // recently asked question texts — cross-session dedup
  chatActivity:     'dead' | 'low' | 'medium' | 'high';
  streamDurationMin: number;
  topicScores:      Map<string, { engagementScore: number; negativeCount: number; lastAskedAt: string | null; askedCount: number }>;
}

export interface PollManagerConfig {
  workspaceId:      string;
  streamId:         string;
  streamStartedAt:  number;
  brandName?:       string;
  chatMsgsPerMin:   () => number;    // getter for current chat rate
  // Twitch native poll (channel:manage:polls) — preferred over chat text poll
  twitchNativePoll?: (question: string, choices: string[], durationSec: number) => Promise<number[] | null>;
  // Twitch chat fallback (used if twitchNativePoll not provided or returns null)
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
  private _pendingDecisionReason: { reason: string; signals: Record<string, unknown>; exploration: boolean } | null = null;
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

    // ── Dashboard-requested poll — checked FIRST, bypasses cooldown + min-duration guards ──
    // User explicitly clicked "Start poll" — don't block them with AI rotation rules.
    const requested = await this.pickRequestedPoll();
    if (requested) {
      const context = await this.buildContext(streamAgeMs, msgsPerMin);
      logSystemEvent({
        workspaceId: this.cfg.workspaceId,
        source: 'poll_manager',
        event_type: 'POLL_DASHBOARD_REQUEST_PICKED',
        title: `Dashboard-poll plukket: "${requested.question}"`,
        severity: 'info',
        metadata: { streamId: this.cfg.streamId, question: requested.question, options: requested.options, cooldownLeftMin: Math.round(cooldownLeft / 60_000) },
      });
      this.pollInProgress = true;
      this.runPoll('STREAM_DIRECTION', requested.question, requested.options, 'Dashboard-anmodet poll', context)
        .catch(err => console.error('[PollManager] dashboard-poll error:', err?.message))
        .finally(() => { this.pollInProgress = false; });
      return;
    }

    // ── Guard: too early (only applies to AI-initiated polls) ────────────────
    if (streamAgeMs < MIN_STREAM_DURATION_MS) {
      this.logSkip('For tidlig i streamen (< 5 min)', { streamAgeMin: Math.round(streamAgeMs / 60_000) });
      return;
    }

    // ── Guard: cooldown (only applies to AI-initiated polls) ─────────────────
    if (cooldownLeft > 0) {
      this.logSkip(`Cooldown aktiv (${Math.round(cooldownLeft / 60_000)} min igjen)`, { cooldownLeftMin: Math.round(cooldownLeft / 60_000) });
      return;
    }

    // ── Guard: chat dead (skip unless we're trying to wake it) ───────────────
    const chatDead = msgsPerMin === 0;

    // ── Build context ────────────────────────────────────────────────────────
    const context = await this.buildContext(streamAgeMs, msgsPerMin);

    // ── Choose poll type (skips recently asked questions via ctx.usedQuestions) ──
    const pollType = this.choosePollType(context, chatDead);
    if (!pollType) {
      this.logSkip('Ingen egnet poll-type for nåværende kontekst', { chatDead, recentGames: context.recentGames, usedQuestionsCount: context.usedQuestions.length });
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

  // Pick up oldest pending dashboard-requested poll for this workspace
  private async pickRequestedPoll(): Promise<{ question: string; options: string[] } | null> {
    const db = getBotDb();
    if (!db) return null;

    const { data, error } = await db
      .from('poll_events')
      .select('id, question, options')
      .eq('workspace_id', this.cfg.workspaceId)
      .eq('status', 'requested')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (error || !data) return null;

    // Claim the row (set active + real stream_id)
    try {
      await db.from('poll_events').update({
        status:    'active',
        stream_id: this.cfg.streamId,
      }).eq('id', data.id);
    } catch {}

    const options = ((data.options ?? []) as any[])
      .map((o: any) => (typeof o === 'string' ? o : (o?.label ?? '')))
      .filter(Boolean) as string[];

    return options.length >= 2 ? { question: data.question, options } : null;
  }

  // ─── Context builder ────────────────────────────────────────────────────────

  private async buildContext(streamAgeMs: number, msgsPerMin: number): Promise<PollContext> {
    const db = getBotDb();
    const ws = this.cfg.workspaceId;

    let recentGames: string[]    = [];
    let activePartners: string[] = [];
    let aiMemoryHints: string[]  = [];
    let lastPollResults: string[] = [];
    let usedQuestions: string[]  = [];

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

      // Question texts asked in the last 48h — skip repeating the same question too soon.
      // 48h (not 7d) so weekly streamers still get all question types each stream.
      const fortyEightHoursAgo = new Date(Date.now() - 48 * 3600_000).toISOString();
      const { data: recentQs } = await db
        .from('poll_events')
        .select('question')
        .eq('workspace_id', ws)
        .neq('status', 'failed')
        .gte('created_at', fortyEightHoursAgo)
        .limit(15);
      usedQuestions = (recentQs ?? []).map((p: any) => p.question as string).filter(Boolean);
    }

    // Load topic engagement scores for choosePollType scoring
    let topicScores: Map<string, { engagementScore: number; negativeCount: number; lastAskedAt: string | null; askedCount: number }> = new Map();
    if (db) {
      const { data: scores } = await db
        .from('poll_topic_scores')
        .select('topic_key,engagement_score,negative_count,last_asked_at,asked_count')
        .eq('workspace_id', ws);
      for (const s of (scores ?? [])) {
        topicScores.set(s.topic_key, {
          engagementScore: s.engagement_score ?? 0.5,
          negativeCount:   s.negative_count   ?? 0,
          lastAskedAt:     s.last_asked_at    ?? null,
          askedCount:      s.asked_count      ?? 0,
        });
      }
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
      usedQuestions,
      chatActivity,
      streamDurationMin: Math.round(streamAgeMs / 60_000),
      topicScores,
    };
  }

  // ─── Poll type selector ──────────────────────────────────────────────────────

  private choosePollType(ctx: PollContext, chatDead: boolean): PollType | null {
    const now = Date.now();

    // Score each poll type
    const scored: Array<{ type: PollType; score: number; reason: string; blocked: boolean }> = POLL_TYPE_ROTATION.map(type => {
      // ── Hard blockers ──
      if (type === this.lastPollType) return { type, score: -1, reason: 'Same as last poll this session', blocked: true };
      if (type === 'GAME_PREFERENCE' && ctx.recentGames.length < 2) return { type, score: -1, reason: 'Not enough recent games', blocked: true };
      if (type === 'PARTNER_FIT' && ctx.activePartners.length < 2) return { type, score: -1, reason: 'Not enough active partners', blocked: true };
      if (chatDead && type === 'PARTNER_FIT') return { type, score: -1, reason: 'Chat dead, skip PARTNER_FIT', blocked: true };

      // 48h exact-match dedup
      const preview = this.buildPoll(type, ctx);
      if (preview && ctx.usedQuestions.includes(preview.question)) {
        return { type, score: -1, reason: 'Question used in last 48h', blocked: true };
      }

      // ── Scoring ──
      let score = 0.5; // base
      let reason = 'baseline';

      const topicData = ctx.topicScores.get(type);

      // Historical engagement boost/penalty from poll_topic_scores
      if (topicData) {
        const daysSinceAsked = topicData.lastAskedAt
          ? (now - new Date(topicData.lastAskedAt).getTime()) / (24 * 3600_000)
          : 99;

        // Engagement score boost (0 to +0.3)
        score += (topicData.engagementScore - 0.5) * 0.6;

        // Negative signal penalty
        const negRate = topicData.askedCount > 0 ? topicData.negativeCount / topicData.askedCount : 0;
        if (negRate > 0.5) score -= 0.2; // more than half attempts had low engagement

        // Recency penalty — asked within 7 days but more than 48h (not hard blocked)
        if (daysSinceAsked < 7) score -= 0.15 * (1 - daysSinceAsked / 7);

        reason = `eng=${topicData.engagementScore.toFixed(2)},neg=${topicData.negativeCount},daysSince=${daysSinceAsked.toFixed(1)}`;
      }

      // ai_agent_memory boost: if memory hints mention games and type is GAME_PREFERENCE
      if (type === 'GAME_PREFERENCE' && ctx.aiMemoryHints.some(h => h.startsWith('[game]') || h.startsWith('[stream_pattern]'))) {
        score += 0.18;
        reason += ',memBoost=game';
      }

      // STREAM_DIRECTION bonus when chat is active (good for live engagement)
      if (type === 'STREAM_DIRECTION' && (ctx.chatActivity === 'high' || ctx.chatActivity === 'medium')) {
        score += 0.1;
      }

      // CONTENT_TYPE bonus when audience_preference memory exists
      if (type === 'CONTENT_TYPE' && ctx.aiMemoryHints.some(h => h.startsWith('[audience_preference]'))) {
        score += 0.12;
        reason += ',memBoost=audience';
      }

      return { type, score: Math.max(0, Math.min(1, score)), reason, blocked: false };
    });

    const eligible = scored.filter(s => !s.blocked);
    if (eligible.length === 0) {
      // All blocked — fall back to STREAM_DIRECTION
      this.logSkip('Alle poll-typer blokkert — faller tilbake til STREAM_DIRECTION', { usedCount: ctx.usedQuestions.length });
      return 'STREAM_DIRECTION';
    }

    // Explore/exploit: 20% chance to pick non-top type for variety
    const explore = Math.random() < 0.2;
    let chosen: typeof eligible[0];

    if (explore && eligible.length > 1) {
      // Pick a random type that wasn't the best scorer (for variety)
      const sorted = [...eligible].sort((a, b) => b.score - a.score);
      const nonTop = sorted.slice(1); // exclude best
      chosen = nonTop[Math.floor(Math.random() * nonTop.length)];
      chosen = { ...chosen, reason: chosen.reason + ',explore=true' };
    } else {
      // Exploit: pick highest scoring
      chosen = eligible.reduce((best, s) => s.score > best.score ? s : best);
    }

    // Store decision reason for this poll (used in createPollRecord)
    this._pendingDecisionReason = {
      reason: `Valgte ${chosen.type} (score=${chosen.score.toFixed(2)}): ${chosen.reason}`,
      signals: {
        recentGame: ctx.recentGames[0] ?? null,
        memoryHints: ctx.aiMemoryHints.slice(0, 3),
        engagementScore: ctx.topicScores.get(chosen.type)?.engagementScore ?? null,
        exploration: explore,
        allScores: Object.fromEntries(eligible.map(s => [s.type, s.score.toFixed(2)])),
      },
      exploration: explore,
    };

    return chosen.type;
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
      this.runTwitchPoll(question, options),
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

    // Auto-complete the 'poll' mission if at least one platform succeeded
    const atLeastOneOk = twitchResult.status === 'fulfilled' || discordResult.status === 'fulfilled';
    if (atLeastOneOk) {
      completeMission(ws, 'poll', 'bot_ran_poll', {
        streamId, pollType, question,
        twitchOk: twitchResult.status === 'fulfilled',
        discordOk: discordResult.status === 'fulfilled',
        totalVotes,
      });
    } else {
      logSystemEvent({
        workspaceId: ws, source: 'poll_manager', event_type: 'POLL_FAILED',
        title: `Poll feilet på alle plattformer: ${pollType}`,
        severity: 'warning',
        metadata: { streamId, pollType, question,
          twitchError: twitchResult.status === 'rejected' ? String((twitchResult as PromiseRejectedResult).reason)?.slice(0, 150) : null,
          discordError: discordResult.status === 'rejected' ? String((discordResult as PromiseRejectedResult).reason)?.slice(0, 150) : null,
        },
      });
    }

    logSystemEvent({
      workspaceId: ws, source: 'poll_manager', event_type: 'POLL_RESULT_COLLECTED',
      title: `Poll ferdig: ${pollType} — vinner "${winner?.label ?? 'ingen svar'}" (${totalVotes} stemmer)`,
      severity: 'info',
      metadata: { streamId, pollType, question, winner: winner?.label, totalVotes, options: options.map(o => ({ label: o.label, votes: o.twitchVotes + o.discordVotes })) },
    });
  }

  // ─── Twitch poll — native API first, chat text fallback ─────────────────────

  private async runTwitchPoll(question: string, options: PollOption[]): Promise<number[]> {
    const durationSec = Math.round(TWITCH_POLL_DURATION_MS / 1000);

    // Prefer native Twitch poll (shows in stream overlay, no chat required)
    if (this.cfg.twitchNativePoll) {
      try {
        const votes = await this.cfg.twitchNativePoll(
          question,
          options.map(o => o.label),
          durationSec,
        );
        if (votes) {
          logSystemEvent({
            workspaceId: this.cfg.workspaceId, source: 'poll_manager', event_type: 'POLL_POSTED_TWITCH',
            title: 'Native Twitch poll startet via REST API', severity: 'info',
            metadata: { streamId: this.cfg.streamId, question, options: options.map(o => o.label) },
          });
          return votes;
        }
      } catch {}
    }

    // Fallback: text poll in chat
    return new Promise<number[]>((resolve) => {
      const voteCounts = new Array(options.length).fill(0) as number[];
      const votedUsers = new Set<string>();
      const optLines   = options.map((o, i) => `${i + 1}) ${o.label}`).join(' | ');

      this.cfg.sendTwitchChat(`📊 Poll: ${optLines} — Svar med tall! (${durationSec}s)`);

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
        title: 'Poll postet til Twitch chat (tekst-fallback)', severity: 'info',
        metadata: { streamId: this.cfg.streamId, question, options: options.map(o => o.label) },
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
      footer: { text: `Stem med emoji under! ${this.cfg.brandName ?? 'Community'} Poll` },
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
        workspace_id:    this.cfg.workspaceId,
        stream_id:       this.cfg.streamId,
        poll_type:       opts.pollType,
        platform:        'both',
        question:        opts.question,
        options:         opts.options.map(o => ({ label: o.label, twitchVotes: 0, discordVotes: 0 })),
        reason:          opts.reason,
        context:         { recentGames: opts.ctx.recentGames, chatActivity: opts.ctx.chatActivity, streamDurationMin: opts.ctx.streamDurationMin },
        status:          'active',
        decision_reason: this._pendingDecisionReason ?? null,
      }).select('id').single();

      if (error) throw error;
      const pollId = data?.id ?? null;
      this._pendingDecisionReason = null;
      return pollId;
    } catch (err: any) {
      this._pendingDecisionReason = null;
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
      try {
        await db.from('poll_events').update({
          status:       'closed',
          winner:       opts.winner?.label ?? null,
          total_votes:  opts.totalVotes,
          options:      opts.options.map(o => ({ label: o.label, twitchVotes: o.twitchVotes, discordVotes: o.discordVotes })),
          closed_at:    now,
        }).eq('id', opts.pollId);
      } catch {}
    }

    if (opts.totalVotes === 0 || !opts.winner) return;

    const winnerVotes = opts.winner.twitchVotes + opts.winner.discordVotes;
    const confidence  = Math.min(0.95, 0.4 + opts.totalVotes * 0.03);
    const summary     = `Poll '${opts.question}': "${opts.winner.label}" vant med ${winnerVotes}/${opts.totalVotes} stemmer. Grunn: ${opts.reason}`;

    // Write learning to ai_agent_memory
    try {
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
      }, { onConflict: 'workspace_id,key' });
    } catch {}

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

    // Write question to dedup history in ai_agent_memory (Creator Brain V2 input)
    // This lets Creator Brain V2 read poll_question_history without scanning poll_events.
    try {
      await db.from('ai_agent_memory').upsert({
        workspace_id:     ws,
        agent_type:       'poll_manager',
        memory_type:      'poll_question',
        key:              'poll_question_history',
        summary:          `Siste poll-spørsmål (dedup + Creator Brain V2 input)`,
        confidence_score: 0.9,
        metadata: {
          lastQuestion: opts.question,
          lastType:     opts.pollType,
          lastWinner:   opts.winner.label,
          lastRunAt:    now,
        },
        updated_at: now,
      }, { onConflict: 'workspace_id,key' });
    } catch {}

    // Update poll_topic_scores for learning-based type selection
    try {
      const engScore = opts.totalVotes > 0 ? Math.min(1.0, opts.totalVotes / 20) : 0;
      const negSignal = opts.totalVotes < 3;

      const { data: existing } = await db
        .from('poll_topic_scores')
        .select('asked_count,total_votes,negative_count')
        .eq('workspace_id', ws)
        .eq('topic_key', opts.pollType)
        .maybeSingle();

      const prevAsked = existing?.asked_count ?? 0;
      const prevTotal = existing?.total_votes ?? 0;
      const prevNeg   = existing?.negative_count ?? 0;
      const newAsked  = prevAsked + 1;
      const newTotal  = prevTotal + opts.totalVotes;

      await db.from('poll_topic_scores').upsert({
        workspace_id:     ws,
        topic_key:        opts.pollType,
        poll_type:        opts.pollType,
        asked_count:      newAsked,
        total_votes:      newTotal,
        avg_votes:        Math.round(newTotal / newAsked),
        engagement_score: engScore,
        negative_count:   prevNeg + (negSignal ? 1 : 0),
        last_winner:      opts.winner?.label ?? null,
        last_asked_at:    now,
        updated_at:       now,
      }, { onConflict: 'workspace_id,topic_key' });
    } catch {}
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
