'use client';

import { useState } from 'react';
import Link from 'next/link';

interface Briefing {
  overskrift:       string;
  hoyepunkter:      string[];
  community_stemning: string;
  topp_topics:      string[];
  ai_anbefaling:    string;
  advarsel:         string | null;
  generert_kl:      string;
  raw_data?: {
    insights: number;
    discord_events: number;
    twitch_events: number;
    highlights: number;
    is_live: boolean;
  };
}

export default function StreamBriefingPage() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function generer() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/stream-briefing', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBriefing(await res.json());
    } catch (e: any) {
      setError(e.message ?? 'Ukjent feil');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-wider text-g-text uppercase">AI Stream Briefing</h1>
          <p className="text-[9px] text-g-muted mt-0.5">Automatisk generert fra Twitch, Discord, AI Memory og Content Factory</p>
        </div>
        <Link href="/" className="text-[9px] text-g-muted hover:text-g-green transition-colors">← Dashboard</Link>
      </div>

      {/* Generator */}
      <div className="bg-g-card border border-g-border rounded-xl p-5">
        <p className="text-xs text-g-muted mb-4 leading-relaxed">
          Klikk for å generere en AI-basert pre-stream briefing basert på alt systemet vet om communityet ditt akkurat nå.
          Inkluderer: community-stemning, topp-topics, AI-innsikter, highlights-status og strategisk anbefaling.
        </p>
        <button
          onClick={generer}
          disabled={loading}
          className={`w-full py-3 rounded-xl font-black text-sm uppercase tracking-wider transition-all ${
            loading
              ? 'bg-g-border text-g-muted cursor-wait'
              : 'bg-g-green/10 border border-g-green/30 text-g-green hover:bg-g-green/20'
          }`}
        >
          {loading ? '◆ Genererer briefing...' : '◆ Generer stream-briefing'}
        </button>
        {error && <p className="text-xs text-red-400 mt-3">Feil: {error}</p>}
      </div>

      {/* Briefing Output */}
      {briefing && (
        <div className="space-y-4">

          {/* Header */}
          <div className="bg-g-card border border-g-green/20 rounded-xl p-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-g-muted uppercase tracking-widest font-bold">AI Briefing</span>
              <span className="text-[9px] text-g-muted/50">Generert kl. {briefing.generert_kl}</span>
            </div>
            <h2 className="text-base font-black text-g-green mt-1">{briefing.overskrift}</h2>
          </div>

          {/* Advarsel */}
          {briefing.advarsel && (
            <div className="bg-red-500/5 border border-red-500/30 rounded-xl p-4 flex gap-3">
              <span className="text-red-400 text-lg flex-shrink-0">⚠</span>
              <p className="text-sm text-red-300">{briefing.advarsel}</p>
            </div>
          )}

          {/* Høydepunkter */}
          <div className="bg-g-card border border-g-border rounded-xl p-5">
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Høydepunkter</p>
            <div className="space-y-2">
              {(briefing.hoyepunkter ?? []).map((punkt, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <span className="text-g-green font-black text-[10px] mt-0.5 flex-shrink-0">◆</span>
                  <p className="text-sm text-g-text">{punkt}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Community + Topics */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-g-card border border-g-border rounded-xl p-4">
              <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Community-stemning</p>
              <p className="text-xs text-g-text leading-relaxed">{briefing.community_stemning}</p>
            </div>
            <div className="bg-g-card border border-g-border rounded-xl p-4">
              <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Topp Topics</p>
              <div className="flex flex-wrap gap-1.5">
                {(briefing.topp_topics ?? []).map((t, i) => (
                  <span key={i} className="px-2.5 py-1 bg-g-green/5 border border-g-green/20 rounded-full text-[10px] text-g-green font-bold">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* AI Anbefaling */}
          <div className="bg-g-card border border-g-green/10 rounded-xl p-5">
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">AI anbefaler</p>
            <p className="text-sm text-g-text leading-relaxed">{briefing.ai_anbefaling}</p>
          </div>

          {/* Raw data sources */}
          {briefing.raw_data && (
            <div className="flex gap-3 flex-wrap">
              {[
                { label: 'AI-innsikter', value: briefing.raw_data.insights },
                { label: 'Discord-events', value: briefing.raw_data.discord_events },
                { label: 'Twitch-events', value: briefing.raw_data.twitch_events },
                { label: 'Highlights', value: briefing.raw_data.highlights },
              ].map(({ label, value }) => (
                <div key={label} className="px-3 py-1.5 bg-g-card border border-g-border rounded-lg text-[9px] text-g-muted">
                  {label}: <span className="text-g-text font-bold">{value}</span>
                </div>
              ))}
              {briefing.raw_data.is_live && (
                <div className="px-3 py-1.5 bg-red-500/5 border border-red-500/30 rounded-lg text-[9px] text-red-400 font-bold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" /> LIVE NÅ
                </div>
              )}
            </div>
          )}

          {/* Regenerate */}
          <button
            onClick={generer}
            disabled={loading}
            className="text-[10px] text-g-muted hover:text-g-green transition-colors"
          >
            ↻ Generer ny briefing
          </button>
        </div>
      )}
    </div>
  );
}
