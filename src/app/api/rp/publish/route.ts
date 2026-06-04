import { NextRequest, NextResponse } from 'next/server';
import { getChatKanalId } from '@/lib/discordChannel';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';

function botHeaders(json = true) {
  const h: Record<string, string> = { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

// Last opp bilde til Discord og returner en vedlegg-URL
async function lastOppBildeTilDiscord(kanalId: string, base64: string): Promise<string | null> {
  try {
    const [header, data] = base64.split(',');
    const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
    const ext = mime.split('/')[1] ?? 'jpg';
    const buffer = Buffer.from(data, 'base64');

    const form = new FormData();
    const blob = new Blob([buffer], { type: mime });
    form.append('files[0]', blob, `karakter.${ext}`);
    form.append('payload_json', JSON.stringify({ content: '' }));

    const res = await fetch(`${DISCORD_API}/channels/${kanalId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      body: form,
    });

    if (!res.ok) return null;
    const msg = await res.json() as any;
    const attachment = msg.attachments?.[0];
    if (attachment?.url) {
      // Slett hjelpemedlingen etterpå
      await fetch(`${DISCORD_API}/channels/${kanalId}/messages/${msg.id}`, {
        method: 'DELETE',
        headers: botHeaders(false),
      }).catch(() => {});
      return attachment.url;
    }
  } catch {}
  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    karakterIntro: string;
    serverOppdatering: string;
    bildeUrl?: string;
    kanalForslag: { id: string; navn: string; nyttNavn: string; type: string }[];
    karakterKanalId?: string;
    chatKanalId?: string;
    karakterNavn: string;
    serverNavn: string;
    gammelMsgId?: string;
  };

  const guildId = process.env.DISCORD_GUILD_ID;
  const resultater: string[] = [];

  // 1. Omdøp NXT-kanaler
  for (const k of body.kanalForslag ?? []) {
    const r = await fetch(`${DISCORD_API}/channels/${k.id}`, {
      method: 'PATCH',
      headers: botHeaders(),
      body: JSON.stringify({ name: k.nyttNavn }),
    });
    resultater.push(r.ok ? `✓ Omdøpt #${k.navn} → #${k.nyttNavn}` : `✗ Feil ved omdøping av #${k.navn}`);
  }

  // 2. Finn eller opprett karakterkanal
  let karakterKanalId = body.karakterKanalId;
  if (!karakterKanalId && guildId) {
    const kanalNavn = body.karakterNavn.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-æøå]/g, '');
    const channelsRes = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, { headers: botHeaders(false) });
    if (channelsRes.ok) {
      const kanaler = await channelsRes.json() as any[];
      const eksisterende = kanaler.find((k: any) => k.name === kanalNavn);
      if (eksisterende) {
        karakterKanalId = eksisterende.id;
      } else {
        let kategoriId: string | undefined;
        const kat = kanaler.find((k: any) => k.type === 4 && k.name.toLowerCase().includes('karakter'));
        if (kat) {
          kategoriId = kat.id;
        } else {
          const katRes = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
            method: 'POST', headers: botHeaders(), body: JSON.stringify({ name: 'KARAKTERER', type: 4 }),
          });
          if (katRes.ok) kategoriId = (await katRes.json() as any).id;
        }
        const createRes = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
          method: 'POST', headers: botHeaders(),
          body: JSON.stringify({ name: kanalNavn, type: 0, parent_id: kategoriId, topic: `${body.karakterNavn} – ${body.serverNavn}` }),
        });
        if (createRes.ok) {
          karakterKanalId = (await createRes.json() as any).id;
          resultater.push(`✓ Opprettet #${kanalNavn}`);
        }
      }
    }
  }

  // 3. Slett gammel melding (unngå duplikat)
  if (karakterKanalId && body.gammelMsgId) {
    await fetch(`${DISCORD_API}/channels/${karakterKanalId}/messages/${body.gammelMsgId}`, {
      method: 'DELETE', headers: botHeaders(false),
    }).catch(() => {});
    resultater.push(`↳ Slettet gammel Discord-melding`);
  }

  // 4. Håndter bilde – base64 lastes opp som vedlegg, https-URL brukes direkte
  let bildeUrl = body.bildeUrl;
  if (bildeUrl?.startsWith('data:') && karakterKanalId) {
    const opplastetUrl = await lastOppBildeTilDiscord(karakterKanalId, bildeUrl);
    if (opplastetUrl) {
      bildeUrl = opplastetUrl;
      resultater.push(`↳ Bilde lastet opp til Discord`);
    } else {
      bildeUrl = undefined;
      resultater.push(`⚠ Kunne ikke laste opp bilde – publiserer uten bilde`);
    }
  }

  // 5. Post karakterkort i karakterkanal
  if (karakterKanalId && body.karakterIntro) {
    const embed: any = {
      title: `◆ ${body.karakterNavn.toUpperCase()}`,
      description: body.karakterIntro,
      color: 0x00ff41,
      footer: { text: `${body.serverNavn} • GLENVEX Stream Control` },
      timestamp: new Date().toISOString(),
    };
    if (bildeUrl?.startsWith('http')) embed.image = { url: bildeUrl };

    const r = await fetch(`${DISCORD_API}/channels/${karakterKanalId}/messages`, {
      method: 'POST', headers: botHeaders(), body: JSON.stringify({ embeds: [embed] }),
    });
    if (!r.ok) {
      const errTekst = await r.text();
      resultater.push(`✗ Feil ved publisering: ${r.status} ${errTekst.slice(0, 100)}`);
    } else {
      resultater.push(`✓ Karakterkort publisert`);
    }
  }

  // 6. Post serveroppdatering i chat-kanal
  const chatKanalId = body.chatKanalId || await getChatKanalId();
  if (chatKanalId && body.serverOppdatering) {
    const r = await fetch(`${DISCORD_API}/channels/${chatKanalId}/messages`, {
      method: 'POST', headers: botHeaders(), body: JSON.stringify({ content: body.serverOppdatering }),
    });
    resultater.push(r.ok ? `✓ Serveroppdatering postet i chat` : `✗ Feil ved posting i chat`);
  }

  return NextResponse.json({ resultater });
}
