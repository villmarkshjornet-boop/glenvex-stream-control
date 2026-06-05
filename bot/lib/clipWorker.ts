/**
 * Clip Worker – Bulletproof videoklipping fra Twitch VOD
 *
 * Strategi:
 * 1. Hent direkte HLS-URL via yt-dlp (sekunder, ingen nedlasting)
 * 2. ffmpeg klipper direkte fra HLS-stream (seek i HLS, kun nødvendige segmenter)
 * 3. Fallback: yt-dlp --download-sections 720p
 * 4. Fallback 2: yt-dlp laveste kvalitet
 * 5. Alle feil: reset til READY_FOR_CLIP (aldri CLIP_FAILED – automatisk retry)
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { logBotEvent } from './botEvents';

const DATA_DIR = path.join(process.cwd(), 'data');
const CLIPS_DIR = path.join(DATA_DIR, 'content-factory', 'clips');

const klipperNå = new Set<string>();
const execAsync = require('util').promisify(require('child_process').exec);

function getDb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { realtime: { transport: require('ws') } });
}

function sikreDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ryddFil(...paths: string[]) {
  for (const p of paths) try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}

async function hentHlsUrl(twitchVodUrl: string, authArg: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `yt-dlp --get-url -f "best[height<=720]/best" ${authArg} "${twitchVodUrl}"`,
      { timeout: 30_000 }
    );
    return stdout.trim().split('\n')[0] || null;
  } catch { return null; }
}

async function ffmpegKlipp(
  sourceUrl: string,
  utPath: string,
  startSek: number,
  varighetSek: number,
  vfFilter: string,
  crf: number
): Promise<boolean> {
  try {
    await execAsync(
      `ffmpeg -y -ss ${startSek} -t ${varighetSek} -i "${sourceUrl}" -vf "${vfFilter}" -c:v libx264 -preset fast -crf ${crf} -c:a aac -b:a 96k -movflags +faststart "${utPath}"`,
      { maxBuffer: 1024 * 1024 * 100, timeout: 300_000 }
    );
    return fs.existsSync(utPath) && fs.statSync(utPath).size > 20_000;
  } catch (err: any) {
    console.error(`[ClipWorker] ffmpeg feil (${path.basename(utPath)}):`, err.message?.slice(0, 200));
    return false;
  }
}

async function komprimerHvisForStor(filPath: string): Promise<void> {
  const MAX = 45 * 1024 * 1024;
  if (!fs.existsSync(filPath) || fs.statSync(filPath).size <= MAX) return;
  const tmp = filPath.replace('.mp4', '_c.mp4');
  try {
    await execAsync(
      `ffmpeg -y -i "${filPath}" -c:v libx264 -preset fast -crf 32 -c:a aac -b:a 64k -movflags +faststart "${tmp}"`,
      { timeout: 180_000 }
    );
    if (fs.existsSync(tmp) && fs.statSync(tmp).size > 10_000) fs.renameSync(tmp, filPath);
  } catch { ryddFil(tmp); }
}

async function lastOppTilSupabase(sb: any, lokalSti: string, storageSti: string): Promise<string | null> {
  if (!fs.existsSync(lokalSti)) return null;
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

async function lastOppOgFerdigstill(
  db: any, hId: string, vodId: string,
  p16x9: string, p9x16: string, ok16: boolean, ok9: boolean
): Promise<boolean> {
  let clipUrl: string | null = null;
  let verticalClipUrl: string | null = null;

  if (ok16 && fs.existsSync(p16x9)) {
    clipUrl = await lastOppTilSupabase(db, p16x9, `content-factory/clips/${vodId}/${hId}_16x9.mp4`);
  }
  if (ok9 && fs.existsSync(p9x16)) {
    verticalClipUrl = await lastOppTilSupabase(db, p9x16, `content-factory/clips/${vodId}/${hId}_9x16.mp4`);
  }
  ryddFil(p16x9, p9x16);

  if (clipUrl || verticalClipUrl) {
    await db.from('content_highlights').update({
      clip_status: 'CLIPPED',
      clip_url: clipUrl,
      vertical_clip_url: verticalClipUrl,
      clip_finished_at: new Date().toISOString(),
      clip_error: null,
    }).eq('id', hId);
    logBotEvent('klipp_ferdig', { id: hId });
    console.log(`[ClipWorker] ✓ Ferdig: ${hId} – 16:9: ${!!clipUrl}, 9:16: ${!!verticalClipUrl}`);
    return true;
  }

  // Opplasting feilet – reset til READY_FOR_CLIP for automatisk retry
  await db.from('content_highlights').update({
    clip_status: 'READY_FOR_CLIP',
    clip_error: 'Klipping OK – opplasting til Supabase Storage feilet, retry automatisk',
  }).eq('id', hId);
  return false;
}

async function klippHighlight(highlight: any, vodUrl: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  const hId = highlight.id;
  const startSek = Math.max(0, Math.floor(highlight.start_time) - 3);
  const varighetSek = Math.ceil(highlight.end_time - highlight.start_time) + 6;
  const vodId = highlight.vod_id;

  sikreDir(path.join(CLIPS_DIR, vodId));
  const p16x9 = path.join(CLIPS_DIR, vodId, `${hId}_16x9.mp4`);
  const p9x16 = path.join(CLIPS_DIR, vodId, `${hId}_9x16.mp4`);

  const userOauth = (process.env.TWITCH_USER_OAUTH ?? '').replace(/^oauth:/, '');
  const authArg = userOauth ? `--add-header "Authorization:OAuth ${userOauth}"` : '';

  const vf16x9 = 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2';
  const vf9x16 = 'scale=-2:1280,crop=720:1280';

  console.log(`[ClipWorker] Starter klipping: ${hId} [t=${startSek}s, dur=${varighetSek}s]`);

  // ── Forsøk 1: HLS-URL fra yt-dlp + ffmpeg direkte ─────────────────────────
  const hlsUrl = await hentHlsUrl(vodUrl, authArg);
  if (hlsUrl) {
    const [ok16, ok9] = await Promise.all([
      ffmpegKlipp(hlsUrl, p16x9, startSek, varighetSek, vf16x9, 26),
      ffmpegKlipp(hlsUrl, p9x16, startSek, varighetSek, vf9x16, 26),
    ]);
    if (ok16 || ok9) {
      await komprimerHvisForStor(p16x9);
      await komprimerHvisForStor(p9x16);
      const ok = await lastOppOgFerdigstill(db, hId, vodId, p16x9, p9x16, ok16, ok9);
      if (ok) { klipperNå.delete(hId); return; }
    }
  }
  console.log(`[ClipWorker] Forsøk 1 feilet – prøver forsøk 2 (yt-dlp --download-sections)`);

  // ── Forsøk 2: yt-dlp --download-sections ──────────────────────────────────
  ryddFil(p16x9, p9x16);
  const seg2 = path.join(CLIPS_DIR, vodId, `${hId}_raw2.mp4`);
  try {
    await execAsync(
      `yt-dlp --download-sections "*${startSek}-${startSek + varighetSek}" -f "bestvideo[height<=720]+bestaudio/best[height<=720]/best[height<=720]" --merge-output-format mp4 ${authArg} -o "${seg2}" "${vodUrl}"`,
      { maxBuffer: 1024 * 1024 * 500, timeout: 300_000 }
    );
    if (fs.existsSync(seg2) && fs.statSync(seg2).size > 20_000) {
      const [ok16, ok9] = await Promise.all([
        ffmpegKlipp(seg2, p16x9, 0, varighetSek, vf16x9, 28),
        ffmpegKlipp(seg2, p9x16, 0, varighetSek, vf9x16, 28),
      ]);
      if (ok16 || ok9) {
        await komprimerHvisForStor(p16x9);
        await komprimerHvisForStor(p9x16);
        const ok = await lastOppOgFerdigstill(db, hId, vodId, p16x9, p9x16, ok16, ok9);
        ryddFil(seg2);
        if (ok) { klipperNå.delete(hId); return; }
      }
    }
  } catch (err: any) {
    console.error(`[ClipWorker] Forsøk 2 feilet:`, err.message?.slice(0, 200));
  } finally { ryddFil(seg2); }

  console.log(`[ClipWorker] Forsøk 2 feilet – prøver forsøk 3 (laveste kvalitet)`);

  // ── Forsøk 3: laveste mulige kvalitet ─────────────────────────────────────
  ryddFil(p16x9, p9x16);
  const seg3 = path.join(CLIPS_DIR, vodId, `${hId}_raw3.mp4`);
  try {
    await execAsync(
      `yt-dlp --download-sections "*${startSek}-${startSek + varighetSek}" -f "worst/best" --merge-output-format mp4 ${authArg} -o "${seg3}" "${vodUrl}"`,
      { maxBuffer: 1024 * 1024 * 500, timeout: 300_000 }
    );
    if (fs.existsSync(seg3) && fs.statSync(seg3).size > 10_000) {
      const vf480_16x9 = 'scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2';
      const vf480_9x16 = 'scale=-2:854,crop=480:854';
      const [ok16, ok9] = await Promise.all([
        ffmpegKlipp(seg3, p16x9, 0, varighetSek, vf480_16x9, 32),
        ffmpegKlipp(seg3, p9x16, 0, varighetSek, vf480_9x16, 32),
      ]);
      if (ok16 || ok9) {
        const ok = await lastOppOgFerdigstill(db, hId, vodId, p16x9, p9x16, ok16, ok9);
        ryddFil(seg3);
        if (ok) { klipperNå.delete(hId); return; }
      }
    }
  } catch (err: any) {
    console.error(`[ClipWorker] Forsøk 3 feilet:`, err.message?.slice(0, 200));
  } finally { ryddFil(seg3); }

  // Alle 3 forsøk feilet – reset til READY_FOR_CLIP (aldri CLIP_FAILED)
  await db.from('content_highlights').update({
    clip_status: 'READY_FOR_CLIP',
    clip_error: 'Alle 3 forsøk feilet – prøves igjen automatisk om 1 minutt',
  }).eq('id', hId);
  console.error(`[ClipWorker] ✗ Alle forsøk feilet for ${hId} – resatt til READY_FOR_CLIP`);

  klipperNå.delete(hId);
}

// ── Syklus: hent og start jobber ─────────────────────────────────────────────
async function kjørSyklus(): Promise<void> {
  if (process.env.CONTENT_FACTORY_ENABLED !== 'true') return;
  const db = getDb();
  if (!db) return;

  try {
    const lock = Array.from(klipperNå);
    const { data: highlights } = await db
      .from('content_highlights')
      .select('id,vod_id,start_time,end_time,title')
      .eq('clip_status', 'READY_FOR_CLIP')
      .not('id', 'in', `(${lock.length > 0 ? lock.join(',') : 'null'})`)
      .limit(2);

    if (!highlights || highlights.length === 0) return;

    const vodIds = [...new Set(highlights.map((h: any) => h.vod_id))];
    const { data: vods } = await db
      .from('content_vods')
      .select('id,vod_url,twitch_vod_id')
      .in('id', vodIds);

    const vodMap = new Map((vods ?? []).map((v: any) => [
      v.id,
      v.vod_url ?? (v.twitch_vod_id ? `https://www.twitch.tv/videos/${v.twitch_vod_id}` : null),
    ]));

    for (const h of highlights) {
      const vodUrl = vodMap.get(h.vod_id);
      if (!vodUrl) {
        console.error(`[ClipWorker] Ingen VOD-URL for highlight ${h.id}`);
        continue;
      }
      await db.from('content_highlights').update({ clip_status: 'CLIPPING', clip_error: null }).eq('id', h.id);
      klipperNå.add(h.id);
      logBotEvent('klipp_start', { title: h.title ?? h.id, vod_id: h.vod_id });
      klippHighlight(h, vodUrl).catch((err: any) => {
        console.error('[ClipWorker] Uventet krasj:', err.message);
        klipperNå.delete(h.id);
        getDb()?.from('content_highlights').update({
          clip_status: 'READY_FOR_CLIP',
          clip_error: `Uventet feil: ${err.message?.slice(0, 200)}`,
        }).eq('id', h.id).then(() => {});
      });
    }
  } catch (err: any) {
    console.error('[ClipWorker] Syklus-feil:', err.message);
  }
}

export async function startClipWorker(): Promise<void> {
  if (process.env.CONTENT_FACTORY_ENABLED !== 'true') {
    console.log('[ClipWorker] Deaktivert');
    return;
  }
  console.log('[ClipWorker] ✓ Startet – sjekker READY_FOR_CLIP hvert minutt');
  await kjørSyklus();
  setInterval(kjørSyklus, 60_000);
}

export async function triggerClipNow(): Promise<void> {
  await kjørSyklus();
}
