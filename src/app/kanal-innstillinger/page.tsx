'use client';

import { useEffect, useState } from 'react';

interface Kanal { id: string; navn: string; kategori: string; }
interface Preferanser { live: string; announce: string; chat: string; clips: string; partner: string; streamplan: string; events: string; }

const FORMÅL = [
  { key: 'live', label: '🔴 Live-varsler', desc: 'Embed som postes når du går live' },
  { key: 'announce', label: '📢 Annonsering', desc: 'Streamplan, partnere, viktige nyheter' },
  { key: 'partner', label: '🤝 Partner-promo', desc: 'Automatiske partner-annonser' },
  { key: 'streamplan', label: '📅 Streamplan', desc: 'Ukentlig streamplan' },
  { key: 'chat', label: '💬 Chat-meldinger', desc: 'Proaktive meldinger, polls, events' },
  { key: 'events', label: '⭐ Events & Polls', desc: 'Community-events og avstemninger' },
  { key: 'clips', label: '🎬 Clips', desc: 'Auto-delte clips fra Twitch' },
];

export default function KanalInnstillingerPage() {
  const [kanaler, setKanaler] = useState<Kanal[]>([]);
  const [prefs, setPrefs] = useState<Partial<Preferanser>>({});
  const [loading, setLoading] = useState(true);
  const [lagret, setLagret] = useState(false);
  const [feil, setFeil] = useState('');
  const [debug, setDebug] = useState<any>(null);

  useEffect(() => {
    fetch('/api/channel-settings').then(r => r.json()).then(d => {
      setKanaler(d.kanaler ?? []);
      setPrefs(d.preferanser ?? {});
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function lagre() {
    setFeil('');
    setDebug(null);
    const res = await fetch('/api/channel-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    });
    const data = await res.json();
    if (res.ok) {
      setLagret(true);
      // Hent debug-info for å bekrefte lagring
      const dbg = await fetch('/api/channel-settings/debug').then(r => r.json()).catch(() => null);
      setDebug(dbg);
      setTimeout(() => { setLagret(false); }, 3000);
    } else {
      setFeil(`Kunne ikke lagre: ${data.error ?? res.status}`);
    }
  }

  const gruppert = kanaler.reduce<Record<string, Kanal[]>>((acc, k) => {
    if (!acc[k.kategori]) acc[k.kategori] = [];
    acc[k.kategori].push(k);
    return acc;
  }, {});

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Kanalinnstillinger</h1>
        <p className="text-xs text-g-muted mt-0.5">Velg hvilken Discord-kanal som brukes til hva – boten bruker disse overalt</p>
      </div>

      {loading ? (
        <div className="bg-g-card border border-g-border rounded-xl p-8 text-center">
          <span className="w-6 h-6 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin inline-block" />
          <p className="text-xs text-g-muted mt-3">Henter kanaler fra Discord...</p>
        </div>
      ) : kanaler.length === 0 ? (
        <div className="bg-g-card border border-g-border rounded-xl p-6">
          <p className="text-xs text-red-400">Ingen kanaler funnet. Sjekk at DISCORD_BOT_TOKEN og DISCORD_GUILD_ID er satt.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {FORMÅL.map(formål => (
              <div key={formål.key} className="bg-g-card border border-g-border rounded-xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-bold text-g-text">{formål.label}</p>
                    <p className="text-[10px] text-g-muted mt-0.5">{formål.desc}</p>
                  </div>
                  <div className="flex-shrink-0 w-64">
                    <select
                      value={(prefs as any)[formål.key] ?? ''}
                      onChange={e => setPrefs(p => ({ ...p, [formål.key]: e.target.value }))}
                      className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text outline-none focus:border-g-green/50"
                    >
                      <option value="">— Auto-detect —</option>
                      {Object.entries(gruppert).map(([kategori, kanalListe]) => (
                        <optgroup key={kategori} label={kategori.toUpperCase()}>
                          {kanalListe.map(k => (
                            <option key={k.id} value={k.id}>#{k.navn}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {(prefs as any)[formål.key] && (
                      <p className="text-[9px] text-g-green mt-1">
                        ✓ #{kanaler.find(k => k.id === (prefs as any)[formål.key])?.navn}
                      </p>
                    )}
                    {!(prefs as any)[formål.key] && (
                      <p className="text-[9px] text-g-muted mt-1">Auto-detect aktivt</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {feil && <p className="text-xs text-red-400 font-mono p-2 bg-red-500/10 border border-red-500/20 rounded">{feil}</p>}

          {debug && (
            <div className={`p-3 rounded border text-xs font-mono space-y-1 ${debug.supabaseHarData ? 'border-g-green/30 bg-g-green/5' : 'border-yellow-400/30 bg-yellow-400/5'}`}>
              <p className={debug.supabaseHarData ? 'text-g-green' : 'text-yellow-400'}>
                {debug.supabaseHarData ? '✓ Lagret i Supabase' : '⚠ Ikke funnet i Supabase – bruker auto-detect'}
              </p>
              {debug.lagretISupabase && Object.entries(debug.lagretISupabase).filter(([, v]) => v).map(([k, v]) => (
                <p key={k} className="text-g-muted">{k}: {kanaler.find(c => c.id === v)?.navn ?? v as string}</p>
              ))}
            </div>
          )}

          <button onClick={lagre}
            className="w-full py-3 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold tracking-widest uppercase rounded transition-all">
            {lagret ? '✓ Lagret!' : '◆ Lagre kanalinnstillinger'}
          </button>

          <div className="bg-g-card border border-g-border rounded-xl p-4">
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Slik fungerer det</p>
            <p className="text-xs text-g-muted leading-relaxed">
              Boten sjekker alltid lagrede preferanser først. Hvis ingen er valgt ("Auto-detect"), leter den etter kanaler med relevante navn automatisk. Du kan overstyre alt her.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
