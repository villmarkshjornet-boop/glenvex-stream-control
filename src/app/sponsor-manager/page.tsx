'use client';

import { useEffect, useState } from 'react';

interface SponsorData {
  score: number;
  avgViewers: number;
  peakViewers: number;
  followers: number;
  discordMembers: number;
  hoursStreamed: number;
  forbedringer: string[];
  sterktePunkter: string[];
  rapport: string;
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? '#00ff41' : score >= 40 ? '#ffd700' : '#ff4444';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-g-muted">Sponsor Readiness</span>
        <span className="font-black" style={{ color }}>{score}/100</span>
      </div>
      <div className="w-full bg-g-border rounded-full h-3">
        <div className="h-3 rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export default function SponsorManagerPage() {
  const [data, setData] = useState<SponsorData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/sponsor-report').then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Sponsor Manager</h1>
        <p className="text-xs text-g-muted mt-0.5">Gjør kanalen attraktiv for sponsorer – rapport og score</p>
      </div>

      {loading ? (
        <div className="bg-g-card border border-g-border rounded-lg p-8 text-center">
          <span className="w-6 h-6 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin inline-block" />
        </div>
      ) : !data ? (
        <p className="text-xs text-g-muted">Kunne ikke hente sponsor-data.</p>
      ) : (
        <>
          {/* Score */}
          <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-4">
            <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase">Sponsor Readiness Score</h2>
            <ScoreBar score={data.score} />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Snitt-seere', value: data.avgViewers },
              { label: 'Peak viewers', value: data.peakViewers },
              { label: 'Følgere', value: data.followers },
              { label: 'Discord', value: data.discordMembers },
              { label: 'Timer streamet', value: data.hoursStreamed },
              { label: 'Attraktivitet', value: `${data.score}%` },
            ].map(s => (
              <div key={s.label} className="bg-g-card border border-g-border rounded-lg p-4 text-center">
                <p className="text-[9px] text-g-muted uppercase tracking-widest">{s.label}</p>
                <p className="text-xl font-black text-g-green font-mono mt-1">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Rapport */}
          <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-4">
            <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase">AI Sponsorrapport</h2>
            <p className="text-xs text-g-text leading-relaxed font-mono whitespace-pre-wrap">{data.rapport}</p>
            <button onClick={() => {
              const blob = new Blob([data.rapport], { type: 'text/plain' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = 'GLENVEX-sponsor-rapport.txt'; a.click();
            }} className="px-4 py-2 border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
              ↓ Last ned rapport
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-g-card border border-g-border rounded-lg p-4">
              <p className="text-[10px] text-g-green uppercase tracking-widest font-bold mb-2">✓ Sterke punkter</p>
              {data.sterktePunkter.map((s, i) => <p key={i} className="text-xs text-g-text mb-1">{s}</p>)}
            </div>
            <div className="bg-g-card border border-g-border rounded-lg p-4">
              <p className="text-[10px] text-yellow-400 uppercase tracking-widest font-bold mb-2">⚠ Kan forbedres</p>
              {data.forbedringer.map((s, i) => <p key={i} className="text-xs text-g-text mb-1">{s}</p>)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
