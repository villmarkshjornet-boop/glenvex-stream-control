/**
 * Content Factory Job Orchestrator
 * Pipeline: DOWNLOAD → TRANSCRIBE → DISCOVER → RANK → CUT → SUBTITLE → RENDER → COPYWRITE → QUEUE
 * Alle steg kan restartes individuelt.
 * KREVER: CONTENT_FACTORY_ENABLED=true
 */

import { assertContentFactoryEnabled } from '../index';
import { opprettVod, oppdaterVodStatus, hentVod } from '../vod/vodService';
import { oppdagHighlights } from '../analysis/highlightDiscovery';
import { rangerHighlights, hentToppHighlights } from '../ranking/highlightRanker';
import { genererCopyForAlle } from '../copywriter/copywriterService';
import { leggIReviewKø } from '../review/reviewQueue';
import { logPipeline } from './pipelineLogger';
import { lastNedVod, videoFinnes, hentAudioSti } from '../vod/vodDownloader';
import fs from 'fs';

export interface OrchestratorOptions {
  streamId: string;
  twitchVodUrl?: string;       // Twitch VOD URL (f.eks. https://twitch.tv/videos/123)
  audioUrl?: string;           // Alternativ: ekstern lyd-URL for Whisper
  userOauth?: string;          // Twitch user OAuth token (for private VODs)
  antallHighlights?: number;
  streamData?: {
    raids?: { username: string; viewers: number; timestamp?: string }[];
    chatSpikes?: { timestamp: number; intensity: number }[];
  };
}

export interface OrchestratorResultat {
  vodId: string;
  antallHighlights: number;
  antallCopy: number;
  antallIKø: number;
  steg: { steg: string; status: string; melding?: string }[];
}

