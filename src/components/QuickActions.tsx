'use client';

import { useState } from 'react';

interface Props {
  twitchUrl?: string;
  onRefresh?: () => void;
}

interface ActionResult {
  ok: boolean;
  message: string;
}

export default function QuickActions({ twitchUrl, onRefresh }: Props) {
  const [results, setResults] = useState<Record<string, ActionResult | 'loading'>>({});

  async function runAction(key: string, fn: () => Promise<ActionResult>) {
    setResults((prev) => ({ ...prev, [key]: 'loading' }));
    try {
      const result = await fn();
      setResults((prev) => ({ ...prev, [key]: result }));
    } catch (e) {
      setResults((prev) => ({
        ...prev,
        [key]: { ok: false, message: (e as Error).message },
      }));
    }
    setTimeout(() => {
      setResults((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, 4000);
  }

  async function testLiveAlert(): Promise<ActionResult> {
    const res = await fetch('/api/discord/test-live', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ukjent feil');
    return { ok: true, message: data.message };
  }

  async function generatePromo(): Promise<ActionResult> {
    const res = await fetch('/api/ai/promo', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ukjent feil');
    return { ok: true, message: 'Promo generert – sjekk AI Assistent' };
  }

  async function refreshStatus(): Promise<ActionResult> {
    onRefresh?.();
    return { ok: true, message: 'Status oppdatert' };
  }

  const actions = [
    {
      key: 'testAlert',
      label: 'Test Live Varsel',
      icon: '((•))',
      fn: testLiveAlert,
    },
    {
      key: 'promo',
      label: 'Lag Promo',
      icon: '◆',
      fn: generatePromo,
    },
    {
      key: 'refresh',
      label: 'Oppdater Status',
      icon: '↻',
      fn: refreshStatus,
    },
    {
      key: 'stream',
      label: 'Se På Stream',
      icon: '▶',
      fn: async () => {
        window.open(twitchUrl || 'https://twitch.tv/glenvex', '_blank');
        return { ok: true, message: 'Åpner Twitch...' };
      },
    },
  ];

  return (
    <div className="bg-g-card border border-g-border rounded-lg p-5">
      <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">
        Hurtighandlinger
      </h2>
      <div className="grid grid-cols-2 gap-2">
        {actions.map((action) => {
          const result = results[action.key];
          const loading = result === 'loading';
          const actionResult: ActionResult | null =
            result !== undefined && result !== 'loading' ? result : null;

          return (
            <button
              key={action.key}
              onClick={() => runAction(action.key, action.fn)}
              disabled={loading}
              className={`flex flex-col items-center gap-2 p-3 rounded border text-xs font-semibold transition-all duration-150 ${
                actionResult
                  ? actionResult.ok
                    ? 'bg-g-green/10 border-g-green/30 text-g-green'
                    : 'bg-red-900/20 border-red-600/30 text-red-400'
                  : 'bg-g-bg border-g-border text-g-muted hover:border-g-green/30 hover:text-g-green hover:bg-g-green/5'
              }`}
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin" />
              ) : (
                <span className="text-base">{action.icon}</span>
              )}
              <span className="text-center leading-tight">
                {actionResult ? actionResult.message.slice(0, 20) : action.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
