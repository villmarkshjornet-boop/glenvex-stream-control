'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Brain, Clock, Zap, ChevronRight, XCircle } from 'lucide-react';
import type { LiveData, SlowData, RaidTarget } from './types';
import { computeStreamPhase, type StreamPhaseResult } from '@/lib/streamPhase';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(startIso: string): string {
  const ms = Math.max(0, Date.now() - new Date(startIso).getTime());
  const h  = Math.floor(ms / 3_600_000);
  const m  = Math.floor((ms % 3_600_000) / 60_000);
  const s  = Math.floor((ms % 60_000) / 1_000);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function LiveTimer({ startIso }: { startIso: string }) {
  const [t, setT] = useState(() => formatDuration(startIso));
  useEffect(() => {
    const id = setInterval(() => setT(formatDuration(startIso)), 1_000);
    return () => clearInterval(id);
  }, [startIso]);
  return <span className="text-sm font-mono text-g-muted tabular-nums">{t}</span>;
}

function catHref(cat?: string): string {
  const map: Record<string, string> = {
    chat: '/', viewers: '/', promotion: '/partner-hub',
    raid: '/raid-manager', sponsor: '/partner-hub', content: '/content-factory-admin',
  };
  return map[cat ?? ''] ?? '/';
}

// ── CEO Brain: composite confidence from all known data ───────────────────────

interface ConfidenceBreakdown { label: string; value: string; active: boolean }

interface ConfidenceData {
  score: number;
  breakdown: ConfidenceBreakdown[];
}

function buildConfidence(live: LiveData): ConfidenceData {
  const decisions   = live.lærdom?.totalDatapunkter ?? 0;
  const insights    = live.nyesteInnsikter?.length ?? 0;
  const raids       = live.lærdom?.siste30dager?.raids ?? 0;
  const polls       = live.pollManager?.totalPollsThisStream ?? 0;
  const hasMemory   = !!live.aiLearning?.lastMemoryUpdate;
  const hasLiveAgent = (live.liveAgentTips?.length ?? 0) > 0;
  const hasViewerData = (live.lærdom?.totalDatapunkter ?? 0) > 0;

  const score = Math.min(99, Math.round(
    Math.min(35, decisions * 1.2) +
    Math.min(20, insights * 5)    +
    Math.min(15, raids * 3)       +
    Math.min(15, polls * 5)       +
    (hasMemory    ? 8 : 0)        +
    (hasLiveAgent ? 4 : 0)        +
    (hasViewerData ? 3 : 0)
  ));

  const breakdown: ConfidenceBreakdown[] = [
    { label: `${decisions} beslutninger`,      value: String(decisions), active: decisions > 0 },
    { label: `${insights} innsikter`,          value: String(insights),  active: insights > 0  },
    { label: `${raids} raids`,                 value: String(raids),     active: raids > 0     },
    { label: `${polls} polls denne streamen`,  value: String(polls),     active: polls > 0     },
    { label: 'AI Memory',                      value: '',                active: hasMemory     },
    { label: 'Live Agent aktiv',               value: '',                active: hasLiveAgent  },
    { label: 'Seertrender',                    value: '',                active: hasViewerData },
  ];

  return { score, breakdown };
}

// ── CEO Brain: prioritize across ALL signals and explain rejected alternatives ─

interface RejectedAlternativ { title: string; grunn: string }

interface CeoBrainResult {
  anbefaling: string;
  hvorfor: string | null;
  forventetEffekt: string | null;
  evaluering: string | null;
  href: string;
  kilde: string;
  category: string;
  avvistAlternativer: RejectedAlternativ[];
  dimensjonerVurdert: number;
  selfCorrectionNote: string | null;    // AI changed previous recommendation
  confidenceLevel: 'lav' | 'middels' | 'høy' | null;  // parsed from reasoning
  spillmønster: string | null;          // pattern from recentStreams
}

function rejectionReason(
  rejectedCat: string,
  chosenCat: string,
  elapsedMin: number,
): string {
  if (rejectedCat === 'sponsor' && (chosenCat === 'chat' || chosenCat === 'viewers')) {
    return 'Sponsoren har størst effekt når chatten er aktiv — prioriterer engasjement først';
  }
  if (rejectedCat === 'raid' && elapsedMin < 80) {
    return `For tidlig — raid anbefales mot slutten av streamen (nå ${Math.round(elapsedMin)} min)`;
  }
  if (rejectedCat === 'discord' && elapsedMin < 33) {
    return `Discord CTA er mest effektiv etter 35–45 min (nå ${Math.round(elapsedMin)} min)`;
  }
  if (rejectedCat === 'promotion' && chosenCat === 'chat') {
    return 'Promotering er mer effektiv når seerne er engasjert i chatten';
  }
  return 'Lavere prioritet enn valgt anbefaling akkurat nå';
}

function forventetEffekt(category: string): string {
  const map: Record<string, string> = {
    chat:      '+15–20 % chatrate de neste 3 minuttene',
    viewers:   'Stabiliserer seertallet og reduserer drop-off',
    promotion: '+15–25 % partnereksponering denne streamen',
    sponsor:   '+20 % produktklikk fra chatten',
    discord:   '+10–25 % flere Discord-invitasjoner klikket',
    raid:      'Positivt raidrykte — øker sannsynlighet for returraidS',
    content:   'Klipp klar for publisering på Discord og YouTube',
    general:   'Økt seerjengasjement',
  };
  return map[category] ?? 'Økt engasjement';
}

function evalueringFor(category: string): string {
  const map: Record<string, string> = {
    chat:      'Observer chatmeldinger per minutt de neste 3 minuttene',
    viewers:   'Sjekk om seertallet stabiliserer seg innen 5 minutter',
    promotion: 'Observer PARTNER_PROMO_SENT event i system_events',
    sponsor:   'Tell chatmeldinger som nevner produktet de neste 10 minuttene',
    discord:   'Sjekk Discord-vekstmetrikk etter streamen',
    raid:      'Se om den raidede streamer raider tilbake de neste 7 dagene',
    content:   'Sjekk at klippet er publisert og monitor klikkrate',
    general:   'Sammenlign stream-score med historisk gjennomsnitt',
  };
  return map[category] ?? 'Sammenlign med historisk data etter streamen';
}

// ── Derive game patterns from recentStreams ────────────────────────────────────

function deriveSpillmønster(live: LiveData, currentGame: string | null): string | null {
  const streams = live.recentStreams;
  if (!streams || streams.length < 3 || !currentGame) return null;

  const byGame: Record<string, { avgs: number[]; retentions: number[] }> = {};
  for (const s of streams) {
    if (!byGame[s.game]) byGame[s.game] = { avgs: [], retentions: [] };
    byGame[s.game].avgs.push(s.avgViewers);
    if (s.retentionPct) byGame[s.game].retentions.push(s.retentionPct);
  }

  const avgOf = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

  const bestRetention = Object.entries(byGame)
    .filter(([, v]) => v.retentions.length >= 2)
    .sort(([, a], [, b]) => avgOf(b.retentions) - avgOf(a.retentions))[0];

  const bestViewers = Object.entries(byGame)
    .filter(([, v]) => v.avgs.length >= 2)
    .sort(([, a], [, b]) => avgOf(b.avgs) - avgOf(a.avgs))[0];

  const parts: string[] = [];
  if (bestRetention && bestRetention[0] !== currentGame) {
    parts.push(`${bestRetention[0]} gir høyest retention (${avgOf(bestRetention[1].retentions)}%)`);
  } else if (bestRetention && bestRetention[0] === currentGame) {
    parts.push(`${currentGame} er ditt sterkeste spill for retention`);
  }
  if (bestViewers && bestViewers[0] !== bestRetention?.[0]) {
    parts.push(`${bestViewers[0]} gir flest seere (snitt ${avgOf(bestViewers[1].avgs)})`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

// ── Parse confidence level from reasoning text ─────────────────────────────────

function parseConfidenceLevel(reasoning: string | null | undefined): 'lav' | 'middels' | 'høy' | null {
  if (!reasoning) return null;
  const r = reasoning.toLowerCase();
  if (r.includes('confidence: lav') || r.includes('confidence lav')) return 'lav';
  if (r.includes('confidence: middels') || r.includes('confidence middels')) return 'middels';
  if (r.includes('confidence: høy') || r.includes('confidence høy')) return 'høy';
  return null;
}

// ── Detect self-correction from reasoning text ─────────────────────────────────

function detectSelfCorrection(reasoning: string | null | undefined): string | null {
  if (!reasoning) return null;
  const r = reasoning.toLowerCase();
  if (r.includes('negativ') && (r.includes('falt') || r.includes('endrer'))) {
    return 'AI endret anbefaling — forrige råd hadde ingen målbar positiv effekt';
  }
  if (r.includes('trekker tilbake') || r.includes('endrer anbefaling')) {
    return 'AI endret anbefaling basert på endret situasjon';
  }
  return null;
}

function buildCeoBrain(live: LiveData, elapsedMin: number): CeoBrainResult {
  // Collect all candidate signals ranked by importance
  const tips = [...(live.liveAgentTips ?? [])].sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50));
  const topTip = tips[0];

  // All actionCenter items as fallback candidates
  const liveAgentItems = (live.actionCenter ?? []).filter(a => a.type?.startsWith('live_agent'));
  const otherItems     = (live.actionCenter ?? []).filter(a => !a.type?.startsWith('live_agent') && a.type !== 'next_stream');

  // Total dimensions evaluated
  const allSignals = [...tips, ...liveAgentItems, ...otherItems];
  const dimensjonerVurdert = Math.min(9, Math.max(1, allSignals.length));

  const currentGame = live.systemEvents?.find(e => e.metadata?.game)?.metadata?.game ?? null;
  const spillmønster = deriveSpillmønster(live, currentGame);

  // Primary: best live agent tip
  if (topTip?.message) {
    const rejected: RejectedAlternativ[] = [];
    if (tips[1]?.message) {
      rejected.push({
        title: tips[1].message,
        grunn: rejectionReason(tips[1].category, topTip.category, elapsedMin),
      });
    }
    const urgentOther = otherItems.find(a => a.priority === 'error' || a.priority === 'warning');
    if (urgentOther) {
      rejected.push({ title: urgentOther.title, grunn: 'Live Agent-anbefaling prioriteres under aktiv stream' });
    }

    return {
      anbefaling:          topTip.message,
      hvorfor:             topTip.reasoning ?? null,
      forventetEffekt:     forventetEffekt(topTip.category),
      evaluering:          evalueringFor(topTip.category),
      href:                catHref(topTip.category),
      kilde:               'Live Agent V2',
      category:            topTip.category,
      avvistAlternativer:  rejected.slice(0, 2),
      dimensjonerVurdert,
      selfCorrectionNote:  detectSelfCorrection(topTip.reasoning),
      confidenceLevel:     parseConfidenceLevel(topTip.reasoning),
      spillmønster,
    };
  }

  // Fallback: first live_agent action center item
  const laItem = liveAgentItems[0];
  if (laItem) {
    const cat = laItem.type.replace('live_agent_', '');
    return {
      anbefaling:         laItem.title,
      hvorfor:            laItem.detail ?? null,
      forventetEffekt:    forventetEffekt(cat),
      evaluering:         evalueringFor(cat),
      href:               laItem.href,
      kilde:              'Action Center',
      category:           cat,
      avvistAlternativer: liveAgentItems.slice(1, 2).map(a => ({
        title: a.title,
        grunn: rejectionReason(a.type.replace('live_agent_', ''), cat, elapsedMin),
      })),
      dimensjonerVurdert,
      selfCorrectionNote: null,
      confidenceLevel:    null,
      spillmønster,
    };
  }

  // Fallback: newest AI insight
  const ins = live.nyesteInnsikter?.[0];
  if (ins) {
    return {
      anbefaling:         ins.title,
      hvorfor:            ins.summary,
      forventetEffekt:    'Basert på historisk AI-analyse',
      evaluering:         'Sammenlign stream-score med historisk gjennomsnitt etter streamen',
      href:               '/stream-coach',
      kilde:              'AI Memory',
      category:           'general',
      avvistAlternativer: [],
      dimensjonerVurdert: 1,
      selfCorrectionNote: null,
      confidenceLevel:    null,
      spillmønster,
    };
  }

  return {
    anbefaling:         'Alle systemer aktive — overvåker stream.',
    hvorfor:            null,
    forventetEffekt:    null,
    evaluering:         null,
    href:               '/',
    kilde:              '',
    category:           'general',
    avvistAlternativer: [],
    dimensjonerVurdert: 0,
    selfCorrectionNote: null,
    confidenceLevel:    null,
    spillmønster:       null,
  };
}

// ── Tidsplan ─────────────────────────────────────────────────────────────────

interface PlanItem { label: string; delta: number; href: string; ready: boolean }

const TIMING_TARGETS = [
  { label: 'Første chat-engasjement', min: 5,  href: '/'              },
  { label: 'Partner-nevnelse',        min: 20, href: '/partner-hub'   },
  { label: 'Poll om spillvalg',       min: 35, href: '/'              },
  { label: 'Discord CTA',            min: 40, href: '/'              },
  { label: 'Sponsor-nevnelse',       min: 60, href: '/partner-hub'   },
  { label: 'Raid-vurdering',         min: 90, href: '/raid-manager'  },
];

function buildPlan(startIso: string | null): PlanItem[] {
  if (!startIso) return [];
  const elapsedMin = (Date.now() - new Date(startIso).getTime()) / 60_000;
  return TIMING_TARGETS
    .map(p => ({ label: p.label, delta: Math.round(p.min - elapsedMin), href: p.href, ready: Math.abs(p.min - elapsedMin) <= 3 }))
    .filter(p => p.delta > -5)
    .slice(0, 6);
}

// ── Learning items ─────────────────────────────────────────────────────────────

function buildLearning(live: LiveData): string[] {
  return [
    ...(live.lærdom?.utførteTiltak?.slice(0, 2).map(t => t.summary) ?? []),
    ...(live.nyesteInnsikter?.slice(0, 2).map(i => i.summary || i.title) ?? []),
    ...(live.pollManager?.pollLearning ? [live.pollManager.pollLearning] : []),
  ].filter(Boolean).slice(0, 4) as string[];
}

// ── Mission Queue — dynamic task orchestration ────────────────────────────────
// CEO Brain asks one question each tick: "What is the biggest bottleneck right now?"
// The answer determines the entire queue — which changes per stream.

// Trigger times (minutes elapsed) — raid is phase-gated, not time-gated
const MISSION_TRIGGER_MIN: Record<string, number> = {
  x_post: 0, discord_post: 0, chat_cta: 5, poll: 15, sponsor: 20,
};
const MISSION_LABEL_MAP: Record<string, string> = {
  x_post: 'Post på X', discord_post: 'Post i Discord', chat_cta: 'Engasjer chatten',
  poll: 'Kjør poll', sponsor: 'Nevn sponsor', raid: 'Finn raid-kandidat',
};

type RaidTier     = 'tiny' | 'medium' | 'large' | 'massive';
type MissionPriority = 'kritisk' | 'høy' | 'normal';
type RaidCtx      = { tier: RaidTier | null; viewers: number; fromChannel: string | null };
type ViewerDrop   = { dropped: boolean; magnitude: number };

const PRIORITY_ORDER: Record<MissionPriority, number> = { kritisk: 0, høy: 1, normal: 2 };

function getRaidTier(viewers: number): RaidTier {
  if (viewers >= 500) return 'massive';
  if (viewers >= 100) return 'large';
  if (viewers >= 20)  return 'medium';
  return 'tiny';
}

interface StreamMission {
  id:              string;
  label:           string;
  context:         string;
  draftTitle?:     string;
  draftText?:      string;
  gevinst?:        string;   // expected gain if acted on
  kostnadVedSkip?: string;   // cost of skipping
  href:            string;
  done:            boolean;
  isManual:        boolean;
  priority:        MissionPriority;
}

interface DagensPlan {
  mulighet:         string | null;
  mulighetDetaljer: string[];   // concrete WHY points (e.g. "4x høyere chat")
  risiko:           string | null;
  risikoDetaljer:   string[];
  fokus:            string | null;
}

// Derives today's opportunity and risk from existing stream history + lærdom
function buildDagensPlan(live: LiveData, slow: SlowData): DagensPlan {
  const game          = slow.streamStatus.game;
  const recentStreams = live.recentStreams ?? [];
  const hour          = new Date().getHours();
  const isPrimeTime   = hour >= 19 && hour <= 23;

  const gameStreams  = game ? recentStreams.filter(s => s.game === game) : [];
  const hasGameData = gameStreams.length >= 2;

  const avgOf = (arr: number[]) =>
    arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

  const gameAvgRet    = avgOf(gameStreams.map(s => s.retentionPct));
  const gameAvgViewer = avgOf(gameStreams.map(s => s.avgViewers));
  const gameAvgScore  = avgOf(gameStreams.map(s => s.streamScore));
  const allAvgRet     = avgOf(recentStreams.map(s => s.retentionPct));
  const allAvgViewer  = avgOf(recentStreams.map(s => s.avgViewers));
  const allAvgScore   = avgOf(recentStreams.map(s => s.streamScore));
  const bestStream    = hasGameData
    ? gameStreams.reduce((b, s) => s.streamScore > b.streamScore ? s : b)
    : null;

  let mulighet: string | null = null;
  const mulighetDetaljer: string[] = [];
  let risiko: string | null = null;
  const risikoDetaljer: string[] = [];
  let fokus: string | null = null;

  if (hasGameData && game) {
    // Compare this game vs. overall average
    if (allAvgRet > 0 && gameAvgRet > allAvgRet + 5) {
      const pct = Math.round(((gameAvgRet / allAvgRet) - 1) * 100);
      mulighetDetaljer.push(`${pct}% høyere retention enn ditt snitt (${gameAvgRet}% vs ${allAvgRet}%)`);
    }
    if (allAvgViewer > 0 && gameAvgViewer > allAvgViewer * 1.1) {
      const pct = Math.round(((gameAvgViewer / allAvgViewer) - 1) * 100);
      mulighetDetaljer.push(`${pct}% fler seere enn ditt totale snitt (${gameAvgViewer} vs ${allAvgViewer})`);
    }
    if (allAvgScore > 0 && gameAvgScore > allAvgScore * 1.1) {
      const pct = Math.round(((gameAvgScore / allAvgScore) - 1) * 100);
      mulighetDetaljer.push(`${pct}% høyere stream-score enn normalt (${gameAvgScore} vs ${allAvgScore})`);
    }

    if (mulighetDetaljer.length > 0) {
      mulighet = `${game} er ditt sterkeste valg akkurat nå (${gameStreams.length} streams analysert)`;
    } else if (allAvgRet > 0 && gameAvgRet > 0 && gameAvgRet < allAvgRet - 10) {
      const pct = Math.round(((allAvgRet - gameAvgRet) / allAvgRet) * 100);
      risikoDetaljer.push(`${pct}% lavere retention enn ditt snitt (${gameAvgRet}% vs ${allAvgRet}%)`);
      if (allAvgViewer > 0 && gameAvgViewer < allAvgViewer * 0.85) {
        risikoDetaljer.push(`Færre seere enn normalt (${gameAvgViewer} vs ${allAvgViewer} i snitt)`);
      }
      risiko = `${game} har gitt svakere resultater i dine siste ${gameStreams.length} streams`;
    } else if (gameAvgRet >= 60) {
      mulighet = `${game} holder solid retention (${gameAvgRet}% snitt over ${gameStreams.length} streams)`;
    }
  }

  if (!mulighet && isPrimeTime) {
    mulighet = 'Primetime 19–23 — Twitch-oppdagbarheten er størst akkurat nå';
    mulighetDetaljer.push('Discovery og anbefalingsalgoritmen er mer aktiv sent på kveld');
  }

  const bestTiltak = live.lærdom?.utførteTiltak?.[0];
  if (bestTiltak) {
    fokus = bestTiltak.summary.slice(0, 90);
  } else if (bestStream?.grade === 'S' || bestStream?.grade === 'A') {
    fokus = `Beste ${game ?? ''}-stream scoret ${bestStream.streamScore} poeng — gjenta formelen`;
  }

  return { mulighet, mulighetDetaljer, risiko, risikoDetaljer, fokus };
}

// First-person executive producer voice — tells the streamer what matters most right now
function buildProducerNarrative(
  nextMission: StreamMission | null,
  raidCtx: RaidCtx,
  viewerDrop: ViewerDrop,
  elapsedMin: number,
  slow: SlowData,
): string {
  const viewers = slow.streamStatus.viewers ?? 0;
  const game    = slow.streamStatus.game ?? 'spillet';

  if (raidCtx.tier) {
    const { tier, viewers: rv, fromChannel } = raidCtx;
    const from = fromChannel ? ` fra ${fromChannel}` : '';
    if (tier === 'massive') {
      return `${rv} nye seere akkurat inn${from}. Ingenting annet betyr noe de neste 15 minuttene.\nPresenter deg. Aktiver chatten. Gi dem en grunn til å bli.`;
    }
    if (tier === 'large') {
      return `${rv} raid-seere nettopp inn${from}. Du har 2–3 minutter på å gjøre inntrykk — presenter deg og still dem et spørsmål.`;
    }
    if (tier === 'medium') {
      return `Du fikk raid${rv ? ` med ${rv} seere` : ''}${from} — presenter deg raskt og nevn Discord mens de fortsatt er nysgjerrige.`;
    }
    return `Liten raid${from} inn — en rask takk er alt som trengs. Ikke avbryt flyten.`;
  }

  if (viewerDrop.dropped && viewerDrop.magnitude >= 5) {
    return `Seertallet falt med ${viewerDrop.magnitude}. Hold de som er igjen.\nEn poll eller et direkte spørsmål er det raskeste grepet du har.`;
  }

  if (elapsedMin < 2) {
    return `Streamen startet nettopp. Annonser på X og Discord. Ingen promotering ennå — chat-aktivering først.`;
  }
  if (nextMission?.priority === 'kritisk') {
    return `${nextMission.label} er forsinket. Det er det viktigste akkurat nå — alt annet venter.`;
  }
  if (nextMission?.id === 'x_post') {
    return `Du er live men ikke annonsert på X. Det tar 20 sekunder og kan gi ${viewers < 50 ? '3–7' : '5–15'} ekstra seere.`;
  }
  if (nextMission?.id === 'discord_post') {
    return `Discord-følgerne vet ikke at du er live. Annonseringen tar 10 sekunder og aktiverer fellesskapet.`;
  }
  if (nextMission?.id === 'chat_cta') {
    return `${Math.round(elapsedMin)} minutter inn og chatten er stille. Et enkelt spørsmål kan doble chataktiviteten på 60 sekunder.`;
  }
  if (nextMission?.id === 'poll') {
    return `Nå er godt tidspunkt for en poll. Det aktiverer seere som ikke har skrevet noe og sender et signal til Twitch-algoritmen.`;
  }
  if (nextMission?.id === 'sponsor') {
    return `Chatten er varm og du er godt i gang — nå kan du nevne en partner uten at det virker påtrengende.`;
  }
  if (nextMission?.id === 'raid') {
    return `Begynn å tenke på hvem du raider. Et godt valg nå gir bedre matcher — de beste kanalene raidet tidlig.`;
  }
  if (!nextMission) {
    return `Alle oppdrag gjort. Hold energien oppe — AI overvåker og varsler hvis noe endrer seg.`;
  }
  return `${viewers} seere. ${game} i gang. Fokus: ${nextMission.label.toLowerCase()}.`;
}

function buildMissionQueue(
  live: LiveData,
  slow: SlowData,
  elapsedMin: number,
  doneManual: Set<string>,
  viewerDrop: ViewerDrop,
  raidCtx: RaidCtx,
  streamPhase: StreamPhaseResult,
): StreamMission[] {
  const tips   = live.liveAgentTips ?? [];
  const hasCat = (cat: string) => tips.some(t => t.category === cat);

  const game  = slow.streamStatus.game  ?? 'stream';
  const title = slow.streamStatus.title ?? 'Vi er live!';
  const thumb = slow.streamStatus.thumbnailUrl ?? '';
  const login = thumb.match(/live_user_(\w+)-/)?.[1] ?? 'glenvex';
  const url   = `twitch.tv/${login}`;

  // ── RAID MODE — raidCtx is computed from systemEvents in the component ────────
  // The entire queue flips to raid-response missions when a raid is active.
  if (raidCtx.tier) {
    const { tier, viewers: rv, fromChannel } = raidCtx;
    const from        = fromChannel ? `, ${fromChannel}` : '';
    const followerMin = rv ? Math.round(rv * 0.07) : 3;
    const followerMax = rv ? Math.round(rv * 0.20) : 15;

    if (tier === 'tiny') {
      return [{
        id: 'raid_thank', label: 'Takk for raidet',
        context: `Liten raid${from} — en kort takk er alt som trengs`,
        draftTitle: 'Si i chatten:', draftText: `Tusen takk for raiden${from}! Velkommen alle nye! 🙏`,
        gevinst: '1–3 nye followers',
        href: '/', done: doneManual.has('raid_thank'), isManual: true, priority: 'normal',
      }];
    }

    if (tier === 'medium') {
      return [
        {
          id: 'raid_intro', label: 'Presenter deg',
          context: `Raid${from} med ${rv || '?'} seere — de vet ikke hvem du er ennå`,
          draftTitle: 'Si nå:', draftText: `Hei alle nye! Jeg heter ${login} og streamer ${game}. Takk for raiden${from}! Join gjerne Discord!`,
          gevinst: `+${followerMin}–${followerMax} followers`,
          kostnadVedSkip: 'Raid-seere uten velkomst forsvinner innen 90 sekunder',
          href: '/', done: doneManual.has('raid_intro'), isManual: true, priority: 'høy',
        },
        {
          id: 'raid_chat_q', label: 'Aktiver raid-chatten',
          context: 'Still dem et spørsmål de kan svare på',
          draftTitle: 'Forslag:', draftText: `Hvem er her for første gang? Hva spiller dere ellers til vanlig?`,
          gevinst: 'Raid-seere som skriver forblir 4x lenger',
          href: '/', done: doneManual.has('raid_chat_q'), isManual: true, priority: 'høy',
        },
        {
          id: 'raid_discord_cta', label: 'Discord CTA',
          context: 'Raid-seere konverterer best til Discord tidlig',
          draftTitle: 'Si:', draftText: `Discord-link er i panelet → bli en del av fellesskapet!`,
          gevinst: '3–8 nye Discord-medlemmer',
          href: '/', done: doneManual.has('raid_discord_cta'), isManual: true, priority: 'høy',
        },
      ];
    }

    if (tier === 'large') {
      return [
        {
          id: 'raid_intro', label: 'Presenter deg for raid-seerne',
          context: `${rv} seere nettopp inn${from} — de avgjør om de følger deg innen 3 minutter`,
          draftTitle: 'Si dette nå:',
          draftText: `Hei alle! Jeg heter ${login}. Jeg streamer ${game} og dette er fellesskapet mitt. Takk for raiden${from}! Discord-link er i panelet.`,
          gevinst: `+${followerMin}–${followerMax} followers`,
          kostnadVedSkip: 'Uten presentasjon mister du 80% av raid-seerne innen 2 minutter',
          href: '/', done: doneManual.has('raid_intro'), isManual: true, priority: 'kritisk',
        },
        {
          id: 'raid_chat_q', label: 'Aktiver raid-chatten med et spørsmål',
          context: 'Nye seere er nysgjerrige — gi dem noe å svare på',
          draftTitle: 'Forslag:', draftText: `Hvem er her for første gang? Og hva spiller dere ellers?`,
          gevinst: 'Raid-seere som deltar forblir 4x lenger',
          kostnadVedSkip: 'Passiv raid-chat forlater innen 90 sekunder',
          href: '/', done: doneManual.has('raid_chat_q'), isManual: true, priority: 'kritisk',
        },
        {
          id: 'raid_discord_cta', label: 'Discord CTA',
          context: 'Stor raid er det beste tidspunktet for Discord-rekruttering',
          draftTitle: 'Si:', draftText: `Hei nye! Discord-link er i panelet → bli en del av fellesskapet!`,
          gevinst: '5–20 nye Discord-medlemmer',
          href: '/', done: doneManual.has('raid_discord_cta'), isManual: true, priority: 'høy',
        },
        {
          id: 'raid_follow_cta', label: 'Follow CTA',
          context: 'Raid-seere konverterer best til følgere de første 3 minuttene',
          draftTitle: 'Si:', draftText: `Liker dere det dere ser? Trykk gjerne Follow — det er det som hjelper kanalen vokse!`,
          gevinst: `+${Math.round(rv * 0.05)}–${Math.round(rv * 0.12)} ekstra followers`,
          href: '/', done: doneManual.has('raid_follow_cta'), isManual: true, priority: 'høy',
        },
        {
          id: 'raid_stream_plan', label: 'Fortell streamplanen',
          context: 'Nye seere vil vite hva som skjer videre',
          draftTitle: 'Si:', draftText: `Vi har streamt ${game} i ${Math.round(elapsedMin)} minutter og har god tid igjen. Bli med!`,
          gevinst: 'Lavere drop-off når seere vet hva som kommer',
          href: '/', done: doneManual.has('raid_stream_plan'), isManual: true, priority: 'høy',
        },
        {
          id: 'raid_no_sponsor', label: 'Vent med sponsor-nevnelse',
          context: 'Nye seere trenger å bli kjent med deg — sponsor tidlig virker salgsorientert',
          kostnadVedSkip: 'Sponsor i raid-vinduet kan halvere follow-konverteringen',
          href: '/', done: doneManual.has('raid_no_sponsor'), isManual: true, priority: 'høy',
        },
      ];
    }

    // Massive (500+) — lock everything, 7 strict missions, 15-minute window
    return [
      {
        id: 'raid_intro', label: 'Presenter deg — alt annet pauses nå',
        context: `🚨 ${rv} seere nettopp inn${from}. Dette er sjeldent. Alt annet stopper.`,
        draftTitle: 'Si dette nå:',
        draftText: `Hei! Jeg heter ${login}. Wow — dette er utrolig.\n\nJeg streamer ${game} og dette er fellesskapet mitt. Takk${from ? from : ' for raiden'}! 🙏\nBli gjerne med — Discord-link er i panelet!`,
        gevinst: `+${followerMin}–${followerMax} followers (massiv konverteringsmulighet)`,
        kostnadVedSkip: 'Massivt raid uten presentasjon er en tapt vekstmulighet',
        href: '/', done: doneManual.has('raid_intro'), isManual: true, priority: 'kritisk',
      },
      {
        id: 'raid_explain', label: 'Forklar hva som skjer på stream',
        context: 'De fleste er nye — de vet ikke hvem du er eller hva de ser på',
        draftTitle: 'Si:', draftText: `Jeg driver en norsk gaming-kanal. I dag streamer vi ${game}. Vi er et hyggelig fellesskap og alle er velkomne!`,
        gevinst: 'Kontekst holder nye seere 2x lenger',
        href: '/', done: doneManual.has('raid_explain'), isManual: true, priority: 'kritisk',
      },
      {
        id: 'raid_thank', label: `Takk ${fromChannel ?? 'raideren'} direkte`,
        context: 'En personlig takk til raideren er god stream-etikette',
        draftTitle: 'Si:', draftText: `Tusen takk ${fromChannel ?? 'for raiden'}! Dette betyr enormt — masse kjærlighet! 🙏`,
        href: '/', done: doneManual.has('raid_thank'), isManual: true, priority: 'kritisk',
      },
      {
        id: 'raid_chat_q', label: 'Chat-spørsmål — engasjer alle nye',
        context: 'Du har hundrevis av øyne på deg — aktiver dem nå',
        draftTitle: 'Si:', draftText: `Hvem er her for første gang? Og hvem var her allerede fra før? Si hei i chatten!`,
        gevinst: 'Raid-seere som deltar forblir 4x lenger',
        kostnadVedSkip: 'Passiv chat driver bort nye seere innen 2 minutter',
        href: '/', done: doneManual.has('raid_chat_q'), isManual: true, priority: 'kritisk',
      },
      {
        id: 'raid_discord_cta', label: 'Discord CTA',
        context: 'Massivt raid = det beste tidspunktet du har for Discord-rekruttering',
        draftTitle: 'Si:', draftText: `Bli en del av fellesskapet — Discord-link er i panelet! Gratis og aktivt.`,
        gevinst: '20–60 nye Discord-medlemmer mulig',
        href: '/', done: doneManual.has('raid_discord_cta'), isManual: true, priority: 'høy',
      },
      {
        id: 'raid_follow_cta', label: 'Follow CTA',
        context: 'Be dem følge — de er her nå og er mottakelige',
        draftTitle: 'Si:', draftText: `Liker dere det dere ser? Trykk Follow — det hjelper kanalen enormt!`,
        gevinst: `${followerMin}–${followerMax} followers forventet`,
        href: '/', done: doneManual.has('raid_follow_cta'), isManual: true, priority: 'høy',
      },
      {
        id: 'raid_no_sponsor', label: 'INGEN sponsor de neste 15 minuttene',
        context: 'Nye seere forlater ved kommersiell følelse — bygg tillit først',
        kostnadVedSkip: 'Sponsor i massiv-raid-vinduet kan halvere follow-konverteringen',
        href: '/', done: doneManual.has('raid_no_sponsor'), isManual: true, priority: 'høy',
      },
    ];
  }

  // ── NORMAL MISSION QUEUE ─────────────────────────────────────────────────────

  const discordKS = live.kontrollsenter?.find(
    k => k.key.toLowerCase().includes('discord') || k.label.toLowerCase().includes('discord'),
  );
  const discordAutoDetected = discordKS?.sisteKjøring
    ? Date.now() - new Date(discordKS.sisteKjøring).getTime() < 45 * 60_000
    : false;

  const pollsDone    = (live.pollManager?.totalPollsThisStream ?? 0) > 0;
  const sponsorDone  = hasCat('sponsor');
  const raidPlanDone = hasCat('raid');

  // Poll priority escalates to kritisk when viewers drop
  const pollPriority: MissionPriority = pollsDone ? 'normal'
    : (viewerDrop.dropped && viewerDrop.magnitude >= 5) ? 'kritisk'
    : elapsedMin > 35 ? 'høy'
    : 'normal';

  const all: StreamMission[] = [
    {
      id: 'x_post', label: 'Post på X',
      context: elapsedMin > 15
        ? `Streamen startet for ${Math.round(elapsedMin)} min siden — X-post er forsinket`
        : 'Streamen er ikke annonsert på X ennå',
      draftTitle: 'Klar til posting:',
      draftText: `Vi er LIVE! 🔴\n\n${title}\n🎮 ${game}\n\n${url}`,
      gevinst: '3–7 ekstra seere fra X-følgere',
      kostnadVedSkip: 'X-følgerne dine vet ikke at du er live — du mister dem i dag',
      href: '/', done: doneManual.has('x_post'), isManual: true,
      priority: elapsedMin > 15 ? 'kritisk' : 'høy',
    },
    {
      id: 'discord_post', label: 'Post i Discord',
      context: discordAutoDetected
        ? 'Discord-bot kjørte nettopp — annonseringen er i gang'
        : elapsedMin > 10
          ? 'Discord-annonsering er forsinket — seerne venter'
          : 'Discord-annonsering ikke sendt ennå',
      draftTitle: !discordAutoDetected ? 'Klar til posting:' : undefined,
      draftText:  !discordAutoDetected
        ? `@everyone Vi er LIVE! 🔴\n\n${title}\n🎮 ${game}\n\n→ ${url}`
        : undefined,
      gevinst: '5–15 Discord-følgere inn i chatten',
      kostnadVedSkip: discordAutoDetected ? undefined : 'Discord-seerne begynner å se på noe annet',
      href: '/', done: doneManual.has('discord_post') || discordAutoDetected, isManual: !discordAutoDetected,
      priority: discordAutoDetected ? 'normal' : elapsedMin > 10 ? 'kritisk' : 'høy',
    },
    {
      id: 'chat_cta', label: 'Engasjer chatten',
      context: elapsedMin > 20
        ? 'Chatten er fortsatt ikke aktivert — lurkers begynner å forlate'
        : 'Still chatten et personlig spørsmål — aktiver lurkers',
      draftTitle: 'Forslag til spørsmål:',
      draftText: `Hvem er her for første gang i dag? ${game !== 'stream' ? `Hva synes dere om ${game}?` : 'Hva vil dere se mer av?'}`,
      gevinst: 'Økt chatrate og lurker-aktivering',
      kostnadVedSkip: 'Lurkers forlater passiv chat etter 7–10 minutter',
      href: '/', done: doneManual.has('chat_cta'), isManual: true,
      priority: elapsedMin > 20 ? 'kritisk' : elapsedMin > 10 ? 'høy' : 'normal',
    },
    {
      id: 'poll', label: 'Kjør en poll',
      context: pollsDone
        ? `Poll kjørt (${live.pollManager?.totalPollsThisStream} totalt)`
        : (viewerDrop.dropped && viewerDrop.magnitude >= 5)
          ? `Seertallet falt med ${viewerDrop.magnitude} — en poll kan reaktivere chatten`
          : elapsedMin > 35 ? 'Poll er forsinket — bra tidspunkt nå' : 'Godt tidspunkt for en poll',
      draftTitle: !pollsDone ? 'Forslag til poll-spørsmål:' : undefined,
      draftText:  !pollsDone
        ? (game !== 'stream' ? `Hva skal vi gjøre neste i ${game}?` : 'Hva vil dere se mer av i dag?')
        : undefined,
      gevinst: 'Økt engagement og Twitch-algoritmesignal',
      kostnadVedSkip: pollsDone ? undefined : 'Chat kjøler seg ned uten aktivitet',
      href: '/poll-manager', done: pollsDone, isManual: true, priority: pollPriority,
    },
    {
      id: 'sponsor', label: 'Nevn sponsor/partner',
      context: sponsorDone
        ? 'Sponsor nevnt av Live Agent'
        : 'Chatten er varm nok — greit å nevne partner nå',
      gevinst: 'Partnereksponering uten å virke salgsorientert',
      kostnadVedSkip: sponsorDone ? undefined : 'Sene sponsor-nevnelser oppfattes som mer desperat',
      href: '/partner-hub', done: doneManual.has('sponsor') || sponsorDone, isManual: !sponsorDone,
      priority: 'normal',
    },
    ...(streamPhase.raidAllowed ? [{
      id: 'raid', label: streamPhase.phase === 'WRAP_UP' ? 'Utfør raid NÅ' : 'Finn raid-kandidat',
      context: raidPlanDone
        ? 'Raid-analyse kjørt av Live Agent'
        : streamPhase.phase === 'WRAP_UP'
          ? 'Du er i avslutningsfasen — velg raid-mål og utfør'
          : 'Begynn å planlegge hvem du raider',
      gevinst: 'Godt raid bygger nettverk og kan gi follow-backs',
      kostnadVedSkip: raidPlanDone ? undefined : streamPhase.phase === 'WRAP_UP' ? 'Raid-vinduet lukker seg snart' : 'Sene raid-planer gir dårlige kandidater',
      href: '/raid-manager', done: doneManual.has('raid') || raidPlanDone, isManual: !raidPlanDone,
      priority: streamPhase.phase === 'WRAP_UP' ? 'kritisk' as MissionPriority : 'normal' as MissionPriority,
    }] : []),
  ];

  return all
    .filter(m => elapsedMin >= (MISSION_TRIGGER_MIN[m.id] ?? 0))
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    });
}

