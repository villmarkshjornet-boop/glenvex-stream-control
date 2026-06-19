'use client';

import { useEffect, useState, useCallback } from 'react';
import { CheckCircle, Clock, Send, X, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { tidSiden } from './helpers';

interface ProposalEvent {
  eventType: string;
  title: string;
  metadata: Record<string, any>;
  createdAt: string;
}

interface ProposalDecision {
  id: string;
  decisionSummary: string;
  outcome: string | null;
  inputContext: Record<string, any> | null;
  createdAt: string;
}

interface Proposal {
  id: string;
  partner_name: string;
  platform: 'twitch' | 'discord' | 'both';
  confidence: number | null;
  scoring_detail: { relevance?: number; historical?: number; context?: number; cooldown?: number } | null;
  message_twitch: string | null;
  message_discord: string | null;
  status: 'pending' | 'approved' | 'sent' | 'rejected';
  expires_at: string;
  approved_at: string | null;
  sent_at: string | null;
  created_at: string;
  events: ProposalEvent[];
  decision: ProposalDecision | null;
}

const EVENT_LABEL: Record<string, string> = {
  PARTNER_PROPOSAL_CREATED:      'Forslag opprettet',
  PARTNER_DECISION_TRACE:        'Decision Trace',
  PARTNER_PROPOSAL_APPROVED:     'Godkjent',
  PARTNER_PROPOSAL_REJECTED:     'Avvist',
  PARTNER_PROPOSAL_SENT:         'Sendt',
  PARTNER_PROPOSAL_SEND_FAILED:  'Sending feilet',
};

const EVENT_COLOR: Record<string, string> = {
  PARTNER_PROPOSAL_CREATED:      'text-g-muted/70',
  PARTNER_DECISION_TRACE:        'text-g-muted/60',
  PARTNER_PROPOSAL_APPROVED:     'text-g-green',
  PARTNER_PROPOSAL_REJECTED:     'text-red-400',
  PARTNER_PROPOSAL_SENT:         'text-g-green',
  PARTNER_PROPOSAL_SEND_FAILED:  'text-red-400',
};

const TRIGGER_LABEL: Record<string, string> = {
  chat_silence:  'Chat-stillhet',
  viewer_peak:   'Seer-topp',
  context_match: 'Konteksttreff',
  timer:         'Timer',
  manual:        'Manuell',
};

function utløperLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Utløpt';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `Utløper om ${min}m`;
  return `Utløper om ${Math.floor(min / 60)}t`;
}

function platformBadge(platform: string) {
  const map: Record<string, string> = {
    discord: 'text-indigo-400 border-indigo-400/30 bg-indigo-400/10',
    twitch:  'text-purple-400 border-purple-400/30 bg-purple-400/10',
    both:    'text-g-green border-g-green/30 bg-g-green/10',
  };
  return map[platform] ?? map.discord;
}

function sentWhereLabel(events: ProposalEvent[]): string | null {
  const sentEvent = events.find(e => e.eventType === 'PARTNER_PROPOSAL_SENT');
  if (!sentEvent) return null;
  const { sentDiscord, sentTwitch } = sentEvent.metadata ?? {};
  if (sentDiscord && sentTwitch) return 'Discord + Twitch';
  if (sentDiscord) return 'Discord';
  if (sentTwitch) return 'Twitch';
  return sentEvent.metadata?.platform ?? null;
}

