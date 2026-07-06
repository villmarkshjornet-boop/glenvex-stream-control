'use client';

import { useEffect, useState, useCallback, type ReactNode } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface SummaryData {
  health: {
    activeMembers24h: number;
    activeMembers7d: number;
    xpGranted7d: number;
    levelUps7d: number;
    lastBotPostAt: string | null;
    lastBotPostType: string | null;
    idleStatus: 'active' | 'idle' | 'unknown';
    idleMinutes: number | null;
  };
  topMembers7d: Array<{ userId: string; displayName: string; level: number; xp7d: number; streakDays: number; badges: string[] }>;
  recentLevelUps: Array<{ username: string; newLevel: number; rolleNavn: string | null; timestamp: string }>;
  botActivity: Array<{ eventType: string; title: string; severity: string; timestamp: string }>;
  recommendations: Array<{ priority: 'high' | 'medium' | 'low'; type: string; message: string }>;
  diagnostics: {
    communityKanalKonfigurert: boolean;
    communityAktiv: boolean;
    xpAktiv: boolean;
    hypeAktiv: boolean;
    idleAktiv: boolean;
    idleThresholdMinutes: number;
  };
}

interface PartnerData {
  promoSendt30d: number;
  dagSidenPromo: number | null;
  foreslåXFor: string | null;
  partnerEksponering: Array<{ partner_name?: string; count: number }>;
  sistSendt: string | null;
}

interface CommunitySettings {
  aktiv: boolean;
  xpAktiv: boolean;
  levelUpMeldingerAktiv: boolean;
  communityHypeAktiv: boolean;
  idlePromptsAktiv: boolean;
  idleThresholdMinutes: number;
  maxBotPostsPerDay: number;
  xpCooldownSek: number;
  xpMinMeldingslengde: number;
}

interface Insight { icon: string; text: string; sub: string | null; sentiment: 'positive' | 'negative' | 'neutral' | 'info' | 'action' | 'warning'; }

// ── Helpers ──────────────────────────────────────────────────────────────────

function tidAgo(iso: string): string {
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (d < 2)   return 'nettopp';
  if (d < 60)  return `${d} min siden`;
  if (d < 1440) return `${Math.round(d / 60)}t siden`;
  return `${Math.round(d / 1440)}d siden`;
}

function deriveInsights(s: SummaryData, p: PartnerData): Insight[] {
  const out: Insight[] = [];

  if (s.health.idleMinutes !== null) {
    const t = s.health.idleMinutes >= 60 ? `${Math.round(s.health.idleMinutes / 60)}t` : `${s.health.idleMinutes} min`;
    if (s.health.idleStatus === 'idle') {
      out.push({ icon: '◌', text: `Discord har vært stille i ${t}.`, sub: 'AI vurderer aktivitetsprompt automatisk.', sentiment: 'neutral' });
    } else {
      out.push({ icon: '●', text: `Community-aktivitet pågår nå.`, sub: `${s.health.activeMembers24h} aktive membres siste 24t.`, sentiment: 'positive' });
    }
  }

  if (s.health.lastBotPostAt) {
    const label = s.health.lastBotPostType === 'mvp' ? 'MVP-valg' : s.health.lastBotPostType === 'hype' ? 'hype-melding' : 'aktivitetsprompt';
    out.push({ icon: '◎', text: `Siste bot-post: ${label}.`, sub: tidAgo(s.health.lastBotPostAt), sentiment: 'info' });
  }

  if (p.foreslåXFor) {
    out.push({ icon: '◆', text: `"${p.foreslåXFor}" venter på partnerpost.`, sub: p.dagSidenPromo ? `Ingen post på ${p.dagSidenPromo} dager.` : null, sentiment: 'action' });
  }

  const daily7d = s.health.activeMembers7d / 7;
  if (daily7d > 0) {
    if (s.health.activeMembers24h > daily7d * 1.5) {
      out.push({ icon: '↑', text: 'Aktiviteten er over dagssnittet.', sub: `${s.health.activeMembers24h} aktive vs ~${Math.round(daily7d)}/dag (7d).`, sentiment: 'positive' });
    } else if (s.health.activeMembers24h < daily7d * 0.4 && s.health.activeMembers7d > 4) {
      out.push({ icon: '↓', text: 'Lavere aktivitet enn normalt.', sub: `${s.health.activeMembers24h} aktive vs ~${Math.round(daily7d)}/dag (7d).`, sentiment: 'warning' });
    }
  }

  for (const r of s.recommendations.slice(0, 2)) {
    if (!out.some(i => i.text.includes(r.message.slice(0, 20)))) {
      out.push({ icon: r.priority === 'high' ? '!' : r.priority === 'medium' ? '◈' : '○', text: r.message, sub: null, sentiment: r.priority === 'high' ? 'negative' : r.priority === 'medium' ? 'warning' : 'info' });
    }
  }

  return out.slice(0, 6);
}

