'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface ServiceCheck { navn: string; status: string; detaljer?: string; }
interface EnvCheck { key: string; label: string; status: string; gruppe: string; }

interface HealthData {
  helseScore: number;
  tjenester: ServiceCheck[];
  envSjekk: EnvCheck[];
  manglerKritiske: number;
  advarsler: string[];
  dbStatus: string;
  timestamp: string;
}

function StatusDot({ status }: { status: string }) {
  const farge = status === 'ok' ? 'bg-g-green' : status === 'ukjent' ? 'bg-yellow-400' : status === 'valgfri' ? 'bg-g-muted' : 'bg-red-400';
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${farge}`} />;
}

function StatusBadge({ status }: { status: string }) {
  const stil = {
    ok: 'text-g-green border-g-green/30 bg-g-green/10',
    feil: 'text-red-400 border-red-400/30 bg-red-400/10',
    ukjent: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
    mangler: 'text-red-400 border-red-400/30 bg-red-400/10',
    valgfri: 'text-g-muted border-g-border bg-g-bg',
    tilkoblet: 'text-g-green border-g-green/30 bg-g-green/10',
    ikke_konfigurert: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
  }[status] ?? 'text-g-muted border-g-border bg-g-bg';

  return (
    <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider ${stil}`}>
      {status === 'ok' ? '✓ OK' : status === 'feil' ? '✗ FEIL' : status === 'mangler' ? '✗ MANGLER' : status === 'valgfri' ? 'Valgfri' : status}
    </span>
  );
}

