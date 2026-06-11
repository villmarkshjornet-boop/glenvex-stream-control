import { NextRequest, NextResponse } from 'next/server';
import { getChatKanalId } from '@/lib/discordChannel';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { getAllContent, updateContent } from '@/lib/contentLibrary';
import { slettGammelMelding, lagreMsgId, hentSisteMsgId } from '@/lib/discordMessages';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';

function botHeaders(json = true) {
  const h: Record<string, string> = { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function finnOgSlettGammelKarakter(karakterNavn: string, kanalId: string): Promise<void> {
  const nøkkel = `rp_${karakterNavn.toLowerCase().replace(/\s+/g, '_')}`;

  // Prøv discordMessages-systemet først (mest pålitelig)
  const slettet = await slettGammelMelding(nøkkel);
  if (slettet) return;

  // Fallback: søk i content library
  try {
    const alle = getAllContent();
    const gammel = alle.find(c =>
      c.type === 'rp-karakter' &&
      c.status === 'publisert' &&
      c.discordMsgId &&
      c.tittel.toLowerCase().includes(karakterNavn.toLowerCase())
    );
    if (gammel?.discordMsgId && gammel.kanalId) {
      await fetch(`${DISCORD_API}/channels/${gammel.kanalId}/messages/${gammel.discordMsgId}`, {
        method: 'DELETE',
        headers: botHeaders(false),
      }).catch(() => {});
      updateContent(gammel.id, { status: 'arkivert' });
    }
  } catch {}
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

  const wsId = getWorkspaceId();
  const db = getDb();
  let brandName = 'streameren';
  if (db) {
    const { data: ws } = await db.from('workspaces').select('brand_name').eq('id', wsId).single();
    brandName = ws?.brand_name ?? 'streameren';
  }

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

  // 3. Slett gammel melding (alle metoder)
  if (karakterKanalId) {
    await finnOgSlettGammelKarakter(body.karakterNavn, karakterKanalId);
    // Slett også via gammelMsgId hvis oppgitt
    if (body.gammelMsgId) {
      await fetch(`${DISCORD_API}/channels/${karakterKanalId}/messages/${body.gammelMsgId}`, {
        method: 'DELETE', headers: botHeaders(false),
      }).catch(() => {});
    }
    resultater.push(`↳ Gammel melding sjekket og slettet`);
  }

  // 4. Bygg embed og send med eller uten bilde
  if (karakterKanalId && body.karakterIntro) {
    const bildeUrl = body.bildeUrl;
    const erBase64 = bildeUrl?.startsWith('data:');
    const erHttpUrl = bildeUrl?.startsWith('http');

    const embed: any = {
      title: `◆ ${body.karakterNavn.toUpperCase()}`,
      description: body.karakterIntro,
      color: 0x00ff41,
      footer: { text: `${body.serverNavn} • ${brandName} Stream Control` },
      timestamp: new Date().toISOString(),
    };

    let msgRes: Response;

    if (erBase64 && bildeUrl) {
      // Send bilde som vedlegg i samme melding som embeden
      const [header, data] = bildeUrl.split(',');
      const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
      const ext = mime.split('/')[1] ?? 'jpg';
      const filNavn = `karakter.${ext}`;
      const buffer = Buffer.from(data, 'base64');

      embed.image = { url: `attachment://${filNavn}` };

      const form = new FormData();
      form.append('files[0]', new Blob([buffer], { type: mime }), filNavn);
      form.append('payload_json', JSON.stringify({ embeds: [embed] }));

      msgRes = await fetch(`${DISCORD_API}/channels/${karakterKanalId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
        body: form,
      });
    } else {
      if (erHttpUrl) embed.image = { url: bildeUrl };
      msgRes = await fetch(`${DISCORD_API}/channels/${karakterKanalId}/messages`, {
        method: 'POST', headers: botHeaders(), body: JSON.stringify({ embeds: [embed] }),
      });
    }

    if (!msgRes.ok) {
      const errTekst = await msgRes.text();
      resultater.push(`✗ Feil ved publisering: ${msgRes.status} ${errTekst.slice(0, 100)}`);
    } else {
      const nyMsg = await msgRes.json() as any;
      resultater.push(`✓ Karakterkort publisert${erBase64 ? ' med bilde' : ''}`);

      // Lagre msg ID for fremtidig dedup
      const nøkkel = `rp_${body.karakterNavn.toLowerCase().replace(/\s+/g, '_')}`;
      await lagreMsgId(nøkkel, nyMsg.id, karakterKanalId);

      // Lagre i content library
      try {
        const { addContent } = await import('@/lib/contentLibrary');
        addContent({
          tittel: `RP Karakter: ${body.karakterNavn}`,
          type: 'rp-karakter',
          status: 'publisert',
          tekst: body.karakterIntro,
          bildeUrl: erHttpUrl ? bildeUrl : undefined,
          kanalId: karakterKanalId,
          modul: 'RP Manager',
          opprettetAv: 'dashboard',
          discordMsgId: nyMsg.id,
          publisert: new Date().toISOString(),
        });
      } catch {}
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

