/**
 * Gemini Director — single multimodal call that returns full thumbnail strategy.
 * Replaces the 3-step GPT pipeline (hook discovery + vision scoring + CTR gate)
 * with one Gemini call that understands WHY a moment is interesting.
 */

import { logSystemEvent } from './systemEvents';

export interface ThumbnailStrategy {
  summary: string;
  hook: string;
  emotion: 'shock' | 'curiosity' | 'rage' | 'triumph' | 'fear' | 'joy';
  conflict: string;
  curiosity: string;
  headlines: string[];        // 10 distinct headline options
  headline: string;           // best pick — 2-4 words, CAPS
  subheadline: string;        // badge text — 3-6 words, CAPS
  thumbnailType: 'reaction' | 'action' | 'text-shock' | 'before-after';
  focusObject: string;
  focusPerson: string;
  focusTimestamp: number;     // seconds into clip
  arrowRequired: boolean;
  arrowTarget: string;
  ctrScore: number;           // Gemini's estimated CTR score 0-100
  explanation: string;
}

export interface GeminiContext {
  highlight: { title: string; category: string; begrunnelse?: string };
  vod: { title?: string; category?: string } | null;
  frameCount: number;
  frameTimestamps: number[];
  model: string;
  durationSeconds: number;
}

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function buildFallbackStrategy(
  highlight: { title: string; category: string },
  durationSeconds: number
): ThumbnailStrategy {
  const cat = highlight.category ?? '';
  const headlinesByCategory: Record<string, string[]> = {
    RAGE:        ['HAN MISTET DET', 'NEI NEI NEI', 'ALDRI MER', 'DET SKJEDDE IKKE', 'JEG KAN IKKE'],
    FUNNY:       ['DETTE VAR SYKT', 'JEG KØDDER', 'IKKE MULIG', 'HVEM GJØR DETTE', 'JEG TROR IKKE DET'],
    FAIL:        ['DET GIKK GALT', 'ALT FORSVANT', 'VERSTE ØYEBLIKK', 'JEG SKAMMER MEG', 'NEI NEI NEI'],
    CLUTCH:      ['UMULIG REDNING', 'DET SKJEDDE IKKE', 'ALDRI GJORT FØR', 'DETTE ER GALT', 'DU MÅ SE DETTE'],
    RP_MOMENT:   ['IKKE MULIG', 'HVA SKJEDDE BARE', 'JEG TROR IKKE DET', 'DET ER IKKE REELT', 'SJEKK DETTE'],
    EDUCATIONAL: ['DET VISSTE DU IKKE', 'HEMMELIG TRIKS', 'DETTE ENDRER ALT', 'SLIK GJØR DU DET', 'PRØV DETTE'],
    TACTICAL:    ['PERFEKT STRATEGI', 'SLIK VINNER MAN', 'DETTE FUNKER', 'SJEF TAKTIKK', 'INGEN SJANSE'],
  };
  const hList = headlinesByCategory[cat] ?? ['SJEKK DETTE', 'DU MÅ SE DETTE', 'IKKE MULIG', 'DETTE VAR SYKT', 'NEI NEI NEI'];

  return {
    summary: highlight.title ?? 'Ukjent klipp',
    hook: highlight.title ?? 'Et spennende øyeblikk',
    emotion: (cat === 'RAGE' ? 'rage' : cat === 'FUNNY' ? 'joy' : cat === 'FAIL' ? 'shock'
      : cat === 'CLUTCH' ? 'triumph' : 'curiosity') as any,
    conflict: '',
    curiosity: '',
    headlines: hList,
    headline: hList[0],
    subheadline: 'JEG TRODDE IKKE DETTE',
    thumbnailType: 'reaction',
    focusObject: '',
    focusPerson: '',
    focusTimestamp: durationSeconds * 0.5,
    arrowRequired: false,
    arrowTarget: '',
    ctrScore: 60,
    explanation: 'Fallback-strategi — Gemini kall feilet eller API-nøkkel mangler',
  };
}

