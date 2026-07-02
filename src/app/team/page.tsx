'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/ui';

const SEKSJONER = [
  {
    label: 'Twitch',
    href: '/streamplan',
    icon: '▶',
    items: [
      { label: 'Streamplan',   href: '/streamplan' },
      { label: 'AI Producer',  href: '/ai-producer' },
      { label: 'Stream Coach', href: '/stream-coach' },
      { label: 'Statistikk',   href: '/statistikk' },
    ],
  },
  {
    label: 'Discord',
    href: '/discord',
    icon: '◈',
    items: [
      { label: 'Community Manager', href: '/community-manager' },
      { label: 'Moderator',         href: '/moderation' },
      { label: 'Raid Manager',      href: '/raid-manager' },
    ],
  },
  {
    label: 'Innhold',
    href: '/content-factory-admin',
    icon: '▩',
    items: [
      { label: 'Content Factory',    href: '/content-factory-admin' },
      { label: 'Highlight Viewer',   href: '/content-factory-admin/highlights' },
      { label: 'Clip Factory',       href: '/clip-factory' },
    ],
  },
  {
    label: 'Partnere',
    href: '/partner-hub',
    icon: '◇',
    items: [
      { label: 'Partner Hub',     href: '/partner-hub' },
      { label: 'Sponsor Manager', href: '/sponsor-manager' },
    ],
  },
];

export default function TeamHub() {
  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      <PageHeader title="Team" subtitle="Alle verktøy og seksjoner — oversikt for teamet" />

      <div className="bg-g-card border border-g-green/10 rounded-2xl p-6">
        <p className="text-sm text-g-green font-bold mb-1">Creator OS</p>
        <p className="text-[11px] text-g-muted leading-relaxed">
          Et sentralisert kontrollsenter for hele teamet. Hver seksjon dekker ett ansvarsområde —
          bruk sidebaren for å navigere, eller start fra Dashboard for daglig drift.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SEKSJONER.map(s => (
          <div key={s.href} className="bg-g-card border border-g-border rounded-2xl p-6">
            <Link href={s.href} className="flex items-center gap-2 mb-3 group">
              <span className="text-g-green text-sm">{s.icon}</span>
              <span className="text-xs font-bold text-g-text group-hover:text-g-green transition-colors uppercase tracking-wider">{s.label}</span>
              <span className="text-[11px] text-g-muted ml-auto">Oversikt →</span>
            </Link>
            <div className="space-y-0.5">
              {s.items.map(item => (
                <Link key={item.href} href={item.href}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] text-g-muted hover:text-g-text hover:bg-white/[0.03] transition-all">
                  <span className="w-1 h-1 rounded-full bg-g-border/60 flex-shrink-0" />
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <p className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-3">System</p>
        <div className="flex gap-2 flex-wrap">
          <Link href="/innstillinger" className="px-4 py-2 text-g-muted text-sm hover:text-g-text transition-colors">
            Innstillinger
          </Link>
          <Link href="/logs" className="px-4 py-2 text-g-muted text-sm hover:text-g-text transition-colors">
            Logs
          </Link>
        </div>
      </div>
    </div>
  );
}
