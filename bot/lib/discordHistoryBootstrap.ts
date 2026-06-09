/**
 * Discord History Bootstrap
 * Henter historiske Discord-meldinger og lagrer dem som ai_agent_events
 * slik at LearningAggregator kan lære av community-aktivitet fra før boten startet.
 *
 * Garantier:
 * - Ingen duplikater: Discord message ID lagres i metadata og sjekkes før insert
 * - Rate-limit: 1 sekund pause mellom API-kall
 * - Maks 500 meldinger per kanal per bootstrap-kjøring
 * - Kjøres kun én gang per kanal (spores i ai_agent_memory)
 * - Kun relevante meldinger: >= 3 ord, ikke bot-meldinger, ikke kommandoer
 */

import { Client, TextChannel, Collection, Message } from 'discord.js';
import { logSystemEvent } from './systemEvents';

const WORKSPACE_ID = process.env.WORKSPACE_ID || 'glenvex-default';
const MAX_MELDINGER = 500;
const MIN_ORD = 3;

function getSb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = require('@supabase/supabase-js');
  const ws = require('ws');
  return createClient(url, key, { realtime: { transport: ws } });
}

async function erBootstrappet(sb: any, channelId: string): Promise<boolean> {
  try {
    const { data } = await sb
      .from('ai_agent_memory')
      .select('id')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('agent_type', 'discord')
      .eq('memory_type', 'bootstrap_channel')
      .eq('key', channelId)
      .maybeSingle();
    return !!data;
  } catch { return false; }
}

