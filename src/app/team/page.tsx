'use client';

import Link from 'next/link';

const SEKSJONER = [
  {
    label: 'Twitch',
    href: '/twitch',
    icon: '🟣',
    items: [
      { label: 'Streamplan', href: '/streamplan' },
      { label: 'AI Producer', href: '/ai-producer' },
      { label: 'Stream Coach', href: '/stream-coach' },
      { label: 'Statistikk', href: '/statistikk' },
    ],
  },
  {
    label: 'Discord',
    href: '/discord',
    icon: '◈',
    items: [
      { label: 'Community Manager', href: '/community-manager' },
      { label: 'Moderator', href: '/moderation' },
      { label: 'Raid Manager', href: '/raid-manager' },
    ],
  },
  {
    label: 'Innhold',
    href: '/innhold',
    icon: '▶',
    items: [
      { label: 'Content Factory', href: '/content-factory-admin' },
      { label: 'Highlight Viewer', href: '/content-factory-admin/highlights' },
      { label: 'Clip Factory', href: '/clip-factory' },
    ],
  },
  {
    label: 'Partnere',
    href: '/partnere',
    icon: '◇',
    items: [
      { label: 'Partner Hub', href: '/partner-hub' },
      { label: 'Sponsor Manager', href: '/sponsor-manager' },
    ],
  },
];

export default function TeamHub() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Team</h1>
        <p className="text-[10px] text-g-muted mt-0.5">Alle verktøy og seksjoner – oversikt for teamet</p>
      </div>

      <div className="bg-g-card border border-g-green/10 rounded-xl p-4">
        <p className="text-xs text-g-green font-bold mb-1">Creator OS</p>
        <p className="text-[10px] text-g-muted leading-relaxed">
          Et sentralisert kontrollsenter for hele teamet. Hver seksjon dekker ett ansvarsområde –
          bruk sidebaren for å navigere, eller start fra Dashboard for daglig drift.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SEKSJONER.map(s => (
          <div key={s.href} className="bg-g-card border border-g-border rounded-xl p-4">
            <Link href={s.href} className="flex items-center gap-2 mb-3 group">
              <span className="text-base">{s.icon}</span>
              <span className="text-xs font-bold text-g-text group-hover:text-g-green transition-colors uppercase tracking-wider">{s.label}</span>
              <span className="text-[9px] text-g-muted ml-auto">Oversikt →</span>
            </Link>
            <div className="space-y-0.5">
              {s.items.map(item => (
                <Link key={item.href} href={item.href}
                  className="flex items-center gap-2 px-2 py-1.5 rounded text-[11px] text-g-muted hover:text-g-text hover:bg-white/[0.03] transition-all">
                  <span className="w-1 h-1 rounded-full bg-g-border/60 flex-shrink-0" />
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="border border-g-border/30 rounded-xl p-4">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">System</p>
        <div className="flex gap-2 flex-wrap">
          <Link href="/innstillinger" className="px-3 py-1.5 border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
            ⚙ Innstillinger
          </Link>
          <Link href="/logs" className="px-3 py-1.5 border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
            Logs
          </Link>
        </div>
      </div>
    </div>
  );
}
