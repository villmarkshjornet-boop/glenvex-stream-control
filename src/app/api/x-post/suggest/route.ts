/**
 * POST /api/x-post/suggest
 *
 * Generates 3 X/Twitter post variants using GPT + learning from past performance.
 * Caches results for 30 min — won't regenerate if a fresh suggestion exists.
 *
 * Body: { game?, title?, viewer_count?, elapsed_min?, twitch_login? }
 * Returns: { variants: XPostVariant[], recommended: number, recommendationReason: string, fromCache?: true }
 */
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { logSystemEvent } from '@/lib/systemEvents';

export const dynamic = 'force-dynamic';

interface SuggestBody {
  game?:         string;
  title?:        string;
  viewer_count?: number;
  elapsed_min?:  number;
  twitch_login?: string;
}

export interface XPostVariant {
  id:                   string;
  label:                'aggressive' | 'drama' | 'community';
  text:                 string;
  hashtags:             string[];
  hookScore:            number;
  urgencyScore:         number;
  relevanceScore:       number;
  expectedViewerLift:   number;
  aiReason:             string;
}

// ── Hashtag intelligence ──────────────────────────────────────────────────────

const GAME_HASHTAG_MAP: [string, string[]][] = [
  ['escape from tarkov', ['#Tarkov', '#EscapeFromTarkov']],
  ['tarkov',             ['#Tarkov', '#EFT']],
  ['minecraft',          ['#Minecraft']],
  ['gta v',              ['#GTAV', '#GrandTheftAuto']],
  ['gta',                ['#GrandTheftAuto']],
  ['valorant',           ['#VALORANT']],
  ['counter-strike 2',   ['#CS2', '#CounterStrike']],
  ['cs2',                ['#CS2']],
  ['csgo',               ['#CSGO']],
  ['fortnite',           ['#Fortnite']],
  ['league of legends',  ['#LoL', '#LeagueOfLegends']],
  ['apex legends',       ['#ApexLegends', '#Apex']],
  ['overwatch',          ['#Overwatch2']],
  ['call of duty',       ['#CallOfDuty', '#COD']],
  ['cyberpunk',          ['#Cyberpunk2077']],
  ['elden ring',         ['#EldenRing']],
  ['dark souls',         ['#DarkSouls']],
  ['world of warcraft',  ['#WoW', '#WorldOfWarcraft']],
  ['rust',               ['#RustGame']],
  ['pubg',               ['#PUBG']],
  ['dota',               ['#Dota2']],
  ['hearthstone',        ['#Hearthstone']],
  ['fifa',               ['#FIFA']],
  ['rocket league',      ['#RocketLeague']],
  ['the forest',         ['#TheForest']],
  ['sons of the forest', ['#SonsOfTheForest']],
  ['the finals',         ['#TheFinals']],
  ['lethal company',     ['#LethalCompany']],
  ['palworld',           ['#Palworld']],
  ['helldivers',         ['#Helldivers2']],
];

// Norwegian gaming community hashtags — consistently active on X
const BASE_HASHTAGS = ['#NorskGaming', '#Twitch', '#TwitchNO'];

function getHashtags(game: string): string[] {
  const g = game.toLowerCase();
  for (const [key, tags] of GAME_HASHTAG_MAP) {
    if (g.includes(key) || key.includes(g.split(' ')[0])) {
      return [...tags, ...BASE_HASHTAGS].slice(0, 5);
    }
  }
  const slug = game.replace(/[^a-zA-ZæøåÆØÅ0-9]/g, '').slice(0, 20);
  const fallback = slug.length > 1 ? `#${slug}` : '#Gaming';
  return [fallback, '#StreamNO', ...BASE_HASHTAGS].slice(0, 4);
}

// Ensure hashtags end up IN the text — safety net if AI forgets
function ensureHashtagsInText(text: string, hashtags: string[]): string {
  if (!hashtags.length) return text;
  const hasAny = hashtags.some(h => text.includes(h));
  if (hasAny) return text;
  // Append missing hashtags on a new line
  return `${text.trimEnd()}\n${hashtags.join(' ')}`;
}

// ── Learning context from past X posts ────────────────────────────────────────

