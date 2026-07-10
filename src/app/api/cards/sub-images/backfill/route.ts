import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

// POST /api/cards/sub-images/backfill
// Stores a dynamic card_image_url for sub cards.
// The URL points directly to /api/cards/sub-card-image (public edge endpoint)
// instead of uploading to Supabase Storage — avoids bucket permission issues.
// ?force=true also updates cards that already have a URL.
export async function POST(req: NextRequest) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB ikke tilgjengelig' }, { status: 500 });

  const workspaceId = getWorkspaceId();
  const force       = new URL(req.url).searchParams.get('force') === 'true';

  // Resolve base URL: prefer GLENVEX_OAUTH_BASE, then VERCEL_URL (auto-set by Vercel), then NEXT_PUBLIC_BASE_URL
  const rawBase = (
    process.env.GLENVEX_OAUTH_BASE ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    ''
  ).replace(/\/$/, '');

  if (!rawBase) return NextResponse.json({ error: 'Base URL ikke konfigurert' }, { status: 500 });

  let query = db
    .from('community_cards')
    .select('id, user_id, metadata')
    .eq('workspace_id', workspaceId)
    .eq('card_type', 'sub');

  if (!force) {
    query = query.is('card_image_url', null) as typeof query;
  }

  const { data: cards, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!cards?.length) return NextResponse.json({ ok: true, updated: 0, message: 'Ingen sub-kort uten bilde funnet' });

  let updated = 0;
  const errors: string[] = [];

  for (const card of cards) {
    try {
      const meta           = (card.metadata as Record<string, string> | null) ?? {};
      const displayName    = meta.displayName    ?? meta.twitchUsername ?? card.user_id;
      const twitchUsername = meta.twitchUsername ?? '';
      const subTier        = meta.subTier        ?? '1000';

      const imgUrl = new URL(`${rawBase}/api/cards/sub-card-image`);
      imgUrl.searchParams.set('displayName',    displayName);
      imgUrl.searchParams.set('twitchUsername', twitchUsername);
      imgUrl.searchParams.set('tier',           subTier);
      const imageUrl = imgUrl.toString();

      // Quick sanity-check: verify the endpoint responds
      const check = await fetch(imageUrl, { method: 'HEAD', signal: AbortSignal.timeout(8_000) }).catch(() => null);
      if (!check?.ok) {
        errors.push(`HEAD ${check?.status ?? 'timeout'}: ${imageUrl}`);
        continue;
      }

      const { error: dbErr } = await db
        .from('community_cards')
        .update({ card_image_url: imageUrl })
        .eq('id', card.id);

      if (dbErr) { errors.push(`db: ${dbErr.message}`); continue; }
      updated++;
    } catch (e: unknown) {
      errors.push(`exception: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({ ok: true, updated, failed: errors.length, total: cards.length, errors });
}