const BOT_EVENT_LABELS: Record<string, { label: string; color: string }> = {
  COMMUNITY_MVP_SELECTED:               { label: 'MVP valgt',      color: '#ffd700' },
  COMMUNITY_HYPE_SENT:                  { label: 'Hype sendt',     color: '#00ff41' },
  COMMUNITY_ACTIVITY_PROMPT_SENT:       { label: 'Prompt sendt',   color: '#00d4ff' },
  COMMUNITY_IDLE_DETECTED:             { label: 'Stille oppdaget', color: '#ff7b47' },
  COMMUNITY_HYPE_SKIPPED_DAILY_LIMIT:  { label: 'Hype: daggrense',color: '#3a5a3a' },
  COMMUNITY_HYPE_SKIPPED_NO_ACTIVITY:  { label: 'Hype: ingen akt',color: '#3a5a3a' },
  COMMUNITY_ACTIVITY_SKIPPED_RATE_LIMIT: { label: 'Prompt: cooldown', color: '#3a5a3a' },
  COMMUNITY_ACTIVITY_SKIPPED_RECENT_ACTIVITY: { label: 'Prompt: aktiv', color: '#3a5a3a' },
  COMMUNITY_MVP_SKIPPED_NO_ACTIVITY:   { label: 'MVP: ingen akt', color: '#3a5a3a' },
};

const SENTIMENT_COLORS: Record<Insight['sentiment'], string> = {
  positive: '#00ff41', negative: '#ff4466', neutral: '#7a9a7a',
  info: '#00d4ff', action: '#ffd700', warning: '#ff7b47',
};

// ── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, loading }: { label: string; value: string | number; sub?: string; color: string; loading: boolean }) {
  return (
    <div style={{ background: `linear-gradient(135deg, rgba(4,12,6,0.9), ${color}08)`, border: `1px solid ${color}18`, borderRadius: '12px', padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: `linear-gradient(90deg, transparent, ${color}50, transparent)` }} />
      <div style={{ fontSize: '10px', color: '#3a5a3a', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: '8px' }}>{label}</div>
      {loading
        ? <div style={{ height: '36px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px', animation: 'pulse 1.5s ease-in-out infinite' }} />
        : <div style={{ fontSize: '36px', fontWeight: 900, color, fontFamily: 'monospace', lineHeight: 1 }}>{value}</div>
      }
      {sub && <div style={{ fontSize: '10px', color: '#3a5a3a', fontFamily: 'monospace', marginTop: '4px' }}>{sub}</div>}
    </div>
  );
}

function StatusPill({ label, active, color }: { label: string; active: boolean; color?: string }) {
  const c = color ?? '#00ff41';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: '100px', background: active ? `${c}12` : 'rgba(255,255,255,0.03)', border: `1px solid ${active ? c + '40' : 'rgba(255,255,255,0.08)'}` }}>
      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: active ? c : '#3a5a3a', boxShadow: active ? `0 0 6px ${c}` : 'none' }} />
      <span style={{ fontSize: '11px', color: active ? c : '#3a5a3a', fontFamily: 'monospace', fontWeight: 600 }}>{label}</span>
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const c = SENTIMENT_COLORS[insight.sentiment];
  return (
    <div style={{ display: 'flex', gap: '12px', padding: '12px 14px', background: `${c}06`, border: `1px solid ${c}20`, borderRadius: '10px', borderLeft: `2px solid ${c}` }}>
      <span style={{ fontSize: '14px', color: c, flexShrink: 0, marginTop: '1px', fontFamily: 'monospace' }}>{insight.icon}</span>
      <div>
        <div style={{ fontSize: '12px', color: '#c8f5c8', fontFamily: 'monospace', lineHeight: 1.5 }}>{insight.text}</div>
        {insight.sub && <div style={{ fontSize: '11px', color: '#4a6a4a', fontFamily: 'monospace', marginTop: '3px' }}>{insight.sub}</div>}
      </div>
    </div>
  );
}

