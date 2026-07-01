/**
 * loadPersonaImage — safe cross-platform image loader for @napi-rs/canvas.
 *
 * @napi-rs/canvas 1.0.2 crashes on Windows when loading from a Buffer
 * (throws "Invalid SVG image" regardless of actual format). Loading via
 * file path string works correctly. This wrapper normalises all input types
 * to a file path before calling loadImage.
 *
 * Input types handled:
 *   path   — local file path   → loadImage(path)           (zero copies)
 *   url    — http/https URL    → fetch → tempFile → loadImage(tempPath)
 *   buffer — raw Buffer        → tempFile → loadImage(tempPath)
 *
 * Temp files are always cleaned up in a finally block (after loadImage
 * resolves — the decoded bitmap lives in memory, the file is no longer
 * needed at that point).
 */

import { loadImage, type Image } from '@napi-rs/canvas';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export type ImageSourceType = 'path' | 'url' | 'buffer';

export interface LoadedImage {
  img:        Image;
  sourceType: ImageSourceType;
  width:      number;
  height:     number;
}

export async function loadPersonaImage(
  input:   string | Buffer | null | undefined,
  context: string = '[imageLoader]',
): Promise<LoadedImage> {
  if (!input) throw new Error(`${context} loadPersonaImage: input is null/undefined`);

  let tmpPath: string | null = null;

  try {
    if (Buffer.isBuffer(input)) {
      tmpPath = path.join(os.tmpdir(), `persona_${crypto.randomUUID()}.png`);
      console.log(`${context} source=buffer  → temp: ${tmpPath} (${(input.length / 1024).toFixed(1)} KB)`);
      fs.writeFileSync(tmpPath, input);
      const img = await loadImage(tmpPath);
      console.log(`${context} loaded OK: ${img.width}×${img.height}px  (buffer via temp)`);
      return { img, sourceType: 'buffer', width: img.width, height: img.height };
    }

    if (input.startsWith('http://') || input.startsWith('https://')) {
      console.log(`${context} source=url     → fetching: ${input}`);
      const res = await fetch(input, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`${context} HTTP ${res.status} fetching ${input}`);
      const buf = Buffer.from(await res.arrayBuffer());
      tmpPath = path.join(os.tmpdir(), `persona_${crypto.randomUUID()}.png`);
      console.log(`${context} source=url     → temp: ${tmpPath} (${(buf.length / 1024).toFixed(1)} KB)`);
      fs.writeFileSync(tmpPath, buf);
      const img = await loadImage(tmpPath);
      console.log(`${context} loaded OK: ${img.width}×${img.height}px  (url via temp)`);
      return { img, sourceType: 'url', width: img.width, height: img.height };
    }

    // Local file path — fastest path, zero copies
    console.log(`${context} source=path    → ${input}`);
    const img = await loadImage(input);
    console.log(`${context} loaded OK: ${img.width}×${img.height}px  (path)`);
    return { img, sourceType: 'path', width: img.width, height: img.height };

  } finally {
    if (tmpPath) {
      try { fs.unlinkSync(tmpPath); }
      catch { /* non-fatal: OS will clean it up eventually */ }
    }
  }
}