function normalizeStrategy(
  raw: any,
  highlight: { title: string; category: string },
  durationSeconds: number
): ThumbnailStrategy {
  const validEmotions = ['shock', 'curiosity', 'rage', 'triumph', 'fear', 'joy'];
  const validTypes = ['reaction', 'action', 'text-shock', 'before-after'];

  let headlines: string[] = [];
  if (Array.isArray(raw.headlines) && raw.headlines.length >= 3) {
    headlines = raw.headlines.map((h: any) => String(h).toUpperCase().trim()).filter(Boolean);
  }
  if (headlines.length < 3) {
    const fallback = buildFallbackStrategy(highlight, durationSeconds);
    headlines = [...headlines, ...fallback.headlines].slice(0, 10);
  }

  const focusTs = typeof raw.focusTimestamp === 'number' && raw.focusTimestamp >= 0
    ? Math.min(raw.focusTimestamp, Math.max(0, durationSeconds - 0.5))
    : durationSeconds * 0.5;

  return {
    summary:        String(raw.summary ?? highlight.title).slice(0, 300),
    hook:           String(raw.hook ?? highlight.title).slice(0, 400),
    emotion:        validEmotions.includes(raw.emotion) ? raw.emotion : 'curiosity',
    conflict:       String(raw.conflict ?? '').slice(0, 300),
    curiosity:      String(raw.curiosity ?? '').slice(0, 300),
    headlines,
    headline:       String(raw.headline ?? headlines[0]).toUpperCase().trim().slice(0, 40),
    subheadline:    String(raw.subheadline ?? 'JEG TRODDE IKKE DETTE').toUpperCase().trim().slice(0, 60),
    thumbnailType:  validTypes.includes(raw.thumbnailType) ? raw.thumbnailType : 'reaction',
    focusObject:    String(raw.focusObject ?? '').slice(0, 100),
    focusPerson:    String(raw.focusPerson ?? '').slice(0, 100),
    focusTimestamp: focusTs,
    arrowRequired:  raw.arrowRequired === true,
    arrowTarget:    String(raw.arrowTarget ?? '').slice(0, 100),
    ctrScore:       typeof raw.ctrScore === 'number' ? Math.min(100, Math.max(0, raw.ctrScore)) : 60,
    explanation:    String(raw.explanation ?? '').slice(0, 400),
  };
}

function buildGeminiParts(
  frames: Array<{ buf: Buffer; t: number }>,
  highlight: { title: string; category: string; begrunnelse?: string; transcript?: string },
  vod: { title?: string; category?: string } | null
): any[] {
  const parts: any[] = [];

  parts.push({
    text: `Du er en YouTube thumbnail-direktør med ekspertise i norske gaming-kanaler.
Du ser ${frames.length} frames fra et gaming-klipp, sortert kronologisk med tidsstempler.

KLIPP:
- Tittel: ${highlight.title ?? 'Ukjent'}
- Kategori: ${highlight.category ?? 'Ukjent'}
- Spill: ${vod?.category ?? vod?.title ?? 'Ukjent'}${highlight.begrunnelse ? `\n- Hva skjedde: ${highlight.begrunnelse}` : ''}${highlight.transcript ? `\n- Transkript: ${highlight.transcript.slice(0, 600)}` : ''}

FRAMES (kronologisk med tidsstempler):`,
  });

  for (const f of frames) {
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: f.buf.toString('base64'),
      },
    });
    parts.push({ text: `[${f.t.toFixed(1)}s]` });
  }

  parts.push({
    text: `
Velg det BESTE øyeblikket for en thumbnail som gir høy CTR på YouTube mobile.

Svar KUN med gyldig JSON (ingen markdown, ingen forklaring utenfor JSON):
{
  "summary": "1 setning — hva skjer i klippet",
  "hook": "1 setning — kjernespenningen, hvorfor klikke",
  "emotion": "shock|curiosity|rage|triumph|fear|joy",
  "conflict": "1 setning — konflikten i øyeblikket",
  "curiosity": "1 setning — hva gjør seeren nysgjerrig",
  "headlines": ["HEADLINE 1", "HEADLINE 2", "HEADLINE 3", "HEADLINE 4", "HEADLINE 5", "HEADLINE 6", "HEADLINE 7", "HEADLINE 8", "HEADLINE 9", "HEADLINE 10"],
  "headline": "BESTE 2-4 ORD CAPS",
  "subheadline": "3-6 ORD CAPS BADGE",
  "thumbnailType": "reaction|action|text-shock|before-after",
  "focusObject": "hovedelementet å vise",
  "focusPerson": "hvem er i fokus (tom streng hvis ingen)",
  "focusTimestamp": <sekunder — velg NØYAKTIG tidspunkt for det dramatiske øyeblikket>,
  "arrowRequired": true|false,
  "arrowTarget": "hva pilen peker på (tom streng hvis false)",
  "ctrScore": <0-100>,
  "explanation": "1-2 setninger — hvorfor dette øyeblikket vinner"
}

REGLER:
- headlines: 10 ULIKE alternativer med varierende tone/emosjon/ordvalg
- headline: 2-4 ord, CAPS, emosjonell REAKSJON — IKKE beskrivelse av hva som skjer
- subheadline: 3-6 ord, CAPS, trigger nysgjerrighet
- focusTimestamp: bruk et av tidsstemplene du ser i frames
- arrowRequired: true KUN hvis subjektet er utydelig uten en pil`,
  });

  return parts;
}

