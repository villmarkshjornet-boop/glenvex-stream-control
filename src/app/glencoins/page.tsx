'use client';

import { useEffect, useState } from 'react';

interface Wallet {
  userId: string;
  brukernavn: string;
  coins: number;
  totaltTjent: number;
}

const BUTIKK = [
  { navn: 'VIP Discord-rolle', pris: 500, ikon: '👑' },
  { navn: 'Giveaway-billett', pris: 100, ikon: '🎟️' },
  { navn: 'Shoutout i chat', pris: 200, ikon: '📢' },
  { navn: 'Community Perks', pris: 1000, ikon: '⭐' },
];

export default function GlenCoinsPage() {
  const [leaderboard, setLeaderboard] = useState<Wallet[]>([]);
  const [totalCoins, setTotalCoins] = useState(0);
  const [loading, setLoading] = useState(true);
  const [adminForm, setAdminForm] = useState({ userId: '', brukernavn: '', mengde: 100, type: 'gi' as 'gi' | 'trekk' });
  const [adminRes, setAdminRes] = useState('');

  const hent = () => {
    setLoading(true);
    fetch('/api/glencoins').then(r => r.json()).then(d => {
      setLeaderboard(d.leaderboard ?? []);
      setTotalCoins(d.totalCoins ?? 0);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { hent(); }, []);

  async function adminJuster() {
    const res = await fetch('/api/glencoins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(adminForm),
    });
    const data = await res.json();
    setAdminRes(data.ok ? `✓ ${adminForm.type === 'gi' ? 'Ga' : 'Trakk'} ${adminForm.mengde} GlenCoins` : '✗ Feil');
    hent();
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">GlenCoins</h1>
        <p className="text-xs text-g-muted mt-0.5">Community-valuta – tjen coins for aktivitet og bruk dem i butikken</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total coins i sirkulasjon', value: totalCoins.toLocaleString() },
          { label: 'Aktive wallets', value: leaderboard.length },
          { label: 'Topp holder', value: leaderboard[0]?.brukernavn ?? '–' },
        ].map(s => (
          <div key={s.label} className="bg-g-card border border-g-border rounded-lg p-4 text-center">
            <p className="text-[9px] text-g-muted uppercase tracking-widest">{s.label}</p>
            <p className="text-lg font-black text-g-green font-mono mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Leaderboard */}
        <div className="bg-g-card border border-g-border rounded-lg p-5">
          <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">🏆 Leaderboard</h2>
          {loading ? <p className="text-xs text-g-muted">Laster...</p> : leaderboard.length === 0 ? (
            <p className="text-xs text-g-muted">Ingen coins ennå. Coins tildeles automatisk basert på Discord-aktivitet.</p>
          ) : (
            <div className="space-y-2">
              {leaderboard.slice(0, 20).map((w, i) => (
                <div key={w.userId} className="flex items-center gap-3 py-1.5 border-b border-g-border/30 last:border-0">
                  <span className={`text-xs font-black font-mono w-5 ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-orange-400' : 'text-g-muted'}`}>{i + 1}</span>
                  <p className="text-xs text-g-text flex-1">{w.brukernavn}</p>
                  <span className="text-xs font-black text-g-green font-mono">{w.coins.toLocaleString()} ◎</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Butikk + Admin */}
        <div className="space-y-4">
          <div className="bg-g-card border border-g-border rounded-lg p-5">
            <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">🛍️ GlenCoins Butikk</h2>
            <div className="space-y-2">
              {BUTIKK.map(item => (
                <div key={item.navn} className="flex items-center justify-between py-2 border-b border-g-border/30 last:border-0">
                  <div className="flex items-center gap-2">
                    <span>{item.ikon}</span>
                    <p className="text-xs text-g-text">{item.navn}</p>
                  </div>
                  <span className="text-xs font-black text-g-green font-mono">{item.pris} ◎</span>
                </div>
              ))}
            </div>
          </div>

          {/* Admin */}
          <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-3">
            <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase">Admin: Juster coins</h2>
            <input value={adminForm.userId} onChange={e => setAdminForm(p => ({ ...p, userId: e.target.value }))}
              placeholder="Discord User ID" className="w-full bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50" />
            <input value={adminForm.brukernavn} onChange={e => setAdminForm(p => ({ ...p, brukernavn: e.target.value }))}
              placeholder="Brukernavn" className="w-full bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50" />
            <div className="flex gap-2">
              <input type="number" value={adminForm.mengde} onChange={e => setAdminForm(p => ({ ...p, mengde: +e.target.value }))}
                className="flex-1 bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50" />
              <select value={adminForm.type} onChange={e => setAdminForm(p => ({ ...p, type: e.target.value as 'gi' | 'trekk' }))}
                className="bg-g-bg border border-g-border rounded px-2 py-1.5 text-xs text-g-text outline-none">
                <option value="gi">Gi</option>
                <option value="trekk">Trekk</option>
              </select>
            </div>
            <button onClick={adminJuster} className="w-full py-2 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold rounded transition-all">
              ◆ Utfør
            </button>
            {adminRes && <p className={`text-xs font-mono ${adminRes.startsWith('✓') ? 'text-g-green' : 'text-red-400'}`}>{adminRes}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
