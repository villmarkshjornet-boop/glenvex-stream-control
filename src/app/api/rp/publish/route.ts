import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';

function botHeaders() {
  return {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json',
  };
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
  for (const k of body.kanalForslag) {
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
    const kanalNavn = body.karakterNavn.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-æøå]/g, '');

    // Sjekk om kanalen finnes
    const channelsRes = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, { headers: botHeaders() });
    if (channelsRes.ok) {
      const kanaler = await channelsRes.json() as any[];
      const eksisterende = kanaler.find((k: any) => k.name === kanalNavn);

      if (eksisterende) {
        karakterKanalId = eksisterende.id;
      } else {
        // Finn eller opprett KARAKTERER-kategori
        let kategoriId: string | undefined;
        const kat = kanaler.find((k: any) => k.type === 4 && k.name.toLowerCase().includes('karakter'));
        if (kat) {
          kategoriId = kat.id;
        } else {
          const katRes = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
            method: 'POST',
            headers: botHeaders(),
            body: JSON.stringify({ name: 'KARAKTERER', type: 4 }),
          });
          if (katRes.ok) kategoriId = (await katRes.json() as any).id;
        }

        const createRes = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
          method: 'POST',
          headers: botHeaders(),
          body: JSON.stringify({
            name: kanalNavn,
            type: 0,
            parent_id: kategoriId,
            topic: `${body.karakterNavn} – ${body.serverNavn}`,
          }),
        });
        if (createRes.ok) {
          karakterKanalId = (await createRes.json() as any).id;
          resultater.push(`✓ Opprettet #${kanalNavn}`);
        }
      }
    }
  }

  // 3. Slett gammel melding hvis den finnes (unngå duplikat)
  if (karakterKanalId && body.gammelMsgId) {
    await fetch(`${DISCORD_API}/channels/${karakterKanalId}/messages/${body.gammelMsgId}`, {
      method: 'DELETE',
      headers: botHeaders(),
    }).catch(() => {});
    resultater.push(`↳ Slettet gammel Discord-melding`);
  }

  // 4. Post karakterintro i karakterkanal
  if (karakterKanalId && body.karakterIntro) {
    const embed: any = {
      title: `◆ ${body.karakterNavn.toUpperCase()}`,
      description: body.karakterIntro,
      color: 0x00ff41,
      footer: { text: `${body.serverNavn} • GLENVEX Stream Control` },
      timestamp: new Date().toISOString(),
    };
    if (body.bildeUrl) embed.image = { url: body.bildeUrl };

    const r = await fetch(`${DISCORD_API}/channels/${karakterKanalId}/messages`, {
      method: 'POST',
      headers: botHeaders(),
      body: JSON.stringify({ embeds: [embed] }),
    });
    resultater.push(r.ok ? `✓ Karakterkort publisert` : `✗ Feil ved publisering av karakterkort`);
  }

  // 4. Post serveroppdatering i chat-kanal
  const chatKanalId = body.chatKanalId || process.env.DISCORD_CHAT_CHANNEL_ID;
  if (chatKanalId && body.serverOppdatering) {
    const r = await fetch(`${DISCORD_API}/channels/${chatKanalId}/messages`, {
      method: 'POST',
      headers: botHeaders(),
      body: JSON.stringify({ content: body.serverOppdatering }),
    });
    resultater.push(r.ok ? `✓ Serveroppdatering postet i chat` : `✗ Feil ved posting i chat`);
  }

  return NextResponse.json({ resultater });
}
