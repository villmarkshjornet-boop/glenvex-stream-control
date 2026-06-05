'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Highlight {
  id: string;
  vod_id: string;
  title: string;
  clip_status: string;
  clip_url: string | null;
  vertical_clip_url: string | null;
  clip_finished_at: string | null;
  score: number;
}

interface Vod { id: string; title: string; }

export default function PubliseringPage() {
  const [klare, setKlare] = useState<Highlight[]>([]);
  const [vods, setVods] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function hent() {
      const res = await fetch('/api/content-factory/highlights?clip_status=CLIPPED').catch(() => null);
      if (res?.ok) {
        const d = await res.json().catch(() => ({}));
        const highlights: Highlight[] = d.highlights ?? d ?? [];
        setKlare(highlights.filter(h => h.clip_status === 'CLIPPED').slice(0, 10));

        // Hent VOD-titler
        const vodIds = Array.from(new Set(highlights.map(h => h.vod_id)));
        const vodsRes = await fetch('/api/content-factory').catch(() => null);
        if (vodsRes?.ok) {
          const vodsData = await vodsRes.json().catch(() => ({}));
          const map: Record<string, string> = {};
          (vodsData.vods ?? []).forEach((v: Vod) => { map[v.id] = v.title; });
          setVods(map);
        }
      }
      setLoading(false);
    }
    hent();
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Publisering</h1>
        <p className="text-[10px] text-g-muted mt-0.5">Klipp klare for publisering – ingen autopublisering</p>
      </div>

      <div className="bg-g-card border border-g-green/10 rounded-xl p-4">
        <p className="text-xs text-g-green font-bold mb-1">Ingen autopublisering</p>
        <p className="text-[10px] text-g-muted leading-relaxed">
          Klipp publiseres aldri automatisk. Last ned eller åpne klippet, og publiser manuelt til ønsket plattform.
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-g-card border border-g-border rounded-xl animate-pulse" />)}
        </div>
      ) : klare.length === 0 ? (
        <div className="bg-g-card border border-g-border rounded-xl p-8 text-center">
          <p className="text-g-muted text-xs">Ingen klipp klare for publisering ennå.</p>
          <p className="text-g-muted/60 text-[9px] mt-1">Klipp genereres automatisk etter at Content Factory er ferdig.</p>
          <Link href="/content-factory-admin/highlights" className="mt-4 inline-block px-4 py-2 bg-g-green/10 border border-g-green/20 rounded text-xs text-g-green font-bold hover:bg-g-green/20 transition-all">
            ▶ Gå til Highlights
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">{klare.length} klipp klare</p>
          {klare.map(h => (
            <div key={h.id} className="bg-g-card border border-g-green/10 rounded-xl p-4">
              <div className="flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] text-g-muted">{vods[h.vod_id] ?? h.vod_id}</p>
                  <p className="text-xs font-bold text-g-text mt-0.5 truncate">{h.title}</p>
                  {h.clip_finished_at && (
                    <p className="text-[9px] text-g-muted mt-0.5">
                      Ferdig {new Date(h.clip_finished_at).toLocaleDateString('no-NO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
                  {h.clip_url && (
                    <a href={h.clip_url} target="_blank" rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-g-green/10 border border-g-green/20 rounded text-[10px] text-g-green font-bold hover:bg-g-green/20 transition-all">
                      ▶ 16:9
                    </a>
                  )}
                  {h.vertical_clip_url && (
                    <a href={h.vertical_clip_url} target="_blank" rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-g-green/10 border border-g-green/20 rounded text-[10px] text-g-green font-bold hover:bg-g-green/20 transition-all">
                      ▶ 9:16
                    </a>
                  )}
                  {h.clip_url && (
                    <a href={h.clip_url} download
                      className="px-3 py-1.5 border border-g-border rounded text-[10px] text-g-muted font-bold hover:text-g-green hover:border-g-green/30 transition-all">
                      ↓ Last ned
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <Link href="/content-factory-admin/highlights" className="px-4 py-2 border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
          ← Tilbake til Highlights
        </Link>
        <Link href="/content-factory-admin" className="px-4 py-2 border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
          Content Factory
        </Link>
      </div>
    </div>
  );
}