export async function runGeminiDirector(
  frames: Array<{ buf: Buffer; t: number }>,
  highlight: { title: string; category: string; begrunnelse?: string; transcript?: string },
  vod: { title?: string; category?: string } | null,
  highlightId: string,
  durationSeconds: number
): Promise<{ strategy: ThumbnailStrategy; context: GeminiContext }> {
  const apiKey = process.env.GEMINI_API_KEY;

  const context: GeminiContext = {
    highlight: { title: highlight.title, category: highlight.category, begrunnelse: highlight.begrunnelse },
    vod,
    frameCount: frames.length,
    frameTimestamps: frames.map(f => parseFloat(f.t.toFixed(1))),
    model: GEMINI_MODEL,
    durationSeconds,
  };

  if (!apiKey) {
    logSystemEvent({
      source: 'thumbnail_worker',
      event_type: 'GEMINI_DIRECTOR_SKIPPED',
      title: `Gemini Director hoppet over — GEMINI_API_KEY mangler`,
      severity: 'warning',
      metadata: { highlightId },
    });
    return { strategy: buildFallbackStrategy(highlight, durationSeconds), context };
  }

  try {
    const parts = buildGeminiParts(frames, highlight, vod);

    const res = await fetch(
      `${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1500,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(90_000),
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 200)}`);
    }

    const json = await res.json() as any;
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) throw new Error('Tom respons fra Gemini');

    let raw: any;
    try {
      raw = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Ingen JSON i Gemini-respons');
      raw = JSON.parse(match[0]);
    }

    const strategy = normalizeStrategy(raw, highlight, durationSeconds);

    logSystemEvent({
      source: 'thumbnail_worker',
      event_type: 'GEMINI_DIRECTOR_DONE',
      title: `Gemini Director — "${strategy.headline}" — CTR ${strategy.ctrScore}/100 — t=${strategy.focusTimestamp.toFixed(1)}s`,
      severity: 'info',
      metadata: {
        highlightId,
        headline: strategy.headline,
        emotion: strategy.emotion,
        thumbnailType: strategy.thumbnailType,
        focusTimestamp: strategy.focusTimestamp,
        arrowRequired: strategy.arrowRequired,
        ctrScore: strategy.ctrScore,
        headlineCount: strategy.headlines.length,
      },
    });

    return { strategy, context };

  } catch (err: any) {
    logSystemEvent({
      source: 'thumbnail_worker',
      event_type: 'GEMINI_DIRECTOR_FAILED',
      title: `Gemini Director feilet: ${err.message?.slice(0, 100)} — bruker fallback-strategi`,
      severity: 'warning',
      metadata: { highlightId, error: err.message?.slice(0, 300) },
    });
    return { strategy: buildFallbackStrategy(highlight, durationSeconds), context };
  }
}
