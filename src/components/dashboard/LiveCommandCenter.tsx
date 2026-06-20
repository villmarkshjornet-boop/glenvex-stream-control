'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Brain, Clock, Zap, ChevronRight, XCircle } from 'lucide-react';
import type { LiveData, SlowData } from './types';

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

// ── Mission Queue — deterministic task list for the stream ────────────────────
// CEO Brain's primary job: find the next uncompleted mission and show it
// with pre-drafted content and one-click actions.

interface StreamMission {
  id:               string;
  label:            string;
  context:          string;
  draftTitle?:      string;
  draftText?:       string;
  forventetEffekt?: string;
  href:             string;
  triggerAfterMin:  number;
  done:             boolean;
  isManual:         boolean;  // needs user to click "Gjort" vs auto-detectable
}

function buildMissionQueue(
  live: LiveData,
  slow: SlowData,
  elapsedMin: number,
  doneManual: Set<string>,
): StreamMission[] {
  const tips   = live.liveAgentTips ?? [];
  const hasCat = (cat: string) => tips.some(t => t.category === cat);

  const game  = slow.streamStatus.game  ?? 'stream';
  const title = slow.streamStatus.title ?? 'Vi er live!';
  const thumb = slow.streamStatus.thumbnailUrl ?? '';
  const login = thumb.match(/live_user_(\w+)-/)?.[1] ?? 'glenvex';
  const url   = `twitch.tv/${login}`;

  // Discord auto-detect: kontrollsenter Discord entry ran within last 45 min
  const discordKS = live.kontrollsenter?.find(
    k => k.key.toLowerCase().includes('discord') || k.label.toLowerCase().includes('discord'),
  );
  const discordAutoDetected = discordKS?.sisteKjøring
    ? Date.now() - new Date(discordKS.sisteKjøring).getTime() < 45 * 60_000
    : false;

  const pollsDone   = (live.pollManager?.totalPollsThisStream ?? 0) > 0;
  const sponsorDone = hasCat('sponsor');
  const raidDone    = hasCat('raid');

  const all: StreamMission[] = [
    {
      id:              'x_post',
      label:           'Post på X',
      context:         'Streamen er ikke annonsert på X ennå',
      draftTitle:      'Klar til posting:',
      draftText:       `Vi er LIVE! 🔴\n\n${title}\n🎮 ${game}\n\n${url}`,
      forventetEffekt: '3–7 ekstra seere fra X-følgere',
      href:            '/',
      triggerAfterMin: 0,
      done:            doneManual.has('x_post'),
      isManual:        true,
    },
    {
      id:              'discord_post',
      label:           'Post i Discord',
      context:         discordAutoDetected
        ? 'Discord-bot kjørte nettopp — sjekk at meldingen ble sendt'
        : 'Discord-annonsering ikke sendt ennå denne streamen',
      draftTitle:      'Klar til posting:',
      draftText:       `@everyone Vi er LIVE! 🔴\n\n${title}\n🎮 ${game}\n\n→ ${url}`,
      forventetEffekt: '5–15 Discord-følgere inn i chatten',
      href:            '/',
      triggerAfterMin: 0,
      done:            doneManual.has('discord_post') || discordAutoDetected,
      isManual:        !discordAutoDetected,
    },
    {
      id:              'chat_cta',
      label:           'Engasjer chatten',
      context:         'Still chatten et personlig spørsmål — aktiver lurkers',
      draftTitle:      'Forslag til spørsmål:',
      draftText:       `Hvem er her for første gang i dag? ${game !== 'stream' ? `Hva synes dere om ${game}?` : 'Hva vil dere se mer av?'}`,
      forventetEffekt: 'Økt chatrate og aktivering av lurkers',
      href:            '/',
      triggerAfterMin: 5,
      done:            doneManual.has('chat_cta'),
      isManual:        true,
    },
    {
      id:              'poll',
      label:           'Kjør en poll',
      context:         pollsDone
        ? `Poll kjørt (${live.pollManager?.totalPollsThisStream} totalt)`
        : 'Ingen poll kjørt ennå — godt tidspunkt nå',
      forventetEffekt: 'Økt engagement og Twitch-algoritmesignal',
      href:            '/',
      triggerAfterMin: 15,
      done:            pollsDone,
      isManual:        false,
    },
    {
      id:              'sponsor',
      label:           'Nevn sponsor/partner',
      context:         sponsorDone
        ? 'Sponsor nevnt av Live Agent'
        : 'Chatten er varm nok — greit å nevne partner nå',
      forventetEffekt: 'Partnereksponering uten å virke salgsorientert',
      href:            '/partner-hub',
      triggerAfterMin: 20,
      done:            doneManual.has('sponsor') || sponsorDone,
      isManual:        !sponsorDone,
    },
    {
      id:              'raid',
      label:           'Finn raid-kandidat',
      context:         raidDone
        ? 'Raid-analyse kjørt av Live Agent'
        : 'Begynn å planlegge hvem du raider ved stream-slutt',
      forventetEffekt: 'Godt raid bygger goodwill og kan gi follow-backs',
      href:            '/raid-manager',
      triggerAfterMin: 75,
      done:            doneManual.has('raid') || raidDone,
      isManual:        !raidDone,
    },
  ];

  return all.filter(m => elapsedMin >= m.triggerAfterMin);
}

