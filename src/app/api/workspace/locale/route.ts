import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

const VALID_LOCALES = ['no', 'en'] as const;

export async function GET() {
  const db = getDb();
  if (!db) return NextResponse.json({ locale: 'no' });
  const ws = getWorkspaceId();

  const { data } = await db
    .from('workspaces')
    .select('locale')
    .eq('id', ws)
    .single();

  const locale = (data?.locale as string | null) ?? 'no';
  return NextResponse.json({ locale: VALID_LOCALES.includes(locale as 'no' | 'en') ? locale : 'no' });
}

export async function PATCH(req: NextRequest) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });
  const ws = getWorkspaceId();

  let body: { locale?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }

  const locale = body.locale;
  if (!locale || !VALID_LOCALES.includes(locale as 'no' | 'en')) {
    return NextResponse.json({ error: 'Invalid locale' }, { status: 400 });
  }

  const { error } = await db
    .from('workspaces')
    .update({ locale })
    .eq('id', ws);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ locale });
}
