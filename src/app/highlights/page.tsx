'use client';

import { useEffect, useState } from 'react';

interface Clip {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string;
  viewCount: number;
  createdAt: string;
  duration: number;
}

interface HighlightSuggestion {
  clip: Clip;
  type: 'tiktok' | 'youtube' | 'instagram';
  grunn: string;
  prioritet: 'høy' | 'medium' | 'lav';
}

export default function HighlightsPage() {
  const [highlights, setHighlights] = useState<HighlightSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function hent() {
      try {
        const statusRes = await fetch('/api/status');
        const status = await statusRes.json();
        const broadcasterId = status?.stream?.id ? null : null;

        // Hent clips direkte fra Twitch via status
        const clipsRes = await fetch('/api/events');
        const events = await clipsRes.json();

        // Vi bruker Twitch clips fra twitch-lib
        const twitchRes = await fetch('/api/twitch/live');
        const twitchData = await twitchRes.json();

        // Simuler highlight-analyse basert på clips fra stats
        const eventsData = await fetch('/api/events').then(r => r.json());
        setHighlights([]);
      } catch {}
      setLoading(false);
    }
    hent();
  }, []);

  // Hent clips via en dedikert rute
  useEffect(() => {
    fetch('/api/highlights').then(r => r.json()).then(d => {
      setHighlights(d.highlights ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const PRIORITET_FARGE = { høy: 'text-red-400 border-red-400/30 bg-red-400/10', medium: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10', lav: 'text-g-muted border-g-border bg-g-bg' };
  const TYPE_IKON = { tiktok: '📱', youtube: '🎬', instagram: '📸' };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Highlights</h1>
        <p className="text-xs text-g-muted mt-0.5">AI analyserer clips og foreslår hva som passer for TikTok, YouTube og Instagram</p>
      </div>

      {loading ? (
        <div className="bg-g-card border border-g-border rounded-lg p-8 text-center">
          <span className="w-6 h-6 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin inline-block" />
          <p className="text-xs text-g-muted mt-3">Analyserer clips...</p>
        </div>
      ) : highlights.length === 0 ? (
        <div className="bg-g-card border border-g-border rounded-lg p-8 text-center space-y-2">
          <p className="text-xs text-g-muted">Ingen highlights funnet ennå.</p>
          <p className="text-[10px] text-g-muted">Clips genereres automatisk fra Twitch når du streamer. Kom tilbake etter neste stream.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {highlights.map((h, i) => (
            <div key={i} className="bg-g-card border border-g-border rounded-lg overflow-hidden flex">
              {h.clip.thumbnailUrl && (
                <img src={h.clip.thumbnailUrl} alt={h.clip.title} className="w-32 h-20 object-cover flex-shrink-0" />
              )}
              <div className="p-4 flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-xs font-bold text-g-text truncate">{h.clip.title}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider flex-shrink-0 ${PRIORITET_FARGE[h.prioritet]}`}>
                    {h.prioritet}
                  </span>
                </div>
                <p className="text-[10px] text-g-muted mb-2">{h.grunn}</p>
                <div className="flex items-center gap-3">
                  <span className="text-sm">{TYPE_IKON[h.type]}</span>
                  <span className="text-[10px] text-g-muted uppercase tracking-widest">{h.type}</span>
                  <span className="text-[10px] text-g-muted">👀 {h.clip.viewCount}</span>
                  <span className="text-[10px] text-g-muted">⏱ {Math.round(h.clip.duration)}s</span>
                  <a href={h.clip.url} target="_blank" rel="noopener noreferrer"
                    className="ml-auto text-xs text-g-green hover:underline">Se clip ↗</a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
