'use client';

import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/contexts/I18nContext';
import { LOCALE_LABEL, type Locale } from '@/lib/i18n';

interface WorkspaceMe {
  brandName:          string | null;
  twitchDisplayName:  string | null;
  twitchLogin:        string | null;
  twitchProfileImage: string | null;
}

export default function Topbar() {
  const router = useRouter();
  const { t, locale, setLocale } = useI18n();
  const [time, setTime]         = useState('');
  const [email, setEmail]       = useState('');
  const [ws, setWs]             = useState<WorkspaceMe | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin]   = useState(false);

  useEffect(() => {
    const localeTag = locale === 'en' ? 'en-GB' : 'no-NO';
    const update = () => {
      setTime(new Date().toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setEmail(user.email ?? '');
    });
  }, []);

  // Load workspace identity from DB — never hardcode brand or username
  useEffect(() => {
    fetch('/api/workspace/me')
      .then(r => r.ok ? r.json() : null)
      .then((d: WorkspaceMe | null) => { if (d) setWs(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/admin/check')
      .then(r => r.ok ? r.json() : { isAdmin: false })
      .then(d => setIsAdmin(!!d.isAdmin))
      .catch(() => {});
  }, []);

  async function loggUt() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  // Display: brand name > Twitch display name > email prefix > fallback
  // Brand name is the primary identity; Twitch display name is secondary context
  const displayName = ws?.brandName ?? ws?.twitchDisplayName ?? email.split('@')[0] ?? '–';
  const initial     = displayName.slice(0, 1).toUpperCase() || '?';
  const profileImg  = ws?.twitchProfileImage ?? null;

  return (
    <header className="h-11 border-b border-zinc-800/60 bg-[#0a0d10]/95 backdrop-blur-sm flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-zinc-600 tracking-widest uppercase font-mono">
          {process.env.NEXT_PUBLIC_APP_NAME || 'Stream Control'}
        </span>
      </div>

      <div className="flex items-center gap-5">
        <span className="text-xs text-zinc-500 font-mono hidden sm:block">{time}</span>

        {isAdmin && (
          <button
            onClick={() => router.push('/admin')}
            className="px-2.5 py-1 border border-emerald-500/30 rounded text-[10px] font-bold text-emerald-400 hover:bg-emerald-500/10 transition-colors tracking-wider uppercase"
          >
            {t('topbar.admin')}
          </button>
        )}

        {/* Language switcher */}
        <div className="flex items-center border border-zinc-700/50 rounded overflow-hidden">
          {(['no', 'en'] as Locale[]).map(l => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
                locale === l
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'text-zinc-500/50 hover:text-zinc-500'
              }`}
              title={LOCALE_LABEL[l]}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-green" />
          <span className="text-xs text-emerald-400 font-semibold tracking-widest uppercase hidden sm:block">
            {t('topbar.systemOnline')}
          </span>
        </div>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="flex items-center gap-2 border border-zinc-700/60 rounded px-3 py-1 hover:border-zinc-600 transition-colors"
          >
            <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center overflow-hidden">
              {profileImg ? (
                <img src={profileImg} alt={displayName} className="w-full h-full object-cover" />
              ) : (
                <span className="text-[10px] text-emerald-400 font-bold">{initial}</span>
              )}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-[11px] text-zinc-100 font-semibold leading-none">{displayName}</p>
              <p className="text-[9px] text-zinc-500 leading-none mt-0.5">
                {ws?.twitchLogin ? `twitch.tv/${ws.twitchLogin}` : email.split('@')[0] || '–'}
              </p>
            </div>
            <span className="text-[9px] text-zinc-500">▾</span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-44 bg-[#0c1115] border border-zinc-800 rounded-lg shadow-2xl z-50 overflow-hidden">
              <div className="px-3 py-2 border-b border-zinc-800/50">
                <p className="text-[10px] text-zinc-100 font-bold truncate">{displayName}</p>
                <p className="text-[9px] text-zinc-500 truncate">{email}</p>
              </div>
              <button
                onClick={() => { setMenuOpen(false); router.push('/innstillinger'); }}
                className="w-full text-left px-3 py-2 text-[11px] text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/50 transition-colors"
              >
                {t('topbar.settings')}
              </button>
              <button
                onClick={loggUt}
                className="w-full text-left px-3 py-2 text-[11px] text-red-400 hover:bg-red-500/5 transition-colors border-t border-zinc-800/50"
              >
                {t('topbar.logout')}
              </button>
            </div>
          )}
        </div>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
      )}
    </header>
  );
}
