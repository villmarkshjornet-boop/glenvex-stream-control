'use client';

import { useEffect, useState } from 'react';
import type { CommunitySnapshotData, CommunitySnapshotMember } from '@/app/api/dashboard/community-snapshot/route';

function initials(member: CommunitySnapshotMember): string {
  const name = member.display_name ?? member.username ?? '?';
  return name.slice(0, 2).toUpperCase();
}

function displayName(member: CommunitySnapshotMember): string {
  return member.display_name ?? member.username ?? member.discord_id.slice(0, 8);
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 animate-pulse">
      <div className="w-8 h-8 rounded-full bg-g-border flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 bg-g-border rounded w-28" />
        <div className="h-2.5 bg-g-border rounded w-16" />
      </div>
      <div className="h-3 bg-g-border rounded w-12" />
    </div>
  );
}

export function CommunitySnapshot() {
  const [data, setData] = useState<CommunitySnapshotData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard/community-snapshot')
      .then(r => (r.ok ? r.json() : null))
      .then((d: CommunitySnapshotData | null) => {
        if (d) setData(d);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="glass-card rounded-2xl p-6 shadow-green-sm">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xs font-semibold tracking-widest uppercase text-g-muted">
          Community Snapshot
        </h2>
        {data && data.totalMembers > 0 && (
          <span className="text-xs text-g-muted/60 font-mono">
            {data.totalMembers} totalt
          </span>
        )}
      </div>

      {loading && (
        <div className="space-y-4">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}

      {!loading && (!data || data.topMembers.length === 0) && (
        <p className="text-sm text-g-muted/50">Ingen community-data ennå</p>
      )}

      {!loading && data && data.topMembers.length > 0 && (
        <div className="space-y-3">
          {data.topMembers.map((member, idx) => {
            const isMvp = idx === 0;
            return (
              <div
                key={member.discord_id}
                className={`flex items-center gap-3 ${isMvp ? 'p-2 -mx-2 rounded-xl bg-yellow-400/[0.04] border border-yellow-400/10' : ''}`}
              >
                {/* Avatar */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                  isMvp
                    ? 'bg-yellow-400/15 text-yellow-300 border border-yellow-400/20'
                    : 'bg-g-green/10 text-g-green border border-g-green/15'
                }`}>
                  {initials(member)}
                </div>

                {/* Name + level */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {isMvp && (
                      <span className="text-yellow-400 text-[11px]" aria-label="MVP">★</span>
                    )}
                    <span className="text-sm text-g-text font-medium truncate">
                      {displayName(member)}
                    </span>
                    <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded border flex-shrink-0 ${
                      isMvp
                        ? 'text-yellow-300 border-yellow-400/20 bg-yellow-400/10'
                        : 'text-g-muted border-g-border bg-g-bg/50'
                    }`}>
                      Lv.{member.level}
                    </span>
                  </div>
                  {member.streak_days > 0 && (
                    <p className="text-[11px] text-g-muted/50 mt-0.5">
                      {member.streak_days}d streak
                    </p>
                  )}
                </div>

                {/* Stats */}
                <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                  <span className="text-xs font-mono text-g-text">
                    {member.coins_balance.toLocaleString()} c
                  </span>
                  <span className="text-[11px] font-mono text-g-muted/60">
                    {member.xp.toLocaleString()} xp
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && data && data.latestTransaction && (
        <div className="mt-4 pt-4 border-t border-g-border/30">
          <p className="text-[11px] text-g-muted/40">
            Siste transaksjon:{' '}
            <span className={`font-mono ${data.latestTransaction.amount >= 0 ? 'text-g-green/60' : 'text-red-400/60'}`}>
              {data.latestTransaction.amount >= 0 ? '+' : ''}
              {data.latestTransaction.amount} coins
            </span>
          </p>
        </div>
      )}
    </section>
  );
}
