'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_GRUPPER = [
  {
    gruppe: 'STREAM',
    items: [
      { label: 'Dashboard', href: '/', icon: '⊞' },
      { label: 'AI Producer', href: '/ai-producer', icon: '◆' },
      { label: 'Live Overvåking', href: '/live-overvaking', icon: '⊙' },
      { label: 'Stream Coach', href: '/stream-coach', icon: '⟐' },
      { label: 'Pre-Live Hype', href: '/pre-live', icon: '((•))' },
    ],
  },
  {
    gruppe: 'INNHOLD',
    items: [
      { label: 'Clip Factory', href: '/clip-factory', icon: '▶' },
      { label: 'Highlights', href: '/highlights', icon: '🎬' },
      { label: 'AI Assistent', href: '/ai-assistent', icon: '◆' },
      { label: 'Streamplan', href: '/streamplan', icon: '◷' },
      { label: 'Merch', href: '/merch', icon: '◇' },
    ],
  },
  {
    gruppe: 'COMMUNITY',
    items: [
      { label: 'Community Manager', href: '/community-manager', icon: '◈' },
      { label: 'Community Memory', href: '/community-memory', icon: '◉' },
      { label: 'GlenCoins', href: '/glencoins', icon: '◎' },
      { label: 'XP System', href: '/xp-system', icon: '⊕' },
      { label: 'Event Generator', href: '/event-generator', icon: '⊛' },
      { label: 'Polls', href: '/polls', icon: '◈' },
      { label: 'Clips', href: '/clips', icon: '▶' },
    ],
  },
  {
    gruppe: 'DISCORD',
    items: [
      { label: 'Discord', href: '/discord', icon: '◈' },
      { label: 'AI Moderator', href: '/moderation', icon: '⊛' },
      { label: 'Raid Manager', href: '/raid-manager', icon: '⟐' },
    ],
  },
  {
    gruppe: 'RP',
    items: [
      { label: 'RP Manager', href: '/rp-manager', icon: '◉' },
      { label: 'RP Intelligence', href: '/rp-intelligence', icon: '◉' },
    ],
  },
  {
    gruppe: 'PARTNER & VEKST',
    items: [
      { label: 'Partner Hub', href: '/partner-hub', icon: '◇' },
      { label: 'AI Command Center', href: '/ai-command-center', icon: '◆' },
      { label: 'Sponsor Manager', href: '/sponsor-manager', icon: '◎' },
      { label: 'Viewer Goals', href: '/viewer-goals', icon: '◎' },
      { label: 'Statistikk', href: '/statistikk', icon: '◎' },
    ],
  },
  {
    gruppe: 'SYSTEM',
    items: [
      { label: 'Innstillinger', href: '/innstillinger', icon: '⚙' },
      { label: 'Logs', href: '/logs', icon: '▤' },
      { label: 'Systemstatus', href: '/systemstatus', icon: '⊛' },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 min-h-screen bg-g-sidebar border-r border-g-border flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-g-border">
        <div className="text-g-green font-black text-lg tracking-[0.15em] uppercase"
          style={{ textShadow: '0 0 12px rgba(0,255,65,0.5)' }}>
          GLENVEX
        </div>
        <div className="text-[9px] text-g-muted tracking-[0.4em] uppercase mt-0.5">
          Creator OS
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-3">
        {NAV_GRUPPER.map(gruppe => (
          <div key={gruppe.gruppe}>
            <p className="text-[9px] text-g-muted/50 font-bold tracking-[0.3em] uppercase px-2 py-1">
              {gruppe.gruppe}
            </p>
            <div className="space-y-0.5">
              {gruppe.items.map(item => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded text-xs transition-all duration-150 group ${
                      active
                        ? 'bg-g-green/10 text-g-green border border-g-green/20'
                        : 'text-g-muted hover:text-g-text hover:bg-white/[0.03] border border-transparent'
                    }`}
                  >
                    <span className={`text-[13px] w-4 text-center flex-shrink-0 ${active ? 'text-g-green' : 'text-g-muted group-hover:text-g-text'}`}>
                      {item.icon}
                    </span>
                    <span className="font-medium truncate">{item.label}</span>
                    {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-g-green flex-shrink-0" style={{ boxShadow: '0 0 6px #00ff41' }} />}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-g-border">
        <p className="text-[8px] text-g-muted/40 text-center tracking-widest uppercase">GLENVEX CREATOR OS v3</p>
      </div>
    </aside>
  );
}
