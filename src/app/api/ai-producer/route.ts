import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getStreamInfo } from '@/lib/twitch';
import { hentBotData } from '@/lib/botData';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { logSystemEvent } from '@/lib/systemEvents';
import { getCreatorContext, buildContextPrompt } from '@/lib/ai/creatorContext';
import { logAgentDecision } from '@/lib/ai/eventLogger';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  try {
    const stream = await getStreamInfo();

    if (!stream.isLive) {
      const db = getDb();
      const wsId = getWorkspaceId();
      const standby: Record<string, any> = {
        twitchBotOk:    !!process.env.TWITCH_CLIENT_ID && !!process.env.TWITCH_CLIENT_SECRET,
        discordBotOk:   !!process.env.DISCORD_BOT_TOKEN,
        nesteStream:     null,
        preHypeSendtAt:  null,
        sisteStreamScore: null,
        sisteAiLaering:  null,
      };

      if (db) {
        const [wsRes, histRes, insightRes] = await Promise.all([
          db.from('workspaces').select('settings_json').eq('id', wsId).single(),
          db.from('stream_history')
            .select('title,game,peak_viewers,started_at')
            .eq('workspace_id', wsId)
            .order('started_at', { ascending: false })
            .limit(1),
          db.from('ai_agent_insights')
            .select('title,summary,source_data')
            .eq('workspace_id', wsId)
            .order('created_at', { ascending: false })
            .limit(5),
        ]).catch(() => [null, null, null]);

        const settings = (wsRes as any)?.data?.settings_json ?? {};
        const streamplan: any[] = settings.streamplan ?? [];
        const syklus = settings.stream_syklus ?? {};
        standby.preHypeSendtAt = syklus.pre_hype_sendt_at ?? null;

        const DAGNAVN = ['mandag','tirsdag','onsdag','torsdag','fredag','lørdag','søndag'];
        const dagIdx = (new Date().getDay() + 6) % 7; // Mon=0…Sun=6
        const aktive = streamplan.filter((d: any) => d.aktiv);
        standby.nesteStream = aktive.find((d: any) => DAGNAVN.indexOf(d.dag) >= dagIdx) ?? aktive[0] ?? null;

        const hist = (histRes as any)?.data?.[0];
        if (hist) {
          standby.sisteStreamScore = {
            spill:    hist.game ?? hist.title ?? 'Ukjent',
            seere:    hist.peak_viewers ?? 0,
            startetAt: hist.started_at,
          };
        }

        const insights: any[] = (insightRes as any)?.data ?? [];
        const bestInsight = insights.find(
          (r: any) => r.source_data?.type !== 'decision_feedback'
        ) ?? null;
        if (bestInsight) {
          standby.sisteAiLaering = {
            title:   bestInsight.title,
            summary: bestInsight.summary,
          };
        }
      }

      return NextResponse.json({ isLive: false, stream: null, analyse: null, tiltak: [], standby });
    }

    const [eventsRaw, membersRaw, ctx] = await Promise.all([
      hentBotData('events'),
      hentBotData('members'),
      getCreatorContext({ limit: 10 }),
    ]);
    const events = eventsRaw ?? { raids: [], giftSubs: [] };
    const members = membersRaw ?? {};
    const activeMembers = Object.values(members).filter((m: any) => {
      const sist = new Date(m.lastSeen ?? 0).getTime();
      return Date.now() - sist < 60 * 60 * 1000;
    }).length;

    // ─── Stream Coach historikk + Community-data ──────────────────────────
    let streamHistorikk: any[] = [];
    let communityTopLine = '';
    let brandName = 'streameren';
    let twitchUrl: string | null = null;
    const db = getDb();
    if (db) {
      try {
        const cut14d = new Date(Date.now() - 14 * 86400_000).toISOString();
        const [histRes, commRes, wsRow] = await Promise.all([
          db.from('stream_history')
            .select('title,game,peak_viewers,avg_viewers,duration_minutes,followers_gained,chat_messages,subs_gained')
            .eq('workspace_id', getWorkspaceId())
            .order('started_at', { ascending: false })
            .limit(10),
          db.from('community_members')
            .select('display_name,username,level,xp,streams_attended,subs,gift_subs,raids,last_seen,engagement_score')
            .eq('workspace_id', getWorkspaceId())
            .order('xp', { ascending: false })
            .limit(20),
          db.from('workspaces').select('brand_name,twitch_channel_name').eq('id', getWorkspaceId()).single(),
        ]);
        streamHistorikk = histRes.data ?? [];
        const allMembers = commRes.data ?? [];
        brandName = (wsRow as any)?.data?.brand_name ?? 'streameren';
        const twitchChannelName: string | null = (wsRow as any)?.data?.twitch_channel_name ?? null;
        twitchUrl = twitchChannelName ? `https://twitch.tv/${twitchChannelName}` : null;
        if (!brandName || brandName === 'streameren') {
          void db.from('system_events').insert({ workspace_id: getWorkspaceId(), source: 'ai_producer', event_type: 'WORKSPACE_MISSING_BRAND_CONTEXT', title: 'AI Producer: workspace mangler brand_name', severity: 'warning', metadata: { workspaceId: getWorkspaceId() } });
        }
        const top5 = allMembers.slice(0, 5).map((m: any) => `${m.display_name ?? m.username} (Lv${m.level})`).join(', ');
        const atRisk = allMembers.filter((m: any) => (m.last_seen ?? '') < cut14d && (m.xp ?? 0) > 100).length;
        const heroCount = allMembers.filter((m: any) => (m.level ?? 0) >= 30 || ((m.subs ?? 0) + (m.gift_subs ?? 0) * 2 + (m.raids ?? 0) * 3) >= 5).length;
        communityTopLine = `Topp-membres: ${top5 || 'ingen ennå'} | Community Heroes: ${heroCount} | At Risk: ${atRisk}`;
      } catch {}
    }
    if (streamHistorikk.length === 0) {
      const raw = await hentBotData('stream-history') as any[] | null;
      streamHistorikk = (raw ?? []).slice(0, 10);
    }

    // Analyser historikken
    const bestSpill: Record<string, { peak: number; antall: number; followers: number }> = {};
    for (const s of streamHistorikk) {
      const g = s.game ?? s.spill ?? 'Ukjent';
      if (!bestSpill[g]) bestSpill[g] = { peak: 0, antall: 0, followers: 0 };
      bestSpill[g].peak = Math.max(bestSpill[g].peak, s.peak_viewers ?? s.peakViewers ?? 0);
      bestSpill[g].antall++;
      bestSpill[g].followers += s.followers_gained ?? s.followerGain ?? 0;
    }
    const spillRanking = Object.entries(bestSpill)
      .sort((a, b) => b[1].peak - a[1].peak)
      .slice(0, 3)
      .map(([spill, d]) => `${spill}: topp ${d.peak} seere, ${d.followers} følgere totalt`)
      .join(' | ');

    const avgPeak = streamHistorikk.length > 0
      ? Math.round(streamHistorikk.reduce((s, h) => s + (h.peak_viewers ?? h.peakViewers ?? 0), 0) / streamHistorikk.length)
      : 0;

    const apiKey = process.env.OPENAI_API_KEY;
    let analyse = '';
    let tiltak: any[] = [];

    const kanalKunnskap = buildContextPrompt(ctx);

    if (apiKey) {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'system',
          content: `Du er AI-produsent for ${brandName}, en norsk Twitch-streamer. Du kjenner kanalen godt og hjelper med å maksimere vekst og engasjement under stream.
Kanalens tone: energisk, litt edgy norsk gaming-humor, autentisk, ikke overdrevent corporat.${twitchUrl ? `\nTwitch-kanal: ${twitchUrl} — inkluder alltid denne lenken som CTA i sosiale medier-tekster.` : ''}
Du skal ALLTID generere faktisk klar-til-bruk innhold for hvert tiltak som involverer en tekst/post – ikke bare si "post noe", men LAG selve teksten.`,
        }, {
          role: 'user',
          content: `Analyser nåværende stream og gi handlingsrettede forslag med ferdig innhold.

NÅVÆRENDE STREAM:
- Spill: ${stream.game}
- Tittel: ${stream.title}
- Seere nå: ${stream.viewerCount ?? 0}
- Aktive Discord-membres: ${activeMembers}
- Raids i dag: ${events.raids?.length ?? 0}
- Gift subs: ${events.giftSubs?.reduce((s: number, g: any) => s + g.count, 0) ?? 0}

COMMUNITY:
- ${communityTopLine || 'Ingen community-data ennå'}

STREAM COACH HISTORIKK (siste ${streamHistorikk.length} streams):
- Snitt peak-seere: ${avgPeak}
- Beste spill: ${spillRanking || 'ikke nok data ennå'}

${kanalKunnskap}

Returner KUN gyldig JSON:
{
  "analyse": "2-3 setninger om situasjonen og hva som funker for kanalen basert på historikken",
  "tiltak": [
    {
      "tekst": "Kort beskrivelse av tiltaket",
      "prioritet": "høy",
      "type": "sosial_media",
      "innhold": {
        "tiktok": "Ferdig TikTok-tekst med emojier og hashtags",
        "instagram": "Ferdig Instagram-caption",
        "twitter": "Ferdig tweet under 280 tegn",
        "url": "Twitch-lenke som CTA (tom streng hvis ingen)"
      }
    },
    {
      "tekst": "Post i Discord",
      "prioritet": "medium",
      "type": "discord",
      "innhold": {
        "discord": "Ferdig Discord-melding med @mentions og embeds"
      }
    },
    {
      "tekst": "Si noe i chat",
      "prioritet": "lav",
      "type": "chat",
      "innhold": {
        "chat": "Ferdig chat-melding"
      }
    }
  ]
}

Gi 3-5 tiltak. Alltid generer faktisk innhold for tiltak som krever en tekst. Tilpass til nåværende spill og kanalens tone.`,
        }],
        max_tokens: 900,
        temperature: 0.85,
        response_format: { type: 'json_object' },
      });

      try {
        const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
        analyse = parsed.analyse ?? '';
        tiltak = parsed.tiltak ?? [];
      } catch {}
    }

    const viewerCount = stream.viewerCount ?? 0;
    const engagementScore = Math.min(100, Math.round(
      (Math.min(viewerCount, 100) / 100) * 60 +
      (Math.min(activeMembers, 20) / 20) * 40
    ));

    await Promise.all([
      logSystemEvent({
        source: 'ai_producer',
        event_type: 'AI_PRODUCER_ANALYSIS_COMPLETE',
        title: `AI Producer analyserte stream: ${stream.game ?? 'Ukjent spill'}`,
        severity: 'info',
        metadata: {
          stream: stream.game,
          viewers: viewerCount,
          tiltakGenerert: tiltak.length,
          harHistorikk: streamHistorikk.length > 0,
          engagementScore,
          harKanalKunnskap: ctx.streamCount > 0,
        },
      }),
      logAgentDecision({
        agent_type: 'ai_producer',
        decision_type: 'stream_analysis',
        input_context: { game: stream.game, viewers: viewerCount, historyCount: streamHistorikk.length, streamCount: ctx.streamCount },
        decision_summary: `Analyserte ${stream.game ?? 'stream'} med ${viewerCount} seere. Genererte ${tiltak.length} tiltak. Kanalminne: ${ctx.streamCount} streams.`,
        outcome: tiltak.length > 0 ? 'tips_generated' : 'no_tips',
      }),
    ]).catch(() => {});

    return NextResponse.json({
      isLive: true,
      stream,
      analyse,
      tiltak,
      metrics: {
        viewers: viewerCount,
        activeDiscord: activeMembers,
        raidsToday: events.raids?.length ?? 0,
        giftSubsToday: events.giftSubs?.reduce((s: number, g: any) => s + g.count, 0) ?? 0,
        engagementScore,
      },
      harHistorikk: streamHistorikk.length > 0,
    });
  } catch (err) {
    return NextResponse.json({ isLive: false, stream: null, analyse: null, tiltak: [], error: (err as Error).message });
  }
}

