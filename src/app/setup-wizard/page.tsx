'use client';

import { useState } from 'react';
import Link from 'next/link';

interface Steg {
  id: number;
  tittel: string;
  beskrivelse: string;
  icon: string;
}

const STEG: Steg[] = [
  { id: 1, tittel: 'Streamer-info', beskrivelse: 'Navn og merke', icon: '◆' },
  { id: 2, tittel: 'Twitch', beskrivelse: 'Koble kanal', icon: '🟣' },
  { id: 3, tittel: 'Discord', beskrivelse: 'Koble server', icon: '◈' },
  { id: 4, tittel: 'Kanaler', beskrivelse: 'Velg kanaler', icon: '⊞' },
  { id: 5, tittel: 'Bot-personlighet', beskrivelse: 'Velg tone', icon: '◉' },
  { id: 6, tittel: 'Test', beskrivelse: 'Verifiser', icon: '✓' },
];

const TONER = [
  { id: 'dark_gaming', label: '🌑 Dark Gaming', desc: 'Mørk, rå og ufiltrert – som en hacker' },
  { id: 'cinematic', label: '🎬 Cinematic', desc: 'Dramatisk og filmisk' },
  { id: 'hype', label: '⚡ Hype', desc: 'Ekstremt energisk, alt er episk' },
  { id: 'humoristisk', label: '😄 Humoristisk', desc: 'Lett, morsom og inkluderende' },
];

