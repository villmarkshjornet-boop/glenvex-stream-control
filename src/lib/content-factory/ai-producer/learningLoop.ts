import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import OpenAI from 'openai';
import { lagreStreamMemory, oppdaterContentPatterns } from './streamMemory';
import { oppdaterKnowledge, hentStreamMemory, hentContentPatterns } from './knowledgeBase';
import { upsertMemory, addInsight } from '@/lib/ai/creatorContext';
import { logAgentDecision } from '@/lib/ai/eventLogger';

export async function kjørLearningLoop(vodId: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return;

  const workspaceId = getWorkspaceId();

  const { data: highlights } = await db
    .from('content_highlights')
    .select('*')
    .eq('vod_id', vodId)
    .order('score', { ascending: false })
    .limit(10);

  if (!highlights || highlights.length === 0) return;

  const { data: vod } = await db
    .from('content_vods')
    .select('*')
    .eq('id', vodId)
    .single();

  await oppdaterContentPatterns(
    highlights.map((h: any) => ({
      category: h.category ?? 'GENERAL',
      score: parseInt(h.score) || 0,
    }))
  );

  const { data: transcripts } = await db
    .from('content_transcripts')
    .select('text')
    .eq('vod_id', vodId)
    .order('start_time', { ascending: true })
    .limit(60);

  const transcriptUtdrag = (transcripts ?? [])
    .map((t: any) => t.text)
    .join(' ')
    .slice(0, 3000);

  const tidligereMinner = await hentStreamMemory(10);
  const contentPatterns = await hentContentPatterns();
  const tidligereAntall = tidligereMinner.length;

  try {
    const openai = new OpenAI({ apiKey });

    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: `Du er AI Producer for GLENVEX, en norsk streaming-kanal. Analyser denne streamen og bygg kanalens kunnskap.

STREAM INFO:
- Tittel: ${vod?.title ?? 'Ukjent'}
- Spill: ${vod?.category ?? 'Ukjent'}
- Highlights funnet: ${highlights.length}

BESTE HIGHLIGHTS:
${highlights
  .slice(0, 5)
  .map(
    (h: any, i: number) =>
      `${i + 1}. [${h.category}] "${h.title}" (Score: ${h.score}) – ${h.begrunnelse ?? ''}`
  )
  .join('\n')}

TRANSKRIPSJON-UTDRAG:
"${transcriptUtdrag}"

HISTORIKK (${tidligereAntall} tidligere streams analysert):
${contentPatterns
  .slice(0, 6)
  .map((p: any) => `- ${p.category}: snitt-score ${p.avg_score} (${p.occurrence_count} ganger)`)
  .join('\n')}

Gi meg analyse til bruk i NESTE stream:
1. Kort sammendrag av streamen (1-2 setninger på norsk)
2. Hva slags innhold fungerte best og hvorfor
3. Hva AI Producer bør prioritere neste gang det spilles ${vod?.category ?? 'dette spillet'}
4. Community-signaler: gjentagende fraser, potensielle inside jokes, særegenheter
5. Én konkret innsikt med tittel og sammendrag

Returner KUN JSON:
{
  "sammendrag": "...",
  "innholdsFunn": "...",
  "spillKunnskap": "...",
  "communitySignaler": ["...", "..."],
  "innsikt": {"tittel": "...", "sammendrag": "...", "confidence": 0.8}
}`,
        },
      ],
      max_tokens: 800,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const rawContent = res.choices[0]?.message?.content ?? '{}';
    let analyse: any = {};
    try { analyse = JSON.parse(rawContent); } catch { /* ignore */ }

    const nyStreamCount = tidligereAntall + 1;

    // ── Skriv til gamle tabeller (backwards compat) ───────────────────────────
    const topCategories = Array.from(new Set(highlights.map((h: any) => h.category as string)));
    await lagreStreamMemory(vodId, {
      streamTitle: vod?.title,
      game: vod?.category,
      durationSeconds: vod?.duration_seconds,
      highlightsCount: highlights.length,
      topCategories,
      summary: analyse.sammendrag,
    });

    if (analyse.spillKunnskap && vod?.category) {
      await oppdaterKnowledge('game_context', `${vod.category}: ${analyse.spillKunnskap}`, nyStreamCount);
    }

    if (analyse.innholdsFunn) {
      await oppdaterKnowledge('content_strategy', `Basert på ${nyStreamCount} streams: ${analyse.innholdsFunn}`, nyStreamCount);
    }

    if (nyStreamCount >= 2 && contentPatterns.length > 0) {
      const toppKat = contentPatterns
        .sort((a: any, b: any) => b.avg_score - a.avg_score)
        .slice(0, 3)
        .map((p: any) => `${p.category} (snitt ${p.avg_score})`)
        .join(', ');
      await oppdaterKnowledge(
        'channel_profile',
        `GLENVEX – norsk gaming streamer. ${nyStreamCount} streams analysert. Beste highlight-typer: ${toppKat}. Aktive spill: ${vod?.category ?? 'ulike'}.`,
        nyStreamCount
      );
    }

    // ── Skriv til Global AI Memory (nye tabeller) ─────────────────────────────

    // Stream-mønster: én entry per stream i global memory
    await upsertMemory({
      agent_type: 'content',
      memory_type: 'stream_pattern',
      key: vodId,
      summary: `${vod?.title ?? 'Stream'} (${vod?.category ?? 'ukjent'}): ${analyse.sammendrag ?? ''}`,
      confidence_score: 0.8,
      metadata: { highlights: highlights.length, topCategories, vodId, game: vod?.category },
    });

    // Spillkunnskap
    if (analyse.spillKunnskap && vod?.category) {
      await upsertMemory({
        agent_type: 'content',
        memory_type: 'game_pattern',
        key: (vod.category as string).toLowerCase().replace(/\s+/g, '_'),
        summary: `${vod.category}: ${analyse.spillKunnskap}`,
        confidence_score: 0.75,
        metadata: { game: vod.category, streamCount: nyStreamCount },
      });
    }

    // Innholdsstrategi
    if (analyse.innholdsFunn) {
      await upsertMemory({
        agent_type: 'content',
        memory_type: 'content_pattern',
        key: 'content_strategy',
        summary: `Basert på ${nyStreamCount} streams: ${analyse.innholdsFunn}`,
        confidence_score: 0.8,
        metadata: { streamCount: nyStreamCount },
      });
    }

    // Kanalprofil
    if (nyStreamCount >= 2 && contentPatterns.length > 0) {
      const toppKat = contentPatterns
        .sort((a: any, b: any) => b.avg_score - a.avg_score)
        .slice(0, 3)
        .map((p: any) => `${p.category} (snitt ${p.avg_score})`)
        .join(', ');
      await upsertMemory({
        agent_type: 'global',
        memory_type: 'stream_pattern',
        key: 'channel_profile',
        summary: `GLENVEX – norsk gaming streamer. ${nyStreamCount} streams analysert. Beste highlight-typer: ${toppKat}.`,
        confidence_score: 0.9,
        metadata: { streamCount: nyStreamCount },
      });
    }

    // Community-signaler
    if (analyse.communitySignaler?.length > 0) {
      for (const signal of (analyse.communitySignaler as string[]).slice(0, 3)) {
        if (signal && signal.length > 3) {
          // Gammel tabell
          await db.from('ai_producer_community_memory').upsert(
            {
              workspace_id: workspaceId,
              entry_type: 'community_signal',
              name: signal.slice(0, 100),
              description: `Fra stream: ${vod?.title ?? vodId}`,
              occurrence_count: 1,
              first_seen_vod_id: vodId,
              last_seen_vod_id: vodId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'workspace_id,entry_type,name', ignoreDuplicates: true }
          );
          // Ny tabell
          await upsertMemory({
            agent_type: 'content',
            memory_type: 'topic',
            key: signal.toLowerCase().slice(0, 80),
            summary: signal,
            confidence_score: 0.6,
            metadata: { source: 'learning_loop', vodId },
          });
        }
      }
    }

    // Ny innsikt til ai_agent_insights
    if (analyse.innsikt?.tittel && analyse.innsikt?.sammendrag) {
      await addInsight({
        title: analyse.innsikt.tittel,
        summary: analyse.innsikt.sammendrag,
        confidence_score: analyse.innsikt.confidence ?? 0.7,
        source_data: { vodId, game: vod?.category, streamCount: nyStreamCount },
      });
    }

    // Beslutningslogg
    await logAgentDecision({
      agent_type: 'content_factory',
      decision_type: 'learning_loop',
      input_context: { vodId, highlightCount: highlights.length, game: vod?.category },
      decision_summary: `Analyserte stream ${vod?.title ?? vodId}: ${highlights.length} highlights, ${(analyse.communitySignaler ?? []).length} community-signaler`,
      outcome: 'success',
    });

    console.log(
      `[LearningLoop] ✓ ${vodId} – global memory oppdatert (${nyStreamCount} streams i minnet)`
    );
  } catch (err: any) {
    console.error('[LearningLoop] Feil:', err.message?.slice(0, 200));
  }
}
