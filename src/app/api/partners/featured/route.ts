import { NextResponse } from 'next/server';
import { getPartners } from '@/lib/partners';

export const dynamic = 'force-dynamic';

export async function GET() {
  const partners = getPartners();
  const featured = partners.find(p => p.featured && p.aktiv);
  if (!featured) return NextResponse.json(null);
  return NextResponse.json(featured);
}
