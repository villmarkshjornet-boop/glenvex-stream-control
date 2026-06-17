import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

function isAdmin(h: ReturnType<typeof headers>): boolean {
  const email = h.get('x-user-email') ?? '';
  const adminEmail = process.env.ADMIN_EMAIL ?? '';
  return adminEmail.length > 0 && email.toLowerCase() === adminEmail.toLowerCase();
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const h = headers();
  if (!isAdmin(h)) return NextResponse.json({ error: 'Ikke tilgang' }, { status: 403 });

  const workspaceId = params.id;
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 500 });

  const { data: ws } = await db
    .from('workspaces')
    .select('id,brand_name,twitch_login')
    .eq('id', workspaceId)
    .single();

  if (!ws?.twitch_login) {
    return NextResponse.json({ error: 'Workspace mangler twitch_login', workspaceId }, { status: 400 });
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET ikke satt i env' }, { status: 500 });
  }

  // Hent app access token
  const tokenRes = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    { method: 'POST', signal: AbortSignal.timeout(6000) }
  );
  if (!tokenRes.ok) {
    return NextResponse.json({ error: `Twitch token-feil: ${tokenRes.status}` }, { status: 502 });
  }
  const { access_token } = await tokenRes.json() as { access_token: string };

  // Sjekk live-status
  const streamRes = await fetch(
    `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(ws.twitch_login)}`,
    { headers: { 'Client-Id': clientId, Authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(6000) }
  );
  if (!streamRes.ok) {
    return NextResponse.json({ error: `Twitch Helix-feil: ${streamRes.status}` }, { status: 502 });
  }
  const { data } = await streamRes.json() as { data: any[] };
  const stream = data?.[0] ?? null;

  const checkedAt = new Date().toISOString();
  const isLive = !!stream;

  try {
    await db.from('system_events').insert({
      workspace_id: workspaceId,
      source: 'admin',
      event_type: isLive ? 'TWITCH_LIVE_DETECTED' : 'TWITCH_LIVE_CHECK_STARTED',
      title: isLive
        ? `Admin live-sjekk: ${ws.brand_name ?? ws.twitch_login} er LIVE — ${stream.title?.slice(0, 60)}`
        : `Admin live-sjekk: ${ws.brand_name ?? ws.twitch_login} er offline`,
      severity: 'info',
      metadata: {
        workspaceId,
        twitchLogin: ws.twitch_login,
        isLive,
        triggeredBy: h.get('x-user-email'),
        checkedAt,
        ...(stream ? {
          streamId: stream.id,
          title: stream.title,
          game: stream.game_name,
          viewerCount: stream.viewer_count,
          startedAt: stream.started_at,
        } : {}),
      },
    });
  } catch {}

  return NextResponse.json({
    ok: true,
    workspaceId,
    twitchLogin: ws.twitch_login,
    isLive,
    checkedAt,
    stream: stream ? {
      id: stream.id,
      title: stream.title,
      game: stream.game_name,
      viewerCount: stream.viewer_count,
      startedAt: stream.started_at,
    } : null,
  });
}
