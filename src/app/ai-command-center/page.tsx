'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface SubScores { community: number; growth: number; content: number; sponsor: number; }
interface Prioritet { tekst: string; prioritet: 'kritisk' | 'høy' | 'middels' | 'lav'; kategori: string; }
interface ACData {
  performanceScore: number;
  subScores: SubScores;
  prioriteter: Prioritet[];
  communityInsights: { mvp?: string; mvpBeskrivelse?: string; vokserRaskt?: string; inaktive: number; totalAktive: number; };
  streamIntelligence: { fungerteBra: string[]; fungerteIkke: string[]; børTestes: string[]; toppInsikt: string; };
  contentIntelligence: { besteKlipp?: string; viralKandidat?: string; børRepubliseres?: string; innholdsgap: string; };
  growthEngine: { discordPost: string; poll: string; tiktok: string; youtubeShortsIdé: string; streamIdé: string; };
  viewerPrediction: { spill: string; tid: string; forventetØkning: string; begrunnelse: string; };
  sponsorScore: number;
  sponsorInsikt: string;
  partnerAnbefaling: string;
  dagligHandlingsplan: string[];
  liveMode: boolean;
  liveData?: { viewers: number; spill: string; tittel: string; chatScore: string; hypeRekomendasjon: string; };
  manglerData: string[];
  generertKl: string;
}

const PRIORITET_STIL = {
  kritisk: { border: 'border-red-500/40', bg: 'bg-red-500/10', text: 'text-red-400', badge: 'bg-red-500/20 border-red-500/30 text-red-400' },
  høy: { border: 'border-yellow-400/40', bg: 'bg-yellow-400/10', text: 'text-yellow-400', badge: 'bg-yellow-400/20 border-yellow-400/30 text-yellow-400' },
  middels: { border: 'border-blue-400/30', bg: 'bg-blue-400/5', text: 'text-blue-400', badge: 'bg-blue-400/20 border-blue-400/30 text-blue-400' },
  lav: { border: 'border-g-border', bg: 'bg-g-bg', text: 'text-g-muted', badge: 'bg-g-bg border-g-border text-g-muted' },
};

