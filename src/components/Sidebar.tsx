'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

interface NavItem {
  label: string;
  href: string;
}

interface NavGruppe {
  gruppe: string;
  icon: string;
  href?: string; // direkte link hvis ingen undermeny
  items?: NavItem[];
}

const NAV: NavGruppe[] = [
  {
    gruppe: 'Dashboard',
    icon: '⊞',
    href: '/',
  },
  {
    gruppe: 'Stream',
    icon: '🔴',
    items: [
      { label: 'Pre-Live Hype', href: '/pre-live' },
      { label: 'AI Producer', href: '/ai-producer' },
      { label: 'Live Overvåking', href: '/live-overvaking' },
      { label: 'Streamplan', href: '/streamplan' },
      { label: 'Stream Coach', href: '/stream-coach' },
    ],
  },
  {
    gruppe: 'Innhold',
    icon: '▶',
    items: [
      { label: 'Clip Factory', href: '/clip-factory' },
      { label: 'AI Assistent', href: '/ai-assistent' },
      { label: 'Highlights', href: '/highlights' },
      { label: 'Merch', href: '/merch' },
    ],
  },
  {
    gruppe: 'Community',
    icon: '◈',
    items: [
      { label: 'Manager', href: '/community-manager' },
      { label: 'Memory', href: '/community-memory' },
      { label: 'XP & Levels', href: '/xp-system' },
      { label: 'Events', href: '/event-generator' },
      { label: 'Polls', href: '/polls' },
      { label: 'Clip-innsendinger', href: '/clips' },
    ],
  },
  {
    gruppe: 'Discord',
    icon: '◈',
    items: [
      { label: 'Control Center', href: '/discord-control' },
      { label: 'Oversikt', href: '/discord' },
      { label: 'Discord Library', href: '/discord-library' },
      { label: 'Role Manager', href: '/role-manager' },
      { label: 'AI Moderator', href: '/moderation' },
      { label: 'Raid Manager', href: '/raid-manager' },
    ],
  },
  {
    gruppe: 'Future RP',
    icon: '◉',
    items: [
      { label: 'RP Manager', href: '/rp-manager' },
      { label: 'RP Vault', href: '/rp-vault' },
      { label: 'RP Intelligence', href: '/rp-intelligence' },
    ],
  },
  {
    gruppe: 'Partner Hub',
    icon: '◇',
    href: '/partner-hub',
  },
  {
    gruppe: 'Vekst',
    icon: '◎',
    items: [
      { label: 'AI Command Center', href: '/ai-command-center' },
      { label: 'Statistikk', href: '/statistikk' },
      { label: 'Viewer Goals', href: '/viewer-goals' },
      { label: 'Sponsor Manager', href: '/sponsor-manager' },
    ],
  },
  {
    gruppe: 'System',
    icon: '⚙',
    items: [
      { label: 'Innstillinger', href: '/innstillinger' },
      { label: 'Logs', href: '/logs' },
      { label: 'Systemstatus', href: '/systemstatus' },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  // Finn aktiv gruppe for å åpne den som standard
  const aktivGruppe = NAV.find(g =>
    g.items?.some(i => i.href === pathname) || g.href === pathname
  )?.gruppe ?? 'Stream';

  const [åpen, setÅpen] = useState<string>(aktivGruppe);

  const toggle = (gruppe: string) => setÅpen(prev => prev === gruppe ? '' : gruppe);

  return (
    <aside className="w-52 min-h-screen bg-g-sidebar border-r border-g-border flex flex-col flex-shrink-0">
      {/* Logo */}
      <Link href="/" className="px-5 py-4 border-b border-g-border block hover:bg-white/[0.02] transition-colors">
        <div className="text-g-green font-black text-lg tracking-[0.15em] uppercase"
          style={{ textShadow: '0 0 12px rgba(0,255,65,0.5)' }}>
          GLENVEX
        </div>
        <div className="text-[9px] text-g-muted tracking-[0.3em] uppercase mt-0.5">Creator OS</div>
      </Link>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {NAV.map(gruppe => {
          // Direktelink
          if (gruppe.href) {
            const active = pathname === gruppe.href;
            return (
              <Link key={gruppe.href} href={gruppe.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                  active
                    ? 'bg-g-green/10 text-g-green border border-g-green/20'
                    : 'text-g-muted hover:text-g-text hover:bg-white/[0.03] border border-transparent'
                }`}>
                <span className={`text-sm ${active ? 'text-g-green' : ''}`}>{gruppe.icon}</span>
                <span>{gruppe.gruppe}</span>
                {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-g-green" style={{ boxShadow: '0 0 6px #00ff41' }} />}
              </Link>
            );
          }

          // Gruppe med undermeny
          const erÅpen = åpen === gruppe.gruppe;
          const harAktiv = gruppe.items?.some(i => i.href === pathname);

          return (
            <div key={gruppe.gruppe}>
              <button
                onClick={() => toggle(gruppe.gruppe)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all border ${
                  harAktiv
                    ? 'text-g-green border-g-green/10 bg-g-green/5'
                    : 'text-g-muted hover:text-g-text hover:bg-white/[0.03] border-transparent'
                }`}>
                <span className={`text-sm ${harAktiv ? 'text-g-green' : ''}`}>{gruppe.icon}</span>
                <span className="flex-1 text-left">{gruppe.gruppe}</span>
                <span className={`text-[10px] transition-transform duration-200 ${erÅpen ? 'rotate-90' : ''} text-g-muted`}>›</span>
              </button>

              {erÅpen && gruppe.items && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-g-border/40 pl-3">
                  {gruppe.items.map(item => {
                    const active = pathname === item.href;
                    return (
                      <Link key={item.href} href={item.href}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-all ${
                          active
                            ? 'text-g-green font-bold'
                            : 'text-g-muted hover:text-g-text'
                        }`}>
                        {active && <span className="w-1 h-1 rounded-full bg-g-green flex-shrink-0" />}
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="px-4 py-2 border-t border-g-border">
        <p className="text-[8px] text-g-muted/30 text-center tracking-widest uppercase">v3.0</p>
      </div>
    </aside>
  );
}
