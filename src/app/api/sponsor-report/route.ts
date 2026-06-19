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
    // channels/followers krever user OAuth med moderator:read:followers scope
    // Prøv BOT_OAUTH og USER_OAUTH før client credentials (som IKKE har denne scope)
    const userToken = (process.env.TWITCH_BOT_OAUTH ?? process.env.TWITCH_USER_OAUTH ?? '').replace(/^oauth:/, '');
    let token = userToken;

    if (!token) {
      // Fall tilbake til client credentials (funker IKKE for followers siden 2023 – returnerer 0)
      const tokenRes = await fetch(
        `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
        { method: 'POST', signal: AbortSignal.timeout(5000) }
      );
      const td = await tokenRes.json() as any;
      token = td.access_token ?? '';
    }

    const res = await fetch(
      `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${broadcasterId}&first=1`,
      { headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) {
      // Prøv å lese fra Supabase workspace-cache hvis API feiler
      return 0;
    }
    const d = await res.json() as any;
    const total = d.total ?? 0;

    // Cache i Supabase for fremtidige kall
    const { getDb } = await import('@/lib/db');
    const { getWorkspaceId } = await import('@/lib/workspace');
    const db = getDb();
    if (db && total > 0) {
      const wsId = getWorkspaceId();
      const { data } = await db.from('workspaces').select('settings_json').eq('id', wsId).single();
      const current = (data as any)?.settings_json ?? {};
      const metrics = { ...(current.metrics ?? {}), followerCount: total, followerUpdatedAt: new Date().toISOString() };
      db.from('workspaces').update({ settings_json: { ...current, metrics } }).eq('id', wsId).then(undefined, () => {});
    }
    return total;
  } catch { return 0; }
}

async function getCachedFollowers(): Promise<number> {
  try {
    const { getDb } = await import('@/lib/db');
    const { getWorkspaceId } = await import('@/lib/workspace');
    const db = getDb();
    if (!db) return 0;
    const { data } = await db.from('workspaces').select('settings_json').eq('id', getWorkspaceId()).single();
    return (data as any)?.settings_json?.metrics?.followerCount ?? 0;
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

// ── Per-partner report handler ────────────────────────────────────────────────

async function handlePartnerReport(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const partnerName = searchParams.get('partner') ?? '';
  const periodDays  = searchParams.get('period') === '7d' ? 7 : 30;
  const wsId = getWorkspaceId();
  const db   = getDb();

  await logSystemEvent({
    source: 'sponsor_manager',
    event_type: 'SPONSOR_REPORT_STARTED',
    title: `Partnerrapport startet: ${partnerName}`,
    severity: 'info',
    metadata: { partnerName, periodDays, workspaceId: wsId },
  });

  try {
    const since90d   = new Date(Date.now() - 90 * 24 * 3600_000).toISOString();
    const sinceP     = new Date(Date.now() - periodDays * 24 * 3600_000).toISOString();
    const since7d    = new Date(Date.now() - 7  * 24 * 3600_000).toISOString();
    const since30d   = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

    const [logsRes, proposalsRes, decisionsRes, streamsRes, knowledgeRes, allKnowledgeRes, eventsRes, highlightsRes, vodsRes, partnerRes] = await Promise.all([
      db?.from('partner_content_log')
        .select('id, partner_name, platform, channel, posted_at, affiliate_url_used, discord_message_id, clicks')
        .eq('workspace_id', wsId).eq('partner_name', partnerName)
        .gte('posted_at', since90d).order('posted_at', { ascending: false }).limit(500),
      db?.from('partner_proposals')
        .select('id, partner_name, platform, channel, status, confidence, created_at, approved_at, sent_at')
        .eq('workspace_id', wsId).eq('partner_name', partnerName)
        .order('created_at', { ascending: false }).limit(500),
      db?.from('ai_agent_decisions')
        .select('id, decision_summary, outcome, input_context, created_at')
        .eq('workspace_id', wsId).eq('agent_type', 'partner_promotion')
        .gte('created_at', since90d).order('created_at', { ascending: false }).limit(500),
      db?.from('stream_history')
        .select('id, stream_id, title, started_at, ended_at, peak_viewers, avg_viewers, duration_minutes, game')
        .eq('workspace_id', wsId).gte('started_at', since90d)
        .order('started_at', { ascending: false }).limit(200),
      db?.from('creator_knowledge')
        .select('knowledge_type, key, title, finding, confidence, evidence_count, evidence_summary')
        .eq('workspace_id', wsId)
        .in('key', [`partner:${partnerName}`, `partner_perf:${partnerName}`]),
      db?.from('creator_knowledge')
        .select('knowledge_type, key, title, finding, confidence, evidence_count, evidence_summary')
        .eq('workspace_id', wsId)
        .not('key', 'like', `partner:%`).limit(20),
      db?.from('system_events')
        .select('event_type, title, metadata, created_at')
        .eq('workspace_id', wsId).gte('created_at', since90d)
        .limit(500),
      db?.from('content_highlights')
        .select('id, title, clip_status, created_at')
        .gte('created_at', since90d).order('created_at', { ascending: false }).limit(500),
      db?.from('content_vods')
        .select('id, title, status, created_at')
        .eq('workspace_id', wsId).gte('created_at', since90d)
        .order('created_at', { ascending: false }).limit(100),
      db?.from('partners')
        .select('navn, aktiv, siste_promotert, eksponering')
        .eq('workspace_id', wsId).eq('navn', partnerName).maybeSingle(),
    ]);

    const logs       = logsRes?.data       ?? [];
    const proposals  = proposalsRes?.data  ?? [];
    const allDecisions = decisionsRes?.data ?? [];
    const streams    = streamsRes?.data    ?? [];
    const pKnowledge = knowledgeRes?.data  ?? [];
    const genKnowledge = allKnowledgeRes?.data ?? [];
    const events     = eventsRes?.data     ?? [];
    const highlights = highlightsRes?.data ?? [];
    const vods       = vodsRes?.data       ?? [];
    const partnerRow = partnerRes?.data    ?? null;

    // Filter decisions for this partner
    const decisions = allDecisions.filter(d =>
      (d.input_context as any)?.partnerName === partnerName ||
      (d.input_context as any)?.partnerId   != null
    );

    // ── Streams where this partner was active ─────────────────────────────────
    const promoTimestamps = [
      ...logs.map(l => new Date(l.posted_at).getTime()),
      ...proposals.filter(p => p.status === 'sent' || p.status === 'approved').map((p: any) => new Date(p.created_at).getTime()),
    ];
    const activeStreams = streams.filter(s => {
      const start = new Date(s.started_at).getTime();
      const end   = s.ended_at ? new Date(s.ended_at).getTime() : start + 6 * 60 * 60 * 1000;
      return promoTimestamps.some(t => t >= start && t <= end);
    });

    // ── Highlights during active streams ─────────────────────────────────────
    const partnerHighlights = highlights.filter(h => {
      const t = new Date(h.created_at).getTime();
      return activeStreams.some(s => {
        const start = new Date(s.started_at).getTime();
        const end   = s.ended_at ? new Date(s.ended_at).getTime() : start + 6 * 60 * 60 * 1000;
        return t >= start && t <= end + 2 * 60 * 60 * 1000;
      });
    });

    // ── Proposal stats ────────────────────────────────────────────────────────
    const godkjent = proposals.filter(p => p.status === 'approved' || p.status === 'sent').length;
    const avvist   = proposals.filter(p => p.status === 'rejected').length;
    const venter   = proposals.filter(p => p.status === 'pending').length;
    const decided  = godkjent + avvist;

    // ── Platform breakdown ────────────────────────────────────────────────────
    const discordLogs = logs.filter(l => l.platform === 'discord');
    const twitchLogs  = logs.filter(l => l.platform === 'twitch');
    const logsInP     = logs.filter(l => l.posted_at >= sinceP);
    const logsIn7d    = logs.filter(l => l.posted_at >= since7d);
    const logsIn30d   = logs.filter(l => l.posted_at >= since30d);
    const logsIn90d   = logs;

    const lastLog     = logs[0] ?? null;
    const lastDec     = decisions[0] ?? null;
    const lastCtx     = (lastDec?.input_context as any) ?? {};

    // ── Section 4: Historisk utvikling ───────────────────────────────────────
    const countApprInRange = (from: string) =>
      proposals.filter(p => (p.status === 'approved' || p.status === 'sent') && p.created_at >= from).length;

    const historisk = {
      p7:  { promoer: logsIn7d.length,  godkjennelser: countApprInRange(since7d),  eksponering: discordLogs.filter(l => l.posted_at >= since7d).length  + twitchLogs.filter(l => l.posted_at >= since7d).length  },
      p30: { promoer: logsIn30d.length, godkjennelser: countApprInRange(since30d), eksponering: discordLogs.filter(l => l.posted_at >= since30d).length + twitchLogs.filter(l => l.posted_at >= since30d).length },
      p90: { promoer: logsIn90d.length, godkjennelser: countApprInRange(since90d), eksponering: logs.length },
    };

    // ── Section 5: Stream-historikk ───────────────────────────────────────────
    const streamHistorikk = activeStreams.slice(0, 10).map(s => {
      const start = new Date(s.started_at).getTime();
      const end   = s.ended_at ? new Date(s.ended_at).getTime() : start + 6 * 60 * 60 * 1000;
      const sLogs = logs.filter(l => { const t = new Date(l.posted_at).getTime(); return t >= start && t <= end; });
      const sHL   = highlights.filter(h => { const t = new Date(h.created_at).getTime(); return t >= start && t <= end + 2 * 60 * 60 * 1000; });
      return {
        title:      s.title ?? s.stream_id ?? 'Stream',
        startedAt:  s.started_at,
        discord:    sLogs.filter(l => l.platform === 'discord').length,
        twitch:     sLogs.filter(l => l.platform === 'twitch').length,
        promoer:    sLogs.length,
        highlights: sHL.length,
        game:       s.game ?? null,
        avgViewers: s.avg_viewers ?? null,
      };
    });

    // ── Section 6: Highlights ─────────────────────────────────────────────────
    const highlightSeksjon = partnerHighlights.slice(0, 8).map(h => {
      const hTime = new Date(h.created_at).getTime();
      const matchStream = activeStreams.find(s => {
        const start = new Date(s.started_at).getTime();
        const end   = s.ended_at ? new Date(s.ended_at).getTime() : start + 6 * 60 * 60 * 1000;
        return hTime >= start && hTime <= end + 2 * 60 * 60 * 1000;
      });
      const matchVod = vods.find(v => {
        const vTime = new Date(v.created_at).getTime();
        return Math.abs(vTime - hTime) < 4 * 60 * 60 * 1000;
      });
      return {
        id:         h.id,
        title:      (h as any).title ?? null,
        createdAt:  h.created_at,
        streamTitle: matchStream?.title ?? null,
        vodId:       matchVod?.id ?? null,
        vodTitle:    matchVod?.title ?? null,
      };
    });

    // ── Section 7: Creator Brain Learning ────────────────────────────────────
    const promoPattern  = pKnowledge.find(k => k.knowledge_type === 'promotion_pattern');
    const partnerPerf   = pKnowledge.find(k => k.knowledge_type === 'partner_performance');
    const bestTiming    = genKnowledge.filter(k => k.knowledge_type === 'stream_behaviour')
      .sort((a: any, b: any) => ((b.evidence_summary as any)?.approvalRate ?? 0) - ((a.evidence_summary as any)?.approvalRate ?? 0))[0] ?? null;
    const bestPlatform  = genKnowledge.filter(k => k.knowledge_type === 'platform_preference')
      .sort((a: any, b: any) => b.evidence_count - a.evidence_count)[0] ?? null;
    const historiskeMonstre = genKnowledge.filter(k =>
      k.knowledge_type === 'timing_pattern' || k.knowledge_type === 'creator_preference' || k.knowledge_type === 'decision_accuracy'
    ).slice(0, 4).map(k => k.finding);

    const creatorLearning = {
      besteTidspunkt: bestTiming ? {
        label:        (bestTiming.evidence_summary as any)?.label ?? bestTiming.key,
        approvalRate: (bestTiming.evidence_summary as any)?.approvalRate ?? null,
        evidenceCount: bestTiming.evidence_count,
        confidence:   bestTiming.confidence,
      } : null,
      bestePlattform: bestPlatform ? {
        platform:     (bestPlatform.evidence_summary as any)?.platform ?? bestPlatform.key.replace('platform:', ''),
        percentage:   (bestPlatform.evidence_summary as any)?.percentage ?? null,
        evidenceCount: bestPlatform.evidence_count,
        confidence:   bestPlatform.confidence,
      } : null,
      approvalPattern: promoPattern ? {
        approvalRate:  (promoPattern.evidence_summary as any)?.approvalRate ?? null,
        evidenceCount: promoPattern.evidence_count,
        confidence:    promoPattern.confidence,
        finding:       promoPattern.finding,
      } : null,
      partnerPerformance: partnerPerf ? {
        finding:       partnerPerf.finding,
        confidence:    partnerPerf.confidence,
        evidenceCount: partnerPerf.evidence_count,
      } : null,
      historiskeMonstre,
    };

    // ── Section 9: Datagrunnlag ───────────────────────────────────────────────
    const totalDatapunkter = logs.length + proposals.length + decisions.length;
    const dataStyrke: 'god' | 'moderat' | 'svak' = totalDatapunkter >= 10 ? 'god' : totalDatapunkter >= 3 ? 'moderat' : 'svak';
    const datagrunnlag = {
      styrke: dataStyrke,
      forklaring: dataStyrke === 'god'
        ? `Tilstrekkelig historikk for pålitelig analyse (${totalDatapunkter} datapunkter).`
        : dataStyrke === 'moderat'
        ? `Noe historikk tilgjengelig, men rapporten kan bli mer presis med flere streams (${totalDatapunkter} datapunkter).`
        : 'Mangler tilstrekkelig historikk. Kjør flere streams for å bygge opp datagrunnlag.',
      basertPa: {
        streams:      activeStreams.length,
        proposals:    proposals.length,
        promoer:      logs.length,
        systemEvents: events.filter(e => (e.metadata as any)?.partnerName === partnerName || (e.metadata as any)?.partner_name === partnerName).length,
      },
    };

    // ── Section 8: AI-anbefaling ─────────────────────────────────────────────
    let aiAnbefaling: string | null = null;
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey && totalDatapunkter >= 3) {
      try {
        const openai = new OpenAI({ apiKey });
        const dataForAI = [
          `Partner: ${partnerName}`,
          `Periode: siste ${periodDays} dager`,
          `Promoer totalt: ${logs.length} (Discord: ${discordLogs.length}, Twitch: ${twitchLogs.length})`,
          `Promoer i valgt periode: ${logsInP.length}`,
          `Forslag: ${proposals.length} totalt — ${godkjent} godkjent, ${avvist} avvist, ${venter} venter`,
          decided > 0 ? `Godkjennelsesrate: ${Math.round((godkjent / decided) * 100)}%` : null,
          decided > 0 ? `Avvisningsrate: ${Math.round((avvist / decided) * 100)}%` : null,
          `Streams med partneren: ${activeStreams.length}`,
          lastLog ? `Siste promo: ${new Date(lastLog.posted_at).toLocaleDateString('no-NO')} via ${lastLog.platform}` : 'Ingen promo registrert',
          lastCtx.score != null ? `Siste AI-score: ${Math.round(lastCtx.score * 100)}%` : null,
          lastCtx.reasonCode ? `Siste ReasonCode: ${lastCtx.reasonCode}` : null,
          creatorLearning.approvalPattern?.finding ?? null,
          creatorLearning.partnerPerformance?.finding ?? null,
          creatorLearning.besteTidspunkt ? `Beste tidspunkt: ${creatorLearning.besteTidspunkt.label} (${creatorLearning.besteTidspunkt.approvalRate}% godkjenning)` : null,
          creatorLearning.bestePlattform ? `Beste plattform: ${creatorLearning.bestePlattform.platform} (${creatorLearning.bestePlattform.percentage}% av promoer)` : null,
          ...historiskeMonstre,
        ].filter(Boolean).join('\n');

        const res = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{
            role: 'system',
            content: 'Norsk partnerrapport-assistent. Du formulerer anbefalinger basert utelukkende på tall og mønstre du mottar. Du finner ikke på statistikk. Du estimerer ikke. Hvis grunnlaget er svakt, si det. Profesjonell og konkret tone.',
          }, {
            role: 'user',
            content: `Basert på følgende dokumenterte historikk, skriv en kortfattet anbefaling (3-4 setninger) om denne partnerrelasjonen. Nevn kun tall som er gitt. Ikke legg til egne estimater.\n\n${dataForAI}`,
          }],
          max_tokens: 300,
          temperature: 0.5,
        });
        aiAnbefaling = res.choices[0]?.message?.content?.trim() ?? null;
      } catch { /* silent */ }
    }

    const report = {
      generertAt:    new Date().toISOString(),
      periode:       periodDays === 7 ? '7d' : '30d',
      partnerName,
      partnerAktiv:  partnerRow ? (partnerRow as any).aktiv : null,
      sammendrag: {
        totalePromoer:      logs.length,
        discord:            discordLogs.length,
        twitch:             twitchLogs.length,
        totaleForslag:      proposals.length,
        godkjent,
        avvist,
        venter,
        streamerMedPartner: activeStreams.length,
        sistePromo:         lastLog?.posted_at ?? null,
        sisteAiVurdering:   lastDec?.created_at ?? null,
      },
      partneroversikt: {
        dataStrength:   dataStyrke,
        promoer7d:      logsIn7d.length,
        promoer30d:     logsIn30d.length,
        promoerTotalt:  logs.length,
        discord:        discordLogs.length,
        twitch:         twitchLogs.length,
        sisteKanal:     lastLog?.channel ?? null,
        sistePromotert: lastLog?.posted_at ?? null,
        godkjentRate:   decided > 0 ? Math.round((godkjent / decided) * 100) : null,
        avvisningsrate: decided > 0 ? Math.round((avvist  / decided) * 100) : null,
        pending:        venter,
        aiScore:        lastCtx.score != null ? Math.round(lastCtx.score * 100) : null,
        sisteReasonCode: lastCtx.reasonCode ?? null,
        sisteTriggerType: lastCtx.triggerType ?? null,
        sisteOutcome:   lastDec?.outcome ?? null,
      },
      historisk,
      streamHistorikk,
      highlights: highlightSeksjon,
      creatorLearning,
      aiAnbefaling,
      datagrunnlag,
    };

    await logSystemEvent({
      source: 'sponsor_manager',
      event_type: 'SPONSOR_REPORT_COMPLETED',
      title: `Partnerrapport ferdig: ${partnerName}`,
      severity: 'info',
      metadata: { partnerName, periodDays, dataStyrke, totalDatapunkter, aiAnbefaling: !!aiAnbefaling },
    });

    return NextResponse.json(report) as unknown as Response;

  } catch (err: unknown) {
    await logSystemEvent({
      source: 'sponsor_manager',
      event_type: 'SPONSOR_REPORT_FAILED',
      title: `Partnerrapport feilet: ${partnerName}`,
      severity: 'warning',
      metadata: { partnerName, error: String(err).slice(0, 200) },
    });
    return NextResponse.json({ error: 'Rapport kunne ikke genereres' }, { status: 500 }) as unknown as Response;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('partner')) {
    return handlePartnerReport(request) as unknown as ReturnType<typeof NextResponse.json>;
  }

  try {
    const db = getDb();
    const wsId = getWorkspaceId();

    await logSystemEvent({
      source: 'sponsor_manager',
      event_type: 'SPONSOR_ANALYSIS_STARTED',
      title: 'Sponsor-analyse startet',
      severity: 'info',
      metadata: { workspaceId: wsId },
    });

    const [broadcasterId, guild, creatorCtx] = await Promise.all([
      getBroadcasterId(),
      getGuildInfo(),
      getCreatorContext().catch(() => null),
    ]);

    const cutoff90d = new Date(Date.now() - 90 * 24 * 3600_000).toISOString();

    const cutoff30d = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

    const [streamHistRes, vodsRes, highlightsRes, partnereRes, workspaceRes, followers, contentLogRes, proposalsRes] = await Promise.all([
      db?.from('stream_history').select('*').eq('workspace_id', wsId)
        .gte('started_at', cutoff90d).order('started_at', { ascending: false }).limit(90),
      db?.from('content_vods').select('id,status,created_at').eq('workspace_id', wsId)
        .order('created_at', { ascending: false }).limit(200),
      db?.from('content_highlights').select('id,clip_status,created_at')
        .order('created_at', { ascending: false }).limit(1000),
      db?.from('partners').select('navn,aktiv').eq('workspace_id', wsId),
      db?.from('workspaces').select('settings_json').eq('id', wsId).single(),
      broadcasterId
        ? getTwitchFollowers(broadcasterId).then(async f => f > 0 ? f : getCachedFollowers())
        : getCachedFollowers(),
      db?.from('partner_content_log')
        .select('partner_name, platform, posted_at')
        .eq('workspace_id', wsId)
        .gte('posted_at', cutoff90d)
        .order('posted_at', { ascending: false })
        .limit(300),
      db?.from('partner_proposals')
        .select('partner_name, status, created_at')
        .eq('workspace_id', wsId)
        .order('created_at', { ascending: false })
        .limit(300),
    ]);

    const history: any[] = streamHistRes?.data ?? [];
    const vods: any[] = vodsRes?.data ?? [];
    const highlights: any[] = highlightsRes?.data ?? [];
    const partnere: any[] = partnereRes?.data ?? [];
    const settingsJson = workspaceRes?.data?.settings_json ?? {};
    const discordMembers = guild?.approximate_member_count ?? 0;
    const contentLogs: any[] = contentLogRes?.data ?? [];
    const proposals: any[] = proposalsRes?.data ?? [];

    // ── Per-partner historikk (fra ekte data) ────────────────────────────────
    const cutoff30dStr = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const partnerNames = Array.from(new Set([
      ...partnere.map(p => p.navn),
      ...contentLogs.map(l => l.partner_name).filter(Boolean),
      ...proposals.map(p => p.partner_name).filter(Boolean),
    ]));

    const partnerHistorikk = partnerNames.map(navn => {
      const logs     = contentLogs.filter(l => l.partner_name === navn);
      const props    = proposals.filter(p => p.partner_name === navn);
      const logs30d  = logs.filter(l => l.posted_at >= cutoff30dStr);
      const approved = props.filter(p => p.status === 'approved' || p.status === 'sent').length;
      const rejected = props.filter(p => p.status === 'rejected').length;
      const decided  = approved + rejected;
      const godkjentRate = decided > 0 ? Math.round((approved / decided) * 100) : null;
      const total    = logs.length + props.length;
      const dataStyrke: 'god' | 'moderat' | 'svak' = total >= 10 ? 'god' : total >= 3 ? 'moderat' : 'svak';
      return {
        navn,
        promoer30d:   logs30d.length,
        promoerTotalt: logs.length,
        sisteSendt:   logs[0]?.posted_at ?? null,
        godkjentRate,
        avvisninger:  rejected,
        dataStyrke,
        aktiv:        partnere.find(p => p.navn === navn)?.aktiv ?? null,
      };
    }).filter(p => p.promoerTotalt > 0 || proposals.some(pr => pr.partner_name === p.navn));

    const partnerTotaler = {
      totalePromoer:  contentLogs.length,
      totaleForslag:  proposals.length,
      promoer30d:     contentLogs.filter(l => l.posted_at >= cutoff30dStr).length,
      godkjentRate:   (() => {
        const a = proposals.filter(p => p.status === 'approved' || p.status === 'sent').length;
        const r = proposals.filter(p => p.status === 'rejected').length;
        return (a + r) > 0 ? Math.round((a / (a + r)) * 100) : null;
      })(),
      mestAktiv: partnerHistorikk.sort((a, b) => b.promoerTotalt - a.promoerTotalt)[0]?.navn ?? null,
    };

    // ── Periode-metrics ───────────────────────────────────────────────────────
    const p7  = periodMetrics(history, 7);
    const p30 = periodMetrics(history, 30);
    const p90 = periodMetrics(history, 90);

    const cutoff7d = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

    const klipp7d  = highlights.filter(h => h.clip_status === 'CLIPPED' && h.created_at >= cutoff7d).length;
    const klipp30d = highlights.filter(h => h.clip_status === 'CLIPPED' && h.created_at >= cutoff30dStr).length;
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
- Partner-promoer sendt (90d): ${partnerTotaler.totalePromoer}, siste 30d: ${partnerTotaler.promoer30d}
- Totale forslag behandlet: ${partnerTotaler.totaleForslag}${partnerTotaler.godkjentRate !== null ? `, godkjennelsesrate: ${partnerTotaler.godkjentRate}%` : ''}
${partnerHistorikk.length > 0 ? `Partner-aktivitet:\n${partnerHistorikk.slice(0, 5).map(p => `  ${p.navn}: ${p.promoerTotalt} promoer totalt (${p.promoer30d} siste 30d)${p.godkjentRate !== null ? `, godkjent ${p.godkjentRate}%` : ''}`).join('\n')}` : ''}
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
      partnerHistorikk,
      partnerTotaler,
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
