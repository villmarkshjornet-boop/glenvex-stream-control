'use client';

import React, { useEffect, useState } from 'react';
import type { GuildInfo, Settings } from '@/types';
import { PageHeader } from '@/components/ui';

interface Channel {
  id: string;
  name: string;
  type: number;
  position: number;
  parent_id?: string;
}

interface SlettAction { id: string; navn: string; }
interface OpprettAction { navn: string; kategori?: string; emne?: string; publiser?: boolean; karakterInfo?: string; }
interface RenameAction { id: string; fra: string; til: string; }

interface Suggestions {
  tekst: string;
  slett: SlettAction[];
  opprett: OpprettAction[];
  rename: RenameAction[];
}

export default function DiscordPage() {
  const [guild, setGuild] = useState<GuildInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [meldingKanal, setMeldingKanal] = useState('');
  const [meldingTekst, setMeldingTekst] = useState('');
  const [sendingMelding, setSendingMelding] = useState(false);
  const [meldingResult, setMeldingResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executeResult, setExecuteResult] = useState<string[] | null>(null);

  // Valgte handlinger
  const [valgtSlett, setValgtSlett] = useState<Set<string>>(new Set());
  const [valgtOpprett, setValgtOpprett] = useState<Set<number>>(new Set());
  const [valgtRename, setValgtRename] = useState<Set<string>>(new Set());

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
    setExecuteResult(null);
    setValgtSlett(new Set());
    setValgtOpprett(new Set());
    setValgtRename(new Set());
    try {
      const res = await fetch('/api/discord/channels');
      if (res.ok) {
        const data = await res.json();
        setChannels(data.channels ?? []);
        if (data.suggestions) {
          setSuggestions(data.suggestions);
          setValgtSlett(new Set(data.suggestions.slett?.map((s: SlettAction) => s.id) ?? []));
          setValgtOpprett(new Set(data.suggestions.opprett?.map((_: any, i: number) => i) ?? []));
          setValgtRename(new Set(data.suggestions.rename?.map((r: RenameAction) => r.id) ?? []));
        }
      }
    } catch {}
    setLoadingChannels(false);
  }

  async function utforEndringer() {
    if (!suggestions) return;
    setExecuting(true);
    setExecuteResult(null);
    try {
      const res = await fetch('/api/discord/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slett: suggestions.slett.filter(s => valgtSlett.has(s.id)),
          opprett: suggestions.opprett.filter((_, i) => valgtOpprett.has(i)),
          rename: suggestions.rename.filter(r => valgtRename.has(r.id)),
        }),
      });
      const data = await res.json();
      setExecuteResult(data.resultater ?? []);
      await hentKanaler();
    } catch (e) {
      setExecuteResult([`✗ Feil: ${(e as Error).message}`]);
    }
    setExecuting(false);
  }

  async function sendManuellMelding(e: React.FormEvent) {
    e.preventDefault();
    setSendingMelding(true);
    setMeldingResult(null);
    try {
      const res = await fetch('/api/discord/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: meldingKanal, message: meldingTekst }),
      });
      const data = await res.json();
      if (res.ok) {
        setMeldingResult({ ok: true, msg: 'Melding sendt!' });
        setMeldingTekst('');
      } else {
        setMeldingResult({ ok: false, msg: data.error ?? 'Feil' });
      }
    } catch (e) {
      setMeldingResult({ ok: false, msg: (e as Error).message });
    }
    setSendingMelding(false);
  }

  const [flags, setFlags] = React.useState<Record<string, unknown> | null>(null);
  const [savingFlags, setSavingFlags] = React.useState(false);

  React.useEffect(() => {
    fetch('/api/community-games')
      .then(r => r.json())
      .then((d: { featureFlags: Record<string, unknown> | null }) => setFlags(d.featureFlags))
      .catch(() => {});
  }, []);

  async function saveFlags() {
    if (!flags) return;
    setSavingFlags(true);
    await fetch('/api/community-games', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(flags) });
    setSavingFlags(false);
  }

  const kategorier = channels.filter(c => c.type === 4);

  const harValgte = valgtSlett.size > 0 || valgtOpprett.size > 0 || valgtRename.size > 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      <PageHeader title="Discord" subtitle="Discord bot-status og live-varsling" />

      {/* Server info */}
      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <p className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-4">Server Info</p>
        {guild ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-g-muted uppercase tracking-widest">Server navn</p>
              <p className="text-g-text font-semibold mt-0.5">{guild.name}</p>
            </div>
            <div>
              <p className="text-xs text-g-muted uppercase tracking-widest">Medlemmer</p>
              <p className="text-g-green font-bold font-mono mt-0.5">
                {(guild.approximate_member_count ?? guild.member_count ?? 0).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-g-muted uppercase tracking-widest">Online</p>
              <p className="text-g-green font-bold font-mono mt-0.5">
                {guild.approximate_presence_count?.toLocaleString() ?? '–'}
              </p>
            </div>
            <div>
              <p className="text-xs text-g-muted uppercase tracking-widest">Server ID</p>
              <p className="text-g-muted text-xs font-mono mt-0.5">{guild.id}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-g-muted">Ingen Discord-tilkobling.</p>
        )}
      </div>

      {/* Kanalstruktur + AI-forslag */}
      <div className="bg-g-card border border-g-border rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold tracking-widest uppercase text-g-muted">Kanalstruktur</p>
          <button
            onClick={hentKanaler}
            disabled={loadingChannels}
            className="px-4 py-2 bg-g-green/10 border border-g-green/25 text-g-green text-sm font-medium rounded-lg hover:bg-g-green/20 hover:shadow-green-sm transition-all duration-200 disabled:opacity-50"
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
          <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
            {kategorier.map(kat => (
              <div key={kat.id}>
                <p className="text-xs text-g-muted uppercase tracking-widest font-bold mt-3 mb-1">{kat.name}</p>
                {channels
                  .filter(c => c.parent_id === kat.id)
                  .sort((a, b) => a.position - b.position)
                  .map(ch => (
                    <div key={ch.id} className="flex items-center gap-2 py-0.5 pl-3">
                      <span className="text-g-muted text-xs">{ch.type === 2 ? '🔊' : '#'}</span>
                      <span className="text-sm text-g-text">{ch.name}</span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        )}

        {/* AI-forslag med checkboxer */}
        {suggestions && (
          <div className="border-t border-g-border/40 pt-4 mt-4 space-y-4">
            <p className="text-xs text-g-green uppercase tracking-widest font-bold">◆ AI-analyse</p>
            <p className="text-sm text-g-muted leading-relaxed">{suggestions.tekst}</p>

            {suggestions.slett?.length > 0 && (
              <div>
                <p className="text-xs text-red-400 uppercase tracking-widest font-bold mb-2">Bør slettes</p>
                {suggestions.slett.map(s => (
                  <label key={s.id} className="flex items-start gap-2 py-1.5 cursor-pointer group">
                    <input type="checkbox" checked={valgtSlett.has(s.id)}
                      onChange={e => { const next = new Set(valgtSlett); e.target.checked ? next.add(s.id) : next.delete(s.id); setValgtSlett(next); }}
                      className="accent-red-400 mt-0.5" />
                    <div>
                      <span className="text-sm text-g-text font-mono group-hover:text-red-400 transition-colors">#{s.navn}</span>
                      {(s as any).grunn && <p className="text-[11px] text-g-muted mt-0.5">{(s as any).grunn}</p>}
                    </div>
                  </label>
                ))}
              </div>
            )}

            {suggestions.rename?.length > 0 && (
              <div>
                <p className="text-xs text-yellow-400 uppercase tracking-widest font-bold mb-2">Bør omdøpes</p>
                {suggestions.rename.map(r => (
                  <label key={r.id} className="flex items-center gap-2 py-1 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={valgtRename.has(r.id)}
                      onChange={e => {
                        const next = new Set(valgtRename);
                        e.target.checked ? next.add(r.id) : next.delete(r.id);
                        setValgtRename(next);
                      }}
                      className="accent-yellow-400"
                    />
                    <span className="text-sm text-g-text font-mono group-hover:text-yellow-400 transition-colors">
                      #{r.fra} → #{r.til}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {suggestions.opprett?.length > 0 && (
              <div>
                <p className="text-xs text-g-green uppercase tracking-widest font-bold mb-2">Bør opprettes</p>
                {suggestions.opprett.map((o, i) => (
                  <label key={i} className="flex items-start gap-2 py-1 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={valgtOpprett.has(i)}
                      onChange={e => {
                        const next = new Set(valgtOpprett);
                        e.target.checked ? next.add(i) : next.delete(i);
                        setValgtOpprett(next);
                      }}
                      className="accent-green-400 mt-0.5"
                    />
                    <div>
                      <span className="text-sm text-g-text font-mono group-hover:text-g-green transition-colors">#{o.navn}</span>
                      {o.kategori && <span className="text-[11px] text-g-muted ml-2">i {o.kategori}</span>}
                      {o.emne && <p className="text-[11px] text-g-muted mt-0.5">{o.emne}</p>}
                      {o.publiser && <span className="text-[11px] text-g-green">↳ Publiserer innhold automatisk</span>}
                    </div>
                  </label>
                ))}
              </div>
            )}

            {harValgte && (
              <button
                onClick={utforEndringer}
                disabled={executing}
                className="w-full py-2.5 bg-g-green/10 border border-g-green/25 hover:bg-g-green/20 hover:shadow-green-sm text-g-green text-sm font-medium rounded-lg transition-all duration-200 disabled:opacity-50"
              >
                {executing ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3 h-3 border border-g-green/30 border-t-g-green rounded-full animate-spin" />
                    Utfører endringer...
                  </span>
                ) : `◆ Utfør valgte endringer (${valgtSlett.size + valgtOpprett.size + valgtRename.size})`}
              </button>
            )}

            {executeResult && (
              <div className="border border-g-border rounded-lg p-3 space-y-1">
                {executeResult.map((r, i) => (
                  <p key={i} className={`text-xs font-mono ${r.startsWith('✓') ? 'text-g-green' : r.startsWith('  ↳') ? 'text-g-muted pl-3' : 'text-red-400'}`}>
                    {r}
                  </p>
                ))}
              </div>
            )}

            {channels.length === 0 && !loadingChannels && (
              <p className="text-sm text-g-muted">Klikk "Hent + Analyser" for å se kanalstruktur og få AI-forslag.</p>
            )}
          </div>
        )}
      </div>

      {/* Bot config */}
      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <p className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-4">Bot Konfigurasjon</p>
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
      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <p className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-3">Test Live Varsel</p>
        <button
          onClick={testAlert}
          disabled={testing}
          className="px-4 py-2 bg-g-green/10 border border-g-green/25 hover:bg-g-green/20 hover:shadow-green-sm text-g-green text-sm font-medium rounded-lg transition-all duration-200 disabled:opacity-50"
        >
          {testing ? 'Sender...' : '((•)) Send Test Varsel'}
        </button>
        {testResult && (
          <p className={`mt-3 text-xs font-mono ${testResult.ok ? 'text-g-green' : 'text-red-400'}`}>
            {testResult.ok ? '✓ ' : '✗ '}{testResult.msg}
          </p>
        )}
      </div>

      {/* Manuell melding */}
      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <p className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-1">Send melding som bot</p>
        <p className="text-xs text-g-muted mb-4">Send en melding direkte på en kanal via Discord-boten.</p>
        <form onSubmit={sendManuellMelding} className="space-y-3">
          <div>
            <label className="text-xs text-g-muted uppercase tracking-wider font-bold block mb-1">Kanal</label>
            {channels.filter(c => c.type === 0).length > 0 ? (
              <select
                value={meldingKanal}
                onChange={e => setMeldingKanal(e.target.value)}
                required
                className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200"
              >
                <option value="">Velg kanal...</option>
                {channels.filter(c => c.type === 0).sort((a, b) => a.position - b.position).map(ch => (
                  <option key={ch.id} value={ch.id}>#{ch.name}</option>
                ))}
              </select>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={meldingKanal}
                  onChange={e => setMeldingKanal(e.target.value)}
                  placeholder="Kanal-ID (hent kanaler ovenfor)"
                  required
                  className="flex-1 bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text font-mono placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200"
                />
                <button type="button" onClick={hentKanaler}
                  className="px-4 py-2 text-g-muted text-sm hover:text-g-text transition-colors">
                  Hent kanaler
                </button>
              </div>
            )}
          </div>
          <div>
            <label className="text-xs text-g-muted uppercase tracking-wider font-bold block mb-1">Melding</label>
            <textarea
              value={meldingTekst}
              onChange={e => setMeldingTekst(e.target.value)}
              placeholder="Skriv meldingen her..."
              required
              rows={3}
              className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200 resize-none"
            />
          </div>
          {meldingResult && (
            <p className={`text-xs font-mono ${meldingResult.ok ? 'text-g-green' : 'text-red-400'}`}>
              {meldingResult.ok ? '✓ ' : '✗ '}{meldingResult.msg}
            </p>
          )}
          <button type="submit" disabled={sendingMelding}
            className="px-4 py-2 bg-g-green/10 border border-g-green/25 hover:bg-g-green/20 hover:shadow-green-sm text-g-green text-sm font-medium rounded-lg transition-all duration-200 disabled:opacity-50">
            {sendingMelding ? 'Sender...' : 'Send melding'}
          </button>
        </form>
      </div>

      {/* Slash commands */}
      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <p className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-3">Slash Kommandoer</p>
        <div className="grid grid-cols-2 gap-2">
          {['/live', '/twitch', '/promo', '/setup', '/status', '/socials', '/clip', '/kanaler', '/blackjack', '/roulette', '/achievements', '/quests', '/prestige'].map(cmd => (
            <div key={cmd} className="flex items-center gap-2 py-1.5 px-3 bg-g-bg border border-g-border rounded-lg">
              <span className="text-g-green text-sm font-mono font-bold">{cmd}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Community OS */}
      <div className="bg-g-card border border-g-border rounded-2xl p-6 space-y-4">
        <p className="text-xs font-semibold tracking-widest uppercase text-g-muted">Community OS</p>
        <p className="text-xs text-g-muted">Ranks, badges, perks, prestige, daily hero, achievements, quests og casino-spill. Styres via Discord-kommandoer og API.</p>
        <div className="grid grid-cols-2 gap-2">
          {['Ranks & Prestige', 'Badges', 'Daily Hero', 'Achievements', 'Quests', 'Blackjack', 'Roulette', 'Perks'].map(sys => (
            <div key={sys} className="py-1.5 px-3 bg-g-bg border border-g-border rounded-lg">
              <span className="text-xs text-g-text">◆ {sys}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Community OS — Feature Flags */}
      <div className="bg-g-card border border-g-border rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold tracking-widest uppercase text-g-muted">Community OS — Feature Flags</p>
          <button
            onClick={saveFlags}
            disabled={savingFlags || !flags}
            className="px-4 py-2 bg-g-green/10 border border-g-green/25 text-g-green text-sm font-medium rounded-lg hover:bg-g-green/20 hover:shadow-green-sm transition-all duration-200 disabled:opacity-50"
          >
            {savingFlags ? 'Lagrer...' : '◆ Lagre'}
          </button>
        </div>
        {flags ? (
          <div className="grid grid-cols-2 gap-3">
            {([
              ['ranks_enabled',        'Ranks'],
              ['badges_enabled',       'Badges'],
              ['hero_enabled',         'Daily Hero'],
              ['prestige_enabled',     'Prestige'],
              ['achievements_enabled', 'Achievements'],
              ['quests_enabled',       'Quests'],
              ['blackjack_enabled',    'Blackjack'],
              ['roulette_enabled',     'Roulette'],
            ] as [string, string][]).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between py-2 px-3 bg-g-bg border border-g-border rounded-lg cursor-pointer">
                <span className="text-xs text-g-text">{label}</span>
                <input
                  type="checkbox"
                  checked={!!flags[key]}
                  onChange={e => setFlags(prev => prev ? { ...prev, [key]: e.target.checked } : prev)}
                  className="accent-green-400"
                />
              </label>
            ))}
          </div>
        ) : (
          <p className="text-xs text-g-muted">Laster feature flags...</p>
        )}
      </div>
    </div>
  );
}
