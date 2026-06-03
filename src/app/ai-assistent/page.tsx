'use client';

import { useState } from 'react';
import type { PromoContent } from '@/types';

export default function AiAssistent() {
  const [promo, setPromo] = useState<PromoContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<keyof PromoContent>('tiktok');

  async function generate() {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/promo', { method: 'POST' });
      if (res.ok) setPromo(await res.json());
    } catch {
      /* silent */
    }
    setLoading(false);
  }

  const tabs: { key: keyof PromoContent; label: string }[] = [
    { key: 'tiktok', label: 'TikTok' },
    { key: 'instagram', label: 'Instagram' },
    { key: 'twitter', label: 'Twitter' },
    { key: 'discord', label: 'Discord' },
    { key: 'youtube', label: 'YouTube' },
    { key: 'clipTitles', label: 'Clip-titler' },
  ];

  const current = promo?.[tab];

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">
          AI Assistent
        </h1>
        <p className="text-xs text-g-muted mt-0.5">
          GPT-drevet promo og innholdsgenerator
        </p>
      </div>

      <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-4">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-g-green/10 border border-g-green/20 flex items-center justify-center flex-shrink-0">
            <span className="text-g-green text-lg">◆</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-g-text">GLENVEX AI</p>
            <p className="text-xs text-g-muted mt-0.5">
              Klikk generer for å lage promo-innhold basert på aktiv stream. Henter automatisk
              spilltittel og streamnavn fra Twitch.
            </p>
          </div>
        </div>

        <button
          onClick={generate}
          disabled={loading}
          className="w-full py-2.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 hover:border-g-green/40 text-g-green text-xs font-bold tracking-widest uppercase rounded transition-all"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-3 h-3 border border-g-green/30 border-t-g-green rounded-full animate-spin" />
              Genererer innhold...
            </span>
          ) : (
            '◆ Generer Promo-innhold'
          )}
        </button>
      </div>

      {promo && (
        <div className="bg-g-card border border-g-border rounded-lg overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-g-border overflow-x-auto">
            {tabs.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-4 py-2.5 text-xs font-semibold tracking-wider whitespace-nowrap transition-all ${
                  tab === key
                    ? 'text-g-green border-b-2 border-g-green bg-g-green/5'
                    : 'text-g-muted hover:text-g-text'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="p-5">
            {Array.isArray(current) ? (
              <div className="space-y-2">
                {current.map((t, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-g-muted text-xs mt-0.5">{i + 1}.</span>
                    <p className="text-sm text-g-text font-mono">{t}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-g-text font-mono whitespace-pre-wrap leading-relaxed">
                {current}
              </p>
            )}

            <button
              onClick={async () => {
                const text = Array.isArray(current) ? current.join('\n') : (current ?? '');
                await navigator.clipboard.writeText(text);
              }}
              className="mt-4 px-3 py-1.5 border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/20 transition-all"
            >
              Kopier tekst
            </button>
          </div>
        </div>
      )}

      {promo?.imageUrl && (
        <div className="bg-g-card border border-g-border rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-g-border">
            <p className="text-xs font-semibold text-g-muted tracking-wider uppercase">AI-generert promo-bilde</p>
          </div>
          <div className="p-5 space-y-3">
            <img
              src={promo.imageUrl}
              alt="AI promo"
              className="w-full rounded-lg border border-g-border"
            />
            <a
              href={promo.imageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-3 py-1.5 border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/20 transition-all"
            >
              Åpne i full størrelse ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