// ── Raid NOW — injected into queue when raid candidates are ready near stream end ─

function buildRaidNowMission(
  targets: RaidTarget[],
  elapsedMin: number,
  raidCtx: RaidCtx,
  doneManual: Set<string>,
  streamPhase: StreamPhaseResult,
): StreamMission | null {
  // Only inject when: raid is phase-allowed, candidates exist, no incoming raid active
  if (targets.length === 0 || !streamPhase.raidAllowed || raidCtx.tier || doneManual.has('raid_now')) return null;
  const top = targets[0];
  if (!top) return null;
  const expectedFollowers = Math.round((top.viewers ?? 0) * 0.10);
  const expectedDiscord   = Math.round((top.viewers ?? 0) * 0.06);
  return {
    id:              'raid_now',
    label:           `Raid nå: ${top.username}`,
    context:         `${top.viewers} seere, ${top.game}${top.grunn ? ` — ${top.grunn}` : ''}`,
    gevinst:         `~+${expectedFollowers} followers · +${expectedDiscord} Discord-konverteringer`,
    kostnadVedSkip:  'Raid-vinduet lukker seg — disse kanalene raidet snart noen andre',
    href:            top.url,
    done:            false,
    isManual:        true,
    priority:        'høy' as MissionPriority,
  };
}