async function markerBootstrappet(sb: any, channelId: string, antall: number): Promise<void> {
  try {
    await sb.from('ai_agent_memory').insert({
      workspace_id: WORKSPACE_ID,
      agent_type: 'discord',
      memory_type: 'bootstrap_channel',
      key: channelId,
      summary: `Bootstrappet ${antall} historiske meldinger fra kanal ${channelId}`,
      confidence_score: 1.0,
      occurrence_count: 1,
      last_seen_at: new Date().toISOString(),
      metadata: { channelId, antall, bootstrappetAt: new Date().toISOString() },
    });
  } catch {}
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function bootstrapKanal(sb: any, channel: TextChannel): Promise<number> {
  const alleMeldinger: { msgId: string; username: string; content: string; ts: string }[] = [];
  let lastId: string | undefined;
  let runder = 0;
  const MAX_RUNDER = 5; // 5 × 100 = 500 meldinger max

  while (alleMeldinger.length < MAX_MELDINGER && runder < MAX_RUNDER) {
    try {
      const options: any = { limit: 100 };
      if (lastId) options.before = lastId;

      const fetched = await channel.messages.fetch(options) as unknown as Collection<string, Message>;
      if (fetched.size === 0) break;

      const sorterte = [...fetched.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      lastId = sorterte[0].id; // oldest for pagination

      for (const msg of sorterte) {
        if (msg.author.bot) continue;
        if (msg.content.startsWith('!') || msg.content.startsWith('/')) continue;
        const ordTelling = msg.content.trim().split(/\s+/).filter(Boolean).length;
        if (ordTelling < MIN_ORD) continue;
        if (msg.content.length > 600) continue;

        alleMeldinger.push({
          msgId: msg.id,
          username: msg.author.username,
          content: msg.content.trim().slice(0, 500),
          ts: msg.createdAt.toISOString(),
        });
      }

      runder++;
      await sleep(1_000); // Rate-limit: 1s mellom kall
    } catch (err: any) {
      console.error(`[DiscordBootstrap] Feil ved henting fra ${channel.name}:`, err.message?.slice(0, 80));
      throw err; // re-throw så caller kan logge SYNC_FAILED
    }
  }

  if (alleMeldinger.length === 0) return 0;

  // Sjekk hvilke message IDs som allerede finnes i DB
  const msgIds = alleMeldinger.map(m => m.msgId);
  let eksisterendeIds = new Set<string>();
  try {
    const { data: existing } = await sb
      .from('ai_agent_events')
      .select('metadata')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('event_type', 'discord_message_history')
      .eq('channel_id', channel.id)
      .limit(1000);
    for (const row of (existing ?? [])) {
      const id = row.metadata?.discordMsgId;
      if (id) eksisterendeIds.add(id);
    }
  } catch {}

  const nyeMeldinger = alleMeldinger.filter(m => !eksisterendeIds.has(m.msgId));
  if (nyeMeldinger.length === 0) return 0;

  // Batch-insert i grupper på 50
  const BATCH = 50;
  for (let i = 0; i < nyeMeldinger.length; i += BATCH) {
    const batch = nyeMeldinger.slice(i, i + BATCH);
    const rows = batch.map(m => ({
      workspace_id: WORKSPACE_ID,
      source: 'discord',
      event_type: 'discord_message_history',
      username: m.username,
      message_text: m.content,
      channel_id: channel.id,
      importance_score: 10,
      metadata: { discordMsgId: m.msgId, channelName: channel.name, isHistorical: true },
      created_at: m.ts,
    }));
    const { error: insErr } = await sb.from('ai_agent_events').insert(rows).catch((e: any) => ({ error: e }));
    if (insErr) {
      console.error(`[DiscordBootstrap] ai_agent_events insert feilet (batch ${i}–${i + BATCH}):`
        + ` code=${insErr.code ?? '?'} | ${insErr.message ?? insErr}`);
    }
    await sleep(200);
  }

  return nyeMeldinger.length;
}

export async function startDiscordHistoryBootstrap(client: Client): Promise<void> {
  const sb = getSb();
  if (!sb) return;

  const guild = client.guilds.cache.first();
  if (!guild) return;

  const chatKanalId = process.env.DISCORD_CHAT_CHANNEL_ID;
  const liveKanalId = process.env.DISCORD_LIVE_CHANNEL_ID;

  const prioriterteIds = [chatKanalId, liveKanalId].filter(Boolean) as string[];
  const alleKanaler = guild.channels.cache
    .filter(c => c instanceof TextChannel)
    .map(c => c as TextChannel)
    .sort((a, b) => {
      const aIdx = prioriterteIds.indexOf(a.id);
      const bIdx = prioriterteIds.indexOf(b.id);
      if (aIdx !== -1 && bIdx === -1) return -1;
      if (bIdx !== -1 && aIdx === -1) return 1;
      return 0;
    })
    .slice(0, 5); // Maks 5 kanaler

  let totalBootstrappet = 0;

  for (const kanal of alleKanaler) {
    const alleredeGjort = await erBootstrappet(sb, kanal.id);
    if (alleredeGjort) continue;

    const syncStart = Date.now();
    console.log(`[DiscordBootstrap] Henter historikk fra #${kanal.name}...`);

    logSystemEvent({
      source: 'discord_bot',
      event_type: 'DISCORD_HISTORY_SYNC_STARTED',
      title: `Discord historikk-sync startet: #${kanal.name}`,
      severity: 'info',
      metadata: { guildId: guild.id, channelId: kanal.id, channelName: kanal.name },
    });

    try {
      const antall = await bootstrapKanal(sb, kanal);
      await markerBootstrappet(sb, kanal.id, antall);
      totalBootstrappet += antall;

      logSystemEvent({
        source: 'discord_bot',
        event_type: 'DISCORD_HISTORY_SYNC_COMPLETED',
        title: `Discord historikk-sync ferdig: #${kanal.name} — ${antall} meldinger`,
        severity: 'info',
        metadata: {
          guildId: guild.id,
          channelId: kanal.id,
          channelName: kanal.name,
          antallMeldinger: antall,
          durationMs: Date.now() - syncStart,
        },
      });

      console.log(`[DiscordBootstrap] ✓ #${kanal.name}: ${antall} nye meldinger lagret`);
    } catch (err: any) {
      const errMsg = err.message?.slice(0, 200) ?? 'Ukjent feil';
      console.error(`[DiscordBootstrap] Feil for #${kanal.name}:`, errMsg.slice(0, 80));

      logSystemEvent({
        source: 'discord_bot',
        event_type: 'DISCORD_HISTORY_SYNC_FAILED',
        title: `Discord historikk-sync feilet: #${kanal.name}`,
        severity: 'error',
        metadata: {
          guildId: guild.id,
          channelId: kanal.id,
          channelName: kanal.name,
          errorMessage: errMsg,
          durationMs: Date.now() - syncStart,
        },
      });
    }

    await sleep(2_000); // 2s mellom kanaler
  }

  if (totalBootstrappet > 0) {
    logSystemEvent({
      source: 'discord_bot',
      event_type: 'DISCORD_HISTORY_SYNC_COMPLETED',
      title: `Discord historikk totalt bootstrappet: ${totalBootstrappet} meldinger`,
      severity: 'info',
      metadata: { total: totalBootstrappet, kanaler: alleKanaler.length },
    });
    console.log(`[DiscordBootstrap] ✓ Totalt ${totalBootstrappet} historiske meldinger indeksert`);
  }
}
