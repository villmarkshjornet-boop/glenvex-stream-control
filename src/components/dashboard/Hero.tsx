'use client';

import Link from 'next/link';
import { tidSiden } from './helpers';
import type { HeroStream } from './types';

const CHECKLIST_LABELS: { key: keyof HeroStream['checklist']; label: string }[] = [
  { key: 'streamHistory',  label: 'Stream History' },
  { key: 'audienceData',   label: 'Audience-data' },
  { key: 'retentionCurve', label: 'Retention-kurve' },
  { key: 'chatEvents',     label: 'Chat-events' },
  { key: 'streamCoach',    label: 'Stream Coach' },
  { key: 'vodDetected',    label: 'VOD' },
  { key: 'aiLearning',     label: 'AI-læring' },
];

function formatDuration(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}t ${m}m` : `${m}m`;
}

export function Hero({ heroStream, loading }: { heroStream: HeroStream | null | undefined; loading: boolean }) {
  if (loading) return <div className="h-56 bg-g-card border border-g-border rounded-xl animate-pulse" />;

  if (!heroStream) {
    return (
      <div className="bg-g-card border border-g-border rounded-xl p-5">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-1">Siste stream</p>
        <p className="text-sm text-g-muted">Ingen avsluttet stream registrert ennå.</p>
        <Link href="/streamplan" className="text-[10px] text-g-green hover:underline mt-2 inline-block">Se streamplan →</Link>
      </div>
    );
  }

  const ok = heroStream.ok;

  return (
    <div className={`bg-g-card border rounded-xl p-5 ${ok ? 'border-g-green/30' : 'border-yellow-500/30'}`}>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full ${ok ? 'bg-g-green' : 'bg-yellow-400 animate-pulse'}`} />
            <p className={`text-xs font-black uppercase tracking-widest ${ok ? 'text-g-green' : 'text-yellow-400'}`}>
              {ok ? 'Stream gjennomført' : 'Stream avsluttet med avvik'}
            </p>
          </div>
          <p className="text-lg font-black text-g-text">{heroStream.title || heroStream.game}</p>
          <p className="text-[10px] text-g-muted">{heroStream.game} · avsluttet {tidSiden(heroStream.endedAt)}</p>
        </div>
        <div className="text-right">
          <p className="text-[8px] text-g-muted uppercase tracking-widest">Stream Score</p>
          <p className={`text-3xl font-black font-mono ${ok ? 'text-g-green' : 'text-yellow-400'}`}>{heroStream.streamScore}</p>
          <p className="text-[8px] text-g-muted/60">retention {heroStream.scoreBreakdown.retention}% · chat {heroStream.scoreBreakdown.chatIntensity}%</p>
        </div>
      </div>

      {!ok && heroStream.failureReasons.length > 0 && (
        <div className="mb-4 p-2.5 border border-yellow-500/30 bg-yellow-500/5 rounded-lg">
          <p className="text-[9px] text-yellow-400 font-bold uppercase tracking-widest mb-1">Mangler / avvik</p>
          <ul className="space-y-0.5">
            {heroStream.failureReasons.map((r, i) => (
              <li key={i} className="text-[10px] text-yellow-300">⚠ {r}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 mb-4">
        {[
          { label: 'Varighet', val: formatDuration(heroStream.durationMinutes) },
          { label: 'Peak', val: heroStream.peakViewers.toLocaleString() },
          { label: 'Snitt', val: heroStream.avgViewers.toLocaleString() },
          { label: 'Chat', val: heroStream.chatMessages.toLocaleString() },
        ].map(({ label, val }) => (
          <div key={label} className="text-center border border-g-border/30 rounded-lg py-1.5 px-2">
            <p className="text-sm font-black font-mono text-g-text">{val}</p>
            <p className="text-[8px] text-g-muted uppercase tracking-widest">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5 mb-4">
        {CHECKLIST_LABELS.map(({ key, label }) => {
          const done = heroStream.checklist[key];
          return (
            <div key={key} className={`text-center border rounded-lg py-1.5 px-1 ${done ? 'border-g-green/20 bg-g-green/5' : 'border-red-500/20 bg-red-500/5'}`}
              title={label}>
              <p className={`text-[10px] font-black ${done ? 'text-g-green' : 'text-red-400'}`}>{done ? '✓' : '✕'}</p>
              <p className="text-[7px] text-g-muted leading-tight mt-0.5 truncate">{label}</p>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2">
        <Link href={`/stream-coach?streamId=${encodeURIComponent(heroStream.streamId)}`}
          className="px-3 py-1.5 bg-g-green/10 border border-g-green/30 rounded-lg text-[10px] font-bold text-g-green hover:bg-g-green/20 transition-colors">
          Åpne Stream Coach →
        </Link>
        <Link href="/content-factory-admin"
          className="px-3 py-1.5 border border-g-border rounded-lg text-[10px] font-bold text-g-muted hover:text-g-text hover:border-g-border transition-colors">
          Åpne Content Factory →
        </Link>
      </div>
    </div>
  );
}
