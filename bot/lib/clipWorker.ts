/**
 * Clip Worker – Automatisk videoklipping med FFmpeg
 * Kjøres kontinuerlig på Railway.
 * Henter highlights med clip_status = READY_FOR_CLIP og klipper dem.
 * Produserer 16:9 og 9:16 (TikTok/Shorts/Reels) formater.
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const WORKSPACE_ID = 'glenvex-default';
const DATA_DIR = path.join(process.cwd(), 'data');
const CLIPS_DIR = path.join(DATA_DIR, 'content-factory', 'clips');
const VODS_DIR = path.join(DATA_DIR, 'content-factory', 'raw-vods');

// Lock-system: forhindrer at samme highlight klippes to ganger
const klipperNå = new Set<string>();

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { realtime: { transport: require('ws') } });
}

function sikreDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function lastNedSegment(
  twitchVodUrl: string,
  startSek: number,
  sluttSek: number,
  utPath: string
): Promise<boolean> {
  const execAsync = require('util').promisify(require('child_process').exec);
  const varighet = sluttSek - startSek;

  // Legg til 5s buffer før og etter for smidig klipp
  const buffer = 5;
  const fraStart = Math.max(0, startSek - buffer);
  const ekstraTid = buffer;

  try {
    // Prøv yt-dlp med --download-sections (raskest – laster kun nødvendig segment)
    await execAsync(
      `yt-dlp --download-sections "*${fraStart}-${sluttSek + buffer}" -f "bestvideo[height<=1080]+bestaudio/best[height<=1080]" --merge-output-format mp4 -o "${utPath}" "${twitchVodUrl}"`,
      { maxBuffer: 1024 * 1024 * 500, timeout: 300_000 }
    );
    return fs.existsSync(utPath);
  } catch {
    // Fallback: bruk FFmpeg direkte på HLS-stream
    try {
      await execAsync(
        `ffmpeg -y -ss ${fraStart} -t ${varighet + ekstraTid * 2} -i "${twitchVodUrl}" -c:v libx264 -c:a aac -preset fast "${utPath}"`,
        { maxBuffer: 1024 * 1024 * 500, timeout: 300_000 }
      );
      return fs.existsSync(utPath);
    } catch { return false; }
  }
}

async function klippFormat(
  inputPath: string,
  outputPath: string,
  startSek: number,
  sluttSek: number,
  format: '16:9' | '9:16'
): Promise<boolean> {
  const execAsync = require('util').promisify(require('child_process').exec);
  const varighet = sluttSek - startSek;

  let vf = '';
  if (format === '9:16') {
    // Vertikal format: crop midten og skaler til 1080x1920
    vf = `-vf "scale=1920:1080,crop=608:1080:(1920-608)/2:0,scale=1080:1920"`;
  } else {
    vf = `-vf "scale=1920:1080"`;
  }

  try {
    await execAsync(
      `ffmpeg -y -ss ${startSek} -t ${varighet} -i "${inputPath}" ${vf} -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`,
      { maxBuffer: 1024 * 1024 * 200, timeout: 180_000 }
    );
    return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10_000;
  } catch (err: any) {
    console.error(`[ClipWorker] FFmpeg ${format} feil:`, err.message?.slice(0, 200));
    return false;
  }
}

async function lastOppTilSupabase(
  sb: ReturnType<typeof createClient>,
  lokalSti: string,
  storageSti: string
): Promise<string | null> {
  try {
    const buf = fs.readFileSync(lokalSti);
    const { error } = await sb.storage.from('glenvex-assets').upload(storageSti, buf, {
      contentType: 'video/mp4',
      upsert: true,
    });
    if (error) throw error;

    const { data: sd } = await sb.storage.from('glenvex-assets').createSignedUrl(storageSti, 7 * 24 * 3600);
    return sd?.signedUrl ?? null;
  } catch (err: any) {
    console.error('[ClipWorker] Opplasting feilet:', err.message);
    return null;
  }
}

async function klippHighlight(highlight: any, vodUrl: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  const hId = highlight.id;
  if (klipperNå.has(hId)) return; // Lock
  klipperNå.add(hId);

  const startSek = Math.floor(highlight.start_time);
  const sluttSek = Math.ceil(highlight.end_time);
  const vodId = highlight.vod_id;

  sikreDir(path.join(CLIPS_DIR, vodId));

  const råPath = path.join(VODS_DIR, `${vodId}_seg_${hId}.mp4`);
  const p16x9 = path.join(CLIPS_DIR, vodId, `${hId}_16x9.mp4`);
  const p9x16 = path.join(CLIPS_DIR, vodId, `${hId}_9x16.mp4`);

  try {
    console.log(`[ClipWorker] Klipper highlight ${hId} [${startSek}s-${sluttSek}s]`);

    // Last ned segment fra Twitch
    const lastetNed = await lastNedSegment(vodUrl, startSek, sluttSek, råPath);
    if (!lastetNed) throw new Error('Kunne ikke laste ned VOD-segment');

    // Klipp 16:9
    const ok16x9 = await klippFormat(råPath, p16x9, startSek, sluttSek, '16:9');

    // Klipp 9:16
    const ok9x16 = await klippFormat(råPath, p9x16, startSek, sluttSek, '9:16');

    // Last opp til Supabase Storage
    let clipUrl: string | null = null;
    let verticalClipUrl: string | null = null;

    if (ok16x9) {
      clipUrl = await lastOppTilSupabase(db, p16x9, `content-factory/clips/${vodId}/${hId}_16x9.mp4`);
    }
    if (ok9x16) {
      verticalClipUrl = await lastOppTilSupabase(db, p9x16, `content-factory/clips/${vodId}/${hId}_9x16.mp4`);
    }

    // Slett lokale filer
    for (const f of [råPath, p16x9, p9x16]) {
      try { fs.unlinkSync(f); } catch {}
    }

    // Oppdater Supabase
    await db.from('content_highlights').update({
      clip_status: (clipUrl || verticalClipUrl) ? 'CLIPPED' : 'CLIP_FAILED',
      clip_url: clipUrl,
      vertical_clip_url: verticalClipUrl,
      clip_finished_at: new Date().toISOString(),
      clip_error: (!clipUrl && !verticalClipUrl) ? 'FFmpeg produserte ingen gyldig fil' : null,
    }).eq('id', hId);

    console.log(`[ClipWorker] ✓ Ferdig: ${hId} – 16:9: ${!!clipUrl}, 9:16: ${!!verticalClipUrl}`);
  } catch (err: any) {
    console.error(`[ClipWorker] ✗ Feil for ${hId}:`, err.message);
    for (const f of [råPath, p16x9, p9x16]) {
      try { fs.unlinkSync(f); } catch {}
    }
    await db.from('content_highlights').update({
      clip_status: 'CLIP_FAILED',
      clip_error: err.message?.slice(0, 500),
      clip_finished_at: new Date().toISOString(),
    }).eq('id', hId);
  } finally {
    klipperNå.delete(hId);
  }
}

export async function startClipWorker(): Promise<void> {
  if (process.env.CONTENT_FACTORY_ENABLED !== 'true') {
    console.log('[ClipWorker] Deaktivert (CONTENT_FACTORY_ENABLED != true)');
    return;
  }

  console.log('[ClipWorker] ✓ Startet – sjekker READY_FOR_CLIP highlights hvert minutt');

  const kjørSyklus = async () => {
    if (process.env.CONTENT_FACTORY_ENABLED !== 'true') return;
    const db = getDb();
    if (!db) return;

    try {
      // Hent highlights klare for klipping (maks 3 om gangen)
      const { data: highlights } = await db
        .from('content_highlights')
        .select('id,vod_id,start_time,end_time,title')
        .eq('clip_status', 'READY_FOR_CLIP')
        .not('id', 'in', `(${Array.from(klipperNå).join(',') || 'null'})`)
        .limit(3);

      if (!highlights || highlights.length === 0) return;

      // Hent VOD-URLer
      const vodIds = [...new Set(highlights.map(h => h.vod_id))];
      const { data: vods } = await db
        .from('content_vods')
        .select('id,vod_url,twitch_vod_id')
        .in('id', vodIds);

      const vodMap = new Map((vods ?? []).map(v => [
        v.id,
        v.vod_url ?? (v.twitch_vod_id ? `https://www.twitch.tv/videos/${v.twitch_vod_id}` : null)
      ]));

      for (const h of highlights) {
        const vodUrl = vodMap.get(h.vod_id);
        if (!vodUrl) {
          await db.from('content_highlights').update({
            clip_status: 'CLIP_FAILED',
            clip_error: 'Ingen VOD-URL tilgjengelig',
          }).eq('id', h.id);
          continue;
        }

        // Sett CLIPPING umiddelbart (lock)
        await db.from('content_highlights').update({ clip_status: 'CLIPPING' }).eq('id', h.id);
        klipperNå.add(h.id);

        // Klipp asynkront (ikke await – håndter parallelt)
        klippHighlight(h, vodUrl).catch(err => {
          console.error('[ClipWorker] Uventet feil:', err.message);
          klipperNå.delete(h.id);
        });
      }
    } catch (err: any) {
      console.error('[ClipWorker] Syklus-feil:', err.message);
    }
  };

  // Kjør umiddelbart, deretter hvert minutt
  await kjørSyklus();
  setInterval(kjørSyklus, 60_000);
}
