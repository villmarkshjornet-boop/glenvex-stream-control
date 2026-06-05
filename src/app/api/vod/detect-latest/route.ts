/**
 * /api/vod/detect-latest POST
 * Henter siste arkiverte VOD fra Twitch og starter Content Factory pipeline
 * hvis den ikke allerede er behandlet. Brukes som manuell fallback når
 * Railway-boten ikke detekterte stream-slutt automatisk.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { isContentFactoryEnabled } from '@/lib/content-factory';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

async function getTwitchToken(): Promise<string | null> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
      { method: 'POST', signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json() as any;
    return data.access_token ?? null;
  } catch { return null; }
}

export async function POST() {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'Content Factory er deaktivert' }, { status: 403 });
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const username = process.env.TWITCH_USERNAME;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;

  if (!clientId || !username) {
    return NextResponse.json({ error: 'TWITCH_CLIENT_ID eller TWITCH_USERNAME mangler' }, { status: 500 });
  }

  const token = await getTwitchToken();
  if (!token) {
    return NextResponse.json({ error: 'Kunne ikke hente Twitch-token – sjekk TWITCH_CLIENT_SECRET' }, { status: 500 });
  }

  // Hent bruker-ID
  const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`, {
    headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  const userData = await userRes.json() as any;
  const userId = userData.data?.[0]?.id;
  if (!userId) {
    return NextResponse.json({ error: `Fant ikke Twitch-bruker: ${username}` }, { status: 404 });
  }

  // Hent siste 3 arkiverte VODs (type=archive)
  const vodRes = await fetch(`https://api.twitch.tv/helix/videos?user_id=${userId}&type=archive&first=3`, {
    headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  const vodData = await vodRes.json() as any;
  const vods: any[] = vodData.data ?? [];

  if (vods.length === 0) {
    return NextResponse.json({ error: 'Ingen arkiverte VODs funnet på Twitch', hint: 'VODs kan ta noen minutter å dukke opp etter stream-slutt' }, { status: 404 });
  }

  // Finn første VOD som ikke allerede er behandlet
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  for (const vod of vods) {
    const { count } = await db.from('content_vods')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', getWorkspaceId())
      .eq('twitch_vod_id', vod.id);

    if ((count ?? 0) > 0) continue; // allerede behandlet

    // Parse varighet
    let durationSek = 0;
    const m = (vod.duration ?? '').match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
    if (m) durationSek = (parseInt(m[1] ?? '0') * 3600) + (parseInt(m[2] ?? '0') * 60) + parseInt(m[3] ?? '0');

    const vodUrl = `https://www.twitch.tv/videos/${vod.id}`;

    // Start Content Factory pipeline
    if (!appUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL mangler – kan ikke starte pipeline' }, { status: 500 });
    }
    const base = appUrl.startsWith('http') ? appUrl : `https://${appUrl}`;
    const pipelineRes = await fetch(`${base}/api/content-factory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamId: vod.id, twitchVodUrl: vodUrl }),
    });
    const pipelineData = await pipelineRes.json().catch(() => ({}));

    if (!pipelineRes.ok) {
      return NextResponse.json({
        error: 'Pipeline-start feilet',
        detalj: pipelineData.error ?? pipelineData.railwayFeil ?? 'Ukjent feil',
        vod: { id: vod.id, title: vod.title, duration: vod.duration, url: vodUrl },
      }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      melding: `Pipeline startet for: "${vod.title}"`,
      vod: { id: vod.id, title: vod.title, duration: vod.duration, durationSek, url: vodUrl, publishedAt: vod.published_at },
      vodId: pipelineData.vodId,
    });
  }

  // Alle VODs er allerede behandlet
  return NextResponse.json({
    ok: false,
    alleredeBehandlet: true,
    melding: `De ${vods.length} siste VODsene er allerede i Content Factory`,
    vods: vods.map(v => ({ id: v.id, title: v.title, published_at: v.published_at })),
  });
}

export async function GET() {
  // Hent liste over siste VODs uten å starte pipeline – for preview
  const clientId = process.env.TWITCH_CLIENT_ID;
  const username = process.env.TWITCH_USERNAME;

  if (!clientId || !username) {
    return NextResponse.json({ vods: [], error: 'Twitch-credentials mangler' });
  }

  const token = await getTwitchToken();
  if (!token) return NextResponse.json({ vods: [], error: 'Token-feil' });

  try {
    const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`, {
      headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    const userData = await userRes.json() as any;
    const userId = userData.data?.[0]?.id;
    if (!userId) return NextResponse.json({ vods: [] });

    const vodRes = await fetch(`https://api.twitch.tv/helix/videos?user_id=${userId}&type=archive&first=5`, {
      headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    const vodData = await vodRes.json() as any;
    return NextResponse.json({
      vods: (vodData.data ?? []).map((v: any) => ({
        id: v.id, title: v.title, duration: v.duration, published_at: v.published_at, url: `https://www.twitch.tv/videos/${v.id}`,
      })),
    });
  } catch {
    return NextResponse.json({ vods: [], error: 'Twitch API feil' });
  }
}
