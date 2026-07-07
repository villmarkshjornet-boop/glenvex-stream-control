/**
 * Partner Poll Engine — Twitch chat + Discord embed polls.
 *
 * Twitch: text message with numbered options (chat-based, no Helix API needed)
 * Discord: embed with reaction options
 *
 * After collecting responses (time-based), updates partner_audience_preferences.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const WORKSPACE_ID = process.env.WORKSPACE_ID || '';
const POLL_DURATION_MS = 60_000;       // 60 seconds default
const DISCORD_POLL_DURATION_MS = 300_000; // 5 minutes

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

export interface PollOption {
  label: string;
  value: string;
  votes: number;
}

export interface PartnerPoll {
  id: string;
  workspaceId: string;
  partnerId: string | null;
  partnerName: string;
  platform: 'twitch' | 'discord';
  question: string;
  options: PollOption[];
  status: 'active' | 'closed' | 'timed_out';
  totalResponses: number;
  winningOption: string | null;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function createPollRow(opts: {
  workspaceId: string;
  partnerId: string | null;
  partnerName: string;
  platform: 'twitch' | 'discord';
  pollType: string;
  question: string;
  options: PollOption[];
  discordMessageId?: string | null;
  twitchMessage?: string | null;
}): Promise<string | null> {
  const sb = getSb();
  if (!sb) return null;

  try {
    const { data, error } = await sb
      .from('partner_polls')
      .insert({
        workspace_id: opts.workspaceId,
        partner_id: opts.partnerId,
        partner_name: opts.partnerName,
        platform: opts.platform,
        poll_type: opts.pollType,
        question: opts.question,
        options: opts.options,
        discord_message_id: opts.discordMessageId ?? null,
        twitch_message: opts.twitchMessage ?? null,
        status: 'active',
      })
      .select('id')
      .single();

    if (error) throw error;
    return data?.id ?? null;
  } catch (err: any) {
    console.error('[partnerPollEngine] createPollRow feilet:', err?.message);
    return null;
  }
}

async function closePollRow(pollId: string, winningOption: string | null, totalResponses: number, options: PollOption[]): Promise<void> {
  const sb = getSb();
  if (!sb) return;

  try {
    await sb
      .from('partner_polls')
      .update({
        status: 'closed',
        winning_option: winningOption,
        total_responses: totalResponses,
        options,
        closed_at: new Date().toISOString(),
      })
      .eq('id', pollId);
  } catch {}
}

async function updateAudiencePreferences(opts: {
  workspaceId: string;
  partnerId: string | null;
  partnerName: string;
  positiveVotes: number;
  totalVotes: number;
  winningOption: string | null;
}): Promise<void> {
  const sb = getSb();
  if (!sb || !opts.partnerId) return;

  try {
    // Check existing row
    const { data: existing } = await sb
      .from('partner_audience_preferences')
      .select('id, interest_score, total_poll_votes, positive_votes')
      .eq('workspace_id', opts.workspaceId)
      .eq('partner_id', opts.partnerId)
      .single();

    const prevTotal = existing?.total_poll_votes ?? 0;
    const prevPositive = existing?.positive_votes ?? 0;
    const prevScore = existing?.interest_score ?? 0.5;

    const newTotal = prevTotal + opts.totalVotes;
    const newPositive = prevPositive + opts.positiveVotes;
    const rawScore = newTotal > 0 ? newPositive / newTotal : prevScore;

    // Smooth with exponential moving average (weight new data 30%)
    const newScore = prevTotal === 0 ? rawScore : prevScore * 0.7 + rawScore * 0.3;

    const preferredTiming = opts.winningOption?.includes('early') ? 'early_stream' :
      opts.winningOption?.includes('end') ? 'end_stream' : 'mid_stream';

    if (existing) {
      await sb
        .from('partner_audience_preferences')
        .update({
          interest_score: Math.round(newScore * 1000) / 1000,
          total_poll_votes: newTotal,
          positive_votes: newPositive,
          preferred_timing: preferredTiming,
          last_poll_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await sb
        .from('partner_audience_preferences')
        .insert({
          workspace_id: opts.workspaceId,
          partner_id: opts.partnerId,
          partner_name: opts.partnerName,
          interest_score: Math.round(newScore * 1000) / 1000,
          total_poll_votes: newTotal,
          positive_votes: newPositive,
          preferred_timing: preferredTiming,
          last_poll_at: new Date().toISOString(),
        });
    }
  } catch (err: any) {
    console.error('[partnerPollEngine] updateAudiencePreferences feilet:', err?.message);
  }
}

// ── Twitch chat poll ──────────────────────────────────────────────────────────

/**
 * Send a numbered poll to Twitch chat and collect responses for POLL_DURATION_MS.
 * chatSend: function to post to Twitch chat
 * onMessage: function to register a listener for incoming chat messages
 * offMessage: function to deregister the listener
 */
