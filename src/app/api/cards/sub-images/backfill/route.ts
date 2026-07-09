import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

// POST /api/cards/sub-images/backfill
// Generates and stores card_image_url for all sub cards that lack one.
// Called from admin UI or after first deploy of sub card image support.
export async function POST() {
  const h           = headers();
  const userId      = h.get('x-user-id');
  const workspaceId = getWorkspaceId();

  if (!userId) return NextResponse.json({ error: 'Ikke innlogget' }, { status: 401 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB ikke tilgjengelig' }, { status: 500 });

  // Find all sub cards with no card_image_url
  const { data: cards, error } = await db
    .from('community_cards')
    .select('id, user_id, metadata, rarity')
    .eq('workspace_id', workspaceId)
    .eq('card_type', 'sub')
    .is('card_image_url', null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!cards?.length) return NextResponse.json({ ok: true, updated: 0, message: 'Ingen sub-kort mangler bilde' });

  const baseUrl = (process.env.GLENVEX_OAUTH_BASE ?? process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  if (!baseUrl) return NextResponse.json({ error: 'APP_URL ikke konfigurert (GLENVEX_OAUTH_BASE)' }, { status: 500 });

  const bucket = 'persona-cards';
  let updated  = 0;
  let failed   = 0;

  for (const card of cards) {
    try {
      const meta          = (card.metadata as Record<string, string> | null) ?? {};
      const displayName   = meta.displayName   ?? meta.twitchUsername ?? card.user_id;
      const twitchUsername = meta.twitchUsername ?? '';
      const subTier       = meta.subTier        ?? '1000';

      const imgEndpoint = new URL(`${baseUrl}/api/cards/sub-card-image`);
      imgEndpoint.searchParams.set('displayName',    displayName);
      imgEndpoint.searchParams.set('twitchUsername', twitchUsername);
      imgEndpoint.searchParams.set('tier',           subTier);

      const res = await fetch(imgEndpoint.toString(), { signal: AbortSignal.timeout(12_000) });
      if (!res.ok) { failed++; continue; }

      const buf      = Buffer.from(await res.arrayBuffer());
      const filePath = `${workspaceId}/${card.user_id}/sub-card.png`;

      const doUpload = async () => db.storage.from(bucket).upload(filePath, buf, { contentType: 'image/png', upsert: true });
      let { error: upErr } = await doUpload();
      if (upErr) {
        const msg = (upErr.message ?? '').toLowerCase();
        if (msg.includes('not found') || msg.includes('does not exist')) {
          try { await db.storage.createBucket(bucket, { public: true }); } catch {}
          ({ error: upErr } = await doUpload());
        }
        if (upErr) { failed++; continue; }
      }

      const { data: urlData } = db.storage.from(bucket).getPublicUrl(filePath);
      const publicUrl = urlData?.publicUrl ?? null;
      if (!publicUrl) { failed++; continue; }

      await db.from('community_cards').update({ card_image_url: publicUrl }).eq('id', card.id);
      updated++;
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ ok: true, updated, failed, total: cards.length });
}