export default function SetupWizardPage() {
  const [steg, setSteg] = useState(1);
  const [form, setForm] = useState({
    streamerNavn: 'glenvex',
    brandNavn: 'GLENVEX Stream Control',
    twitchKanal: 'glenvex',
    discordGuildId: '',
    liveKanalId: '',
    chatKanalId: '',
    botPersonlighet: 'dark_gaming',
  });
  const [testRes, setTestRes] = useState<{ ok: boolean; msg: string } | null>(null);
  const [tester, setTester] = useState(false);
  const [ferdig, setFerdig] = useState(false);

  function oppdater(felt: string, verdi: string) {
    setForm(p => ({ ...p, [felt]: verdi }));
  }

  async function testLiveVarsel() {
    setTester(true);
    setTestRes(null);
    const res = await fetch('/api/discord/test-live', { method: 'POST' }).catch(() => null);
    setTestRes(res?.ok ? { ok: true, msg: '✓ Test live-varsel sendt til Discord!' } : { ok: false, msg: '✗ Feil. Sjekk at DISCORD_BOT_TOKEN og DISCORD_LIVE_CHANNEL_ID er satt i Vercel.' });
    setTester(false);
  }

  if (ferdig) {
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="bg-g-card border border-g-green/20 rounded-xl p-10 text-center space-y-4">
          <p className="text-4xl">🎉</p>
          <h1 className="text-xl font-black text-g-green uppercase tracking-wider">Systemet er klart!</h1>
          <p className="text-xs text-g-muted leading-relaxed">
            GLENVEX Creator OS er satt opp og klart til bruk.<br />
            Gå til dashboardet for å se full oversikt.
          </p>
          <div className="flex gap-3 justify-center">
            <Link href="/" className="px-5 py-2.5 bg-g-green/10 border border-g-green/20 text-g-green text-xs font-bold rounded hover:bg-g-green/20 transition-all">
              Gå til Dashboard
            </Link>
            <Link href="/system-health" className="px-5 py-2.5 border border-g-border text-g-muted text-xs font-bold rounded hover:text-g-green hover:border-g-green/30 transition-all">
              System Health
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Setup Wizard</h1>
        <p className="text-xs text-g-muted mt-0.5">Kom i gang med GLENVEX Creator OS</p>
      </div>

      {/* Fremgang */}
      <div className="flex items-center gap-2">
        {STEG.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2 flex-1">
            <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center flex-shrink-0 text-xs font-black transition-all ${
              steg > s.id ? 'border-g-green bg-g-green/20 text-g-green' : steg === s.id ? 'border-g-green text-g-green' : 'border-g-border text-g-muted'
            }`}>
              {steg > s.id ? '✓' : s.id}
            </div>
            {i < STEG.length - 1 && (
              <div className={`h-0.5 flex-1 transition-all ${steg > s.id ? 'bg-g-green' : 'bg-g-border'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Steg-innhold */}
      <div className="bg-g-card border border-g-border rounded-xl p-6 space-y-5">
        <div>
          <p className="text-[9px] text-g-muted uppercase tracking-widest">Steg {steg} av {STEG.length}</p>
          <h2 className="text-sm font-black text-g-text mt-1">{STEG[steg - 1].tittel}</h2>
        </div>

        {steg === 1 && (
          <div className="space-y-4">
            <p className="text-xs text-g-muted">Grunnleggende informasjon om streameren.</p>
            {[
              { felt: 'streamerNavn', label: 'Twitch-brukernavn', ph: 'glenvex' },
              { felt: 'brandNavn', label: 'Merkenavn / system-tittel', ph: 'GLENVEX Creator OS' },
            ].map(({ felt, label, ph }) => (
              <div key={felt}>
                <label className="text-[9px] text-g-muted uppercase tracking-widest block mb-1">{label}</label>
                <input value={(form as any)[felt]} onChange={e => oppdater(felt, e.target.value)} placeholder={ph}
                  className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text outline-none focus:border-g-green/50" />
              </div>
            ))}
          </div>
        )}

        {steg === 2 && (
          <div className="space-y-4">
            <p className="text-xs text-g-muted">Twitch-tilkoblingen konfigureres via environment variables i Vercel og Railway.</p>
            <div className="p-4 bg-g-bg border border-g-border rounded-lg space-y-2">
              <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Krever disse env-variablene:</p>
              {['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'TWITCH_USERNAME'].map(v => (
                <div key={v} className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${process.env[v] ? 'bg-g-green' : 'bg-red-400'}`} />
                  <p className="text-xs font-mono text-g-text">{v}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-g-muted">Hent disse fra <a href="https://dev.twitch.tv/console" target="_blank" rel="noopener noreferrer" className="text-g-green hover:underline">dev.twitch.tv/console</a> og legg dem inn i Vercel + Railway.</p>
          </div>
        )}

        {steg === 3 && (
          <div className="space-y-4">
            <p className="text-xs text-g-muted">Discord-integrasjonen konfigureres via environment variables.</p>
            <div className="p-4 bg-g-bg border border-g-border rounded-lg space-y-2">
              <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Krever disse env-variablene:</p>
              {['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID'].map(v => (
                <div key={v} className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${process.env[v] ? 'bg-g-green' : 'bg-red-400'}`} />
                  <p className="text-xs font-mono text-g-text">{v}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-g-muted">Hent fra <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="text-g-green hover:underline">discord.com/developers</a>.</p>
          </div>
        )}

        {steg === 4 && (
          <div className="space-y-4">
            <p className="text-xs text-g-muted">Velg hvilke Discord-kanaler boten skal bruke. Legg kanal-IDene inn i Vercel.</p>
            <div className="p-4 bg-g-bg border border-g-border rounded-lg space-y-3">
              {[
                { key: 'DISCORD_LIVE_CHANNEL_ID', label: 'Live-varsler postes her' },
                { key: 'DISCORD_CHAT_CHANNEL_ID', label: 'Chat-meldinger og promo her' },
                { key: 'DISCORD_LIVE_ROLE_ID', label: 'Rolle som pinges ved live' },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-start gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${process.env[key] ? 'bg-g-green' : 'bg-yellow-400'}`} />
                  <div>
                    <p className="text-xs font-mono text-g-text">{key}</p>
                    <p className="text-[9px] text-g-muted">{label}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[9px] text-g-muted">Høyreklikk på kanalen i Discord → Kopier kanal-ID (krever Developer Mode aktivert).</p>
          </div>
        )}

        {steg === 5 && (
          <div className="space-y-4">
            <p className="text-xs text-g-muted">Velg how boten kommuniserer i chat og Discord.</p>
            <div className="grid grid-cols-2 gap-2">
              {TONER.map(t => (
                <button key={t.id} onClick={() => oppdater('botPersonlighet', t.id)}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    form.botPersonlighet === t.id ? 'border-g-green/30 bg-g-green/10' : 'border-g-border hover:border-g-green/20'
                  }`}>
                  <p className="text-xs font-bold text-g-text">{t.label}</p>
                  <p className="text-[9px] text-g-muted mt-0.5">{t.desc}</p>
                </button>
              ))}
            </div>
            <p className="text-[9px] text-g-muted">Kan endres når som helst i Discord Control Center.</p>
          </div>
        )}

        {steg === 6 && (
          <div className="space-y-4">
            <p className="text-xs text-g-muted">Test at systemet fungerer ved å sende et test live-varsel.</p>
            <button onClick={testLiveVarsel} disabled={tester}
              className="w-full py-3 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold rounded transition-all">
              {tester ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3 h-3 border border-g-green/30 border-t-g-green rounded-full animate-spin" />
                  Sender test...
                </span>
              ) : '((•)) Send test live-varsel til Discord'}
            </button>
            {testRes && (
              <p className={`text-xs font-mono p-3 rounded border ${testRes.ok ? 'text-g-green border-g-green/20 bg-g-green/5' : 'text-red-400 border-red-500/20 bg-red-500/5'}`}>
                {testRes.msg}
              </p>
            )}
            <div className="p-4 bg-g-bg border border-g-border rounded-lg">
              <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Neste steg for full funksjonalitet:</p>
              <ul className="text-xs text-g-muted space-y-1">
                <li>1. Sett opp <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" className="text-g-green hover:underline">Supabase</a> for delt database</li>
                <li>2. Sett <code className="text-g-green">BOT_API_URL</code> i Vercel (Railway URL)</li>
                <li>3. Registrer slash-kommandoer: <code className="text-g-green">npm run bot:deploy</code></li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* Navigasjon */}
      <div className="flex gap-3">
        {steg > 1 && (
          <button onClick={() => setSteg(s => s - 1)}
            className="px-5 py-2.5 border border-g-border text-g-muted text-xs font-bold rounded hover:text-g-text hover:border-g-green/30 transition-all">
            ← Tilbake
          </button>
        )}
        {steg < STEG.length ? (
          <button onClick={() => setSteg(s => s + 1)}
            className="flex-1 py-2.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold rounded transition-all">
            Neste →
          </button>
        ) : (
          <button onClick={() => setFerdig(true)}
            className="flex-1 py-2.5 bg-g-green/20 border border-g-green/30 hover:bg-g-green/30 text-g-green text-xs font-bold rounded transition-all">
            ◆ Fullfør setup
          </button>
        )}
      </div>
    </div>
  );
}
