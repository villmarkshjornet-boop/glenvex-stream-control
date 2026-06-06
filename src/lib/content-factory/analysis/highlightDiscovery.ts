import { assertContentFactoryEnabled } from '../index';
import { getDb } from '@/lib/db';
import OpenAI from 'openai';
import { hentTranskripsjon } from '../transcripts/whisperService';
import { logPipeline } from '../jobs/pipelineLogger';
import type { ContentHighlight, HighlightSignal, HighlightCategory } from '../types';

// Beregner et råsignal-score basert på tekstinnhold (aktivitet, reaksjoner)
function beregneSignalScore(tekst: string): number {
  let score = 0;
  score += Math.min(tekst.length / 15, 30);                                            // tekstlengde → aktivitet
  score += Math.min((tekst.split('!').length - 1) * 10, 40);                           // utropstegn
  score += (tekst.split('?').length - 1) * 5;                                          // spørsmål
  const capsOrd = tekst.split(' ').filter(w => w.length > 2 && w === w.toUpperCase() && /[A-ZÆØÅ]/.test(w)).length;
  score += Math.min(capsOrd * 12, 35);                                                  // CAPS-reaksjoner
  const korteFraser = tekst.split(' ').filter(w => w.length <= 3).length;
  score += Math.min(korteFraser * 2, 15);                                               // korte ord = reaksjonsfraser
  return Math.min(Math.round(score), 100);
}