export async function runTwitchPoll(opts: {
  workspaceId: string;
  partnerId: string | null;
  partnerName: string;
  question: string;
  options: string[];                  // e.g. ['Ja!', 'Nei', 'Kanskje']
  durationMs?: number;
  chatSend: (msg: string) => Promise<void>;
  onMessage: (handler: (username: string, msg: string) => void) => void;
  offMessage: (handler: (username: string, msg: string) => void) => void;
}): Promise<PartnerPoll | null> {
  const duration = opts.durationMs ?? POLL_DURATION_MS;
  const pollOptions: PollOption[] = opts.options.map((label, i) => ({
    label, value: String(i + 1), votes: 0,
  }));

  const optLines = pollOptions.map(o => `${o.value}) ${o.label}`).join(' | ');
  const pollMsg = `📊 ${opts.question} Svar med tall: ${optLines} (${Math.round(duration / 1000)}s)`;

  await opts.chatSend(pollMsg);

  const votedUsers = new Set<string>();

  const handler = (username: string, msg: string) => {
    const clean = msg.trim();
    const idx = parseInt(clean, 10) - 1;
    if (!isNaN(idx) && idx >= 0 && idx < pollOptions.length && !votedUsers.has(username)) {
      votedUsers.add(username);
      pollOptions[idx].votes += 1;
    }
  };

  opts.onMessage(handler);

  const pollId = await createPollRow({
    workspaceId: opts.workspaceId,
    partnerId: opts.partnerId,
    partnerName: opts.partnerName,
    platform: 'twitch',
    pollType: 'interest',
    question: opts.question,
    options: pollOptions,
    twitchMessage: pollMsg,
  });

  await new Promise<void>(resolve => setTimeout(resolve, duration));
  opts.offMessage(handler);

  const totalVotes = pollOptions.reduce((sum, o) => sum + o.votes, 0);
  const winner = totalVotes > 0 ? pollOptions.reduce((a, b) => a.votes > b.votes ? a : b) : null;

  if (pollId) {
    await closePollRow(pollId, winner?.value ?? null, totalVotes, pollOptions);
  }

  // positive = option 1 (first option assumed to be affirmative)
  const positiveVotes = pollOptions[0]?.votes ?? 0;
  await updateAudiencePreferences({
    workspaceId: opts.workspaceId,
    partnerId: opts.partnerId,
    partnerName: opts.partnerName,
    positiveVotes,
    totalVotes,
    winningOption: winner?.label ?? null,
  });

  const resultsMsg = totalVotes > 0
    ? `📊 Resultat: ${pollOptions.map(o => `${o.label}: ${o.votes}`).join(' | ')} (${totalVotes} stemmer)`
    : '📊 Ingen svar på avstemningen.';
  await opts.chatSend(resultsMsg).catch(() => {});

  return {
    id: pollId ?? '',
    workspaceId: opts.workspaceId,
    partnerId: opts.partnerId,
    partnerName: opts.partnerName,
    platform: 'twitch',
    question: opts.question,
    options: pollOptions,
    status: 'closed',
    totalResponses: totalVotes,
    winningOption: winner?.value ?? null,
  };
}

