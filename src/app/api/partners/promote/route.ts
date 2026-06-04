import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getPartners, savePartners, type Partner } from '@/lib/partners';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';

function velgPartner(partners: Partner[]): Partner | null {
  const aktive = partners.filter(p => p.aktiv);
  if (aktive.length === 0) return null;

  // Score basert på prioritet, tid siden sist og eksponering
  const scored = aktive.map(p => {
    const sidenSist = p.sistePromotert
      ? (Date.now() - new Date(p.sistePromotert).getTime()) / 3_600_000
      : 999;
    const score = p.prioritet * 10 + Math.min(sidenSist, 100) - p.eksponering * 0.1;
    return { partner: p, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].partner;
}

export async function POST(req: NextRequest) {
  const { manuellPartnerId } = await req.json().catch(() => ({})) as { manuellPartnerId?: string };

  const partners = getPartners();
  const partner = manuellPartnerId
    ? partners.find(p => p.id === manuellPartnerId)
    : velgPartner(partners);

  if (!partner) return NextResponse.json({ error: 'Ingen aktive partnere' }, { status: 404 });

  const kanalId = process.env.DISCORD_CHAT_CHANNEL_ID;
  if (!kanalId) return NextResponse.json({ error: 'DISCORD_CHAT_CHANNEL_ID mangler' }, { status: 400 });

  const apiKey = process.env.OPENAI_API_KEY;
  let tekst = `🤝 **Dagens partner: ${partner.navn}**\n\n${partner.beskrivelse}\n\n${partner.rabattkode ? `Bruk kode **${partner.rabattkode}** for rabatt!\n` : ''}${partner.affiliateLink}`;

  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Lag en kort, engasjerende Discord-partnerpost for "${partner.navn}" på vegne av GLENVEX. Norsk, gaming-vibe, maks 3 setninger. ${partner.rabattkode ? `Inkluder kode: ${partner.rabattkode}.` : ''} ${partner.affiliateLink ? `Inkluder link: ${partner.affiliateLink}` : ''}`,
        }],
        max_tokens: 150,
        temperature: 0.9,
      });
      tekst = res.choices[0]?.message?.content ?? tekst;
    } catch {}
  }

  const embed: any = {
    title: `🤝 Partner: ${partner.navn}`,
    description: tekst,
    color: 0x00ff41,
    footer: { text: `GLENVEX Partner Hub${partner.ownedBrand ? ' • Eget merke' : ''}` },
    timestamp: new Date().toISOString(),
  };
  if (partner.rabattkode) {
    embed.fields = [{ name: 'Rabattkode', value: `\`${partner.rabattkode}\``, inline: true }];
  }

  const discordRes = await fetch(`${DISCORD_API}/channels/${kanalId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (discordRes.ok) {
    const idx = partners.findIndex(p => p.id === partner.id);
    if (idx >= 0) {
      partners[idx].sistePromotert = new Date().toISOString();
      partners[idx].eksponering = (partners[idx].eksponering ?? 0) + 1;
      savePartners(partners);
    }
  }

  return NextResponse.json({ ok: discordRes.ok, partner: partner.navn });
}
