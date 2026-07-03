/**
 * Creator Brain Learning Engine — Phase 18
 *
 * Analyzes historical data and builds structured Creator Knowledge.
 * Called after each stream and nightly. Never blocks other systems.
 *
 * Rules:
 * - Confidence is always computed from evidence_count, never guessed.
 * - Findings use template strings from real numbers — no GPT for logic.
 * - Data < MIN_EVIDENCE is silently skipped (no fabricated entries).
 * - All queries are workspace-scoped.
 */

import { getBotDb, WORKSPACE_ID } from './supabase';
import { logSystemEvent } from './systemEvents';

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_EVIDENCE = 2;
const LOOKBACK_DAYS = 90;

// ── Types ─────────────────────────────────────────────────────────────────────

interface KnowledgeEntry {
  knowledge_type: string;
  key: string;
  title: string;
  finding: string;
  confidence: number;
  evidence_count: number;
  evidence_summary: Record<string, unknown>;
}

// ── Confidence formula ────────────────────────────────────────────────────────
// 0–2 evidence → weak (0–40), 3–9 → medium (40–75), 10+ → strong (75–96 cap)

function conf(n: number): number {
  if (n < 3)  return Math.round(n * 20);
  if (n < 10) return Math.round(40 + (n - 2) * 5);
  return Math.min(96, Math.round(75 + (n - 10) * 1.5));
}

function pct(a: number, b: number): number {
  return b === 0 ? 0 : Math.round((a / b) * 100);
}

// ── Category 1: Promotion Patterns — per partner ──────────────────────────────

function analyzePromotionPatterns(proposals: any[]): KnowledgeEntry[] {
  const byPartner: Record<string, { approved: number; rejected: number; sent: number; pending: number }> = {};
  for (const p of proposals) {
    if (!p.partner_name) continue;
    const e = byPartner[p.partner_name] ??= { approved: 0, rejected: 0, sent: 0, pending: 0 };
    if      (p.status === 'approved') e.approved++;
    else if (p.status === 'sent')     e.sent++;
    else if (p.status === 'rejected') e.rejected++;
    else if (p.status === 'pending')  e.pending++;
  }
  const out: KnowledgeEntry[] = [];
  for (const [name, s] of Object.entries(byPartner)) {
    const countedApproved = s.approved + s.sent;
    const decided = countedApproved + s.rejected;
    if (decided < MIN_EVIDENCE) continue;
    const rate = pct(countedApproved, decided);
    out.push({
      knowledge_type: 'promotion_pattern',
      key: `partner:${name}`,
      title: `${name} — godkjenningsmønster`,
      finding: `Godkjennes i ${rate}% av tilfellene (${countedApproved} av ${decided} avgjorte forslag).${s.pending > 0 ? ` ${s.pending} forslag venter fortsatt.` : ''}`,
      confidence: conf(decided),
      evidence_count: decided,
      evidence_summary: { approved: countedApproved, rejected: s.rejected, sent: s.sent, pending: s.pending, total: decided, approvalRate: rate },
    });
  }
  return out;
}

// ── Category 2: Rejection Patterns — per reasonCode ──────────────────────────

function analyzeRejectionPatterns(decisions: any[]): KnowledgeEntry[] {
  const byCode: Record<string, { success: number; rejected: number }> = {};
  for (const d of decisions) {
    const code = (d.input_context as any)?.reasonCode as string | undefined;
    if (!code || (d.outcome !== 'success' && d.outcome !== 'rejected')) continue;
    const e = byCode[code] ??= { success: 0, rejected: 0 };
    if (d.outcome === 'success') e.success++; else e.rejected++;
  }
  const out: KnowledgeEntry[] = [];
  for (const [code, s] of Object.entries(byCode)) {
    const decided = s.success + s.rejected;
    if (decided < MIN_EVIDENCE) continue;
    const approvalRate = pct(s.success, decided);
    const rejRate = pct(s.rejected, decided);
    out.push({
      knowledge_type: 'rejection_pattern',
      key: `reasonCode:${code}`,
      title: `Forslag med kode "${code}"`,
      finding: approvalRate >= 60
        ? `Godkjennes i ${approvalRate}% av tilfellene (${s.success} av ${decided}).`
        : `Avvises i ${rejRate}% av tilfellene (${s.rejected} av ${decided}). ReasonCode "${code}" gir lav godkjennelsesrate.`,
      confidence: conf(decided),
      evidence_count: decided,
      evidence_summary: { code, success: s.success, rejected: s.rejected, approvalRate, rejectionRate: rejRate },
    });
  }
  return out;
}

