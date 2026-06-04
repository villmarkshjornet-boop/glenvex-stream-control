import { NextResponse } from 'next/server';
import { getFeaturedPartner } from '@/lib/partners';

export const dynamic = 'force-dynamic';

export async function GET() {
  const featured = await getFeaturedPartner();
  return NextResponse.json(featured ?? null);
}
