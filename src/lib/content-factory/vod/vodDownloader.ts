import { assertContentFactoryEnabled } from '../index';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { logPipeline } from '../jobs/pipelineLogger';

const execAsync = promisify(exec);
const OUTPUT_DIR = path.join(process.cwd(), 'data', 'content-factory', 'raw-vods');
const AUDIO_DIR = path.join(process.cwd(), 'data', 'content-factory', 'transcripts');

function sikkerDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function erYtDlpTilgjengelig(): boolean {
  try {
    const { execSync } = require('child_process');
    execSync('yt-dlp --version', { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function erFFmpegTilgjengelig(): boolean {
  try {
    const { execSync } = require('child_process');
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

export async function lastNedVod(
  vodId: string,
  twitchVodUrl: string,
  userOauth?: string
): Promise<{ videoPath: string; audioPath: string } | null> {
  assertContentFactoryEnabled();

  if (!erYtDlpTilgjengelig()) {
    console.warn('[ContentFactory] yt-dlp ikke tilgjengelig – installer via nixpacks.toml');
    return null;
  }

  sikkerDir(OUTPUT_DIR);
  sikkerDir(AUDIO_DIR);

  const videoPath = path.join(OUTPUT_DIR, `${vodId}.mp4`);
  const audioPath = path.join(AUDIO_DIR, `${vodId}.mp3`);

  const start = Date.now();
  await logPipeline({ vodId, step: 'DOWNLOAD', status: 'STARTED', message: `Laster ned: ${twitchVodUrl}` });

  try {
    // Bygg yt-dlp kommando
    const cookieArg = userOauth
      ? `--add-header "Authorization:OAuth ${userOauth}"`
      : '';

    // Last ned video (maks 1080p for ytelse)
    const dlCmd = [
      'yt-dlp',
      '-f "bestvideo[height<=1080]+bestaudio/best[height<=1080]"',
      '--merge-output-format mp4',
      '--no-playlist',
      cookieArg,
      `-o "${videoPath}"`,
      `"${twitchVodUrl}"`,
    ].filter(Boolean).join(' ');

    console.log('[ContentFactory] Laster ned VOD...');
    await execAsync(dlCmd, { maxBuffer: 1024 * 1024 * 100 });

    if (!fs.existsSync(videoPath)) throw new Error('Videofil ikke funnet etter nedlasting');

    await logPipeline({
      vodId, step: 'DOWNLOAD', status: 'COMPLETE',
      durationMs: Date.now() - start,
      message: `VOD lastet ned: ${videoPath}`,
    });

    // Ekstraher audio for Whisper
    const audioPath2 = await ekstraherAudio(vodId, videoPath);

    return { videoPath, audioPath: audioPath2 ?? audioPath };
  } catch (err) {
    await logPipeline({ vodId, step: 'DOWNLOAD', status: 'FAILED', message: (err as Error).message });
    console.error('[ContentFactory] VOD-nedlasting feilet:', err);
    return null;
  }
}

export async function ekstraherAudio(vodId: string, videoPath: string): Promise<string | null> {
  assertContentFactoryEnabled();

  if (!erFFmpegTilgjengelig()) {
    console.warn('[ContentFactory] FFmpeg ikke tilgjengelig');
    return null;
  }

  sikkerDir(AUDIO_DIR);
  const audioPath = path.join(AUDIO_DIR, `${vodId}.mp3`);

  try {
    const cmd = [
      'ffmpeg -y',
      `-i "${videoPath}"`,
      '-vn',                    // Ingen video
      '-ar 16000',              // 16kHz sample rate (Whisper-optimert)
      '-ac 1',                  // Mono
      '-c:a libmp3lame -q:a 4', // MP3 kvalitet
      `"${audioPath}"`,
    ].join(' ');

    await execAsync(cmd);
    console.log('[ContentFactory] Audio ekstrahert:', audioPath);
    return audioPath;
  } catch (err) {
    console.error('[ContentFactory] Audio-ekstraksjon feilet:', err);
    return null;
  }
}

export async function lastNedKlipp(
  url: string,
  utPath: string
): Promise<boolean> {
  assertContentFactoryEnabled();

  if (!erYtDlpTilgjengelig()) return false;

  sikkerDir(path.dirname(utPath));
  try {
    await execAsync(`yt-dlp -o "${utPath}" "${url}"`);
    return fs.existsSync(utPath);
  } catch { return false; }
}

export function hentVideoSti(vodId: string): string {
  return path.join(OUTPUT_DIR, `${vodId}.mp4`);
}

export function hentAudioSti(vodId: string): string {
  return path.join(AUDIO_DIR, `${vodId}.mp3`);
}

export function videoFinnes(vodId: string): boolean {
  return fs.existsSync(hentVideoSti(vodId));
}
