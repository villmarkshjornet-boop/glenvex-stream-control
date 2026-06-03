'use client';

import { useEffect, useState } from 'react';

interface Clip {
  id: string;
  url: string;
  beskrivelse: string;
  brukernavn: string;
  timestamp: string;
  status: 'pending' | 'godkjent' | 'avvist';
}

export default function ClipsPage() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'godkjent' | 'avvist'>('pending');

  useEffect(() => { hent(); }, []);

  async function hent() {
    setLoading(true);
    const res = await fetch('/api/clips-queue').catch(() => null);
    if (res?.ok) setClips(await res.json());
    setLoading(false);
  }

  async function oppdaterStatus(id: string, status: 'godkjent' | 'avvist') {
    await fetch('/api/clips-queue', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    hent();
  }

  const filtrerte = clips.filter(c => c.status === filter);

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Clip-innsendinger</h1>
        <p className="text-xs text-g-muted mt-0.5">Seere sender inn clips via /innsend i Discord</p>
      </div>

      <div className="flex gap-2">
        {(['pending', 'godkjent', 'avvist'] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 text-xs font-bold tracking-wider uppercase rounded border transition-all ${
              filter === s ? 'bg-g-green/10 border-g-green/30 text-g-green' : 'border-g-border text-g-muted hover:text-g-text'
            }`}>
            {s === 'pending' ? `Venter (${clips.filter(c => c.status === 'pending').length})` : s === 'godkjent' ? 'Godkjent' : 'Avvist'}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-xs text-g-muted">Laster...</p>
      ) : filtrerte.length === 0 ? (
        <div className="bg-g-card border border-g-border rounded-lg p-8 text-center">
          <p className="text-xs text-g-muted">Ingen {filter === 'pending' ? 'ventende' : filter} clips.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtrerte.map(clip => (
            <div key={clip.id} className="bg-g-card border border-g-border rounded-lg p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-g-text">{clip.brukernavn}</p>
                  <p className="text-[10px] text-g-muted mt-0.5">
                    {new Date(clip.timestamp).toLocaleString('no-NO')}
                  </p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider ${
                  clip.status === 'pending' ? 'border-yellow-500/30 text-yellow-400 bg-yellow-500/10' :
                  clip.status === 'godkjent' ? 'border-g-green/30 text-g-green bg-g-green/10' :
                  'border-red-500/30 text-red-400 bg-red-500/10'
                }`}>{clip.status}</span>
              </div>

              <p className="text-xs text-g-muted">{clip.beskrivelse}</p>

              <a href={clip.url} target="_blank" rel="noopener noreferrer"
                className="text-xs text-g-green hover:underline font-mono break-all">{clip.url}</a>

              {clip.status === 'pending' && (
                <div className="flex gap-2">
                  <button onClick={() => oppdaterStatus(clip.id, 'godkjent')}
                    className="flex-1 py-1.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold rounded transition-all">
                    ✓ Godkjenn og publiser
                  </button>
                  <button onClick={() => oppdaterStatus(clip.id, 'avvist')}
                    className="flex-1 py-1.5 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 text-xs font-bold rounded transition-all">
                    ✗ Avvis
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
