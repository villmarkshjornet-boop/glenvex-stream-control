'use client';

import { useCallback, useEffect, useState } from 'react';
import { tidSiden } from '@/components/dashboard/helpers';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemorySummary {
  id: string;
  key: string;
  summary: string;
  confidence: number;
  strength: number;
  occurrenceCount: number;
  sourceCount: number;
  category: string;
  memoryType: string;
  lastSeen: string;
  locked: boolean;
  adminApproved: boolean | null;
  importanceBoost: number;
}

interface InsightSummary {
  id: string;
  title: string;
  summary: string;
  confidence: number;
  category: string;
  createdAt: string;
  adminApproved: boolean | null;
}

interface KnowledgeSummary {
  id: string;
  knowledgeType: string;
  key: string;
  summary: string;
  confidence: number;
  evidenceCount: number;
  strength: number;
  lastUpdated: string;
}

interface IdentityMatch {
  id: string;
  twitchUsername: string | null;
  discordUsername: string | null;
  confidence: number;
  matchMethod: string;
  matchStatus: string;
}

interface DecisionSummary {
  id: string;
  decisionType: string;
  decisionSummary: string;
  outcome: string | null;
  feedbackScore: number | null;
  engagementDelta: number | null;
  createdAt: string;
}

interface CategoryEntry {
  category: string;
  count: number;
  avgStrength: number;
  avgConfidence: number;
  topMemories: MemorySummary[];
}

interface BrainData {
  stats: {
    totalMemories: number;
    totalInsights: number;
    totalDecisions: number;
    avgConfidence: number;
    avgStrength: number;
    memoriesLearntToday: number;
    memoriesLearntThisWeek: number;
    crossPlatformMatches: number;
    pendingReview: number;
  };
  categories: CategoryEntry[];
  allMemories: MemorySummary[];
  todayLearnings: MemorySummary[];
  topConfident: MemorySummary[];
  uncertain: MemorySummary[];
  recentInsights: InsightSummary[];
  creatorKnowledge: KnowledgeSummary[];
  identityMatches: IdentityMatch[];
  recentDecisions: DecisionSummary[];
  topMembers: MemorySummary[];
  popularInterests: MemorySummary[];
  streamPatterns: MemorySummary[];
  humor: MemorySummary[];
  economyInsights: MemorySummary[];
}

type TabId = 'oversikt' | 'minner' | 'innsikter' | 'identiteter' | 'kontroll' | 'creator';
type SortKey = 'strength' | 'confidence' | 'occurrenceCount' | 'lastSeen';

// ─── Design helpers ───────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  community:  'bg-blue-500/15 text-blue-300 border border-blue-500/30',
  interests:  'bg-purple-500/15 text-purple-300 border border-purple-500/30',
  stream:     'bg-g-green/15 text-g-green border border-g-green/30',
  creator:    'bg-yellow-500/15 text-yellow-300 border border-yellow-500/30',
  discord:    'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30',
  twitch:     'bg-violet-500/15 text-violet-300 border border-violet-500/30',
  economy:    'bg-amber-500/15 text-amber-300 border border-amber-500/30',
  partner:    'bg-pink-500/15 text-pink-300 border border-pink-500/30',
  humor:      'bg-rose-500/15 text-rose-300 border border-rose-500/30',
  general:    'bg-g-muted/15 text-g-muted border border-g-border',
};

const CAT_NB: Record<string, string> = {
  community:  'Community',
  interests:  'Interesser',
  stream:     'Stream',
  creator:    'Creator',
  discord:    'Discord',
  twitch:     'Twitch',
  economy:    'Økonomi',
  partner:    'Partner',
  humor:      'Humor',
  general:    'Generelt',
};

function catColor(cat: string) {
  return CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.general;
}

