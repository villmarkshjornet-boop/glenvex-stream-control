'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/content-factory-admin',            label: 'Pipeline',   icon: '◆' },
  { href: '/content-factory-admin/highlights', label: 'Highlights', icon: '▶' },
  { href: '/content-factory-admin/qa',         label: 'QA Review',  icon: '✦' },
  { href: '/content-factory-admin/jobs',       label: 'Jobs',       icon: '☰' },
];

export default function ContentFactoryLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <div className="border-b border-g-border bg-g-card/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-g-green font-black text-sm tracking-widest uppercase">Content Factory</span>
            <span className="text-[9px] text-g-muted border border-g-border rounded px-1.5 py-0.5 font-mono">BETA</span>
          </div>
          <p className="text-[9px] text-g-muted/60 uppercase tracking-widest">Ingen autopublisering · Manuell godkjenning</p>
        </div>

        {/* Tabs */}
        <div className="px-6 flex gap-0 border-t border-g-border/40">
          {TABS.map(tab => {
            const exact = tab.href === '/content-factory-admin';
            const active = exact ? pathname === tab.href : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`
                  flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-bold tracking-wide transition-all border-b-2
                  ${active
                    ? 'text-g-green border-g-green'
                    : 'text-g-muted border-transparent hover:text-g-text hover:border-g-border'}
                `}
              >
                <span className={`text-[9px] ${active ? 'text-g-green' : 'text-g-muted'}`}>{tab.icon}</span>
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Page content — full width */}
      <div className="flex-1 p-6">
        {children}
      </div>
    </div>
  );
}
