'use client';

import { BrandLogo } from '@/components/ui';

export default function WaitingPage() {
  return (
    <div className="min-h-screen bg-g-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center space-y-6">
        <BrandLogo subtitle="Creator OS · Alpha" />

        <div className="bg-g-card border border-g-border rounded-2xl p-8 space-y-5">
          <div className="w-12 h-12 rounded-full bg-g-green/10 border border-g-green/20 flex items-center justify-center mx-auto">
            <span className="text-g-green text-xl">⏳</span>
          </div>

          <div>
            <h1 className="text-base font-black text-g-text">Du er på ventelisten</h1>
            <p className="text-xs text-g-muted mt-2 leading-relaxed">
              Onboardingen din er fullført. En administrator vil aktivere tilgangen din snart.
              Du får tilgang til Glenvex Creator OS når du er godkjent som alpha-tester.
            </p>
          </div>

          <div className="bg-g-bg border border-g-border/50 rounded-xl p-4 text-left space-y-2">
            <p className="text-[10px] text-g-muted font-bold uppercase tracking-widest">Hva skjer nå?</p>
            {[
              'Vi verifiserer Twitch- og Discord-tilkoblingen din',
              'Du mottar beskjed når tilgangen er aktivert',
              'Frem til da kan du ikke logge inn på dashbordet',
            ].map(t => (
              <div key={t} className="flex items-start gap-2">
                <span className="text-g-green/60 text-[10px] mt-0.5">◆</span>
                <p className="text-[11px] text-g-muted">{t}</p>
              </div>
            ))}
          </div>

          <a href="/api/auth/logout"
            className="inline-block px-4 py-2 border border-g-border rounded text-[10px] text-g-muted hover:text-g-text transition-colors">
            Logg ut
          </a>
        </div>
      </div>
    </div>
  );
}