// ── Discord embed poll ────────────────────────────────────────────────────────

const DISCORD_REACTIONS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];

/**
 * Send a poll embed to a Discord channel and collect emoji reactions.
 * sendEmbed: function to send the embed and return the message ID
 * addReaction: function to add initial reaction emoji to the message
 * getReactionCount: function to fetch reaction counts for a message
 */
export async function runDiscordPoll(opts: {
  workspaceId: string;
  partnerId: string | null;
  partnerName: string;
  question: string;
  options: string[];
  durationMs?: number;
  sendEmbed: (embed: Record<string, unknown>) => Promise<string | null>; // returns messageId
  addReaction: (messageId: string, emoji: string) => Promise<void>;
  getReactionCount: (messageId: string, emoji: string) => Promise<number>;
}): Promise<PartnerPoll | null> {
  const duration = opts.durationMs ?? DISCORD_POLL_DURATION_MS;
  const pollOptions: PollOption[] = opts.options.slice(0, 4).map((label, i) => ({
    label, value: DISCORD_REACTIONS[i], votes: 0,
  }));

  const description = pollOptions.map(o => `${o.value} ${o.label}`).join('\n');

  const embed = {
    title: `📊 ${opts.question}`,
    description: `${description}\n\nAvstemningen stenger om ${Math.round(duration / 60_000)} minutter.`,
    color: 0x00e676,
    footer: { text: `Partner: ${opts.partnerName}` },
    timestamp: new Date().toISOString(),
  };

  const messageId = await opts.sendEmbed({ embeds: [embed] });
  if (!messageId) return null;

  // Add reaction emoji so users know what to click
  for (const opt of pollOptions) {
    await opts.addReaction(messageId, opt.value).catch(() => {});
    await new Promise(r => setTimeout(r, 500)); // small delay between reactions
  }

  const pollId = await createPollRow({
    workspaceId: opts.workspaceId,
    partnerId: opts.partnerId,
    partnerName: opts.partnerName,
    platform: 'discord',
    pollType: 'interest',
    question: opts.question,
    options: pollOptions,
    discordMessageId: messageId,
  });

  await new Promise<void>(resolve => setTimeout(resolve, duration));

  // Collect reaction counts
  let totalVotes = 0;
  for (const opt of pollOptions) {
    const count = await opts.getReactionCount(messageId, opt.value).catch(() => 0);
    // Subtract 1 for the bot's own reaction
    opt.votes = Math.max(0, count - 1);
    totalVotes += opt.votes;
  }

  const winner = totalVotes > 0 ? pollOptions.reduce((a, b) => a.votes > b.votes ? a : b) : null;

  if (pollId) {
    await closePollRow(pollId, winner?.value ?? null, totalVotes, pollOptions);
  }

  const positiveVotes = pollOptions[0]?.votes ?? 0;
  await updateAudiencePreferences({
    workspaceId: opts.workspaceId,
    partnerId: opts.partnerId,
    partnerName: opts.partnerName,
    positiveVotes,
    totalVotes,
    winningOption: winner?.label ?? null,
  });

  return {
    id: pollId ?? '',
    workspaceId: opts.workspaceId,
    partnerId: opts.partnerId,
    partnerName: opts.partnerName,
    platform: 'discord',
    question: opts.question,
    options: pollOptions,
    status: 'closed',
    totalResponses: totalVotes,
    winningOption: winner?.value ?? null,
  };
}

// ── Generate poll question ────────────────────────────────────────────────────

export function buildInterestPollQuestion(partnerName: string, partnerDesc: string | null): { question: string; options: string[] } {
  return {
    question: `Hva synes dere om ${partnerName}?`,
    options: ['Interessert! 👍', 'Vet ikke 🤔', 'Ikke nå 👎'],
  };
}

export function buildTimingPollQuestion(): { question: string; options: string[] } {
  return {
    question: 'Når vil dere høre om partnere?',
    options: ['Tidlig i stream', 'Midten', 'Mot slutten'],
  };
}
