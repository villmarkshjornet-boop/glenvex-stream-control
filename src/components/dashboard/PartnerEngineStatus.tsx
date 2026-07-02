'use client';

import { useEffect, useState, useCallback } from 'react';
import { Activity, Send, TrendingUp, BarChart2, Share2, AlertTriangle } from 'lucide-react';
import { tidSiden } from './helpers';
import { useI18n } from '@/contexts/I18nContext';

interface BotHendelse {
  ts: string;
  type: string;
  tittel: string;
  metadata: any;
}

interface Sammendrag {
  promoSendt30d: number;
  promoHoppet30d: number;
  sistePromoTs: string | null;
  dagSidenPromo: number | null;
  foreslåXFor: string | null;
  foreslåXAldri: boolean;
  pollOpprettet30d: number;
  pollResultater30d: number;
}

interface EngineStatus {
  sistVurdert: {
    ts: string;
    eventType: string;
    reasonCode: string | null;
    partnerName: string | null;
    score: number | null;
    triggerType: string | null;
  } | null;
  sistSendt: {
    ts: string;
    partnerName: string | null;
    platform: string | null;
    sentDiscord: boolean | null;
    sentTwitch: boolean | null;
  } | null;
  partnerEksponering: Array<{
    navn: string;
    sistePromotert: string | null;
    eksponering: number;
  }>;
  botAktivitet: BotHendelse[];
  sammendrag: Sammendrag | null;
}

function platformLabel(sentDiscord: boolean | null, sentTwitch: boolean | null, platform: string | null): string {
  if (sentDiscord && sentTwitch) return 'Discord + Twitch';
  if (sentDiscord) return 'Discord';
  if (sentTwitch) return 'Twitch';
  if (platform) return platform;
  return '—';
}

const HENDELSE_IKON: Record<string, string> = {
  PARTNER_PROMOTION_SENT_DISCORD: '🤝',
  PARTNER_PROMOTION_SENT_TWITCH:  '🟣',
  PARTNER_PROMOTION_SKIPPED:      '⏭',
  POLL_CREATED:                   '📊',
  POLL_RESULT_COLLECTED:          '✅',
  POLL_SKIPPED:                   '—',
};

function hendelseLabel(type: string, meta: any): string {
  switch (type) {
    case 'PARTNER_PROMOTION_SENT_DISCORD': return `Discord: ${meta?.partnerName ?? ''}`;
    case 'PARTNER_PROMOTION_SENT_TWITCH':  return `Twitch: ${meta?.partnerName ?? ''}`;
    case 'PARTNER_PROMOTION_SKIPPED':      return `Hoppet over: ${meta?.årsak ?? meta?.reasonCode ?? ''}`;
    case 'POLL_CREATED':                   return `Poll: ${meta?.question ?? meta?.topic ?? ''}`;
    case 'POLL_RESULT_COLLECTED':          return `Poll-resultat: ${meta?.winner ?? meta?.resultat ?? ''}`;
    default:                               return type.replace(/_/g, ' ');
  }
}

function pollVinner(meta: any): string | null {
  if (!meta) return null;
  if (meta.winner) return `Vinner: ${meta.winner}`;
  if (meta.resultat) return `Resultat: ${meta.resultat}`;
  if (meta.votes && typeof meta.votes === 'object') {
    const sorted = Object.entries(meta.votes as Record<string, number>).sort(([, a], [, b]) => b - a);
    if (sorted.length > 0) return `Vinner: ${sorted[0][0]} (${sorted[0][1]} stemmer)`;
  }
  return null;
}