// ── Category 3: Platform Preference ──────────────────────────────────────────

function analyzePlatformPreference(contentLogs: any[], proposals: any[]): KnowledgeEntry[] {
  const counts: Record<string, number> = {};
  for (const l of contentLogs) {
    if (l.platform) counts[l.platform] = (counts[l.platform] ?? 0) + 1;
  }
  for (const p of proposals) {
    if ((p.status === 'sent' || p.status === 'approved') && p.platform) {
      counts[p.platform] = (counts[p.platform] ?? 0) + 1;
    }
  }
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  if (total < MIN_EVIDENCE) return [];
  const out: KnowledgeEntry[] = [];
  for (const [platform, count] of Object.entries(counts)) {
    const percentage = pct(count, total);
    out.push({
      knowledge_type: 'platform_preference',
      key: `platform:${platform}`,
      title: `${platform.charAt(0).toUpperCase() + platform.slice(1)}-andel av promoer`,
      finding: `${percentage}% av alle promoer sendes via ${platform} (${count} av ${total} totalt).`,
      confidence: conf(count),
      evidence_count: count,
      evidence_summary: { platform, count, total, percentage },
    });
  }
  return out;
}

// ── Category 4: Decision Accuracy — score bucket vs outcome ──────────────────

function analyzeDecisionAccuracy(decisions: any[]): KnowledgeEntry[] {
  type Bucket = { label: string; success: number; rejected: number };
  const buckets: Record<string, Bucket> = {
    '0-40':   { label: '0–40%',   success: 0, rejected: 0 },
    '40-60':  { label: '40–60%',  success: 0, rejected: 0 },
    '60-80':  { label: '60–80%',  success: 0, rejected: 0 },
    '80-100': { label: '80–100%', success: 0, rejected: 0 },
  };
  for (const d of decisions) {
    const score = (d.input_context as any)?.score as number | undefined;
    if (score == null || (d.outcome !== 'success' && d.outcome !== 'rejected')) continue;
    const k = score < 0.4 ? '0-40' : score < 0.6 ? '40-60' : score < 0.8 ? '60-80' : '80-100';
    if (d.outcome === 'success') buckets[k].success++; else buckets[k].rejected++;
  }
  const out: KnowledgeEntry[] = [];
  for (const [key, b] of Object.entries(buckets)) {
    const decided = b.success + b.rejected;
    if (decided < MIN_EVIDENCE) continue;
    const approvalRate = pct(b.success, decided);
    out.push({
      knowledge_type: 'decision_accuracy',
      key: `score_bucket:${key}`,
      title: `AI-score ${b.label} → godkjennelsesrate`,
      finding: `Forslag med AI-score ${b.label} ble godkjent i ${approvalRate}% av tilfellene (${b.success} av ${decided}).`,
      confidence: conf(decided),
      evidence_count: decided,
      evidence_summary: { scoreBucket: key, label: b.label, success: b.success, rejected: b.rejected, approvalRate },
    });
  }
  return out;
}

// ── Category 5: Stream Behaviour — minute offset from stream start ────────────