// ── Main component ─────────────────────────────────────────────────────────────

export function LiveCommandCenter({ live, slow }: { live: LiveData; slow: SlowData }) {
  const [doneManual, setDoneManual] = useState<Set<string>>(new Set());
  const [copied, setCopied]         = useState<string | null>(null);

  const status   = slow.streamStatus;
  const startIso = live.systemEvents?.find(e =>
    e.event_type === 'LIVE_AGENT_STARTED' || e.event_type === 'LIVE_DETECTED'
  )?.created_at ?? null;

  const elapsedMin = startIso ? (Date.now() - new Date(startIso).getTime()) / 60_000 : 0;

  const missions     = buildMissionQueue(live, slow, elapsedMin, doneManual);
  const nextMission  = missions.find(m => !m.done) ?? null;
  const doneMissions = missions.filter(m => m.done);

  const markDone = (id: string) =>
    setDoneManual(prev => { const n = new Set(prev); n.add(id); return n; });

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

        {/* Mission Queue — proactive task orchestration */}
        {nextMission ? (
          <>
            {/* Current mission */}
            <div className="px-5 pt-4 pb-3">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-black text-g-green uppercase tracking-widest">Neste oppdrag</span>
                {missions.length > 1 && (
                  <span className="text-[10px] text-g-muted/40">{doneMissions.length}/{missions.length} gjort</span>
                )}
              </div>

              <p className="text-[16px] font-black text-g-text leading-tight">{nextMission.label}</p>
              <p className="text-[12px] text-g-muted mt-1 leading-snug">{nextMission.context}</p>
              {nextMission.forventetEffekt && (
                <p className="text-[11px] text-g-green/70 mt-1">→ {nextMission.forventetEffekt}</p>
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
                    {nextMission.isManual && (
                      <button
                        onClick={() => markDone(nextMission.id)}
                        className="px-3 py-1.5 bg-g-green/10 border border-g-green/30 rounded-lg text-[10px] font-bold text-g-green hover:bg-g-green/20 transition-all"
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
                <div className="mt-3 flex items-center gap-2">
                  <Link href={nextMission.href}
                    className="px-3 py-1.5 bg-g-green/10 border border-g-green/30 rounded-lg text-[10px] font-bold text-g-green hover:bg-g-green/20 transition-all">
                    Åpne →
                  </Link>
                  {nextMission.isManual && (
                    <button
                      onClick={() => markDone(nextMission.id)}
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
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  {missions.map(m => (
                    <button
                      key={m.id}
                      onClick={() => m.isManual && !m.done ? markDone(m.id) : undefined}
                      className={`text-[10px] leading-snug ${
                        m.done          ? 'text-g-muted/35 line-through' :
                        m.id === nextMission.id ? 'text-g-green font-bold' :
                        'text-g-muted/55'
                      }`}
                    >
                      {m.done ? '✓' : m.id === nextMission.id ? '→' : '○'} {m.label}
                    </button>
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
