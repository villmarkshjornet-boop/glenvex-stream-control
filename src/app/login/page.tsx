'use client';

import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

type Mode = 'signin' | 'signup';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [magicSent, setMagicSent] = useState(false);
  const [useMagic, setUseMagic] = useState(false);

  const supabase = createSupabaseBrowserClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (useMagic) {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${location.origin}/api/auth/callback` },
        });
        if (error) throw error;
        setMagicSent(true);
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${location.origin}/api/auth/callback` },
        });
        if (error) throw error;
        setMagicSent(true); // shows "check email" message
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push('/');
        router.refresh();
      }
    } catch (err: any) {
      setError(err.message ?? 'Noe gikk galt');
    } finally {
      setLoading(false);
    }
  }

  if (magicSent) {
    return (
      <div className="min-h-screen bg-g-bg flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-g-green/10 border border-g-green/30 flex items-center justify-center mx-auto">
            <span className="text-g-green text-xl">✓</span>
          </div>
          <h2 className="text-lg font-black text-g-text">Sjekk e-posten din</h2>
          <p className="text-sm text-g-muted">
            Vi har sendt en lenke til <span className="text-g-text font-bold">{email}</span>.
            Klikk lenken for å logge inn.
          </p>
          <button onClick={() => setMagicSent(false)}
            className="text-xs text-g-muted hover:text-g-green transition-colors">
            ← Tilbake
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-g-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">

        {/* Logo */}
        <div className="text-center space-y-1">
          <div className="text-g-green font-black text-2xl tracking-[0.15em] uppercase"
            style={{ textShadow: '0 0 20px rgba(0,255,65,0.4)' }}>
            GLENVEX
          </div>
          <p className="text-[10px] text-g-muted tracking-[0.3em] uppercase">Creator OS</p>
        </div>

        {/* Card */}
        <div className="bg-g-card border border-g-border rounded-xl p-6 space-y-5">
          <div>
            <h1 className="text-sm font-black text-g-text">
              {mode === 'signin' ? 'Logg inn' : 'Opprett konto'}
            </h1>
            <p className="text-[11px] text-g-muted mt-0.5">
              {mode === 'signin' ? 'Velkommen tilbake' : 'Kom i gang på under 5 minutter'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-[10px] text-g-muted uppercase tracking-wider font-bold block mb-1.5">
                E-post
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="din@epost.no"
                required
                className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder-g-muted/40 focus:outline-none focus:border-g-green/50 transition-colors"
              />
            </div>

            {!useMagic && (
              <div>
                <label className="text-[10px] text-g-muted uppercase tracking-wider font-bold block mb-1.5">
                  Passord
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required={!useMagic}
                  minLength={6}
                  className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder-g-muted/40 focus:outline-none focus:border-g-green/50 transition-colors"
                />
              </div>
            )}

            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-g-green/10 border border-g-green/30 hover:bg-g-green/20 hover:border-g-green/50 text-g-green font-bold text-sm py-2.5 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Venter...' : useMagic ? 'Send innloggingslenke' : mode === 'signin' ? 'Logg inn' : 'Opprett konto'}
            </button>
          </form>

          {/* Magic link toggle */}
          <button
            onClick={() => { setUseMagic(v => !v); setError(''); }}
            className="w-full text-[11px] text-g-muted hover:text-g-text transition-colors text-center"
          >
            {useMagic ? 'Bruk passord i stedet' : 'Logg inn uten passord (e-postlenke)'}
          </button>
        </div>

        {/* Toggle mode */}
        <p className="text-center text-[11px] text-g-muted">
          {mode === 'signin' ? 'Har du ikke konto?' : 'Har du allerede konto?'}{' '}
          <button
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); }}
            className="text-g-green hover:underline font-bold"
          >
            {mode === 'signin' ? 'Registrer deg' : 'Logg inn'}
          </button>
        </p>
      </div>
    </div>
  );
}