function analyzeStreamBehaviour(proposals: any[], streams: any[]): KnowledgeEntry[] {
  const windows = [
    { key: '0-15',  label: '0–15 min',  min: 0,  max: 15 },
    { key: '15-30', label: '15–30 min', min: 15, max: 30 },
    { key: '30-45', label: '30–45 min', min: 30, max: 45 },
    { key: '45-60', label: '45–60 min', min: 45, max: 60 },
    { key: '60+',   label: '60+ min',   min: 60, max: Infinity },
  ];
  const stats: Record<string, { approved: number; rejected: number }> = {};
  for (const w of windows) stats[w.key] = { approved: 0, rejected: 0 };

  for (const p of proposals) {
    if (p.status !== 'approved' && p.status !== 'sent' && p.status !== 'rejected') continue;
    const ts = new Date(p.created_at).getTime();
    const stream = streams.find(s => {
      const start = new Date(s.started_at).getTime();
      const end   = s.ended_at ? new Date(s.ended_at).getTime() : start + 4 * 60 * 60 * 1000;
      return ts >= start && ts <= end;
    });
    if (!stream) continue;
    const offset = Math.floor((ts - new Date(stream.started_at).getTime()) / 60_000);
    const w = windows.find(w => offset >= w.min && offset < w.max);
    if (!w) continue;
    if (p.status === 'approved' || p.status === 'sent') stats[w.key].approved++;
    else stats[w.key].rejected++;
  }

  const out: KnowledgeEntry[] = [];
  for (const w of windows) {
    const s = stats[w.key];
    const decided = s.approved + s.rejected;
    if (decided < MIN_EVIDENCE) continue;
    const approvalRate = pct(s.approved, decided);
    out.push({
      knowledge_type: 'stream_behaviour',
      key: `timing_window:${w.key}`,
      title: `Promo-tidspunkt ${w.label} inn i stream`,
      finding: `Forslag opprettet ${w.label} inn i stream ble godkjent i ${approvalRate}% av tilfellene (${s.approved} av ${decided}).`,
      confidence: conf(decided),
      evidence_count: decided,
      evidence_summary: { window: w.key, label: w.label, approved: s.approved, rejected: s.rejected, approvalRate },
    });
  }
  return out;
}

// ── Category 6: Creator Preferences — by triggerType ─────────────────────────

function analyzeCreatorPreferences(decisions: any[]): KnowledgeEntry[] {
  const byTrigger: Record<string, { success: number; rejected: number }> = {};
  for (const d of decisions) {
    const trigger = (d.input_context as any)?.triggerType as string | undefined;
    if (!trigger || (d.outcome !== 'success' && d.outcome !== 'rejected')) continue;
    const e = byTrigger[trigger] ??= { success: 0, rejected: 0 };
    if (d.outcome === 'success') e.success++; else e.rejected++;
  }
  const LABELS: Record<string, string> = {
    timer: 'Timer', chat_silence: 'Chat-stillhet', viewer_peak: 'Seer-topp',
    context_match: 'Konteksttreff', manual: 'Manuell',
  };
  const out: KnowledgeEntry[] = [];
  for (const [trigger, s] of Object.entries(byTrigger)) {
    const decided = s.success + s.rejected;
    if (decided < MIN_EVIDENCE) continue;
    const rate = pct(s.success, decided);
    const label = LABELS[trigger] ?? trigger;
    out.push({
      knowledge_type: 'creator_preference',
      key: `trigger:${trigger}`,
      title: `Streamer-preferanse: "${label}"`,
      finding: `Forslag trigget av "${label}" godkjennes i ${rate}% av tilfellene (${s.success} av ${decided}).`,
      confidence: conf(decided),
      evidence_count: decided,
      evidence_summary: { trigger, label, success: s.success, rejected: s.rejected, approvalRate: rate },
    });
  }
  return out;
}

// ── Category 7: Partner Performance — combined view ───────────────────────────

