import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/workspace';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

// ── GET: list drafts ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB ikke tilkoblet' }, { status: 500 });

  const wsId = getWorkspaceId();
  const status = req.nextUrl.searchParams.get('status') ?? 'draft';

  const { data, error } = await db
    .from('twitter_drafts')
    .select('id,partner_name,draft_text,hashtags,affiliate_url,status,ai_model,posted_at,posted_url,created_at,updated_at')
    .eq('workspace_id', wsId)
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ drafts: data ?? [] });
}

// ── POST: generate 3 A/B/C variants with AI ──────────────────────────────────
//
// Three different angles so the user can pick the best fit:
//   A — natural/personal: streamer's own voice, story-driven
//   B — curiosity/data:   hook + stat or specific detail, makes viewer want to know more
//   C — community:        audience-first framing, builds belonging
//
// If manualText provided: single draft, no AI, skip variant generation.

export async function POST(req: NextRequest) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB ikke tilkoblet' }, { status: 500 });

  const wsId = getWorkspaceId();
  const body = await req.json() as {
    partnerId?: string;
    partnerName: string;
    partnerDesc?: string;
    affiliateUrl?: string;
    discountCode?: string;
    promptHint?: string;
    manualText?: string;
  };

  if (!body.partnerName) {
    return NextResponse.json({ error: 'partnerName er påkrevd' }, { status: 400 });
  }

  const hashtags: string[] = ['#ad', '#partner'];

  // ── Manual draft (single, no AI) ──────────────────────────────────────────
  if (body.manualText) {
    const { data, error } = await db
      .from('twitter_drafts')
      .insert({
        workspace_id: wsId,
        partner_id: body.partnerId ?? null,
        partner_name: body.partnerName,
        draft_text: body.manualText.slice(0, 280),
        hashtags,
        affiliate_url: body.affiliateUrl ?? null,
        status: 'draft',
        ai_model: null,
        ai_prompt_hint: 'manual',
      })
      .select('id,partner_name,draft_text,hashtags,affiliate_url,status,ai_model,created_at')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, variant: 'manual', drafts: [data] });
  }

  // ── AI: generate 3 variants in parallel ──────────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY mangler for AI-generering' }, { status: 500 });
  }

  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey });

  const baseContext = [
    `Partner: ${body.partnerName}${body.partnerDesc ? ` – ${body.partnerDesc}` : ''}.`,
    body.affiliateUrl ? `Lenke: ${body.affiliateUrl}.` : '',
    body.discountCode ? `Rabattkode: ${body.discountCode}.` : '',
    body.promptHint   ? `Kontekst: ${body.promptHint}.` : '',
  ].filter(Boolean).join(' ');

  const VARIANTS = [
    {
      label: 'A',
      angle: 'natural',
      promptHint: `Skriv et norsk Twitter/X-innlegg (maks 230 tegn) i en naturlig, personlig tone — som om streameren snakker direkte til følgerne sine. Fortell en kort, ærlig setning om produktet. ${baseContext} Autentisk, ikke salesy. Avslutt med relevante hashtags og lenke.`,
    },
    {
      label: 'B',
      angle: 'curiosity',
      promptHint: `Skriv et norsk Twitter/X-innlegg (maks 230 tegn) med en nysgjerrighet-hook — start med et spørsmål eller overraskende fakta som gjør at folk vil klikke for å lære mer. ${baseContext} Ingen klisjeer. Avslutt med relevante hashtags og lenke.`,
    },
    {
      label: 'C',
      angle: 'community',
      promptHint: `Skriv et norsk Twitter/X-innlegg (maks 230 tegn) med community-fokus — anbefal noe til fellesskapet som en venn ville gjort, eller involver følgerne med et spørsmål. ${baseContext} Varm og inkluderende tone. Avslutt med relevante hashtags og lenke.`,
    },
  ] as const;

  const results = await Promise.allSettled(
    VARIANTS.map(async v => {
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: v.promptHint }],
        max_tokens: 130,
        temperature: 0.9,
      });
      const text = res.choices[0]?.message?.content?.trim() ?? '';
      if (!text) throw new Error(`Tom respons for variant ${v.label}`);
      return { label: v.label, angle: v.angle, text };
    })
  );

  const generated: Array<{ label: string; angle: string; text: string }> = [];
  for (const r of results) {
    if (r.status === 'fulfilled') generated.push(r.value);
  }

  if (generated.length === 0) {
    return NextResponse.json({ error: 'AI-generering feilet for alle varianter' }, { status: 500 });
  }

  // Insert all successful variants into DB
  const rows = generated.map(g => ({
    workspace_id:   wsId,
    partner_id:     body.partnerId ?? null,
    partner_name:   body.partnerName,
    draft_text:     g.text.slice(0, 280),
    hashtags,
    affiliate_url:  body.affiliateUrl ?? null,
    status:         'draft',
    ai_model:       'gpt-4o-mini',
    ai_prompt_hint: `variant_${g.label}_${g.angle}${body.promptHint ? `|${body.promptHint}` : ''}`,
  }));

  const { data, error } = await db
    .from('twitter_drafts')
    .insert(rows)
    .select('id,partner_name,draft_text,hashtags,affiliate_url,status,ai_model,ai_prompt_hint,created_at');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    variants: generated.length,
    drafts: data ?? [],
  });
}

// ── PATCH: update status or text ──────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB ikke tilkoblet' }, { status: 500 });

  const wsId = getWorkspaceId();
  const body = await req.json() as {
    id: string;
    status?: 'draft' | 'approved' | 'posted' | 'rejected' | 'archived';
    draftText?: string;
    postedUrl?: string;
  };

  if (!body.id) return NextResponse.json({ error: 'id er påkrevd' }, { status: 400 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status) updates.status = body.status;
  if (body.draftText) updates.draft_text = body.draftText.slice(0, 280);
  if (body.postedUrl) { updates.posted_url = body.postedUrl; updates.posted_at = new Date().toISOString(); }

  const { error } = await db
    .from('twitter_drafts')
    .update(updates)
    .eq('id', body.id)
    .eq('workspace_id', wsId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

// ── DELETE: archive a draft ───────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB ikke tilkoblet' }, { status: 500 });

  const wsId = getWorkspaceId();
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id er påkrevd' }, { status: 400 });

  const { error } = await db
    .from('twitter_drafts')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', wsId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
