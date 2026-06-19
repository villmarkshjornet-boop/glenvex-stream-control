'use client';

import { useEffect, useState, useCallback } from 'react';
import { CheckCircle, Clock, Send } from 'lucide-react';
import { tidSiden } from './helpers';

interface Proposal {
  id: string;
  partner_name: string;
  platform: 'twitch' | 'discord' | 'both';
  confidence: number | null;
  scoring_detail: { relevance?: number; historical?: number; context?: number; cooldown?: number } | null;
  message_twitch: string | null;
  message_discord: string | null;
  status: 'pending' | 'approved' | 'sent';
  expires_at: string;
  approved_at: string | null;
  sent_at: string | null;
  created_at: string;
}

function utløperLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Utløpt';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `Utløper om ${min}m`;
  return `Utløper om ${Math.floor(min / 60)}t`;
}

function platformBadge(platform: string) {
  const map: Record<string, string> = {
    discord: 'text-indigo-400 border-indigo-400/30 bg-indigo-400/10',
    twitch: 'text-purple-400 border-purple-400/30 bg-purple-400/10',
    both: 'text-g-green border-g-green/30 bg-g-green/10',
  };
  return map[platform] ?? map.discord;
}

export function PartnerProposalQueue() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [approving, setApproving] = useState<Set<string>>(new Set());
  const [localStatus, setLocalStatus] = useState<Record<string, string>>({});

  const hent = useCallback(async () => {
    try {
      const res = await fetch('/api/partner-proposals');
      if (res.ok) {
        const d = await res.json();
        setProposals(d.proposals ?? []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    hent();
    const id = setInterval(hent, 15_000);
    return () => clearInterval(id);
  }, [hent]);

  async function godkjenn(id: string) {
    setApproving(prev => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/partner-proposals/${id}/approve`, { method: 'POST' });
      if (res.ok) {
        setLocalStatus(prev => ({ ...prev, [id]: 'approved' }));
        // Refresh to pick up updated status
        setTimeout(hent, 1000);
      } else {
        const body = await res.json().catch(() => ({}));
        setLocalStatus(prev => ({ ...prev, [id]: body.error ?? 'Feil' }));
      }
    } catch {
      setLocalStatus(prev => ({ ...prev, [id]: 'Nettverksfeil' }));
    }
    setApproving(prev => { const s = new Set(prev); s.delete(id); return s; });
  }

  // Only show relevant proposals: pending + approved + sent last 24h
  const visible = proposals.filter(p => {
    if (p.status === 'sent') {
      const age = Date.now() - new Date(p.sent_at ?? p.created_at).getTime();
      return age < 24 * 60 * 60 * 1000;
    }
    return true;
  });

  if (visible.length === 0) return null;

  const pending = visible.filter(p => p.status === 'pending');
  const others  = visible.filter(p => p.status !== 'pending');

  return (
    <div className="bg-g-card border border-g-border rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-g-muted uppercase tracking-widest font-bold">
          Partner-forslag til godkjenning
        </p>
        {pending.length > 0 && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-yellow-400/10 border border-yellow-400/30 text-yellow-400">
            {pending.length} venter
          </span>
        )}
      </div>

      <div className="space-y-3">
        {/* Pending — needs action */}
        {pending.map(p => {
          const override = localStatus[p.id];
          const isApproving = approving.has(p.id);
          const isJustApproved = override === 'approved';
          const preview = (p.message_discord ?? p.message_twitch ?? '').slice(0, 140);
          const score = p.scoring_detail;

          return (
            <div key={p.id} className="border border-yellow-400/20 bg-yellow-400/5 rounded-xl p-4 space-y-3">
              {/* Header row */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold text-sm text-g-text truncate">{p.partner_name}</span>
                  <span className={`px-1.5 py-0.5 border rounded text-[10px] font-bold flex-shrink-0 ${platformBadge(p.platform)}`}>
                    {p.platform}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-g-muted">{utløperLabel(p.expires_at)}</span>
                  <span className="text-xs font-black text-g-green">
                    {p.confidence != null ? `${Math.round(p.confidence * 100)}%` : '—'}
                  </span>
                </div>
              </div>

              {/* Score detail */}
              {score && (
                <div className="flex gap-3 text-[10px] text-g-muted font-mono">
                  {score.relevance != null && <span>Rel: {Math.round(score.relevance * 100)}%</span>}
                  {score.historical != null && <span>Hist: {Math.round(score.historical * 100)}%</span>}
                  {score.context != null && <span>Ctx: {Math.round(score.context * 100)}%</span>}
                  {score.cooldown != null && score.cooldown > 0 && (
                    <span className="text-red-400/70">−cd: {Math.round(score.cooldown * 100)}%</span>
                  )}
                </div>
              )}

              {/* Message preview */}
              {preview && (
                <p className="text-xs text-g-muted/80 leading-relaxed border-l-2 border-g-border pl-3 italic">
                  {preview}{preview.length === 140 ? '…' : ''}
                </p>
              )}

              {/* Approve button / status */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-g-muted/50">{tidSiden(p.created_at)}</span>
                {isJustApproved ? (
                  <span className="flex items-center gap-1.5 text-xs text-g-green font-bold">
                    <CheckCircle size={13} /> Godkjent – sendes innen 2 min
                  </span>
                ) : override && override !== 'approved' ? (
                  <span className="text-xs text-red-400">{override}</span>
                ) : (
                  <button
                    onClick={() => godkjenn(p.id)}
                    disabled={isApproving}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 border rounded-lg text-xs font-bold transition-colors ${
                      isApproving
                        ? 'border-g-green/30 text-g-green animate-pulse cursor-not-allowed'
                        : 'border-g-green/40 text-g-green hover:bg-g-green/10 hover:border-g-green'
                    }`}
                  >
                    <CheckCircle size={13} />
                    {isApproving ? 'Godkjenner...' : 'Godkjenn'}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Approved (waiting to send) + Sent (last 24h) */}
        {others.map(p => (
          <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 border border-g-border/30 rounded-xl">
            {p.status === 'approved' ? (
              <Clock size={14} className="text-g-green animate-pulse flex-shrink-0" />
            ) : (
              <Send size={14} className="text-g-muted/50 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <span className="text-sm text-g-text font-bold">{p.partner_name}</span>
              <span className={`ml-2 px-1.5 py-0.5 border rounded text-[10px] font-bold ${platformBadge(p.platform)}`}>
                {p.platform}
              </span>
            </div>
            <span className={`text-xs font-bold flex-shrink-0 ${
              p.status === 'approved' ? 'text-g-green' : 'text-g-muted/60'
            }`}>
              {p.status === 'approved' ? 'Sendes innen 2 min' : `Sendt ${tidSiden(p.sent_at ?? p.created_at)}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
