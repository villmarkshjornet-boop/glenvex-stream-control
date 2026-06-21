import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getPartners, trackPartnerExposure, type Partner } from '@/lib/partners';
import { getPartnerKanalId } from '@/lib/discordChannel';
import { postOgOppdater } from '@/lib/discordMessages';

export const dynamic = 'force-dynamic';

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

async function buildTwitchMsg(partner: Partner, brandName: string): Promise<string> {
  const fallback = [
    `🤝 Partner: ${partner.navn}`,
    partner.rabattkode ? `Kode: ${partner.rabattkode}` : '',
    partner.affiliateLink ?? '',
  ].filter(Boolean).join(' — ');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback;
  try {
    const openai = new OpenAI({ apiKey });
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content:
        `Skriv én kort Twitch-chat-melding for ${brandName} om partneren "${partner.navn}". Max 300 tegn, norsk, gaming-tone, ingen markdown. ${partner.rabattkode ? `Kode: ${partner.rabattkode}.` : ''} ${partner.affiliateLink ? `Link: ${partner.affiliateLink}` : ''}`,
      }],
      max_tokens: 80,
      temperature: 0.9,
    });
    return (res.choices[0]?.message?.content ?? fallback).slice(0, 490);
  } catch {
    return fallback;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    manuellPartnerId?: string;
    channel?: 'discord' | 'twitch' | 'both';
  };
  const channel = body.channel ?? 'discord';

  const { getDb } = await import('@/lib/db');
  const { getWorkspaceId } = await import('@/lib/workspace');
  const wsId = getWorkspaceId();
  const db = getDb();
  let brandName = 'streameren';
  if (db) {
    const { data: ws } = await db.from('workspaces').select('brand_name').eq('id', wsId).single();
    brandName = ws?.brand_name ?? 'streameren';
  }

  const partners = await getPartners();
  const partner = body.manuellPartnerId
    ? partners.find(p => p.id === body.manuellPartnerId)
    : velgPartner(partners);

  if (!partner) return NextResponse.json({ error: 'Ingen aktive partnere' }, { status: 404 });

  const results: { discord?: boolean; twitch?: boolean; errors: string[] } = { errors: [] };

  // ── Discord ────────────────────────────────────────────────────────────────
  if (channel === 'discord' || channel === 'both') {
    const kanalId = await getPartnerKanalId();
    if (!kanalId) {
      results.errors.push('missing_channel:discord');
    } else {
      const apiKey = process.env.OPENAI_API_KEY;
      let tekst = `🤝 **Dagens partner: ${partner.navn}**\n\n${partner.beskrivelse}\n\n${partner.rabattkode ? `Bruk kode **${partner.rabattkode}** for rabatt!\n` : ''}${partner.affiliateLink ?? ''}`;
      if (apiKey) {
        try {
          const openai = new OpenAI({ apiKey });
          const res = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content:
              `Lag en kort, engasjerende Discord-partnerpost for "${partner.navn}" på vegne av ${brandName}. Norsk, gaming-vibe, maks 3 setninger. ${partner.rabattkode ? `Inkluder kode: ${partner.rabattkode}.` : ''} ${partner.affiliateLink ? `Inkluder link: ${partner.affiliateLink}` : ''}`,
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
        footer: { text: `${brandName} Partner Hub${partner.ownedBrand ? ' • Eget merke' : ''}` },
        timestamp: new Date().toISOString(),
      };
      if (partner.rabattkode) {
        embed.fields = [{ name: 'Rabattkode', value: `\`${partner.rabattkode}\``, inline: true }];
      }

      const result = await postOgOppdater(`partner_${partner.id}`, kanalId, { embeds: [embed] });
      results.discord = result.ok;
      if (result.ok) {
        await trackPartnerExposure({ partnerId: partner.id, partnerName: partner.navn,
          platform: 'discord', channelId: kanalId, source: 'manual_promote_button' });
      } else {
        results.errors.push(`discord_failed:${result.error ?? 'ukjent'}`);
      }
    }
  }

  // ── Twitch ─────────────────────────────────────────────────────────────────
  if (channel === 'twitch' || channel === 'both') {
    const botApiUrl = process.env.BOT_API_URL;
    if (!botApiUrl) {
      results.errors.push('missing_twitch_token:BOT_API_URL mangler');
    } else {
      const twitchMsg = await buildTwitchMsg(partner, brandName);
      try {
        const twitchRes = await fetch(`${botApiUrl}/twitch-chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: twitchMsg, source: 'manual_promote_button' }),
          signal: AbortSignal.timeout(8_000),
        });
        if (twitchRes.ok) {
          results.twitch = true;
          await trackPartnerExposure({ partnerId: partner.id, partnerName: partner.navn,
            platform: 'twitch', source: 'manual_promote_button' });
        } else {
          const errBody = await twitchRes.json().catch(() => ({})) as { error?: string };
          results.errors.push(`twitch_failed:${errBody.error ?? twitchRes.status}`);
          results.twitch = false;
        }
      } catch (err: any) {
        results.errors.push(`bot_offline:${err?.message?.slice(0, 80) ?? 'ukjent'}`);
        results.twitch = false;
      }
    }
  }

  // Lagre til memory
  try {
    const { addToMemory } = await import('@/lib/botMemory');
    addToMemory({ type: 'partner-post', innhold: partner.navn, partner: partner.navn });
  } catch {}

  const anyOk = results.discord === true || results.twitch === true;
  const status = anyOk ? 200 : results.errors.some(e => e.startsWith('missing_')) ? 400 : 500;

  return NextResponse.json({
    ok: anyOk,
    partner: partner.navn,
    channel,
    discord: results.discord ?? null,
    twitch:  results.twitch ?? null,
    errors:  results.errors.length > 0 ? results.errors : undefined,
  }, { status });
}
