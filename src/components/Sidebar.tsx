'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

interface NavItem { label: string; href: string; }
interface NavSeksjon {
  id: string;
  label: string;
  href: string;
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
      { label: 'Oversikt',         href: '/twitch' },
      { label: 'Streamplan',       href: '/streamplan' },
      { label: 'Viewer Goals',     href: '/viewer-goals' },
      { label: 'AI Producer',      href: '/ai-producer' },
      { label: 'Stream Coach',     href: '/stream-coach' },
      { label: 'Raid Manager',     href: '/raid-manager' },
      { label: 'Vekstanalyse',     href: '/statistikk' },
      { label: 'Stream Briefing',  href: '/stream-briefing' },
      { label: 'Bot-innstillinger', href: '/innstillinger#twitch-bot' },
    ],
  },
  {
    id: 'discord',
    label: 'Discord',
    href: '/discord',
    icon: '🔵',
    items: [
      { label: 'Oversikt',              href: '/discord' },
      { label: 'Community Manager',     href: '/community-manager' },
      { label: 'Community Intelligence', href: '/community-intelligence' },
      { label: 'Moderator',             href: '/moderation' },
      { label: 'Bot-innstillinger',     href: '/innstillinger#discord-kanaler' },
    ],
  },
  {
    id: 'innhold',
    label: 'Innhold',
    href: '/innhold',
    icon: '▶',
    items: [
      { label: 'Content Factory', href: '/content-factory-admin' },
      { label: 'Highlights',      href: '/content-factory-admin/highlights' },
      { label: 'Klipp',           href: '/clip-factory' },
      { label: 'Publisering',     href: '/innhold/publisering' },
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
      { label: 'Affiliate',       href: '/partner-hub' },
    ],
  },
  {
    id: 'ai',
    label: 'AI Intelligence',
    href: '/ai-memory',
    icon: '◆',
    items: [
      { label: 'AI Memory',   href: '/ai-memory' },
      { label: 'AI Producer', href: '/ai-producer' },
    ],
  },
  {
    id: 'innstillinger',
    label: 'Innstillinger',
    href: '/innstillinger',
    icon: '⚙',
    items: [
      { label: 'Generelt',         href: '/innstillinger' },
      { label: 'Twitch Bot',       href: '/innstillinger#twitch-bot' },
      { label: 'Discord Bot',      href: '/innstillinger#discord-kanaler' },
      { label: 'Passord',          href: '/innstillinger#passord' },
      { label: 'Systemstatus',     href: '/innstillinger#helse' },
      { label: 'Automatiseringer', href: '/innstillinger#automatiseringer' },
      { label: 'AI-kollegaer',     href: '/team' },
    ],
  },
];

function seksjonEier(seksjon: NavSeksjon, pathname: string): boolean {
  if (pathname === seksjon.href) return true;
  if (seksjon.items?.some(i => pathname.startsWith(i.href) && i.href !== '/')) return true;
  if (seksjon.id === 'innhold' && pathname.startsWith('/content-factory-admin')) return true;
  if (seksjon.id === 'dashboard' && pathname === '/') return true;
  if (seksjon.id === 'twitch' && pathname.startsWith('/stream-briefing')) return true;
  if (seksjon.id === 'ai' && (pathname.startsWith('/ai-memory') || pathname.startsWith('/ai-producer'))) return true;
  return false;
}

export default function Sidebar() {
  const pathname = usePathname();
  const aktivSeksjon = NAV.find(s => seksjonEier(s, pathname));

  const [åpne, setÅpne] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (aktivSeksjon) s.add(aktivSeksjon.id);
    return s;
  });

  const toggle = (id: string) =>
    setÅpne(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

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

          if (!seksjon.items || seksjon.items.length === 0) {
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
                {erAktiv && <span className="w-1.5 h-1.5 rounded-full bg-g-green" />}
              </Link>
            );
          }

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
                  {seksjon.items.map(item => {
                    const erAktiv = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href) && !item.href.includes('#'));
                    return (
                      <Link key={`${item.href}-${item.label}`} href={item.href}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded text-[11px] transition-all ${
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
        <Link href="/innstillinger#helse" className="flex items-center gap-1.5 group">
          <span className="w-1.5 h-1.5 rounded-full bg-g-green animate-pulse" />
          <p className="text-[8px] text-g-muted/50 group-hover:text-g-muted transition-colors">System Online</p>
        </Link>
      </div>
    </aside>
  );
}