// ── Main component ─────────────────────────────────────────────────────────────

export function LiveCommandCenter({ live, slow }: { live: LiveData; slow: SlowData }) {
  const [doneManual, setDoneManual]     = useState<Set<string>>(new Set());
  const [copied, setCopied]             = useState<string | null>(null);
  const [raidTargets, setRaidTargets]   = useState<RaidTarget[]>([]);
  const [pollQueued, setPollQueued]     = useState(false);
  const [pollError, setPollError]       = useState<string | null>(null);
  const [sponsorQueued, setSponsorQueued] = useState(false);
  const [sponsorError, setSponsorError]   = useState<string | null>(null);
  const missionStateLoadedRef           = useRef(false);

  // Viewer drop tracking across renders (refs don't trigger re-render)
  const prevViewersRef = useRef<number | null>(null);
  const viewerDropRef  = useRef<ViewerDrop>({ dropped: false, magnitude: 0 });

  const status   = slow.streamStatus;
  // startIso: prefer bot's LIVE_DETECTED event (authoritative), fall back to Twitch API startedAt.
  // Without a fallback, the plan stays stuck on "Beregner tidsplan…" if the bot is offline.
  const startIso =
    live.systemEvents?.find(e =>
      e.event_type === 'LIVE_AGENT_STARTED' || e.event_type === 'LIVE_DETECTED'
    )?.created_at
    ?? (slow.streamStatus.isLive ? slow.streamStatus.startedAt ?? null : null);
  const elapsedMin = startIso ? (Date.now() - new Date(startIso).getTime()) / 60_000 : 0;

  // Phase — uses historical avg duration from recent streams (data-driven, not if(min>60))
  const recentStreams    = live.recentStreams ?? [];
  const durationsAbove10 = recentStreams.map(s => s.durationMinutes).filter(d => d > 10);
  const avgHistoricalMin = durationsAbove10.length > 0
    ? Math.round(durationsAbove10.reduce((a, b) => a + b, 0) / durationsAbove10.length)
    : 0;
  const streamPhase = computeStreamPhase(elapsedMin, avgHistoricalMin);

  // Detect 18%+ viewer drop; reset when viewers recover
  useEffect(() => {
    const current = slow.streamStatus.viewers ?? 0;
    if (prevViewersRef.current !== null && current > 10) {
      const prev = prevViewersRef.current;
      const drop = prev - current;
      if (drop > 0 && drop / prev >= 0.18) {
        viewerDropRef.current = { dropped: true, magnitude: drop };
      } else if (current > prev) {
        viewerDropRef.current = { dropped: false, magnitude: 0 };
      }
    }
    prevViewersRef.current = slow.streamStatus.viewers ?? 0;
  }, [slow.streamStatus.viewers]);

  // Mission state load: DB is source of truth, localStorage is optimistic cache.
  // Key uses full startIso (not date-only) to avoid same-day stream collisions.
  useEffect(() => {
    if (!startIso || missionStateLoadedRef.current) return;
    missionStateLoadedRef.current = true;
    // Safe localStorage key: replace colons and dots to avoid encoding issues
    const lsKey = `gmq_${startIso.replace(/[:.]/g, '-')}`;

    // Step 1: Apply localStorage immediately — instant optimistic UI
    let localIds: string[] = [];
    try {
      const raw = localStorage.getItem(lsKey);
      if (raw) {
        localIds = JSON.parse(raw) as string[];
        if (localIds.length > 0) setDoneManual(new Set(localIds));
      }
    } catch {}

    // Step 2: Always fetch DB (source of truth). DB wins; local additions are kept.
    fetch(`/api/missions/state?startIso=${encodeURIComponent(startIso)}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { completed: string[] } | null) => {
        const dbIds = d?.completed ?? [];
        // DB-completed missions are authoritative; keep optimistic local additions too
        const merged = Array.from(new Set([...dbIds, ...localIds]));
        try { localStorage.setItem(lsKey, JSON.stringify(merged)); } catch {}
        setDoneManual(new Set(merged));
      })
      .catch(() => {});
  }, [startIso]);

  // Auto-fetch raid targets near stream end (lazy start, 5-min refresh)
  useEffect(() => {
    const load = () => {
      const elapsed = startIso ? (Date.now() - new Date(startIso).getTime()) / 60_000 : 0;
      if (elapsed < 65) return;
      fetch('/api/raid-targets')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.targets?.length) setRaidTargets(d.targets); })
        .catch(() => {});
    };
    const id = setInterval(load, 5 * 60_000);
    load();
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Raid context — computed from live systemEvents (single source of truth for all modules)
  const raidEvent = live.systemEvents?.find(e =>
    e.event_type === 'TWITCH_RAID_RECEIVED' ||
    e.event_type === 'RAID_RECEIVED' ||
    (e.event_type.toLowerCase().includes('raid') && e.severity !== 'info'),
  );
  const raidEventViewers = raidEvent?.metadata?.viewers ?? raidEvent?.metadata?.raidSize ?? 0;
  const raidFromChannel  = raidEvent?.metadata?.fromChannel ?? raidEvent?.metadata?.raider ?? null;
  const raidAgeMin       = raidEvent
    ? (Date.now() - new Date(raidEvent.created_at).getTime()) / 60_000
    : null;
  const raidTierRaw = raidEventViewers > 0 ? getRaidTier(raidEventViewers) : null;
  const RAID_WINDOW: Record<RaidTier, number> = { tiny: 10, medium: 15, large: 20, massive: 25 };
  const raidCtx: RaidCtx = {
    tier:        raidTierRaw && raidAgeMin !== null && raidAgeMin < RAID_WINDOW[raidTierRaw] ? raidTierRaw : null,
    viewers:     raidEventViewers,
    fromChannel: raidFromChannel,
  };

  const baseMissions    = buildMissionQueue(live, slow, elapsedMin, doneManual, viewerDropRef.current, raidCtx, streamPhase);
  const raidNowMission  = buildRaidNowMission(raidTargets, elapsedMin, raidCtx, doneManual, streamPhase);
  // Inject Raid NOW at front; suppress the generic "Finn raid-kandidat" when it's active
  const missions        = raidNowMission
    ? [raidNowMission, ...baseMissions.filter(m => m.id !== 'raid')]
    : baseMissions;
  const nextMission  = missions.find(m => !m.done) ?? null;
  const doneMissions = missions.filter(m => m.done);
  const dagensPlan   = buildDagensPlan(live, slow);
  const narrative    = buildProducerNarrative(nextMission, raidCtx, viewerDropRef.current, elapsedMin, slow);

  // Upcoming missions — not yet triggered, shown in "Neste" forward timeline
  const raidUpcoming = !streamPhase.raidAllowed && !doneManual.has('raid') && !raidCtx.tier
    ? [{ id: 'raid', label: 'Finn raid-kandidat', minutesAway: Math.round(streamPhase.raidUnlocksAtMin - elapsedMin) }]
    : [];
  const upcomingMissions = [
    ...Object.entries(MISSION_TRIGGER_MIN)
      .filter(([id, min]) => elapsedMin < min && !doneManual.has(id) && !raidCtx.tier)
      .map(([id, min]) => ({ id, label: MISSION_LABEL_MAP[id] ?? id, minutesAway: Math.round(min - elapsedMin) })),
    ...raidUpcoming,
  ]
    .sort((a, b) => a.minutesAway - b.minutesAway)
    .slice(0, 3);

  const markDone = (id: string, label?: string) => {
    setDoneManual(prev => {
      const n = new Set(prev);
      n.add(id);
      // Persist to localStorage (optimistic cache, same key as load effect)
      if (startIso) {
        try {
          const lsKey = `gmq_${startIso.replace(/[:.]/g, '-')}`;
          const existing: string[] = JSON.parse(localStorage.getItem(lsKey) ?? '[]');
          if (!existing.includes(id)) localStorage.setItem(lsKey, JSON.stringify([...existing, id]));
        } catch {}
      }
      return n;
    });
    // Async DB write — fire and forget, non-blocking
    if (startIso) {
      fetch('/api/missions/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missionId: id, label, startIso }),
      }).catch(() => {});
    }
  };

  const startPoll = async (question: string, options: string[]) => {
    setPollQueued(true);
    setPollError(null);
    try {
      const res = await fetch('/api/polls/start', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ question, options }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setPollError(d.error ?? `HTTP ${res.status}`);
        setPollQueued(false);
      }
    } catch {
      setPollError('bot_offline');
      setPollQueued(false);
    }
  };

  const promoteSponsor = async () => {
    setSponsorQueued(true);
    setSponsorError(null);
    try {
      const res = await fetch('/api/partners/promote', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ channel: 'both' }),
      });
      if (res.ok) {
        markDone('sponsor', 'Nevn sponsor/partner');
      } else {
        const d = await res.json().catch(() => ({})) as { errors?: string[]; error?: string };
        setSponsorError((d.errors?.[0] ?? d.error) ?? `HTTP ${res.status}`);
        setSponsorQueued(false);
      }
    } catch {
      setSponsorError('bot_offline');
      setSponsorQueued(false);
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {}
  };

  const brain      = buildCeoBrain(live, elapsedMin);
  const confidence = buildConfidence(live);
  const plan       = buildPlan(startIso);
  const learning   = buildLearning(live);
  const pollMgr    = live.pollManager;

  const systemer     = live.kontrollsenter ?? [];
  const activeCount  = systemer.filter(s => s.status === 'ok').length;
  const errorSystems = systemer.filter(s => s.status === 'feil');

  // Actions: skip the tip already shown in CEO Brain, skip next_stream
  const usedType = brain.kilde === 'Live Agent V2' && live.liveAgentTips?.[0]
    ? `live_agent_${live.liveAgentTips[0].category}` : null;
  const actions = (live.actionCenter ?? [])
    .filter(a => !(usedType && a.type === usedType) && a.type !== 'next_stream')
    .slice(0, 5);

  const PRIORITY_DOT: Record<string, string> = {
    error: 'text-red-400', warning: 'text-yellow-400', action: 'text-g-green',
  };

  return (
    <div className="space-y-4">

      {/* ── Stream header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between bg-g-card border border-red-500/30 rounded-2xl px-5 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex items-center gap-2 flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            <span className="text-sm font-black text-red-400 tracking-widest">LIVE</span>
          </span>
          {status.game  && <span className="text-sm font-bold text-g-text flex-shrink-0">{status.game}</span>}
          {status.title && <span className="text-sm text-g-muted truncate hidden sm:block">{status.title}</span>}
        </div>
        <div className="flex items-center gap-4 flex-shrink-0">
          <span className="text-sm font-bold text-g-text">{status.viewers} seere</span>
          {startIso && <LiveTimer startIso={startIso} />}
        </div>
      </div>

      {/* ── Stream Phase Badge ───────────────────────────────────────────────── */}
      {startIso && <StreamPhaseBadge phase={streamPhase} elapsedMin={elapsedMin} />}

      {/* ── CEO Brain / AI Producer ──────────────────────────────────────────── */}
      <div className="bg-g-card border border-g-green/30 rounded-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-g-border/30">
          <div className="flex items-center gap-2">
            <Brain size={14} className="text-g-green" />
            <p className="text-xs text-g-green uppercase tracking-widest font-black">AI Producer</p>
            {brain.dimensjonerVurdert > 0 && (
              <span className="text-[10px] text-g-muted/40">vurderte {brain.dimensjonerVurdert} signaler</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {brain.confidenceLevel === 'lav' && (
              <span className="text-[10px] font-bold text-yellow-400 uppercase tracking-wider">Confidence: lav</span>
            )}
            <span className="text-[10px] text-g-muted/40 uppercase tracking-wider">Confidence</span>
            <span className={`text-sm font-black tabular-nums ${
              confidence.score >= 70 ? 'text-g-green' :
              confidence.score >= 40 ? 'text-yellow-400' : 'text-g-muted'
            }`}>{confidence.score}%</span>
          </div>
        </div>

        {/* NÅ AKKURAT — producer narrative */}
        <div className="px-5 pt-4 pb-3 border-b border-g-border/20">
          <p className="text-[9px] text-g-muted/40 uppercase tracking-widest font-bold mb-1.5">GLENVEX tenker nå</p>
          <p className="text-[13px] font-bold text-g-text leading-snug whitespace-pre-line">{narrative}</p>
        </div>

        {/* Dagensplan — concrete WHY for today's game/timing */}
        {(dagensPlan.mulighet || dagensPlan.risiko) && (
          <div className="px-5 pt-3 pb-2 space-y-1.5 border-b border-g-border/20">
            {dagensPlan.mulighet && (
              <>
                <p className="text-[11px] text-g-green/70">💡 {dagensPlan.mulighet}</p>
                {dagensPlan.mulighetDetaljer.length > 0 && (
                  <div className="pl-3 space-y-0.5">
                    {dagensPlan.mulighetDetaljer.map((d, i) => (
                      <p key={i} className="text-[10px] text-g-green/50">• {d}</p>
                    ))}
                  </div>
                )}
              </>
            )}
            {dagensPlan.risiko && (
              <>
                <p className="text-[11px] text-yellow-400/70">⚠ {dagensPlan.risiko}</p>
                {dagensPlan.risikoDetaljer.length > 0 && (
                  <div className="pl-3 space-y-0.5">
                    {dagensPlan.risikoDetaljer.map((d, i) => (
                      <p key={i} className="text-[10px] text-yellow-400/40">• {d}</p>
                    ))}
                  </div>
                )}
              </>
            )}
            {dagensPlan.fokus && (
              <p className="text-[11px] text-g-muted/45 italic">{dagensPlan.fokus}</p>
            )}
          </div>
        )}

        {/* Mission Queue — proactive task orchestration */}
        {nextMission ? (
          <>
            {/* Current mission */}
            <div className="px-5 pt-4 pb-3">
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-[10px] font-black uppercase tracking-widest ${
                  nextMission.priority === 'kritisk' ? 'text-red-400' :
                  nextMission.priority === 'høy'    ? 'text-yellow-400' :
                  'text-g-green'
                }`}>
                  {nextMission.priority === 'kritisk' ? '🔥 Kritisk' :
                   nextMission.priority === 'høy'    ? '⭐ Høy prioritet' :
                   'Neste oppdrag'}
                </span>
                {missions.length > 1 && (
                  <span className="text-[10px] text-g-muted/40">{doneMissions.length}/{missions.length} gjort</span>
                )}
              </div>

              <p className="text-[16px] font-black text-g-text leading-tight">{nextMission.label}</p>
              <p className="text-[12px] text-g-muted mt-1 leading-snug">{nextMission.context}</p>
              {nextMission.gevinst && (
                <p className="text-[11px] text-g-green/70 mt-1">✓ {nextMission.gevinst}</p>
              )}
              {nextMission.kostnadVedSkip && (
                <p className="text-[11px] text-red-400/55 mt-0.5">✗ Hopper du over: {nextMission.kostnadVedSkip}</p>
              )}

              {/* Draft text + copy */}
              {nextMission.draftText && (
                <div className="mt-3">
                  {nextMission.draftTitle && (
                    <p className="text-[10px] text-g-muted/50 uppercase tracking-wider font-bold mb-1.5">{nextMission.draftTitle}</p>
                  )}
                  <div className="bg-g-bg/60 border border-g-border/30 rounded-xl px-3 py-2.5 text-[11px] text-g-muted font-mono leading-relaxed whitespace-pre-line">
                    {nextMission.draftText}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => copyToClipboard(nextMission.draftText!, nextMission.id)}
                      className="px-3 py-1.5 bg-g-bg/50 border border-g-border/40 rounded-lg text-[10px] font-bold text-g-muted hover:text-g-text hover:border-g-green/30 transition-all"
                    >
                      {copied === nextMission.id ? '✓ Kopiert' : 'Kopier'}
                    </button>
                    {/* One-click poll start — sends directly to bot queue */}
                    {nextMission.id === 'poll' && !pollQueued && !pollError && (
                      <button
                        onClick={() => startPoll(
                          nextMission.draftText!.split('\n')[0] ?? nextMission.draftText!,
                          ['Fortsett her', 'Bytt innhold', 'Spill med seere', 'Ta challenge'],
                        )}
                        className="px-3 py-1.5 bg-g-green/10 border border-g-green/30 rounded-lg text-[10px] font-bold text-g-green hover:bg-g-green/20 transition-all"
                      >
                        Start poll →
                      </button>
                    )}
                    {nextMission.id === 'poll' && pollQueued && (
                      <span className="px-3 py-1.5 text-[10px] font-bold text-g-green/60">
                        ✓ Poll i kø — boten kjører den snart
                      </span>
                    )}
                    {nextMission.id === 'poll' && pollError && (
                      <span className="px-3 py-1.5 text-[10px] font-bold text-red-400/70" title={pollError}>
                        Feil: {pollError.split(':')[0]}
                      </span>
                    )}
                    {nextMission.isManual && nextMission.id !== 'poll' && (
                      <button
                        onClick={() => markDone(nextMission.id, nextMission.label)}
                        className="px-3 py-1.5 bg-g-green/10 border border-g-green/30 rounded-lg text-[10px] font-bold text-g-green hover:bg-g-green/20 transition-all"
                      >
                        Gjort ✓
                      </button>
                    )}
                    {nextMission.id === 'poll' && (
                      <button
                        onClick={() => markDone(nextMission.id, nextMission.label)}
                        className="px-3 py-1.5 bg-g-bg/50 border border-g-border/40 rounded-lg text-[10px] font-bold text-g-muted hover:text-g-text transition-all"
                      >
                        Gjort ✓
                      </button>
                    )}
                    <Link href={nextMission.href} className="ml-auto text-[10px] text-g-muted/50 hover:text-g-green transition-colors">
                      Åpne →
                    </Link>
                  </div>
                </div>
              )}

              {/* No draft — just action buttons */}
              {!nextMission.draftText && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {/* Sponsor: inline publish button — sends to Twitch + Discord via bot */}
                  {nextMission.id === 'sponsor' && !sponsorQueued && !sponsorError && (
                    <button
                      onClick={promoteSponsor}
                      className="px-3 py-1.5 bg-g-green/10 border border-g-green/30 rounded-lg text-[10px] font-bold text-g-green hover:bg-g-green/20 transition-all"
                    >
                      Publiser sponsor →
                    </button>
                  )}
                  {nextMission.id === 'sponsor' && sponsorQueued && (
                    <span className="px-3 py-1.5 text-[10px] font-bold text-g-green/60">
                      ✓ Sponsor sendt
                    </span>
                  )}
                  {nextMission.id === 'sponsor' && sponsorError && (
                    <span className="px-3 py-1.5 text-[10px] font-bold text-red-400/70" title={sponsorError}>
                      Feil: {sponsorError.split(':')[0]}
                    </span>
                  )}
                  {nextMission.id !== 'sponsor' && (
                    <Link href={nextMission.href}
                      className="px-3 py-1.5 bg-g-green/10 border border-g-green/30 rounded-lg text-[10px] font-bold text-g-green hover:bg-g-green/20 transition-all">
                      Åpne →
                    </Link>
                  )}
                  {nextMission.isManual && (
                    <button
                      onClick={() => markDone(nextMission.id, nextMission.label)}
                      className="px-3 py-1.5 bg-g-bg/50 border border-g-border/40 rounded-lg text-[10px] font-bold text-g-muted hover:text-g-text hover:border-g-green/30 transition-all"
                    >
                      Gjort ✓
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Mission checklist */}
            {missions.length > 1 && (
              <div className="px-5 pb-3 border-t border-g-border/20 pt-3">
                <div className="space-y-1">
                  {missions.map(m => (
                    <button
                      key={m.id}
                      onClick={() => m.isManual && !m.done ? markDone(m.id, m.label) : undefined}
                      className={`flex items-center gap-2 text-[10px] leading-snug ${
                        m.done               ? 'text-g-muted/35 line-through' :
                        m.id === nextMission.id ? 'text-g-text font-bold' :
                        'text-g-muted/55'
                      }`}
                    >
                      <span className={`flex-shrink-0 ${
                        m.done               ? 'text-g-muted/35' :
                        m.priority === 'kritisk' && !m.done ? 'text-red-400' :
                        m.priority === 'høy'    && !m.done ? 'text-yellow-400' :
                        m.id === nextMission.id ? 'text-g-green' :
                        'text-g-muted/40'
                      }`}>
                        {m.done ? '✓' :
                         m.priority === 'kritisk' && !m.done ? '🔥' :
                         m.priority === 'høy'     && !m.done ? '⭐' :
                         m.id === nextMission.id  ? '→' : '○'}
                      </span>
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* NESTE — upcoming missions not yet triggered */}
            {upcomingMissions.length > 0 && (
              <div className="px-5 pb-3 pt-3 border-t border-g-border/15">
                <p className="text-[9px] text-g-muted/35 uppercase tracking-widest font-bold mb-2">Neste</p>
                <div className="space-y-1">
                  {upcomingMissions.map(m => (
                    <div key={m.id} className="flex items-center gap-3">
                      <span className="text-[10px] font-mono text-g-muted/30 w-16 flex-shrink-0">Om {m.minutesAway} min</span>
                      <span className="text-[10px] text-g-muted/45">→ {m.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI tip as supporting context */}
            {brain.kilde && brain.anbefaling && brain.anbefaling !== 'Alle systemer aktive — overvåker stream.' && (
              <div className="px-5 pb-4 border-t border-g-border/10 pt-3">
                <p className="text-[10px] text-g-muted/35 uppercase tracking-wider font-bold mb-1">AI observerer</p>
                <p className="text-[11px] text-g-muted/60 leading-snug">{brain.anbefaling}</p>
              </div>
            )}

            {brain.selfCorrectionNote && (
              <div className="mx-5 mb-3 px-3 py-2 bg-yellow-500/5 border border-yellow-500/20 rounded-xl">
                <p className="text-[11px] text-yellow-400 font-bold">↺ {brain.selfCorrectionNote}</p>
              </div>
            )}
          </>
        ) : (
          /* All missions done — AI runs the show */
          <>
            {brain.selfCorrectionNote && (
              <div className="mx-5 mt-4 px-3 py-2 bg-yellow-500/5 border border-yellow-500/20 rounded-xl">
                <p className="text-[11px] text-yellow-400 font-bold">↺ {brain.selfCorrectionNote}</p>
              </div>
            )}
            <div className="px-5 py-4">
              {missions.length > 0 && (
                <p className="text-[10px] text-g-green/60 font-bold uppercase tracking-wider mb-3">✓ Alle oppdrag gjort — AI overvåker</p>
              )}
              <Link href={brain.href} className="block group">
                <p className="text-[15px] font-bold text-g-text leading-snug group-hover:text-g-green transition-colors">
                  {brain.anbefaling}
                </p>
              </Link>
              {brain.hvorfor && (
                <div className="mt-3">
                  <p className="text-[10px] text-g-muted/50 uppercase tracking-wider font-bold mb-1">Hvorfor</p>
                  <p className="text-sm text-g-muted leading-relaxed">{brain.hvorfor}</p>
                </div>
              )}
              {brain.avvistAlternativer.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-[10px] text-g-muted/50 uppercase tracking-wider font-bold">Vurderte, men valgte bort</p>
                  {brain.avvistAlternativer.map((alt, i) => (
                    <div key={i} className="flex items-start gap-2 px-3 py-2 bg-g-bg/30 rounded-xl border border-g-border/20">
                      <XCircle size={11} className="text-g-muted/30 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-g-muted/70 leading-snug truncate">{alt.title}</p>
                        <p className="text-[10px] text-g-muted/40 leading-snug mt-0.5">{alt.grunn}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {(brain.forventetEffekt || brain.evaluering) && (
              <div className="flex divide-x divide-g-border/30 border-t border-g-border/30">
                {brain.forventetEffekt && (
                  <div className="flex-1 px-5 py-3">
                    <p className="text-[10px] text-g-muted/40 uppercase tracking-wider font-bold mb-1">Forventet effekt</p>
                    <p className="text-[11px] text-g-muted leading-snug">{brain.forventetEffekt}</p>
                  </div>
                )}
                {brain.evaluering && (
                  <div className="flex-1 px-5 py-3">
                    <p className="text-[10px] text-g-muted/40 uppercase tracking-wider font-bold mb-1">Slik evaluerer vi</p>
                    <p className="text-[11px] text-g-muted leading-snug">{brain.evaluering}</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Spillmønster + Confidence breakdown */}
        <div className="px-5 py-3 border-t border-g-border/30 bg-g-bg/20 space-y-1.5">
          {brain.spillmønster && (
            <p className="text-[10px] text-g-muted/50 italic">{brain.spillmønster}</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {confidence.breakdown.filter(b => b.active).map((b, i) => (
              <span key={i} className="text-[10px] text-g-muted/60">✔ {b.label}</span>
            ))}
            {brain.kilde && (
              <span className="text-[10px] text-g-muted/30 ml-auto">via {brain.kilde}</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Raid-kandidater (auto-loaded near stream end) ────────────────────── */}
      {raidTargets.length > 0 && (
        <div className="bg-g-card border border-g-border rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <p className="text-xs text-g-muted uppercase tracking-widest font-bold">Raid-kandidater</p>
            <Link href="/raid-manager" className="ml-auto text-[10px] text-g-muted/50 hover:text-g-green transition-colors">
              Se alle →
            </Link>
          </div>
          <div className="space-y-2">
            {raidTargets.slice(0, 3).map((t, i) => (
              <a key={t.login} href={t.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 px-3 py-2.5 border border-g-border/40 rounded-xl hover:border-g-border hover:bg-g-bg/40 transition-all">
                <span className="text-[10px] font-black text-g-muted/30 w-4 flex-shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-g-text">{t.username}</p>
                  {t.grunn && <p className="text-[10px] text-g-muted/50 truncate">{t.grunn}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] font-bold text-g-text">{t.viewers} seere</p>
                  <p className="text-[10px] text-g-muted/40">{t.game}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* ── Handlinger + Tidsplan ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Handlinger */}
        <div className="bg-g-card border border-g-border rounded-2xl p-5">
          <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-3">Øvrige handlinger</p>
          {actions.length === 0 ? (
            <p className="text-sm text-g-muted">Ingen ventende handlinger.</p>
          ) : (
            <div className="space-y-1.5">
              {actions.map((item, i) => (
                <Link key={i} href={item.href}
                  className="flex items-center gap-3 px-3 py-2.5 border border-g-border/40 rounded-xl hover:border-g-border hover:bg-g-bg/40 transition-all group">
                  <Zap size={12} className={`flex-shrink-0 ${PRIORITY_DOT[item.priority] ?? 'text-g-green'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-g-text leading-snug">{item.title}</p>
                    {item.detail && <p className="text-[11px] text-g-muted mt-0.5 truncate">{item.detail}</p>}
                  </div>
                  <ChevronRight size={12} className="text-g-muted/30 group-hover:text-g-muted flex-shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Tidsplan */}
        <div className="bg-g-card border border-g-border rounded-2xl p-5">
          <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-3">Tidsplan</p>
          {plan.length === 0 ? (
            <p className="text-sm text-g-muted">Beregner tidsplan…</p>
          ) : (
            <div className="space-y-1.5">
              {plan.map((item, i) => (
                <Link key={i} href={item.href}
                  className="flex items-center gap-3 px-3 py-2 border border-g-border/40 rounded-xl hover:border-g-border hover:bg-g-bg/40 transition-all">
                  <Clock size={12} className={`flex-shrink-0 ${item.ready ? 'text-g-green animate-pulse' : 'text-g-muted/30'}`} />
                  <p className={`flex-1 text-xs font-bold ${item.ready ? 'text-g-green' : 'text-g-text'}`}>{item.label}</p>
                  <span className={`text-[11px] font-mono font-bold ${item.ready ? 'text-g-green' : 'text-g-muted/50'}`}>
                    {item.ready ? 'NÅ →' : item.delta > 0 ? `+${item.delta}m` : `${item.delta}m`}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* ── Poll pågår ────────────────────────────────────────────────────────── */}
      {pollMgr?.activePoll && (
        <div className="bg-g-card border border-yellow-500/30 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
            <p className="text-xs text-yellow-400 uppercase tracking-widest font-black">Poll pågår</p>
            <span className="ml-auto text-[10px] text-g-muted/40">{pollMgr.activePoll.pollType}</span>
          </div>
          <p className="text-sm font-bold text-g-text">{pollMgr.activePoll.question}</p>
          {pollMgr.activePoll.options.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pollMgr.activePoll.options.map((o, i) => (
                <span key={i} className="px-2.5 py-1 text-[11px] border border-yellow-500/20 rounded-lg text-g-muted bg-yellow-500/5">
                  {o.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Siste poll-resultat ───────────────────────────────────────────────── */}
      {!pollMgr?.activePoll && pollMgr?.lastPoll?.winner && (
        <div className="bg-g-card border border-g-border rounded-2xl p-5">
          <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-2">Siste poll-resultat</p>
          <p className="text-sm text-g-text">
            <span className="font-bold text-g-green">{pollMgr.lastPoll.winner}</span>
            {(pollMgr.lastPoll.totalVotes ?? 0) > 0 && (
              <span className="text-g-muted ml-2">({pollMgr.lastPoll.totalVotes} stemmer)</span>
            )}
          </p>
          {pollMgr.pollLearning && (
            <p className="mt-1 text-xs text-g-muted">{pollMgr.pollLearning}</p>
          )}
        </div>
      )}

      {/* ── Hva AI vet om kanalen ─────────────────────────────────────────────── */}
      {learning.length > 0 && (
        <div className="bg-g-card border border-g-border rounded-2xl p-5">
          <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-3">Hva AI vet om deg</p>
          <div className="space-y-2">
            {learning.map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-g-green/60 text-xs mt-0.5 flex-shrink-0 font-mono">→</span>
                <p className="text-sm text-g-text leading-snug">{item}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Systemer ──────────────────────────────────────────────────────────── */}
      <div className="bg-g-card border border-g-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-g-muted uppercase tracking-widest font-bold">Alle systemer</p>
          <span className="text-[11px] font-bold text-g-green">{activeCount}/{systemer.length} aktive</span>
        </div>
        {errorSystems.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {errorSystems.map(s => (
              <span key={s.key} className="px-2 py-0.5 text-[10px] bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg font-bold">
                {s.label} — feil
              </span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {systemer.map(s => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${
                s.status === 'ok'   ? 'bg-g-green' :
                s.status === 'feil' ? 'bg-red-400' : 'bg-g-muted/25'
              }`} />
              <span className={`text-[11px] ${
                s.status === 'feil' ? 'text-red-400' :
                s.status === 'ok'   ? 'text-g-muted' : 'text-g-muted/40'
              }`}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

// ── Stream Phase Badge ─────────────────────────────────────────────────────────

const PHASE_DOT: Record<StreamPhaseResult['color'], string> = {
  green:  'bg-green-400',
  yellow: 'bg-yellow-400',
  orange: 'bg-orange-400',
  blue:   'bg-blue-400',
};
const PHASE_TEXT: Record<StreamPhaseResult['color'], string> = {
  green:  'text-green-400',
  yellow: 'text-yellow-400',
  orange: 'text-orange-400',
  blue:   'text-blue-400',
};
const PHASE_BORDER: Record<StreamPhaseResult['color'], string> = {
  green:  'border-green-500/20',
  yellow: 'border-yellow-500/20',
  orange: 'border-orange-500/20',
  blue:   'border-blue-500/20',
};
const PHASE_BG: Record<StreamPhaseResult['color'], string> = {
  green:  'bg-green-950/20',
  yellow: 'bg-yellow-950/20',
  orange: 'bg-orange-950/20',
  blue:   'bg-blue-950/20',
};

function StreamPhaseBadge({ phase, elapsedMin }: { phase: StreamPhaseResult; elapsedMin: number }) {
  return (
    <div className={`rounded-2xl border ${PHASE_BORDER[phase.color]} ${PHASE_BG[phase.color]} px-5 py-3`}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${PHASE_DOT[phase.color]}`} />
            <span className="text-[10px] text-g-muted/50 uppercase tracking-widest font-bold">STREAM FASE</span>
          </div>
          <span className={`text-sm font-black uppercase tracking-wide ${PHASE_TEXT[phase.color]}`}>
            {phase.label}
          </span>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-g-muted/50">
          <span>Forventet total: <span className="text-g-muted">{phase.expectedTotalMin} min</span></span>
          {!phase.raidAllowed && (
            <span>Raid åpner om: <span className="text-g-muted">{Math.max(0, Math.round(phase.raidUnlocksAtMin - elapsedMin))} min</span></span>
          )}
          {phase.raidAllowed && (
            <span className={`font-bold ${PHASE_TEXT[phase.color]}`}>Raid åpnet</span>
          )}
        </div>
      </div>
      <p className="text-[11px] text-g-muted/50 mt-1.5">{phase.description}</p>
    </div>
  );
}
