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
    <header className="h-12 border-b border-g-border bg-g-sidebar/80 backdrop-blur-sm flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-xs text-g-muted tracking-widest uppercase font-mono">
          {process.env.NEXT_PUBLIC_APP_NAME || 'Stream Control'}
        </span>
      </div>

      <div className="flex items-center gap-5">
        <span className="text-xs text-g-muted font-mono hidden sm:block">{time}</span>

        {isAdmin && (
          <button
            onClick={() => router.push('/admin')}
            className="px-2.5 py-1 border border-g-green/30 rounded text-[10px] font-bold text-g-green hover:bg-g-green/10 transition-colors tracking-wider uppercase"
          >
            {t('topbar.admin')}
          </button>
        )}

        {/* Language switcher */}
        <div className="flex items-center border border-g-border rounded overflow-hidden">
          {(['no', 'en'] as Locale[]).map(l => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
                locale === l
                  ? 'bg-g-green/15 text-g-green'
                  : 'text-g-muted/50 hover:text-g-muted'
              }`}
              title={LOCALE_LABEL[l]}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-g-green animate-pulse-green"
            style={{ boxShadow: '0 0 6px #00ff41' }} />
          <span className="text-xs text-g-green font-semibold tracking-widest uppercase hidden sm:block">
            {t('topbar.systemOnline')}
          </span>
        </div>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="flex items-center gap-2 border border-g-border rounded px-3 py-1 hover:border-g-green/30 transition-colors"
          >
            <div className="w-6 h-6 rounded-full bg-g-green/20 border border-g-green/30 flex items-center justify-center overflow-hidden">
              {profileImg ? (
                <img src={profileImg} alt={displayName} className="w-full h-full object-cover" />
              ) : (
                <span className="text-[10px] text-g-green font-bold">{initial}</span>
              )}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-[11px] text-g-text font-semibold leading-none">{displayName}</p>
              <p className="text-[9px] text-g-muted leading-none mt-0.5">
                {ws?.twitchLogin ? `twitch.tv/${ws.twitchLogin}` : email.split('@')[0] || '–'}
              </p>
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
                {t('topbar.settings')}
              </button>
              <button
                onClick={loggUt}
                className="w-full text-left px-3 py-2 text-[11px] text-red-400 hover:bg-red-500/5 transition-colors border-t border-g-border/50"
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
