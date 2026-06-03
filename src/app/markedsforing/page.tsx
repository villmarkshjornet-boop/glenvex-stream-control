'use client';

import { useState } from 'react';
import type { PromoContent } from '@/types';

function PromoBlock({ platform, content }: { platform: string; content: string | string[] }) {
  const [copied, setCopied] = useState(false);
  const text = Array.isArray(content) ? content.join('\n') : content;

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="bg-g-bg border border-g-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-g-green font-bold tracking-widest uppercase">
          {platform}
        </span>
        <button
          onClick={copy}
          className={`text-[10px] px-2 py-0.5 rounded border transition-all ${
            copied
              ? 'text-g-green border-g-green/30 bg-g-green/10'
              : 'text-g-muted border-g-border hover:text-g-green hover:border-g-green/20'
          }`}
        >
          {copied ? '✓ Kopiert' : 'Kopier'}
        </button>
      </div>
      {Array.isArray(content) ? (
        <ul className="space-y-1">
          {content.map((t, i) => (
            <li key={i} className="text-xs text-g-text font-mono whitespace-pre-wrap">
              {t}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-g-text font-mono whitespace-pre-wrap">{content}</p>
      )}
    </div>
  );
}

export default function Markedsforing() {
  const [promo, setPromo] = useState<PromoContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/promo', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Feil');
      setPromo(data);
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">
          Markedsføring
        </h1>
        <p className="text-xs text-g-muted mt-0.5">
          AI-generert promo-innhold for alle plattformer
        </p>
      </div>

      <div className="bg-g-card border border-g-border rounded-lg p-5">
        <p className="text-xs text-g-muted mb-4">
          Generer plattform-spesifikk promo-tekst basert på aktiv Twitch-stream. Henter tittel og
          spill automatisk.
        </p>
        <button
          onClick={generate}
          disabled={loading}
          className="px-5 py-2.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 hover:border-g-green/40 text-g-green text-sm font-bold tracking-widest uppercase rounded transition-all"
          style={{ textShadow: '0 0 8px rgba(0,255,65,0.3)' }}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 border border-g-green/30 border-t-g-green rounded-full animate-spin" />
              Genererer...
            </span>
          ) : (
            '◆ Generer Promo'
          )}
        </button>
        {error && <p className="mt-3 text-xs text-red-400">✗ {error}</p>}
      </div>

      {promo && (
        <div className="space-y-3">
          <div>
            <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-3">
              AI Promo Forslag — Klar til å kopieres og deles!
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <PromoBlock platform="TikTok" content={promo.tiktok} />
              <PromoBlock platform="Instagram" content={promo.instagram} />
              <PromoBlock platform="Twitter / X" content={promo.twitter} />
              <PromoBlock platform="Discord" content={promo.discord} />
              <PromoBlock platform="YouTube" content={promo.youtube} />
              <PromoBlock platform="Clip-titler" content={promo.clipTitles} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
