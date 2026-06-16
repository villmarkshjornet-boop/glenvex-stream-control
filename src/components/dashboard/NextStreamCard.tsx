'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { tidSiden } from './helpers';
import type { LiveData } from './types';

const PRE_HYPE_LABEL: Record<string, string> = {
  sendt: '✓ Pre-hype sendt',
  planlagt: '⏳ Pre-hype planlagt',
  klar: '🔔 Pre-hype klar',
  ikke_planlagt: 'Pre-hype ikke satt opp',
};
const PRE_HYPE_COLOR: Record<string, string> = {
  sendt: 'text-g-green border-g-green/20',
  planlagt: 'text-yellow-300 border-yellow-400/20',
  klar: 'text-blue-300 border-blue-400/20',
  ikke_planlagt: 'text-g-muted border-g-border',
};

export function NextStreamCard({ nesteStream, preHype, loading }: {
  nesteStream: LiveData['nesteStream']; preHype: LiveData['preHype']; loading: boolean;
}) {
  const [nedtelling, setNedtelling] = useState<string | null>(null);

  useEffect(() => {
    if (!nesteStream?.tidspunkt) { setNedtelling(null); return; }
    const oppdater = () => {
      const ms = new Date(nesteStream.tidspunkt!).getTime() - Date.now();
      if (ms <= 0) { setNedtelling('Nå'); return; }
      const t = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), s = Math.floor((ms % 60_000) / 1000);
      if (t >= 24)  setNedtelling(`${Math.floor(t / 24)}d ${t % 24}t`);
      else if (t > 0) setNedtelling(`${t}t ${m}m`);
      else          setNedtelling(`${m}m ${s}s`);
    };
    oppdater();
    const id = setInterval(oppdater, 1000);
    return () => clearInterval(id);
  }, [nesteStream?.tidspunkt]);

  if (loading) return <div className="h-24 bg-g-card border border-g-border rounded-xl animate-pulse" />;

  if (!nesteStream) {
    return (
      <div className="bg-g-card border border-g-border rounded-xl p-4">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-1">Neste stream</p>
        <p className="text-[11px] text-g-muted">Ingen streamplan satt opp ennå.</p>
        <Link href="/streamplan" className="text-[10px] text-g-green hover:underline mt-1 inline-block">Rediger streamplan →</Link>
      </div>
    );
  }

  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Neste stream</p>
        <Link href="/streamplan" className="text-[9px] text-g-muted hover:text-g-green transition-colors">Rediger streamplan →</Link>
      </div>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm font-black text-g-text">{nesteStream.dag} kl. {nesteStream.tid} · {nesteStream.spill}</p>
          {nesteStream.tittel && <p className="text-[10px] text-g-muted">{nesteStream.tittel}</p>}
        </div>
        {nedtelling && <span className="font-mono font-black text-g-green text-lg">{nedtelling}</span>}
      </div>
      {preHype && preHype.status !== 'ikke_planlagt' && (
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-g-border/30">
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${PRE_HYPE_COLOR[preHype.status] ?? 'text-g-muted'}`}>
            {PRE_HYPE_LABEL[preHype.status]}
          </span>
          {preHype.status === 'planlagt' && preHype.tidTilUtsending && (
            <span className="text-[9px] text-g-muted">Om {preHype.tidTilUtsending}</span>
          )}
          {preHype.status === 'sendt' && preHype.sendtAt && (
            <span className="text-[9px] text-g-muted">{tidSiden(preHype.sendtAt)}</span>
          )}
        </div>
      )}
    </div>
  );
}
