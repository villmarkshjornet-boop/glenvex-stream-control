import { NextResponse } from 'next/server';
import { getAllContent } from '@/lib/contentLibrary';
import { hentBotData } from '@/lib/botData';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { getBroadcasterId, getChannelStats } from '@/lib/twitch';
import { getGuildInfo } from '@/lib/discord';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

// Hent streamplan fra Supabase eller fil
async function hentStreamplan() {
  if (isDbAvailable()) {
    const db = getDb();
    if (db) {
      const { data } = await db
        .from('workspaces')
        .select('settings_json')
        .eq('id', getWorkspaceId())
        .single();
      if (data && data.settings_json?.streamplan?.length > 0) {
        return data.settings_json.streamplan;
      }
    }
  }
  try {
    const f = path.join(process.cwd(), 'data', 'schedule.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch {}
  return [];
}

function finnNesteStream(plan: any[]) {
  const dagNavn = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];
  const idag = new Date().getDay();
  const aktive = plan.filter(d => d.aktiv);
  return aktive.find(d => dagNavn.indexOf(d.dag) >= idag) ?? aktive[0] ?? null;
}

export async function GET() {
  const [streamplan, events, botMemory, innhold, guild] = await Promise.all([
    hentStreamplan(),
    hentBotData('events').catch(() => ({ raids: [], giftSubs: [] })),
    hentBotData('members').catch(() => ({})),
    Promise.resolve(getAllContent().slice(0, 20)),
    getGuildInfo(),
  ]);

  // Hent live Twitch-data
  let followers = 0;
  try {
    const broadcasterId = await getBroadcasterId();
    if (broadcasterId) {
      const stats = await getChannelStats(broadcasterId);
      followers = stats.followerCount;
    }
  } catch {}

  // Hva boten har gjort (fra content library)
  const sistPublisert = innhold
    .filter(i => i.status === 'publisert')
    .slice(0, 8)
    .map(i => ({
      type: i.type,
      tittel: i.tittel,
      kanal: i.kanalNavn ?? i.kanalId,
      tid: i.publisert ?? i.opprettet,
      modul: i.modul,
    }));

  // Hva boten planlegger (basert på schedule og ukentlige oppgaver)
  const nesteStream = finnNesteStream(Array.isArray(streamplan) ? streamplan : []);
  const dagNavn = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];
  const iDag = dagNavn[new Date().getDay()];
  const erMandag = new Date().getDay() === 1;
  const erSøndag = new Date().getDay() === 0;

  const planlagte: { hva: string; når: string; type: string; prioritet: string }[] = [];

  if (nesteStream) {
    planlagte.push({
      hva: `Live: ${nesteStream.spill} – ${nesteStream.dag} kl. ${nesteStream.tid}`,
      når: `${nesteStream.dag} ${nesteStream.tid}`,
      type: 'live',
      prioritet: 'høy',
    });
  }

  planlagte.push(
    { hva: 'Discord-promo melding', når: 'Om ~4 timer', type: 'discord', prioritet: 'lav' },
    { hva: 'Partner-promo i Twitch chat', når: 'Om ~1 time (når live)', type: 'twitch', prioritet: 'medium' },
    { hva: 'Sosiale lenker i chat', når: 'Om ~8 timer', type: 'discord', prioritet: 'lav' },
  );

  if (erMandag) {
    planlagte.unshift({ hva: 'Auto-post streamplan til Discord', når: 'Nå (mandag)', type: 'discord', prioritet: 'høy' });
  }
  if (erSøndag) {
    planlagte.unshift({ hva: 'Ukentlig statistikk til Discord', når: 'I dag (søndag)', type: 'discord', prioritet: 'medium' });
  }

  // Bot-status
  const aktiveMembers = Object.values(botMemory as any).filter((m: any) => {
    const sist = new Date(m.lastSeen ?? 0).getTime();
    return Date.now() - sist < 7 * 24 * 60 * 60 * 1000;
  }).length;

  return NextResponse.json({
    streamplan: Array.isArray(streamplan) ? streamplan : [],
    nesteStream,
    sistPublisert,
    planlagte,
    metrics: {
      followers,
      discordMembres: guild?.approximate_member_count ?? guild?.member_count ?? 0,
      aktiveMembers,
      raidsUke: (events as any)?.raids?.length ?? 0,
      giftSubsUke: (events as any)?.giftSubs?.reduce((s: number, g: any) => s + g.count, 0) ?? 0,
    },
  });
}
