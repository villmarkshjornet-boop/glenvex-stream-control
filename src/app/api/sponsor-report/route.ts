import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getBroadcasterId } from '@/lib/twitch';
import { getGuildInfo } from '@/lib/discord';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function getTwitchFollowers(broadcasterId: string): Promise<number> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return 0;
  try {
    const tokenRes = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
      { method: 'POST', signal: AbortSignal.timeout(5000) }
    );
    const td = await tokenRes.json() as any;
    const token = (process.env.TWITCH_USER_OAUTH ?? '').replace(/^oauth:/, '') || td.access_token;

    const res = await fetch(
      `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}&first=1`,
      { headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return 0;
    const d = await res.json() as any;
    return d.total ?? 0;
  } catch { return 0; }
}

export async function GET() {
  try {
    const db = getDb();
    const wsId = getWorkspaceId();

    // ── Parallelle datahentinger ─────────────────────────────────────────────
    const [broadcasterId, guild] = await Promise.all([getBroadcasterId(), getGuildInfo()]);

    const [
      streamHistRes,
      vodsRes,
      highlightsRes,
      partnereRes,
      workspaceRes,
      followers,
    ] = await Promise.all([
      db?.from('stream_history').select('*').eq('workspace_id', wsId).order('started_at', { ascending: false }).limit(30),
      db?.from('content_vods').select('id,status,created_at').eq('workspace_id', wsId).order('created_at', { ascending: false }).limit(100),
      db?.from('content_highlights').select('id,clip_status').order('created_at', { ascending: false }).limit(500),
      db?.from('partners').select('navn,aktiv').eq('workspace_id', wsId),
      db?.from('workspaces').select('settings_json').eq('id', wsId).single(),
      broadcasterId ? getTwitchFollowers(broadcasterId) : Promise.resolve(0),
    ]);

    const history: any[] = streamHistRes?.data ?? [];
    const vods: any[] = vodsRes?.data ?? [];
    const highlights: any[] = highlightsRes?.data ?? [];
    const partnere: any[] = partnereRes?.data ?? [];
    const settingsJson = workspaceRes?.data?.settings_json ?? {};
    const discordMembers = guild?.approximate_member_count ?? 0;

    // ── Beregn metrics ───────────────────────────────────────────────────────
    const siste10 = history.slice(0, 10);
    const siste30d = history.filter(h => {
      const dagerSiden = (Date.now() - new Date(h.started_at ?? h.startedAt ?? 0).getTime()) / (1000 * 60 * 60 * 24);
      return dagerSiden <= 30;
    });

    const avgViewers = siste10.length > 0
      ? Math.round(siste10.reduce((s, h) => s + (h.avg_viewers ?? h.avgViewers ?? 0), 0) / siste10.length)
      : 0;
    const peakViewers = siste10.length > 0
      ? Math.max(...siste10.map(h => h.peak_viewers ?? h.peakViewers ?? 0))
      : 0;
    const hoursStreamed = Math.round(
      history.slice(0, 20).reduce((s, h) => s + (h.duration_minutes ?? h.durationMinutes ?? 0), 0) / 60
    );
    const streamsLast30d = siste30d.length;
    const followerGainLast30d = siste30d.reduce((s, h) => s + (h.followers_gained ?? h.followerGain ?? 0), 0);
    const avgViewersLast30d = siste30d.length > 0
      ? Math.round(siste30d.reduce((s, h) => s + (h.avg_viewers ?? h.avgViewers ?? 0), 0) / siste30d.length)
      : 0;

    // Topp spill basert på peak seere
    const spillMap: Record<string, number> = {};
    for (const h of history) {
      const g = h.game ?? 'Ukjent';
      spillMap[g] = Math.max(spillMap[g] ?? 0, h.peak_viewers ?? h.peakViewers ?? 0);
    }
    const topSpill = Object.entries(spillMap).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s);

    // Content output
    const ferdigeVods = vods.filter(v => v.status === 'COMPLETE').length;
    const totaleKlipp = highlights.filter(h => h.clip_status === 'CLIPPED').length;
    const aktivePartnere = partnere.filter(p => p.aktiv).length;

    // Follower-veksttrend (fra snapshots)
    const snapshots: any[] = settingsJson.follower_snapshots ?? [];
    const snap30dSiden = snapshots.findLast((s: any) =>
      (Date.now() - new Date(s.ts).getTime()) >= 28 * 24 * 3600 * 1000
    );
    const followerGrowthRate = snap30dSiden && followers > 0
      ? followers - snap30dSiden.total
      : followerGainLast30d;

    // Score (0–100)
    const score = Math.min(100, Math.round(
      (Math.min(avgViewers, 200) / 200) * 30 +
      (Math.min(followers, 10000) / 10000) * 30 +
      (Math.min(discordMembers, 1000) / 1000) * 15 +
      (Math.min(hoursStreamed, 200) / 200) * 10 +
      (Math.min(streamsLast30d, 12) / 12) * 10 +
      (Math.min(totaleKlipp, 20) / 20) * 5
    ));

    // ── AI-genererte tekster ─────────────────────────────────────────────────
    const apiKey = process.env.OPENAI_API_KEY;
    let rapport = '';
    let sterktePunkter: string[] = [];
    let forbedringer: string[] = [];
    let pitchEmail = '';
    let pitchOneLiner = '';
    let malgruppe = '';

    if (apiKey) {
      const openai = new OpenAI({ apiKey });

      const kontekst = `
GLENVEX – Norsk Twitch-streamer
Statistikk:
- Følgere: ${followers.toLocaleString('no-NO')}
- Snitt-seere (siste 10 streams): ${avgViewers}
- Peak viewers (siste 10 streams): ${peakViewers}
- Seere siste 30 dager: ${avgViewersLast30d} snitt, ${streamsLast30d} streams
- Discord-membres: ${discordMembers}
- Timer streamet totalt: ${hoursStreamed}h
- Streams siste 30 dager: ${streamsLast30d}
- Nye følgere siste 30 dager: ~${followerGrowthRate}
- Ferdigstilte content-VODs: ${ferdigeVods}
- Klipp publisert: ${totaleKlipp}
- Aktive partnere nå: ${aktivePartnere}
- Topp spill/kategorier: ${topSpill.join(', ') || 'Future RP, GTA RP'}
- Sponsor score: ${score}/100`;

      const res = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'system',
          content: 'Du er en profesjonell salgsassistent for innholdsskapere. Skriv på norsk med profesjonell, men varm tone. Vær konkret og bruk faktiske tall.',
        }, {
          role: 'user',
          content: `Basert på disse kanalstatistikkene, generer sponsormateriell. Returner KUN JSON:
{
  "rapport": "Profesjonell sponsorrapport på 250-300 ord. Fremhev vekst, engasjement og målgruppe. Klar til å sende til potensielle sponsorer.",
  "pitchEmail": "Fullstendig e-post klar til å sende til en potensiell sponsor. Start med emnelinje: EMNE: [...]. Inkluder tallene naturlig, fortell om kanalen og publikum, foreslå et samarbeid. 200-250 ord.",
  "pitchOneLiner": "Én setning som selger kanalen til en sponsor. Under 20 ord.",
  "malgruppe": "2-3 setninger om hvem som ser på. Alder, interesser, kjøpekraft.",
  "sterktePunkter": ["Konkret sterk punkt med tall", "...", "..."],
  "forbedringer": ["Konkret forbedringspunkt", "...", "..."]
}

${kontekst}`,
        }],
        max_tokens: 1200,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });

      const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
      rapport = parsed.rapport ?? '';
      sterktePunkter = parsed.sterktePunkter ?? [];
      forbedringer = parsed.forbedringer ?? [];
      pitchEmail = parsed.pitchEmail ?? '';
      pitchOneLiner = parsed.pitchOneLiner ?? '';
      malgruppe = parsed.malgruppe ?? '';
    }

    return NextResponse.json({
      score,
      avgViewers,
      peakViewers,
      followers,
      discordMembers,
      hoursStreamed,
      rapport,
      sterktePunkter,
      forbedringer,
      pitchEmail,
      pitchOneLiner,
      malgruppe,
      trend: {
        followerGrowthLast30d: followerGrowthRate,
        avgViewersLast30d,
        streamsLast30d,
        topSpill,
      },
      contentStats: {
        ferdigeVods,
        totaleKlipp,
        aktivePartnere,
        streamsHistorikk: history.length,
      },
    });
  } catch (err) {
    console.error('[SponsorReport]', (err as Error).message);
    return NextResponse.json({
      score: 0, avgViewers: 0, peakViewers: 0, followers: 0, discordMembers: 0,
      hoursStreamed: 0, rapport: '', sterktePunkter: [], forbedringer: [],
      pitchEmail: '', pitchOneLiner: '', malgruppe: '',
      trend: { followerGrowthLast30d: 0, avgViewersLast30d: 0, streamsLast30d: 0, topSpill: [] },
      contentStats: { ferdigeVods: 0, totaleKlipp: 0, aktivePartnere: 0, streamsHistorikk: 0 },
    });
  }
}
