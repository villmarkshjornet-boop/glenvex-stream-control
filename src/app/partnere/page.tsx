'use client';

import Link from 'next/link';

const VERKTOY = [
  {
    href: '/partner-hub',
    icon: '◇',
    label: 'Partner Hub',
    desc: 'Administrer affiliate-avtaler, rabattkoder og featured partner-rotasjon',
  },
  {
    href: '/sponsor-manager',
    icon: '◆',
    label: 'Sponsor Manager',
    desc: 'Sponsoravtaler, leveranser og rapportering til annonsører',
  },
];

export default function PartnereHub() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Partnere</h1>
        <p className="text-[10px] text-g-muted mt-0.5">Affiliate-samarbeid, sponsorer og partnerrelasjoner</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {VERKTOY.map(v => (
          <Link key={v.href} href={v.href}
            className="bg-g-card border border-g-border rounded-xl p-6 hover:border-g-green/30 hover:bg-g-green/[0.02] transition-all group flex flex-col gap-4">
            <p className="text-g-green text-2xl">{v.icon}</p>
            <div>
              <p className="text-sm font-bold text-g-text group-hover:text-g-green transition-colors">{v.label}</p>
              <p className="text-xs text-g-muted mt-1 leading-relaxed">{v.desc}</p>
            </div>
            <span className="text-[10px] text-g-green font-bold">Åpne →</span>
          </Link>
        ))}
      </div>

      <div className="bg-g-card border border-g-border rounded-xl p-4">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">Rask tilgang</p>
        <div className="flex gap-2 flex-wrap">
          <Link href="/partner-hub" className="px-3 py-1.5 bg-g-bg border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
            Legg til ny partner
          </Link>
          <Link href="/partner-hub" className="px-3 py-1.5 bg-g-bg border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
            Featured partner-rotasjon
          </Link>
          <Link href="/sponsor-manager" className="px-3 py-1.5 bg-g-bg border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
            Rapporter til sponsor
          </Link>
        </div>
      </div>
    </div>
  );
}
