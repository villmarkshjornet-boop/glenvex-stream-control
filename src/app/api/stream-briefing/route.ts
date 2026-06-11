/**
 * POST /api/stream-briefing
 * Generates a pre-stream AI briefing using all available data sources.
 */
import { NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { getStreamInfo } from '@/lib/twitch';
import OpenAI from 'openai';
import { logSystemEvent } from '@/lib/systemEvents';
import { getCreatorContext, buildContextPrompt } from '@/lib/ai/creatorContext';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  if (!isDbAvailable()) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'OpenAI API-nøkkel mangler' }, { status: 500 });

  const db = getDb()!;
  const ws = getWorkspaceId();
  const cutoff24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const cutoff7d  = new Date(Date.now() - 7  * 24 * 3600_000).toISOString();

  const [
    workspaceRes,
    insightsRes,
    discordRes,
    twitchRes,
    highlightsRes,
    vodsRes,
    memoryRes,
    streamInfo,
    ctxRes,
  ] = await Promise.allSettled([
    db.from('workspaces').select('settings_json,brand_name,twitch_display_name').eq('id', ws).single(),
    db.from('ai_agent_insights').select('title,summary,confidence_score,created_at').eq('workspace_id', ws).order('created_at', { ascending: false }).limit(5),
    db.from('ai_agent_events').select('event_type,username,message_text,importance_score,created_at').eq('workspace_id', ws).eq('source', 'discord').gte('created_at', cutoff24h).order('importance_score', { ascending: false }).limit(20),
    db.from('ai_agent_events').select('event_type,username,message_text,importance_score,created_at').eq('workspace_id', ws).eq('source', 'twitch').gte('created_at', cutoff24h).order('importance_score', { ascending: false }).limit(20),
    db.from('content_highlights').select('title,category,clip_status,thumbnail_status,created_at').gte('created_at', cutoff7d).order('created_at', { ascending: false }).limit(10),
    db.from('content_vods').select('title,status,created_at').eq('workspace_id', ws).order('created_at', { ascending: false }).limit(5),
    db.from('ai_agent_memory').select('key,summary,occurrence_count,memory_type').eq('workspace_id', ws).order('occurrence_count', { ascending: false }).limit(10),
    getStreamInfo(),
    getCreatorContext({ limit: 8 }),
  ]);

  const settings    = workspaceRes.status === 'fulfilled'  ? workspaceRes.value.data?.settings_json   : null;
  const brandName   = workspaceRes.status === 'fulfilled'  ? (workspaceRes.value.data?.brand_name ?? 'streameren') : 'streameren';
  const displayName = workspaceRes.status === 'fulfilled'  ? (workspaceRes.value.data?.twitch_display_name ?? brandName) : brandName;
  if (brandName === 'streameren') {
    void db.from('system_events').insert({ workspace_id: ws, source: 'stream_briefing', event_type: 'WORKSPACE_MISSING_BRAND_CONTEXT', title: 'Stream Briefing: workspace mangler brand_name', severity: 'warning', metadata: { wsId: ws } });
  }
  const insights   = insightsRes.status === 'fulfilled'   ? insightsRes.value.data   ?? [] : [];
  const discord    = discordRes.status === 'fulfilled'    ? discordRes.value.data    ?? [] : [];
  const twitch     = twitchRes.status === 'fulfilled'     ? twitchRes.value.data     ?? [] : [];
  const highlights = highlightsRes.status === 'fulfilled' ? highlightsRes.value.data ?? [] : [];
  const vods       = vodsRes.status === 'fulfilled'       ? vodsRes.value.data       ?? [] : [];
  const memory     = memoryRes.status === 'fulfilled'     ? memoryRes.value.data     ?? [] : [];
  const stream     = streamInfo.status === 'fulfilled'    ? streamInfo.value         : null;
  const ctx        = ctxRes.status === 'fulfilled'        ? ctxRes.value             : null;
  const kanalKunnskap = ctx ? buildContextPrompt(ctx) : '';

  const streamplan = (settings?.streamplan ?? []).filter((d: any) => d.aktiv);

  // Build data summary for the AI
  const dataKontekst = [
    streamplan.length > 0 ? `Streamplan: ${streamplan.map((d: any) => `${d.dag} kl. ${d.tid} (${d.spill ?? '?'})`).join(', ')}` : 'Ingen aktiv streamplan',
    stream?.isLive ? `Stream ER LIVE nå: ${stream.viewerCount} seere, spill: ${stream.game}, tittel: ${stream.title}` : 'Ikke live nå',
    insights.length > 0 ? `AI-innsikter siste tid:\n${insights.map((i: any) => `- ${i.title}: ${i.summary}`).join('\n')}` : '',
    memory.length > 0 ? `Community-kunnskap:\n${memory.map((m: any) => `- ${m.key} (${m.memory_type}): ${m.summary}`).join('\n')}` : '',
    twitch.length > 0 ? `Twitch-aktivitet (siste 24t, topp 10):\n${twitch.slice(0, 10).map((e: any) => `- ${e.username ?? '?'}: ${e.message_text ?? e.event_type}`).join('\n')}` : 'Ingen Twitch-aktivitet',
    discord.length > 0 ? `Discord-aktivitet (siste 24t, topp 10):\n${discord.slice(0, 10).map((e: any) => `- ${e.username ?? '?'}: ${e.message_text ?? e.event_type}`).join('\n')}` : 'Ingen Discord-aktivitet',
    highlights.length > 0 ? `Siste highlights (siste 7d): ${highlights.map((h: any) => `${h.title ?? h.category} (${h.clip_status})`).join(', ')}` : '',
    vods.length > 0 ? `Siste VODs: ${vods.map((v: any) => `${v.title} (${v.status})`).join(', ')}` : '',
    kanalKunnskap || '',
    ctx?.recentExecutedTips?.length
      ? `Siste utførte tiltak: ${ctx.recentExecutedTips.slice(0, 3).map(t => `"${t.tip.slice(0, 60)}"`).join(', ')}`
      : '',
  ].filter(Boolean).join('\n\n');

  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 800,
    temperature: 0.8,
    messages: [
      {
        role: 'system',
        content: `Du er AI-produsent for ${brandName} – et norsk Twitch-community.
Du lager en konsis pre-stream briefing (maks 600 ord) for streameren (${displayName}).
Svar KUN med JSON i dette formatet:
{
  "overskrift": "en kort, energisk tittel for briefingen",
  "hoyepunkter": ["punkt 1", "punkt 2", "punkt 3"],
  "community_stemning": "1-3 setninger om hva som rørte seg i community siste 24t",
  "topp_topics": ["topic 1", "topic 2"],
  "ai_anbefaling": "1-2 setninger: hva bør du fokusere på i dag?",
  "advarsel": "null eller en kort advarsel om noe som krever oppmerksomhet",
  "generert_kl": "tidspunkt"
}`,
      },
      {
        role: 'user',
        content: `Her er all tilgjengelig data om ${brandName} nå:\n\n${dataKontekst}`,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? '{}';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  let briefing: any = {};
  if (jsonMatch) {
    try { briefing = JSON.parse(jsonMatch[0]); } catch {}
  }
  briefing.generert_kl = new Date().toLocaleTimeString('no-NO');
  briefing.raw_data = {
    insights: insights.length,
    discord_events: discord.length,
    twitch_events: twitch.length,
    highlights: highlights.length,
    is_live: stream?.isLive ?? false,
  };

  await logSystemEvent({
    source: 'stream_briefing',
    event_type: 'PRE_STREAM_BRIEFING_GENERATED',
    title: `Pre-stream briefing generert: "${briefing.overskrift ?? 'Ukjent'}"`,
    severity: 'info',
    metadata: {
      overskrift: briefing.overskrift ?? null,
      isLive: stream?.isLive ?? false,
      innsikter: insights.length,
      discordEvents: discord.length,
      twitchEvents: twitch.length,
      highlights: highlights.length,
    },
  }).catch(() => {});

  return NextResponse.json(briefing);
}
