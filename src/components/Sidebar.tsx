'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutGrid,
  Radio,
  Calendar,
  Mic,
  Zap,
  Target,
  Sword,
  TrendingUp,
  Layers,
  Video,
  Sparkles,
  Scissors,
  Share2,
  Users,
  MessageSquare,
  UserCog,
  Shield,
  Briefcase,
  Store,
  FileBarChart,
  AtSign,
  Terminal,
  Brain,
  Cpu,
  Settings,
  UserCheck,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface NavItem {
  label:  string;
  href:   string;
  icon:   React.ElementType;
}

interface NavGroup {
  id:    string;
  label: string;
  items: NavItem[];
}

// ── Navigation structure per spec ─────────────────────────────────────────────

const GROUPS: NavGroup[] = [
  {
    id:    'live',
    label: 'Live',
    items: [
      { label: 'Oversikt',        href: '/twitch',            icon: Radio       },
      { label: 'Streamplan',      href: '/streamplan',        icon: Calendar    },
      { label: 'AI Coach',        href: '/stream-briefing',   icon: Mic         },
      { label: 'Stream Coach',    href: '/stream-coach',      icon: Zap         },
      { label: 'Viewer Goals',    href: '/viewer-goals',      icon: Target      },
      { label: 'Raid Manager',    href: '/raid-manager',      icon: Sword       },
      { label: 'Vekstanalyse',    href: '/statistikk',        icon: TrendingUp  },
    ],
  },
  {
    id:    'content',
    label: 'Content',
    items: [
      { label: 'Content Factory', href: '/content-factory-admin',            icon: Video     },
      { label: 'Highlights',      href: '/content-factory-admin/highlights', icon: Sparkles  },
      { label: 'Klipp',           href: '/clip-factory',                     icon: Scissors  },
      { label: 'Publisering',     href: '/innhold/publisering',              icon: Share2    },
    ],
  },
  {
    id:    'community',
    label: 'Community',
    items: [
      { label: 'Discord',            href: '/discord',             icon: MessageSquare },
      { label: 'Community Manager',  href: '/community-manager',  icon: UserCog       },
      { label: 'Moderator',          href: '/moderation',          icon: Shield        },
    ],
  },
  {
    id:    'partners',
    label: 'Partners',
    items: [
      { label: 'Partner Hub',    href: '/partner-hub',                icon: Store         },
      { label: 'Sponsor Manager',href: '/sponsor-manager',            icon: FileBarChart  },
      { label: 'Twitter Utkast', href: '/publisering/twitter-drafts', icon: AtSign        },
    ],
  },
  {
    id:    'system',
    label: 'System',
    items: [
      { label: 'AI Memory',    href: '/ai-memory',    icon: Brain     },
      { label: 'Creator Brain',href: '/ai-memory',    icon: Cpu       },
      { label: 'Innstillinger',href: '/innstillinger', icon: Settings  },
      { label: 'Team',         href: '/team',         icon: UserCheck  },
    ],
  },
];

// ── Active matching ───────────────────────────────────────────────────────────

function isItemActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  if (href.includes('#')) return pathname === href.split('#')[0];
  return pathname === href || pathname.startsWith(href + '/');
}

function isGroupActive(group: NavGroup, pathname: string): boolean {
  return group.items.some(i => isItemActive(i.href, pathname));
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const pathname = usePathname();

  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const s = new Set<string>();
    GROUPS.forEach(g => {
      if (!isGroupActive(g, pathname)) s.add(g.id);
    });
    return s;
  });

  const toggle = (id: string) =>
    setCollapsed(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const isDashboard = pathname === '/';

  return (
    <aside className="w-52 min-h-screen bg-g-sidebar border-r border-g-border flex flex-col flex-shrink-0">

      {/* Logo */}
      <Link
        href="/"
        className="px-4 py-4 border-b border-g-border block hover:bg-white/[0.02] transition-colors"
      >
        <div
          className="text-g-green font-black text-base tracking-[0.15em] uppercase"
          style={{ textShadow: '0 0 12px rgba(0,255,65,0.35)' }}
        >
          GLENVEX
        </div>
        <div className="text-[8px] text-g-muted tracking-[0.3em] uppercase mt-0.5">Creator OS</div>
      </Link>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">

        {/* Dashboard — top-level direct link */}
        <Link
          href="/"
          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
            isDashboard
              ? 'bg-g-green/10 text-g-green border border-g-green/20'
              : 'text-g-muted hover:text-g-text hover:bg-white/[0.03] border border-transparent'
          }`}
        >
          <LayoutGrid size={14} className="flex-shrink-0" />
          <span className="flex-1">Dashboard</span>
          {isDashboard && <span className="w-1.5 h-1.5 rounded-full bg-g-green flex-shrink-0" />}
        </Link>

        {/* Groups */}
        {GROUPS.map(group => {
          const isOpen   = !collapsed.has(group.id);
          const isActive = isGroupActive(group, pathname);

          return (
            <div key={group.id}>

              {/* Group separator + toggle */}
              <div className="mt-3 mb-0.5">
                <button
                  onClick={() => toggle(group.id)}
                  className={`w-full flex items-center justify-between px-2 py-1 rounded transition-all group ${
                    isActive ? 'text-g-green/70' : 'text-g-muted/50 hover:text-g-muted'
                  }`}
                >
                  <span className="text-[9px] font-black uppercase tracking-[0.18em]">{group.label}</span>
                  <span className={`text-[10px] transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>›</span>
                </button>
              </div>

              {/* Group items */}
              {isOpen && (
                <div className="space-y-0.5 ml-1">
                  {group.items.map(item => {
                    const active = isItemActive(item.href, pathname);
                    const Icon   = item.icon;
                    return (
                      <Link
                        key={`${item.href}-${item.label}`}
                        href={item.href}
                        className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[11px] transition-all ${
                          active
                            ? 'text-g-green font-bold bg-g-green/5'
                            : 'text-g-muted hover:text-g-text hover:bg-white/[0.02] font-medium'
                        }`}
                      >
                        <Icon size={13} className="flex-shrink-0" />
                        <span className="flex-1 leading-none">{item.label}</span>
                        {active && <span className="w-1 h-1 rounded-full bg-g-green flex-shrink-0" />}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer status */}
      <div className="px-4 py-2.5 border-t border-g-border">
        <Link href="/innstillinger#helse" className="flex items-center gap-1.5 group">
          <span className="w-1.5 h-1.5 rounded-full bg-g-green animate-pulse" />
          <p className="text-[8px] text-g-muted/40 group-hover:text-g-muted transition-colors tracking-widest uppercase">
            System Online
          </p>
        </Link>
      </div>
    </aside>
  );
}