export async function kjørFullPipeline(
  opts: OrchestratorOptions
): Promise<OrchestratorResultat> {
  assertContentFactoryEnabled();

  const steg: { steg: string; status: string; melding?: string }[] = [];

  // STEG 1: DOWNLOAD – Hent VOD-metadata
  console.log('[ContentFactory] Starter pipeline for stream:', opts.streamId);
  let vod;
  try {
    vod = await opprettVod(opts.streamId);
    if (!vod) throw new Error('Kunne ikke hente VOD');
    steg.push({ steg: 'DOWNLOAD', status: 'OK', melding: vod.title });
  } catch (err) {
    steg.push({ steg: 'DOWNLOAD', status: 'FEILET', melding: (err as Error).message });
    return { vodId: '', antallHighlights: 0, antallCopy: 0, antallIKø: 0, steg };
  }

  await oppdaterVodStatus(vod.id, 'ANALYZING');

  // STEG 1b: DOWNLOAD – Last ned VOD med yt-dlp hvis URL er oppgitt
  let lokaltAudioSti: string | null = null;
  if (opts.twitchVodUrl) {
    try {
      const nedlastet = await lastNedVod(vod.id, opts.twitchVodUrl, opts.userOauth);
      if (nedlastet) {
        lokaltAudioSti = nedlastet.audioPath;
        steg.push({ steg: 'DOWNLOAD_VIDEO', status: 'OK', melding: 'VOD lastet ned og audio ekstrahert' });
      } else {
        steg.push({ steg: 'DOWNLOAD_VIDEO', status: 'FEILET', melding: 'yt-dlp ikke tilgjengelig eller feil' });
      }
    } catch (err) {
      steg.push({ steg: 'DOWNLOAD_VIDEO', status: 'FEILET', melding: (err as Error).message });
    }
  }

  // STEG 2: TRANSCRIBE – Bruk lokalt audio, ekstern URL, eller hopp over
  const audioStiEllerUrl = lokaltAudioSti ?? opts.audioUrl;
  if (audioStiEllerUrl) {
    try {
      const { transkriber } = await import('../transcripts/whisperService');
      // Hvis lokal fil – les til buffer og send, ellers bruk URL direkte
      await transkriber(vod.id, audioStiEllerUrl);
      steg.push({ steg: 'TRANSCRIBE', status: 'OK' });
    } catch (err) {
      steg.push({ steg: 'TRANSCRIBE', status: 'FEILET', melding: (err as Error).message });
    }
  } else {
    steg.push({ steg: 'TRANSCRIBE', status: 'HOPPET OVER', melding: 'Ingen lyd tilgjengelig – oppgi twitchVodUrl eller audioUrl' });
  }

  // STEG 3: DISCOVER – Oppdage highlights
  let highlights: any[] = [];
  try {
    highlights = await oppdagHighlights(vod.id, opts.streamData);
    steg.push({ steg: 'DISCOVER', status: 'OK', melding: `${highlights.length} highlights` });
  } catch (err) {
    steg.push({ steg: 'DISCOVER', status: 'FEILET', melding: (err as Error).message });
  }

  // STEG 4: RANK – Ranger highlights
  let rangert: any[] = [];
  try {
    rangert = await rangerHighlights(vod.id);
    steg.push({ steg: 'RANK', status: 'OK' });
  } catch (err) {
    steg.push({ steg: 'RANK', status: 'FEILET', melding: (err as Error).message });
  }

  // STEG 5-7: CUT/SUBTITLE/RENDER – Krever FFmpeg (markeres som venter)
  steg.push({ steg: 'CUT', status: 'VENTER', melding: 'Krever FFmpeg på serveren' });
  steg.push({ steg: 'SUBTITLE', status: 'VENTER', melding: 'Kjøres etter CUT' });
  steg.push({ steg: 'RENDER', status: 'VENTER', melding: 'Kjøres etter SUBTITLE' });

  // STEG 8: COPYWRITE – Generer tekster
  const topp = await hentToppHighlights(vod.id, opts.antallHighlights ?? 10);
  let copy: any[] = [];
  try {
    copy = await genererCopyForAlle(
      vod.id, topp,
      vod.title ?? 'Stream', vod.category ?? 'Gaming'
    );
    steg.push({ steg: 'COPYWRITE', status: 'OK', melding: `${copy.length} tekster generert` });
  } catch (err) {
    steg.push({ steg: 'COPYWRITE', status: 'FEILET', melding: (err as Error).message });
  }

  // STEG 9: QUEUE – Legg i review-kø
  let kø: any[] = [];
  try {
    const køItems = topp.map(h => ({
      highlightId: h.id,
      type: `highlight_${h.category ?? 'GENERAL'}`,
    }));
    kø = await leggIReviewKø(vod.id, køItems);
    steg.push({ steg: 'QUEUE', status: 'OK', melding: `${kø.length} items i kø` });
  } catch (err) {
    steg.push({ steg: 'QUEUE', status: 'FEILET', melding: (err as Error).message });
  }

  await oppdaterVodStatus(vod.id, 'COMPLETE');

  return {
    vodId: vod.id,
    antallHighlights: rangert.length,
    antallCopy: copy.length,
    antallIKø: kø.length,
    steg,
  };
}

// Individuell restart av enkelt-steg
export async function restartSteg(
  vodId: string,
  steg: 'TRANSCRIBE' | 'DISCOVER' | 'RANK' | 'COPYWRITE' | 'QUEUE',
  opts?: { audioUrl?: string }
): Promise<void> {
  assertContentFactoryEnabled();

  const vod = await hentVod(vodId);
  if (!vod) throw new Error('VOD ikke funnet');

  await logPipeline({ vodId, step: steg as any, status: 'STARTED', message: 'Manuell restart' });

  switch (steg) {
    case 'TRANSCRIBE': {
      if (!opts?.audioUrl) throw new Error('audioUrl kreves for TRANSCRIBE');
      const { transkriber } = await import('../transcripts/whisperService');
      await transkriber(vodId, opts.audioUrl);
      break;
    }
    case 'DISCOVER':
      await oppdagHighlights(vodId);
      break;
    case 'RANK':
      await rangerHighlights(vodId);
      break;
    case 'COPYWRITE': {
      const highlights = await hentToppHighlights(vodId, 10);
      await genererCopyForAlle(vodId, highlights, vod.title ?? '', vod.category ?? '');
      break;
    }
    case 'QUEUE': {
      const highlights = await hentToppHighlights(vodId, 10);
      await leggIReviewKø(vodId, highlights.map(h => ({ highlightId: h.id, type: 'highlight' })));
      break;
    }
  }
}
