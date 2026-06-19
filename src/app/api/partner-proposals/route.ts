import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  const wsId = getWorkspaceId();
  const db = getDb();
  if (!db) return NextResponse.json({ proposals: [] });

  const { data } = await db
    .from('partner_proposals')
    .select('id, partner_name, platform, confidence, scoring_detail, message_twitch, message_discord, status, expires_at, approved_at, sent_at, created_at')
    .eq('workspace_id', wsId)
    .in('status', ['pending', 'approved', 'sent', 'rejected'])
    .order('created_at', { ascending: false })
    .limit(20);

  return NextResponse.json({ proposals: data ?? [] });
}
