import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET() {
  const h = headers();
  const email = h.get('x-user-email') ?? '';
  const adminEmail = process.env.ADMIN_EMAIL ?? '';
  const isAdmin = adminEmail.length > 0 && email.toLowerCase() === adminEmail.toLowerCase();
  return NextResponse.json({ isAdmin });
}
