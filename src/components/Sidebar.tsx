'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutGrid,
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
    <aside className="w-52 min-h-screen bg-g-sidebar border-r border-g-border/60 flex flex-col flex-shrink-0 pt-4">

      {/* Logo */}
      <Link
        href="/"
        className="px-4 pb-4 border-b border-g-border/40 mb-4 block hover:bg-white/[0.02] transition-colors"
      >
        <div
          className="text-sm font-bold tracking-widest text-g-green uppercase"
          style={{ textShadow: '0 0 12px rgba(0,255,65,0.35)' }}
        >
          GLENVEX
        </div>
        <div className="text-[11px] text-g-muted tracking-[0.3em] uppercase mt-0.5">Creator OS</div>
      </Link>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 space-y-0.5">

        {/* Dashboard — top-level direct link */}
        <Link
          href="/"
          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150 ${
            isDashboard
              ? 'bg-g-green/10 text-g-green border-r-2 border-g-green'
              : 'text-g-muted/70 hover:text-g-text hover:bg-white/[0.03]'
          }`}
        >
          <LayoutGrid size={16} className="flex-shrink-0 w-4 h-4" />
          <span className="flex-1">Dashboard</span>
        </Link>

        {/* Groups */}
        {GROUPS.map(group => {
          const isOpen   = !collapsed.has(group.id);
          const isActive = isGroupActive(group, pathname);

          return (
            <div key={group.id}>

              {/* Group separator + toggle */}
              <div className="px-3 pb-1 pt-4">
                <button
                  onClick={() => toggle(group.id)}
                  className={`w-full flex items-center justify-between transition-all group ${
                    isActive ? 'text-g-green/70' : 'text-g-muted/60 hover:text-g-muted'
                  }`}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-widest">{group.label}</span>
                  <span className={`text-[11px] transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>›</span>
                </button>
              </div>

              {/* Group items */}
              {isOpen && (
                <div className="space-y-0.5">
                  {group.items.map(item => {
                    const active = isItemActive(item.href, pathname);
                    const Icon   = item.icon;
                    return (
                      <Link
                        key={`${item.href}-${item.label}`}
                        href={item.href}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150 ${
                          active
                            ? 'bg-g-green/10 text-g-green border-r-2 border-g-green'
                            : 'text-g-muted/70 hover:text-g-text hover:bg-white/[0.03]'
                        }`}
                      >
                        <Icon size={16} className="flex-shrink-0 w-4 h-4" />
                        <span className="flex-1 leading-none">{item.label}</span>
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
      <div className="px-4 py-3 border-t border-g-border/40 mt-auto">
        <Link href="/innstillinger#helse" className="flex items-center gap-2 group">
          <span className="w-2 h-2 rounded-full bg-g-green flex-shrink-0 pulse-live" />
          <p className="text-[11px] text-g-muted/50 group-hover:text-g-muted transition-colors tracking-widest uppercase">
            System Online
          </p>
        </Link>
      </div>
    </aside>
  );
}