function ScoreRing({ score, label, color, size = 80 }: { score: number; label: string; color: string; size?: number }) {
  const r = size * 0.38;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={size*0.09} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={size*0.09}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`}
          style={{ transition: 'stroke-dashoffset 1.5s ease', filter: `drop-shadow(0 0 6px ${color}40)` }} />
        <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="middle"
          fill="white" fontSize={size*0.22} fontWeight="bold" fontFamily="monospace">{score}</text>
      </svg>
      <p className="text-[9px] text-g-muted uppercase tracking-widest text-center">{label}</p>
    </div>
  );
}

function Skeleton({ h = 4, w = 'full' }: { h?: number; w?: string }) {
  return <div className={`h-${h} w-${w} bg-g-border/50 rounded animate-pulse`} />;
}

export default function AICommandCenterPage() {
  const [data, setData] = useState<ACData | null>(null);
  const [loading, setLoading] = useState(true);
  const [feil, setFeil] = useState('');
  const [aktivTab, setAktivTab] = useState<'prioriteter' | 'community' | 'stream' | 'innhold' | 'vekst' | 'sponsor'>('prioriteter');

  const hent = useCallback(async () => {
    setLoading(true);
    setFeil('');
    try {
      const res = await fetch('/api/ai-command-center');
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e) {
      setFeil((e as Error).message.slice(0, 100));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    hent();
    // Auto-refresh hvert 5. min
    const id = setInterval(hent, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [hent]);

  return (
    <div className="max-w-5xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">AI Command Center</h1>
          <p className="text-[10px] text-g-muted mt-0.5">Systemhjernen til GLENVEX Creator OS · Analyserer all data automatisk</p>
        </div>
        <div className="flex items-center gap-3">
          {data?.generertKl && (
            <p className="text-[9px] text-g-muted">
              Generert {new Date(data.generertKl).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          <button onClick={hent} disabled={loading}
            className="px-3 py-1.5 border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
            {loading ? '...' : '↻ Analyser'}
          </button>
        </div>
      </div>

      {/* Live Mode Banner */}
      {data?.liveMode && data.liveData && (
        <div className="bg-g-card border border-red-500/30 rounded-xl p-5 flex items-center gap-5"
          style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(0,0,0,0) 100%)' }}>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="w-3 h-3 rounded-full bg-red-400 animate-pulse" />
            <span className="text-red-400 font-black text-sm uppercase tracking-widest">LIVE</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-g-text">{data.liveData.spill} – {data.liveData.tittel}</p>
            <p className="text-[10px] text-g-muted mt-0.5">Chat-aktivitet: <span className="text-g-green font-bold">{data.liveData.chatScore}</span></p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-2xl font-black text-red-400 font-mono">{data.liveData.viewers}</p>
            <p className="text-[9px] text-g-muted">seere</p>
          </div>
          <div className="max-w-xs p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex-shrink-0">
            <p className="text-[9px] text-red-400 font-bold uppercase mb-0.5">◆ AI Anbefaling nå</p>
            <p className="text-xs text-g-text">{data.liveData.hypeRekomendasjon}</p>
          </div>
        </div>
      )}

      {/* Performance Scores */}
      <div className="bg-g-card border border-g-border rounded-xl p-6">
        {loading ? (
          <div className="flex justify-around">
            {[1,2,3,4,5].map(i => <div key={i} className="w-20 h-20 rounded-full bg-g-border/30 animate-pulse" />)}
          </div>
        ) : data ? (
          <div className="flex justify-around flex-wrap gap-4">
            <ScoreRing score={data.performanceScore} label="Performance" color="#00ff41" size={90} />
            <ScoreRing score={data.subScores.community} label="Community" color="#00ff41" />
            <ScoreRing score={data.subScores.growth} label="Growth" color="#00aaff" />
            <ScoreRing score={data.subScores.content} label="Content" color="#ff8800" />
            <ScoreRing score={data.subScores.sponsor} label="Sponsor" color="#ffd700" />
          </div>
        ) : feil ? (
          <p className="text-xs text-red-400 text-center">{feil}</p>
        ) : null}
      </div>

      {/* Daily Action Plan */}
      {data?.dagligHandlingsplan && (
        <div className="bg-g-card border border-g-green/20 rounded-xl p-5"
          style={{ background: 'linear-gradient(135deg, rgba(0,255,65,0.05) 0%, rgba(0,0,0,0) 100%)' }}>
          <p className="text-[9px] text-g-green uppercase tracking-widest font-bold mb-4">◆ Dagens Handlingsplan</p>
          <div className="space-y-2">
            {data.dagligHandlingsplan.map((handling, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-g-bg border border-g-border rounded-lg hover:border-g-green/20 transition-all">
                <div className="w-6 h-6 rounded-full bg-g-green/10 border border-g-green/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-g-green font-black text-xs">{i + 1}</span>
                </div>
                <p className="text-xs text-g-text leading-relaxed">{handling}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-g-card border border-g-border rounded-xl overflow-hidden">
        <div className="flex border-b border-g-border overflow-x-auto">
          {[
            { id: 'prioriteter', label: 'Prioriteringer' },
            { id: 'community', label: 'Community' },
            { id: 'stream', label: 'Stream Intel' },
            { id: 'innhold', label: 'Innhold' },
            { id: 'vekst', label: 'Vekst' },
            { id: 'sponsor', label: 'Sponsor' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setAktivTab(tab.id as any)}
              className={`px-4 py-2.5 text-xs font-bold tracking-wider whitespace-nowrap transition-all border-b-2 ${
                aktivTab === tab.id ? 'text-g-green border-g-green bg-g-green/5' : 'text-g-muted border-transparent hover:text-g-text'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {loading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-12 bg-g-border/30 rounded-lg animate-pulse" />)}
            </div>
          ) : !data ? null : (

            <>
              {/* Prioriteringer */}
              {aktivTab === 'prioriteter' && (
                <div className="space-y-2">
                  {data.prioriteter.length === 0 ? (
                    <p className="text-xs text-g-muted">Ingen prioriteringer generert ennå.</p>
                  ) : data.prioriteter.map((p, i) => {
                    const stil = PRIORITET_STIL[p.prioritet];
                    return (
                      <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${stil.border} ${stil.bg}`}>
                        <span className={`text-[8px] px-2 py-0.5 rounded-full border font-black uppercase tracking-wider flex-shrink-0 mt-0.5 ${stil.badge}`}>
                          {p.prioritet}
                        </span>
                        <p className={`text-xs font-semibold ${stil.text}`}>{p.tekst}</p>
                        <span className="text-[8px] text-g-muted ml-auto flex-shrink-0 mt-0.5">{p.kategori}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Community */}
              {aktivTab === 'community' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'Aktive membres', value: data.communityInsights.totalAktive },
                      { label: 'Inaktive', value: data.communityInsights.inaktive },
                      { label: 'MVP', value: data.communityInsights.mvp ?? '–' },
                    ].map(s => (
                      <div key={s.label} className="bg-g-bg border border-g-border rounded-lg p-3 text-center">
                        <p className="text-[9px] text-g-muted uppercase tracking-widest">{s.label}</p>
                        <p className="text-sm font-black text-g-green font-mono mt-1">{s.value}</p>
                      </div>
                    ))}
                  </div>
                  {data.communityInsights.mvpBeskrivelse && (
                    <div className="p-3 bg-g-bg border border-g-green/20 rounded-lg border-l-2 border-l-g-green">
                      <p className="text-[9px] text-g-green font-bold uppercase mb-1">👑 MVP Innsikt</p>
                      <p className="text-xs text-g-text">{data.communityInsights.mvpBeskrivelse}</p>
                    </div>
                  )}
                  {data.communityInsights.vokserRaskt && (
                    <div className="p-3 bg-g-bg border border-blue-400/20 rounded-lg border-l-2 border-l-blue-400">
                      <p className="text-[9px] text-blue-400 font-bold uppercase mb-1">📈 Vokser raskest</p>
                      <p className="text-xs text-g-text">{data.communityInsights.vokserRaskt}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Stream Intelligence */}
              {aktivTab === 'stream' && (
                <div className="space-y-4">
                  {data.streamIntelligence.toppInsikt && (
                    <div className="p-4 bg-g-bg border-l-2 border-l-g-green rounded-r-lg">
                      <p className="text-[9px] text-g-green font-bold uppercase mb-1">◆ Viktigste funn</p>
                      <p className="text-sm text-g-text font-semibold">{data.streamIntelligence.toppInsikt}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: '✓ Fungerte bra', items: data.streamIntelligence.fungerteBra, color: 'text-g-green' },
                      { label: '✗ Fungerte ikke', items: data.streamIntelligence.fungerteIkke, color: 'text-red-400' },
                      { label: '↻ Bør testes', items: data.streamIntelligence.børTestes, color: 'text-blue-400' },
                    ].map(({ label, items, color }) => (
                      <div key={label} className="bg-g-bg border border-g-border rounded-lg p-3">
                        <p className={`text-[9px] font-bold uppercase tracking-widest mb-2 ${color}`}>{label}</p>
                        <ul className="space-y-1">{items.map((item, i) => (
                          <li key={i} className="text-xs text-g-text">{item}</li>
                        ))}</ul>
                      </div>
                    ))}
                  </div>
                  <div className="p-4 bg-g-bg border border-g-green/20 rounded-xl">
                    <p className="text-[9px] text-g-muted uppercase tracking-widest mb-2">Viewer Prediction – Neste stream</p>
                    <div className="flex items-center gap-4">
                      <div>
                        <p className="text-xs text-g-muted">Anbefalt spill</p>
                        <p className="text-sm font-black text-g-green">{data.viewerPrediction.spill}</p>
                      </div>
                      <div>
                        <p className="text-xs text-g-muted">Tid</p>
                        <p className="text-sm font-black text-g-green">{data.viewerPrediction.tid}</p>
                      </div>
                      <div>
                        <p className="text-xs text-g-muted">Forventet</p>
                        <p className="text-sm font-black text-g-green">{data.viewerPrediction.forventetØkning}</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-g-muted mt-2 italic">{data.viewerPrediction.begrunnelse}</p>
                  </div>
                </div>
              )}

              {/* Innhold */}
              {aktivTab === 'innhold' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Beste clip', value: data.contentIntelligence.besteKlipp },
                      { label: 'Viral kandidat', value: data.contentIntelligence.viralKandidat },
                      { label: 'Bør republiseres', value: data.contentIntelligence.børRepubliseres },
                      { label: 'Innholdsgap', value: data.contentIntelligence.innholdsgap },
                    ].filter(s => s.value).map(s => (
                      <div key={s.label} className="bg-g-bg border border-g-border rounded-lg p-3">
                        <p className="text-[9px] text-g-muted uppercase tracking-widest">{s.label}</p>
                        <p className="text-xs text-g-text mt-1">{s.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">◆ Vekst-ideer i dag</p>
                    {Object.entries(data.growthEngine).map(([k, v]) => (
                      <div key={k} className="flex items-start gap-3 p-3 bg-g-bg border border-g-border rounded-lg">
                        <span className="text-[8px] text-g-muted border border-g-border rounded px-1.5 py-0.5 uppercase flex-shrink-0">{k === 'discordPost' ? 'Discord' : k === 'poll' ? 'Poll' : k === 'tiktok' ? 'TikTok' : k === 'youtubeShortsIdé' ? 'YouTube' : 'Stream'}</span>
                        <p className="text-xs text-g-text">{v}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Vekst */}
              {aktivTab === 'vekst' && (
                <div className="space-y-3">
                  <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Vekstmuligheter generert av AI</p>
                  {[
                    { ikon: '💬', type: 'Discord', idé: data.growthEngine.discordPost },
                    { ikon: '📊', type: 'Poll', idé: data.growthEngine.poll },
                    { ikon: '📱', type: 'TikTok', idé: data.growthEngine.tiktok },
                    { ikon: '▶️', type: 'YouTube Shorts', idé: data.growthEngine.youtubeShortsIdé },
                    { ikon: '🎮', type: 'Stream', idé: data.growthEngine.streamIdé },
                  ].map(({ ikon, type, idé }) => (
                    <div key={type} className="flex items-start gap-3 p-4 bg-g-bg border border-g-border rounded-xl hover:border-g-green/20 transition-all">
                      <span className="text-xl flex-shrink-0">{ikon}</span>
                      <div>
                        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">{type}</p>
                        <p className="text-xs text-g-text mt-0.5 leading-relaxed">{idé}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Sponsor */}
              {aktivTab === 'sponsor' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-6">
                    <ScoreRing score={data.sponsorScore} label="Sponsor Score" color="#ffd700" size={90} />
                    <div className="flex-1">
                      <p className="text-xs text-g-text leading-relaxed">{data.sponsorInsikt}</p>
                    </div>
                  </div>
                  {data.partnerAnbefaling && (
                    <div className="p-4 bg-g-bg border border-yellow-400/20 rounded-lg border-l-2 border-l-yellow-400">
                      <p className="text-[9px] text-yellow-400 font-bold uppercase mb-1">◇ Partner-anbefaling</p>
                      <p className="text-xs text-g-text">{data.partnerAnbefaling}</p>
                    </div>
                  )}
                  <Link href="/sponsor-manager"
                    className="block px-4 py-2.5 text-center border border-g-border rounded-lg text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                    Se full sponsorrapport →
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Mangler data */}
      {(data?.manglerData?.length ?? 0) > 0 && (
        <div className="bg-g-card border border-g-border rounded-xl p-4">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Data som mangler (samles over tid)</p>
          <div className="flex gap-2 flex-wrap">
            {data!.manglerData.map((m, i) => (
              <span key={i} className="text-[9px] px-2 py-1 bg-g-bg border border-g-border rounded text-g-muted">{m}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
