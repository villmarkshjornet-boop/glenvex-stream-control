import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getBroadcasterId } from '@/lib/twitch';
import { getGuildInfo } from '@/lib/discord';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { getCreatorContext } from '@/lib/ai/creatorContext';
import { logSystemEvent } from '@/lib/systemEvents';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

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

function trend(now: number, before: number): '↑' | '↓' | '→' {
  if (before === 0) return now > 0 ? '↑' : '→';
  const pct = (now - before) / before;
  if (pct > 0.05) return '↑';
  if (pct < -0.05) return '↓';
  return '→';
}

function periodMetrics(history: any[], dager: number) {
  const cutoff = new Date(Date.now() - dager * 24 * 3600_000);
  const slice = history.filter(h => new Date(h.started_at ?? h.startedAt ?? 0) >= cutoff);
  const streams = slice.length;
  const avgV = streams > 0 ? Math.round(slice.reduce((s, h) => s + (h.avg_viewers ?? 0), 0) / streams) : 0;
  const peakV = streams > 0 ? Math.max(...slice.map(h => h.peak_viewers ?? 0)) : 0;
  const hoursStr = Math.round(slice.reduce((s, h) => s + (h.duration_minutes ?? 0), 0) / 60);
  const followersGained = slice.reduce((s, h) => s + (h.followers_gained ?? h.follower_gain ?? 0), 0);
  return { streams, avgV, peakV, hoursStr, followersGained };
}

