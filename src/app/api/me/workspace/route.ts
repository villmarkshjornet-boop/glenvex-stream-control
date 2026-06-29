import { NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ id: getWorkspaceId() });
}
