'use client';

import type { SlowData, LiveData } from '@/components/dashboard/types';

interface Action {
  label: string;
  href: string;
}

function buildActions(slow: SlowData | null, live: LiveData | null): Action[] {
  const actions: Action[] = [];

  // Twitch token expired / auth failed
  if (
    live?.twitchAuthStatus === 'token_fetch_failed' ||
    live?.twitchAuthStatus === 'auth_failed'
  ) {
    actions.push({ label: 'Forny Twitch-token', href: '/innstillinger' });
  }

  // No stream this week (no nesteStream plan set)
  if (!live?.nesteStream) {
    actions.push({ label: 'Legg til en streamplan', href: '/streamplan' });
  }

  // No AI briefing generated today
  const briefingCoverage = live?.coverage?.find(c => c.key === 'briefing');
  const briefingActive = briefingCoverage?.status === 'active';
  if (!briefingActive) {
    actions.push({ label: 'Generer stream-briefing', href: '/stream-briefing' });
  }

  // Last stream had a coach score < 60
  if (live?.heroStream && live.heroStream.streamScore < 60) {
    actions.push({
      label: 'Se stream coach-analysen',
      href: '/stream-coach',
    });
  }

  // Discord not connected (health shows discord not ok)
  const discordHealth = slow?.health?.discord;
  if (discordHealth && !discordHealth.ok) {
    actions.push({ label: 'Koble til Discord', href: '/innstillinger' });
  }

  // Fallback: always show community stats link if nothing else or as last resort
  if (actions.length < 2) {
    actions.push({ label: 'Sjekk community-statistikk', href: '/statistikk' });
  }

  return actions.slice(0, 5);
}

export function WhatToDoNow({
  slow,
  live,
}: {
  slow: SlowData | null;
  live: LiveData | null;
}) {
  const actions = buildActions(slow, live);

  if (actions.length === 0) return null;

  return (
    <section className="glass-card rounded-2xl p-6 shadow-green-sm">
      <h2 className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-4">
        Hva gjør du nå?
      </h2>
      <div className="space-y-2">
        {actions.map(action => (
          <a
            key={action.href + action.label}
            href={action.href}
            className="flex items-center justify-between p-3 bg-g-bg border border-g-border rounded-xl hover:border-g-green/30 hover:bg-g-green/[0.02] transition-all group"
          >
            <div className="flex items-center gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-g-green/50 group-hover:bg-g-green transition-colors" />
              <span className="text-sm text-g-text group-hover:text-g-green transition-colors">
                {action.label}
              </span>
            </div>
            <span className="text-xs text-g-muted group-hover:text-g-green transition-colors">
              →
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
