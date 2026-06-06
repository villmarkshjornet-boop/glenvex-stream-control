import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import OpenAI from 'openai';
import { lagreStreamMemory, oppdaterContentPatterns } from './streamMemory';
import { oppdaterKnowledge, hentStreamMemory, hentContentPatterns } from './knowledgeBase';

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

Returner KUN JSON:
{
  "sammendrag": "...",
  "innholdsFunn": "...",
  "spillKunnskap": "...",
  "communitySignaler": ["...", "..."]
}`,
        },
      ],
      max_tokens: 700,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const rawContent = res.choices[0]?.message?.content ?? '{}';
    let analyse: any = {};
    try { analyse = JSON.parse(rawContent); } catch { /* ignore */ }

    const topCategories = Array.from(new Set(highlights.map((h: any) => h.category as string)));
    await lagreStreamMemory(vodId, {
      streamTitle: vod?.title,
      game: vod?.category,
      durationSeconds: vod?.duration_seconds,
      highlightsCount: highlights.length,
      topCategories,
      summary: analyse.sammendrag,
    });

    const nyStreamCount = tidligereAntall + 1;

    if (analyse.spillKunnskap && vod?.category) {
      await oppdaterKnowledge(
        'game_context',
        `${vod.category}: ${analyse.spillKunnskap}`,
        nyStreamCount
      );
    }

    if (analyse.innholdsFunn) {
      await oppdaterKnowledge(
        'content_strategy',
        `Basert på ${nyStreamCount} streams: ${analyse.innholdsFunn}`,
        nyStreamCount
      );
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

    if (analyse.communitySignaler?.length > 0) {
      for (const signal of (analyse.communitySignaler as string[]).slice(0, 3)) {
        if (signal && signal.length > 3) {
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
        }
      }
    }

    console.log(
      `[LearningLoop] ✓ ${vodId} – kunnskap oppdatert (${nyStreamCount} streams i minnet)`
    );
  } catch (err: any) {
    console.error('[LearningLoop] Feil:', err.message?.slice(0, 200));
  }
}
