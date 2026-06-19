'use client';

import { useEffect, useState } from 'react';

interface ScoreKomponent { navn: string; maks: number; oppnådd: number; mangler: string | null; }
interface Milestone { poeng: number; label: string; nådd: boolean; }
interface PeriodeData { streams: number; avgV: number; peakV: number; hoursStr: number; followersGained: number; klipp: number; }

interface PartnerHistorikkRad {
  navn: string;
  promoer30d: number;
  promoerTotalt: number;
  sisteSendt: string | null;
  godkjentRate: number | null;
  avvisninger: number;
  dataStyrke: 'god' | 'moderat' | 'svak';
  aktiv: boolean | null;
}

interface SponsorData {
  score: number;
  dataErSvak: boolean;
  avgViewers: number;
  peakViewers: number;
  followers: number;
  discordMembers: number;
  hoursStreamed: number;
  trends: { avgViewers: '↑'|'↓'|'→'; streams: '↑'|'↓'|'→'; klipp: '↑'|'↓'|'→'; followers: '↑'|'↓'|'→' };
  periode: { p7: PeriodeData; p30: PeriodeData; p90: PeriodeData };
  scoreKomponenter: ScoreKomponent[];
  milestones: Milestone[];
  nesteMillestone: Milestone | null;
  rapport: string;
  sterktePunkter: string[];
  forbedringer: string[];
  pitchEmail: string;
  pitchOneLiner: string;
  malgruppe: string;
  hvaOkerScoren: string;
  hvaRedusererScoren: string;
  trend: { followerGrowthLast30d: number; avgViewersLast30d: number; streamsLast30d: number; topSpill: string[] };
  contentStats: { ferdigeVods: number; totaleKlipp: number; aktivePartnere: number; streamsHistorikk: number; aiMemoryStreams: number };
  partnerHistorikk: PartnerHistorikkRad[];
  partnerTotaler: { totalePromoer: number; totaleForslag: number; promoer30d: number; godkjentRate: number | null; mestAktiv: string | null };
}

type Fane = '7d' | '30d' | '90d';

function trendFarge(t: '↑'|'↓'|'→') { return t === '↑' ? '#00ff41' : t === '↓' ? '#ff4444' : '#888'; }

function ScoreBar({ score }: { score: number }) {
  const color = score >= 75 ? '#00ff41' : score >= 50 ? '#ffd700' : score >= 25 ? '#ff8c00' : '#ff4444';
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-end">
        <span className="text-[10px] text-g-muted uppercase tracking-widest">Sponsor Readiness Score</span>
        <span className="text-3xl font-black font-mono" style={{ color }}>{score}<span className="text-sm text-g-muted">/100</span></span>
      </div>
      <div className="relative w-full bg-g-border rounded-full h-4">
        {[25, 50, 75].map(p => (
          <div key={p} className="absolute top-0 bottom-0 w-px bg-black/40" style={{ left: `${p}%` }} />
        ))}
        <div className="h-4 rounded-full transition-all duration-700" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <div className="flex justify-between text-[9px] text-g-muted/60">
        <span>Nybegynner</span><span>Etablert</span><span>Seriøs</span><span>Klar</span>
      </div>
    </div>
  );
}