function Section({ title, sub, children, collapsible, action }: { title: string; sub?: string; children: ReactNode; collapsible?: boolean; action?: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: '28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: open ? '14px' : '0', cursor: collapsible ? 'pointer' : 'default' }}
        onClick={() => collapsible && setOpen(o => !o)}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: 800, color: '#c8f5c8', letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'monospace' }}>{title}</span>
          {sub && <span style={{ fontSize: '11px', color: '#3a5a3a', fontFamily: 'monospace' }}>{sub}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {action}
          {collapsible && <span style={{ fontSize: '11px', color: '#3a5a3a', fontFamily: 'monospace' }}>{open ? '▲' : '▼'}</span>}
        </div>
      </div>
      {open && children}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function DiscordPage() {
  const [summary, setSummary]     = useState<SummaryData | null>(null);
  const [partner, setPartner]     = useState<PartnerData | null>(null);
  const [settings, setSettings]   = useState<CommunitySettings | null>(null);
  const [loading, setLoading]     = useState(true);
  const [savingSettings, setSaving] = useState(false);
  const [settingsSaved, setSaved] = useState(false);

  // Existing features
  const [testResult, setTestResult]     = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting]           = useState(false);
  const [meldingKanal, setMeldingKanal] = useState('');
  const [meldingTekst, setMeldingTekst] = useState('');
  const [sendingMsg, setSendingMsg]     = useState(false);
  const [msgResult, setMsgResult]       = useState<{ ok: boolean; msg: string } | null>(null);

  const [channels, setChannels]   = useState<any[] | null>(null);
  const [suggestions, setSug]     = useState<any | null>(null);
  const [loadingCh, setLoadingCh] = useState(false);

  const load = useCallback(async () => {
    const [sumRes, partRes, setRes] = await Promise.allSettled([
      fetch('/api/community-manager/summary').then(r => r.json()),
      fetch('/api/partner-engine/status').then(r => r.json()),
      fetch('/api/community-settings').then(r => r.json()),
    ]);
    if (sumRes.status  === 'fulfilled') setSummary(sumRes.value);
    if (partRes.status === 'fulfilled') setPartner(partRes.value);
    if (setRes.status  === 'fulfilled') setSettings(setRes.value);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveSettings(patch: Partial<CommunitySettings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    await fetch('/api/community-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function testLive() {
    setTesting(true); setTestResult(null);
    const r = await fetch('/api/discord/test-live', { method: 'POST' });
    const d = await r.json();
    setTestResult({ ok: r.ok, msg: r.ok ? (d.message ?? 'Sendt') : (d.error ?? 'Feil') });
    setTesting(false);
  }

  async function sendMessage() {
    if (!meldingKanal || !meldingTekst) return;
    setSendingMsg(true); setMsgResult(null);
    const r = await fetch('/api/discord/send-message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId: meldingKanal, content: meldingTekst }) });
    const d = await r.json();
    setMsgResult({ ok: r.ok, msg: r.ok ? 'Sendt' : (d.error ?? 'Feil') });
    if (r.ok) setMeldingTekst('');
    setSendingMsg(false);
  }

  async function loadChannels() {
    setLoadingCh(true);
    const r = await fetch('/api/discord/channels');
    const d = await r.json();
    setChannels(d.channels ?? []);
    setSug(d.suggestions ?? null);
    setLoadingCh(false);
  }

  const insights  = summary && partner ? deriveInsights(summary, partner) : [];
  const isLive    = summary?.diagnostics.communityAktiv ?? false;

  return (
    <div className="max-w-5xl mx-auto" style={{ paddingBottom: '48px' }}>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div style={{
        position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(135deg, #040d06 0%, #060f08 40%, #040d06 100%)',
        border: '1px solid rgba(0,255,65,0.10)', borderRadius: '16px',
        padding: '32px 36px', marginBottom: '28px',
      }}>
        {/* Ambient light */}
        <div style={{ position: 'absolute', top: '-40%', left: '30%', width: '40%', height: '200%', background: 'radial-gradient(ellipse, rgba(0,255,65,0.04) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '-20%', right: '10%', width: '30%', height: '150%', background: 'radial-gradient(ellipse, rgba(155,119,207,0.04) 0%, transparent 70%)', pointerEvents: 'none' }} />

        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: '11px', color: '#00ff41', letterSpacing: '0.2em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: '8px', opacity: 0.7 }}>AI Community Manager</div>
          <h1 style={{ fontSize: '32px', fontWeight: 900, color: '#e8ffe8', letterSpacing: '-0.02em', marginBottom: '6px', fontFamily: 'system-ui, sans-serif', lineHeight: 1.1 }}>
            Community Intelligence
          </h1>
          <p style={{ fontSize: '13px', color: '#4a6a4a', fontFamily: 'monospace', marginBottom: '20px', maxWidth: '520px', lineHeight: 1.6 }}>
            AI analyserer communityet ditt kontinuerlig, lærer av aktiviteten og optimaliserer Discord automatisk.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <StatusPill label="Discord tilkoblet" active={true} />
            <StatusPill label="Community OS" active={isLive} />
            <StatusPill label="XP-system" active={summary?.diagnostics.xpAktiv ?? false} />
            <StatusPill label="Idle-prompts" active={summary?.diagnostics.idleAktiv ?? false} />
            <StatusPill label="Partner Engine" active={(partner?.promoSendt30d ?? 0) > 0} color="#9b77cf" />
            {summary?.health.idleStatus === 'active' && (
              <StatusPill label="Community aktiv" active={true} color="#00d4ff" />
            )}
          </div>
        </div>
      </div>

      {/* ── KPI pulse ──────────────────────────────────────────────────────── */}
      <Section title="Community Pulse" sub="— siste 7 dager">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px' }}>
          <KpiCard label="Aktive 24t"   value={summary?.health.activeMembers24h ?? 0} color="#00ff41"  loading={loading} />
          <KpiCard label="Aktive 7d"    value={summary?.health.activeMembers7d  ?? 0} color="#00d4ff"  loading={loading} />
          <KpiCard label="XP tildelt"   value={(summary?.health.xpGranted7d ?? 0).toLocaleString('no-NO')} color="#9b77cf" loading={loading} sub="siste 7 dager" />
          <KpiCard label="Level-ups"    value={summary?.health.levelUps7d ?? 0}       color="#ffd700"  loading={loading} sub="siste 7 dager" />
        </div>
      </Section>

      {/* ── AI Strategist ──────────────────────────────────────────────────── */}
      <Section title="AI Strategist" sub="— basert på ekte data">
        {insights.length === 0 && !loading ? (
          <div style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid #1a2f1a', borderRadius: '10px', fontSize: '11px', color: '#3a5a3a', fontFamily: 'monospace' }}>
            Foreløpig ikke nok historikk til å generere innsikter.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {insights.map((ins, i) => <InsightCard key={i} insight={ins} />)}
          </div>
        )}
      </Section>

      {/* ── Top Members ────────────────────────────────────────────────────── */}
      {(summary?.topMembers7d.length ?? 0) > 0 && (
        <Section title="Top Members" sub="— XP siste 7 dager">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {(summary?.topMembers7d ?? []).slice(0, 8).map((m, i) => (
              <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 14px', background: i === 0 ? 'rgba(255,215,0,0.05)' : 'rgba(4,12,6,0.5)', border: `1px solid ${i === 0 ? '#ffd70020' : '#1a2f1a'}`, borderRadius: '8px' }}>
                <span style={{ fontSize: '11px', color: i === 0 ? '#ffd700' : '#3a5a3a', fontFamily: 'monospace', minWidth: '20px', textAlign: 'right' }}>#{i + 1}</span>
                <span style={{ flex: 1, fontSize: '12px', color: i < 3 ? '#c8f5c8' : '#7a9a7a', fontFamily: 'monospace', fontWeight: i === 0 ? 700 : 400 }}>{m.displayName}</span>
                <span style={{ fontSize: '10px', color: '#3a5a3a', fontFamily: 'monospace' }}>Lv.{m.level}</span>
                {m.streakDays > 1 && <span style={{ fontSize: '10px', color: '#ff7b47', fontFamily: 'monospace' }}>🔥{m.streakDays}d</span>}
                <span style={{ fontSize: '11px', color: '#9b77cf', fontFamily: 'monospace', fontWeight: 700 }}>+{m.xp7d.toLocaleString('no-NO')} XP</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Recent level-ups ────────────────────────────────────────────────── */}
      {(summary?.recentLevelUps.length ?? 0) > 0 && (
        <Section title="Level-ups" sub="— siste 30 dager" collapsible>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {(summary?.recentLevelUps ?? []).slice(0, 6).map((lu, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'rgba(255,215,0,0.04)', border: '1px solid rgba(255,215,0,0.12)', borderRadius: '8px' }}>
                <span style={{ fontSize: '16px', color: '#ffd700', fontFamily: 'monospace', fontWeight: 900 }}>↑{lu.newLevel}</span>
                <div>
                  <div style={{ fontSize: '11px', color: '#c8f5c8', fontFamily: 'monospace' }}>{lu.username || 'Ukjent'}</div>
                  {lu.rolleNavn && <div style={{ fontSize: '10px', color: '#4a6a4a', fontFamily: 'monospace' }}>{lu.rolleNavn}</div>}
                </div>
                <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#2a4a2a', fontFamily: 'monospace' }}>{tidAgo(lu.timestamp)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Bot Activity Feed ───────────────────────────────────────────────── */}
      <Section title="Bot-aktivitet" sub="— siste 7 dager" collapsible>
        {(summary?.botActivity.length ?? 0) === 0 && !loading ? (
          <div style={{ padding: '14px', background: 'rgba(255,255,255,0.02)', border: '1px solid #1a2f1a', borderRadius: '10px', fontSize: '11px', color: '#3a5a3a', fontFamily: 'monospace' }}>
            Ingen bot-aktivitet registrert siste 7 dager.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {(summary?.botActivity ?? []).map((ev, i) => {
              const cfg = BOT_EVENT_LABELS[ev.eventType] ?? { label: ev.eventType.replace(/^COMMUNITY_/, '').toLowerCase().replace(/_/g, ' '), color: '#3a5a3a' };
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '8px 12px', background: 'rgba(4,10,5,0.6)', border: '1px solid #141f14', borderRadius: '7px' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: cfg.color, marginTop: '5px', flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: '11px', color: cfg.color !== '#3a5a3a' ? '#c8f5c8' : '#4a6a4a', fontFamily: 'monospace' }}>{ev.title}</span>
                  <span style={{ fontSize: '10px', color: '#2a4a2a', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{tidAgo(ev.timestamp)}</span>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── Partner Intelligence ────────────────────────────────────────────── */}
      {partner && (
        <Section title="Partner Intelligence" sub="— fra Partner Engine">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <div style={{ background: 'rgba(155,119,207,0.07)', border: '1px solid rgba(155,119,207,0.18)', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontSize: '10px', color: '#6a5a9a', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: '4px' }}>Poster 30d</div>
              <div style={{ fontSize: '28px', fontWeight: 900, color: '#9b77cf', fontFamily: 'monospace' }}>{partner.promoSendt30d}</div>
            </div>
            <div style={{ background: 'rgba(255,215,0,0.05)', border: '1px solid rgba(255,215,0,0.15)', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontSize: '10px', color: '#6a5a3a', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: '4px' }}>Dager siden post</div>
              <div style={{ fontSize: '28px', fontWeight: 900, color: '#ffd700', fontFamily: 'monospace' }}>{partner.dagSidenPromo ?? '—'}</div>
            </div>
            <div style={{ background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.15)', borderRadius: '10px', padding: '14px' }}>
              <div style={{ fontSize: '10px', color: '#3a6a7a', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'monospace', marginBottom: '4px' }}>Foreslå neste</div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#00d4ff', fontFamily: 'monospace', lineHeight: 1.3 }}>{partner.foreslåXFor ?? '—'}</div>
            </div>
          </div>
          {partner.partnerEksponering.length > 0 && (
            <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {partner.partnerEksponering.slice(0, 6).map((p, i) => (
                <div key={i} style={{ padding: '5px 10px', background: 'rgba(155,119,207,0.06)', border: '1px solid rgba(155,119,207,0.15)', borderRadius: '20px', fontSize: '11px', color: '#9b77cf', fontFamily: 'monospace' }}>
                  {(p as any).partner_name ?? `Partner ${i+1}`} · {p.count}×
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ── Settings ─────────────────────────────────────────────────────────── */}
      <Section title="Bot-innstillinger" sub="— community system" collapsible
        action={settingsSaved ? <span style={{ fontSize: '11px', color: '#00ff41', fontFamily: 'monospace' }}>✓ Lagret</span> : savingSettings ? <span style={{ fontSize: '11px', color: '#4a6a4a', fontFamily: 'monospace' }}>Lagrer...</span> : undefined}>
        {settings && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Main toggles */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '8px', marginBottom: '4px' }}>
              {[
                { key: 'aktiv',                  label: 'Community OS',      sub: 'Master-toggle' },
                { key: 'xpAktiv',                label: 'XP-system',         sub: `Cooldown ${settings.xpCooldownSek}s` },
                { key: 'levelUpMeldingerAktiv',   label: 'Level-up meldinger', sub: 'Kunngjøring ved level-up' },
                { key: 'communityHypeAktiv',      label: 'Hype-meldinger',    sub: 'Ukentlig MVP/hype-post' },
                { key: 'idlePromptsAktiv',        label: 'Idle-prompts',      sub: `Etter ${settings.idleThresholdMinutes} min stille` },
              ].map(({ key, label, sub }) => {
                const active = !!(settings as any)[key];
                return (
                  <button key={key} onClick={() => saveSettings({ [key]: !active } as any)} style={{
                    padding: '12px 14px', textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s',
                    background: active ? 'rgba(0,255,65,0.06)' : 'rgba(4,10,5,0.6)',
                    border: `1px solid ${active ? 'rgba(0,255,65,0.25)' : '#1a2f1a'}`,
                    borderRadius: '10px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: active ? '#c8f5c8' : '#4a6a4a', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
                      <div style={{ width: '28px', height: '14px', borderRadius: '7px', background: active ? '#00ff41' : '#1a2f1a', position: 'relative', transition: 'background 0.2s' }}>
                        <div style={{ position: 'absolute', top: '2px', width: '10px', height: '10px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', left: active ? '15px' : '2px' }} />
                      </div>
                    </div>
                    <div style={{ fontSize: '10px', color: '#3a5a3a', fontFamily: 'monospace' }}>{sub}</div>
                  </button>
                );
              })}
            </div>

            {/* Numeric settings */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
              {[
                { key: 'idleThresholdMinutes', label: 'Idle-grense', unit: 'min', min: 30, max: 360, step: 15 },
                { key: 'maxBotPostsPerDay',    label: 'Max poster/dag', unit: '', min: 1, max: 10, step: 1 },
                { key: 'xpCooldownSek',        label: 'XP-cooldown', unit: 's', min: 15, max: 300, step: 15 },
              ].map(({ key, label, unit, min, max, step }) => (
                <div key={key} style={{ padding: '10px 12px', background: 'rgba(4,10,5,0.6)', border: '1px solid #1a2f1a', borderRadius: '10px' }}>
                  <div style={{ fontSize: '10px', color: '#3a5a3a', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>{label}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input type="range" min={min} max={max} step={step} value={(settings as any)[key]}
                      onChange={e => saveSettings({ [key]: Number(e.target.value) } as any)}
                      style={{ flex: 1, accentColor: '#00ff41', cursor: 'pointer' }} />
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#00ff41', fontFamily: 'monospace', minWidth: '36px', textAlign: 'right' }}>{(settings as any)[key]}{unit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* ── Quick Actions ──────────────────────────────────────────────────── */}
      <Section title="Kontroller" sub="— manuell override">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>

          {/* Test live */}
          <div style={{ padding: '16px', background: 'rgba(4,12,6,0.7)', border: '1px solid #1a2f1a', borderRadius: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#c8f5c8', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Test live-kunngjøring</div>
            <p style={{ fontSize: '11px', color: '#3a5a3a', fontFamily: 'monospace', marginBottom: '12px', lineHeight: 1.5 }}>
              Sender et test-embed til Discord live-kanalen.
            </p>
            <button onClick={testLive} disabled={testing} style={{
              width: '100%', padding: '9px', fontFamily: 'monospace', fontWeight: 700, fontSize: '11px',
              letterSpacing: '0.1em', textTransform: 'uppercase', cursor: testing ? 'not-allowed' : 'pointer',
              background: testing ? 'transparent' : '#00ff410a', border: `1px solid ${testing ? '#1a2f1a' : '#00ff4130'}`,
              color: testing ? '#3a5a3a' : '#c8f5c8', borderRadius: '7px', transition: 'all 0.2s',
            }}>{testing ? 'Sender...' : '▶ Test live'}</button>
            {testResult && (
              <div style={{ marginTop: '8px', fontSize: '11px', fontFamily: 'monospace', color: testResult.ok ? '#00ff41' : '#ff6b6b' }}>
                {testResult.ok ? '✓' : '✗'} {testResult.msg}
              </div>
            )}
          </div>

          {/* Send message */}
          <div style={{ padding: '16px', background: 'rgba(4,12,6,0.7)', border: '1px solid #1a2f1a', borderRadius: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#c8f5c8', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Send melding manuelt</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
              <input type="text" value={meldingKanal} onChange={e => setMeldingKanal(e.target.value)} placeholder="Kanal-ID"
                style={{ background: '#050505', border: '1px solid #1a2f1a', borderRadius: '5px', padding: '6px 9px', fontSize: '11px', color: '#c8f5c8', fontFamily: 'monospace', outline: 'none' }} />
              <textarea value={meldingTekst} onChange={e => setMeldingTekst(e.target.value)} rows={2} placeholder="Melding..."
                style={{ background: '#050505', border: '1px solid #1a2f1a', borderRadius: '5px', padding: '6px 9px', fontSize: '11px', color: '#c8f5c8', fontFamily: 'monospace', outline: 'none', resize: 'none' }} />
            </div>
            <button onClick={sendMessage} disabled={sendingMsg || !meldingKanal || !meldingTekst} style={{
              width: '100%', padding: '9px', fontFamily: 'monospace', fontWeight: 700, fontSize: '11px',
              letterSpacing: '0.1em', textTransform: 'uppercase', cursor: sendingMsg ? 'not-allowed' : 'pointer',
              background: 'transparent', border: '1px solid #1a2f1a', color: '#4a6a4a', borderRadius: '7px', transition: 'all 0.2s',
            }}>{sendingMsg ? 'Sender...' : '↗ Send'}</button>
            {msgResult && (
              <div style={{ marginTop: '6px', fontSize: '11px', fontFamily: 'monospace', color: msgResult.ok ? '#00ff41' : '#ff6b6b' }}>
                {msgResult.ok ? '✓' : '✗'} {msgResult.msg}
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ── Channel Analysis (lazy) ────────────────────────────────────────── */}
      <Section title="Kanal-analyse" sub="— AI-analyse av Discord-struktur" collapsible>
        {!channels ? (
          <div style={{ textAlign: 'center', paddingTop: '8px' }}>
            <button onClick={loadChannels} disabled={loadingCh} style={{
              padding: '10px 20px', fontFamily: 'monospace', fontWeight: 700, fontSize: '11px',
              letterSpacing: '0.1em', textTransform: 'uppercase', cursor: loadingCh ? 'not-allowed' : 'pointer',
              background: 'transparent', border: '1px solid #1a2f1a', color: '#4a6a4a', borderRadius: '7px', transition: 'all 0.2s',
            }}>{loadingCh ? 'Analyserer...' : '▶ Last og analyser kanaler'}</button>
            <p style={{ fontSize: '10px', color: '#2a4a2a', fontFamily: 'monospace', marginTop: '6px' }}>Bruker GPT-4o-mini — ~5 sek</p>
          </div>
        ) : (
          <div>
            {suggestions?.tekst && (
              <div style={{ padding: '12px 14px', background: 'rgba(0,255,65,0.04)', border: '1px solid rgba(0,255,65,0.12)', borderRadius: '10px', fontSize: '11px', color: '#7a9a7a', fontFamily: 'monospace', lineHeight: 1.6, marginBottom: '10px' }}>
                {suggestions.tekst}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {(channels ?? []).slice(0, 15).map((ch: any) => (
                <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'rgba(4,10,5,0.4)', border: '1px solid #141f14', borderRadius: '6px' }}>
                  <span style={{ fontSize: '10px', color: '#3a5a3a', fontFamily: 'monospace' }}>#{ch.name}</span>
                  <span style={{ fontSize: '10px', color: '#2a4a2a', fontFamily: 'monospace' }}>type:{ch.type}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}
