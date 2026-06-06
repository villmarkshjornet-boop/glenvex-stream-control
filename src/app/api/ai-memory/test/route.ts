/**
 * End-to-end test for Global AI Memory tabeller.
 * Slettes etter verifisering er ferdig.
 * GET /api/ai-memory/test
 */

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

interface StepResult {
  step: string;
  ok: boolean;
  detail?: string;
  data?: any;
}

export async function GET() {
  const db = getDb();
  const workspaceId = getWorkspaceId();
  const steg: StepResult[] = [];

  // ── Steg 1: Sjekk at tabellene eksisterer (SELECT) ────────────────────────
  for (const tabell of ['ai_agent_events', 'ai_agent_memory', 'ai_agent_insights', 'ai_agent_decisions'] as const) {
    try {
      const { error } = await (db as any).from(tabell).select('id').limit(1);
      steg.push({
        step: `Tabell ${tabell} eksisterer`,
        ok: !error,
        detail: error ? error.message : 'SELECT OK',
      });
    } catch (e: any) {
      steg.push({ step: `Tabell ${tabell} eksisterer`, ok: false, detail: e.message });
    }
  }

  const allTablesOk = steg.every(s => s.ok);
  if (!allTablesOk) {
    return NextResponse.json({
      ok: false,
      melding: 'En eller flere tabeller mangler. Kjør supabase/global-ai-migration.sql i Supabase SQL Editor.',
      steg,
    });
  }

  const testKey = `__test_${Date.now()}`;

  // ── Steg 2: Logg fake Twitch-event (simulerer Twitch-agenten) ────────────
  try {
    const { error } = await (db as any).from('ai_agent_events').insert({
      workspace_id: workspaceId,
      source: 'twitch',
      event_type: 'test_raid',
      username: 'TestRaider',
      importance_score: 75,
      metadata: { viewers: 42, test: true },
    });
    steg.push({ step: 'Twitch-agent: INSERT ai_agent_events', ok: !error, detail: error?.message ?? 'Inserted OK' });
  } catch (e: any) {
    steg.push({ step: 'Twitch-agent: INSERT ai_agent_events', ok: false, detail: e.message });
  }

  // ── Steg 3: upsertMemory oppretter én memory ──────────────────────────────
  try {
    const { upsertMemory } = await import('@/lib/ai/creatorContext');
    await upsertMemory({
      agent_type: 'twitch',
      memory_type: 'viewer',
      key: testKey,
      summary: 'Test-seer – automatisk slettet etter verifikasjon',
      confidence_score: 0.9,
      metadata: { test: true },
    });
    steg.push({ step: 'upsertMemory: opprettet viewer-minne', ok: true, detail: `key=${testKey}` });
  } catch (e: any) {
    steg.push({ step: 'upsertMemory: opprettet viewer-minne', ok: false, detail: e.message });
  }

  // ── Steg 4: getCreatorContext henter memory tilbake ───────────────────────
  let contextOk = false;
  try {
    const { getCreatorContext } = await import('@/lib/ai/creatorContext');
    const ctx = await getCreatorContext({ limit: 100 });
    const funnet = ctx.topViewers.find(v => v.key === testKey);
    contextOk = !!funnet;
    steg.push({
      step: 'getCreatorContext: fant memory tilbake',
      ok: contextOk,
      detail: funnet ? `Funnet: ${funnet.summary}` : `Ikke funnet blant ${ctx.topViewers.length} seere`,
      data: { streamCount: ctx.streamCount, viewers: ctx.topViewers.length, jokes: ctx.runningJokes.length, gamePatterns: ctx.gamePatterns.length },
    });
  } catch (e: any) {
    steg.push({ step: 'getCreatorContext: fant memory tilbake', ok: false, detail: e.message });
  }

  // ── Steg 5: Legg til en test-innsikt ──────────────────────────────────────
  try {
    const { addInsight } = await import('@/lib/ai/creatorContext');
    await addInsight({
      title: 'Test-innsikt',
      summary: 'Automatisk verifisering viste at Global AI Memory fungerer ende-til-ende.',
      confidence_score: 1.0,
      source_data: { test: true, ts: new Date().toISOString() },
    });
    steg.push({ step: 'addInsight: opprettet test-innsikt', ok: true });
  } catch (e: any) {
    steg.push({ step: 'addInsight: opprettet test-innsikt', ok: false, detail: e.message });
  }

  // ── Steg 6: Rydd opp test-data ────────────────────────────────────────────
  try {
    await (db as any).from('ai_agent_memory').delete()
      .eq('workspace_id', workspaceId).eq('key', testKey);
    await (db as any).from('ai_agent_events').delete()
      .eq('workspace_id', workspaceId).eq('event_type', 'test_raid');
    await (db as any).from('ai_agent_insights').delete()
      .eq('workspace_id', workspaceId).eq('title', 'Test-innsikt');
    steg.push({ step: 'Opprydding: slettet test-data', ok: true });
  } catch (e: any) {
    steg.push({ step: 'Opprydding: slettet test-data', ok: false, detail: e.message });
  }

  const altOk = steg.every(s => s.ok);

  return NextResponse.json({
    ok: altOk,
    melding: altOk
      ? '✓ Alt fungerer. Global AI Memory er klar til bruk.'
      : '⚠ Noen steg feilet – se detaljer under.',
    steg,
    ts: new Date().toISOString(),
  });
}
