'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Eye, Users, MessageSquare, Clock, AlertTriangle, ArrowRight, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { tidSiden } from './helpers';
import type { HeroStream } from './types';

const GRADE_STYLE: Record<HeroStream['grade'], { text: string; ring: string; glow: string }> = {
  S: { text: 'text-purple-400', ring: 'ring-purple-500/30', glow: 'shadow-purple-500/20' },
  A: { text: 'text-g-green',    ring: 'ring-g-green/30',    glow: 'shadow-g-green/20' },
  B: { text: 'text-blue-400',   ring: 'ring-blue-500/30',   glow: 'shadow-blue-500/20' },
  C: { text: 'text-yellow-400', ring: 'ring-yellow-500/30', glow: 'shadow-yellow-500/20' },
  D: { text: 'text-red-400',    ring: 'ring-red-500/30',    glow: 'shadow-red-500/20' },
};

function formatDuration(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}t ${m}m` : `${m}m`;
}

export function Hero({ heroStream, loading }: { heroStream: HeroStream | null | undefined; loading: boolean }) {
  if (loading) return <div className="h-64 bg-g-card border border-g-border rounded-2xl animate-pulse" />;

  if (!heroStream) {
    return (
      <div className="bg-g-card border border-g-border rounded-2xl p-8 text-center">
        <p className="text-sm text-g-muted">Ingen avsluttet stream registrert ennå.</p>
        <Link href="/streamplan" className="text-xs text-g-green hover:underline mt-2 inline-block">Se streamplan →</Link>
      </div>
    );
  }

  const grade = GRADE_STYLE[heroStream.grade];
  const isEstimate = !heroStream.checklist.streamHistory;

  const stats = [
    { label: 'Peak seere', val: heroStream.peakViewers.toLocaleString(), icon: Eye },
    { label: 'Snitt seere', val: heroStream.avgViewers.toLocaleString(), icon: Users },
    { label: 'Unike chattere', val: heroStream.uniqueChatters.toLocaleString(), icon: Users },
    { label: 'Meldinger', val: heroStream.chatMessages.toLocaleString(), icon: MessageSquare },
    { label: 'Varighet', val: formatDuration(heroStream.durationMinutes), icon: Clock },
  ];

  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-8 shadow-lg shadow-black/30">
      <div className="flex items-start justify-between flex-wrap gap-6">
        <div className="min-w-0">
          <p className="text-xs text-g-muted uppercase tracking-widest font-bold mb-2">Siste stream</p>
          <h2 className="text-2xl font-black text-g-text truncate max-w-xl">{heroStream.title || heroStream.game}</h2>
          <p className="text-sm text-g-muted mt-1">{heroStream.game} · avsluttet {tidSiden(heroStream.endedAt)}</p>
          {isEstimate && (
            <p className="flex items-center gap-1.5 text-xs text-yellow-400 mt-2">
              <AlertTriangle size={13} /> {heroStream.historyMissingReason ?? 'Estimert fra hendelseslogg – Stream History-rad mangler'}
            </p>
          )}
        </div>

        {heroStream.dataIntegrity?.status === 'broken' && heroStream.streamScore === 0 ? (
          <div className="flex flex-col items-center justify-center w-32 h-32 rounded-full ring-4 ring-red-500/20 flex-shrink-0 bg-red-950/10">
            <AlertTriangle size={22} className="text-red-400/50" />
            <p className="text-[10px] text-red-400/60 font-bold mt-1.5 text-center leading-tight">Teknisk<br/>feil</p>
          </div>
        ) : (
          <div className={`flex flex-col items-center justify-center w-32 h-32 rounded-full ring-4 ${grade.ring} shadow-xl ${grade.glow} flex-shrink-0`}>
            <p className={`text-5xl font-black leading-none ${grade.text}`}>{heroStream.streamScore}</p>
            <p className={`text-xs font-bold mt-1 ${grade.text}`}>Grade {heroStream.grade}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-8">
        {stats.map(({ label, val, icon: Icon }) => (
          <div key={label} className="border border-g-border/40 rounded-xl py-3 px-3">
            <Icon size={14} className="text-g-muted mb-2" />
            <p className="text-lg font-black text-g-text">{val}</p>
            <p className="text-[11px] text-g-muted">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mt-6">
        <Link href={`/stream-coach?streamId=${encodeURIComponent(heroStream.streamId)}`}
          className="flex items-center gap-1.5 px-4 py-2 bg-g-green/10 border border-g-green/30 rounded-lg text-xs font-bold text-g-green hover:bg-g-green/20 transition-colors">
          Åpne Stream Coach <ArrowRight size={13} />
        </Link>
        <Link href="/content-factory-admin"
          className="px-4 py-2 border border-g-border rounded-lg text-xs font-bold text-g-muted hover:text-g-text hover:border-g-border transition-colors">
          Åpne Content Factory
        </Link>
      </div>

      <DataIntegrityCard integrity={heroStream.dataIntegrity} />
    </div>
  );
}

function DataIntegrityCard({ integrity }: { integrity: HeroStream['dataIntegrity'] | undefined }) {
  const [showDetails, setShowDetails] = useState(false);
  if (!integrity || integrity.status === 'full') return null;

  const { status, botStatus, missingDataReasons, repairedSources = [] } = integrity;
  const isManualRepair = botStatus === 'manual_repair';
  const isBreaking     = status === 'broken';

  const iconColor  = isManualRepair ? 'text-blue-400' : isBreaking ? 'text-red-400' : 'text-yellow-400';
  const badge      = isManualRepair ? '∼ Delvis reparert'
                   : isBreaking     ? '⚠ Delvis datagrunnlag'
                   :                  '⚠ Delvis datagrunnlag';
  const summary    = isManualRepair
    ? 'Reparert manuelt med Twitch email summary.'
    : isBreaking
    ? `Boten ${botStatus === 'crashed' ? 'krasjet' : botStatus === 'offline' ? 'var offline' : botStatus === 'auth_failed' ? 'hadde autentiseringsfeil (401)' : 'var utilgjengelig'} under streamen. Denne rapporten er ikke komplett.`
    : 'Noen data mangler for denne streamen.';

  return (
    <div className="mt-5 pt-4 border-t border-g-border/30">
      <div className="flex items-center gap-2">
        <span className={`text-[11px] font-bold ${iconColor}`}>{badge}</span>
        <span className="text-[11px] text-g-muted/60">— {summary}</span>
        <button
          onClick={() => setShowDetails(v => !v)}
          className="ml-auto text-[10px] text-g-muted/40 hover:text-g-muted transition-colors underline underline-offset-2 flex-shrink-0"
        >
          {showDetails ? 'Skjul detaljer' : 'Vis tekniske detaljer'}
        </button>
      </div>

      {showDetails && (
        <div className={`mt-3 rounded-xl border p-4 space-y-3 ${
          isManualRepair ? 'border-blue-500/30 bg-blue-950/10'
          : isBreaking   ? 'border-red-500/30 bg-red-950/10'
          :                'border-yellow-500/30 bg-yellow-950/10'
        }`}>
          {repairedSources.length > 0 && (
            <div className="space-y-1.5">
              {repairedSources.map((r, i) => (
                <div key={i} className="bg-blue-950/30 border border-blue-500/20 rounded-lg p-2.5 text-[11px]">
                  <div className="flex items-start gap-2">
                    <ShieldCheck size={11} className="text-blue-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-blue-300 font-medium">✓ {r.source}</span>
                      {r.note && <p className="text-blue-300/60 mt-0.5 font-mono">{r.note}</p>}
                      <p className="text-g-muted/40 mt-0.5">Reparert {new Date(r.repairedAt).toLocaleString('no')}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {missingDataReasons.length > 0 && (
            <div className="space-y-2">
              {repairedSources.length > 0 && (
                <p className="text-[10px] text-g-muted/40 uppercase tracking-wider font-bold">Mangler fortsatt:</p>
              )}
              {missingDataReasons.map((r, i) => (
                <div key={i} className="bg-black/20 rounded-lg p-2.5 text-[11px]">
                  <div className="flex items-start gap-2">
                    <ShieldAlert size={11} className="text-g-muted/60 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-g-text/80 font-medium">{r.source}</span>
                      <span className="text-g-muted/60"> — forventet: </span>
                      <span className="text-yellow-300/80 font-mono">{r.expected}</span>
                      <p className="text-g-muted/60 mt-0.5">{r.reason}</p>
                      {r.lastSeen && (
                        <p className="text-g-muted/40 mt-0.5">Sist sett: {new Date(r.lastSeen).toLocaleString('no')}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