export function PartnerProposalQueue() {
  const [proposals, setProposals]     = useState<Proposal[]>([]);
  const [approving, setApproving]     = useState<Set<string>>(new Set());
  const [rejecting, setRejecting]     = useState<Set<string>>(new Set());
  const [localStatus, setLocalStatus] = useState<Record<string, string>>({});
  const [expanded, setExpanded]       = useState<Set<string>>(new Set());
  const [visUtløpt, setVisUtløpt]     = useState(false);

  const hent = useCallback(async () => {
    try {
      const res = await fetch('/api/partner-proposals');
      if (res.ok) {
        const d = await res.json();
        setProposals(d.proposals ?? []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    hent();
    const id = setInterval(hent, 15_000);
    return () => clearInterval(id);
  }, [hent]);

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  async function godkjenn(id: string) {
    setApproving(prev => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/partner-proposals/${id}/approve`, { method: 'POST' });
      if (res.ok) {
        setLocalStatus(prev => ({ ...prev, [id]: 'approved' }));
        setTimeout(hent, 1000);
      } else {
        const body = await res.json().catch(() => ({}));
        setLocalStatus(prev => ({ ...prev, [id]: body.error ?? 'Feil' }));
      }
    } catch {
      setLocalStatus(prev => ({ ...prev, [id]: 'Nettverksfeil' }));
    }
    setApproving(prev => { const s = new Set(prev); s.delete(id); return s; });
  }

  async function avvis(id: string) {
    setRejecting(prev => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/partner-proposals/${id}/reject`, { method: 'POST' });
      if (res.ok) {
        setLocalStatus(prev => ({ ...prev, [id]: 'rejected' }));
        setTimeout(hent, 1000);
      } else {
        const body = await res.json().catch(() => ({}));
        setLocalStatus(prev => ({ ...prev, [id]: body.error ?? 'Feil' }));
      }
    } catch {
      setLocalStatus(prev => ({ ...prev, [id]: 'Nettverksfeil' }));
    }
    setRejecting(prev => { const s = new Set(prev); s.delete(id); return s; });
  }

  const now = Date.now();
  const activePending  = proposals.filter(p => p.status === 'pending' && new Date(p.expires_at).getTime() > now);
  const expiredPending = proposals.filter(p => p.status === 'pending' && new Date(p.expires_at).getTime() <= now);
  const others = proposals.filter(p => {
    if (p.status === 'approved') return true;
    if (p.status === 'sent')     return now - new Date(p.sent_at ?? p.created_at).getTime() < 24 * 60 * 60 * 1000;
    if (p.status === 'rejected') return now - new Date(p.created_at).getTime() < 60 * 60 * 1000;
    return false;
  });

  if (activePending.length === 0 && others.length === 0 && expiredPending.length === 0) return null;

  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-g-muted uppercase tracking-widest font-bold">
          Partner-forslag til godkjenning
        </p>
        {activePending.length > 0 && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-yellow-400/10 border border-yellow-400/30 text-yellow-400">
            {activePending.length} venter
          </span>
        )}
      </div>

      <div className="space-y-3">

        {/* ── Active pending — needs action ────────────────────────────────── */}
        {activePending.map(p => {
          const override       = localStatus[p.id];
          const isApproving    = approving.has(p.id);
          const isRejecting    = rejecting.has(p.id);
          const isBusy         = isApproving || isRejecting;
          const isJustApproved = override === 'approved';
          const isJustRejected = override === 'rejected';
          const hasError       = override && override !== 'approved' && override !== 'rejected';
          const isOpen         = expanded.has(p.id);
          const preview        = (p.message_discord ?? p.message_twitch ?? '').slice(0, 140);
          const score          = p.scoring_detail;
          const ctx            = p.decision?.inputContext ?? null;
          const triggerType    = ctx?.triggerType ?? null;

          return (
            <div key={p.id} className="border border-yellow-400/20 bg-yellow-400/5 rounded-xl p-4 space-y-3">
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold text-sm text-g-text truncate">{p.partner_name}</span>
                  <span className={`px-1.5 py-0.5 border rounded text-[10px] font-bold flex-shrink-0 ${platformBadge(p.platform)}`}>
                    {p.platform}
                  </span>
                  {triggerType && (
                    <span className="text-[10px] text-g-muted/60 hidden sm:inline">
                      {TRIGGER_LABEL[triggerType] ?? triggerType}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-g-muted">{utløperLabel(p.expires_at)}</span>
                  <span className="text-xs font-black text-g-green">
                    {p.confidence != null ? `${Math.round(p.confidence * 100)}%` : '—'}
                  </span>
                </div>
              </div>

              {/* AI Begrunnelse fra decision context */}
              {ctx && (
                <div className="flex flex-wrap gap-2 text-[10px] font-mono">
                  {ctx.reasonCode && (
                    <span className="px-1.5 py-0.5 border border-g-border/40 rounded text-g-muted">
                      {ctx.reasonCode}
                    </span>
                  )}
                  {score?.relevance != null && <span className="text-g-muted">Rel: {Math.round(score.relevance * 100)}%</span>}
                  {score?.historical != null && <span className="text-g-muted">Hist: {Math.round(score.historical * 100)}%</span>}
                  {score?.context != null && <span className="text-g-muted">Ctx: {Math.round(score.context * 100)}%</span>}
                  {score?.cooldown != null && score.cooldown > 0 && (
                    <span className="text-red-400/70">−cd: {Math.round(score.cooldown * 100)}%</span>
                  )}
                  {ctx.viewerCount != null && <span className="text-g-muted/60">{ctx.viewerCount} seere</span>}
                  {ctx.game && <span className="text-g-muted/60">{ctx.game}</span>}
                </div>
              )}

              {/* Melding-preview */}
              {preview && (
                <p className="text-xs text-g-muted/80 leading-relaxed border-l-2 border-g-border pl-3 italic">
                  {preview}{preview.length === 140 ? '…' : ''}
                </p>
              )}

              {/* Knapper / status */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => toggleExpanded(p.id)}
                  className="flex items-center gap-1 text-[10px] text-g-muted/50 hover:text-g-muted transition-colors"
                >
                  {isOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                  {p.events.length > 0 ? `Historikk (${p.events.length})` : `Opprettet ${tidSiden(p.created_at)}`}
                </button>

                {isJustApproved ? (
                  <span className="flex items-center gap-1.5 text-xs text-g-green font-bold">
                    <CheckCircle size={13} /> Godkjent – sendes innen 2 min
                  </span>
                ) : isJustRejected ? (
                  <span className="flex items-center gap-1.5 text-xs text-g-muted/60 font-bold">
                    <X size={13} /> Avvist
                  </span>
                ) : hasError ? (
                  <span className="text-xs text-red-400">{override}</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => avvis(p.id)}
                      disabled={isBusy}
                      className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-bold transition-colors ${
                        isRejecting
                          ? 'border-red-400/30 text-red-400 animate-pulse cursor-not-allowed'
                          : 'border-red-400/20 text-red-400/70 hover:text-red-400 hover:border-red-400/40 hover:bg-red-400/5'
                      }`}
                    >
                      <X size={13} />{isRejecting ? 'Avviser...' : 'Avvis'}
                    </button>
                    <button
                      onClick={() => godkjenn(p.id)}
                      disabled={isBusy}
                      className={`flex items-center gap-1.5 px-3.5 py-1.5 border rounded-lg text-xs font-bold transition-colors ${
                        isApproving
                          ? 'border-g-green/30 text-g-green animate-pulse cursor-not-allowed'
                          : 'border-g-green/40 text-g-green hover:bg-g-green/10 hover:border-g-green'
                      }`}
                    >
                      <CheckCircle size={13} />{isApproving ? 'Godkjenner...' : 'Godkjenn'}
                    </button>
                  </div>
                )}
              </div>

              {/* Event log — collapsable */}
              {isOpen && (
                <div className="border-t border-g-border/20 pt-3 space-y-1.5">
                  {p.events.length === 0 ? (
                    <p className="text-[10px] text-g-muted/40">Ingen loggede hendelser ennå</p>
                  ) : (
                    p.events.map((e, i) => (
                      <div key={i} className="flex items-start gap-2 text-[10px]">
                        <span className="text-g-muted/30 flex-shrink-0 font-mono w-16">
                          {new Date(e.createdAt).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className={`font-bold flex-shrink-0 w-32 ${EVENT_COLOR[e.eventType] ?? 'text-g-muted/60'}`}>
                          {EVENT_LABEL[e.eventType] ?? e.eventType}
                        </span>
                        <span className="text-g-muted/60 leading-relaxed">
                          {e.eventType === 'PARTNER_DECISION_TRACE' && e.metadata?.steps
                            ? (e.metadata.steps as string[]).join(' → ')
                            : e.eventType === 'PARTNER_PROPOSAL_SENT'
                            ? `${sentWhereLabel([e]) ?? '—'} · ${e.metadata?.decisionId?.slice(0, 8) ?? ''}`
                            : e.title?.slice(0, 80) ?? ''}
                        </span>
                      </div>
                    ))
                  )}
                  {p.decision && (
                    <div className="flex items-center gap-2 text-[10px] pt-1 border-t border-g-border/10">
                      <span className="text-g-muted/30 font-mono w-16">Decision</span>
                      <span className="text-g-muted/50 font-mono">{p.decision.id.slice(0, 8)}</span>
                      <span className={`font-bold ${p.decision.outcome === 'success' ? 'text-g-green' : p.decision.outcome === 'rejected' ? 'text-red-400' : 'text-g-muted/50'}`}>
                        {p.decision.outcome ?? 'pending'}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* ── Approved / Sent / Rejected — compact rows ───────────────────── */}
        {others.map(p => {
          const where = sentWhereLabel(p.events);
          const isOpen = expanded.has(p.id);

          return (
            <div key={p.id} className="border border-g-border/30 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-2.5">
                {p.status === 'approved' && <Clock size={14} className="text-g-green animate-pulse flex-shrink-0" />}
                {p.status === 'sent'     && <Send  size={14} className="text-g-muted/50 flex-shrink-0" />}
                {p.status === 'rejected' && <X     size={14} className="text-g-muted/40 flex-shrink-0" />}

                <div className="flex-1 min-w-0">
                  <span className={`text-sm font-bold ${p.status === 'rejected' ? 'text-g-muted/50 line-through' : 'text-g-text'}`}>
                    {p.partner_name}
                  </span>
                  <span className={`ml-2 px-1.5 py-0.5 border rounded text-[10px] font-bold ${platformBadge(p.platform)}`}>
                    {p.platform}
                  </span>
                  {where && p.status === 'sent' && (
                    <span className="ml-2 text-[10px] text-g-muted/60">{where}</span>
                  )}
                </div>

                <span className={`text-xs font-bold flex-shrink-0 ${
                  p.status === 'approved' ? 'text-g-green' : p.status === 'rejected' ? 'text-g-muted/40' : 'text-g-muted/60'
                }`}>
                  {p.status === 'approved'  ? 'Sendes innen 2 min'
                   : p.status === 'rejected' ? `Avvist ${tidSiden(p.created_at)}`
                   : `Sendt ${tidSiden(p.sent_at ?? p.created_at)}`}
                </span>

                {p.events.length > 0 && (
                  <button
                    onClick={() => toggleExpanded(p.id)}
                    className="text-g-muted/30 hover:text-g-muted flex-shrink-0"
                  >
                    {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                )}
              </div>

              {/* Event log for non-pending */}
              {isOpen && p.events.length > 0 && (
                <div className="px-4 pb-3 pt-1 border-t border-g-border/20 space-y-1.5">
                  {p.events.map((e, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px]">
                      <span className="text-g-muted/30 flex-shrink-0 font-mono w-16">
                        {new Date(e.createdAt).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className={`font-bold flex-shrink-0 w-32 ${EVENT_COLOR[e.eventType] ?? 'text-g-muted/60'}`}>
                        {EVENT_LABEL[e.eventType] ?? e.eventType}
                      </span>
                      <span className="text-g-muted/60 leading-relaxed">
                        {e.eventType === 'PARTNER_DECISION_TRACE' && e.metadata?.steps
                          ? (e.metadata.steps as string[]).join(' → ')
                          : e.eventType === 'PARTNER_PROPOSAL_SENT'
                          ? `${sentWhereLabel([e]) ?? '—'}`
                          : e.title?.slice(0, 80) ?? ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* ── Expired pending — collapsed ──────────────────────────────────── */}
        {expiredPending.length > 0 && (
          <div>
            <button
              onClick={() => setVisUtløpt(v => !v)}
              className="flex items-center gap-1.5 text-[10px] text-g-muted/40 hover:text-g-muted/70 transition-colors mt-1"
            >
              <AlertCircle size={11} />
              {expiredPending.length} utløpt forslag
              <span>{visUtløpt ? '▲' : '▼'}</span>
            </button>
            {visUtløpt && (
              <div className="mt-2 space-y-1.5">
                {expiredPending.map(p => (
                  <div key={p.id} className="flex items-center gap-3 px-3 py-2 border border-g-border/20 rounded-lg opacity-40">
                    <AlertCircle size={12} className="text-g-muted flex-shrink-0" />
                    <span className="text-xs text-g-muted line-through flex-1">{p.partner_name}</span>
                    <span className="text-[10px] text-g-muted/60">Utløpt {tidSiden(p.expires_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
