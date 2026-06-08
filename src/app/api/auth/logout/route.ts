import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const response = NextResponse.redirect(new URL('/login', req.url));

  // Clear all Supabase auth cookies
  req.cookies.getAll().forEach(cookie => {
    if (cookie.name.startsWith('sb-') && (
      cookie.name.endsWith('-auth-token') ||
      cookie.name.endsWith('-auth-token-code-verifier') ||
      cookie.name.match(/-auth-token\.\d+$/)
    )) {
      response.cookies.set(cookie.name, '', { maxAge: 0, path: '/' });
    }
  });

  return response;
}