// Grupper transkripter i overlappende vinduer på 60s med 30s overlapp
function grupperSegmenter(segmenter: any[], vinduSekunder = 60, overlapSekunder = 30) {
  const grupper: { segs: any[]; startTime: number; endTime: number }[] = [];
  if (segmenter.length === 0) return grupper;

  const totalVarighet = segmenter[segmenter.length - 1].endTime ?? 0;
  let pos = 0;

  while (pos < totalVarighet) {
    const vinduSegs = segmenter.filter(
      s => s.startTime >= pos && s.startTime < pos + vinduSekunder
    );
    if (vinduSegs.length > 0) {
      grupper.push({
        segs: vinduSegs,
        startTime: vinduSegs[0].startTime,
        endTime: vinduSegs[vinduSegs.length - 1].endTime,
      });
    }
    pos += vinduSekunder - overlapSekunder;
  }

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

  // Hent delt kanalkontext fra Global AI Memory
  let knowledge: import('@/lib/ai/creatorContext').CreatorContext | null = null;
  try {
    const { getCreatorContext } = await import('@/lib/ai/creatorContext');
    knowledge = await getCreatorContext({ limit: 15 });
  } catch { /* kjør uten historikk */ }

  // Grupper i 60s vinduer med 30s overlapp
  const grupper = grupperSegmenter(transkripter, 60, 30);

  const kandidater: {
    startTime: number;
    endTime: number;
    score: number;
    signals: HighlightSignal[];
    tekst: string;
  }[] = [];

  for (const gruppe of grupper) {
    const tekst = gruppe.segs.map(s => s.text).join(' ');
    if (tekst.trim().length < 10) continue;

    const signalScore = beregneSignalScore(tekst);
    const signals: HighlightSignal[] = [];
    const { startTime, endTime } = gruppe;

    if (signalScore > 0) {
      signals.push({
        type: 'emotional',
        timestamp: startTime,
        intensity: signalScore,
        description: 'Signal fra tale',
      });
    }

    for (const raid of streamData?.raids ?? []) {
      const raidSek = raid.timestamp
        ? (new Date(raid.timestamp).getTime() - new Date(transkripter[0]?.startTime ?? 0).getTime()) / 1000
        : 0;
      if (Math.abs(raidSek - startTime) < 60) {
        signals.push({
          type: 'raid',
          timestamp: raidSek,
          intensity: Math.min(raid.viewers / 10, 100),
          description: `Raid med ${raid.viewers} seere`,
        });
      }
    }

    for (const spike of streamData?.chatSpikes ?? []) {
      if (spike.timestamp >= startTime - 10 && spike.timestamp <= endTime + 10) {
        signals.push({
          type: 'chat_spike',
          timestamp: spike.timestamp,
          intensity: spike.intensity,
          description: 'Høy chat-aktivitet',
        });
      }
    }

    const totalScore = Math.min(
      100,
      signalScore + signals.filter(s => s.type !== 'emotional').reduce((s, sig) => s + sig.intensity * 0.3, 0)
    );
    kandidater.push({ startTime, endTime, score: Math.round(totalScore), signals, tekst });
  }

  // Fjern nær-duplikater (overlappende vinduer) – behold beste score innenfor 30s
  const unikKandidater = kandidater
    .sort((a, b) => b.score - a.score)
    .filter((k, idx, arr) =>
      !arr.slice(0, idx).some(
        prev => Math.abs(prev.startTime - k.startTime) < 30 && prev.score >= k.score
      )
    )
    .slice(0, 20);

  const highlights: ContentHighlight[] = [];
  const apiKey = process.env.OPENAI_API_KEY;

  if (apiKey && unikKandidater.length > 0) {
    const openai = new OpenAI({ apiKey });

    // Bygg rik kontekst fra delt AI-minne
    let kontekst: string;
    if (knowledge && (knowledge.streamCount > 0 || knowledge.topViewers.length > 0 || knowledge.runningJokes.length > 0)) {
      const { buildContextPrompt } = await import('@/lib/ai/creatorContext');
      kontekst = buildContextPrompt(knowledge);
    } else {
      kontekst = 'Kanal: GLENVEX – norsk gaming streamer. Fokus på genuine reaksjoner og episke øyeblikk.';
    }

    const begrenset = unikKandidater.slice(0, 12);

    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: `Du er AI Producer for GLENVEX. Analyser disse stream-øyeblikkene og velg de beste highlights.
${kontekst}

SCORING (0-100):
- 0-30: Ikke interessant nok
- 31-60: OK innhold
- 61-80: Bra highlight
- 81-100: Eksepsjonelt øyeblikk

Returner KUN JSON – inkluder BARE øyeblikk med score > 30:
{"highlights": [{"index": 0, "score": 75, "category": "FUNNY|FAIL|CLUTCH|RAGE|REACTION|TACTICAL|RP_MOMENT|EDUCATIONAL", "title": "Tittel (maks 8 ord)", "begrunnelse": "Kort begrunnelse (maks 15 ord)"}]}

Øyeblikk å vurdere:
${begrenset.map((k, i) => `${i}. [${Math.round(k.startTime)}s–${Math.round(k.endTime)}s] RåScore:${k.score} "${k.tekst.slice(0, 130)}"`).join('\n')}`,
        },
      ],
      max_tokens: 1500,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const rawContent = res.choices[0]?.message?.content ?? '{}';
    const { sikreJsonParse } = await import('../utils/retry');
    const aiData = sikreJsonParse(rawContent, { highlights: [] });

    for (const ai of aiData.highlights ?? []) {
      if ((ai.score ?? 0) < 31) continue;

      const kandidat = begrenset[ai.index];
      if (!kandidat) continue;

      const startNum = parseFloat(String(kandidat.startTime));
      const endNum = parseFloat(String(kandidat.endTime));
      if (isNaN(startNum) || isNaN(endNum)) continue;

      console.log(`[DISCOVER] Lagrer: start=${startNum}, end=${endNum}, score=${ai.score}, kat=${ai.category}`);

      const { data } = await db
        .from('content_highlights')
        .insert({
          vod_id: vodId,
          start_time: startNum,
          end_time: endNum,
          score: Math.min(100, Math.max(0, Math.round(ai.score))),
          category: ai.category,
          title: ai.title,
          begrunnelse: ai.begrunnelse,
          signals: kandidat.signals,
          status: 'PENDING',
        })
        .select()
        .single();

      if (data) {
        highlights.push({
          id: data.id,
          vodId,
          startTime: startNum,
          endTime: endNum,
          score: ai.score,
          category: ai.category as HighlightCategory,
          title: ai.title,
          begrunnelse: ai.begrunnelse,
          signals: kandidat.signals.map(s => s.description),
          status: 'PENDING',
        });
      }
    }
  }

  await logPipeline({
    vodId,
    step: 'DISCOVER',
    status: 'COMPLETE',
    durationMs: Date.now() - start,
    outputCount: highlights.length,
    message: `${highlights.length} highlights funnet (${knowledge && knowledge.streamCount > 0 ? `${knowledge.streamCount} streams + ${knowledge.topViewers.length} seere i AI-minnet` : 'ingen historikk ennå'})`,
  });

  return highlights;
}

export async function hentHighlights(vodId: string): Promise<ContentHighlight[]> {
  assertContentFactoryEnabled();
  const db = getDb();
  if (!db) return [];
  const { data } = await db
    .from('content_highlights')
    .select('*')
    .eq('vod_id', vodId)
    .order('score', { ascending: false });
  return (data ?? []).map(r => ({
    id: r.id,
    vodId: r.vod_id,
    vod_id: r.vod_id,
    startTime: parseFloat(r.start_time) || 0,
    start_time: parseFloat(r.start_time) || 0,
    endTime: parseFloat(r.end_time) || 0,
    end_time: parseFloat(r.end_time) || 0,
    score: parseInt(r.score) || 0,
    category: r.category,
    title: r.title,
    begrunnelse: r.begrunnelse,
    signals: r.signals ?? [],
    rank: r.rank,
    status: r.status,
    clip_status: r.clip_status ?? 'READY_FOR_CLIP',
    clip_url: r.clip_url ?? null,
    vertical_clip_url: r.vertical_clip_url ?? null,
    clip_finished_at: r.clip_finished_at ?? null,
    clip_error: r.clip_error ?? null,
  }));
}
