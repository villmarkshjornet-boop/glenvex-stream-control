import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const BOT_AKTIVITET_EVENTS = [
  'PARTNER_PROMOTION_SENT_DISCORD',
  'PARTNER_PROMOTION_SENT_TWITCH',
  'PARTNER_PROMOTION_SKIPPED',
  'POLL_CREATED',
  'POLL_RESULT_COLLECTED',
  'POLL_SKIPPED',
];

export async function GET() {
  const wsId = getWorkspaceId();
  const db = getDb();
  if (!db) return NextResponse.json({
    sistVurdert: null, sistSendt: null, partnerEksponering: [], sisteDecisions: [], botAktivitet: [], sammendrag: null,
  });

  const since7d  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [vurdert, sendt, partners, decisions, aktivitet] = await Promise.all([
    db.from('system_events')
      .select('event_type, title, metadata, created_at')
      .eq('workspace_id', wsId)
      .in('event_type', ['PARTNER_PROMOTION_CONSIDERED', 'PARTNER_PROMOTION_SKIPPED'])
      .order('created_at', { ascending: false })
      .limit(1),

    // trackPartnerExposure skriver PARTNER_PROMOTION_SENT_DISCORD / _TWITCH
    db.from('system_events')
      .select('title, metadata, created_at, event_type')
      .eq('workspace_id', wsId)
      .in('event_type', ['PARTNER_PROMOTION_SENT_DISCORD', 'PARTNER_PROMOTION_SENT_TWITCH'])
      .order('created_at', { ascending: false })
      .limit(1),

    db.from('partners')
      .select('navn, siste_promotert, eksponering, featured, prioritet')
      .eq('workspace_id', wsId)
      .eq('aktiv', true)
      .order('eksponering', { ascending: false })
      .limit(10),

    db.from('ai_agent_decisions')
      .select('id, decision_summary, outcome, input_context, created_at')
      .eq('workspace_id', wsId)
      .eq('agent_type', 'partner_promotion')
      .gte('created_at', since7d)
      .order('created_at', { ascending: false })
      .limit(10),

    db.from('system_events')
      .select('event_type, title, metadata, created_at')
      .eq('workspace_id', wsId)
      .in('event_type', BOT_AKTIVITET_EVENTS)
      .gte('created_at', since30d)
      .order('created_at', { ascending: false })
      .limit(25),
  ]);

  const v = vurdert.data?.[0] ?? null;
  const s = sendt.data?.[0] ?? null;
  const partnerData = (partners.data ?? []);

  // Featured partner (featured=true or prioritet>=100) takes priority as the suggestion
  const featuredPartner = partnerData.find(p => p.featured || (p.prioritet ?? 0) >= 100) ?? null;
  const eldstPartner = featuredPartner ?? [...partnerData]
    .sort((a, b) => {
      if (!a.siste_promotert) return -1;
      if (!b.siste_promotert) return 1;
      return new Date(a.siste_promotert).getTime() - new Date(b.siste_promotert).getTime();
    })[0] ?? null;

  const dagSidenPromo = eldstPartner?.siste_promotert
    ? Math.floor((Date.now() - new Date(eldstPartner.siste_promotert).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const promoSendt  = (aktivitet.data ?? []).filter(e =>
    e.event_type === 'PARTNER_PROMOTION_SENT_DISCORD' || e.event_type === 'PARTNER_PROMOTION_SENT_TWITCH'
  );
  const promoHoppet = (aktivitet.data ?? []).filter(e => e.event_type === 'PARTNER_PROMOTION_SKIPPED').length;
  const pollData    = (aktivitet.data ?? []).filter(e => e.event_type === 'POLL_CREATED' || e.event_type === 'POLL_RESULT_COLLECTED');

  return NextResponse.json({
    sistVurdert: v ? {
      ts:          v.created_at,
      eventType:   v.event_type,
      reasonCode:  (v.metadata as any)?.reasonCode  ?? null,
      partnerName: (v.metadata as any)?.partnerName ?? null,
      score:       (v.metadata as any)?.score       ?? null,
      triggerType: (v.metadata as any)?.triggerType ?? null,
    } : null,

    sistSendt: s ? {
      ts:          s.created_at,
      partnerName: (s.metadata as any)?.partnerName ?? null,
      platform:    (s.metadata as any)?.platform    ?? null,
      sentDiscord: (s as any).event_type === 'PARTNER_PROMOTION_SENT_DISCORD',
      sentTwitch:  (s as any).event_type === 'PARTNER_PROMOTION_SENT_TWITCH',
    } : null,

    partnerEksponering: partnerData.map(p => ({
      navn:           p.navn,
      sistePromotert: p.siste_promotert ?? null,
      eksponering:    p.eksponering ?? 0,
    })),

    sisteDecisions: (decisions.data ?? []).map(d => ({
      id:              d.id,
      decisionSummary: d.decision_summary,
      outcome:         d.outcome,
      inputContext:    d.input_context,
      createdAt:       d.created_at,
    })),

    botAktivitet: (aktivitet.data ?? []).map(e => ({
      ts:       e.created_at,
      type:     e.event_type,
      tittel:   e.title,
      metadata: e.metadata ?? null,
    })),

    sammendrag: {
      promoSendt30d:    promoSendt.length,
      promoHoppet30d:   promoHoppet,
      sistePromoTs:     s?.created_at ?? null,
      dagSidenPromo,
      foreslåXFor:      eldstPartner?.navn ?? null,
      foreslåXAldri:    eldstPartner ? !eldstPartner.siste_promotert : false,
      pollOpprettet30d: pollData.filter(e => e.event_type === 'POLL_CREATED').length,
      pollResultater30d: pollData.filter(e => e.event_type === 'POLL_RESULT_COLLECTED').length,
    },
  });
}
