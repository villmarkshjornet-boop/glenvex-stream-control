import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { isContentFactoryEnabled } from '@/lib/content-factory';

export const dynamic = 'force-dynamic';
export const maxDuration = 25;

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

async function getTwitchUserId(clientId: string, token: string, username: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`, {
      headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json() as any;
    return data.data?.[0]?.id ?? null;
  } catch { return null; }
}

function parseDurationSek(duration: string): number {
  const m = (duration ?? '').match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  if (!m) return 0;
  return (parseInt(m[1] ?? '0') * 3600) + (parseInt(m[2] ?? '0') * 60) + parseInt(m[3] ?? '0');
}

export async function POST() {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'Content Factory er deaktivert' }, { status: 403 });
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const username = process.env.TWITCH_USERNAME;
  const botApiUrl = process.env.BOT_API_URL;

  if (!clientId || !username) {
    return NextResponse.json({ error: 'TWITCH_CLIENT_ID eller TWITCH_USERNAME mangler' }, { status: 500 });
  }
  if (!botApiUrl) {
    return NextResponse.json({ error: 'BOT_API_URL mangler – Railway kan ikke nås' }, { status: 500 });
  }

  const token = await getTwitchToken();
  if (!token) {
    return NextResponse.json({ error: 'Kunne ikke hente Twitch-token – sjekk TWITCH_CLIENT_SECRET' }, { status: 500 });
  }

  const userId = await getTwitchUserId(clientId, token, username);
  if (!userId) {
    return NextResponse.json({ error: `Fant ikke Twitch-bruker: ${username}` }, { status: 404 });
  }

  const vodRes = await fetch(`https://api.twitch.tv/helix/videos?user_id=${userId}&type=archive&first=3`, {
    headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  const vodData = await vodRes.json() as any;
  const vods: any[] = vodData.data ?? [];

  if (vods.length === 0) {
    return NextResponse.json({
      error: 'Ingen arkiverte VODs funnet på Twitch',
      hint: 'VODs kan ta noen minutter å dukke opp etter stream-slutt',
    }, { status: 404 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  for (const vod of vods) {
    const { count } = await db.from('content_vods')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', getWorkspaceId())
      .eq('twitch_vod_id', vod.id);

    if ((count ?? 0) > 0) continue;

    const durationSek = parseDurationSek(vod.duration ?? '');
    const vodUrl = `https://www.twitch.tv/videos/${vod.id}`;

    // Opprett VOD-rad direkte i DB (ingen self-referencing HTTP kall)
    const { data: nyVod, error: dbErr } = await db.from('content_vods').insert({
      workspace_id: getWorkspaceId(),
      stream_id: vod.id,
      twitch_vod_id: vod.id,
      title: vod.title,
      category: vod.game_name ?? 'Ukjent',
      duration_seconds: durationSek,
      started_at: vod.published_at,
      vod_url: vodUrl,
      thumbnail_url: (vod.thumbnail_url ?? '').replace('%{width}', '640').replace('%{height}', '360'),
      status: 'PENDING',
      current_step: 'DOWNLOAD',
      progress_percent: 5,
      status_message: 'VOD opprettet via manuell deteksjon – starter Railway...',
    }).select().single();

    if (dbErr) {
      return NextResponse.json({ error: `DB-feil: ${dbErr.message}` }, { status: 500 });
    }

    const vodId = nyVod.id;

    // Sett ANALYZING i DB umiddelbart
    await db.from('content_vods').update({
      status: 'ANALYZING',
      current_step: 'DOWNLOAD',
      progress_percent: 10,
      status_message: 'Sendt til Railway – starter nedlasting...',
    }).eq('id', vodId);

    // Fire-and-forget til Railway – ikke vent på svar (Railway kan bruke lang tid på cold start)
    fetch(`${botApiUrl}/content-factory/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vodId,
        twitchVodUrl: vodUrl,
        userOauth: process.env.TWITCH_USER_OAUTH,
      }),
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      melding: `Pipeline startet for: "${vod.title}"`,
      vod: { id: vod.id, title: vod.title, duration: vod.duration, durationSek, url: vodUrl, publishedAt: vod.published_at },
      vodId,
    });
  }

  return NextResponse.json({
    ok: false,
    alleredeBehandlet: true,
    melding: `De ${vods.length} siste VODsene er allerede i Content Factory`,
    vods: vods.map(v => ({ id: v.id, title: v.title, published_at: v.published_at })),
  });
}

export async function GET() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const username = process.env.TWITCH_USERNAME;

  if (!clientId || !username) {
    return NextResponse.json({ vods: [], error: 'Twitch-credentials mangler' });
  }

  const token = await getTwitchToken();
  if (!token) return NextResponse.json({ vods: [], error: 'Token-feil' });

  try {
    const userId = await getTwitchUserId(clientId, token, username);
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