function PeriodeKort({ label, data }: { label: string; data: PeriodeData }) {
  if (!data) return null;
  return (
    <div className="bg-g-sidebar border border-g-border rounded-lg p-4 space-y-2">
      <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {[
          { l: 'Streams', v: data.streams ?? 0 },
          { l: 'Snitt-seere', v: data.avgV ?? 0 },
          { l: 'Peak', v: data.peakV ?? 0 },
          { l: 'Timer', v: `${data.hoursStr ?? 0}t` },
          { l: 'Nye følgere', v: `+${data.followersGained ?? 0}` },
          { l: 'Klipp', v: data.klipp ?? 0 },
        ].map(s => (
          <div key={s.l} className="text-center">
            <p className="text-[8px] text-g-muted/70 uppercase tracking-wider">{s.l}</p>
            <p className="text-sm font-black font-mono text-g-green">{s.v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SponsorManagerPage() {
  const [data, setData] = useState<SponsorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fane, setFane] = useState<Fane>('30d');
  const [visEmail, setVisEmail] = useState(false);

  useEffect(() => {
    fetch('/api/sponsor-report').then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-8">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Sponsor Manager</h1>
        <p className="text-xs text-g-muted mt-0.5">Sponsorrapport, score og veksthistorikk</p>
      </div>

      {loading ? (
        <div className="bg-g-card border border-g-border rounded-lg p-12 flex items-center justify-center">
          <div className="text-center space-y-2">
            <span className="w-8 h-8 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin inline-block" />
            <p className="text-xs text-g-muted">Henter statistikk og genererer rapport...</p>
          </div>
        </div>
      ) : !data ? (
        <p className="text-xs text-g-muted p-4">Kunne ikke hente sponsor-data.</p>
      ) : data.dataErSvak ? (
        <div className="bg-g-card border border-yellow-400/20 rounded-lg p-8 text-center space-y-2">
          <p className="text-yellow-400 font-bold">⚠ Datagrunnlaget er foreløpig for svakt.</p>
          <p className="text-xs text-g-muted">Kjør flere streams for mer nøyaktig analyse. Du trenger minst 3 registrerte streams og noen følgere.</p>
        </div>
      ) : (
        <>
          {/* Score + one-liner */}
          <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-4">
            <ScoreBar score={data.score} />
            {data.pitchOneLiner && (
              <p className="text-xs text-g-green font-mono italic border-l-2 border-g-green/30 pl-3">&ldquo;{data.pitchOneLiner}&rdquo;</p>
            )}
          </div>

          {/* Milestones */}
          <div className="bg-g-card border border-g-border rounded-lg p-4">
            <p className="text-[10px] text-g-muted uppercase tracking-widest font-bold mb-3">Milestones</p>
            <div className="flex items-center gap-0">
              {data.milestones.map((m, i) => (
                <div key={m.poeng} className="flex-1 flex items-center">
                  <div className="flex flex-col items-center gap-1 w-full">
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all ${m.nådd ? 'bg-g-green/20 border-g-green text-g-green' : 'border-g-border text-g-muted'}`}>
                      {m.nådd ? '✓' : m.poeng}
                    </div>
                    <p className={`text-[8px] text-center ${m.nådd ? 'text-g-green' : 'text-g-muted/50'}`}>{m.label}</p>
                  </div>
                  {i < data.milestones.length - 1 && <div className={`h-px flex-1 mx-1 ${m.nådd ? 'bg-g-green/40' : 'bg-g-border'}`} />}
                </div>
              ))}
            </div>
            {data.nesteMillestone && (
              <p className="text-[10px] text-g-muted mt-3">Neste: <span className="text-g-text">{data.nesteMillestone.label}</span> ({data.nesteMillestone.poeng} poeng)</p>
            )}
          </div>

          {/* Score breakdown */}
          <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-3">
            <p className="text-[10px] text-g-muted uppercase tracking-widest font-bold">Score Breakdown</p>
            <div className="space-y-2">
              {data.scoreKomponenter.map(k => (
                <div key={k.navn} className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex justify-between text-[10px] mb-0.5">
                      <span className="text-g-muted">{k.navn}</span>
                      <span className="font-mono text-g-text">{k.oppnådd}/{k.maks}</span>
                    </div>
                    <div className="w-full bg-g-border rounded-full h-1.5">
                      <div className="h-1.5 rounded-full transition-all" style={{ width: `${(k.oppnådd / k.maks) * 100}%`, backgroundColor: k.oppnådd >= k.maks * 0.8 ? '#00ff41' : k.oppnådd >= k.maks * 0.4 ? '#ffd700' : '#ff8c00' }} />
                    </div>
                  </div>
                  {k.mangler && <span className="text-[9px] text-g-muted/60 w-32 text-right flex-shrink-0">{k.mangler}</span>}
                </div>
              ))}
            </div>
            {(data.hvaOkerScoren || data.hvaRedusererScoren) && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-g-border">
                {data.hvaOkerScoren && (
                  <div>
                    <p className="text-[9px] text-g-green uppercase font-bold mb-1">Øker score</p>
                    <p className="text-[10px] text-g-text leading-relaxed">{data.hvaOkerScoren}</p>
                  </div>
                )}
                {data.hvaRedusererScoren && (
                  <div>
                    <p className="text-[9px] text-yellow-400 uppercase font-bold mb-1">Holder tilbake</p>
                    <p className="text-[10px] text-g-text leading-relaxed">{data.hvaRedusererScoren}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Historikk-tabs */}
          <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-g-muted uppercase tracking-widest font-bold">Veksthistorikk</p>
              <div className="flex gap-1">
                {(['7d', '30d', '90d'] as Fane[]).map(f => (
                  <button key={f} onClick={() => setFane(f)} className={`px-3 py-1 text-[10px] rounded border transition-all ${fane === f ? 'border-g-green/30 bg-g-green/10 text-g-green' : 'border-g-border text-g-muted hover:text-g-text'}`}>{f}</button>
                ))}
              </div>
            </div>
            {fane === '7d'  && <PeriodeKort label="Siste 7 dager"  data={data.periode?.p7} />}
            {fane === '30d' && <PeriodeKort label="Siste 30 dager" data={data.periode?.p30} />}
            {fane === '90d' && <PeriodeKort label="Siste 90 dager" data={data.periode?.p90} />}

            {/* Trends */}
            <div className="grid grid-cols-4 gap-2 pt-2 border-t border-g-border">
              {[
                { label: 'Seere',    t: data.trends.avgViewers },
                { label: 'Streams',  t: data.trends.streams },
                { label: 'Klipp',    t: data.trends.klipp },
                { label: 'Følgere',  t: data.trends.followers },
              ].map(({ label, t }) => (
                <div key={label} className="text-center">
                  <p className="text-[8px] text-g-muted uppercase">{label}</p>
                  <p className="text-xl font-bold" style={{ color: trendFarge(t as any) }}>{t}</p>
                </div>
              ))}
            </div>
            {data.trend.topSpill.length > 0 && (
              <p className="text-[10px] text-g-muted">Topp spill: <span className="text-g-text">{data.trend.topSpill.join(', ')}</span></p>
            )}
          </div>

          {/* Stats-grid */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Følgere',        value: data.followers.toLocaleString('no-NO'), trend: data.trends.followers },
              { label: 'Snitt-seere',    value: data.avgViewers, trend: data.trends.avgViewers },
              { label: 'Peak seere',     value: data.peakViewers },
              { label: 'Discord',        value: data.discordMembers.toLocaleString('no-NO') },
              { label: 'Timer streamet', value: `${data.hoursStreamed}t` },
              { label: 'Klipp publisert', value: data.contentStats.totaleKlipp, trend: data.trends.klipp },
            ].map(s => (
              <div key={s.label} className="bg-g-card border border-g-border rounded-lg p-4 text-center">
                <p className="text-[9px] text-g-muted uppercase tracking-widest">{s.label}</p>
                <div className="flex items-center justify-center gap-1 mt-1">
                  <p className="text-xl font-black text-g-green font-mono">{s.value}</p>
                  {s.trend && <span className="text-sm font-bold" style={{ color: trendFarge(s.trend as any) }}>{s.trend}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Sterke punkter + Forbedringer */}
          {(data.sterktePunkter.length > 0 || data.forbedringer.length > 0) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-g-card border border-g-border rounded-lg p-4 space-y-1.5">
                <p className="text-[10px] text-g-green uppercase tracking-widest font-bold mb-2">✓ Sterke punkter</p>
                {data.sterktePunkter.map((s, i) => <p key={i} className="text-[11px] text-g-text leading-snug">{s}</p>)}
              </div>
              <div className="bg-g-card border border-g-border rounded-lg p-4 space-y-1.5">
                <p className="text-[10px] text-yellow-400 uppercase tracking-widest font-bold mb-2">⚠ Kan forbedres</p>
                {data.forbedringer.map((s, i) => <p key={i} className="text-[11px] text-g-text leading-snug">{s}</p>)}
              </div>
            </div>
          )}

          {/* Rapport */}
          {data.rapport && (
            <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] text-g-muted font-semibold tracking-widest uppercase">AI Sponsorrapport</h2>
                <button onClick={() => {
                  const blob = new Blob([data.rapport], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = 'sponsor-rapport.txt'; a.click();
                }} className="px-3 py-1 border border-g-border rounded text-[10px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                  ↓ Last ned
                </button>
              </div>
              <p className="text-[11px] text-g-text leading-relaxed font-mono whitespace-pre-wrap">{data.rapport}</p>
            </div>
          )}

          {/* Målgruppe */}
          {data.malgruppe && (
            <div className="bg-g-card border border-g-border rounded-lg p-4">
              <p className="text-[10px] text-g-muted uppercase tracking-widest font-bold mb-2">Målgruppe</p>
              <p className="text-xs text-g-text leading-relaxed">{data.malgruppe}</p>
            </div>
          )}

          {/* Pitch e-post */}
          {data.pitchEmail && (
            <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] text-g-muted font-semibold tracking-widest uppercase">Pitch e-post</h2>
                <button onClick={() => setVisEmail(v => !v)} className="px-3 py-1 border border-g-border rounded text-[10px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                  {visEmail ? 'Skjul' : 'Vis e-post'}
                </button>
              </div>
              {visEmail && (
                <div className="space-y-2">
                  <pre className="text-[10px] text-g-text leading-relaxed whitespace-pre-wrap font-mono bg-g-sidebar rounded p-3 border border-g-border">{data.pitchEmail}</pre>
                  <button onClick={() => navigator.clipboard.writeText(data.pitchEmail)} className="px-3 py-1 border border-g-border rounded text-[10px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                    Kopier tekst
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Partner-historikk */}
          {data.partnerHistorikk?.length > 0 && (
            <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] text-g-muted font-semibold tracking-widest uppercase">Partner-historikk (ekte data)</h2>
                {data.partnerTotaler && (
                  <span className="text-[10px] text-g-muted/60">
                    {data.partnerTotaler.totalePromoer} promoer totalt
                    {data.partnerTotaler.godkjentRate !== null && ` · ${data.partnerTotaler.godkjentRate}% godkjent`}
                  </span>
                )}
              </div>

              {/* Totaler */}
              {data.partnerTotaler && (
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Promoer siste 30d', value: data.partnerTotaler.promoer30d },
                    { label: 'Totale forslag',    value: data.partnerTotaler.totaleForslag },
                    { label: 'Mest aktiv',         value: data.partnerTotaler.mestAktiv ?? '–' },
                  ].map(s => (
                    <div key={s.label} className="bg-g-sidebar border border-g-border rounded p-3 text-center">
                      <p className="text-[8px] text-g-muted uppercase tracking-wider">{s.label}</p>
                      <p className="text-sm font-black text-g-green font-mono mt-0.5 truncate">{s.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Per-partner tabell */}
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b border-g-border/40">
                      {['Partner', 'Promoer 30d', 'Totalt', 'Siste sendt', 'Godkjent %', 'Avvisninger', 'Datagrunnlag'].map(h => (
                        <th key={h} className="py-1.5 pr-3 text-left text-[9px] text-g-muted uppercase tracking-wider font-bold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-g-border/20">
                    {data.partnerHistorikk
                      .sort((a, b) => b.promoerTotalt - a.promoerTotalt)
                      .map(p => {
                        const daysSince = p.sisteSendt
                          ? Math.floor((Date.now() - new Date(p.sisteSendt).getTime()) / 86_400_000)
                          : null;
                        return (
                          <tr key={p.navn} className={`${!p.aktiv ? 'opacity-40' : ''}`}>
                            <td className="py-2 pr-3 font-bold text-g-text">{p.navn}</td>
                            <td className="py-2 pr-3 font-mono text-g-green">{p.promoer30d}</td>
                            <td className="py-2 pr-3 font-mono text-g-muted">{p.promoerTotalt}</td>
                            <td className="py-2 pr-3 text-g-muted">
                              {daysSince !== null ? `${daysSince}d siden` : <span className="text-g-muted/40">aldri</span>}
                            </td>
                            <td className="py-2 pr-3">
                              {p.godkjentRate !== null
                                ? <span className={p.godkjentRate >= 70 ? 'text-g-green font-bold' : p.godkjentRate >= 40 ? 'text-yellow-400' : 'text-red-400'}>{p.godkjentRate}%</span>
                                : <span className="text-g-muted/40">–</span>}
                            </td>
                            <td className="py-2 pr-3 text-g-muted">{p.avvisninger > 0 ? p.avvisninger : '–'}</td>
                            <td className="py-2 pr-3">
                              <span className={`px-1.5 py-0.5 border rounded text-[9px] font-bold ${
                                p.dataStyrke === 'god'     ? 'text-g-green border-g-green/30 bg-g-green/10' :
                                p.dataStyrke === 'moderat' ? 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10' :
                                                             'text-g-muted/50 border-g-border/30'
                              }`}>{p.dataStyrke}</span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              <p className="text-[9px] text-g-muted/40">
                Basert på partner_content_log og partner_proposals · siste 90 dager
              </p>
            </div>
          )}

          {/* AI Memory info */}
          {data.contentStats.aiMemoryStreams > 0 && (
            <p className="text-[10px] text-g-muted/50 text-right">
              Analyse basert på {data.contentStats.aiMemoryStreams} streams i AI Memory · {data.contentStats.streamsHistorikk} streams i historikk
            </p>
          )}
        </>
      )}
    </div>
  );
}
