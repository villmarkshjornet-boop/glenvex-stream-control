import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/workspace';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB ikke tilkoblet' }, { status: 500 });

  const wsId = getWorkspaceId();
  const status = req.nextUrl.searchParams.get('status') ?? 'pending';

  // Auto-expire stale pending proposals before fetching
  await db
    .from('partner_proposals')
    .update({ status: 'expired' })
    .eq('workspace_id', wsId)
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString());

  const { data, error } = await db
    .from('partner_proposals')
    .select('id,partner_id,partner_name,platform,trigger_type,message_twitch,message_discord,affiliate_url,discount_code,confidence,scoring_detail,status,expires_at,created_at')
    .eq('workspace_id', wsId)
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ proposals: data ?? [] });
}