export function PartnerEngineStatus() {
  const { t } = useI18n();
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [xForslag, setXForslag] = useState<string | null>(null);
  const [lasterX, setLasterX] = useState(false);
  const [xPartner, setXPartner] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const hent = useCallback(async () => {
    try {
      const res = await fetch('/api/partner-engine/status');
      if (res.ok) setStatus(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    hent();
    const id = setInterval(hent, 30_000);
    return () => clearInterval(id);
  }, [hent]);

  const genererXForslag = async (partnerNavn?: string) => {
    setLasterX(true);
    setXForslag(null);
    setXPartner(partnerNavn ?? status?.sammendrag?.foreslåXFor ?? null);
    try {
      const res = await fetch('/api/partners/suggest-x-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerNavn: partnerNavn ?? null }),
      });
      const d = await res.json();
      if (d.forslag) setXForslag(d.forslag);
    } catch {}
    setLasterX(false);
  };

  if (!status) return null;

  const { sistVurdert: v, sistSendt: s, partnerEksponering: exp, botAktivitet, sammendrag } = status;
  const maxExp = Math.max(...exp.map(p => p.eksponering), 1);

  if (!v && !s && exp.length === 0 && botAktivitet.length === 0) return null;

  const harIkkePromotert = sammendrag && (sammendrag.dagSidenPromo === null || sammendrag.dagSidenPromo >= 7);

  return (
    <div className="bg-g-card border border-g-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-g-bg/30 transition-all text-left"
      >
        <div className="flex items-center gap-2">
          <TrendingUp size={12} className="text-g-muted/50" />
          <h3 className="text-xs font-semibold tracking-widest uppercase text-g-muted">
            {t('partnerEngine.title')}
          </h3>
          {harIkkePromotert && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold text-yellow-400 border border-yellow-400/30 bg-yellow-400/10">
              <AlertTriangle size={9} />
              {sammendrag.dagSidenPromo !== null ? `${sammendrag.dagSidenPromo}d` : 'aldri'}
            </span>
          )}
        </div>
        <span className="text-[11px] text-g-muted/40">{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Compact summary view */}
      {!expanded && (
        <div className="px-4 pb-4 space-y-2">
          {sammendrag && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-g-muted">Promoer sendt (30d)</span>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-g-green" />
                  <span className="text-xs text-g-text font-mono">{sammendrag.promoSendt30d}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-g-muted">Hoppet over</span>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-400/60" />
                  <span className="text-xs text-g-muted">{sammendrag.promoHoppet30d}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-g-muted">Polls</span>
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400/60" />
                  <span className="text-xs text-g-muted">{sammendrag.pollOpprettet30d}</span>
                </div>
              </div>
            </>
          )}
          {s && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-g-muted">Siste sendt</span>
              <span className="text-xs text-g-muted/60">{tidSiden(s.ts)}</span>
            </div>
          )}
        </div>
      )}

      {/* Expanded full view */}
      {expanded && (
        <div className="border-t border-g-border/40 p-4 space-y-5">

          {/* Status row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] text-g-muted uppercase tracking-wider font-bold">
                <Activity size={11} /> {t('partnerEngine.lastEvaluation')}
              </div>
              {v ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-g-text">{tidSiden(v.ts)}</span>
                    <span className={`px-1.5 py-0.5 border rounded text-[11px] font-bold ${
                      v.eventType === 'PARTNER_PROMOTION_CONSIDERED'
                        ? 'text-g-green border-g-green/30 bg-g-green/10'
                        : 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10'
                    }`}>
                      {v.reasonCode ? (t(`partnerEngine.reasonCodes.${v.reasonCode}`) || v.reasonCode) : '—'}
                    </span>
                  </div>
                  {v.partnerName && (
                    <p className="text-xs text-g-muted">
                      {v.partnerName}
                      {v.score != null && <span className="text-g-green font-bold ml-1">{Math.round(v.score * 100)}%</span>}
                      {v.triggerType && <span className="ml-1 text-g-muted/60">· {t(`partnerEngine.triggers.${v.triggerType}`) || v.triggerType}</span>}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-sm text-g-muted/60">{t('partnerEngine.noRuns')}</p>
                  <p className="text-[11px] text-g-muted/40 mt-0.5">{t('partnerEngine.runsOnlyLive')}</p>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] text-g-muted uppercase tracking-wider font-bold">
                <Send size={11} /> {t('partnerEngine.lastSent')}
              </div>
              {s ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-g-text">{tidSiden(s.ts)}</span>
                    <span className="px-1.5 py-0.5 border border-g-border/40 rounded text-[11px] text-g-muted font-bold">
                      {platformLabel(s.sentDiscord, s.sentTwitch, s.platform)}
                    </span>
                  </div>
                  {s.partnerName && <p className="text-xs text-g-muted">{s.partnerName}</p>}
                </div>
              ) : (
                <div>
                  <p className="text-sm text-g-muted/60">{t('partnerEngine.noRuns')}</p>
                  <p className="text-[11px] text-g-muted/40 mt-0.5">{t('partnerEngine.runsOnlyLive')}</p>
                </div>
              )}
            </div>
          </div>

          {/* 30-day summary */}
          {sammendrag && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: 'Promoer sendt', verdi: sammendrag.promoSendt30d,     farge: 'text-g-green' },
                { label: 'Hoppet over',   verdi: sammendrag.promoHoppet30d,    farge: 'text-yellow-400' },
                { label: 'Polls opprettet', verdi: sammendrag.pollOpprettet30d, farge: 'text-blue-400' },
                { label: 'Poll-resultater', verdi: sammendrag.pollResultater30d, farge: 'text-blue-300' },
              ].map(item => (
                <div key={item.label} className="bg-g-bg border border-g-border/40 rounded-lg p-2.5 text-center">
                  <div className={`text-xl font-black ${item.farge}`}>{item.verdi}</div>
                  <div className="text-[11px] text-g-muted mt-0.5">{item.label} (30d)</div>
                </div>
              ))}
            </div>
          )}

          {/* X post suggestion */}
          {sammendrag && (
            <div className="border border-g-border/40 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Share2 size={13} className="text-sky-400" />
                  <span className="text-[11px] text-g-muted uppercase tracking-wider font-bold">Foreslå X-innlegg</span>
                  {harIkkePromotert && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold text-yellow-400 border border-yellow-400/30 bg-yellow-400/10">
                      <AlertTriangle size={9} />
                      {sammendrag.dagSidenPromo !== null ? `${sammendrag.dagSidenPromo}d siden` : 'aldri sendt'}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => genererXForslag()}
                  disabled={lasterX}
                  className="px-3 py-1 rounded text-[11px] border border-sky-400/30 text-sky-400 hover:bg-sky-400/10 transition-all disabled:opacity-50">
                  {lasterX ? '⟳ Genererer...' : `Foreslå for ${sammendrag.foreslåXFor ?? 'partner'}`}
                </button>
              </div>

              {xForslag && (
                <div className="space-y-2">
                  <div className="bg-g-bg border border-g-border rounded-lg p-3">
                    <p className="text-xs text-g-text leading-relaxed whitespace-pre-wrap">{xForslag}</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-g-muted">For: {xPartner}</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => navigator.clipboard?.writeText(xForslag).catch(() => {})}
                        className="px-2 py-1 text-[11px] border border-g-border/40 rounded text-g-muted hover:text-g-text transition-colors">
                        Kopier
                      </button>
                      <button
                        onClick={() => genererXForslag(xPartner ?? undefined)}
                        disabled={lasterX}
                        className="px-2 py-1 text-[11px] border border-g-border/40 rounded text-g-muted hover:text-g-green transition-colors disabled:opacity-50">
                        Nytt forslag
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bot activity feed */}
          {botAktivitet.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] text-g-muted uppercase tracking-wider font-bold">
                <BarChart2 size={11} /> Bot-aktivitet (siste 30 dager)
              </div>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {botAktivitet.map((h, i) => {
                  const er_poll_resultat = h.type === 'POLL_RESULT_COLLECTED';
                  const vinner = er_poll_resultat ? pollVinner(h.metadata) : null;
                  const er_hoppet = h.type === 'PARTNER_PROMOTION_SKIPPED';

                  return (
                    <div key={i} className={`flex items-start gap-2 py-1.5 border-b border-g-border/20 last:border-0 ${er_hoppet ? 'opacity-50' : ''}`}>
                      <span className="flex-shrink-0 w-5 text-center text-sm">{HENDELSE_IKON[h.type] ?? '·'}</span>
                      <span className="text-[11px] text-g-muted flex-shrink-0 w-20 mt-0.5">
                        {new Date(h.ts).toLocaleDateString('no-NO', { day: '2-digit', month: '2-digit' })}
                        {' '}
                        {new Date(h.ts).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-g-text truncate">{hendelseLabel(h.type, h.metadata)}</p>
                        {vinner && <p className="text-[11px] text-g-green">{vinner}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Partner exposure bars */}
          {exp.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] text-g-muted uppercase tracking-wider font-bold">
                <TrendingUp size={11} /> {t('partnerEngine.partnerExposure')}
              </div>
              <div className="space-y-2">
                {exp.map(p => (
                  <div key={p.navn} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-g-text font-medium truncate max-w-[55%]">{p.navn}</span>
                        <button
                          onClick={() => genererXForslag(p.navn)}
                          disabled={lasterX}
                          className="flex-shrink-0 text-[11px] px-1.5 py-0.5 border border-sky-400/30 text-sky-400/70 hover:text-sky-400 hover:bg-sky-400/10 rounded transition-all disabled:opacity-30">
                          X-post
                        </button>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {p.sistePromotert
                          ? <span className="text-g-muted/60">{tidSiden(p.sistePromotert)}</span>
                          : <span className="text-yellow-400/60 text-[11px]">aldri sendt</span>
                        }
                        <span className="text-g-green font-black w-6 text-right">{p.eksponering}</span>
                      </div>
                    </div>
                    <div className="h-1 bg-g-border/30 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-g-green/60 rounded-full transition-all"
                        style={{ width: `${Math.max(4, (p.eksponering / maxExp) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
