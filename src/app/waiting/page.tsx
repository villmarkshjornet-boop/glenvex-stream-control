'use client';

import { BrandLogo } from '@/components/ui';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function WaitingPage() {
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = useState(10);
  const [showDashboardBtn, setShowDashboardBtn] = useState(false);

  useEffect(() => {
    if (secondsLeft <= 0) {
      setShowDashboardBtn(true);
      return;
    }
    const t = setTimeout(() => setSecondsLeft(s => s - 1), 1_000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const statusItems = [
    { label: 'Workspace aktivert',                            done: true },
    { label: 'Railway-boten oppdager workspacet ditt (~3 min)', done: false, ticker: true },
    { label: 'Discord-boten aktiveres på serveren din',       done: false },
    { label: 'Twitch-chatten kobles til',                     done: false },
  ];

  return (
    <div className="min-h-screen bg-g-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center space-y-6">
        <BrandLogo subtitle="Creator OS · Alpha" />

        <div className="bg-g-card border border-g-border rounded-2xl p-8 space-y-5">
          <div className="w-12 h-12 rounded-full bg-g-green/10 border border-g-green/20 flex items-center justify-center mx-auto">
            <span className="text-g-green text-xl">⚡</span>
          </div>

          <div>
            <h1 className="text-base font-black text-g-text">Creator OS starter opp...</h1>
            <p className="text-sm text-g-muted mt-2 leading-relaxed">
              Alt er satt opp. Systemet aktiveres automatisk — du trenger ikke gjøre noe mer.
            </p>
          </div>

          <div className="bg-g-bg border border-g-border/50 rounded-xl p-4 text-left space-y-2.5">
            <p className="text-xs font-semibold uppercase tracking-widest text-g-muted mb-3">Status</p>
            {statusItems.map(item => (
              <div key={item.label} className="flex items-start gap-2.5">
                <span className={`text-xs mt-0.5 flex-shrink-0 ${item.done ? 'text-g-green' : 'text-g-muted/40'}`}>
                  {item.done ? '✓' : item.ticker ? '◌' : '◆'}
                </span>
                <p className={`text-[11px] leading-snug ${item.done ? 'text-g-text' : 'text-g-muted'}`}>
                  {item.label}
                  {item.ticker && (
                    <span className="ml-1 text-g-green/60 animate-pulse">···</span>
                  )}
                </p>
              </div>
            ))}
          </div>

          {showDashboardBtn ? (
            <button
              onClick={() => router.push('/dashboard')}
              className="w-full px-5 py-2.5 bg-g-green/10 border border-g-green/25 text-g-green text-sm font-medium rounded-lg hover:bg-g-green/20 hover:border-g-green/40 hover:shadow-green-sm transition-all duration-200"
            >
              Gå til dashboard →
            </button>
          ) : (
            <p className="text-xs text-g-muted/50">
              Dashboard åpnes om{' '}
              <span className="tabular-nums text-g-muted">{secondsLeft}</span> sekunder...
            </p>
          )}

          <a
            href="/api/auth/logout"
            className="inline-block px-4 py-2 border border-g-border rounded-lg text-xs text-g-muted hover:text-g-text transition-colors"
          >
            Logg ut
          </a>
        </div>
      </div>
    </div>
  );
}
