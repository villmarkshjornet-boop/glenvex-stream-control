import { assertContentFactoryEnabled } from '../index';
import { getDb } from '@/lib/db';
import OpenAI from 'openai';
import { logPipeline } from '../jobs/pipelineLogger';
import type { ContentTranscript } from '../types';

export async function transkriber(vodId: string, audioUrl: string): Promise<ContentTranscript[]> {
  assertContentFactoryEnabled();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY mangler');

  const db = getDb();
  if (!db) throw new Error('Supabase ikke tilkoblet');

  const start = Date.now();
  await logPipeline({ vodId, step: 'TRANSCRIBE', status: 'STARTED' });

  try {
    const openai = new OpenAI({ apiKey });

    // Hent lydfil
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error('Kunne ikke hente lydfil');

    const audioBuffer = await audioRes.arrayBuffer();
    const audioFile = new File([Buffer.from(audioBuffer)], 'audio.mp4', { type: 'audio/mp4' });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });

    const segments = (transcription as any).segments ?? [];
    const transkripter: ContentTranscript[] = [];

    for (const seg of segments) {
      const { data } = await db.from('content_transcripts').insert({
        vod_id: vodId,
        start_time: seg.start,
        end_time: seg.end,
        text: seg.text,
        confidence: seg.avg_logprob ? Math.exp(seg.avg_logprob) : null,
      }).select().single();

      if (data) {
        transkripter.push({
          id: data.id,
          vodId,
          startTime: seg.start,
          endTime: seg.end,
          text: seg.text,
        });
      }
    }

    const duration = Date.now() - start;
    const kostnad = segments.length * 0.006; // Estimert kostnad per segment

    await logPipeline({
      vodId,
      step: 'TRANSCRIBE',
      status: 'COMPLETE',
      durationMs: duration,
      costEstimate: kostnad,
      outputCount: transkripter.length,
      message: `${transkripter.length} segmenter transkribert`,
    });

    return transkripter;
  } catch (err) {
    await logPipeline({ vodId, step: 'TRANSCRIBE', status: 'FAILED', message: (err as Error).message });
    throw err;
  }
}

export async function hentTranskripsjon(vodId: string): Promise<ContentTranscript[]> {
  assertContentFactoryEnabled();
  const db = getDb();
  if (!db) return [];
  const { data } = await db.from('content_transcripts')
    .select('*')
    .eq('vod_id', vodId)
    .order('start_time', { ascending: true });
  return (data ?? []).map(r => ({
    id: r.id,
    vodId: r.vod_id,
    startTime: r.start_time,
    endTime: r.end_time,
    text: r.text,
    confidence: r.confidence,
  }));
}

export async function søkITranskripsjon(vodId: string, søk: string): Promise<ContentTranscript[]> {
  assertContentFactoryEnabled();
  const db = getDb();
  if (!db) return [];
  const { data } = await db.from('content_transcripts')
    .select('*')
    .eq('vod_id', vodId)
    .ilike('text', `%${søk}%`)
    .order('start_time', { ascending: true });
  return (data ?? []).map(r => ({
    id: r.id, vodId: r.vod_id,
    startTime: r.start_time, endTime: r.end_time,
    text: r.text, confidence: r.confidence,
  }));
}
