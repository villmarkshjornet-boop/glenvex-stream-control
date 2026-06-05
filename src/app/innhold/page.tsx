'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface VodSummary { total: number; complete: number; analyzing: number; failed: number; }

const VERKTOY = [
  {
    href: '/content-factory-admin',
    icon: '▶',
    label: 'Content Factory',
    desc: 'Start VOD-prosessering – yt-dlp, Whisper og AI-analyse i én operasjon',
    action: 'Åpne',
  },
  {
    href: '/content-factory-admin/highlights',
    icon: '◆',
    label: 'Highlight Viewer',
    desc: 'Se alle AI-genererte høydepunkter, utløs klipping og last ned klipp',
    action: 'Åpne',
  },
  {
    href: '/clip-factory',
    icon: '▩',
    label: 'Clip Factory',
    desc: 'Manuell klipper – velg segment fra VOD og eksporter i 16:9 eller 9:16',
    action: 'Åpne',
  },
];

export default function InnholdHub() {
  const [vods, setVods] = useState<VodSummary | null>(null);

  useEffect(() => {
    fetch('/api/content-factory')
      .then(r => r.json())
      .then((data: any[]) => {
        if (!Array.isArray(data)) return;
        setVods({
          total: data.length,
          complete: data.filter(v => v.status === 'COMPLETE').length,
          analyzing: data.filter(v => v.status === 'ANALYZING' || v.status === 'PENDING').length,
          failed: data.filter(v => v.status === 'FAILED').length,
        });
      })
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Innhold</h1>
        <p className="text-[10px] text-g-muted mt-0.5">Content Factory, highlights og klipp – fra VOD til ferdig innhold</p>
      </div>

      {vods && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Totale VODs', value: vods.total },
            { label: 'Fullført', value: vods.complete, ok: true },
            { label: 'Prosesseres', value: vods.analyzing, warn: vods.analyzing > 0 },
            { label: 'Feilet', value: vods.failed, bad: vods.failed > 0 },
          ].map(s => (
            <div key={s.label} className="bg-g-card border border-g-border rounded-lg p-3">
              <p className="text-[9px] text-g-muted uppercase tracking-widest">{s.label}</p>
              <p className={`text-2xl font-black font-mono mt-1 ${
                s.bad ? 'text-red-400' : s.warn ? 'text-yellow-400' : s.ok ? 'text-g-green' : 'text-g-text'
              }`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {VERKTOY.map(v => (
          <Link key={v.href} href={v.href}
            className="bg-g-card border border-g-border rounded-xl p-5 hover:border-g-green/30 hover:bg-g-green/[0.02] transition-all group flex flex-col gap-3">
            <p className="text-g-green text-xl">{v.icon}</p>
            <div className="flex-1">
              <p className="text-xs font-bold text-g-text group-hover:text-g-green transition-colors">{v.label}</p>
              <p className="text-[10px] text-g-muted mt-1 leading-relaxed">{v.desc}</p>
            </div>
            <span className="text-[10px] text-g-green font-bold">{v.action} →</span>
          </Link>
        ))}
      </div>

      <div className="bg-g-card border border-g-border rounded-xl p-4">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Kjeden</p>
        <div className="flex items-center gap-2 text-[10px] text-g-muted flex-wrap">
          {['VOD-URL', 'yt-dlp', 'FFmpeg', 'Whisper', 'AI-analyse', 'Highlights', 'Klipping', 'Ferdig'].map((s, i, arr) => (
            <span key={s} className="flex items-center gap-2">
              <span className="px-2 py-0.5 border border-g-border rounded text-g-text font-medium">{s}</span>
              {i < arr.length - 1 && <span className="text-g-green">→</span>}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
