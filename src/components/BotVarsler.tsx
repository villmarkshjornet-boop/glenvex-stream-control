'use client';

import { useEffect, useRef, useState } from 'react';

interface Varsel {
  id: string;
  tekst: string;
  type: 'discord' | 'twitch' | 'system';
  tid: Date;
}

const TYPE_FARGE = {
  discord: 'border-l-blue-400 bg-blue-400/10 text-blue-400',
  twitch: 'border-l-purple-400 bg-purple-400/10 text-purple-400',
  system: 'border-l-g-green bg-g-green/10 text-g-green',
};

const TYPE_IKON = {
  discord: '◈',
  twitch: '🟣',
  system: '◆',
};

export default function BotVarsler() {
  const [varsler, setVarsler] = useState<Varsel[]>([]);
  const sistePublisertRef = useRef<string | null>(null);
  const sisteAktivitetRef = useRef<string | null>(null);

  useEffect(() => {
    const sjekkAktivitet = async () => {
      try {
        const res = await fetch('/api/bot-activity');
        if (!res.ok) return;
        const data = await res.json();

        // Sjekk om det er ny publisering
        const sistePublisert = data.sistPublisert?.[0];
        if (sistePublisert) {
          const key = `${sistePublisert.type}_${sistePublisert.tid}`;
          if (key !== sistePublisertRef.current && sistePublisertRef.current !== null) {
            const nytt: Varsel = {
              id: key,
              tekst: `Discord-bot publiserte: ${sistePublisert.tittel}`,
              type: 'discord',
              tid: new Date(),
            };
            setVarsler(prev => [nytt, ...prev].slice(0, 5));
          }
          sistePublisertRef.current = key;
        }

        // Sjekk live-status
        const statusRes = await fetch('/api/status');
        if (statusRes.ok) {
          const status = await statusRes.json();
          const aktivitetKey = `${status.stream?.isLive}_${status.totalAlerts}`;
          if (aktivitetKey !== sisteAktivitetRef.current && sisteAktivitetRef.current !== null) {
            if (status.stream?.isLive) {
              setVarsler(prev => [{
                id: `live_${Date.now()}`,
                tekst: `🔴 Streameren gikk LIVE – Discord-embed postet`,
                type: 'discord' as const,
                tid: new Date(),
              }, ...prev].slice(0, 5));
            }
          }
          sisteAktivitetRef.current = aktivitetKey;
        }
      } catch {}
    };

    // Første kjøring setter baseline
    sjekkAktivitet();
    const id = setInterval(sjekkAktivitet, 30_000);
    return () => clearInterval(id);
  }, []);

  if (varsler.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-xs">
      {varsler.map(v => (
        <div key={v.id}
          className={`border-l-2 rounded-r-lg px-4 py-3 shadow-lg backdrop-blur-sm animate-in slide-in-from-right-5 ${TYPE_FARGE[v.type]}`}
          style={{ background: 'rgba(0,0,0,0.85)' }}>
          <div className="flex items-start gap-2">
            <span className="text-sm flex-shrink-0">{TYPE_IKON[v.type]}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold">{v.tekst}</p>
              <p className="text-[9px] opacity-60 mt-0.5">
                {v.tid.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            <button onClick={() => setVarsler(prev => prev.filter(x => x.id !== v.id))}
              className="text-[10px] opacity-50 hover:opacity-100 flex-shrink-0">✕</button>
          </div>
        </div>
      ))}
    </div>
  );
}
