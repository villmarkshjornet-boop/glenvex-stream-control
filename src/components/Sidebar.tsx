'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

interface NavItem { label: string; href: string; }
interface NavSeksjon {
  id: string;
  label: string;
  href: string;        // hoved-hub
  icon: string;
  items?: NavItem[];
}

const NAV: NavSeksjon[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    href: '/',
    icon: '⊞',
  },
  {
    id: 'twitch',
    label: 'Twitch',
    href: '/twitch',
    icon: '🟣',
    items: [
      { label: 'Live-status',   href: '/live-overvaking' },
      { label: 'Streamplan',    href: '/streamplan' },
      { label: 'AI Producer',   href: '/ai-producer' },
      { label: 'Stream Coach',  href: '/stream-coach' },
      { label: 'Statistikk',    href: '/statistikk' },
      { label: 'Future RP',     href: '/rp-manager' },
    ],
  },
  {
    id: 'discord',
    label: 'Discord',
    href: '/discord',
    icon: '◈',
    items: [
      { label: 'Oversikt',      href: '/discord-control' },
      { label: 'Pre-Live Hype', href: '/pre-live' },
      { label: 'Community',     href: '/community-manager' },
      { label: 'Moderator',     href: '/moderation' },
      { label: 'Raid Manager',  href: '/raid-manager' },
    ],
  },
  {
    id: 'innhold',
    label: 'Innhold',
    href: '/innhold',
    icon: '▶',
    items: [
      { label: 'Content Factory',    href: '/content-factory-admin' },
      { label: 'Highlight Viewer',   href: '/content-factory-admin/highlights' },
      { label: 'Clip Factory',       href: '/clip-factory' },
    ],
  },
  {
    id: 'partnere',
    label: 'Partnere',
    href: '/partnere',
    icon: '◇',
    items: [
      { label: 'Partner Hub',     href: '/partner-hub' },
      { label: 'Sponsor Manager', href: '/sponsor-manager' },
    ],
  },
  {
    id: 'team',
    label: 'Team',
    href: '/team',
    icon: '◉',
  },
  {
    id: 'innstillinger',
    label: 'Innstillinger',
    href: '/innstillinger',
    icon: '⚙',
    items: [
      { label: 'System Health', href: '/system-health' },
      { label: 'Logs',          href: '/logs' },
      { label: 'Setup',         href: '/setup-wizard' },
    ],
  },
];

// Alle href-er som hører til en seksjon
function seksjonEier(seksjon: NavSeksjon, pathname: string): boolean {
  if (pathname === seksjon.href) return true;
  if (seksjon.items?.some(i => pathname.startsWith(i.href))) return true;
  // Spesial: /content-factory-admin/* tilhører innhold
  if (seksjon.id === 'innhold' && pathname.startsWith('/content-factory-admin')) return true;
  return false;
}

export default function Sidebar() {
  const pathname = usePathname();
  const aktivSeksjon = NAV.find(s => seksjonEier(s, pathname));

  const [åpne, setÅpne] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (aktivSeksjon) initial.add(aktivSeksjon.id);
    return initial;
  });

  const toggle = (id: string) => {
    setÅpne(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <aside className="w-48 min-h-screen bg-g-sidebar border-r border-g-border flex flex-col flex-shrink-0">
      {/* Logo */}
      <Link href="/" className="px-4 py-4 border-b border-g-border block hover:bg-white/[0.02] transition-colors">
        <div className="text-g-green font-black text-base tracking-[0.15em] uppercase"
          style={{ textShadow: '0 0 12px rgba(0,255,65,0.4)' }}>
          GLENVEX
        </div>
        <div className="text-[8px] text-g-muted tracking-[0.3em] uppercase mt-0.5">Creator OS</div>
      </Link>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
        {NAV.map(seksjon => {
          const erAktivSeksjon = seksjonEier(seksjon, pathname);
          const erÅpen = åpne.has(seksjon.id);

          // Uten sub-items: direkte lenke
          if (!seksjon.items) {
            const erAktiv = pathname === seksjon.href;
            return (
              <Link key={seksjon.id} href={seksjon.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all border ${
                  erAktiv
                    ? 'bg-g-green/10 text-g-green border-g-green/20'
                    : 'text-g-muted hover:text-g-text hover:bg-white/[0.03] border-transparent'
                }`}>
                <span className="text-sm flex-shrink-0">{seksjon.icon}</span>
                <span className="flex-1">{seksjon.label}</span>
                {erAktiv && <span className="w-1.5 h-1.5 rounded-full bg-g-green" style={{ boxShadow: '0 0 6px #00ff41' }} />}
              </Link>
            );
          }

          // Med sub-items: kollapsibel seksjon
          return (
            <div key={seksjon.id}>
              <button
                onClick={() => toggle(seksjon.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all border ${
                  erAktivSeksjon
                    ? 'text-g-green border-g-green/10 bg-g-green/5'
                    : 'text-g-muted hover:text-g-text hover:bg-white/[0.03] border-transparent'
                }`}>
                <span className="text-sm flex-shrink-0">{seksjon.icon}</span>
                <span className="flex-1 text-left">{seksjon.label}</span>
                <span className={`text-[10px] transition-transform duration-200 ${erÅpen ? 'rotate-90' : ''} text-g-muted`}>›</span>
              </button>

              {erÅpen && (
                <div className="ml-4 mt-0.5 mb-1 space-y-0.5 border-l border-g-border/30 pl-2.5">
                  {/* Hub-lenke */}
                  <Link href={seksjon.href}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-all ${
                      pathname === seksjon.href
                        ? 'text-g-green font-bold'
                        : 'text-g-muted/70 hover:text-g-muted italic'
                    }`}>
                    <span className="text-[9px]">Oversikt</span>
                  </Link>
                  {/* Sub-items */}
                  {seksjon.items.map(item => {
                    const erAktiv = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                    return (
                      <Link key={item.href} href={item.href}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-all ${
                          erAktiv ? 'text-g-green font-bold' : 'text-g-muted hover:text-g-text'
                        }`}>
                        {erAktiv && <span className="w-1 h-1 rounded-full bg-g-green flex-shrink-0" />}
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

      {/* Status */}
      <div className="px-4 py-2.5 border-t border-g-border">
        <Link href="/system-health" className="flex items-center gap-1.5 group">
          <span className="w-1.5 h-1.5 rounded-full bg-g-green animate-pulse" />
          <p className="text-[8px] text-g-muted/50 group-hover:text-g-muted transition-colors">System Online</p>
        </Link>
      </div>
    </aside>
  );
}
