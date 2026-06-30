import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

async function discordFetch(path: string, options?: RequestInit) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN mangler');
  return fetch(`https://discord.com/api/v10${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
}

async function getAdminChannelId(wsId: string): Promise<string | null> {
  const db = getDb();
  if (!db) return process.env.DISCORD_ADMIN_CHANNEL_ID ?? null;
  const { data } = await db.from('workspaces').select('settings_json').eq('id', wsId).single();
  return data?.settings_json?.discord_channel_preferences?.admin
    || process.env.DISCORD_ADMIN_CHANNEL_ID
    || null;
}

async function tømKanal(channelId: string): Promise<number> {
  let slettet = 0;
  let fortsett = true;
  const fjorten = 13 * 24 * 60 * 60 * 1000;

  while (fortsett) {
    const res = await discordFetch(`/channels/${channelId}/messages?limit=100`);
    if (!res.ok) break;
    const meldinger: { id: string; timestamp: string }[] = await res.json();
    if (meldinger.length === 0) break;

    const nylige = meldinger.filter(m => Date.now() - new Date(m.timestamp).getTime() < fjorten).map(m => m.id);
    const gamle  = meldinger.filter(m => Date.now() - new Date(m.timestamp).getTime() >= fjorten).map(m => m.id);

    // bulkDelete krever minst 2 meldinger
    if (nylige.length >= 2) {
      await discordFetch(`/channels/${channelId}/messages/bulk-delete`, {
        method: 'POST',
        body: JSON.stringify({ messages: nylige }),
      });
    } else {
      // Slett enkeltvis hvis for få
      for (const id of nylige) {
        await discordFetch(`/channels/${channelId}/messages/${id}`, { method: 'DELETE' });
        await new Promise(r => setTimeout(r, 300)); // rate limit buffer
      }
    }

    for (const id of gamle) {
      await discordFetch(`/channels/${channelId}/messages/${id}`, { method: 'DELETE' });
      await new Promise(r => setTimeout(r, 300));
    }

    slettet += meldinger.length;
    if (meldinger.length < 100) fortsett = false;
  }

  return slettet;
}

export async function POST() {
  try {
    const wsId      = getWorkspaceId();
    const channelId = await getAdminChannelId(wsId);
    if (!channelId) {
      return NextResponse.json({ ok: false, error: 'Admin-kanal ikke konfigurert i Innstillinger → Bots → Discord kanaler' }, { status: 400 });
    }

    const slettet = await tømKanal(channelId);
    return NextResponse.json({ ok: true, slettet });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
