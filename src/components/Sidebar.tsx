'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

interface NavItem { label: string; href: string; }
interface NavGruppe {
  gruppe: string;
  icon: string;
  href?: string;
  items?: NavItem[];
}

const NAV: NavGruppe[] = [
  { gruppe: 'Dashboard', icon: '⊞', href: '/' },
  {
    gruppe: 'Stream',
    icon: '🔴',
    items: [
      { label: 'AI Producer', href: '/ai-producer' },
      { label: 'Live Overvåking', href: '/live-overvaking' },
      { label: 'Pre-Live Hype', href: '/pre-live' },
      { label: 'Stream Coach', href: '/stream-coach' },
      { label: 'Streamplan', href: '/streamplan' },
    ],
  },
  {
    gruppe: 'Innhold',
    icon: '▶',
    items: [
      { label: 'AI Assistent', href: '/ai-assistent' },
      { label: 'Clip Factory', href: '/clip-factory' },
      { label: 'Highlights', href: '/highlights' },
      { label: 'Discord Library', href: '/discord-library' },
      { label: 'Merch', href: '/merch' },
    ],
  },
  {
    gruppe: 'Community',
    icon: '◈',
    items: [
      { label: 'Community Manager', href: '/community-manager' },
      { label: 'Community Memory', href: '/community-memory' },
      { label: 'XP System', href: '/xp-system' },
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
  { gruppe: 'Partner Hub', icon: '◇', href: '/partner-hub' },
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
      { label: 'System Health', href: '/system-health' },
      { label: 'Setup Wizard', href: '/setup-wizard' },
      { label: 'Innstillinger', href: '/innstillinger' },
      { label: 'Logs', href: '/logs' },
      { label: 'Systemstatus', href: '/systemstatus' },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  const aktivGruppe = NAV.find(g =>
    g.items?.some(i => i.href === pathname) || g.href === pathname
  )?.gruppe ?? '';

  const [åpen, setÅpen] = useState<Set<string>>(() => new Set([aktivGruppe, 'Stream']));

  const toggle = (gruppe: string) => {
    setÅpen(prev => {
      const next = new Set(prev);
      next.has(gruppe) ? next.delete(gruppe) : next.add(gruppe);
      return next;
    });
  };

  return (
    <aside className="w-52 min-h-screen bg-g-sidebar border-r border-g-border flex flex-col flex-shrink-0">
      <Link href="/" className="px-5 py-4 border-b border-g-border block hover:bg-white/[0.02] transition-colors">
        <div className="text-g-green font-black text-lg tracking-[0.15em] uppercase"
          style={{ textShadow: '0 0 12px rgba(0,255,65,0.5)' }}>
          GLENVEX
        </div>
        <div className="text-[9px] text-g-muted tracking-[0.3em] uppercase mt-0.5">Creator OS</div>
      </Link>

      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
        {NAV.map(gruppe => {
          if (gruppe.href) {
            const active = pathname === gruppe.href;
            return (
              <Link key={gruppe.href} href={gruppe.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all border ${
                  active ? 'bg-g-green/10 text-g-green border-g-green/20' : 'text-g-muted hover:text-g-text hover:bg-white/[0.03] border-transparent'
                }`}>
                <span className={`text-sm flex-shrink-0 ${active ? 'text-g-green' : ''}`}>{gruppe.icon}</span>
                <span>{gruppe.gruppe}</span>
                {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-g-green" style={{ boxShadow: '0 0 6px #00ff41' }} />}
              </Link>
            );
          }

          const erÅpen = åpen.has(gruppe.gruppe);
          const harAktiv = gruppe.items?.some(i => i.href === pathname);

          return (
            <div key={gruppe.gruppe}>
              <button onClick={() => toggle(gruppe.gruppe)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all border ${
                  harAktiv ? 'text-g-green border-g-green/10 bg-g-green/5' : 'text-g-muted hover:text-g-text hover:bg-white/[0.03] border-transparent'
                }`}>
                <span className={`text-sm flex-shrink-0 ${harAktiv ? 'text-g-green' : ''}`}>{gruppe.icon}</span>
                <span className="flex-1 text-left">{gruppe.gruppe}</span>
                <span className={`text-[10px] transition-transform duration-200 ${erÅpen ? 'rotate-90' : ''} text-g-muted`}>›</span>
              </button>

              {erÅpen && gruppe.items && (
                <div className="ml-4 mt-0.5 mb-1 space-y-0.5 border-l border-g-border/30 pl-3">
                  {gruppe.items.map(item => {
                    const active = pathname === item.href;
                    return (
                      <Link key={item.href} href={item.href}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-all ${
                          active ? 'text-g-green font-bold' : 'text-g-muted hover:text-g-text'
                        }`}>
                        {active && <span className="w-1 h-1 rounded-full bg-g-green flex-shrink-0" />}
                        <span>{item.label}</span>
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
        <Link href="/system-health" className="flex items-center gap-1.5 group">
          <span className="w-1.5 h-1.5 rounded-full bg-g-green animate-pulse" />
          <p className="text-[8px] text-g-muted/50 group-hover:text-g-muted transition-colors">System Online</p>
        </Link>
      </div>
    </aside>
  );
}
