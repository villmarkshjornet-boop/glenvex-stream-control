import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

// POST /api/cards/sub-images/backfill
// Generates and stores card_image_url for sub cards.
// ?force=true also re-generates cards that already have a URL (fixes broken images).
export async function POST(req: NextRequest) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB ikke tilgjengelig' }, { status: 500 });

  const workspaceId = getWorkspaceId();
  const force       = new URL(req.url).searchParams.get('force') === 'true';

  let query = db
    .from('community_cards')
    .select('id, user_id, metadata, rarity, card_image_url')
    .eq('workspace_id', workspaceId)
    .eq('card_type', 'sub');

  if (!force) {
    query = query.is('card_image_url', null) as typeof query;
  }

  const { data: cards, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!cards?.length) return NextResponse.json({ ok: true, updated: 0, message: 'Ingen sub-kort uten bilde funnet' });

  const baseUrl = (process.env.GLENVEX_OAUTH_BASE ?? process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  if (!baseUrl) return NextResponse.json({ error: 'Base URL ikke konfigurert (GLENVEX_OAUTH_BASE)' }, { status: 500 });

  const bucket = 'persona-cards';
  let updated  = 0;
  const errors: string[] = [];

  for (const card of cards) {
    try {
      const meta           = (card.metadata as Record<string, string> | null) ?? {};
      const displayName    = meta.displayName    ?? meta.twitchUsername ?? card.user_id;
      const twitchUsername = meta.twitchUsername ?? '';
      const subTier        = meta.subTier        ?? '1000';

      const imgEndpoint = new URL(`${baseUrl}/api/cards/sub-card-image`);
      imgEndpoint.searchParams.set('displayName',    displayName);
      imgEndpoint.searchParams.set('twitchUsername', twitchUsername);
      imgEndpoint.searchParams.set('tier',           subTier);

      const imgRes = await fetch(imgEndpoint.toString(), { signal: AbortSignal.timeout(15_000) });
      if (!imgRes.ok) {
        const body = await imgRes.text().catch(() => '');
        errors.push(`img-fetch HTTP ${imgRes.status}: ${body.slice(0, 200)}`);
        continue;
      }

      const buf      = Buffer.from(await imgRes.arrayBuffer());
      const filePath = `${workspaceId}/${card.user_id}/sub-card.png`;

      const doUpload = async () => db.storage.from(bucket).upload(filePath, buf, { contentType: 'image/png', upsert: true });
      let { error: upErr } = await doUpload();
      if (upErr) {
        const msg = (upErr.message ?? '').toLowerCase();
        if (msg.includes('not found') || msg.includes('does not exist') || msg.includes('bucket')) {
          try { await db.storage.createBucket(bucket, { public: true }); } catch {}
          ({ error: upErr } = await doUpload());
        }
        if (upErr) {
          errors.push(`upload: ${upErr.message}`);
          continue;
        }
      }

      const { data: urlData } = db.storage.from(bucket).getPublicUrl(filePath);
      const publicUrl = urlData?.publicUrl ?? null;
      if (!publicUrl) { errors.push('getPublicUrl returnerte null'); continue; }

      await db.from('community_cards').update({ card_image_url: publicUrl }).eq('id', card.id);
      updated++;
    } catch (e: unknown) {
      errors.push(`exception: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    updated,
    failed: errors.length,
    total: cards.length,
    errors,
  });
}
