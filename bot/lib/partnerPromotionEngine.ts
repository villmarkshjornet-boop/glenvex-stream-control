/**
 * Partner Promotion Engine — context-aware, anti-spam scoring engine.
 *
 * Decision flow:
 *   1. Check global killswitch + cooldowns → skip if triggered
 *   2. Score each active partner: relevance + historical + context - cooldown penalty
 *   3. Pick highest scorer above threshold
 *   4. If requireApproval: write partner_proposals row, return shouldPromote=false
 *   5. Else: return shouldPromote=true with message ready to send
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { getRandomActivePartner, getFeaturedPartner, PartnerInfo } from './partnerHelper';
import { logDecision } from './decisionEngine';

const WORKSPACE_ID = process.env.WORKSPACE_ID || 'glenvex-default';
const MIN_CONFIDENCE = 0.35; // minimum score to fire a promo
const MAX_POSTS_PER_STREAM_DEFAULT = 3;
const COOLDOWN_MINUTES_DEFAULT = 45;

// ── Supabase singleton ────────────────────────────────────────────────────────

let _sb: SupabaseClient | null = null;
function getSb(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const ws = require('ws');
  _sb = createClient(url, key, { realtime: { transport: ws } });
  return _sb;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PartnerBotSettings {
  enabled: boolean;
  twitchEnabled: boolean;
  discordEnabled: boolean;
  pollsEnabled: boolean;
  affiliateDisclosure: string;       // e.g. "#ad" or "partnerkode:"
  maxPostsPerStream: number;
  cooldownMinutes: number;
  pollCooldownMinutes: number;
  viewerPeakMultiplier: number;      // fire at peak if viewers > avg * multiplier
  chatSilenceMinutes: number;        // trigger after N quiet minutes
  allowBothChannels: boolean;        // post to both Twitch + Discord simultaneously
  requireApproval: boolean;          // store proposal instead of posting directly
  tone: 'natural' | 'energetic' | 'minimal';
}

export const DEFAULT_SETTINGS: PartnerBotSettings = {
  enabled: true,
  twitchEnabled: true,
  discordEnabled: true,
  pollsEnabled: false,
  affiliateDisclosure: '',
  maxPostsPerStream: MAX_POSTS_PER_STREAM_DEFAULT,
  cooldownMinutes: COOLDOWN_MINUTES_DEFAULT,
  pollCooldownMinutes: 120,
  viewerPeakMultiplier: 1.5,
  chatSilenceMinutes: 8,
  allowBothChannels: false,
  requireApproval: true,  // alpha default: require manual approval
  tone: 'natural',
};

export interface PromotionContext {
  workspaceId: string;
  streamId?: string | null;
  game: string;
  viewerCount: number;
  historicalAvgViewers: number;
  chatMessagesLastMinute: number;
  recentChatLines: string[];         // last ~20 lines for context matching
  minutesSinceLastPost: number;
  postsThisStream: number;
  settings: PartnerBotSettings;
  recentRaidAt?: number | null;      // epoch ms of last raid; null/undefined = no raid
}

export type PromotionReasonCode =
  | 'BOT_DISABLED'
  | 'NO_CHANNELS_ENABLED'
  | 'MAX_POSTS_REACHED'
  | 'COOLDOWN_ACTIVE'
  | 'CHAT_TOO_ACTIVE'
  | 'RAID_COOLDOWN'
  | 'NO_ACTIVE_PARTNERS'
  | 'LOW_SCORE'
  | 'PROPOSAL_CREATED'
  | 'AUTO_SENT';

export interface PromotionDecision {
  shouldPromote: boolean;
  reason: string;
  reasonCode: PromotionReasonCode;
  skipReason?: string;
  partnerId: string | null;
  partnerName: string | null;
  channel: 'twitch' | 'discord' | 'both' | null;
  messageTwitch: string | null;
  messageDiscord: string | null;
  affiliateUrl: string | null;
  disclosureText: string;
  confidence: number;
  cooldownApplied: boolean;
  triggerType: 'chat_silence' | 'viewer_peak' | 'context_match' | 'timer' | 'none';
  proposalId?: string | null;        // set when requireApproval=true and proposal was stored
  // V2: per-dimension scoring breakdown
  scoringDetail?: {
    relevance: number;
    historicalCtr: number;
    audienceMatch: number;
    timingScore: number;
    cooldownPenalty: number;
  } | null;
}

interface ScoredPartner {
  partner: PartnerInfo;
  score: number;
  relevanceScore: number;
  historicalScore: number;
  contextScore: number;
  cooldownPenalty: number;
  triggerType: 'chat_silence' | 'viewer_peak' | 'context_match' | 'timer';
}

// ── Settings loader ───────────────────────────────────────────────────────────

export async function loadPartnerBotSettings(workspaceId?: string): Promise<PartnerBotSettings> {
  const sb = getSb();
  if (!sb) return DEFAULT_SETTINGS;
  const ws = workspaceId ?? WORKSPACE_ID;

  try {
    const { data } = await sb
      .from('workspaces')
      .select('settings_json')
      .eq('id', ws)
      .single();

    const stored = (data?.settings_json as any)?.partnerBot;
    if (!stored) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// ── Trigger detection ─────────────────────────────────────────────────────────

function detectTrigger(ctx: PromotionContext): 'chat_silence' | 'viewer_peak' | 'context_match' | 'timer' {
  // Chat silence: very few messages last minute
  if (ctx.chatMessagesLastMinute <= 2 && ctx.minutesSinceLastPost > ctx.settings.chatSilenceMinutes) {
    return 'chat_silence';
  }

  // Viewer peak: currently above average by multiplier
  if (ctx.historicalAvgViewers > 0 && ctx.viewerCount >= ctx.historicalAvgViewers * ctx.settings.viewerPeakMultiplier) {
    return 'viewer_peak';
  }

  // Context match: game or chat keywords match partner category
  // (scored separately; fallback to timer here)
  return 'timer';
}

function chatContextScore(recentLines: string[], partnerInfo: PartnerInfo): number {
  if (recentLines.length === 0) return 0;
  const keywords = [
    partnerInfo.navn.toLowerCase(),
    ...(partnerInfo.beskrivelse?.toLowerCase().split(/\s+/).filter(w => w.length > 4) ?? []),
  ];
  const lineText = recentLines.join(' ').toLowerCase();
  const hits = keywords.filter(k => lineText.includes(k)).length;
  return Math.min(hits / Math.max(keywords.length, 1), 1);
}

// ── Historical performance score ──────────────────────────────────────────────

async function getHistoricalScore(partnerId: string, workspaceId: string): Promise<number> {
  const sb = getSb();
  if (!sb) return 0.5;

  try {
    // Prefer partners with higher engagement (audience_preferences.interest_score)
    const { data } = await sb
      .from('partner_audience_preferences')
      .select('interest_score, total_poll_votes, positive_votes')
      .eq('workspace_id', workspaceId)
      .eq('partner_id', partnerId)
      .single();

    if (!data) return 0.5; // neutral for unknown partners
    const { interest_score, total_poll_votes, positive_votes } = data;

    // Weighted: interest_score (from polls) is more reliable than raw vote counts
    if (total_poll_votes >= 5) {
      const pollRatio = positive_votes / total_poll_votes;
      return 0.4 * (interest_score ?? 0.5) + 0.6 * pollRatio;
    }
    return interest_score ?? 0.5;
  } catch {
    return 0.5;
  }
}

// ── Cooldown check ────────────────────────────────────────────────────────────

async function getPartnerCooldownPenalty(partnerId: string, workspaceId: string, cooldownMinutes: number): Promise<number> {
  const sb = getSb();
  if (!sb) return 0;

  try {
    const { data } = await sb
      .from('partners')
      .select('siste_promotert')
      .eq('workspace_id', workspaceId)
      .eq('id', partnerId)
      .single();

    if (!data?.siste_promotert) return 0;

    const minutesSince = (Date.now() - new Date(data.siste_promotert).getTime()) / 60_000;
    if (minutesSince >= cooldownMinutes) return 0;

    // Linear penalty: full cooldown remaining = penalty 1.0
    return 1 - minutesSince / cooldownMinutes;
  } catch {
    return 0;
  }
}

// ── Message generation ────────────────────────────────────────────────────────

async function generateMessage(partner: PartnerInfo, platform: 'twitch' | 'discord', ctx: PromotionContext, tone: string): Promise<string> {
  const kode = partner.rabattkode ? ` (kode: ${partner.rabattkode})` : '';
  const fallback = platform === 'twitch'
    ? `🤝 Sjekk ut ${partner.navn}! ${partner.finalUrl}${kode}`
    : `🤝 **${partner.navn}** – ${partner.beskrivelse ?? ''}\n${partner.finalUrl}${kode}`;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;

  try {
    const openai = new OpenAI({ apiKey });
    const toneHint = tone === 'energetic' ? 'Energisk og entusiastisk.' : tone === 'minimal' ? 'Kort og nøktern. Ikke emojis.' : 'Naturlig og uformell.';
    const gameHint = ctx.game ? ` Vi spiller ${ctx.game} nå.` : '';
    const platformHint = platform === 'twitch'
      ? 'Twitch chat-melding, maks 15 ord, ingen markdown.'
      : 'Discord-melding, maks 2 setninger, kan bruke bold.';

    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Skriv en norsk partner-promo for ${partner.navn}${partner.beskrivelse ? ` – ${partner.beskrivelse}` : ''}.${partner.rabattkode ? ` Rabattkode: ${partner.rabattkode}.` : ''} Lenke: ${partner.finalUrl}. ${toneHint}${gameHint} Format: ${platformHint}`,
      }],
      max_tokens: platform === 'twitch' ? 40 : 120,
      temperature: 0.8,
    });

    const ai = res.choices[0]?.message?.content?.trim() ?? '';
    if (!ai) return fallback;

    if (platform === 'twitch') {
      return ai.includes(partner.finalUrl ?? '') ? ai : `${ai} → ${partner.finalUrl}${kode}`;
    }
    return ai.includes(partner.finalUrl ?? '') ? ai : `${ai}\n${partner.finalUrl}${kode}`;
  } catch {
    return fallback;
  }
}

// ── Store proposal in DB ──────────────────────────────────────────────────────

async function storeProposal(opts: {
  workspaceId: string;
  partner: PartnerInfo;
  scored: ScoredPartner;
  messageTwitch: string | null;
  messageDiscord: string | null;
  platform: 'twitch' | 'discord' | 'both';
}): Promise<string | null> {
  const sb = getSb();
  if (!sb) return null;

  try {
    // Dedup: reuse any non-expired pending proposal for the same partner.
    // Prevents ~24 identical rows per 2-hour stream when requireApproval=true.
    if (opts.partner.id) {
      const { data: existing } = await sb
        .from('partner_proposals')
        .select('id')
        .eq('workspace_id', opts.workspaceId)
        .eq('partner_id', opts.partner.id)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .limit(1)
        .maybeSingle();
      if (existing?.id) return existing.id as string;
    }

    const { data, error } = await sb
      .from('partner_proposals')
      .insert({
        workspace_id: opts.workspaceId,
        partner_id: opts.partner.id ?? null,
        partner_name: opts.partner.navn,
        platform: opts.platform,
        trigger_type: opts.scored.triggerType,
        message_twitch: opts.messageTwitch,
        message_discord: opts.messageDiscord,
        affiliate_url: opts.partner.finalUrl,
        discount_code: opts.partner.rabattkode ?? null,
        confidence: opts.scored.score,
        scoring_detail: {
          relevance: opts.scored.relevanceScore,
          historical: opts.scored.historicalScore,
          context: opts.scored.contextScore,
          cooldown: opts.scored.cooldownPenalty,
        },
        status: 'pending',
        expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      })
      .select('id')
      .single();

    if (error) throw error;
    return data?.id ?? null;
  } catch (err: any) {
    console.error('[partnerPromotionEngine] storeProposal feilet:', err?.message);
    return null;
  }
}

// ── Log system event ──────────────────────────────────────────────────────────

async function logEvent(workspaceId: string, eventType: string, title: string, metadata: Record<string, unknown>): Promise<void> {
  const sb = getSb();
  if (!sb) return;
  try {
    await sb.from('system_events').insert({
      workspace_id: workspaceId,
      source: 'partner_bot',
      event_type: eventType,
      title,
      severity: 'info',
      metadata,
    });
  } catch {}
}

// ── Main decision function ────────────────────────────────────────────────────

export async function decidePromotion(ctx: PromotionContext): Promise<PromotionDecision> {
  const skip = (reason: string, reasonCode: PromotionReasonCode): PromotionDecision => ({
    shouldPromote: false, reason, reasonCode, skipReason: reason,
    partnerId: null, partnerName: null, channel: null,
    messageTwitch: null, messageDiscord: null, affiliateUrl: null,
    disclosureText: '', confidence: 0, cooldownApplied: false,
    triggerType: 'none', proposalId: null,
  });

  const { settings, workspaceId } = ctx;

  if (!settings.enabled) {
    void logEvent(workspaceId, 'PARTNER_PROMOTION_SKIPPED', 'Partner bot er deaktivert', { reasonCode: 'BOT_DISABLED' });
    return skip('Partner bot er deaktivert', 'BOT_DISABLED');
  }
  if (!settings.twitchEnabled && !settings.discordEnabled) {
    void logEvent(workspaceId, 'PARTNER_PROMOTION_SKIPPED', 'Ingen aktive kanaler for promo', { reasonCode: 'NO_CHANNELS_ENABLED' });
    return skip('Verken Twitch- eller Discord-promo er aktivert', 'NO_CHANNELS_ENABLED');
  }
  if (ctx.postsThisStream >= settings.maxPostsPerStream) {
    void logEvent(workspaceId, 'PARTNER_PROMOTION_SKIPPED', `Maks antall promoer nådd (${ctx.postsThisStream}/${settings.maxPostsPerStream})`, { reasonCode: 'MAX_POSTS_REACHED', postsThisStream: ctx.postsThisStream, maxPostsPerStream: settings.maxPostsPerStream });
    return skip(`Maks antall promoer (${settings.maxPostsPerStream}) nådd denne streamen`, 'MAX_POSTS_REACHED');
  }
  if (ctx.minutesSinceLastPost < settings.cooldownMinutes) {
    const minsLeft = Math.round(settings.cooldownMinutes - ctx.minutesSinceLastPost);
    void logEvent(workspaceId, 'PARTNER_PROMOTION_SKIPPED', `Cooldown aktiv: ${minsLeft} min igjen`, { reasonCode: 'COOLDOWN_ACTIVE', minsLeft, cooldownMinutes: settings.cooldownMinutes });
    return skip(`Cooldown aktiv: ${minsLeft} min igjen`, 'COOLDOWN_ACTIVE');
  }

  // V2 gate: high chat activity → block promo (not the right moment)
  // Threshold: >15 msgs/min = active conversation, promo would feel intrusive
  if (ctx.chatMessagesLastMinute > 15) {
    void logEvent(workspaceId, 'PARTNER_PROMOTION_SKIPPED', `Chat for aktiv (${ctx.chatMessagesLastMinute} msgs/min)`, { reasonCode: 'CHAT_TOO_ACTIVE', chatMessagesLastMinute: ctx.chatMessagesLastMinute });
    return skip(`Chat for aktiv (${ctx.chatMessagesLastMinute} msgs/min > 15 — ikke riktig øyeblikk for promo)`, 'CHAT_TOO_ACTIVE');
  }

  // V2 gate: raid recently happened → block promo for 10 min
  // Reason: raid moments are high-energy social moments; promo breaks the community vibe
  const RAID_COOLDOWN_MS = 10 * 60 * 1000;
  if (ctx.recentRaidAt && Date.now() - ctx.recentRaidAt < RAID_COOLDOWN_MS) {
    const minsLeft = Math.ceil((RAID_COOLDOWN_MS - (Date.now() - ctx.recentRaidAt)) / 60_000);
    void logEvent(workspaceId, 'PARTNER_PROMOTION_SKIPPED', `Raid-cooldown: ${minsLeft} min igjen`, { reasonCode: 'RAID_COOLDOWN', minsLeft });
    return skip(`Raid akkurat skjedd — venter ${minsLeft} min før promo`, 'RAID_COOLDOWN');
  }

  // Fetch candidates (featured + random to get variety)
  const [featured, random] = await Promise.all([
    getFeaturedPartner(workspaceId),
    getRandomActivePartner(workspaceId),
  ]);

  const candidates = [featured, random].filter((p): p is PartnerInfo => p !== null && p.canPost);
  const seen = new Set<string>();
  const unique = candidates.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });

  if (unique.length === 0) {
    void logEvent(workspaceId, 'PARTNER_PROMOTION_SKIPPED', 'Ingen aktive partnere med gyldig URL', { reasonCode: 'NO_ACTIVE_PARTNERS', candidateCount: candidates.length });
    return skip('Ingen aktive partnere med gyldig URL', 'NO_ACTIVE_PARTNERS');
  }

  const triggerType = detectTrigger(ctx);

  // Score all candidates
  const scored: ScoredPartner[] = await Promise.all(
    unique.map(async (partner) => {
      const relevanceScore = partner.affiliateUrl !== null ? 0.8 : 0.5;
      const historicalScore = await getHistoricalScore(partner.id, workspaceId);
      const contextScore = chatContextScore(ctx.recentChatLines, partner);
      const cooldownPenalty = await getPartnerCooldownPenalty(partner.id, workspaceId, settings.cooldownMinutes);

      // Trigger bonuses
      let triggerBonus = 0;
      if (triggerType === 'viewer_peak') triggerBonus = 0.2;
      if (triggerType === 'chat_silence') triggerBonus = 0.1;
      if (triggerType === 'context_match' || contextScore > 0.3) triggerBonus = 0.3;

      const score = Math.max(0, relevanceScore * 0.3 + historicalScore * 0.3 + contextScore * 0.2 + triggerBonus * 0.2 - cooldownPenalty * 0.5);

      return { partner, score, relevanceScore, historicalScore, contextScore, cooldownPenalty, triggerType };
    })
  );

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  if (best.score < MIN_CONFIDENCE) {
    await logEvent(workspaceId, 'PARTNER_PROMOTION_SKIPPED', `Partner promo skippet: lav score (${best.score.toFixed(2)})`, {
      reasonCode: 'LOW_SCORE', partnerId: best.partner.id, partnerName: best.partner.navn, score: best.score, triggerType,
    });
    return skip(`Score for lav (${best.score.toFixed(2)} < ${MIN_CONFIDENCE})`, 'LOW_SCORE');
  }

  // Determine channel
  const channel: 'twitch' | 'discord' | 'both' =
    settings.allowBothChannels && settings.twitchEnabled && settings.discordEnabled ? 'both' :
    settings.twitchEnabled ? 'twitch' : 'discord';

  // Generate messages
  const [msgTwitch, msgDiscord] = await Promise.all([
    (channel === 'twitch' || channel === 'both') ? generateMessage(best.partner, 'twitch', ctx, settings.tone) : Promise.resolve(null),
    (channel === 'discord' || channel === 'both') ? generateMessage(best.partner, 'discord', ctx, settings.tone) : Promise.resolve(null),
  ]);

  const disclosure = settings.affiliateDisclosure
    ? ` ${settings.affiliateDisclosure}`
    : (best.partner.missedAffiliate ? '' : '');

  await logEvent(workspaceId, 'PARTNER_PROMOTION_CONSIDERED', `Promo vurdert: ${best.partner.navn} (score: ${best.score.toFixed(2)})`, {
    reasonCode: settings.requireApproval ? 'PROPOSAL_CREATED' : 'AUTO_SENT',
    partnerId: best.partner.id, partnerName: best.partner.navn,
    score: best.score, triggerType, channel, requireApproval: settings.requireApproval,
  });

  const scoringDetail = {
    relevance:      best.relevanceScore,
    historicalCtr:  best.historicalScore,
    audienceMatch:  best.contextScore,
    timingScore:    triggerType === 'viewer_peak' ? 0.9 : triggerType === 'chat_silence' ? 0.7 : triggerType === 'context_match' ? 0.8 : 0.5,
    cooldownPenalty: best.cooldownPenalty,
  };

  // requireApproval: store proposal, do not send yet
  if (settings.requireApproval) {
    const proposalId = await storeProposal({
      workspaceId, partner: best.partner, scored: best,
      messageTwitch: msgTwitch, messageDiscord: msgDiscord, platform: channel,
    });

    void logEvent(workspaceId, 'PARTNER_PROPOSAL_CREATED',
      `Partnerforslag opprettet: ${best.partner.navn} (score: ${best.score.toFixed(2)})`,
      { reasonCode: 'PROPOSAL_CREATED', proposalId, partnerId: best.partner.id, partnerName: best.partner.navn, score: best.score, triggerType, channel });

    // Phase 10 + 10.1: log to Decision Engine, then emit trace with result.
    // Trace captures decisionId (or null) so we know exactly if the DB write succeeded.
    logDecision({
      workspaceId,
      agentType: 'partner_promotion',
      decisionType: 'proposal_created',
      decisionSummary: `FORSLAG: ${best.partner.navn} — score: ${best.score.toFixed(2)}, trigger: ${triggerType}`,
      inputContext: {
        reasonCode: 'PROPOSAL_CREATED',
        proposalId,
        partnerId: best.partner.id,
        partnerName: best.partner.navn,
        score: best.score,
        triggerType,
        channel,
        viewerCount: ctx.viewerCount,
        game: ctx.game,
      },
    }).then(decisionId => {
      void logEvent(workspaceId, 'PARTNER_DECISION_TRACE',
        decisionId
          ? `Beslutningskjede OK: ${best.partner.navn} → ${decisionId.slice(0, 8)}`
          : `Beslutningskjede brutt: logDecision returnerte null`,
        {
          steps: ['PARTNERS_LOADED', 'SCORING_DONE', 'WINNER_FOUND', 'MESSAGES_GENERATED',
                  'PROPOSAL_STORED', 'LOG_DECISION_CALLED',
                  decisionId ? 'LOG_DECISION_SUCCESS' : 'LOG_DECISION_FAILED'],
          decisionId: decisionId ?? null,
          proposalId,
          partnerName: best.partner.navn,
          score: best.score,
          triggerType,
        });
    }).catch(() => {
      void logEvent(workspaceId, 'PARTNER_DECISION_TRACE',
        `Beslutningskjede: logDecision kastet feil`,
        {
          steps: ['PARTNERS_LOADED', 'SCORING_DONE', 'WINNER_FOUND', 'MESSAGES_GENERATED',
                  'PROPOSAL_STORED', 'LOG_DECISION_CALLED', 'LOG_DECISION_THREW'],
          proposalId,
          partnerName: best.partner.navn,
        });
    });

    return {
      shouldPromote: false,
      reason: `Forslag lagret for godkjenning (${best.partner.navn}, score ${best.score.toFixed(2)})`,
      reasonCode: 'PROPOSAL_CREATED',
      partnerId: best.partner.id, partnerName: best.partner.navn, channel,
      messageTwitch: msgTwitch, messageDiscord: msgDiscord,
      affiliateUrl: best.partner.finalUrl, disclosureText: disclosure,
      confidence: best.score, cooldownApplied: best.cooldownPenalty > 0,
      triggerType, proposalId, scoringDetail,
    };
  }

  // Phase 9 (fixed) + 10.1: log to Decision Engine, then emit trace with result.
  logDecision({
    workspaceId,
    agentType: 'partner_promotion',
    decisionType: 'promotion_candidate',
    decisionSummary: `${best.partner.navn} — score: ${best.score.toFixed(2)}, trigger: ${triggerType}`,
    inputContext: {
      reasonCode: 'AUTO_SENT',
      partnerId: best.partner.id,
      partnerName: best.partner.navn,
      score: best.score,
      triggerType,
      channel,
      viewerCount: ctx.viewerCount,
      game: ctx.game,
    },
  }).then(decisionId => {
    void logEvent(workspaceId, 'PARTNER_DECISION_TRACE',
      decisionId
        ? `Beslutningskjede OK (auto-sent): ${best.partner.navn} → ${decisionId.slice(0, 8)}`
        : `Beslutningskjede brutt (auto-sent): logDecision returnerte null`,
      {
        steps: ['PARTNERS_LOADED', 'SCORING_DONE', 'WINNER_FOUND', 'MESSAGES_GENERATED',
                'LOG_DECISION_CALLED',
                decisionId ? 'LOG_DECISION_SUCCESS' : 'LOG_DECISION_FAILED', 'AUTO_SENT'],
        decisionId: decisionId ?? null,
        partnerName: best.partner.navn,
        score: best.score,
        triggerType,
      });
  }).catch(() => {
    void logEvent(workspaceId, 'PARTNER_DECISION_TRACE',
      `Beslutningskjede (auto-sent): logDecision kastet feil`,
      {
        steps: ['PARTNERS_LOADED', 'SCORING_DONE', 'WINNER_FOUND', 'MESSAGES_GENERATED',
                'LOG_DECISION_CALLED', 'LOG_DECISION_THREW'],
        partnerName: best.partner.navn,
      });
  });

  // Auto-send
  return {
    shouldPromote: true,
    reason: `Auto-promo: ${best.partner.navn} (trigger: ${triggerType}, score: ${best.score.toFixed(2)})`,
    reasonCode: 'AUTO_SENT',
    partnerId: best.partner.id, partnerName: best.partner.navn, channel,
    messageTwitch: msgTwitch, messageDiscord: msgDiscord,
    affiliateUrl: best.partner.finalUrl, disclosureText: disclosure,
    confidence: best.score, cooldownApplied: best.cooldownPenalty > 0,
    triggerType, proposalId: null, scoringDetail,
  };
}
