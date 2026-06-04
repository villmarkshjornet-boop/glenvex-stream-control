import { NextRequest, NextResponse } from 'next/server';
import { getChatKanalId } from '@/lib/discordChannel';
import { postOgOppdater } from '@/lib/discordMessages';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    navn: string;
    beskrivelse: string;
    pris: string;
    lenke: string;
    bildeUrl?: string;
  };

  const kanalId = await getChatKanalId();
  if (!kanalId) return NextResponse.json({ error: 'Ingen kanal funnet' }, { status: 400 });

  const embed: any = {
    title: `🛍️ ${body.navn}`,
    description: `${body.beskrivelse}\n\n**Pris:** ${body.pris}\n\n[Kjøp her](${body.lenke})`,
    color: 0x00ff41,
    footer: { text: 'GLENVEX • Merch' },
    timestamp: new Date().toISOString(),
  };
  if (body.bildeUrl) embed.image = { url: body.bildeUrl };

  const result = await postOgOppdater(`merch_${body.navn.replace(/\s/g, '_').toLowerCase()}`, kanalId, {
    content: '🔥 Nytt fra GLENVEX!',
    embeds: [embed],
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true });
}
