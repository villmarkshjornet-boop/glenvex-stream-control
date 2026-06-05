import { assertContentFactoryEnabled } from '../index';
import { getDb } from '@/lib/db';
import OpenAI from 'openai';
import { hentTranskripsjon } from '../transcripts/whisperService';
import { logPipeline } from '../jobs/pipelineLogger';
import type { ContentHighlight, HighlightSignal, HighlightCategory } from '../types';

const EMOSJONELLE_ORD = ['nei', 'ja', 'wow', 'wtf', 'åh', 'oi', 'haha', 'lol', 'sjuke', 'jævel', 'faen', 'hold', 'vent', 'se', 'se her', 'omg', 'umulig', 'perfekt', 'øh'];

function finnEmosjoner(tekst: string): number {
  const lower = tekst.toLowerCase();
  let score = 0;
  for (const ord of EMOSJONELLE_ORD) {
    if (lower.includes(ord)) score += 10;
  }
  if (tekst === tekst.toUpperCase() && tekst.length > 5) score += 20; // CAPS
  if (tekst.includes('!')) score += 10 * (tekst.split('!').length - 1);
  return Math.min(score, 100);
}

function grupperSegmenter(segmenter: any[], vinduSekunder = 30) {
  const grupper: any[][] = [];
  let gjeldende: any[] = [];
  let start = segmenter[0]?.startTime ?? 0;

  for (const seg of segmenter) {
    if (seg.startTime - start > vinduSekunder && gjeldende.length > 0) {
      grupper.push(gjeldende);
      gjeldende = [];
      start = seg.startTime;
    }
    gjeldende.push(seg);
  }
  if (gjeldende.length > 0) grupper.push(gjeldende);
  return grupper;
}

export async function oppdagHighlights(
  vodId: string,
  streamData?: { raids?: any[]; subs?: any[]; chatSpikes?: { timestamp: number; intensity: number }[] }
): Promise<ContentHighlight[]> {
  assertContentFactoryEnabled();

  const db = getDb();
  if (!db) throw new Error('Supabase ikke tilkoblet');

  const start = Date.now();
  await logPipeline({ vodId, step: 'DISCOVER', status: 'STARTED' });

  const transkripter = await hentTranskripsjon(vodId);
  if (transkripter.length === 0) throw new Error('Ingen transkripsjon funnet');

  // Analyser segmenter for emosjonelle høydepunkter
  const grupper = grupperSegmenter(transkripter);
  const kandidater: { startTime: number; endTime: number; score: number; signals: HighlightSignal[]; tekst: string }[] = [];

  for (const gruppe of grupper) {
    const tekst = gruppe.map(s => s.text).join(' ');
    const emosjonsScore = finnEmosjoner(tekst);

    if (emosjonsScore < 20) continue;

    const signals: HighlightSignal[] = [];
    const startTime = gruppe[0].startTime;
    const endTime = gruppe[gruppe.length - 1].endTime;

    if (emosjonsScore > 0) {
      signals.push({ type: 'emotional', timestamp: startTime, intensity: emosjonsScore, description: 'Emosjonell reaksjon i tale' });
    }

    // Sjekk raids
    for (const raid of streamData?.raids ?? []) {
      const raidSek = raid.timestamp ? (new Date(raid.timestamp).getTime() - new Date(transkripter[0]?.startTime ?? 0).getTime()) / 1000 : 0;
      if (Math.abs(raidSek - startTime) < 60) {
        signals.push({ type: 'raid', timestamp: raidSek, intensity: Math.min(raid.viewers / 10, 100), description: `Raid med ${raid.viewers} seere` });
      }
    }

    // Sjekk chat-spikes
    for (const spike of streamData?.chatSpikes ?? []) {
      if (spike.timestamp >= startTime - 10 && spike.timestamp <= endTime + 10) {
        signals.push({ type: 'chat_spike', timestamp: spike.timestamp, intensity: spike.intensity, description: 'Høy chat-aktivitet' });
      }
    }

    const totalScore = Math.min(100, emosjonsScore + signals.reduce((s, sig) => s + sig.intensity * 0.3, 0));
    kandidater.push({ startTime, endTime, score: Math.round(totalScore), signals, tekst });
  }

  // Bruk AI til å rangere og kategorisere
  const apiKey = process.env.OPENAI_API_KEY;
  const highlights: ContentHighlight[] = [];

  if (apiKey && kandidater.length > 0) {
    const openai = new OpenAI({ apiKey });
    const topp = kandidater.sort((a, b) => b.score - a.score).slice(0, 20);

    // Send maks 10 kandidater med kortere tekst for å unngå avskjæring
    const begrenset = topp.slice(0, 10);
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Analyser disse stream-highlights og kategoriser dem. Returner KUN JSON:
{"highlights": [{"index": 0, "category": "FUNNY|FAIL|CLUTCH|RAGE|REACTION|TACTICAL|RP_MOMENT|EDUCATIONAL", "title": "Kort tittel (maks 8 ord)", "begrunnelse": "Kort begrunnelse (maks 15 ord)"}]}

Highlights:
${begrenset.map((k, i) => `${i}. [${Math.round(k.startTime)}s] Score:${k.score} "${k.tekst.slice(0, 80)}"`).join('\n')}`,
      }],
      max_tokens: 1200,
      temperature: 0.5,
      response_format: { type: 'json_object' },
    });

    const rawContent = res.choices[0]?.message?.content ?? '{}';
    const { sikreJsonParse } = await import('../utils/retry');
    const aiData = sikreJsonParse(rawContent, { highlights: [] });

    for (const ai of aiData.highlights ?? []) {
      const kandidat = topp[ai.index];
      if (!kandidat) continue;

      const { data } = await db.from('content_highlights').insert({
        vod_id: vodId,
        start_time: kandidat.startTime,
        end_time: kandidat.endTime,
        score: kandidat.score,
        category: ai.category,
        title: ai.title,
        begrunnelse: ai.begrunnelse,
        signals: kandidat.signals,
        status: 'PENDING',
      }).select().single();

      if (data) {
        highlights.push({
          id: data.id, vodId, startTime: kandidat.startTime, endTime: kandidat.endTime,
          score: kandidat.score, category: ai.category as HighlightCategory,
          title: ai.title, begrunnelse: ai.begrunnelse, signals: kandidat.signals.map(s => s.description), status: 'PENDING',
        });
      }
    }
  }

  await logPipeline({
    vodId, step: 'DISCOVER', status: 'COMPLETE',
    durationMs: Date.now() - start, outputCount: highlights.length,
    message: `${highlights.length} highlights oppdaget`,
  });

  return highlights;
}

export async function hentHighlights(vodId: string): Promise<ContentHighlight[]> {
  assertContentFactoryEnabled();
  const db = getDb();
  if (!db) return [];
  const { data } = await db.from('content_highlights').select('*')
    .eq('vod_id', vodId).order('score', { ascending: false });
  return (data ?? []).map(r => ({
    id: r.id, vodId: r.vod_id, startTime: r.start_time, endTime: r.end_time,
    score: r.score, category: r.category, title: r.title,
    begrunnelse: r.begrunnelse, signals: r.signals ?? [], rank: r.rank, status: r.status,
  }));
}
