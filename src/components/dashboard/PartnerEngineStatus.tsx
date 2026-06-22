'use client';

import { useEffect, useState, useCallback } from 'react';
import { Activity, Send, TrendingUp } from 'lucide-react';
import { tidSiden } from './helpers';

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
}

const REASON_LABEL: Record<string, string> = {
  PROPOSAL_CREATED:    'Forslag opprettet',
  AUTO_SENT:           'Auto-sendt',
  BOT_DISABLED:        'Bot deaktivert',
  NO_CHANNELS_ENABLED: 'Ingen kanaler aktivert',
  MAX_POSTS_REACHED:   'Maks promoer nådd',
  COOLDOWN_ACTIVE:     'Cooldown aktiv',
  CHAT_TOO_ACTIVE:     'Chat for aktiv',
  RAID_COOLDOWN:       'Raid-cooldown',
  NO_ACTIVE_PARTNERS:  'Ingen aktive partnere',
  LOW_SCORE:           'For lav score',
};

const TRIGGER_LABEL: Record<string, string> = {
  chat_silence:  'Chat-stillhet',
  viewer_peak:   'Seer-topp',
  context_match: 'Konteksttreff',
  timer:         'Timer',
  manual:        'Manuell',
  none:          '—',
};

function platformLabel(sentDiscord: boolean | null, sentTwitch: boolean | null, platform: string | null): string {
  if (sentDiscord && sentTwitch) return 'Discord + Twitch';
  if (sentDiscord) return 'Discord';
  if (sentTwitch) return 'Twitch';
  if (platform) return platform;
  return '—';
}

export function PartnerEngineStatus() {
  const [status, setStatus] = useState<EngineStatus | null>(null);

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

  if (!status) return null;

  const { sistVurdert: v, sistSendt: s, partnerEksponering: exp } = status;
  const maxExp = Math.max(...exp.map(p => p.eksponering), 1);

  // Show nothing if there's genuinely no data yet
  if (!v && !s && exp.length === 0) return null;

  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-6 space-y-5">
      <p className="text-xs text-g-muted uppercase tracking-widest font-bold">Partner Engine Status</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Sist vurdert */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-g-muted uppercase tracking-wider font-bold">
            <Activity size={11} /> Siste vurdering
          </div>
          {v ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-g-text">
                  {tidSiden(v.ts)}
                </span>
                <span className={`px-1.5 py-0.5 border rounded text-[10px] font-bold ${
                  v.eventType === 'PARTNER_PROMOTION_CONSIDERED'
                    ? 'text-g-green border-g-green/30 bg-g-green/10'
                    : 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10'
                }`}>
                  {v.reasonCode ? (REASON_LABEL[v.reasonCode] ?? v.reasonCode) : '—'}
                </span>
              </div>
              {v.partnerName && (
                <p className="text-xs text-g-muted">
                  {v.partnerName}
                  {v.score != null && <span className="text-g-green font-bold ml-1">{Math.round(v.score * 100)}%</span>}
                  {v.triggerType && <span className="ml-1 text-g-muted/60">· {TRIGGER_LABEL[v.triggerType] ?? v.triggerType}</span>}
                </p>
              )}
            </div>
          ) : (
            <div>
              <p className="text-sm text-g-muted/60">Ingen aktive kjøringer</p>
              <p className="text-[10px] text-g-muted/40 mt-0.5">Kjører kun under aktive streams</p>
            </div>
          )}
        </div>

        {/* Sist sendt */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-g-muted uppercase tracking-wider font-bold">
            <Send size={11} /> Siste utsendelse
          </div>
          {s ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-g-text">{tidSiden(s.ts)}</span>
                <span className="px-1.5 py-0.5 border border-g-border/40 rounded text-[10px] text-g-muted font-bold">
                  {platformLabel(s.sentDiscord, s.sentTwitch, s.platform)}
                </span>
              </div>
              {s.partnerName && <p className="text-xs text-g-muted">{s.partnerName}</p>}
            </div>
          ) : (
            <div>
              <p className="text-sm text-g-muted/60">Ingen utsendelser registrert</p>
              <p className="text-[10px] text-g-muted/40 mt-0.5">Sender kun under aktive streams</p>
            </div>
          )}
        </div>
      </div>

      {/* Partner eksponering */}
      {exp.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] text-g-muted uppercase tracking-wider font-bold">
            <TrendingUp size={11} /> Eksponering (aktive partnere)
          </div>
          <div className="space-y-2">
            {exp.map(p => (
              <div key={p.navn} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-g-text font-medium truncate max-w-[60%]">{p.navn}</span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {p.sistePromotert
                      ? <span className="text-g-muted/60">{tidSiden(p.sistePromotert)}</span>
                      : <span className="text-g-muted/40">aldri sendt</span>
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
  );
}