export default function SystemHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [aktivGruppe, setAktivGruppe] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/system-health').then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const grupper = data ? Array.from(new Set(data.envSjekk.map(e => e.gruppe))) : [];
  const scoreColor = (data?.helseScore ?? 0) >= 80 ? '#00ff41' : (data?.helseScore ?? 0) >= 50 ? '#ffd700' : '#ff4444';

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">System Health</h1>
          <p className="text-xs text-g-muted mt-0.5">Full oversikt over hva som fungerer og hva som mangler</p>
        </div>
        <Link href="/setup-wizard" className="px-3 py-2 bg-g-green/10 border border-g-green/20 text-g-green text-xs font-bold rounded hover:bg-g-green/20 transition-all">
          ◆ Setup Wizard
        </Link>
      </div>

      {loading ? (
        <div className="bg-g-card border border-g-border rounded-xl p-12 text-center">
          <span className="w-8 h-8 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin inline-block" />
          <p className="text-xs text-g-muted mt-4">Sjekker alle systemer...</p>
        </div>
      ) : !data ? (
        <p className="text-xs text-red-400">Kunne ikke hente systemstatus.</p>
      ) : (
        <>
          {/* Helse-score */}
          <div className="bg-g-card border border-g-border rounded-xl p-6 flex items-center gap-6">
            <div className="relative w-20 h-20 flex-shrink-0">
              <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                <circle cx="40" cy="40" r="32" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
                <circle cx="40" cy="40" r="32" fill="none" stroke={scoreColor} strokeWidth="8"
                  strokeDasharray={`${(data.helseScore / 100) * 201} 201`} strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-xl font-black font-mono" style={{ color: scoreColor }}>{data.helseScore}</p>
              </div>
            </div>
            <div>
              <p className="text-sm font-black text-g-text">System Health Score</p>
              <p className="text-xs text-g-muted mt-0.5">
                {data.helseScore >= 80 ? 'Systemet kjører godt.' : data.helseScore >= 50 ? 'Noen ting mangler – se advarsler.' : 'Kritiske problemer – systemet er ikke fullt operativt.'}
              </p>
              <p className="text-[9px] text-g-muted mt-1">Sjekket {new Date(data.timestamp).toLocaleTimeString('no-NO')}</p>
            </div>
          </div>

          {/* Kritiske advarsler */}
          {data.advarsler.length > 0 && (
            <div className="bg-g-card border border-red-500/20 rounded-xl p-5 space-y-2">
              <p className="text-[9px] text-red-400 uppercase tracking-widest font-bold mb-3">⚠ Advarsler og feil</p>
              {data.advarsler.map((a, i) => (
                <div key={i} className={`flex items-start gap-2 p-3 rounded-lg border ${
                  a.startsWith('KRITISK') ? 'border-red-500/30 bg-red-500/10' : a.startsWith('VIKTIG') ? 'border-yellow-400/20 bg-yellow-400/5' : 'border-g-border bg-g-bg'
                }`}>
                  <span className="text-xs mt-0.5 flex-shrink-0">{a.startsWith('KRITISK') ? '🔴' : a.startsWith('VIKTIG') ? '🟡' : '🔵'}</span>
                  <p className="text-xs text-g-text">{a}</p>
                </div>
              ))}
            </div>
          )}

          {/* Tjenestestatus */}
          <div className="bg-g-card border border-g-border rounded-xl p-5">
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-4">Tjenester</p>
            <div className="space-y-3">
              {data.tjenester.map(t => (
                <div key={t.navn} className="flex items-center gap-3">
                  <StatusDot status={t.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-g-text">{t.navn}</p>
                    {t.detaljer && <p className="text-[9px] text-g-muted mt-0.5">{t.detaljer}</p>}
                  </div>
                  <StatusBadge status={t.status} />
                </div>
              ))}
            </div>
          </div>

          {/* Database-status */}
          <div className={`bg-g-card border rounded-xl p-5 ${data.dbStatus === 'tilkoblet' ? 'border-g-green/20' : 'border-yellow-400/20'}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-g-text">Supabase Database</p>
                <p className="text-[9px] text-g-muted mt-0.5">
                  {data.dbStatus === 'tilkoblet'
                    ? '✓ Tilkoblet – Railway og Vercel deler data'
                    : 'Ikke konfigurert – Railway og Vercel bruker separate filsystemer'}
                </p>
              </div>
              <StatusBadge status={data.dbStatus} />
            </div>
            {data.dbStatus !== 'tilkoblet' && (
              <div className="mt-4 p-3 bg-g-bg border border-g-border rounded-lg">
                <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Slik setter du opp Supabase (3 steg):</p>
                <ol className="text-xs text-g-text space-y-1">
                  <li>1. Gå til <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="text-g-green hover:underline">supabase.com</a> – lag gratis konto og nytt prosjekt</li>
                  <li>2. Gå til SQL Editor – kjør innholdet i <code className="text-g-green">supabase/schema.sql</code></li>
                  <li>3. Legg til i <strong>Vercel</strong> og <strong>Railway</strong>:</li>
                </ol>
                <div className="mt-2 p-2 bg-g-card rounded font-mono text-[9px] text-g-green space-y-0.5">
                  <p>SUPABASE_URL=https://xxxxx.supabase.co</p>
                  <p>SUPABASE_SERVICE_ROLE_KEY=eyJhbGciO...</p>
                </div>
              </div>
            )}
          </div>

          {/* Environment Variables */}
          <div className="bg-g-card border border-g-border rounded-xl p-5">
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-4">
              Environment Variables ({data.envSjekk.filter(e => e.status === 'ok').length}/{data.envSjekk.filter(e => e.status !== 'valgfri').length} satt)
            </p>
            <div className="flex gap-2 flex-wrap mb-4">
              <button onClick={() => setAktivGruppe(null)} className={`px-2 py-1 text-[9px] font-bold uppercase rounded border transition-all ${!aktivGruppe ? 'border-g-green/30 text-g-green bg-g-green/10' : 'border-g-border text-g-muted'}`}>Alle</button>
              {grupper.map(g => (
                <button key={g} onClick={() => setAktivGruppe(aktivGruppe === g ? null : g)}
                  className={`px-2 py-1 text-[9px] font-bold uppercase rounded border transition-all ${aktivGruppe === g ? 'border-g-green/30 text-g-green bg-g-green/10' : 'border-g-border text-g-muted'}`}>
                  {g}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {data.envSjekk
                .filter(e => !aktivGruppe || e.gruppe === aktivGruppe)
                .map(e => (
                  <div key={e.key} className="flex items-center gap-3 py-1.5 border-b border-g-border/20 last:border-0">
                    <StatusDot status={e.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-g-text">{e.label}</p>
                      <p className="text-[9px] text-g-muted font-mono">{e.key}</p>
                    </div>
                    <StatusBadge status={e.status} />
                  </div>
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
