import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';

export async function POST(req: NextRequest) {
  let highlightId: string;
  try {
    const body = await req.json();
    highlightId = body.highlightId;
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }

  if (!highlightId) return NextResponse.json({ error: 'highlightId kreves' }, { status: 400 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return NextResponse.json({ error: 'DISCORD_BOT_TOKEN mangler' }, { status: 500 });

  // Hent highlight og copy parallelt
  const [highlightRes, copyRes, wsRes] = await Promise.all([
    db.from('content_highlights').select('id,vod_id,title,category,clip_url').eq('id', highlightId).single(),
    db.from('content_copy').select('discord_post,tittel').eq('highlight_id', highlightId).limit(1),
    db.from('workspaces').select('settings_json').eq('id', getWorkspaceId()).single(),
  ]);

  const highlight = highlightRes.data;
  if (!highlight) return NextResponse.json({ error: 'Highlight ikke funnet' }, { status: 404 });
  if (!highlight.clip_url) return NextResponse.json({ error: 'Ingen klipp-URL på dette highlightet' }, { status: 400 });

  const clipsChannelId: string | undefined = (wsRes.data?.settings_json as any)?.kanalPreferanser?.clips;
  if (!clipsChannelId) return NextResponse.json({ error: 'Clips-kanal ikke konfigurert i kanal-innstillinger' }, { status: 400 });

  const copyRow = copyRes.data?.[0];
  const tekst = copyRow?.discord_post?.trim() || copyRow?.tittel?.trim() || highlight.title || 'Nytt highlight!';
  const innhold = `${tekst}\n\n${highlight.clip_url}`;

  const res = await fetch(`${DISCORD_API}/channels/${clipsChannelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: innhold }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return NextResponse.json({ error: `Discord feil ${res.status}: ${txt.slice(0, 200)}` }, { status: 502 });
  }

  const discordMsg = await res.json() as any;
  return NextResponse.json({ ok: true, msgId: discordMsg.id });
}
