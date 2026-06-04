'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface BotSettings {
  tone: string;
  pauseDiscord: boolean;
  pauseTwitch: boolean;
  pausePartnerPromo: boolean;
  pauseLiveVarsler: boolean;
  aktiv: boolean;
}

interface MemoryEntry { type: string; innhold: string; dato: string; }
interface ContentItem { id: string; tittel: string; type: string; status: string; opprettet: string; publisert?: string; }
interface PlanItem { dato: string; type: string; tittel: string; beskrivelse: string; prioritet: string; }

const TONER = [
  { id: 'dark_gaming', label: '🌑 Dark Gaming', desc: 'Mørk, rå og ufiltrert' },
  { id: 'cinematic', label: '🎬 Cinematic', desc: 'Dramatisk og filmisk' },
  { id: 'humoristisk', label: '😄 Humoristisk', desc: 'Lett og morsom' },
  { id: 'hype', label: '⚡ Hype', desc: 'Ekstremt energisk' },
  { id: 'rp_stil', label: '🎭 RP-stil', desc: 'Fortellende og karakterdrevet' },
  { id: 'profesjonell', label: '💼 Profesjonell', desc: 'Ryddig og informativ' },
];

export default function DiscordControlPage() {
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [drafts, setDrafts] = useState<ContentItem[]>([]);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [planAnalyse, setPlanAnalyse] = useState('');
  const [historikk, setHistorikk] = useState<ContentItem[]>([]);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lagrer, setLagrer] = useState(false);

  const hent = async () => {
    setLoading(true);
    const [sRes, dRes] = await Promise.all([
      fetch('/api/bot-settings').then(r => r.json()),
      fetch('/api/content-library?drafts=true').then(r => r.json()),
    ]);
    setSettings(sRes.settings);
    setMemory(sRes.memory ?? []);
    setDrafts(dRes ?? []);
    setLoading(false);
  };

  const hentPlan = async () => {
    setLoadingPlan(true);
    const res = await fetch('/api/content-plan').then(r => r.json()).catch(() => ({}));
    setPlan(res.plan ?? []);
    setPlanAnalyse(res.analyse ?? '');
    setHistorikk(res.historikk ?? []);
    setLoadingPlan(false);
  };

  useEffect(() => { hent(); hentPlan(); }, []);

  async function oppdater(updates: Partial<BotSettings>) {
    if (!settings) return;
    const ny = { ...settings, ...updates };
    setSettings(ny);
    setLagrer(true);
    await fetch('/api/bot-settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
    setLagrer(false);
  }

  if (loading) return <div className="max-w-4xl mx-auto p-8 text-center"><span className="w-6 h-6 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin inline-block" /></div>;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Discord Control Center</h1>
          <p className="text-xs text-g-muted mt-0.5">Botens personlighet, pauser, minne og ventende innhold</p>
        </div>
        {lagrer && <span className="text-[10px] text-g-green animate-pulse">Lagrer...</span>}
      </div>

      {/* Master pause */}
      <div className={`border rounded-xl p-5 ${settings?.aktiv ? 'border-g-green/20 bg-g-green/5' : 'border-red-500/20 bg-red-500/10'}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-black text-g-text">Bot-status</p>
            <p className="text-xs text-g-muted mt-0.5">{settings?.aktiv ? 'Alle systemer aktive' : 'Bot er satt på pause'}</p>
          </div>
          <button onClick={() => oppdater({ aktiv: !settings?.aktiv })}
            className={`px-5 py-2.5 rounded-lg font-bold text-xs transition-all ${
              settings?.aktiv ? 'bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30' : 'bg-g-green/20 border border-g-green/30 text-g-green hover:bg-g-green/30'
            }`}>
            {settings?.aktiv ? '⏸ Pause alt' : '▶ Aktiver bot'}
          </button>
        </div>
      </div>

      {/* Individuelle pauser */}
      <div className="bg-g-card border border-g-border rounded-xl p-5">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">Individuelle kontroller</h2>
        <div className="space-y-3">
          {[
            { felt: 'pauseDiscord', label: 'Discord-publisering', desc: 'Stopp alle Discord-poster fra boten' },
            { felt: 'pauseTwitch', label: 'Twitch chat-meldinger', desc: 'Stopp automatiske chat-meldinger' },
            { felt: 'pausePartnerPromo', label: 'Partner-promotering', desc: 'Stopp automatisk partner-posting' },
            { felt: 'pauseLiveVarsler', label: 'Live-varsler', desc: 'Stopp auto live-embed på Discord' },
          ].map(({ felt, label, desc }) => (
            <div key={felt} className="flex items-center justify-between py-2 border-b border-g-border/40 last:border-0">
              <div>
                <p className="text-xs font-bold text-g-text">{label}</p>
                <p className="text-[9px] text-g-muted">{desc}</p>
              </div>
              <button onClick={() => oppdater({ [felt]: !(settings as any)?.[felt] })}
                className={`w-10 h-5 rounded-full transition-all relative flex-shrink-0 ${
                  (settings as any)?.[felt] ? 'bg-red-500/60' : 'bg-g-green/60'
                }`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${(settings as any)?.[felt] ? 'left-0.5' : 'left-5'}`} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Tone / Personlighet */}
      <div className="bg-g-card border border-g-border rounded-xl p-5">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">Bot-personlighet</h2>
        <div className="grid grid-cols-3 gap-2">
          {TONER.map(t => (
            <button key={t.id} onClick={() => oppdater({ tone: t.id as any })}
              className={`p-3 rounded-lg border text-left transition-all ${
                settings?.tone === t.id ? 'border-g-green/30 bg-g-green/10' : 'border-g-border hover:border-g-green/20 bg-g-bg'
              }`}>
              <p className="text-xs font-bold text-g-text">{t.label}</p>
              <p className="text-[9px] text-g-muted mt-0.5">{t.desc}</p>
              {settings?.tone === t.id && <p className="text-[9px] text-g-green mt-1">✓ Aktiv</p>}
            </button>
          ))}
        </div>
      </div>

      {/* Ventende drafts */}
      <div className="bg-g-card border border-g-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase">
            Ventende innhold {drafts.length > 0 && <span className="ml-2 bg-yellow-400/20 text-yellow-400 text-[9px] px-1.5 py-0.5 rounded-full font-bold">{drafts.length}</span>}
          </h2>
          <Link href="/discord-library" className="text-[9px] text-g-muted hover:text-g-green transition-colors">Se alle →</Link>
        </div>
        {drafts.length === 0 ? (
          <p className="text-xs text-g-muted">Ingen ventende drafts.</p>
        ) : (
          <div className="space-y-2">
            {drafts.slice(0, 5).map(d => (
              <div key={d.id} className="flex items-center gap-3 py-2 border-b border-g-border/30 last:border-0">
                <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase ${
                  d.status === 'klar' ? 'text-blue-400 border-blue-400/30' : 'text-g-muted border-g-border'
                }`}>{d.status}</span>
                <p className="text-xs text-g-text flex-1 truncate">{d.tittel}</p>
                <Link href="/discord-library" className="text-[9px] text-g-green hover:underline flex-shrink-0">Rediger →</Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Innholdsplan */}
      <div className="bg-g-card border border-g-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase">AI Innholdsplan</h2>
          <button onClick={hentPlan} disabled={loadingPlan}
            className="text-[9px] text-g-muted hover:text-g-green transition-colors">
            {loadingPlan ? 'Analyserer...' : '↻ Oppdater'}
          </button>
        </div>

        {planAnalyse && (
          <div className="p-3 bg-g-bg border-l-2 border-l-g-green rounded-r-lg">
            <p className="text-[9px] text-g-green uppercase tracking-widest font-bold mb-1">◆ AI-analyse</p>
            <p className="text-xs text-g-text leading-relaxed">{planAnalyse}</p>
          </div>
        )}

        {plan.length > 0 && (
          <div>
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Anbefalte innlegg denne uken</p>
            <div className="space-y-2">
              {plan.map((p, i) => {
                const pFarge = p.prioritet === 'høy' ? 'border-l-g-green text-g-green' : p.prioritet === 'medium' ? 'border-l-yellow-400 text-yellow-400' : 'border-l-g-muted text-g-muted';
                return (
                  <div key={i} className={`flex items-start gap-3 p-3 bg-g-bg border-l-2 rounded-r-lg ${pFarge.split(' ')[0]}`}>
                    <div className="flex-shrink-0 text-right w-16">
                      <p className="text-[9px] text-g-muted">{new Date(p.dato).toLocaleDateString('no-NO', { weekday: 'short', day: 'numeric' })}</p>
                      <span className={`text-[8px] font-bold uppercase ${pFarge.split(' ')[1]}`}>{p.prioritet}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-g-text">{p.tittel}</p>
                      <p className="text-[9px] text-g-muted mt-0.5">{p.beskrivelse}</p>
                      <span className="text-[8px] text-g-muted border border-g-border rounded px-1.5 py-0.5 mt-1 inline-block">{p.type}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {loadingPlan && (
          <div className="flex items-center gap-2 py-2">
            <span className="w-3 h-3 border border-g-green/30 border-t-g-green rounded-full animate-spin" />
            <p className="text-xs text-g-muted">Genererer innholdsplan...</p>
          </div>
        )}
      </div>

      {/* Publiseringshistorikk */}
      {historikk.length > 0 && (
        <div className="bg-g-card border border-g-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase">Publiseringshistorikk</h2>
            <Link href="/discord-library" className="text-[9px] text-g-muted hover:text-g-green transition-colors">Se alt →</Link>
          </div>
          <div className="space-y-1.5">
            {historikk.filter(h => h.status === 'publisert').slice(0, 8).map((h, i) => (
              <div key={i} className="flex items-center gap-3 py-1.5 border-b border-g-border/20 last:border-0">
                <span className="text-[8px] px-1.5 py-0.5 bg-g-green/10 text-g-green border border-g-green/20 rounded font-bold uppercase flex-shrink-0">{h.type}</span>
                <p className="text-xs text-g-text flex-1 truncate">{h.tittel}</p>
                <p className="text-[9px] text-g-muted flex-shrink-0">
                  {new Date(h.publisert ?? h.opprettet).toLocaleDateString('no-NO')}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bot-minne (anti-repetisjon) */}
      <div className="bg-g-card border border-g-border rounded-xl p-5">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">Bot-minne (anti-repetisjon)</h2>
        {memory.length === 0 ? (
          <p className="text-xs text-g-muted">Ingen historikk ennå. Boten lagrer hva den publiserer for å unngå gjentagelse.</p>
        ) : (
          <div className="space-y-1.5 max-h-36 overflow-y-auto">
            {memory.map((m, i) => (
              <div key={i} className="flex items-start gap-2 py-1 border-b border-g-border/20 last:border-0">
                <span className="text-[9px] text-g-muted font-mono flex-shrink-0 w-16 pt-0.5">{m.type}</span>
                <p className="text-[10px] text-g-text flex-1 truncate">{m.innhold}</p>
                <p className="text-[9px] text-g-muted flex-shrink-0">{new Date(m.dato).toLocaleDateString('no-NO')}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { href: '/discord-library', label: 'Discord Library', desc: 'Alt innhold boten har laget' },
          { href: '/rp-vault', label: 'RP Character Vault', desc: 'Alle RP-karakterer' },
          { href: '/role-manager', label: 'Role Manager', desc: 'Roller og membre-oversikt' },
        ].map(l => (
          <Link key={l.href} href={l.href}
            className="bg-g-card border border-g-border rounded-lg p-4 hover:border-g-green/30 transition-all group">
            <p className="text-xs font-bold text-g-text group-hover:text-g-green transition-colors">{l.label}</p>
            <p className="text-[9px] text-g-muted mt-0.5">{l.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
