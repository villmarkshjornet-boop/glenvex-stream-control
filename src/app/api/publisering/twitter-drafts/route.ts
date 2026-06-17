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

// ── POST: generate new draft with AI ─────────────────────────────────────────

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
    promptHint?: string;   // optional extra context for AI
    manualText?: string;   // skip AI, use this text directly
  };

  if (!body.partnerName) {
    return NextResponse.json({ error: 'partnerName er påkrevd' }, { status: 400 });
  }

  let draftText: string;
  let aiModel: string | null = null;
  const hashtags: string[] = ['#ad', '#partner'];

  if (body.manualText) {
    draftText = body.manualText;
  } else {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OPENAI_API_KEY mangler for AI-generering' }, { status: 500 });
    }

    try {
      const { default: OpenAI } = await import('openai');
      const openai = new OpenAI({ apiKey });
      const kode = body.discountCode ? ` Rabattkode: ${body.discountCode}.` : '';
      const hint = body.promptHint ? ` Kontekst: ${body.promptHint}.` : '';

      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Skriv et norsk Twitter/X-innlegg (maks 240 tegn) om partneren ${body.partnerName}${body.partnerDesc ? ` – ${body.partnerDesc}` : ''}.${body.affiliateUrl ? ` Lenke: ${body.affiliateUrl}.` : ''}${kode}${hint} Autentisk, ikke salesy. Avslutt med relevante hashtags.`,
        }],
        max_tokens: 120,
        temperature: 0.9,
      });

      const aiText = res.choices[0]?.message?.content?.trim() ?? '';
      if (!aiText) throw new Error('Tom AI-respons');
      draftText = aiText;
      aiModel = 'gpt-4o-mini';
    } catch (err: any) {
      return NextResponse.json({ error: `AI-generering feilet: ${err?.message}` }, { status: 500 });
    }
  }

  const { data, error } = await db
    .from('twitter_drafts')
    .insert({
      workspace_id: wsId,
      partner_id: body.partnerId ?? null,
      partner_name: body.partnerName,
      draft_text: draftText.slice(0, 280),
      hashtags,
      affiliate_url: body.affiliateUrl ?? null,
      status: 'draft',
      ai_model: aiModel,
      ai_prompt_hint: body.promptHint ?? null,
    })
    .select('id,partner_name,draft_text,hashtags,affiliate_url,status,ai_model,created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, draft: data });
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
