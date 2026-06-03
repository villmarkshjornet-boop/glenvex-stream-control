'use client';

import { useEffect, useState } from 'react';

export default function Topbar() {
  const [time, setTime] = useState('');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="h-12 border-b border-g-border bg-g-sidebar/80 backdrop-blur-sm flex items-center justify-between px-6 flex-shrink-0">
      {/* App name */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-g-muted tracking-widest uppercase font-mono">
          {process.env.NEXT_PUBLIC_APP_NAME || 'GLENVEX Stream Control'}
        </span>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-5">
        {/* Clock */}
        <span className="text-xs text-g-muted font-mono hidden sm:block">{time}</span>

        {/* System online */}
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full bg-g-green animate-pulse-green"
            style={{ boxShadow: '0 0 6px #00ff41' }}
          />
          <span className="text-xs text-g-green font-semibold tracking-widest uppercase">
            System Online
          </span>
        </div>

        {/* Admin badge */}
        <div className="flex items-center gap-2 border border-g-border rounded px-3 py-1">
          <div className="w-6 h-6 rounded-full bg-g-green/20 border border-g-green/30 flex items-center justify-center">
            <span className="text-[10px] text-g-green font-bold">G</span>
          </div>
          <div className="hidden sm:block">
            <p className="text-[11px] text-g-text font-semibold leading-none">GLENVEX</p>
            <p className="text-[9px] text-g-muted leading-none mt-0.5">Admin</p>
          </div>
        </div>
      </div>
    </header>
  );
}
