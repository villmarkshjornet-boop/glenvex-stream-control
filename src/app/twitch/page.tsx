'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface StreamStatus { isLive: boolean; game?: string; title?: string; viewerCount?: number; thumbnailUrl?: string; }

const VERKTOY = [
  { href: '/live-overvaking', icon: '◉', label: 'Live-status', desc: 'Sanntids oversikt over pågående stream – seere, chat, events' },
  { href: '/streamplan', icon: '▦', label: 'Streamplan', desc: 'Sett opp ukentlig plan med spill, tider og temaer' },
  { href: '/ai-producer', icon: '◆', label: 'AI Producer', desc: 'Automatiske handlinger under stream – titler, kampanjer, merch' },
  { href: '/stream-coach', icon: '◈', label: 'Stream Coach', desc: 'AI-analyse av dine streams – tips for engagement og vekst' },
  { href: '/statistikk', icon: '▩', label: 'Statistikk', desc: 'Seere, følgere, peak-tider og historisk ytelse' },
  { href: '/rp-manager', icon: '◉', label: 'Future RP', desc: 'Karakterer, storylines og RP-planlegging for GLENVEX RP' },
];

export default function TwitchHub() {
  const [stream, setStream] = useState<StreamStatus | null>(null);

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(d => setStream(d?.stream ?? null)).catch(() => {});
  }, []);

  const isLive = stream?.isLive;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Twitch</h1>
          {isLive !== undefined && (
            <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
              isLive ? 'border-red-500/40 text-red-400 bg-red-500/10' : 'border-g-border text-g-muted bg-g-bg'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-red-400 animate-pulse' : 'bg-g-muted'}`} />
              {isLive ? 'LIVE NÅ' : 'OFFLINE'}
            </span>
          )}
        </div>
        <p className="text-[10px] text-g-muted mt-0.5">Stream-kontroll, planlegging og vekstverktøy</p>
      </div>

      {isLive && stream && (
        <div className="bg-g-card border border-red-500/20 rounded-xl p-4 flex items-center gap-4">
          {stream.thumbnailUrl && (
            <img src={stream.thumbnailUrl} alt="" className="w-24 rounded border border-g-border flex-shrink-0" style={{ aspectRatio: '16/9', objectFit: 'cover' }} />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[9px] text-red-400 font-bold uppercase">{stream.game}</p>
            <p className="text-sm font-bold text-g-text truncate">{stream.title}</p>
            <p className="text-2xl font-black text-red-400 font-mono">{stream.viewerCount ?? 0} <span className="text-xs text-g-muted font-normal">seere</span></p>
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0">
            <Link href="/ai-producer" className="px-3 py-1.5 bg-g-green/10 border border-g-green/20 text-g-green text-xs font-bold rounded hover:bg-g-green/20 transition-all">
              ◆ AI Producer
            </Link>
            <Link href="/live-overvaking" className="px-3 py-1.5 bg-g-bg border border-g-border text-g-muted text-xs font-bold rounded hover:text-g-green hover:border-g-green/30 transition-all">
              Live-status
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {VERKTOY.map(v => (
          <Link key={v.href} href={v.href}
            className="bg-g-card border border-g-border rounded-xl p-4 hover:border-g-green/30 hover:bg-g-green/[0.02] transition-all group">
            <p className="text-g-green text-lg mb-2">{v.icon}</p>
            <p className="text-xs font-bold text-g-text group-hover:text-g-green transition-colors">{v.label}</p>
            <p className="text-[10px] text-g-muted mt-1 leading-relaxed">{v.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
