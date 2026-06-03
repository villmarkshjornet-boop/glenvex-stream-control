'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { label: 'Dashboard', href: '/', icon: '⊞' },
  { label: 'Live Overvåking', href: '/live-overvaking', icon: '⊙' },
  { label: 'Discord', href: '/discord', icon: '◈' },
  { label: 'Kommandoer', href: '/kommandoer', icon: '≫' },
  { label: 'Markedsføring', href: '/markedsforing', icon: '⟐' },
  { label: 'AI Assistent', href: '/ai-assistent', icon: '◆' },
  { label: 'Statistikk', href: '/statistikk', icon: '◎' },
  { label: 'Innstillinger', href: '/innstillinger', icon: '⚙' },
  { label: 'Logs', href: '/logs', icon: '▤' },
  { label: 'Systemstatus', href: '/systemstatus', icon: '⊛' },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 min-h-screen bg-g-sidebar border-r border-g-border flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-g-border">
        <div className="text-g-green font-black text-xl tracking-[0.15em] uppercase"
          style={{ textShadow: '0 0 12px rgba(0,255,65,0.5), 0 0 24px rgba(0,255,65,0.25)' }}>
          GLENVEX
        </div>
        <div className="text-[10px] text-g-muted tracking-[0.4em] uppercase mt-0.5">
          Stream Control
        </div>
      </div>

      {/* Tagline */}
      <div className="px-6 pt-5 pb-1">
        <p className="text-[10px] text-g-green font-semibold tracking-[0.25em] uppercase">
          Funksjoner
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-0.5">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded text-sm transition-all duration-150 group ${
                active
                  ? 'bg-g-green/10 text-g-green border border-g-green/20'
                  : 'text-g-muted hover:text-g-text hover:bg-white/[0.03] border border-transparent'
              }`}
            >
              <span
                className={`text-[15px] w-5 text-center transition-all ${
                  active ? 'text-g-green' : 'text-g-muted group-hover:text-g-text'
                }`}
              >
                {item.icon}
              </span>
              <span className="font-medium">{item.label}</span>
              {active && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-g-green"
                  style={{ boxShadow: '0 0 6px #00ff41' }} />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-g-border">
        <p className="text-[9px] text-g-muted/60 text-center tracking-widest uppercase">
          GLENVEX STREAM CONTROL
        </p>
        <p className="text-[9px] text-g-muted/40 text-center tracking-wider uppercase mt-0.5">
          DREVET AV COMMUNITY
        </p>
      </div>
    </aside>
  );
}
