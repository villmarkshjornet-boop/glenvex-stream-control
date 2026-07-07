import { assertContentFactoryEnabled } from '../index';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import OpenAI from 'openai';
import { logPipeline } from '../jobs/pipelineLogger';
import type { ContentCopy, ContentHighlight } from '../types';

export async function genererCopy(
  vodId: string,
  highlight: ContentHighlight,
  streamTittel: string,
  spillKategori: string
): Promise<ContentCopy[]> {
  assertContentFactoryEnabled();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY mangler');

  const db = getDb();
  if (!db) throw new Error('Supabase ikke tilkoblet');

  await logPipeline({ vodId, step: 'COPYWRITE', status: 'STARTED' });
  const start = Date.now();

  const openai = new OpenAI({ apiKey });

  const { data: wsRow } = await db.from('workspaces').select('brand_name,twitch_channel_name').eq('id', getWorkspaceId()).single();
  const streamerName = wsRow?.brand_name ?? 'streameren';
  const twitchUrl    = wsRow?.twitch_channel_name
    ? `https://twitch.tv/${wsRow.twitch_channel_name}`
    : null;

  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `Du er content manager for en norsk Twitch-streamer. Lag innholdstekster for dette clipset. Returner KUN JSON:
{
  "youtube": {
    "tittel": "SEO-optimalisert tittel (maks 70 tegn)",
    "beskrivelse": "Engasjerende beskrivelse (150-300 tegn) + #tags${twitchUrl ? ` + Twitch-link` : ''}",
    "hashtags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
  },
  "tiktok": {
    "caption": "Fengende caption (maks 150 tegn)",
    "hashtags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8"]
  },
  "instagram": {
    "caption": "Engasjerende caption (200-300 tegn)",
    "hashtags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10"]
  },
  "discord": {
    "post": "Kort Discord-post med link (maks 200 tegn)"
  }
}

Clip-info:
Streamer: ${streamerName}
Spill: ${spillKategori}
Stream: ${streamTittel}
Highlight-kategori: ${highlight.category ?? 'Gaming'}
Tittel: ${highlight.title ?? 'Epic moment'}
Begrunnelse: ${highlight.begrunnelse ?? ''}
Score: ${highlight.score}/100
${twitchUrl ? `Twitch-kanal: ${twitchUrl}` : ''}

Norsk tekst. Engasjerende. Gaming-vibe. Ikke generisk.${twitchUrl ? ` Inkluder alltid "${twitchUrl}" som CTA i YouTube-beskrivelsen og Discord-posten.` : ''}`,
    }],
    max_tokens: 600,
    temperature: 0.85,
    response_format: { type: 'json_object' },
  });

  const data = JSON.parse(res.choices[0]?.message?.content ?? '{}');
  const copies: ContentCopy[] = [];

  const plattformer = [
    { platform: 'youtube' as const, key: 'youtube' },
    { platform: 'tiktok' as const, key: 'tiktok' },
    { platform: 'instagram' as const, key: 'instagram' },
    { platform: 'discord' as const, key: 'discord' },
  ];

  for (const { platform, key } of plattformer) {
    const pData = data[key] ?? {};
    const { data: inserted } = await db.from('content_copy').insert({
      workspace_id: getWorkspaceId(),
      vod_id: vodId,
      highlight_id: highlight.id,
      platform,
      tittel: pData.tittel ?? null,
      beskrivelse: pData.beskrivelse ?? null,
      hashtags: pData.hashtags ?? [],
      caption: pData.caption ?? null,
      discord_post: pData.post ?? null,
    }).select().single();

    if (inserted) {
      copies.push({
        id: inserted.id,
        vodId,
        highlightId: highlight.id,
        platform,
        tittel: inserted.tittel,
        beskrivelse: inserted.beskrivelse,
        hashtags: inserted.hashtags,
        caption: inserted.caption,
        discordPost: inserted.discord_post,
      });
    }
  }

  await logPipeline({
    vodId, step: 'COPYWRITE', status: 'COMPLETE',
    durationMs: Date.now() - start,
    costEstimate: 0.002,
    outputCount: copies.length,
  });

  return copies;
}

export async function genererCopyForAlle(
  vodId: string,
  highlights: ContentHighlight[],
  streamTittel: string,
  spillKategori: string
): Promise<ContentCopy[]> {
  assertContentFactoryEnabled();

  const all: ContentCopy[] = [];
  const topp = highlights.slice(0, 10); // Maks topp 10

  for (const h of topp) {
    try {
      const copies = await genererCopy(vodId, h, streamTittel, spillKategori);
      all.push(...copies);
    } catch (err) {
      console.error(`[Copywriter] Feilet for highlight ${h.id}:`, err);
    }
  }

  return all;
}

export async function hentCopyForVod(vodId: string, workspaceId?: string): Promise<ContentCopy[]> {
  assertContentFactoryEnabled();
  const db = getDb();
  if (!db) return [];
  const ws = workspaceId ?? getWorkspaceId();
  // Verify the vod belongs to this workspace before returning its copy data
  if (ws) {
    const { data: vod } = await db.from('content_vods').select('id').eq('id', vodId).eq('workspace_id', ws).single();
    if (!vod) return [];
  }
  const { data } = await db.from('content_copy').select('*').eq('vod_id', vodId);
  return (data ?? []).map(r => ({
    id: r.id, vodId: r.vod_id, highlightId: r.highlight_id,
    platform: r.platform, tittel: r.tittel, beskrivelse: r.beskrivelse,
    hashtags: r.hashtags, caption: r.caption, discordPost: r.discord_post,
  }));
}

