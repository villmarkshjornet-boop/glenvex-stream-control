import { assertContentFactoryEnabled } from '../index';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import type { AssetFormat } from '../types';

const execAsync = promisify(exec);

export interface CutOptions {
  inputPath: string;
  outputPath: string;
  startTime: number;
  endTime: number;
  format: AssetFormat;
  withSubtitles?: string; // SRT file path
}

export interface RenderOptions {
  highlights: { inputPath: string; startTime: number; endTime: number; title?: string }[];
  outputPath: string;
  intro?: string;
  outro?: string;
}

function formålFilter(format: AssetFormat): string {
  switch (format) {
    case '9:16': return 'scale=1080:1920,setsar=1';
    case '1:1':  return 'scale=1080:1080,setsar=1';
    case '16:9': return 'scale=1920:1080,setsar=1';
    default:     return 'scale=1920:1080,setsar=1';
  }
}

export function erFFmpegTilgjengelig(): boolean {
  try {
    const { execSync } = require('child_process');
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export async function klippHighlight(opts: CutOptions): Promise<boolean> {
  assertContentFactoryEnabled();

  if (!erFFmpegTilgjengelig()) {
    console.warn('[ContentFactory] FFmpeg ikke tilgjengelig');
    return false;
  }

  const dir = path.dirname(opts.outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const vf = formålFilter(opts.format);
  const subtitleFilter = opts.withSubtitles && fs.existsSync(opts.withSubtitles)
    ? `,subtitles='${opts.withSubtitles}'`
    : '';

  const cmd = [
    'ffmpeg -y',
    `-ss ${opts.startTime}`,
    `-i "${opts.inputPath}"`,
    `-t ${opts.endTime - opts.startTime}`,
    `-vf "${vf}${subtitleFilter}"`,
    '-c:v libx264 -preset fast -crf 23',
    '-c:a aac -b:a 128k',
    '-movflags +faststart',
    `"${opts.outputPath}"`,
  ].join(' ');

  try {
    await execAsync(cmd);
    return true;
  } catch (err) {
    console.error('[FFmpeg] Klipp feilet:', err);
    return false;
  }
}

export async function genererLongform(opts: RenderOptions): Promise<boolean> {
  assertContentFactoryEnabled();

  if (!erFFmpegTilgjengelig()) return false;

  const dir = path.dirname(opts.outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Lag concat-liste
  const concatFile = opts.outputPath.replace('.mp4', '_concat.txt');
  const segmenter: string[] = [];

  if (opts.intro && fs.existsSync(opts.intro)) segmenter.push(`file '${opts.intro}'`);

  for (const h of opts.highlights) {
    const tmpPath = h.inputPath.replace('.mp4', `_trim_${h.startTime}.mp4`);
    await klippHighlight({
      inputPath: h.inputPath,
      outputPath: tmpPath,
      startTime: h.startTime,
      endTime: h.endTime,
      format: '16:9',
    });
    if (fs.existsSync(tmpPath)) segmenter.push(`file '${tmpPath}'`);
  }

  if (opts.outro && fs.existsSync(opts.outro)) segmenter.push(`file '${opts.outro}'`);

  fs.writeFileSync(concatFile, segmenter.join('\n'));

  const cmd = [
    'ffmpeg -y',
    `-f concat -safe 0 -i "${concatFile}"`,
    '-c:v libx264 -preset medium -crf 20',
    '-c:a aac -b:a 192k',
    '-movflags +faststart',
    `"${opts.outputPath}"`,
  ].join(' ');

  try {
    await execAsync(cmd);
    return true;
  } catch (err) {
    console.error('[FFmpeg] Longform feilet:', err);
    return false;
  }
}