export async function GET() {
  try {
    const db = getDb();
    const wsId = getWorkspaceId();

    const [broadcasterId, guild, creatorCtx] = await Promise.all([
      getBroadcasterId(),
      getGuildInfo(),
      getCreatorContext().catch(() => null),
    ]);

    const cutoff90d = new Date(Date.now() - 90 * 24 * 3600_000).toISOString();

    const [streamHistRes, vodsRes, highlightsRes, partnereRes, workspaceRes, followers] = await Promise.all([
      db?.from('stream_history').select('*').eq('workspace_id', wsId)
        .gte('started_at', cutoff90d).order('started_at', { ascending: false }).limit(90),
      db?.from('content_vods').select('id,status,created_at').eq('workspace_id', wsId)
        .order('created_at', { ascending: false }).limit(200),
      db?.from('content_highlights').select('id,clip_status,created_at')
        .order('created_at', { ascending: false }).limit(1000),
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

    // ── Periode-metrics ───────────────────────────────────────────────────────
    const p7  = periodMetrics(history, 7);
    const p30 = periodMetrics(history, 30);
    const p90 = periodMetrics(history, 90);

    const cutoff7d  = new Date(Date.now() - 7  * 24 * 3600_000).toISOString();
    const cutoff30d = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

    const klipp7d  = highlights.filter(h => h.clip_status === 'CLIPPED' && h.created_at >= cutoff7d).length;
    const klipp30d = highlights.filter(h => h.clip_status === 'CLIPPED' && h.created_at >= cutoff30d).length;
    const klipp90d = highlights.filter(h => h.clip_status === 'CLIPPED').length;

    // ── Trends ───────────────────────────────────────────────────────────────
    const trends = {
      avgViewers: trend(p7.avgV, p30.avgV),
      streams:    trend(p7.streams, p30.streams),
      klipp:      trend(klipp7d, klipp30d),
      followers:  p30.followersGained > 20 ? '↑' as const : p30.followersGained < -20 ? '↓' as const : '→' as const,
    };

    // ── Totaler ───────────────────────────────────────────────────────────────
    const avgViewers    = p30.avgV;
    const peakViewers   = p30.peakV;
    const hoursStreamed = Math.round(history.reduce((s, h) => s + (h.duration_minutes ?? 0), 0) / 60);
    const streamsLast30d = p30.streams;
    const totaleKlipp   = highlights.filter(h => h.clip_status === 'CLIPPED').length;
    const aktivePartnere = partnere.filter(p => p.aktiv).length;
    const ferdigeVods   = vods.filter(v => v.status === 'COMPLETE').length;

    // Topp spill
    const spillMap: Record<string, number> = {};
    for (const h of history) { const g = h.game ?? 'Ukjent'; spillMap[g] = Math.max(spillMap[g] ?? 0, h.peak_viewers ?? 0); }
    const topSpill = Object.entries(spillMap).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s);

    // ── Score forklaring ──────────────────────────────────────────────────────
    const scoreKomponenter = [
      { navn: 'Snitt-seere (mål: 200)', maks: 30, oppnådd: Math.round((Math.min(avgViewers, 200) / 200) * 30), mangler: Math.max(0, 200 - avgViewers) > 0 ? `+${Math.max(0, 200 - avgViewers)} seere` : null },
      { navn: 'Følgere (mål: 10 000)',  maks: 30, oppnådd: Math.round((Math.min(followers, 10000) / 10000) * 30), mangler: Math.max(0, 10000 - followers) > 0 ? `+${(10000 - followers).toLocaleString('no-NO')} følgere` : null },
      { navn: 'Discord (mål: 1 000)',   maks: 15, oppnådd: Math.round((Math.min(discordMembers, 1000) / 1000) * 15), mangler: Math.max(0, 1000 - discordMembers) > 0 ? `+${1000 - discordMembers} Discord-membres` : null },
      { navn: 'Timer streamet (mål: 200t)', maks: 10, oppnådd: Math.round((Math.min(hoursStreamed, 200) / 200) * 10), mangler: Math.max(0, 200 - hoursStreamed) > 0 ? `+${200 - hoursStreamed}t streaming` : null },
      { navn: 'Streams (30 dager, mål: 12)', maks: 10, oppnådd: Math.round((Math.min(streamsLast30d, 12) / 12) * 10), mangler: Math.max(0, 12 - streamsLast30d) > 0 ? `+${12 - streamsLast30d} streams i mnd` : null },
      { navn: 'Klipp (mål: 20)',        maks: 5,  oppnådd: Math.round((Math.min(totaleKlipp, 20) / 20) * 5), mangler: Math.max(0, 20 - totaleKlipp) > 0 ? `+${20 - totaleKlipp} klipp` : null },
    ];

    const score = Math.min(100, scoreKomponenter.reduce((s, k) => s + k.oppnådd, 0));

    // ── Milestones ────────────────────────────────────────────────────────────
    const milestones = [
      { poeng: 25, label: 'Nybegynner', nådd: score >= 25 },
      { poeng: 50, label: 'Etablert kanal', nådd: score >= 50 },
      { poeng: 75, label: 'Seriøs skaper', nådd: score >= 75 },
      { poeng: 100, label: 'Sponsor-klar', nådd: score >= 100 },
    ];

    const nesteMillestone = milestones.find(m => !m.nådd) ?? null;

    // ── Data-styrke check ─────────────────────────────────────────────────────
    const dataErSvak = history.length < 3 && followers < 100;

    // ── AI Memory-kontekst ────────────────────────────────────────────────────
    const memoryKontekst = creatorCtx
      ? `\nAI Memory (${creatorCtx.streamCount} streams analysert):\n${creatorCtx.channelProfile}\n${creatorCtx.contentStrategy}`
      : '';

    // ── AI-genererte tekster ─────────────────────────────────────────────────
    const apiKey = process.env.OPENAI_API_KEY;
    let rapport = '';
    let sterktePunkter: string[] = [];
    let forbedringer: string[] = [];
    let pitchEmail = '';
    let pitchOneLiner = '';
    let malgruppe = '';
    let hvaOkerScoren = '';
    let hvaRedusererScoren = '';

    if (apiKey && !dataErSvak) {
      const openai = new OpenAI({ apiKey });
      const kontekst = `
Norsk Twitch-streamer statistikk:
- Følgere: ${followers.toLocaleString('no-NO')} ${trends.followers}
- Snitt-seere 30d: ${avgViewers}, 7d: ${p7.avgV} ${trends.avgViewers}
- Peak viewers 30d: ${peakViewers}
- Discord-membres: ${discordMembers}
- Streams siste 7d: ${p7.streams}, 30d: ${p30.streams}, 90d: ${p90.streams}
- Timer streamet: ${hoursStreamed}t
- Nye følgere siste 30d: ~${p30.followersGained}
- Klipp publisert 30d: ${klipp30d}, totalt: ${totaleKlipp} ${trends.klipp}
- Aktive partnere: ${aktivePartnere}
- Topp spill: ${topSpill.join(', ') || 'GTA RP'}
- Sponsor score: ${score}/100
- Neste milestone: ${nesteMillestone?.label ?? 'Sponsor-klar'} (${nesteMillestone?.poeng ?? 100} poeng)
${memoryKontekst}`;

      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: 'Norsk sponsormateriell-assistent. Profesjonell men varm tone. Bruk faktiske tall. Konkret og handlingsrettet.',
        }, {
          role: 'user',
          content: `Generer sponsormateriell basert på kanalstatistikk. Returner kun JSON:\n{"rapport":"250-300 ord profesjonell sponsorrapport klar til sending","pitchEmail":"Fullstendig e-post med EMNE: linje, 200-250 ord","pitchOneLiner":"Under 20 ord","malgruppe":"2-3 setninger om publikum","sterktePunkter":["punkt med tall","...","..."],"forbedringer":["konkret forbedring","...","..."],"hvaOkerScoren":"2-3 konkrete ting som vil øke sponsor-score mest","hvaRedusererScoren":"Hva som holder scoren nede nå"}\n\n${kontekst}`,
        }],
        max_tokens: 1400,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });

      try {
        const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
        rapport = parsed.rapport ?? '';
        sterktePunkter = parsed.sterktePunkter ?? [];
        forbedringer = parsed.forbedringer ?? [];
        pitchEmail = parsed.pitchEmail ?? '';
        pitchOneLiner = parsed.pitchOneLiner ?? '';
        malgruppe = parsed.malgruppe ?? '';
        hvaOkerScoren = parsed.hvaOkerScoren ?? '';
        hvaRedusererScoren = parsed.hvaRedusererScoren ?? '';
      } catch {}
    }

    // ── Log events ────────────────────────────────────────────────────────────
    await logSystemEvent({
      source: 'sponsor_manager',
      event_type: 'SPONSOR_SCORE_UPDATED',
      title: `Sponsor-score: ${score}/100`,
      description: `Neste milestone: ${nesteMillestone?.label ?? 'Sponsor-klar'}. Mangler: ${scoreKomponenter.filter(k => k.mangler).map(k => k.mangler).join(', ')}`,
      severity: 'info',
      metadata: { score, followers, avgViewers, discordMembers, streamsLast30d, totaleKlipp },
    });

    if (rapport) {
      await logSystemEvent({
        source: 'sponsor_manager',
        event_type: 'SPONSOR_REPORT_GENERATED',
        title: 'AI sponsorrapport generert',
        severity: 'info',
        metadata: { score, dataKvalitet: history.length >= 10 ? 'god' : history.length >= 3 ? 'moderat' : 'svak' },
      });
    }

    return NextResponse.json({
      score,
      dataErSvak,
      avgViewers,
      peakViewers,
      followers,
      discordMembers,
      hoursStreamed,
      trends,
      periode: {
        p7:  { ...p7,  klipp: klipp7d },
        p30: { ...p30, klipp: klipp30d },
        p90: { ...p90, klipp: klipp90d },
      },
      scoreKomponenter,
      milestones,
      nesteMillestone,
      rapport,
      sterktePunkter,
      forbedringer,
      pitchEmail,
      pitchOneLiner,
      malgruppe,
      hvaOkerScoren,
      hvaRedusererScoren,
      trend: {
        followerGrowthLast30d: p30.followersGained,
        avgViewersLast30d: p30.avgV,
        streamsLast30d,
        topSpill,
      },
      contentStats: {
        ferdigeVods,
        totaleKlipp,
        aktivePartnere,
        streamsHistorikk: history.length,
        aiMemoryStreams: creatorCtx?.streamCount ?? 0,
      },
    });
  } catch (err) {
    console.error('[SponsorReport]', (err as Error).message);
    return NextResponse.json({
      score: 0, dataErSvak: true, avgViewers: 0, peakViewers: 0, followers: 0,
      discordMembers: 0, hoursStreamed: 0, trends: { avgViewers: '→', streams: '→', klipp: '→', followers: '→' },
      periode: { p7: {}, p30: {}, p90: {} },
      scoreKomponenter: [], milestones: [], nesteMillestone: null,
      rapport: '', sterktePunkter: [], forbedringer: [],
      pitchEmail: '', pitchOneLiner: '', malgruppe: '',
      hvaOkerScoren: '', hvaRedusererScoren: '',
      trend: { followerGrowthLast30d: 0, avgViewersLast30d: 0, streamsLast30d: 0, topSpill: [] },
      contentStats: { ferdigeVods: 0, totaleKlipp: 0, aktivePartnere: 0, streamsHistorikk: 0, aiMemoryStreams: 0 },
    });
  }
}
