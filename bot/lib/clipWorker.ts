/**
 * Clip Worker – Bulletproof videoklipping fra Twitch VOD
 *
 * Strategier:
 * 1. HLS-URL via yt-dlp + ffmpeg direkte (raskest)
 * 2. yt-dlp --download-sections 720p
 * 3. yt-dlp laveste kvalitet
 * Alle feil: reset til READY_FOR_CLIP (aldri permanent FAILED)
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { logBotEvent } from './botEvents';

const DATA_DIR = path.join(process.cwd(), 'data');
const CLIPS_DIR = path.join(DATA_DIR, 'content-factory', 'clips');

const klipperNå = new Set<string>();
const execAsync = require('util').promisify(require('child_process').exec);

// ── Logging ring-buffer (siste 150 hendelser eksponert via /worker-status) ────
const LOG_RING: Array<{ ts: string; level: string; event: string; data?: Record<string, any> }> = [];
let syklusTeller = 0;
let sisteSyklusTid: string | null = null;

function wLog(level: 'INFO' | 'WARN' | 'ERROR', event: string, data?: Record<string, any>) {
  const entry: { ts: string; level: string; event: string; data?: Record<string, any> } = {
    ts: new Date().toISOString(),
    level,
    event,
  };
  if (data) entry.data = data;
  LOG_RING.push(entry);
  if (LOG_RING.length > 150) LOG_RING.shift();
  const suffix = data ? ' ' + JSON.stringify(data) : '';
  console.log(`[ClipWorker][${level}] ${event}${suffix}`);
}

export function getWorkerStatus() {
  return {
    enabled: process.env.CONTENT_FACTORY_ENABLED === 'true',
    env: {
      supabase_url: !!process.env.SUPABASE_URL,
      supabase_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      twitch_oauth: !!process.env.TWITCH_USER_OAUTH,
      content_factory_enabled: process.env.CONTENT_FACTORY_ENABLED,
    },
    activeClips: Array.from(klipperNå),
    pollCount: syklusTeller,
    lastPollAt: sisteSyklusTid,
    lastLogs: LOG_RING.slice(-30),
  };
}

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
    wLog('ERROR', 'FFMPEG_FAIL', { path: path.basename(utPath), err: err.message?.slice(0, 200) });
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
    // Hent public URL (ikke signed – unngår utløp)
    const { data: publicData } = sb.storage.from('glenvex-assets').getPublicUrl(storageSti);
    return publicData?.publicUrl ?? null;
  } catch (err: any) {
    wLog('ERROR', 'UPLOAD_FAIL', { path: storageSti, err: err.message?.slice(0, 200) });
    return null;
  }
}

async function lastOppOgFerdigstill(
  db: any, hId: string, vodId: string,
  p16x9: string, p9x16: string, ok16: boolean, ok9: boolean
): Promise<boolean> {
  let clipUrl: string | null = null;
  let verticalClipUrl: string | null = null;

  wLog('INFO', 'UPLOAD_STARTED', { highlightId: hId });

  if (ok16 && fs.existsSync(p16x9)) {
    clipUrl = await lastOppTilSupabase(db, p16x9, `content-factory/clips/${vodId}/${hId}_16x9.mp4`);
    wLog('INFO', 'UPLOAD_16x9', { ok: !!clipUrl });
  }
  if (ok9 && fs.existsSync(p9x16)) {
    verticalClipUrl = await lastOppTilSupabase(db, p9x16, `content-factory/clips/${vodId}/${hId}_9x16.mp4`);
    wLog('INFO', 'UPLOAD_9x16', { ok: !!verticalClipUrl });
  }
  ryddFil(p16x9, p9x16);

  if (clipUrl || verticalClipUrl) {
    wLog('INFO', 'UPLOAD_DONE', { highlightId: hId, har16x9: !!clipUrl, har9x16: !!verticalClipUrl });
    await db.from('content_highlights').update({
      clip_status: 'CLIPPED',
      clip_url: clipUrl,
      vertical_clip_url: verticalClipUrl,
      clip_finished_at: new Date().toISOString(),
      clip_error: null,
    }).eq('id', hId);
    wLog('INFO', 'DB_UPDATED_DONE', { highlightId: hId });
    logBotEvent('klipp_ferdig', { id: hId });
    return true;
  }

  // Opplasting feilet – reset til READY_FOR_CLIP
  wLog('WARN', 'UPLOAD_ALL_FAILED', { highlightId: hId });
  await db.from('content_highlights').update({
    clip_status: 'READY_FOR_CLIP',
    clip_error: 'Klipping OK – opplasting feilet, retry automatisk',
  }).eq('id', hId);
  return false;
}

async function klippHighlight(highlight: any, vodUrl: string): Promise<void> {
  const db = getDb();
  if (!db) { wLog('ERROR', 'NO_DB', { highlightId: highlight.id }); return; }

  const hId: string = highlight.id;
  // Eksplisitt parseFloat – Supabase NUMERIC returneres som string
  const startSek = Math.max(0, Math.floor(parseFloat(String(highlight.start_time))) - 3);
  const endSek = parseFloat(String(highlight.end_time));
  const varighetSek = Math.ceil(endSek - (startSek + 3)) + 6;
  const vodId: string = highlight.vod_id;

  wLog('INFO', 'CLIP_STARTED', { highlightId: hId, startSek, varighetSek, vodUrl: vodUrl.slice(0, 60) });

  sikreDir(path.join(CLIPS_DIR, vodId));
  const p16x9 = path.join(CLIPS_DIR, vodId, `${hId}_16x9.mp4`);
  const p9x16 = path.join(CLIPS_DIR, vodId, `${hId}_9x16.mp4`);

  const userOauth = (process.env.TWITCH_USER_OAUTH ?? '').replace(/^oauth:/, '');
  const authArg = userOauth ? `--add-header "Authorization:OAuth ${userOauth}"` : '';

  const vf16x9 = 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2';
  const vf9x16 = 'scale=-2:1280,crop=720:1280';

  // ── Forsøk 1: HLS-URL + ffmpeg ────────────────────────────────────────────
  wLog('INFO', 'TRY_1_HLS', { highlightId: hId });
  const hlsUrl = await hentHlsUrl(vodUrl, authArg);
  if (hlsUrl) {
    const [ok16, ok9] = await Promise.all([
      ffmpegKlipp(hlsUrl, p16x9, startSek, varighetSek, vf16x9, 26),
      ffmpegKlipp(hlsUrl, p9x16, startSek, varighetSek, vf9x16, 26),
    ]);
    if (ok16 || ok9) {
      wLog('INFO', 'CLIP_DONE_TRY1', { highlightId: hId, ok16, ok9 });
      await komprimerHvisForStor(p16x9);
      await komprimerHvisForStor(p9x16);
      const ok = await lastOppOgFerdigstill(db, hId, vodId, p16x9, p9x16, ok16, ok9);
      if (ok) { klipperNå.delete(hId); return; }
    }
  } else {
    wLog('WARN', 'HLS_URL_MISSING', { highlightId: hId });
  }

  // ── Forsøk 2: yt-dlp --download-sections ──────────────────────────────────
  wLog('INFO', 'TRY_2_SECTIONS', { highlightId: hId });
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
        wLog('INFO', 'CLIP_DONE_TRY2', { highlightId: hId, ok16, ok9 });
        await komprimerHvisForStor(p16x9);
        await komprimerHvisForStor(p9x16);
        const ok = await lastOppOgFerdigstill(db, hId, vodId, p16x9, p9x16, ok16, ok9);
        ryddFil(seg2);
        if (ok) { klipperNå.delete(hId); return; }
      }
    }
  } catch (err: any) {
    wLog('ERROR', 'TRY2_FAIL', { highlightId: hId, err: err.message?.slice(0, 200) });
  } finally { ryddFil(seg2); }

  // ── Forsøk 3: laveste mulige kvalitet ─────────────────────────────────────
  wLog('INFO', 'TRY_3_LOWEST', { highlightId: hId });
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
        wLog('INFO', 'CLIP_DONE_TRY3', { highlightId: hId, ok16, ok9 });
        const ok = await lastOppOgFerdigstill(db, hId, vodId, p16x9, p9x16, ok16, ok9);
        ryddFil(seg3);
        if (ok) { klipperNå.delete(hId); return; }
      }
    }
  } catch (err: any) {
    wLog('ERROR', 'TRY3_FAIL', { highlightId: hId, err: err.message?.slice(0, 200) });
  } finally { ryddFil(seg3); }

  // Alle 3 forsøk feilet
  wLog('ERROR', 'ALL_TRIES_FAILED', { highlightId: hId });
  await db.from('content_highlights').update({
    clip_status: 'READY_FOR_CLIP',
    clip_error: 'Alle 3 forsøk feilet – prøves igjen automatisk',
  }).eq('id', hId);

  klipperNå.delete(hId);
}

// ── Syklus: hent og start READY_FOR_CLIP-jobber ──────────────────────────────
async function kjørSyklus(): Promise<void> {
  if (process.env.CONTENT_FACTORY_ENABLED !== 'true') return;
  const db = getDb();
  if (!db) {
    wLog('ERROR', 'POLL_NO_DB');
    return;
  }

  syklusTeller++;
  sisteSyklusTid = new Date().toISOString();
  const lock = Array.from(klipperNå);

  // ── KRITISK FIX: IKKE bruk .not('id','in','(null)') når lock er tom ────────
  // PostgreSQL: `id NOT IN (NULL)` returnerer alltid 0 rader (NULL-sammenligning)
  const baseQuery = db
    .from('content_highlights')
    .select('id,vod_id,start_time,end_time,title')
    .eq('clip_status', 'READY_FOR_CLIP')
    .limit(3);

  const { data: highlights, error } = lock.length > 0
    ? await baseQuery.not('id', 'in', `(${lock.join(',')})`)
    : await baseQuery;

  if (error) {
    wLog('ERROR', 'POLL_QUERY_ERROR', { err: error.message });
    return;
  }

  wLog('INFO', 'POLL_CYCLE', { syklus: syklusTeller, funnet: highlights?.length ?? 0, aktive: lock.length });

  if (!highlights || highlights.length === 0) return;

  wLog('INFO', 'JOBS_FOUND', { antall: highlights.length, ids: highlights.map((h: any) => h.id) });

  const vodIds = Array.from(new Set<string>(highlights.map((h: any) => h.vod_id as string)));
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
      wLog('ERROR', 'NO_VOD_URL', { highlightId: h.id, vodId: h.vod_id });
      await db.from('content_highlights').update({
        clip_status: 'READY_FOR_CLIP',
        clip_error: 'Ingen VOD-URL funnet – sjekk at vod_url/twitch_vod_id er satt i content_vods',
      }).eq('id', h.id);
      continue;
    }

    wLog('INFO', 'JOB_CLAIMED', { highlightId: h.id, title: h.title });
    await db.from('content_highlights').update({ clip_status: 'CLIPPING', clip_error: null }).eq('id', h.id);
    klipperNå.add(h.id);
    logBotEvent('klipp_start', { title: h.title ?? h.id, vod_id: h.vod_id });

    klippHighlight(h, vodUrl).catch((err: any) => {
      wLog('ERROR', 'CLIP_CRASH', { highlightId: h.id, err: err.message?.slice(0, 300) });
      klipperNå.delete(h.id);
      getDb()?.from('content_highlights').update({
        clip_status: 'READY_FOR_CLIP',
        clip_error: `Krasj: ${err.message?.slice(0, 200)}`,
      }).eq('id', h.id).then(() => {});
    });
  }
}

// ── Direkte klipp av spesifikt highlight (bypass kø) ─────────────────────────
export async function forceKlippHighlight(highlightId: string): Promise<{ ok: boolean; melding: string }> {
  if (process.env.CONTENT_FACTORY_ENABLED !== 'true') {
    return { ok: false, melding: 'CONTENT_FACTORY_ENABLED er ikke true' };
  }
  if (klipperNå.has(highlightId)) {
    return { ok: false, melding: 'Klipper allerede dette highlightet' };
  }

  const db = getDb();
  if (!db) return { ok: false, melding: 'Supabase ikke tilkoblet' };

  const { data: h } = await db
    .from('content_highlights')
    .select('id,vod_id,start_time,end_time,title')
    .eq('id', highlightId)
    .single();

  if (!h) return { ok: false, melding: `Highlight ${highlightId} ikke funnet` };

  const { data: vod } = await db
    .from('content_vods')
    .select('vod_url,twitch_vod_id')
    .eq('id', h.vod_id)
    .single();

  const vodUrl = vod?.vod_url ?? (vod?.twitch_vod_id ? `https://www.twitch.tv/videos/${vod.twitch_vod_id}` : null);
  if (!vodUrl) return { ok: false, melding: `Ingen VOD-URL for vod_id ${h.vod_id}` };

  wLog('INFO', 'FORCE_CLIP_TRIGGERED', { highlightId, vodUrl: vodUrl.slice(0, 60) });
  await db.from('content_highlights').update({ clip_status: 'CLIPPING', clip_error: null }).eq('id', highlightId);
  klipperNå.add(highlightId);
  logBotEvent('klipp_start', { title: h.title ?? highlightId, vod_id: h.vod_id });

  klippHighlight(h, vodUrl).catch((err: any) => {
    wLog('ERROR', 'FORCE_CLIP_CRASH', { highlightId, err: err.message?.slice(0, 300) });
    klipperNå.delete(highlightId);
    getDb()?.from('content_highlights').update({
      clip_status: 'READY_FOR_CLIP',
      clip_error: `Force-clip krasj: ${err.message?.slice(0, 200)}`,
    }).eq('id', highlightId).then(() => {});
  });

  return { ok: true, melding: `Force-klipp startet for ${highlightId}` };
}

export async function startClipWorker(): Promise<void> {
  if (process.env.CONTENT_FACTORY_ENABLED !== 'true') {
    console.log('[ClipWorker] Deaktivert (CONTENT_FACTORY_ENABLED != true)');
    return;
  }

  wLog('INFO', 'WORKER_STARTED', {
    supabase_url: !!process.env.SUPABASE_URL,
    supabase_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    twitch_oauth: !!process.env.TWITCH_USER_OAUTH,
  });

  const db = getDb();
  if (!db) {
    wLog('ERROR', 'ENV_MISSING', { melding: 'SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY mangler' });
    return;
  }

  wLog('INFO', 'ENV_OK');

  // Reset CLIPPING → READY_FOR_CLIP ved oppstart (Railway-restart dreper aktive jobs)
  const { data: stucke } = await db
    .from('content_highlights')
    .select('id')
    .eq('clip_status', 'CLIPPING');

  if (stucke && stucke.length > 0) {
    await db.from('content_highlights').update({
      clip_status: 'READY_FOR_CLIP',
      clip_error: 'Resatt ved worker-restart',
    }).eq('clip_status', 'CLIPPING');
    wLog('WARN', 'STARTUP_CLIPPING_RESET', { antall: stucke.length });
  }

  wLog('INFO', 'POLL_STARTED', { intervallMs: 60_000 });
  await kjørSyklus();
  setInterval(kjørSyklus, 60_000);
}

export async function triggerClipNow(): Promise<void> {
  wLog('INFO', 'MANUAL_TRIGGER');
  await kjørSyklus();
}