function catLabel(cat: string) {
  return CAT_NB[cat] ?? cat;
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function ConfBar({ value, size = 'sm' }: { value: number; size?: 'xs' | 'sm' }) {
  const pct = Math.round(Math.min(Math.max(value * 100, 0), 100));
  const fill =
    pct >= 80 ? 'bg-g-green' :
    pct >= 60 ? 'bg-yellow-400' :
    pct >= 40 ? 'bg-orange-400' : 'bg-red-400';
  const h = size === 'xs' ? 'h-0.5' : 'h-1';
  return (
    <div className="flex items-center gap-1.5 flex-1 min-w-0">
      <div className={`flex-1 ${h} bg-g-border rounded-full overflow-hidden`}>
        <div className={`${h} ${fill} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-g-muted w-7 text-right shrink-0">{pct}%</span>
    </div>
  );
}

function CategoryBadge({ cat }: { cat: string }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${catColor(cat)}`}>
      {catLabel(cat)}
    </span>
  );
}

function StatCard({
  label, value, sub, accent,
}: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={`bg-g-card border rounded-2xl p-4 text-center ${accent ? 'border-g-green/30' : 'border-g-border'}`}>
      <p className={`text-2xl font-black ${accent ? 'text-g-green' : 'text-g-green'}`}>{value}</p>
      <p className="text-xs text-g-text font-medium mt-1">{label}</p>
      {sub && <p className="text-[11px] text-g-muted mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return <p className="text-xs text-g-muted py-4 text-center">{msg}</p>;
}

function MemoryRow({ m, compact }: { m: MemorySummary; compact?: boolean }) {
  return (
    <div className="py-2 border-b border-g-border/20 last:border-0">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 border-l-2 border-g-green/30 pl-2.5">
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
            <span className="text-xs font-medium text-g-text truncate max-w-[200px]">{m.key}</span>
            <CategoryBadge cat={m.category} />
            {m.locked && <span className="text-[10px] text-amber-300">🔒</span>}
            {m.adminApproved === false && (
              <span className="text-[10px] text-red-400 bg-red-400/10 px-1 rounded">avvist</span>
            )}
            {m.adminApproved === true && (
              <span className="text-[10px] text-g-green bg-g-green/10 px-1 rounded">godkjent</span>
            )}
          </div>
          {!compact && <p className="text-xs text-g-muted leading-relaxed mb-1">{m.summary.slice(0, 120)}{m.summary.length > 120 ? '…' : ''}</p>}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1 text-[11px] text-g-muted">
              <span>Konf:</span>
              <ConfBar value={m.confidence} size="xs" />
            </div>
            {m.strength > 0 && (
              <div className="flex items-center gap-1 text-[11px] text-g-muted">
                <span>Styrke:</span>
                <ConfBar value={m.strength} size="xs" />
              </div>
            )}
            <span className="text-[11px] text-g-muted">{m.occurrenceCount}× sett</span>
            {m.sourceCount > 0 && <span className="text-[11px] text-g-muted">{m.sourceCount} kilder</span>}
            {m.lastSeen && <span className="text-[11px] text-g-muted/50">{tidSiden(m.lastSeen)}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab components ───────────────────────────────────────────────────────────

function TabOversikt({ data }: { data: BrainData }) {
  const { stats, categories, todayLearnings, topConfident, uncertain } = data;

  // Category bar chart max
  const maxCat = Math.max(...categories.map(c => c.count), 1);

  // Best strength memory for stat card
  const bestMemory = data.topConfident[0];

  return (
    <div className="space-y-6">
      {/* Stat grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Totale minner" value={stats.totalMemories} sub="AI-hukommelse" />
        <StatCard label="Innsikter" value={stats.totalInsights} sub="Oppdagelser" />
        <StatCard label="Lært i dag" value={stats.memoriesLearntToday} accent sub="Siste 24 timer" />
        <StatCard label="Cross-platform" value={stats.crossPlatformMatches} sub="Identitets-matches" />
        <StatCard
          label="Gj.sn. konfidens"
          value={`${Math.round(stats.avgConfidence * 100)}%`}
          sub="Alle minner"
        />
        <StatCard
          label="Til gjennomgang"
          value={stats.pendingReview}
          accent={stats.pendingReview > 0}
          sub="Venter på admin"
        />
        <StatCard
          label="Sterkeste minne"
          value={bestMemory ? `${Math.round(bestMemory.confidence * 100)}%` : '—'}
          sub={bestMemory?.key?.slice(0, 20) ?? 'Ingen data'}
        />
        <StatCard
          label="Nyeste innsikt"
          value={data.recentInsights.length}
          sub={data.recentInsights[0]?.title?.slice(0, 22) ?? 'Ingen ennå'}
        />
      </div>

      {/* Category bar chart */}
      {categories.length > 0 && (
        <div className="bg-g-card border border-g-border rounded-2xl p-5">
          <p className="t-section mb-3">Minner per kategori</p>
          <div className="space-y-2">
            {[...categories]
              .sort((a, b) => b.count - a.count)
              .map(cat => (
                <div key={cat.category} className="flex items-center gap-2">
                  <span className="text-[11px] text-g-muted w-20 shrink-0 text-right">{catLabel(cat.category)}</span>
                  <div className="flex-1 h-4 bg-g-border/30 rounded overflow-hidden">
                    <div
                      className="h-full bg-g-green/60 rounded flex items-center justify-end pr-1.5 transition-all"
                      style={{ width: `${Math.round((cat.count / maxCat) * 100)}%` }}
                    >
                      <span className="text-[10px] text-g-bg font-bold">{cat.count}</span>
                    </div>
                  </div>
                  <span className="text-[11px] text-g-muted w-16 shrink-0">
                    {Math.round(cat.avgConfidence * 100)}% konf
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Today learnings */}
        <div className="bg-g-card border border-g-border rounded-2xl p-5">
          <p className="t-section mb-3">Lært de siste 24 timer</p>
          {todayLearnings.length === 0 ? (
            <EmptyState msg="Ingen nye læringer i dag" />
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-0">
              {todayLearnings.map(m => <MemoryRow key={m.id} m={m} compact />)}
            </div>
          )}
        </div>

        {/* Top confident */}
        <div className="bg-g-card border border-g-border rounded-2xl p-5">
          <p className="t-section mb-3">Mest sikker på</p>
          {topConfident.length === 0 ? (
            <EmptyState msg="Ingen minner ennå" />
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-0">
              {topConfident.map(m => <MemoryRow key={m.id} m={m} compact />)}
            </div>
          )}
        </div>

        {/* Uncertain */}
        <div className="bg-g-card border border-g-border rounded-2xl p-5">
          <p className="t-section mb-3">Usikker på</p>
          {uncertain.length === 0 ? (
            <EmptyState msg="Ingen usikre minner" />
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-0">
              {uncertain.map(m => <MemoryRow key={m.id} m={m} compact />)}
            </div>
          )}
        </div>
      </div>

      {/* Category spotlights */}
      {(data.topMembers.length > 0 || data.popularInterests.length > 0 || data.streamPatterns.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {data.topMembers.length > 0 && (
            <div className="bg-g-card border border-g-border rounded-2xl p-5">
              <p className="t-section mb-3">Topp community-minner</p>
              <div className="space-y-0">
                {data.topMembers.slice(0, 5).map(m => <MemoryRow key={m.id} m={m} compact />)}
              </div>
            </div>
          )}
          {data.popularInterests.length > 0 && (
            <div className="bg-g-card border border-g-border rounded-2xl p-5">
              <p className="t-section mb-3">Populære interesser</p>
              <div className="space-y-0">
                {data.popularInterests.slice(0, 5).map(m => <MemoryRow key={m.id} m={m} compact />)}
              </div>
            </div>
          )}
          {data.streamPatterns.length > 0 && (
            <div className="bg-g-card border border-g-border rounded-2xl p-5">
              <p className="t-section mb-3">Stream-mønstre</p>
              <div className="space-y-0">
                {data.streamPatterns.slice(0, 5).map(m => <MemoryRow key={m.id} m={m} compact />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent decisions */}
      {data.recentDecisions.length > 0 && (
        <div className="bg-g-card border border-g-border rounded-2xl p-5">
          <p className="t-section mb-3">Siste AI-beslutninger</p>
          <div className="space-y-2">
            {data.recentDecisions.slice(0, 5).map(d => (
              <div key={d.id} className="flex items-start gap-2 py-1.5 border-b border-g-border/20 last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="text-[11px] font-semibold text-g-green uppercase">{d.decisionType}</span>
                    {d.outcome && (
                      <span className={`text-[11px] font-semibold ${
                        d.outcome === 'success' ? 'text-g-green' :
                        d.outcome === 'failure' ? 'text-red-400' : 'text-g-muted'
                      }`}>{d.outcome}</span>
                    )}
                    {d.engagementDelta != null && (
                      <span className={`text-[11px] ${d.engagementDelta > 0 ? 'text-g-green' : 'text-red-400'}`}>
                        Δ{d.engagementDelta > 0 ? '+' : ''}{d.engagementDelta.toFixed(2)}
                      </span>
                    )}
                    <span className="text-[11px] text-g-muted/50 ml-auto">{tidSiden(d.createdAt)}</span>
                  </div>
                  <p className="text-xs text-g-muted leading-snug">{d.decisionSummary.slice(0, 120)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TabMinner({ allMemories }: { allMemories: MemorySummary[] }) {
  const [catFilter, setCatFilter] = useState('alle');
  const [search, setSearch]       = useState('');
  const [sortBy, setSortBy]       = useState<SortKey>('strength');

  const categories = ['alle', 'community', 'interests', 'stream', 'creator', 'discord', 'twitch', 'economy', 'partner', 'humor', 'general'];
  const catNb: Record<string, string> = {
    alle: 'Alle', community: 'Community', interests: 'Interesser', stream: 'Stream',
    creator: 'Creator', discord: 'Discord', twitch: 'Twitch', economy: 'Økonomi',
    partner: 'Partner', humor: 'Humor', general: 'Generelt',
  };

  const filtered = allMemories
    .filter(m => catFilter === 'alle' || m.category === catFilter)
    .filter(m => !search || m.key.toLowerCase().includes(search.toLowerCase()) || m.summary.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'strength')         return b.strength - a.strength;
      if (sortBy === 'confidence')       return b.confidence - a.confidence;
      if (sortBy === 'occurrenceCount')  return b.occurrenceCount - a.occurrenceCount;
      return (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '');
    });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-g-card border border-g-border rounded-2xl p-4 space-y-3">
        {/* Category chips */}
        <div className="flex flex-wrap gap-1.5">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setCatFilter(cat)}
              className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-all ${
                catFilter === cat
                  ? 'bg-g-green text-g-bg'
                  : 'bg-g-border/30 text-g-muted hover:text-g-text'
              }`}
            >
              {catNb[cat] ?? cat}
            </button>
          ))}
        </div>

        {/* Search + Sort row */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Søk etter nøkkel eller innhold..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-g-bg border border-g-border rounded-lg px-3 py-1.5 text-xs text-g-text placeholder:text-g-muted focus:outline-none focus:border-g-green/50"
          />
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortKey)}
            className="bg-g-bg border border-g-border rounded-lg px-2 py-1.5 text-xs text-g-muted focus:outline-none focus:border-g-green/50"
          >
            <option value="strength">Styrke</option>
            <option value="confidence">Konfidens</option>
            <option value="occurrenceCount">Forekomster</option>
            <option value="lastSeen">Sist sett</option>
          </select>
        </div>
      </div>

      {/* Results */}
      <div className="bg-g-card border border-g-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="t-section">Minner</p>
          <span className="text-[11px] text-g-green">{filtered.length} treff</span>
        </div>
        {filtered.length === 0 ? (
          <EmptyState msg="Ingen minner matcher søket" />
        ) : (
          <div className="max-h-[600px] overflow-y-auto space-y-0">
            {filtered.map(m => (
              <div key={m.id} className="py-2.5 border-b border-g-border/20 last:border-0">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                      <span className="text-xs font-medium text-g-text">{m.key}</span>
                      <CategoryBadge cat={m.category} />
                      <span className="text-[11px] text-g-muted">{m.memoryType}</span>
                      {m.locked && <span className="text-[10px] text-amber-300">🔒 låst</span>}
                      {m.adminApproved === false && (
                        <span className="text-[10px] text-red-400 bg-red-400/10 px-1 rounded">avvist</span>
                      )}
                      {m.adminApproved === true && (
                        <span className="text-[10px] text-g-green bg-g-green/10 px-1 rounded">godkjent</span>
                      )}
                    </div>
                    <p className="text-xs text-g-muted leading-relaxed mb-1.5">{m.summary}</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      <div className="flex items-center gap-1 text-[11px] text-g-muted">
                        <span className="shrink-0">Konfidens</span>
                        <ConfBar value={m.confidence} size="xs" />
                      </div>
                      {m.strength > 0 && (
                        <div className="flex items-center gap-1 text-[11px] text-g-muted">
                          <span className="shrink-0">Styrke</span>
                          <ConfBar value={m.strength} size="xs" />
                        </div>
                      )}
                    </div>
                    <div className="flex gap-3 mt-1 flex-wrap">
                      <span className="text-[11px] text-g-muted">{m.occurrenceCount}× observert</span>
                      {m.sourceCount > 0 && <span className="text-[11px] text-g-muted">{m.sourceCount} kilder</span>}
                      <span className="text-[11px] text-g-muted/50">{tidSiden(m.lastSeen)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TabInnsikter({ insights }: { insights: InsightSummary[] }) {
  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="t-section">AI-innsikter</p>
        <span className="text-[11px] text-g-green">{insights.length} innsikter</span>
      </div>
      {insights.length === 0 ? (
        <EmptyState msg="Ingen innsikter ennå — innsikter genereres automatisk etter streams." />
      ) : (
        <div className="space-y-4">
          {insights.map(i => (
            <div key={i.id} className="border-b border-g-border/20 last:border-0 pb-4 last:pb-0">
              <div className="border-l-2 border-g-green/40 pl-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-semibold text-g-text">{i.title}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    {i.category && <CategoryBadge cat={i.category} />}
                    {i.adminApproved === false && (
                      <span className="text-[10px] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded">avvist</span>
                    )}
                    {i.adminApproved === true && (
                      <span className="text-[10px] text-g-green bg-g-green/10 px-1.5 py-0.5 rounded">godkjent</span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-g-muted leading-relaxed mb-2">{i.summary}</p>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1 text-[11px] text-g-muted w-40">
                    <span>Konfidens</span>
                    <ConfBar value={i.confidence} size="xs" />
                  </div>
                  <span className="text-[11px] text-g-muted/50">{tidSiden(i.createdAt)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TabIdentiteter({ matches }: { matches: IdentityMatch[] }) {
  const confColor = (c: number) =>
    c >= 0.8 ? 'bg-g-green/15 text-g-green border border-g-green/30' :
    c >= 0.5 ? 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/30' :
               'bg-red-500/15 text-red-300 border border-red-500/30';

  const methodBadge = (method: string) => {
    const colors: Record<string, string> = {
      exact:     'bg-g-green/15 text-g-green',
      fuzzy:     'bg-yellow-500/15 text-yellow-300',
      manual:    'bg-blue-500/15 text-blue-300',
      discord:   'bg-indigo-500/15 text-indigo-300',
      confirmed: 'bg-g-green/20 text-g-green',
    };
    return colors[method] ?? 'bg-g-muted/15 text-g-muted';
  };

  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="t-section">Cross-platform identiteter</p>
        <span className="text-[11px] text-g-green">{matches.length} matches</span>
      </div>
      {matches.length === 0 ? (
        <EmptyState msg="Ingen identitets-matches ennå. Koble Twitch og Discord for å aktivere." />
      ) : (
        <div className="space-y-2">
          {matches.map(m => (
            <div key={m.id} className="flex items-center gap-3 py-2.5 border-b border-g-border/20 last:border-0">
              {/* Twitch */}
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <div className="w-2 h-2 rounded-full bg-violet-400 shrink-0" />
                <span className="text-xs font-medium text-violet-300 truncate">
                  {m.twitchUsername ?? '—'}
                </span>
              </div>

              {/* Arrow */}
              <span className="text-g-muted text-xs shrink-0">⟷</span>

              {/* Discord */}
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <div className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
                <span className="text-xs font-medium text-indigo-300 truncate">
                  {m.discordUsername ?? '—'}
                </span>
              </div>

              {/* Confidence pill */}
              <span className={`px-2 py-0.5 rounded text-[11px] font-bold shrink-0 ${confColor(m.confidence)}`}>
                {Math.round(m.confidence * 100)}%
              </span>

              {/* Method badge */}
              {m.matchMethod && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${methodBadge(m.matchMethod)}`}>
                  {m.matchMethod}
                </span>
              )}

              {/* Status */}
              <span className={`text-[10px] shrink-0 ${
                m.matchStatus === 'confirmed' ? 'text-g-green' :
                m.matchStatus === 'rejected'  ? 'text-red-400' :
                'text-g-muted'
              }`}>{m.matchStatus}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TabKontroll({
  allMemories,
  onAction,
  actionLoading,
}: {
  allMemories: MemorySummary[];
  onAction: (action: string, ids: Record<string, string>, extra?: Record<string, unknown>) => Promise<void>;
  actionLoading: Record<string, boolean>;
}) {
  const [boostValues, setBoostValues] = useState<Record<string, number>>({});
  const [showRejected, setShowRejected] = useState(false);

  const pending  = allMemories.filter(m => m.adminApproved === null);
  const rejected = allMemories.filter(m => m.adminApproved === false);
  const approved = allMemories.filter(m => m.adminApproved === true);

  const ActionBtn = ({
    label, onClick, color, loading,
  }: { label: string; onClick: () => void; color: string; loading?: boolean }) => (
    <button
      onClick={onClick}
      disabled={loading}
      className={`px-2 py-1 rounded text-[11px] font-semibold border transition-all ${color} ${loading ? 'opacity-50 cursor-wait' : ''}`}
    >
      {loading ? '...' : label}
    </button>
  );

  const MemoryAdminCard = ({ m, showReject = true }: { m: MemorySummary; showReject?: boolean }) => {
    const boost = boostValues[m.id] ?? m.importanceBoost ?? 0;
    const isLoading = actionLoading[m.id] ?? false;

    return (
      <div className="py-3 border-b border-g-border/20 last:border-0">
        <div className="flex items-start gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
              <span className="text-xs font-medium text-g-text truncate max-w-xs">{m.key}</span>
              <CategoryBadge cat={m.category} />
              <span className="text-[11px] text-g-muted">{m.memoryType}</span>
              {m.locked && <span className="text-[10px] text-amber-300">🔒</span>}
            </div>
            <p className="text-xs text-g-muted leading-snug">{m.summary.slice(0, 100)}{m.summary.length > 100 ? '…' : ''}</p>
            <div className="flex gap-3 mt-1">
              <span className="text-[11px] text-g-muted">Konf: {Math.round(m.confidence * 100)}%</span>
              <span className="text-[11px] text-g-muted">{m.occurrenceCount}× sett</span>
              <span className="text-[11px] text-g-muted/50">{tidSiden(m.lastSeen)}</span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          <ActionBtn
            label="✓ Godkjenn"
            onClick={() => onAction('approve', { memoryId: m.id })}
            color="border-g-green/40 text-g-green hover:bg-g-green/10"
            loading={isLoading}
          />
          {showReject && (
            <ActionBtn
              label="✗ Avvis"
              onClick={() => onAction('reject', { memoryId: m.id })}
              color="border-red-400/40 text-red-400 hover:bg-red-400/10"
              loading={isLoading}
            />
          )}
          {!showReject && (
            <ActionBtn
              label="Angre avvisning"
              onClick={() => onAction('approve', { memoryId: m.id })}
              color="border-yellow-400/40 text-yellow-400 hover:bg-yellow-400/10"
              loading={isLoading}
            />
          )}
          <ActionBtn
            label={m.locked ? '🔓 Lås opp' : '🔒 Lås'}
            onClick={() => onAction(m.locked ? 'unlock' : 'lock', { memoryId: m.id })}
            color="border-amber-400/40 text-amber-400 hover:bg-amber-400/10"
            loading={isLoading}
          />
          <ActionBtn
            label="↺ Reset styrke"
            onClick={() => onAction('reset_strength', { memoryId: m.id })}
            color="border-blue-400/40 text-blue-400 hover:bg-blue-400/10"
            loading={isLoading}
          />
          <ActionBtn
            label="🗑 Slett"
            onClick={() => onAction('delete', { memoryId: m.id })}
            color="border-red-400/30 text-red-400/70 hover:text-red-400 hover:bg-red-400/10"
            loading={isLoading}
          />
        </div>

        {/* Boost slider */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-g-muted shrink-0">Boost: {boost > 0 ? '+' : ''}{boost.toFixed(1)}</span>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.1"
            value={boost}
            onChange={e => setBoostValues(prev => ({ ...prev, [m.id]: parseFloat(e.target.value) }))}
            className="flex-1 h-1 accent-[#00ff41]"
          />
          <button
            onClick={() => onAction('boost', { memoryId: m.id }, { boostValue: boost })}
            disabled={isLoading}
            className="px-2 py-0.5 rounded text-[11px] border border-g-border text-g-muted hover:text-g-text hover:border-g-green/40 transition-all"
          >
            Sett
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-g-card border border-g-border rounded-xl p-3 text-center">
          <p className="text-xl font-black text-yellow-400">{pending.length}</p>
          <p className="text-xs text-g-muted">Venter på godkjenning</p>
        </div>
        <div className="bg-g-card border border-g-border rounded-xl p-3 text-center">
          <p className="text-xl font-black text-red-400">{rejected.length}</p>
          <p className="text-xs text-g-muted">Avviste minner</p>
        </div>
        <div className="bg-g-card border border-g-border rounded-xl p-3 text-center">
          <p className="text-xl font-black text-g-green">{approved.length}</p>
          <p className="text-xs text-g-muted">Godkjente minner</p>
        </div>
      </div>

      {/* Pending memories */}
      <div className="bg-g-card border border-g-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="t-section">Venter på godkjenning</p>
          <span className="text-[11px] text-yellow-400">{pending.length} minner</span>
        </div>
        {pending.length === 0 ? (
          <EmptyState msg="Ingen minner venter på gjennomgang" />
        ) : (
          <div className="max-h-[500px] overflow-y-auto">
            {pending.map(m => (
              <MemoryAdminCard key={m.id} m={m} />
            ))}
          </div>
        )}
      </div>

      {/* Rejected memories */}
      <div className="bg-g-card border border-g-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="t-section">Avviste minner</p>
          <button
            onClick={() => setShowRejected(!showRejected)}
            className="text-[11px] text-g-muted hover:text-g-text transition-colors"
          >
            {showRejected ? 'Skjul' : `Vis ${rejected.length}`}
          </button>
        </div>
        {showRejected && rejected.length > 0 && (
          <div className="max-h-80 overflow-y-auto">
            {rejected.map(m => (
              <MemoryAdminCard key={m.id} m={m} showReject={false} />
            ))}
          </div>
        )}
        {showRejected && rejected.length === 0 && (
          <EmptyState msg="Ingen avviste minner" />
        )}
        {!showRejected && <EmptyState msg={`${rejected.length} avviste minner skjult`} />}
      </div>
    </div>
  );
}

function TabCreatorKunnskap({
  knowledge,
  onAction,
  actionLoading,
}: {
  knowledge: KnowledgeSummary[];
  onAction: (action: string, ids: Record<string, string>) => Promise<void>;
  actionLoading: Record<string, boolean>;
}) {
  // Group by knowledgeType
  const grouped = new Map<string, KnowledgeSummary[]>();
  for (const k of knowledge) {
    if (!grouped.has(k.knowledgeType)) grouped.set(k.knowledgeType, []);
    grouped.get(k.knowledgeType)!.push(k);
  }

  const TYPE_LABELS: Record<string, string> = {
    promotion_pattern:   'Godkjenningsmønstre',
    rejection_pattern:   'Avvisningsmønstre',
    platform_preference: 'Plattform-preferanser',
    decision_accuracy:   'AI-treffsikkerhet',
    stream_behaviour:    'Stream-atferd',
    creator_preference:  'Creator-preferanser',
    partner_performance: 'Partner-ytelse',
    timing_pattern:      'Tidspunkt-mønstre',
  };

  if (knowledge.length === 0) {
    return (
      <div className="bg-g-card border border-g-border rounded-2xl p-6">
        <EmptyState msg="Ingen Creator Knowledge ennå. Kjøres automatisk etter Learning Engine-analyse." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {Array.from(grouped.entries()).map(([type, items]) => (
        <div key={type} className="bg-g-card border border-g-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="t-section">{TYPE_LABELS[type] ?? type}</p>
            <span className="text-[11px] text-g-green">{items.length} oppføringer</span>
          </div>
          <div className="space-y-3">
            {items.map(k => (
              <div key={k.id} className="py-2 border-b border-g-border/20 last:border-0">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-medium text-g-text truncate">{k.key}</span>
                    </div>
                    <p className="text-xs text-g-muted leading-snug mb-1.5">{k.summary.slice(0, 140)}</p>
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex items-center gap-1 text-[11px] text-g-muted w-36">
                        <span>Konfidens</span>
                        <ConfBar value={k.confidence / 100} size="xs" />
                      </div>
                      <span className="text-[11px] text-g-muted">{k.evidenceCount} bevis</span>
                      {k.strength > 0 && (
                        <div className="flex items-center gap-1 text-[11px] text-g-muted w-28">
                          <span>Styrke</span>
                          <ConfBar value={k.strength} size="xs" />
                        </div>
                      )}
                      {k.lastUpdated && (
                        <span className="text-[11px] text-g-muted/50">{tidSiden(k.lastUpdated)}</span>
                      )}
                    </div>
                  </div>
                  {/* Admin buttons */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => onAction('lock', { knowledgeId: k.id })}
                      disabled={actionLoading[k.id]}
                      className="px-1.5 py-0.5 text-[11px] text-amber-400/70 hover:text-amber-400 border border-transparent hover:border-amber-400/30 rounded transition-all"
                      title="Lås"
                    >
                      🔒
                    </button>
                    <button
                      onClick={() => onAction('delete', { knowledgeId: k.id })}
                      disabled={actionLoading[k.id]}
                      className="px-1.5 py-0.5 text-[11px] text-red-400/60 hover:text-red-400 border border-transparent hover:border-red-400/20 rounded transition-all"
                      title="Slett"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string }[] = [
  { id: 'oversikt',    label: 'Oversikt' },
  { id: 'minner',      label: 'Minner' },
  { id: 'innsikter',   label: 'Innsikter' },
  { id: 'identiteter', label: 'Identiteter' },
  { id: 'kontroll',    label: 'Kontroll' },
  { id: 'creator',     label: 'Creator Kunnskap' },
];

export default function CommunityBrainPage() {
  const [data, setData]               = useState<BrainData | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [tab, setTab]                 = useState<TabId>('oversikt');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/community-brain');
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      setData(await res.json());
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Feil ved henting av data');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const adminAction = useCallback(async (
    action: string,
    ids: Record<string, string>,
    extra?: Record<string, unknown>,
  ) => {
    const key = ids.memoryId ?? ids.insightId ?? ids.knowledgeId ?? action;
    setActionLoading(prev => ({ ...prev, [key]: true }));
    try {
      await fetch('/api/community-brain/admin', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action, ...ids, ...extra }),
      });
      await fetchData();
    } catch {}
    setActionLoading(prev => ({ ...prev, [key]: false }));
  }, [fetchData]);

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-g-border/40 rounded w-56" />
          <div className="grid grid-cols-4 gap-3">
            {[1,2,3,4].map(i => <div key={i} className="h-20 bg-g-border/40 rounded-2xl" />)}
          </div>
          <div className="h-48 bg-g-border/40 rounded-2xl" />
          <div className="h-64 bg-g-border/40 rounded-2xl" />
        </div>
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="bg-g-card border border-red-400/30 rounded-2xl p-6 text-center">
          <p className="text-sm text-red-400 mb-3">Kunne ikke hente Community Brain data</p>
          <p className="text-xs text-g-muted mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="px-4 py-2 text-sm bg-g-green/10 text-g-green border border-g-green/30 rounded-lg hover:bg-g-green/20 transition-all"
          >
            Prøv igjen
          </button>
        </div>
      </div>
    );
  }

  // ── Empty / no data ─────────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="bg-g-card border border-g-border rounded-2xl p-6 text-center">
          <p className="text-sm text-g-muted">Ingen Community Brain data. Aktiver Learning Engine V2.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold gradient-text">Community Brain</h1>
          <p className="text-xs text-g-muted mt-0.5">
            Learning Engine V2 · {data.stats.totalMemories} minner · {data.stats.totalInsights} innsikter
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.stats.pendingReview > 0 && (
            <span className="px-2.5 py-1 text-[11px] font-semibold bg-yellow-500/15 text-yellow-300 border border-yellow-500/30 rounded-full">
              {data.stats.pendingReview} til gjennomgang
            </span>
          )}
          <button
            onClick={fetchData}
            className="px-3 py-1.5 text-xs text-g-muted hover:text-g-text border border-g-border hover:border-g-green/40 rounded-lg transition-all"
          >
            ↻ Oppdater
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-g-border">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-xs font-semibold transition-all border-b-2 -mb-px whitespace-nowrap ${
              tab === t.id
                ? 'border-g-green text-g-green'
                : 'border-transparent text-g-muted hover:text-g-text'
            }`}
          >
            {t.label}
            {t.id === 'kontroll' && data.stats.pendingReview > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[10px] bg-yellow-500/20 text-yellow-300 rounded-full">
                {data.stats.pendingReview}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'oversikt'    && <TabOversikt data={data} />}
      {tab === 'minner'      && <TabMinner allMemories={data.allMemories} />}
      {tab === 'innsikter'   && <TabInnsikter insights={data.recentInsights} />}
      {tab === 'identiteter' && <TabIdentiteter matches={data.identityMatches} />}
      {tab === 'kontroll'    && (
        <TabKontroll
          allMemories={data.allMemories}
          onAction={adminAction}
          actionLoading={actionLoading}
        />
      )}
      {tab === 'creator' && (
        <TabCreatorKunnskap
          knowledge={data.creatorKnowledge}
          onAction={adminAction}
          actionLoading={actionLoading}
        />
      )}
    </div>
  );
}
