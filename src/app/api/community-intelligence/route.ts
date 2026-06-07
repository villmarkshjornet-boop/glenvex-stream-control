import { NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const WORKSPACE = 'glenvex-default';

export async function GET() {
  if (!isDbAvailable()) {
    return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });
  }

  const db = getDb()!;
  const ws = getWorkspaceId() || WORKSPACE;

  const now = Date.now();
  const cut24h = new Date(now - 24 * 3600_000).toISOString();
  const cut7d  = new Date(now - 7  * 24 * 3600_000).toISOString();
  const cut30d = new Date(now - 30 * 24 * 3600_000).toISOString();
  const cut14d = new Date(now - 14 * 24 * 3600_000).toISOString();

  const { data: allMembers } = await db
    .from('community_members')
    .select('*')
    .eq('workspace_id', ws)
    .order('xp', { ascending: false });

  const members = allMembers ?? [];
  const total = members.length;

  // ── Health metrics ────────────────────────────────────────────────────────
  const aktive24h = members.filter(m => m.last_seen > cut24h).length;
  const aktive7d  = members.filter(m => m.last_seen > cut7d).length;
  const aktive30d = members.filter(m => m.last_seen > cut30d).length;

  const nyeSiste30d = members.filter(m => {
    const joined = m.joined_at ?? m.created_at;
    return joined && joined > cut30d;
  }).length;

  const churn = total > 0 ? Math.round(((total - aktive30d) / total) * 100) : 0;
  const retention = total > 0 ? Math.round((aktive30d / total) * 100) : 0;

  // ── Leaders ───────────────────────────────────────────────────────────────
  const toppXP = members.slice(0, 10).map(m => ({
    id: m.discord_id,
    username: m.display_name ?? m.username,
    xp: m.xp ?? 0,
    level: m.level ?? 1,
    badges: m.badges ?? [],
  }));

  const toppChattere = [...members]
    .sort((a, b) => (b.messages ?? 0) - (a.messages ?? 0))
    .slice(0, 5)
    .map(m => ({ id: m.discord_id, username: m.display_name ?? m.username, messages: m.messages ?? 0 }));

  const toppSupportere = [...members]
    .sort((a, b) => ((b.subs ?? 0) + (b.gift_subs ?? 0) * 2 + (b.raids ?? 0) * 3) -
                   ((a.subs ?? 0) + (a.gift_subs ?? 0) * 2 + (a.raids ?? 0) * 3))
    .slice(0, 5)
    .map(m => ({
      id: m.discord_id,
      username: m.display_name ?? m.username,
      subs: m.subs ?? 0,
      giftSubs: m.gift_subs ?? 0,
      raids: m.raids ?? 0,
    }));

  const toppEngasjement = [...members]
    .sort((a, b) => (b.engagement_score ?? 0) - (a.engagement_score ?? 0))
    .slice(0, 5)
    .map(m => ({ id: m.discord_id, username: m.display_name ?? m.username, engagementScore: m.engagement_score ?? 0 }));

  // ── At risk ───────────────────────────────────────────────────────────────
  const atRisk = members
    .filter(m => {
      const lastSeen = m.last_seen;
      const joined = m.joined_at ?? m.created_at;
      return lastSeen < cut14d && (m.xp ?? 0) > 100 && joined < cut30d;
    })
    .slice(0, 10)
    .map(m => ({
      id: m.discord_id,
      username: m.display_name ?? m.username,
      lastSeen: m.last_seen,
      xp: m.xp ?? 0,
      level: m.level ?? 1,
    }));

  // ── New members ───────────────────────────────────────────────────────────
  const newMembers = members
    .filter(m => {
      const joined = m.joined_at ?? m.created_at;
      return joined && joined > cut30d;
    })
    .sort((a, b) => {
      const ja = a.joined_at ?? a.created_at ?? '';
      const jb = b.joined_at ?? b.created_at ?? '';
      return jb.localeCompare(ja);
    })
    .slice(0, 10)
    .map(m => ({
      id: m.discord_id,
      username: m.display_name ?? m.username,
      joinedAt: m.joined_at ?? m.created_at,
      xp: m.xp ?? 0,
      messages: m.messages ?? 0,
    }));

  // ── Hidden gems: høy community_score, få meldinger (lav synlighet) ────────
  const hiddenGems = [...members]
    .filter(m => (m.community_score ?? 0) >= 30 && (m.messages ?? 0) < 50 && (m.last_seen ?? '') > cut30d)
    .sort((a, b) => (b.community_score ?? 0) - (a.community_score ?? 0))
    .slice(0, 5)
    .map(m => ({
      id: m.discord_id,
      username: m.display_name ?? m.username,
      communityScore: m.community_score ?? 0,
      messages: m.messages ?? 0,
      subs: m.subs ?? 0,
      raids: m.raids ?? 0,
    }));

  // ── Optional AI analysis ──────────────────────────────────────────────────
  let aiAnalyse: string | null = null;
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && members.length > 0) {
    try {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 300,
        temperature: 0.4,
        messages: [{
          role: 'user',
          content: `Du er AI Community Manager for GLENVEX (norsk Twitch-community).

COMMUNITY DATA:
- Totale membres: ${total}
- Aktive siste 24t: ${aktive24h}
- Aktive siste 7d: ${aktive7d}
- Aktive siste 30d: ${aktive30d}
- Nye siste 30d: ${nyeSiste30d}
- Retention: ${retention}%
- Churn: ${churn}%
- At-risk membres: ${atRisk.length}
- Hidden gems: ${hiddenGems.length}
- Topp XP: ${toppXP.slice(0, 3).map(m => `${m.username} (Lv${m.level})`).join(', ')}

Analyser community-helsen og gi 2-3 konkrete handlingsanbefalinger for å øke engasjementet.
Svar på norsk, direkte og nyttig. Maks 150 ord.`,
        }],
      });
      aiAnalyse = res.choices[0]?.message?.content?.trim() ?? null;
    } catch {}
  }

  return NextResponse.json({
    health: { total, aktive24h, aktive7d, aktive30d, nyeSiste30d, retention, churn },
    leaders: { toppXP, toppChattere, toppSupportere, toppEngasjement },
    atRisk,
    newMembers,
    hiddenGems,
    aiAnalyse,
    generertKl: new Date().toLocaleTimeString('no-NO'),
  });
}
