import { NextRequest, NextResponse } from 'next/server';
import { getAllContent, updateContent, publishContent } from '@/lib/contentLibrary';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';

function botHeaders() {
  return { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' };
}

export async function POST(req: NextRequest) {
  const { id, kanalId } = await req.json() as { id: string; kanalId?: string };

  const items = getAllContent();
  const item = items.find(i => i.id === id);
  if (!item) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });

  const targetKanal = kanalId ?? item.kanalId ?? process.env.DISCORD_CHAT_CHANNEL_ID;
  if (!targetKanal) return NextResponse.json({ error: 'Ingen kanal valgt' }, { status: 400 });

  const payload: any = { content: item.tekst };
  if (item.embedData) payload.embeds = [item.embedData];
  if (item.bildeUrl && !item.embedData) {
    payload.embeds = [{ image: { url: item.bildeUrl }, color: 0x00ff41 }];
  }

  const res = await fetch(`${DISCORD_API}/channels/${targetKanal}/messages`, {
    method: 'POST',
    headers: botHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    updateContent(id, { status: 'feilet', feilmelding: `Discord feil ${res.status}: ${err.slice(0, 100)}` });
    return NextResponse.json({ error: 'Discord feil', detaljer: err }, { status: 500 });
  }

  const msg = await res.json() as any;
  const published = publishContent(id, msg.id);
  updateContent(id, { kanalId: targetKanal });

  return NextResponse.json({ ok: true, msgId: msg.id, item: published });
}

export async function DELETE(req: NextRequest) {
  const { id, slettDiscord } = await req.json() as { id: string; slettDiscord: boolean };

  const items = getAllContent();
  const item = items.find(i => i.id === id);
  if (!item) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });

  if (slettDiscord && item.discordMsgId && item.kanalId) {
    await fetch(`${DISCORD_API}/channels/${item.kanalId}/messages/${item.discordMsgId}`, {
      method: 'DELETE',
      headers: botHeaders(),
    }).catch(() => {});
  }

  updateContent(id, { status: 'slettet' });
  return NextResponse.json({ ok: true });
}
