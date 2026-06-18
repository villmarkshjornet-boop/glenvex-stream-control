// Creator Brain — V3 Operating Kernel (GLENVEX Creator OS)
// Phase 1: minimum viable kernel. Observes, contextualizes, holds state, logs decisions.
// Existing modules are NOT migrated yet — this is the foundation they will connect to.
//
// Kernel Loop (target): OBSERVE → CONTEXTUALIZE → KNOWLEDGE → REASON →
//                       DECIDE → SCHEDULE → DISPATCH → VERIFY → LEARN → IMPROVE
// V3 Architecture: Section 3 + Supplement A (Kernel Model)

import { WORKSPACE_ID } from './supabase';
import { logSystemEvent } from './systemEvents';
import { getCreatorState, updateCreatorState } from './creatorState';
import { getCreatorContext } from './creatorContext';
import { getMemory, upsertMemory } from './memoryEngine';
import { logDecision, recordOutcome, getRecentDecisions } from './decisionEngine';

export type { CreatorState, StreamPhase, EnergyLevel, ChatActivity, ServiceStatus, CachedPartner } from './creatorState';
export type { ContextPurpose, CreatorContext, WorkspaceInfo, RecentEvent, RecentDecision } from './creatorContext';
export type { MemoryRow, UpsertMemoryOpts } from './memoryEngine';
export type { LogDecisionOpts, DecisionRecord } from './decisionEngine';

const _initialized = new Set<string>();

export async function initCreatorBrain(workspaceId?: string): Promise<void> {
  const ws = workspaceId ?? WORKSPACE_ID;
  if (_initialized.has(ws)) return;
  _initialized.add(ws);

  updateCreatorState(ws, state => {
    state.health.initializedAt = new Date();
    state.health.lastHeartbeatAt = new Date();
  });

  logSystemEvent({
    workspaceId: ws,
    source: 'creator_brain',
    event_type: 'CREATOR_BRAIN_INITIALIZED',
    title: 'Creator Brain kjernen er aktiv',
    severity: 'info',
    metadata: {
      phase: 'v3-phase7',
      capabilities: ['state', 'context', 'memory', 'decision', 'partner_cache'],
      migrated: false,
    },
  });

  // Phase 7: cache active partners at startup — partnerHelper reads from Creator State
  getCreatorContext(ws, 'partner').then(ctx => {
    if (ctx.activePartners.length > 0) {
      updateCreatorState(ws, s => {
        s.partners.activePartners = ctx.activePartners;
        s.partners.cachedAt = new Date();
      });
    }
  }).catch(() => {});

  console.log(`[CreatorBrain] Initialisert for workspace "${ws}" (Phase 7)`);
}

export function getBrainState(workspaceId?: string) {
  return getCreatorState(workspaceId ?? WORKSPACE_ID);
}

export async function getBrainContext(
  purpose: Parameters<typeof getCreatorContext>[1],
  workspaceId?: string
) {
  return getCreatorContext(workspaceId ?? WORKSPACE_ID, purpose);
}

export async function getBrainMemory(opts: Parameters<typeof getMemory>[0]) {
  return getMemory(opts);
}

export async function makeBrainDecision(opts: Parameters<typeof logDecision>[0]) {
  return logDecision(opts);
}

export async function closeBrainDecision(
  decisionId: string,
  outcome: Parameters<typeof recordOutcome>[1],
  feedbackScore?: number
) {
  return recordOutcome(decisionId, outcome, feedbackScore);
}

export async function getBrainHealth(workspaceId?: string) {
  const ws = workspaceId ?? WORKSPACE_ID;
  const state = getCreatorState(ws);
  return {
    initialized: _initialized.has(ws),
    initializedAt: state.health.initializedAt,
    lastHeartbeatAt: state.health.lastHeartbeatAt,
    workspaceId: ws,
    phase: 'v3-phase1',
    capabilities: ['state', 'context', 'memory', 'decision'],
  };
}

export {
  getCreatorState,
  updateCreatorState,
  getCreatorContext,
  getMemory,
  upsertMemory,
  getRecentDecisions,
};
