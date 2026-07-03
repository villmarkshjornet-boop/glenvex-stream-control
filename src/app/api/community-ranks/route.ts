import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedWorkspace } from '@/lib/requireAuth';
import { createClient } from '@supabase/supabase-js';

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function GET(req: NextRequest) {
  const workspaceId = getAuthenticatedWorkspace(req);
  if (!workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();

  const [ranks, perks, hero, prestige] = await Promise.all([
    db.from('community_ranks').select('*').eq('workspace_id', workspaceId).order('level_min'),
    db.from('community_perks').select('*').eq('workspace_id', workspaceId),
    db.from('community_hero').select('*').eq('workspace_id', workspaceId).order('hero_date', { ascending: false }).limit(7),
    db.from('community_prestige_log').select('discord_id,prestige_level,prestiged_at').eq('workspace_id', workspaceId).order('prestiged_at', { ascending: false }).limit(10),
  ]);

  return NextResponse.json({
    ranks: ranks.data ?? [],
    perks: perks.data ?? [],
    recentHeroes: hero.data ?? [],
    recentPrestiges: prestige.data ?? [],
  });
}
