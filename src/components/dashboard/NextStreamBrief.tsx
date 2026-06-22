'use client';

import { useEffect, useState } from 'react';
import type { BriefAction, NextStreamBriefData } from '@/app/api/next-stream-brief/route';

const STAR_COLOR: Record<1 | 2 | 3, string> = {
  3: 'text-g-green',
  2: 'text-amber-400',
  1: 'text-g-muted/40',
};

const CONFIDENCE_DOT: Record<BriefAction['confidence'], string> = {
  høy:     'bg-g-green',
  middels: 'bg-amber-400/70',
  lav:     'bg-g-muted/30',
};

export function NextStreamBrief() {
  const [data, setData] = useState<NextStreamBriefData | null>(null);

  useEffect(() => {
    fetch('/api/next-stream-brief')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setData(d))
      .catch(() => {});
  }, []);

  if (!data) return null;

  const durationLabel = data.avgStreamDurationMin
    ? `${Math.floor(data.avgStreamDurationMin / 60)}t${data.avgStreamDurationMin % 60 > 0 ? ` ${data.avgStreamDurationMin % 60}m` : ''} snitt`
    : null;

  // New user with no stream history — show onboarding starter plan
  if (data.isOnboarding) {
    const ONBOARDING_STEPS = [
      { n: 1, action: 'Koble Twitch-kanalen din', timing: 'Nå', note: 'Innstillinger → Twitch OAuth' },
      { n: 2, action: 'Koble Discord-serveren din', timing: 'Nå', note: 'Innstillinger → Discord bot' },
      { n: 3, action: 'Velg live-kanal og notifikasjonskanal', timing: 'Nå', note: 'Innstillinger → Kanaler' },
      { n: 4, action: 'Start din første stream', timing: 'Neste streamdag', note: 'Boten kobler til automatisk' },
      { n: 5, action: 'Post på X 10 min etter streamstart', timing: 'Første stream', note: 'AI Producer foreslår tekst' },
      { n: 6, action: 'Kjør første viewer-poll etter 20 min', timing: 'Første stream', note: 'Engasjerer chat tidlig' },
    ];

    return (
      <section className="bg-g-card border border-g-green/10 rounded-2xl p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-base font-black text-g-text">Hva gjør jeg nå?</p>
            <p className="text-xs text-amber-400/70 mt-0.5">
              Lite historikk ennå — dette er standard oppstartsplan
            </p>
          </div>
          <span className="text-[10px] text-g-green/40 uppercase tracking-widest font-bold mt-0.5">
            AI Produsent
          </span>
        </div>

        <ol className="space-y-3">
          {ONBOARDING_STEPS.map(s => (
            <li key={s.n} className="flex gap-3 items-start">
              <span className="text-[11px] font-black text-g-muted/25 w-4 flex-shrink-0 mt-0.5 text-right select-none">
                {s.n}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-g-text/80 leading-tight">{s.action}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-g-muted/50">{s.timing}</span>
                  <span className="text-g-muted/20">·</span>
                  <span className="text-[10px] text-g-muted/40">{s.note}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <p className="text-[10px] text-g-muted/30 mt-4 pt-3 border-t border-g-border/20">
          Etter din første stream tilpasser AI Producer anbefalingene basert på din data.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-g-card border border-g-green/15 rounded-2xl p-5">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <p className="text-base font-black text-g-text">Hva gjør jeg nå?</p>
          <p className="text-xs text-g-muted/50 mt-0.5">
            For neste stream
            {data.basedOnStreams >= 2 && (
              <span className="ml-1">· basert på {data.basedOnStreams} streams</span>
            )}
            {durationLabel && (
              <span className="ml-1">· {durationLabel}</span>
            )}
          </p>
        </div>
        <span className="text-[10px] text-g-green/50 uppercase tracking-widest font-bold mt-0.5">
          AI Produsent
        </span>
      </div>

      {/* Action list */}
      <ol className="space-y-4">
        {data.actions.map((a, i) => (
          <li key={a.id} className="flex gap-3 items-start">
            <span className="text-[11px] font-black text-g-muted/25 w-4 flex-shrink-0 mt-0.5 text-right select-none">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-bold text-g-text leading-tight">{a.action}</span>
                {a.expectedEffect && (
                  <span className="text-xs text-g-green font-semibold">{a.expectedEffect}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                <span className={`text-[10px] font-black tracking-tight ${STAR_COLOR[a.stars]}`}>
                  {'★'.repeat(a.stars)}{'☆'.repeat(3 - a.stars)}
                </span>
                <span className="text-[11px] text-g-muted/70 font-medium">{a.timing}</span>
                <span className="text-g-muted/20">·</span>
                <span className="text-[10px] text-g-muted/50 leading-tight">{a.reason}</span>
                <div className="flex items-center gap-1 ml-auto flex-shrink-0">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${CONFIDENCE_DOT[a.confidence]}`} />
                  <span className="text-[9px] text-g-muted/30 uppercase tracking-wider">{a.dataSource}</span>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {data.basedOnStreams < 3 && (
        <p className="text-[10px] text-g-muted/30 mt-4 pt-3 border-t border-g-border/20">
          Anbefalingene blir mer presise etter flere streams. Nå basert på {data.basedOnStreams === 1 ? '1 stream' : `${data.basedOnStreams} streams`}.
        </p>
      )}
    </section>
  );
}
