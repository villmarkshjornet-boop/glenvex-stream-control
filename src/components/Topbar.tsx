'use client';

import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function Topbar() {
  const router = useRouter();
  const [time, setTime] = useState('');
  const [email, setEmail] = useState('');
  const [brandName, setBrandName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const update = () => {
      setTime(new Date().toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setEmail(user.email ?? '');
        setBrandName(user.user_metadata?.brand_name ?? user.user_metadata?.workspace_id ?? '');
      }
    });
  }, []);

  async function loggUt() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const initial = (brandName || email).slice(0, 1).toUpperCase() || 'G';
  const displayName = brandName || email.split('@')[0] || 'GLENVEX';

  return (
    <header className="h-12 border-b border-g-border bg-g-sidebar/80 backdrop-blur-sm flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-xs text-g-muted tracking-widest uppercase font-mono">
          {process.env.NEXT_PUBLIC_APP_NAME || 'GLENVEX Stream Control'}
        </span>
      </div>

      <div className="flex items-center gap-5">
        <span className="text-xs text-g-muted font-mono hidden sm:block">{time}</span>

        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-g-green animate-pulse-green"
            style={{ boxShadow: '0 0 6px #00ff41' }} />
          <span className="text-xs text-g-green font-semibold tracking-widest uppercase hidden sm:block">
            System Online
          </span>
        </div>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="flex items-center gap-2 border border-g-border rounded px-3 py-1 hover:border-g-green/30 transition-colors"
          >
            <div className="w-6 h-6 rounded-full bg-g-green/20 border border-g-green/30 flex items-center justify-center">
              <span className="text-[10px] text-g-green font-bold">{initial}</span>
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-[11px] text-g-text font-semibold leading-none">{displayName}</p>
              <p className="text-[9px] text-g-muted leading-none mt-0.5">Admin</p>
            </div>
            <span className="text-[9px] text-g-muted">▾</span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-44 bg-g-card border border-g-border rounded-lg shadow-xl z-50 overflow-hidden">
              <div className="px-3 py-2 border-b border-g-border/50">
                <p className="text-[10px] text-g-text font-bold truncate">{displayName}</p>
                <p className="text-[9px] text-g-muted truncate">{email}</p>
              </div>
              <button
                onClick={() => { setMenuOpen(false); router.push('/innstillinger'); }}
                className="w-full text-left px-3 py-2 text-[11px] text-g-muted hover:text-g-text hover:bg-white/[0.03] transition-colors"
              >
                Innstillinger
              </button>
              <button
                onClick={loggUt}
                className="w-full text-left px-3 py-2 text-[11px] text-red-400 hover:bg-red-500/5 transition-colors border-t border-g-border/50"
              >
                Logg ut
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Close menu on outside click */}
      {menuOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
      )}
    </header>
  );
}
