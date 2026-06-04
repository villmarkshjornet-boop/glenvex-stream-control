import { NextRequest, NextResponse } from 'next/server';
import { getAllContent, addContent, updateContent, getDrafts, type ContentType, type ContentStatus } from '@/lib/contentLibrary';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') as ContentType | null;
  const status = searchParams.get('status') as ContentStatus | null;
  const drafts = searchParams.get('drafts') === 'true';

  if (drafts) return NextResponse.json(getDrafts());

  let items = getAllContent();
  if (type) items = items.filter(i => i.type === type);
  if (status) items = items.filter(i => i.status === status);

  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const item = addContent({ ...body, status: body.status ?? 'draft', opprettetAv: 'dashboard', modul: body.modul ?? 'manuell' });
  return NextResponse.json(item);
}

export async function PATCH(req: NextRequest) {
  const { id, ...updates } = await req.json();
  const item = updateContent(id, updates);
  if (!item) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  return NextResponse.json(item);
}