function analyzePartnerPerformance(proposals: any[], contentLogs: any[], decisions: any[]): KnowledgeEntry[] {
  const names = Array.from(new Set<string>([
    ...proposals.map((p: any) => p.partner_name).filter(Boolean),
    ...contentLogs.map((l: any) => l.partner_name).filter(Boolean),
  ]));
  const out: KnowledgeEntry[] = [];
  for (const name of names) {
    const props = proposals.filter((p: any) => p.partner_name === name);
    const logs  = contentLogs.filter((l: any) => l.partner_name === name);
    const decs  = decisions.filter((d: any) => (d.input_context as any)?.partnerName === name && d.input_context?.score != null);
    const approved = props.filter((p: any) => p.status === 'approved' || p.status === 'sent').length;
    const rejected = props.filter((p: any) => p.status === 'rejected').length;
    const decided  = approved + rejected;
    const totalPts = props.length + logs.length;
    if (totalPts < MIN_EVIDENCE) continue;
    const approvalRate = decided > 0 ? pct(approved, decided) : null;
    const avgScore = decs.length > 0
      ? Math.round(decs.reduce((s: number, d: any) => s + (d.input_context as any).score, 0) / decs.length * 100)
      : null;
    const parts: string[] = [];
    if (logs.length > 0)     parts.push(`${logs.length} promoer sendt`);
    if (decided > 0)         parts.push(`${props.length} forslag (${approvalRate}% godkjent)`);
    if (avgScore !== null)   parts.push(`AI-score gj.snitt ${avgScore}%`);
    out.push({
      knowledge_type: 'partner_performance',
      key: `partner_perf:${name}`,
      title: `${name} — ytelsessammendrag`,
      finding: parts.length > 0 ? parts.join('. ') + '.' : 'Lite historikk tilgjengelig.',
      confidence: conf(totalPts),
      evidence_count: totalPts,
      evidence_summary: { promosSent: logs.length, proposalsTotal: props.length, approved, rejected, approvalRate, avgScore, decisions: decs.length },
    });
  }
  return out;
}

// ── Category 8: Timing Pattern — best 3-hour window by approval rate ──────────

function analyzeTimingPatterns(proposals: any[]): KnowledgeEntry[] {
  const hourStats: Record<number, { approved: number; rejected: number }> = {};
  for (const p of proposals) {
    if (p.status !== 'approved' && p.status !== 'sent' && p.status !== 'rejected') continue;
    const h = new Date(p.created_at).getUTCHours();
    const e = hourStats[h] ??= { approved: 0, rejected: 0 };
    if (p.status === 'approved' || p.status === 'sent') e.approved++; else e.rejected++;
  }
  type Win = { start: number; approved: number; rejected: number };
  const windows: Win[] = [];
  for (let s = 0; s < 24; s += 3) {
    const hrs = [s, s + 1, s + 2].filter(h => h < 24);
    const approved = hrs.reduce((acc, h) => acc + (hourStats[h]?.approved ?? 0), 0);
    const rejected = hrs.reduce((acc, h) => acc + (hourStats[h]?.rejected ?? 0), 0);
    if (approved + rejected >= MIN_EVIDENCE) windows.push({ start: s, approved, rejected });
  }
  if (windows.length === 0) return [];
  windows.sort((a, b) => pct(b.approved, b.approved + b.rejected) - pct(a.approved, a.approved + a.rejected));
  const best = windows[0];
  const decided = best.approved + best.rejected;
  const rate = pct(best.approved, decided);
  const end = (best.start + 3) % 24;
  return [{
    knowledge_type: 'timing_pattern',
    key: `hour_window:${best.start}-${end}`,
    title: `Beste tidspunkt: ${best.start}:00–${end}:00 UTC`,
    finding: `Forslag opprettet ${best.start}:00–${end}:00 UTC ble godkjent i ${rate}% av tilfellene (${best.approved} av ${decided}).`,
    confidence: conf(decided),
    evidence_count: decided,
    evidence_summary: { startHour: best.start, endHour: end, approved: best.approved, rejected: best.rejected, approvalRate: rate },
  }];
}

// ── Upsert ────────────────────────────────────────────────────────────────────

