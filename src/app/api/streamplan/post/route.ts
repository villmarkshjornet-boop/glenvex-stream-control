import { NextRequest, NextResponse } from 'next/server';
import { getStreamplanKanalId } from '@/lib/discordChannel';
import { postOgOppdater } from '@/lib/discordMessages';
import { addContent } from '@/lib/contentLibrary';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';

function botHeaders() {
  return {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

interface StreamEntry {
  id?: string;
  type?: 'weekly' | 'single';
  dag?: string;
  date?: string;
  tid: string;
  spill: string;
  tittel: string;
  aktiv: boolean;
  status?: string;
  pre_hype_enabled?: boolean;
  pre_hype_minutes_before?: number;
}

export async function POST(req: NextRequest) {
  const { plan } = await req.json() as { plan: StreamEntry[] };

  const wsId = getWorkspaceId();
  const db = getDb();
  let brandName = 'streameren';
  let twitchLogin: string | null = null;
  if (db) {
    const { data: ws } = await db.from('workspaces').select('brand_name,twitch_login').eq('id', wsId).single();
    brandName  = ws?.brand_name  ?? 'streameren';
    twitchLogin = ws?.twitch_login ?? null;
  }

  // Bruk annonseringskanal – ikke chat
  const kanalId = await getStreamplanKanalId();
  if (!kanalId) {
    return NextResponse.json({ error: 'Ingen annonseringskanal funnet. Sett DISCORD_ANNOUNCE_CHANNEL_ID eller DISCORD_LIVE_CHANNEL_ID.' }, { status: 400 });
  }

  const osloDatoISO = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(new Date());
  const aktive = plan.filter(e => {
    if (!e.aktiv) return false;
    if (e.type === 'single') return !!e.date && e.date >= osloDatoISO && e.status !== 'completed';
    return true;
  });
  if (aktive.length === 0) {
    return NextResponse.json({ error: 'Ingen aktive stream-dager å poste' }, { status: 400 });
  }

  const planLinjer = aktive
    .map(e => {
      const dagLabel = e.type === 'single'
        ? `📌 ${e.date} kl. ${e.tid}`
        : `🔁 **${e.dag ?? 'Ukentlig'}** kl. ${e.tid}`;
      return `${dagLabel}  ·  ${e.spill}${e.tittel ? `  –  *${e.tittel}*` : ''}`;
    })
    .join('\n');

  const embed = {
    title: '📅 Streamplan',
    description: planLinjer,
    color: 0x00ff41,
    fields: twitchLogin ? [{
      name: '📺 Se streamen her',
      value: `[twitch.tv/${twitchLogin}](https://twitch.tv/${twitchLogin})`,
      inline: true,
    }] : [],
    footer: { text: `${brandName} Stream Control • Streamplan` },
    timestamp: new Date().toISOString(),
  };

  // Slett gammel + post ny atomisk
  const result = await postOgOppdater('streamplan', kanalId, { embeds: [embed] });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  addContent({
    tittel: `Streamplan – uke ${getWeekNumber()}`,
    type: 'streamplan',
    status: 'publisert',
    tekst: planLinjer,
    kanalId,
    modul: 'Streamplan',
    opprettetAv: 'dashboard',
    discordMsgId: result.msgId,
    publisert: new Date().toISOString(),
    tags: aktive.map(e => e.dag ?? e.date ?? '').filter(Boolean),
  });

  return NextResponse.json({ ok: true, msgId: result.msgId, antallDager: aktive.length, kanalId });
}

function getWeekNumber(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.ceil(((now.getTime() - start.getTime()) / 86_400_000 + start.getDay() + 1) / 7);
}

