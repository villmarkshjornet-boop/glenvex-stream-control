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

  // STEG 1b: DOWNLOAD_VIDEO + UPLOAD_AUDIO via Railway-boten
  // Railway: yt-dlp → FFmpeg → Supabase Storage → signed URL
  let signedAudioUrl: string | null = null;

  if (opts.twitchVodUrl) {
    const botApiUrl = process.env.BOT_API_URL;
    if (!botApiUrl) {
      steg.push({ steg: 'DOWNLOAD_VIDEO', status: 'HOPPET OVER', melding: 'BOT_API_URL ikke satt i Vercel' });
      steg.push({ steg: 'UPLOAD_AUDIO', status: 'HOPPET OVER', melding: 'Krever DOWNLOAD_VIDEO' });
    } else {
      try {
        steg.push({ steg: 'DOWNLOAD_VIDEO', status: 'STARTER', melding: 'Kaller Railway...' });

        const railwayRes = await fetch(`${botApiUrl}/content-factory/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vodId: vod.id,
            twitchVodUrl: opts.twitchVodUrl,
            userOauth: opts.userOauth ?? process.env.TWITCH_USER_OAUTH,
          }),
          signal: AbortSignal.timeout(600_000), // 10 min – lange VODs
        });

        if (railwayRes.ok) {
          const d = await railwayRes.json() as any;

          // Sjekk at dette faktisk er content-factory svar (ikke rot-endepunkt)
          if (!d.ok || d.status === 'GLENVEX Bot Data API') {
            steg.splice(steg.findIndex(s => s.steg === 'DOWNLOAD_VIDEO'), 1);
            steg.push({ steg: 'DOWNLOAD_VIDEO', status: 'FEILET', melding: 'Railway kjører gammel versjon uten content-factory støtte. Redeploy Railway!' });
            steg.push({ steg: 'UPLOAD_AUDIO', status: 'HOPPET OVER', melding: 'DOWNLOAD_VIDEO feilet' });
          } else {
          steg.splice(steg.findIndex(s => s.steg === 'DOWNLOAD_VIDEO'), 1);
          steg.push({ steg: 'DOWNLOAD_VIDEO', status: 'OK', melding: 'VOD lastet ned og audio ekstrahert' });

          // Bruk signed URL fra Railway direkte (Railway genererte den lokalt)
          if (d.signedUrl) {
            signedAudioUrl = d.signedUrl;
            steg.push({ steg: 'UPLOAD_AUDIO', status: 'OK', melding: `Audio i Supabase Storage – URL klar` });
          } else if (d.storagePath) {
            // Fallback: prøv å generere fra Vercel
            try {
              const { getDb } = await import('@/lib/db');
              const db = getDb();
              if (db) {
                const { data: sd } = await db.storage
                  .from('glenvex-assets')
                  .createSignedUrl(d.storagePath, 3600);
                if (sd?.signedUrl) {
                  signedAudioUrl = sd.signedUrl;
                  steg.push({ steg: 'UPLOAD_AUDIO', status: 'OK', melding: 'Signed URL generert fra Vercel' });
                } else {
                  steg.push({ steg: 'UPLOAD_AUDIO', status: 'FEILET', melding: 'Ingen signed URL returnert' });
                }
              }
            } catch (e) {
              steg.push({ steg: 'UPLOAD_AUDIO', status: 'FEILET', melding: (e as Error).message });
            }
          } else {
            steg.push({ steg: 'UPLOAD_AUDIO', status: 'FEILET', melding: `Railway returnerte ingen signedUrl eller storagePath. Rå svar: ${JSON.stringify(d).slice(0, 200)}` });
          }
          } // lukk else-blokken for d.ok-sjekk
        } else {
          const err = await railwayRes.json() as any;
          steg.splice(steg.findIndex(s => s.steg === 'DOWNLOAD_VIDEO'), 1);
          steg.push({ steg: 'DOWNLOAD_VIDEO', status: 'FEILET', melding: err.error ?? 'Railway feil' });
          steg.push({ steg: 'UPLOAD_AUDIO', status: 'HOPPET OVER', melding: 'DOWNLOAD_VIDEO feilet' });
        }
      } catch (err) {
        steg.push({ steg: 'DOWNLOAD_VIDEO', status: 'FEILET', melding: (err as Error).message });
        steg.push({ steg: 'UPLOAD_AUDIO', status: 'HOPPET OVER', melding: 'Timeout eller nettverksfeil' });
      }
    }
  } else {
    steg.push({ steg: 'DOWNLOAD_VIDEO', status: 'HOPPET OVER', melding: 'Ingen twitchVodUrl oppgitt' });
    steg.push({ steg: 'UPLOAD_AUDIO', status: 'HOPPET OVER', melding: 'Ingen nedlasting' });
  }

  // STEG 2: TRANSCRIBE – Bruk signed URL fra Supabase Storage, ekstern URL, eller hopp over
  const audioStiEllerUrl = signedAudioUrl ?? opts.audioUrl;
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