async function upsertKnowledge(db: any, wsId: string, entry: KnowledgeEntry): Promise<'created' | 'updated'> {
  const now = new Date().toISOString();
  const { data: existing } = await db
    .from('creator_knowledge')
    .select('id')
    .eq('workspace_id', wsId)
    .eq('knowledge_type', entry.knowledge_type)
    .eq('key', entry.key)
    .maybeSingle();

  if (existing?.id) {
    await db.from('creator_knowledge')
      .update({
        title:            entry.title,
        finding:          entry.finding,
        confidence:       entry.confidence,
        evidence_count:   entry.evidence_count,
        evidence_summary: entry.evidence_summary,
        last_seen:        now,
        updated_at:       now,
      })
      .eq('workspace_id', wsId)
      .eq('knowledge_type', entry.knowledge_type)
      .eq('key', entry.key);
    return 'updated';
  }

  await db.from('creator_knowledge').insert({
    workspace_id:     wsId,
    knowledge_type:   entry.knowledge_type,
    key:              entry.key,
    title:            entry.title,
    finding:          entry.finding,
    confidence:       entry.confidence,
    evidence_count:   entry.evidence_count,
    evidence_summary: entry.evidence_summary,
    first_seen:       now,
    last_seen:        now,
    created_at:       now,
    updated_at:       now,
  });
  return 'created';
}

// ── Public: knowledge boost for Decision Engine ───────────────────────────────

export async function getPartnerKnowledgeBoost(wsId: string, partnerName: string): Promise<number> {
  const db = getBotDb();
  if (!db) return 0;
  try {
    const { data } = await db
      .from('creator_knowledge')
      .select('confidence, evidence_summary')
      .eq('workspace_id', wsId)
      .eq('knowledge_type', 'promotion_pattern')
      .eq('key', `partner:${partnerName}`)
      .maybeSingle();
    if (!data || data.confidence < 40) return 0;
    const approvalRate = (data.evidence_summary as any)?.approvalRate as number | undefined;
    if (approvalRate == null) return 0;
    // Max ±0.06, scaled by confidence and distance from 50%
    const confidenceScale = Math.min(1, data.confidence / 80);
    const raw = ((approvalRate - 50) / 50) * 0.06 * confidenceScale;
    return Math.max(-0.06, Math.min(0.06, raw));
  } catch {
    return 0;
  }
}

// ── Public: run full learning pass ───────────────────────────────────────────

