import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/workspace';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { channelId, message } = await req.json();
  if (!channelId || !message?.trim()) {
    return NextResponse.json({ error: 'Mangler kanal eller melding' }, { status: 400 });
  }

  // Get bot token from workspace credentials or env
  const db = getDb();
  let token = process.env.DISCORD_BOT_TOKEN ?? '';

  if (db) {
    const { data: ws } = await db
      .from('workspaces')
      .select('settings_json')
      .eq('id', getWorkspaceId())
      .single();
    token = ws?.settings_json?.credentials?.discordBotToken ?? token;
  }

  if (!token) {
    return NextResponse.json({ error: 'Ingen Discord bot-token konfigurert' }, { status: 500 });
  }

  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: message }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json({ error: err.message ?? `Discord feil: ${res.status}` }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
