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

  const [bjStats, rouletteStats, rngLog, flags] = await Promise.all([
    db.from('community_blackjack_games')
      .select('outcome,coins_delta,bet_amount,played_at')
      .eq('workspace_id', workspaceId)
      .order('played_at', { ascending: false })
      .limit(50),
    db.from('community_roulette_bets')
      .select('bet_type,outcome,coins_delta,bet_amount,result_number,played_at')
      .eq('workspace_id', workspaceId)
      .order('played_at', { ascending: false })
      .limit(50),
    db.from('community_rng_log')
      .select('game_type,rng_value,rng_result,context,logged_at')
      .eq('workspace_id', workspaceId)
      .order('logged_at', { ascending: false })
      .limit(20),
    db.from('workspace_feature_flags')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
  ]);

  const bjGames  = bjStats.data ?? [];
  const bjWins   = bjGames.filter(g => g.outcome === 'win' || g.outcome === 'blackjack').length;
  const bjLosses = bjGames.filter(g => g.outcome === 'loss').length;

  const rGames  = rouletteStats.data ?? [];
  const rWins   = rGames.filter(g => g.outcome === 'win').length;
  const rLosses = rGames.filter(g => g.outcome === 'loss').length;

  return NextResponse.json({
    blackjack: {
      recentGames: bjGames,
      stats: { total: bjGames.length, wins: bjWins, losses: bjLosses, winRate: bjGames.length > 0 ? bjWins / bjGames.length : 0 },
    },
    roulette: {
      recentBets: rGames,
      stats: { total: rGames.length, wins: rWins, losses: rLosses, winRate: rGames.length > 0 ? rWins / rGames.length : 0 },
    },
    rngLog: rngLog.data ?? [],
    featureFlags: flags.data ?? null,
  });
}

export async function PATCH(req: NextRequest) {
  const workspaceId = getAuthenticatedWorkspace(req);
  if (!workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as Record<string, unknown>;
  const db   = getDb();

  const allowedFields = [
    'blackjack_enabled','roulette_enabled','ranks_enabled','badges_enabled',
    'hero_enabled','prestige_enabled','achievements_enabled','quests_enabled',
    'blackjack_min_bet','blackjack_max_bet','blackjack_cooldown_minutes',
    'roulette_min_bet','roulette_max_bet','roulette_cooldown_minutes',
  ];

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const field of allowedFields) {
    if (field in body) update[field] = body[field];
  }

  const { error } = await db
    .from('workspace_feature_flags')
    .upsert({ workspace_id: workspaceId, ...update }, { onConflict: 'workspace_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