export async function runLearningEngine(wsId: string = WORKSPACE_ID): Promise<void> {
  const db = getBotDb();
  if (!db) return;

  logSystemEvent({
    workspaceId: wsId,
    source: 'learning_engine',
    event_type: 'LEARNING_STARTED',
    title: 'Creator Brain Learning Engine startet',
    severity: 'info',
    metadata: { workspaceId: wsId },
  });

  try {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const [proposalsRes, decisionsRes, logsRes, streamsRes] = await Promise.all([
      db.from('partner_proposals')
        .select('id, partner_name, platform, status, confidence, approved_at, sent_at, created_at')
        .eq('workspace_id', wsId)
        .gte('created_at', since)
        .limit(1000),

      db.from('ai_agent_decisions')
        .select('id, outcome, input_context, created_at')
        .eq('workspace_id', wsId)
        .eq('agent_type', 'partner_promotion')
        .gte('created_at', since)
        .limit(1000),

      db.from('partner_content_log')
        .select('partner_name, platform, channel, posted_at')
        .eq('workspace_id', wsId)
        .gte('posted_at', since)
        .limit(500),

      db.from('stream_history')
        .select('stream_id, started_at, ended_at, peak_viewers, avg_viewers, duration_minutes')
        .eq('workspace_id', wsId)
        .gte('started_at', since)
        .limit(200),
    ]);

    const proposals  = proposalsRes.data  ?? [];
    const decisions  = decisionsRes.data  ?? [];
    const logs       = logsRes.data       ?? [];
    const streams    = streamsRes.data    ?? [];

    const rawEntries: KnowledgeEntry[] = [
      ...analyzePromotionPatterns(proposals),
      ...analyzeRejectionPatterns(decisions),
      ...analyzePlatformPreference(logs, proposals),
      ...analyzeDecisionAccuracy(decisions),
      ...analyzeStreamBehaviour(proposals, streams),
      ...analyzeCreatorPreferences(decisions),
      ...analyzePartnerPerformance(proposals, logs, decisions),
      ...analyzeTimingPatterns(proposals),
    ];

    const valid = rawEntries.filter(e => e.evidence_count >= MIN_EVIDENCE);

    let created = 0;
    let updated = 0;

    for (const entry of valid) {
      try {
        const result = await upsertKnowledge(db, wsId, entry);
        if (result === 'created') {
          created++;
          logSystemEvent({
            workspaceId: wsId,
            source: 'learning_engine',
            event_type: 'KNOWLEDGE_CREATED',
            title: `Ny kunnskap: ${entry.title}`,
            severity: 'info',
            metadata: {
              knowledge_type: entry.knowledge_type,
              key: entry.key,
              confidence: entry.confidence,
              evidence_count: entry.evidence_count,
            },
          });
        } else {
          updated++;
        }
      } catch {
        // Silent — one entry failing should not stop the rest
      }
    }

    logSystemEvent({
      workspaceId: wsId,
      source: 'learning_engine',
      event_type: 'LEARNING_COMPLETED',
      title: `Learning Engine ferdig: ${valid.length} kunnskapsoppføringer (${created} nye, ${updated} oppdatert)`,
      severity: 'info',
      metadata: {
        created, updated, total: valid.length,
        proposalsAnalyzed: proposals.length,
        decisionsAnalyzed: decisions.length,
        streamsAnalyzed: streams.length,
        lookbackDays: LOOKBACK_DAYS,
      },
    });

    // ── Decay pass for creator_knowledge (weekly, 5% strength reduction) ─────
    try {
      const cutoff6d = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
      const { data: staleKnowledge } = await db
        .from('creator_knowledge')
        .select('id,strength,confidence,evidence_count')
        .eq('workspace_id', wsId)
        .eq('locked', false)
        .or(`last_decayed_at.is.null,last_decayed_at.lt.${cutoff6d}`)
        .limit(200);

      if (staleKnowledge && staleKnowledge.length > 0) {
        let decayed = 0;
        const nowStr = new Date().toISOString();
        for (const ck of staleKnowledge as { id: unknown; strength: number | null; confidence: number | null; evidence_count: number | null }[]) {
          const currentStrength   = ck.strength        ?? 1.0;
          const currentConfidence = ck.confidence      ?? 50;
          const evidenceCount     = ck.evidence_count  ?? 0;

          const newStrength   = Math.max(0.05, currentStrength * 0.95);
          const newConfidence = evidenceCount < 3
            ? Math.max(10, currentConfidence - 1)
            : currentConfidence;

          await db.from('creator_knowledge').update({
            strength:        newStrength,
            confidence:      newConfidence,
            last_decayed_at: nowStr,
          }).eq('id', ck.id);
          decayed++;
        }

        logSystemEvent({
          workspaceId: wsId,
          source: 'learning_engine',
          event_type: 'KNOWLEDGE_DECAY_COMPLETED',
          title: `Creator Knowledge decay: ${decayed} oppføringer oppdatert`,
          severity: 'info',
          metadata: { decayed, total: staleKnowledge.length },
        });
      }
    } catch {
      // Decay failure is non-fatal — main learning run already succeeded
    }

  } catch (err: unknown) {
    logSystemEvent({
      workspaceId: wsId,
      source: 'learning_engine',
      event_type: 'LEARNING_FAILED',
      title: 'Creator Brain Learning Engine feilet',
      severity: 'warning',
      metadata: { error: String(err).slice(0, 200) },
    });
  }
}
