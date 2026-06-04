import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getPartners, updatePartner, type Partner } from '@/lib/partners';
import { getPartnerKanalId } from '@/lib/discordChannel';
import { postOgOppdater } from '@/lib/discordMessages';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';

function velgPartner(partners: Partner[]): Partner | null {
  const aktive = partners.filter(p => p.aktiv);
  if (aktive.length === 0) return null;
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

  const partners = await getPartners();
  const partner = manuellPartnerId
    ? partners.find(p => p.id === manuellPartnerId)
    : velgPartner(partners);

  if (!partner) return NextResponse.json({ error: 'Ingen aktive partnere' }, { status: 404 });

  const kanalId = await getPartnerKanalId();
  if (!kanalId) return NextResponse.json({ error: 'Ingen Discord-kanal funnet' }, { status: 400 });

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

  // Lagre til memory
  try {
    const { addToMemory } = await import('@/lib/botMemory');
    addToMemory({ type: 'partner-post', innhold: partner.navn, partner: partner.navn });
  } catch {}

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

  // Slett gammel partner-post + post ny
  const result = await postOgOppdater(`partner_${partner.id}`, kanalId, { embeds: [embed] });

  if (result.ok) {
    await updatePartner(partner.id, {
      sistePromotert: new Date().toISOString(),
      eksponering: (partner.eksponering ?? 0) + 1,
    });
  }

  return NextResponse.json({ ok: result.ok, partner: partner.navn, error: result.error });
}
