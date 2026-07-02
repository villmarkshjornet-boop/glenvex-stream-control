'use client';

import { useState } from 'react';

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
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold text-g-text">Stream Briefing</h1>
        <p className="text-sm text-g-muted mt-1">AI-generert briefing for neste stream</p>
      </div>

      {/* Generator card */}
      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <p className="text-sm text-g-muted leading-relaxed mb-5">
          Generer en AI-basert pre-stream briefing basert på alt systemet vet om communityet ditt akkurat nå.
          Inkluderer: community-stemning, topp-topics, AI-innsikter, highlights-status og strategisk anbefaling.
        </p>
        <button
          onClick={generer}
          disabled={loading}
          className={`px-5 py-2.5 border text-sm font-medium rounded-lg transition-all duration-200 ${
            loading
              ? 'bg-g-border/20 border-g-border text-g-muted cursor-wait'
              : 'bg-g-green/10 border-g-green/25 text-g-green hover:bg-g-green/20 hover:shadow-green-sm'
          }`}
        >
          {loading ? 'Genererer briefing...' : 'Generer briefing'}
        </button>
        {error && (
          <p className="text-xs text-red-400 mt-3 font-mono">Feil: {error}</p>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && !briefing && (
        <div className="bg-g-card border border-g-border rounded-2xl p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-g-border/50 rounded w-1/3" />
            <div className="space-y-2">
              <div className="h-4 bg-g-border/50 rounded w-full" />
              <div className="h-4 bg-g-border/50 rounded w-5/6" />
              <div className="h-4 bg-g-border/50 rounded w-4/6" />
            </div>
            <div className="h-px bg-g-border/30 rounded" />
            <div className="space-y-2">
              <div className="h-4 bg-g-border/50 rounded w-1/4" />
              <div className="h-4 bg-g-border/50 rounded w-full" />
              <div className="h-4 bg-g-border/50 rounded w-3/4" />
            </div>
          </div>
        </div>
      )}

      {/* Briefing output */}
      {briefing && (
        <div className="space-y-4">

          {/* Advarsel */}
          {briefing.advarsel && (
            <div className="bg-red-500/5 border border-red-500/30 rounded-xl p-4 flex gap-3">
              <span className="text-red-400 font-semibold flex-shrink-0 text-sm">!</span>
              <p className="text-sm text-red-300 leading-relaxed">{briefing.advarsel}</p>
            </div>
          )}

          {/* Main briefing card */}
          <div className="bg-g-card border border-g-border rounded-2xl p-6 space-y-6">

            {/* Header / overskrift */}
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-g-border/40">
              <div>
                <p className="text-[11px] font-medium tracking-widest uppercase text-g-muted mb-2">AI Briefing</p>
                <h2 className="text-lg font-semibold text-g-green leading-snug">{briefing.overskrift}</h2>
              </div>
              <span className="text-xs text-g-muted/60 font-mono flex-shrink-0 mt-1">kl. {briefing.generert_kl}</span>
            </div>

            {/* Høydepunkter */}
            <div>
              <h3 className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-3 pb-2 border-b border-g-border/40">
                Høydepunkter
              </h3>
              <div className="space-y-2.5">
                {(briefing.hoyepunkter ?? []).map((punkt, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <span className="text-g-green text-xs mt-0.5 flex-shrink-0">◆</span>
                    <p className="text-sm text-g-text leading-relaxed">{punkt}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Community-stemning */}
            <div>
              <h3 className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-3 pb-2 border-b border-g-border/40">
                Community-stemning
              </h3>
              <p className="text-sm text-g-text leading-relaxed">{briefing.community_stemning}</p>
            </div>

            {/* Topp topics */}
            <div>
              <h3 className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-3 pb-2 border-b border-g-border/40">
                Topp Topics
              </h3>
              <div className="flex flex-wrap gap-2">
                {(briefing.topp_topics ?? []).map((t, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 bg-g-green/5 border border-g-green/20 rounded-full text-xs text-g-green font-medium"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>

            {/* AI anbefaling */}
            <div>
              <h3 className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-3 pb-2 border-b border-g-border/40">
                AI anbefaler
              </h3>
              <p className="text-sm text-g-text leading-relaxed">{briefing.ai_anbefaling}</p>
            </div>
          </div>

          {/* Data sources */}
          {briefing.raw_data && (
            <div className="flex gap-2 flex-wrap items-center">
              {[
                { label: 'AI-innsikter', value: briefing.raw_data.insights },
                { label: 'Discord-events', value: briefing.raw_data.discord_events },
                { label: 'Twitch-events', value: briefing.raw_data.twitch_events },
                { label: 'Highlights', value: briefing.raw_data.highlights },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="px-3 py-1.5 bg-g-card border border-g-border rounded-lg text-xs text-g-muted font-mono"
                >
                  {label}: <span className="text-g-text font-semibold">{value}</span>
                </div>
              ))}
              {briefing.raw_data.is_live && (
                <div className="px-3 py-1.5 bg-red-500/5 border border-red-500/30 rounded-lg text-xs text-red-400 font-semibold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                  LIVE NÅ
                </div>
              )}
            </div>
          )}

          {/* Regenerate */}
          <button
            onClick={generer}
            disabled={loading}
            className="text-xs text-g-muted hover:text-g-green transition-colors duration-200"
          >
            ↻ Generer ny briefing
          </button>
        </div>
      )}
    </div>
  );
}
