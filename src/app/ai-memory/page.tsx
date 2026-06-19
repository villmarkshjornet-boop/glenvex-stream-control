'use client';

import { useEffect, useState, useCallback } from 'react';
import { tidSiden } from '@/components/dashboard/helpers';
import { PageHeader } from '@/components/ui';

// ─── Typer ────────────────────────────────────────────────────────────────────

interface MemoryEntry {
  id: string;
  agent_type: string;
  memory_type: string;
  key: string;
  summary: string;
  confidence_score: number;
  occurrence_count: number;
  last_seen_at: string;
  metadata?: Record<string, any>;
}

interface Insight {
  id: string;
  title: string;
  summary: string;
  confidence_score: number;
  created_at: string;
}

interface Decision {
  id: string;
  agent_type: string;
  decision_type: string;
  decision_summary: string;
  outcome: string;
  created_at: string;
}

interface MemoryData {
  summary: { totalMemories: number; totalInsights: number; totalDecisions: number; recentEvents7d: number; streamCount: number };
  viewers: MemoryEntry[];
  members: MemoryEntry[];
  jokes: MemoryEntry[];
  topics: MemoryEntry[];
  contentPatterns: MemoryEntry[];
  gamePatterns: MemoryEntry[];
  streamPatterns: MemoryEntry[];
  twitchMemory: MemoryEntry[];
  discordMemory: MemoryEntry[];
  contentMemory: MemoryEntry[];
  globalMemory: MemoryEntry[];
  insights: Insight[];
  decisions: Decision[];
  eventStats: Record<string, number>;
  ts: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function konfidensBar(score: number) {
  const p = Math.round(score * 100);
  const color = p >= 80 ? 'bg-g-green' : p >= 60 ? 'bg-yellow-400' : 'bg-orange-400';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1 bg-g-border rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${p}%` }} />
      </div>
      <span className="text-[9px] text-g-muted">{p}%</span>
    </div>
  );
}

// ─── Forget-knapp ─────────────────────────────────────────────────────────────

function ForgetButton({ id, table, onForget }: { id: string; table?: string; onForget: () => void }) {
  const [loading, setLoading] = useState(false);
  const forget = async () => {
    if (!confirm('Slett denne minneoppføringen?')) return;
    setLoading(true);
    await fetch('/api/ai-memory/forget', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, table }),
    });
    setLoading(false);
    onForget();
  };
  return (
    <button onClick={forget} disabled={loading}
      className="px-1.5 py-0.5 text-[9px] text-red-400/60 hover:text-red-400 border border-transparent hover:border-red-400/20 rounded transition-all">
      {loading ? '...' : '✕'}
    </button>
  );
}

// ─── Seksjonskomponent ────────────────────────────────────────────────────────

function MemorySection({ title, items, onRefresh, icon }: { title: string; items: MemoryEntry[]; onRefresh: () => void; icon?: string }) {
  if (items.length === 0) return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">{icon} {title}</p>
      <p className="text-xs text-g-muted">Ingen data ennå – dette bygges opp automatisk over tid.</p>
    </div>
  );
  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">{icon} {title}</p>
        <span className="text-[9px] text-g-green font-bold">{items.length} oppføringer</span>
      </div>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {items.map(m => (
          <div key={m.id} className="flex items-start gap-2 py-1.5 border-b border-g-border/20 last:border-0">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-bold text-g-text truncate">{m.key}</span>
                <span className="text-[9px] text-g-muted">{m.occurrence_count}×</span>
              </div>
              <p className="text-[10px] text-g-muted leading-snug">{m.summary.slice(0, 120)}</p>
              <div className="flex items-center gap-2 mt-1">
                {konfidensBar(m.confidence_score)}
                {m.last_seen_at && <span className="text-[9px] text-g-muted/50">{tidSiden(m.last_seen_at)}</span>}
              </div>
            </div>
            <ForgetButton id={m.id} onForget={onRefresh} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Summary-kort ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-g-card border border-g-border rounded-xl p-4 text-center">
      <p className="text-2xl font-black text-g-green">{value}</p>
      <p className="text-[10px] text-g-text font-bold mt-1">{label}</p>
      {sub && <p className="text-[9px] text-g-muted mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Side ─────────────────────────────────────────────────────────────────────

interface CrossEvent {
  event_type: string;
  username: string | null;
  message_text: string | null;
  importance_score: number;
  metadata: Record<string, any>;
  created_at: string;
}

interface CrossCtxRead {
  source: string;
  event_type: string;
  metadata: Record<string, any>;
  created_at: string;
}

interface CrossData {
  twitchEvents:  CrossEvent[];
  discordEvents: CrossEvent[];
  contextReads:  CrossCtxRead[];
  generertKl:    string;
}

function hhMM(iso: string): string {
  return new Date(iso).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });
}

function CrossEventRow({ e, source }: { e: CrossEvent; source: 'twitch' | 'discord' }) {
  const typeColors: Record<string, string> = {
    chat_message: 'text-green-400', discord_message: 'text-blue-400',
    raid: 'text-yellow-400', sub: 'text-purple-400', resub: 'text-purple-300',
    cheer: 'text-yellow-300', active_chatter: 'text-cyan-400', active_member: 'text-cyan-400',
  };
  const typeLabels: Record<string, string> = {
    chat_message: 'CHAT', discord_message: 'MSG', raid: 'RAID', sub: 'SUB',
    resub: 'RESUB', cheer: 'BITS', active_chatter: 'AKTIV', active_member: 'AKTIV',
  };
  const tekst = e.message_text
    ?? (e.event_type === 'raid'    ? `${e.metadata?.viewers ?? '?'} viewers` : null)
    ?? (e.event_type === 'cheer'   ? `${e.metadata?.bits ?? '?'} bits` : null)
    ?? (e.event_type === 'active_chatter' ? `${e.metadata?.messageCount ?? '?'} meldinger` : null)
    ?? '';
  return (
    <div className="flex items-start gap-2 py-1 border-b border-white/5 text-[11px]">
      <span className="font-mono text-g-muted shrink-0 w-10 pt-0.5">{hhMM(e.created_at)}</span>
      <span className={`font-bold shrink-0 ${typeColors[e.event_type] ?? 'text-gray-400'}`}>
        [{typeLabels[e.event_type] ?? e.event_type.toUpperCase().slice(0,5)}]
      </span>
      <span className={`font-medium shrink-0 ${source === 'twitch' ? 'text-purple-300' : 'text-blue-300'}`}>{e.username ?? '?'}</span>
      {tekst && <span className="text-g-muted truncate">{tekst}</span>}
    </div>
  );
}

export default function AiMemoryPage() {
  const [data, setData] = useState<MemoryData | null>(null);
  const [crossData, setCrossData] = useState<CrossData | null>(null);
  const [loading, setLoading] = useState(true);
  const [aktivTab, setAktivTab] = useState<'community' | 'content' | 'insights' | 'events' | 'cross'>('community');

  const hent = useCallback(async () => {
    try {
      const [memRes, crossRes] = await Promise.all([
        fetch('/api/ai-memory'),
        fetch('/api/cross-platform-context?minutesBack=60'),
      ]);
      if (memRes.ok) setData(await memRes.json());
      if (crossRes.ok) setCrossData(await crossRes.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { hent(); }, [hent]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-g-card border border-g-border rounded animate-pulse" />
        <div className="grid grid-cols-5 gap-3">
          {[1,2,3,4,5].map(i => <div key={i} className="h-20 bg-g-card border border-g-border rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'community', label: 'Community' },
    { id: 'content',   label: 'Content & Spill' },
    { id: 'insights',  label: 'Innsikter' },
    { id: 'events',    label: 'Hendelser' },
    { id: 'cross',     label: '🔗 Cross-Platform' },
  ] as const;

  return (
    <div className="max-w-5xl mx-auto space-y-4">

      <PageHeader title="AI Memory" subtitle="Delt intelligens · Alle agenter lærer sammen">
        <button onClick={hent} className="px-2.5 py-1.5 border border-g-border rounded-lg text-[10px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all font-bold">
          ↻ Refresh
        </button>
      </PageHeader>

      {/* Sammendrag */}
      {data && (
        <div className="grid grid-cols-5 gap-3">
          <SummaryCard label="Streams analysert" value={data.summary.streamCount} sub="Basis for kunnskap" />
          <SummaryCard label="Minner totalt" value={data.summary.totalMemories} sub="Alle agenter" />
          <SummaryCard label="Innsikter" value={data.summary.totalInsights} sub="AI-oppdagelser" />
          <SummaryCard label="Beslutninger" value={data.summary.totalDecisions} sub="Sporbare valg" />
          <SummaryCard label="Hendelser (7d)" value={data.summary.recentEvents7d} sub="Siste uke" />
        </div>
      )}

      {!data && (
        <div className="bg-g-card border border-g-border rounded-xl p-6 text-center">
          <p className="text-sm text-g-muted">Ingen data funnet. Kjør SQL-migrasjonen fra <code className="text-g-green">supabase/global-ai-migration.sql</code> for å aktivere AI Memory.</p>
        </div>
      )}

      {data && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 border-b border-g-border">
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setAktivTab(tab.id)}
                className={`px-4 py-2 text-[11px] font-bold transition-all border-b-2 -mb-px ${
                  aktivTab === tab.id
                    ? 'border-g-green text-g-green'
                    : 'border-transparent text-g-muted hover:text-g-text'
                }`}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Community-tab */}
          {aktivTab === 'community' && (
            <div className="grid grid-cols-2 gap-4">
              <MemorySection title="Kjente seere" items={data.viewers} onRefresh={hent} icon="◈" />
              <MemorySection title="Discord-membres" items={data.members} onRefresh={hent} icon="◉" />
              <MemorySection title="Interne vitser" items={data.jokes} onRefresh={hent} icon="LUL" />
              <MemorySection title="Community-fraser" items={data.topics} onRefresh={hent} icon="◆" />
            </div>
          )}

          {/* Content-tab */}
          {aktivTab === 'content' && (
            <div className="grid grid-cols-2 gap-4">
              <MemorySection title="Innholdsmønstre" items={data.contentPatterns} onRefresh={hent} icon="▶" />
              <MemorySection title="Spillkunnskap" items={data.gamePatterns} onRefresh={hent} icon="◩" />
              <MemorySection title="Stream-mønstre" items={data.streamPatterns} onRefresh={hent} icon="↻" />

              {/* Kanalstatus */}
              <div className="bg-g-card border border-g-border rounded-xl p-4">
                <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">◆ Kanalstatus</p>
                <div className="space-y-3">
                  {(() => {
                    const profile = data.globalMemory.find(m => m.key === 'channel_profile');
                    const strategy = data.contentPatterns.find(m => m.key === 'content_strategy');
                    return (
                      <>
                        {profile && (
                          <div>
                            <p className="text-[9px] text-g-muted font-bold mb-1">Kanalprofil</p>
                            <p className="text-[10px] text-g-text leading-snug">{profile.summary}</p>
                          </div>
                        )}
                        {strategy && (
                          <div>
                            <p className="text-[9px] text-g-muted font-bold mb-1">Innholdsstrategi</p>
                            <p className="text-[10px] text-g-text leading-snug">{strategy.summary}</p>
                          </div>
                        )}
                        {!profile && !strategy && (
                          <p className="text-xs text-g-muted">Bygges automatisk etter 2+ streams.</p>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* Innsikter-tab */}
          {aktivTab === 'insights' && (
            <div className="space-y-4">
              {/* Innsikter */}
              <div className="bg-g-card border border-g-border rounded-xl p-4">
                <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">◆ Innsikter</p>
                {data.insights.length === 0 ? (
                  <p className="text-xs text-g-muted">Ingen innsikter ennå. Innsikter genereres automatisk etter streams og av learning aggregatoren.</p>
                ) : (
                  <div className="space-y-3">
                    {data.insights.map(ins => (
                      <div key={ins.id} className="border-b border-g-border/20 last:border-0 pb-3 last:pb-0">
                        <div className="flex items-start gap-2">
                          <div className="flex-1">
                            <p className="text-[11px] font-bold text-g-text">{ins.title}</p>
                            <p className="text-[10px] text-g-muted mt-0.5 leading-snug">{ins.summary}</p>
                            <div className="flex items-center gap-3 mt-1">
                              {konfidensBar(ins.confidence_score)}
                              <span className="text-[9px] text-g-muted">{tidSiden(ins.created_at)}</span>
                            </div>
                          </div>
                          <ForgetButton id={ins.id} table="insights" onForget={hent} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Beslutninger */}
              <div className="bg-g-card border border-g-border rounded-xl p-4">
                <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">◆ AI Beslutninger</p>
                {data.decisions.length === 0 ? (
                  <p className="text-xs text-g-muted">Ingen beslutninger ennå.</p>
                ) : (
                  <div className="space-y-2">
                    {data.decisions.map(d => (
                      <div key={d.id} className="flex items-start gap-2 py-1.5 border-b border-g-border/20 last:border-0">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-[9px] font-bold text-g-green uppercase">{d.agent_type}</span>
                            <span className="text-[9px] text-g-muted">{d.decision_type}</span>
                            <span className={`text-[9px] font-bold ${d.outcome === 'success' ? 'text-g-green' : d.outcome === 'failure' ? 'text-red-400' : 'text-g-muted'}`}>
                              {d.outcome}
                            </span>
                          </div>
                          <p className="text-[10px] text-g-text leading-snug">{d.decision_summary.slice(0, 140)}</p>
                          <span className="text-[9px] text-g-muted">{tidSiden(d.created_at)}</span>
                        </div>
                        <ForgetButton id={d.id} table="decisions" onForget={hent} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Cross-Platform-tab */}
          {aktivTab === 'cross' && (
            <div className="space-y-4">
              {/* Memory-lesinger */}
              {crossData && crossData.contextReads.length > 0 && (
                <div className="bg-g-card border border-g-border rounded-xl p-4">
                  <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">↗ Siste 10 Memory-lesinger av botene</p>
                  <div className="space-y-1">
                    {crossData.contextReads.map((r, i) => {
                      const t = r.metadata?.type ?? '';
                      const isTwitch = t.includes('TWITCH');
                      return (
                        <div key={i} className="flex items-center gap-3 text-[11px] py-0.5">
                          <span className="font-mono text-g-muted w-10">{hhMM(r.created_at)}</span>
                          <span className={isTwitch ? 'text-purple-400' : 'text-blue-400'}>
                            {isTwitch ? 'Twitch-bot leste Discord' : 'Discord-bot leste Twitch'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {/* Twitch */}
                <div className="bg-g-card border border-g-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-purple-500" />
                    <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Twitch Chat (60 min)</p>
                    <span className="ml-auto text-[9px] text-g-green">{crossData?.twitchEvents.length ?? 0} events</span>
                  </div>
                  {!crossData?.twitchEvents.length ? (
                    <p className="text-xs text-g-muted">Ingen Twitch-events ennå. Loggres automatisk fra chat.</p>
                  ) : (
                    <div className="max-h-72 overflow-y-auto">
                      {crossData.twitchEvents.map((e, i) => <CrossEventRow key={i} e={e} source="twitch" />)}
                    </div>
                  )}
                </div>

                {/* Discord */}
                <div className="bg-g-card border border-g-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Discord (60 min)</p>
                    <span className="ml-auto text-[9px] text-g-green">{crossData?.discordEvents.length ?? 0} events</span>
                  </div>
                  {!crossData?.discordEvents.length ? (
                    <p className="text-xs text-g-muted">Ingen Discord-events ennå. Loggres automatisk fra chat-kanal.</p>
                  ) : (
                    <div className="max-h-72 overflow-y-auto">
                      {crossData.discordEvents.map((e, i) => <CrossEventRow key={i} e={e} source="discord" />)}
                    </div>
                  )}
                </div>
              </div>

              {/* Kommandoguide */}
              <div className="bg-g-card/60 border border-g-border rounded-xl p-4 text-[11px]">
                <p className="font-bold text-g-text mb-2">Kommandoer for cross-platform context</p>
                <div className="grid grid-cols-2 gap-x-8 gap-y-1 font-mono text-g-muted">
                  <span><span className="text-blue-400">Discord</span>  !twitchsiste — AI-oppsummering av siste Twitch-chat</span>
                  <span><span className="text-purple-400">Twitch</span>  !discordsiste — oppsummering av siste Discord</span>
                  <span><span className="text-blue-400">Discord</span>  !twitchtema — gjengående Twitch-temaer</span>
                  <span><span className="text-purple-400">Twitch</span>  !discordtema — gjengående Discord-temaer</span>
                  <span><span className="text-blue-400">Discord</span>  !communitymemory — alt AI husker om communityet</span>
                </div>
                <p className="mt-2 text-[9px] text-g-muted/60">Alle kommandoer har 30s cooldown per kanal. Generert kl. {crossData?.generertKl ?? '—'}</p>
              </div>
            </div>
          )}

          {/* Hendelser-tab */}
          {aktivTab === 'events' && (
            <div className="bg-g-card border border-g-border rounded-xl p-4">
              <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">◆ Hendelsesstatistikk – siste 7 dager</p>
              {Object.keys(data.eventStats).length === 0 ? (
                <p className="text-xs text-g-muted">Ingen hendelser logget ennå. Hendelser loggres automatisk fra Twitch og Discord.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(data.eventStats)
                    .sort((a, b) => b[1] - a[1])
                    .map(([key, count]) => (
                      <div key={key} className="flex items-center justify-between p-2 bg-g-bg/50 rounded border border-g-border/30">
                        <span className="text-[10px] text-g-muted font-mono">{key}</span>
                        <span className="text-[10px] font-bold text-g-green">{count}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