async function getLearningContext(db: ReturnType<typeof getDb>, ws: string): Promise<string> {
  if (!db) return '(ingen historikk)';
  try {
    const { data } = await db
      .from('x_post_memory')
      .select('post_text,hashtags,variant_label,viewer_delta_10min,viewer_delta_5min,stream_elapsed_min,game,hook_score,created_at')
      .eq('workspace_id', ws)
      .eq('status', 'posted')
      .not('posted_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!data || data.length === 0) return '(ingen tidligere X-poster med resultater ennå)';

    const withPerf = data.filter(p => p.viewer_delta_10min !== null);
    if (withPerf.length === 0) {
      return `${data.length} poster sendt, men 10-minutters data ikke tilgjengelig ennå.`;
    }

    const sorted = [...withPerf].sort((a, b) => (b.viewer_delta_10min ?? 0) - (a.viewer_delta_10min ?? 0));
    const best   = sorted.slice(0, 5);
    const worst  = sorted.slice(-3);

    const avgDelta = Math.round(withPerf.reduce((s, p) => s + (p.viewer_delta_10min ?? 0), 0) / withPerf.length);

    const bestLines = best
      .map(p => `+${p.viewer_delta_10min ?? 0} seere | "${p.post_text.slice(0, 90).replace(/\n/g, ' ')}" [${(p.hashtags ?? []).join(' ')}]`)
      .join('\n');
    const worstLines = worst
      .filter(p => (p.viewer_delta_10min ?? 0) <= 0)
      .map(p => `${p.viewer_delta_10min ?? 0} seere | "${p.post_text.slice(0, 60).replace(/\n/g, ' ')}..."`)
      .join('\n') || '(ingen negative resultater)';

    return [
      `=== LÆRDOMSDATABASE (${withPerf.length} poster analysert, snitt: ${avgDelta >= 0 ? '+' : ''}${avgDelta} seere) ===`,
      '',
      'BESTE POSTER (etter viewer-løft 10 min):',
      bestLines,
      '',
      'SVAKESTE POSTER:',
      worstLines,
    ].join('\n');
  } catch {
    return '(feil ved henting av historikk)';
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB utilgjengelig' }, { status: 503 });

  const ws = getWorkspaceId();

  let body: SuggestBody;
  try { body = await req.json() as SuggestBody; }
  catch { body = {}; }

  const {
    game         = '',
    title        = '',
    viewer_count = 0,
    elapsed_min  = 0,
    twitch_login = '',
  } = body;

  // ── Return cached suggestion if recent (< 30 min) ─────────────────────────
  const recentCutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: cachedRows } = await db
    .from('x_post_memory')
    .select('id,variant_label,post_text,hashtags,hook_score,urgency_score,relevance_score,expected_viewer_lift,ai_recommendation')
    .eq('workspace_id', ws)
    .eq('status', 'suggested')
    .gte('created_at', recentCutoff)
    .in('variant_label', ['aggressive', 'drama', 'community'])
    .order('created_at', { ascending: false })
    .limit(9);

  const byLabel: Record<string, any> = {};
  for (const r of (cachedRows ?? [])) {
    if (r.variant_label && !byLabel[r.variant_label]) byLabel[r.variant_label] = r;
  }
  const cachedVariants = Object.values(byLabel);

  if (cachedVariants.length >= 2) {
    const cachedHashtags = getHashtags(game);
    const variants: XPostVariant[] = cachedVariants.map((r: any) => ({
      id:                 r.id,
      label:              r.variant_label,
      text:               ensureHashtagsInText(r.post_text ?? '', r.hashtags?.length ? r.hashtags : cachedHashtags),
      hashtags:           r.hashtags?.length ? r.hashtags : cachedHashtags,
      hookScore:          r.hook_score ?? 50,
      urgencyScore:       r.urgency_score ?? 50,
      relevanceScore:     r.relevance_score ?? 50,
      expectedViewerLift: r.expected_viewer_lift ?? 1,
      aiReason:           r.ai_recommendation ?? '',
    }));
    return NextResponse.json({ variants, recommended: 0, recommendationReason: variants[0]?.aiReason ?? '', fromCache: true });
  }

  // ── Generate new variants ─────────────────────────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'OpenAI API-nøkkel mangler' }, { status: 503 });

  const [learningCtx, hashtags] = await Promise.all([
    getLearningContext(db, ws),
    Promise.resolve(getHashtags(game)),
  ]);

  const twitchUrl = twitch_login
    ? `twitch.tv/${twitch_login}`
    : process.env.TWITCH_URL ?? 'twitch.tv/glenvex';

  const systemPrompt = `Du er en X/Twitter markedsføringsekspert for en norsk Twitch-streamer.
Du lager korte, slagkraftige X-poster som gir reelle seere til livestream — ikke bare engagement.

MÅL: Få folk som IKKE følger med akkurat nå til å klikke seg inn på Twitch.

REGLER:
1. Første linje = kroken. Aldri start med "Jeg er live" eller "Streamer nå".
2. Gi én konkret grunn til å klikke NÅ (drama, spenning, fellesskap, spørsmål).
3. Twitch-lenken alltid på slutten.
4. ALLTID inkluder 3–5 hashtags direkte i "text"-feltet — de MÅ stå i selve post-teksten (ikke bare i "hashtags"-arrayen). Bruk de foreslåtte hashtagsene. Hashtags på slutten av posten er standard, men kan flytes inn i teksten om det sitter naturlig.
5. Norsk tone — men spill-spesifikke ord kan være engelske.
6. Maks 280 tegn per post (inkludert hashtags).
7. Lær av hva som har fungert tidligere — se LÆRDOMSDATABASEN.

KRITISK: "text"-feltet MÅ inneholde hashtagsene. En post uten # teller ikke.

SVAR KUN med valid JSON.`;

  const userPrompt = `SITUASJON:
Streamer: ${twitchUrl}
Spill: ${game || 'ukjent'}
Tittel: ${title || 'ingen tittel'}
Seere nå: ${viewer_count}
Stream-tid: ${elapsed_min} min
Foreslåtte hashtags: ${hashtags.join(' ')}

${learningCtx}

Lag 3 distinkte X-poster:
- "aggressive": hype, FOMO, energi — "dette skjer nå og du går glipp av det"
- "drama": fortell noe spennende/rart/intenst som nettopp skjedde eller holder på
- "community": norsk tone, avslappet, inviterende — "kom og heng"

Format:
{
  "variants": [
    {
      "label": "aggressive",
      "text": "...selve post-teksten med hashtags integrert eller på slutten...",
      "hashtags": ["#tag1", "#tag2"],
      "hookScore": 85,
      "urgencyScore": 90,
      "relevanceScore": 75,
      "expectedViewerLift": 3,
      "aiReason": "Denne varianten anbefales fordi..."
    }
  ],
  "recommended": 0,
  "recommendationReason": "Variant 1 anbefales fordi..."
}`;

  try {
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1000,
      temperature: 0.7,
    });

    const raw    = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as {
      variants: Array<{
        label: string; text: string; hashtags: string[];
        hookScore: number; urgencyScore: number; relevanceScore: number;
        expectedViewerLift: number; aiReason: string;
      }>;
      recommended: number;
      recommendationReason: string;
    };

    const variants = (parsed.variants ?? []).slice(0, 3);
    if (variants.length === 0) throw new Error('GPT returnerte ingen varianter');

    // Store each variant in DB
    const stored: XPostVariant[] = [];
    for (const v of variants) {
      // Safety net: ensure hashtags appear in the text even if AI forgot to include them
      const textWithHashtags = ensureHashtagsInText(v.text ?? '', v.hashtags ?? hashtags);

      const { data: row } = await db.from('x_post_memory').insert({
        workspace_id:         ws,
        game:                 game || null,
        post_text:            textWithHashtags,
        hashtags:             v.hashtags ?? [],
        variant_label:        v.label,
        hook_score:           v.hookScore,
        urgency_score:        v.urgencyScore,
        relevance_score:      v.relevanceScore,
        expected_viewer_lift: v.expectedViewerLift,
        ai_recommendation:    v.aiReason,
        learning_context:     learningCtx.slice(0, 800),
        stream_elapsed_min:   elapsed_min,
        viewer_count_before:  viewer_count,
        status:               'suggested',
        source:               'ai_producer_x_post',
      }).select('id').single();

      stored.push({
        id:                 row?.id ?? crypto.randomUUID(),
        label:              v.label as XPostVariant['label'],
        text:               textWithHashtags,
        hashtags:           v.hashtags ?? hashtags,
        hookScore:          v.hookScore,
        urgencyScore:       v.urgencyScore,
        relevanceScore:     v.relevanceScore,
        expectedViewerLift: v.expectedViewerLift,
        aiReason:           v.aiReason,
      });
    }

    await logSystemEvent({
      source: 'x_post_agent', event_type: 'X_POST_SUGGESTED',
      title: `X-poster generert: ${stored.length} varianter for ${game || 'stream'} (${elapsed_min} min inn)`,
      severity: 'info',
      metadata: {
        game, viewer_count, elapsed_min,
        learningUsed: learningCtx.includes('ingen') ? false : true,
        recommended: parsed.recommended ?? 0,
        variantLabels: stored.map(v => v.label),
      },
    });

    return NextResponse.json({
      variants:             stored,
      recommended:          parsed.recommended ?? 0,
      recommendationReason: parsed.recommendationReason ?? stored[0]?.aiReason ?? '',
    });

  } catch (err: any) {
    return NextResponse.json({ error: `Generering feilet: ${err.message?.slice(0, 120)}` }, { status: 500 });
  }
}
