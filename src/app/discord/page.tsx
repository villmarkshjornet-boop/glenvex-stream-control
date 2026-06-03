'use client';

import { useEffect, useState } from 'react';
import type { GuildInfo, Settings } from '@/types';

interface Channel {
  id: string;
  name: string;
  type: number;
  position: number;
  parent_id?: string;
}

const CHANNEL_TYPES: Record<number, string> = {
  0: 'Tekst',
  2: 'Tale',
  4: 'Kategori',
  5: 'Kunngjøring',
  15: 'Forum',
};

export default function DiscordPage() {
  const [guild, setGuild] = useState<GuildInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [suggestions, setSuggestions] = useState<string | null>(null);
  const [loadingChannels, setLoadingChannels] = useState(false);

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(d => {
      setGuild(d.guild);
      setSettings(d.settings);
    }).catch(() => {});
  }, []);

  async function testAlert() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/discord/test-live', { method: 'POST' });
      const data = await res.json();
      setTestResult({ ok: res.ok, msg: res.ok ? data.message : data.error });
    } catch (e) {
      setTestResult({ ok: false, msg: (e as Error).message });
    }
    setTesting(false);
  }

  async function hentKanaler() {
    setLoadingChannels(true);
    setSuggestions(null);
    try {
      const res = await fetch('/api/discord/channels');
      if (res.ok) {
        const data = await res.json();
        setChannels(data.channels ?? []);
        setSuggestions(data.suggestions ?? null);
      }
    } catch {}
    setLoadingChannels(false);
  }

  const kategorier = channels.filter(c => c.type === 4);
  const utenKategori = channels.filter(c => c.type !== 4 && !c.parent_id);

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Discord</h1>
        <p className="text-xs text-g-muted mt-0.5">Discord bot-status og live-varsling</p>
      </div>

      {/* Server info */}
      <div className="bg-g-card border border-g-border rounded-lg p-5">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">Server Info</h2>
        {guild ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] text-g-muted uppercase tracking-widest">Server navn</p>
              <p className="text-g-text font-semibold mt-0.5">{guild.name}</p>
            </div>
            <div>
              <p className="text-[10px] text-g-muted uppercase tracking-widest">Medlemmer</p>
              <p className="text-g-green font-bold font-mono mt-0.5">
                {(guild.approximate_member_count ?? guild.member_count ?? 0).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-g-muted uppercase tracking-widest">Online</p>
              <p className="text-g-green font-bold font-mono mt-0.5">
                {guild.approximate_presence_count?.toLocaleString() ?? '–'}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-g-muted uppercase tracking-widest">Server ID</p>
              <p className="text-g-muted text-xs font-mono mt-0.5">{guild.id}</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-g-muted">Ingen Discord-tilkobling. Sjekk DISCORD_BOT_TOKEN og DISCORD_GUILD_ID i .env</p>
        )}
      </div>

      {/* Kanalstruktur + AI-forslag */}
      <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase">
            Kanalstruktur
          </h2>
          <button
            onClick={hentKanaler}
            disabled={loadingChannels}
            className="px-3 py-1.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold tracking-widest uppercase rounded transition-all"
          >
            {loadingChannels ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border border-g-green/30 border-t-g-green rounded-full animate-spin" />
                Analyserer...
              </span>
            ) : '◆ Hent + Analyser'}
          </button>
        </div>

        {channels.length > 0 && (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {kategorier.map(kat => (
              <div key={kat.id}>
                <p className="text-[10px] text-g-muted uppercase tracking-widest font-bold mt-3 mb-1">
                  {kat.name}
                </p>
                {channels
                  .filter(c => c.parent_id === kat.id)
                  .sort((a, b) => a.position - b.position)
                  .map(ch => (
                    <div key={ch.id} className="flex items-center gap-2 py-1 pl-3">
                      <span className="text-g-muted text-xs">
                        {ch.type === 2 ? '🔊' : '#'}
                      </span>
                      <span className="text-xs text-g-text">{ch.name}</span>
                      <span className="text-[10px] text-g-muted ml-auto">
                        {CHANNEL_TYPES[ch.type] ?? ''}
                      </span>
                    </div>
                  ))}
              </div>
            ))}
            {utenKategori.map(ch => (
              <div key={ch.id} className="flex items-center gap-2 py-1">
                <span className="text-g-muted text-xs">#</span>
                <span className="text-xs text-g-text">{ch.name}</span>
              </div>
            ))}
          </div>
        )}

        {suggestions && (
          <div className="border-t border-g-border pt-4">
            <p className="text-[10px] text-g-green uppercase tracking-widest font-bold mb-2">
              ◆ AI-forslag
            </p>
            <p className="text-xs text-g-text font-mono whitespace-pre-wrap leading-relaxed">
              {suggestions}
            </p>
          </div>
        )}

        {channels.length === 0 && !loadingChannels && (
          <p className="text-xs text-g-muted">
            Klikk "Hent + Analyser" for å se kanalstruktur og få AI-forslag.
          </p>
        )}
      </div>

      {/* Bot config */}
      <div className="bg-g-card border border-g-border rounded-lg p-5">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-4">Bot Konfigurasjon</h2>
        <div className="space-y-2">
          {[
            { label: 'Live Kanal ID', value: settings?.discordLiveChannelId || '–' },
            { label: 'Varsel Rolle ID', value: settings?.discordLiveRoleId || '–' },
            { label: 'Auto Post Live', value: settings?.autoPostLive ? '✓ På' : '✗ Av' },
            { label: 'Ping Rolle', value: settings?.pingRole ? '✓ På' : '✗ Av' },
          ].map(item => (
            <div key={item.label} className="flex justify-between py-2 border-b border-g-border/50 last:border-0">
              <span className="text-xs text-g-muted">{item.label}</span>
              <span className="text-xs text-g-text font-mono">{item.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Test embed */}
      <div className="bg-g-card border border-g-border rounded-lg p-5">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-3">Test Live Varsel</h2>
        <p className="text-xs text-g-muted mb-4">
          Sender en test-embed til live-kanalen. Krever at discordLiveChannelId er satt.
        </p>
        <button
          onClick={testAlert}
          disabled={testing}
          className="px-4 py-2 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 hover:border-g-green/40 text-g-green text-xs font-bold tracking-widest uppercase rounded transition-all"
        >
          {testing ? 'Sender...' : '((•)) Send Test Varsel'}
        </button>
        {testResult && (
          <p className={`mt-3 text-xs font-mono ${testResult.ok ? 'text-g-green' : 'text-red-400'}`}>
            {testResult.ok ? '✓ ' : '✗ '}{testResult.msg}
          </p>
        )}
      </div>

      {/* Slash commands */}
      <div className="bg-g-card border border-g-border rounded-lg p-5">
        <h2 className="text-xs text-g-muted font-semibold tracking-widest uppercase mb-3">Slash Kommandoer</h2>
        <div className="grid grid-cols-2 gap-2">
          {['/live', '/twitch', '/promo', '/setup', '/status', '/socials', '/clip', '/kanaler'].map(cmd => (
            <div key={cmd} className="flex items-center gap-2 py-1.5 px-3 bg-g-bg border border-g-border rounded">
              <span className="text-g-green text-xs font-mono font-bold">{cmd}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
