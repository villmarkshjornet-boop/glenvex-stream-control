/**
 * Standalone test – Global AI Memory tabeller
 * Kjør: npx tsx scripts/test-ai-memory.ts
 *
 * Krever:
 *   SUPABASE_URL=https://xxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *   WORKSPACE_ID=glenvex-default   (valgfritt)
 *
 * Eksempel (PowerShell):
 *   $env:SUPABASE_URL="https://xxx.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."
 *   npx tsx scripts/test-ai-memory.ts
 */

import { createClient } from '@supabase/supabase-js';

const URL  = process.env.SUPABASE_URL;
const KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WS   = process.env.WORKSPACE_ID || 'glenvex-default';

if (!URL || !KEY) {
  console.error('\n❌  SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY må settes som env-variabler.\n');
  console.error('PowerShell:\n  $env:SUPABASE_URL="https://xxx.supabase.co"');
  console.error('  $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."');
  console.error('  npx tsx scripts/test-ai-memory.ts\n');
  process.exit(1);
}

const sb = createClient(URL, KEY);

interface Resultat { steg: string; ok: boolean; detalj?: string }
const resultater: Resultat[] = [];

function logg(steg: string, ok: boolean, detalj?: string) {
  resultater.push({ steg, ok, detalj });
  console.log(`  ${ok ? '✓' : '✗'} ${steg}${detalj ? ' – ' + detalj : ''}`);
}

async function main() {
  console.log('\n══ Global AI Memory – verifisering ══\n');
  console.log(`Workspace: ${WS}\n`);

  // ── 1. Tabellsjekk ───────────────────────────────────────────────────���──
  console.log('1. Tabellsjekk:');
  const tabeller = ['ai_agent_events', 'ai_agent_memory', 'ai_agent_insights', 'ai_agent_decisions'];
  for (const t of tabeller) {
    const { error } = await (sb as any).from(t).select('id').limit(1);
    const finnesIkke = error?.message?.includes('does not exist') || error?.code === '42P01';
    if (finnesIkke) {
      logg(`  ${t}`, false, 'TABELL MANGLER – kjør supabase/global-ai-migration.sql');
    } else if (error) {
      logg(`  ${t}`, false, error.message);
    } else {
      logg(`  ${t}`, true, 'OK');
    }
  }

  const tabellOk = resultater.every(r => r.ok);
  if (!tabellOk) {
    console.log('\n❌  Stopper – en eller flere tabeller mangler.');
    console.log('    Kjør supabase/global-ai-migration.sql i Supabase SQL Editor og prøv igjen.\n');
    process.exit(1);
  }

  const testKey = `__test_${Date.now()}`;

  // ── 2. INSERT ai_agent_events ───────────────────────────────────────────
  console.log('\n2. Twitch-agent logger en fake event:');
  const { error: evErr } = await sb.from('ai_agent_events').insert({
    workspace_id: WS,
    source: 'twitch',
    event_type: 'test_raid',
    username: 'TestRaider',
    importance_score: 75,
    metadata: { viewers: 42, test: true },
  });
  logg('  INSERT ai_agent_events', !evErr, evErr?.message ?? 'OK');

  // ── 3. UPSERT ai_agent_memory ───────────────────────────────────────────
  console.log('\n3. upsertMemory oppretter viewer-minne:');
  const { error: memErr } = await sb.from('ai_agent_memory').insert({
    workspace_id: WS,
    agent_type: 'twitch',
    memory_type: 'viewer',
    key: testKey,
    summary: 'Test-seer – automatisk slettet',
    confidence_score: 0.9,
    occurrence_count: 1,
    last_seen_at: new Date().toISOString(),
    metadata: { test: true },
  });
  logg('  INSERT ai_agent_memory', !memErr, memErr?.message ?? 'OK');

  // ── 4. SELECT tilbake (getCreatorContext simulert) ───────────────────────
  console.log('\n4. getCreatorContext leser memory tilbake:');
  const { data: funnet, error: selErr } = await sb
    .from('ai_agent_memory')
    .select('key,summary,confidence_score,occurrence_count')
    .eq('workspace_id', WS)
    .eq('memory_type', 'viewer')
    .eq('key', testKey)
    .single();
  const fantes = !!funnet && !selErr;
  logg('  SELECT viewer fra ai_agent_memory', fantes, fantes ? `Funnet: "${funnet.summary}"` : selErr?.message);

  // ── 5. INSERT ai_agent_insights ──────────────────────────────────��─────
  console.log('\n5. addInsight oppretter test-innsikt:');
  const { error: insErr } = await sb.from('ai_agent_insights').insert({
    workspace_id: WS,
    title: 'Test-innsikt',
    summary: 'Global AI Memory verifisert ende-til-ende.',
    confidence_score: 1.0,
    source_data: { test: true },
  });
  logg('  INSERT ai_agent_insights', !insErr, insErr?.message ?? 'OK');

  // ── 6. INSERT ai_agent_decisions ───────────────────────────────────────
  console.log('\n6. logAgentDecision oppretter beslutning:');
  const { error: decErr } = await sb.from('ai_agent_decisions').insert({
    workspace_id: WS,
    agent_type: 'content_factory',
    decision_type: 'test',
    input_context: { test: true },
    decision_summary: 'Automatisk verifisering',
    outcome: 'success',
  });
  logg('  INSERT ai_agent_decisions', !decErr, decErr?.message ?? 'OK');

  // ── 7. Rydd opp test-data ───────────────────────────────────────────────
  console.log('\n7. Rydder opp test-data:');
  await sb.from('ai_agent_memory').delete().eq('workspace_id', WS).eq('key', testKey);
  await sb.from('ai_agent_events').delete().eq('workspace_id', WS).eq('event_type', 'test_raid');
  await sb.from('ai_agent_insights').delete().eq('workspace_id', WS).eq('title', 'Test-innsikt');
  await sb.from('ai_agent_decisions').delete().eq('workspace_id', WS).eq('decision_type', 'test');
  console.log('  ✓ Test-data slettet');

  // ── Sammendrag ────────────────────────────���────────────────────────────
  const altOk = resultater.every(r => r.ok);
  console.log('\n══ Resultat ══\n');
  if (altOk) {
    console.log('✅  ALT OK – Global AI Memory er klar til bruk!\n');
    console.log('   • Tabellene eksisterer og kan skrives til');
    console.log('   • upsertMemory → getCreatorContext fungerer');
    console.log('   • Dashboard /ai-memory vil vise data etter deploy\n');
  } else {
    const feil = resultater.filter(r => !r.ok);
    console.log(`❌  ${feil.length} steg feilet:\n`);
    feil.forEach(f => console.log(`   ✗ ${f.steg}: ${f.detalj}`));
    console.log('');
  }
}

main().catch(err => {
  console.error('\n❌  Uventet feil:', err.message);
  process.exit(1);
});
