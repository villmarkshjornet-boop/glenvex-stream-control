import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getAnnonseringsKanalId } from '@/lib/discordChannel';

export const dynamic = 'force-dynamic';

const DISCORD_API = 'https://discord.com/api/v10';

function botHeaders() {
  return { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' };
}

export async function POST(req: NextRequest) {
  const { goals, live } = await req.json() as {
    goals: { type: string; label: string; mal: number; gjeldende: number; aktiv: boolean }[];
    live: { followers: number; discordMembres: number };
  };

  const kanalId = await getAnnonseringsKanalId();
  if (!kanalId) return NextResponse.json({ error: 'Ingen kanal funnet' }, { status: 400 });

  const aktive = goals.filter(g => g.aktiv && g.mal > 0);
  if (aktive.length === 0) return NextResponse.json({ error: 'Ingen aktive mål' }, { status: 400 });

  const apiKey = process.env.OPENAI_API_KEY;
  let intro = '🎯 Her er nåværende status på målene våre:';

  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const målTekst = aktive.map(g => {
        const gjeldende = g.type === 'followers' ? live.followers : g.type === 'discord' ? live.discordMembres : g.gjeldende;
        const pct = Math.round((gjeldende / g.mal) * 100);
        return `${g.label}: ${gjeldende}/${g.mal} (${pct}%)`;
      }).join(', ');

      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: `Skriv én engasjerende norsk Discord-melding (maks 2 setninger) om disse målene for GLENVEX sitt community: ${målTekst}. Mørk gaming-vibe, oppfordre til å hjelpe. Ingen emojis i starten.` }],
        max_tokens: 80,
        temperature: 0.9,
      });
      intro = res.choices[0]?.message?.content?.trim() ?? intro;
    } catch {}
  }

  const fields = aktive.map(g => {
    const gjeldende = g.type === 'followers' ? live.followers : g.type === 'discord' ? live.discordMembres : g.gjeldende;
    const pct = Math.min(100, Math.round((gjeldende / g.mal) * 100));
    const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
    return {
      name: g.label,
      value: `\`${bar}\` ${gjeldende.toLocaleString()} / ${g.mal.toLocaleString()} (${pct}%)`,
      inline: false,
    };
  });

  const embed = {
    title: '🎯 Community Goals',
    description: intro,
    color: 0x00ff41,
    fields,
    footer: { text: 'GLENVEX • Oppdateres automatisk' },
    timestamp: new Date().toISOString(),
  };

  const res = await fetch(`${DISCORD_API}/channels/${kanalId}/messages`, {
    method: 'POST',
    headers: botHeaders(),
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!res.ok) return NextResponse.json({ error: `Discord feil ${res.status}` }, { status: 500 });
  return NextResponse.json({ ok: true });
}
