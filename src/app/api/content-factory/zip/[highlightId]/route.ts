import { NextRequest, NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';
import JSZip from 'jszip';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BRAND_SLUG = process.env.BRAND_SLUG ?? 'glenvex';

export async function GET(
  _req: NextRequest,
  { params }: { params: { highlightId: string } }
) {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const { highlightId } = params;
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB ikke tilkoblet' }, { status: 500 });

  const { data: h } = await db
    .from('content_highlights')
    .select('*')
    .eq('id', highlightId)
    .single();

  if (!h) return NextResponse.json({ error: 'Highlight ikke funnet' }, { status: 404 });

  const { data: copies } = await db
    .from('content_copy')
    .select('*')
    .eq('highlight_id', highlightId);

  const { data: vod } = await db
    .from('content_vods')
    .select('title, category')
    .eq('id', h.vod_id)
    .single();

  const yt = copies?.find((c: any) => c.platform === 'youtube');
  const tt = copies?.find((c: any) => c.platform === 'tiktok');
  const ig = copies?.find((c: any) => c.platform === 'instagram');
  const dc = copies?.find((c: any) => c.platform === 'discord');

  const zip = new JSZip();
  const tittelSlug = (h.title ?? 'highlight')
    .replace(/[^\w\sæøåÆØÅ-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 40);

  // ─── Tekstfiler per plattform ───────────────────────────────────────────────

  if (yt) {
    const linjer = [
      yt.tittel ?? '',
      '',
      yt.beskrivelse ?? '',
      '',
      (yt.hashtags ?? []).join(' '),
    ];
    zip.file('youtube.txt', linjer.join('\n'), { compression: 'DEFLATE' });
  }

  if (tt) {
    const linjer = [tt.caption ?? '', '', (tt.hashtags ?? []).join(' ')];
    zip.file('tiktok.txt', linjer.join('\n'), { compression: 'DEFLATE' });
  }

  if (ig) {
    const linjer = [ig.caption ?? '', '', (ig.hashtags ?? []).join(' ')];
    zip.file('instagram.txt', linjer.join('\n'), { compression: 'DEFLATE' });
  }

  if (dc) {
    zip.file('discord.txt', dc.discord_post ?? '', { compression: 'DEFLATE' });
  }

  // ─── Metadata ──────────────────────────────────────────────────────────────

  const startSek = parseFloat(h.start_time) || 0;
  const endSek = parseFloat(h.end_time) || 0;

  const metadata = {
    highlightId,
    title: h.title,
    category: h.category,
    score: h.score,
    startTime: startSek,
    endTime: endSek,
    durationSeconds: Math.round(endSek - startSek),
    begrunnelse: h.begrunnelse,
    vodTitle: vod?.title ?? null,
    game: vod?.category ?? null,
    videoUrl16x9: h.clip_url ?? null,
    videoUrl9x16: h.vertical_clip_url ?? null,
    generatedAt: new Date().toISOString(),
  };
  zip.file('metadata.json', JSON.stringify(metadata, null, 2), { compression: 'DEFLATE' });

  // ─── README med nedlastingslenker for videoer ───────────────────────────────

  const minSek = Math.floor(startSek / 60);
  const sekRest = Math.floor(startSek % 60);
  const tidStr = `${String(minSek).padStart(2, '0')}:${String(sekRest).padStart(2, '0')}`;

  const readme = [
    'GLENVEX Highlight-pakke',
    '======================',
    `Tittel:    ${h.title ?? 'Ukjent'}`,
    `Kategori:  ${h.category ?? 'Ukjent'}`,
    `Score:     ${h.score}/100`,
    `Stream:    ${vod?.title ?? 'Ukjent'}`,
    `Spill:     ${vod?.category ?? 'Ukjent'}`,
    `Tidspunkt: ${tidStr} → ${Math.floor(endSek / 60).toString().padStart(2, '0')}:${(Math.floor(endSek % 60)).toString().padStart(2, '0')}`,
    `Varighet:  ${Math.round(endSek - startSek)}s`,
    '',
    'VIDEOKLIPP (last ned direkte)',
    '------------------------------',
    h.clip_url
      ? `16:9 (YouTube / Twitch Clip): ${h.clip_url}`
      : '16:9: Ikke generert ennå – gå til Content Factory og generer klipp',
    h.vertical_clip_url
      ? `9:16 (TikTok / Reels / Shorts): ${h.vertical_clip_url}`
      : '9:16: Ikke generert ennå',
    '',
    'INNHOLD I DENNE PAKKEN',
    '----------------------',
    yt ? '✓ youtube.txt  – tittel, beskrivelse og hashtags for YouTube' : '✗ youtube.txt  – ikke generert',
    tt ? '✓ tiktok.txt   – caption og hashtags for TikTok' : '✗ tiktok.txt   – ikke generert',
    ig ? '✓ instagram.txt – caption og hashtags for Instagram' : '✗ instagram.txt – ikke generert',
    dc ? '✓ discord.txt  – post-tekst for Discord' : '✗ discord.txt  – ikke generert',
    '✓ metadata.json – komplett metadata',
    '',
    'Generert av GLENVEX Creator OS',
  ].join('\n');

  zip.file('README.txt', readme, { compression: 'DEFLATE' });

  // ─── Videofiler fra Supabase Storage ───────────────────────────────────────

  async function hentBinærBuf(url: string, timeoutMs = 45_000): Promise<ArrayBuffer | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return null;
      return await res.arrayBuffer();
    } catch { return null; }
  }

  if (h.clip_url) {
    const buf = await hentBinærBuf(h.clip_url);
    if (buf) zip.file(`${tittelSlug}_16x9.mp4`, buf, { compression: 'STORE' });
  }

  if (h.vertical_clip_url) {
    const buf = await hentBinærBuf(h.vertical_clip_url);
    if (buf) zip.file(`${tittelSlug}_9x16.mp4`, buf, { compression: 'STORE' });
  }

  // ─── Thumbnail-filer (valgfrie – ZIP fungerer uten dem) ─────────────────────

  if (h.thumbnail_youtube_url) {
    const buf = await hentBinærBuf(h.thumbnail_youtube_url, 30_000);
    if (buf) zip.file('thumbnail_youtube.png', buf, { compression: 'STORE' });
  }

  if (h.thumbnail_tiktok_url) {
    const buf = await hentBinærBuf(h.thumbnail_tiktok_url, 30_000);
    if (buf) zip.file('thumbnail_tiktok.png', buf, { compression: 'STORE' });
  }

  if (h.thumbnail_prompt) {
    zip.file('thumbnail_prompt.txt', h.thumbnail_prompt, { compression: 'DEFLATE' });
  }

  const thumbMetadata = {
    highlight_id:          highlightId,
    vod_id:                h.vod_id,
    category:              h.category ?? null,
    headline:              h.thumbnail_headline ?? null,
    subheadline:           h.thumbnail_subheadline ?? null,
    source_frame_time:     null,
    thumbnail_status:      h.thumbnail_status ?? null,
    youtube_thumbnail_url: h.thumbnail_youtube_url ?? null,
    tiktok_thumbnail_url:  h.thumbnail_tiktok_url ?? null,
  };
  zip.file('thumbnail_metadata.json', JSON.stringify(thumbMetadata, null, 2), { compression: 'DEFLATE' });

  // ─── Generer og returner ZIP ────────────────────────────────────────────────

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const filnavn = `${BRAND_SLUG}_highlight_${tittelSlug}.zip`;

  return new NextResponse(new Uint8Array(zipBuffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filnavn}"`,
      'Content-Length': String(zipBuffer.length),
      'Cache-Control': 'no-store',
    },
  });
}
