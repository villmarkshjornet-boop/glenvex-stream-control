import { NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  if (!isDbAvailable()) {
    return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });
  }

  const db = getDb()!;
  const ws = getWorkspaceId();
  const discordId = params.id;

  const { data: wsBrand } = await db.from('workspaces').select('brand_name').eq('id', ws).single();
  const brandName = wsBrand?.brand_name ?? 'streameren';

  const { data: m, error } = await db
    .from('community_members')
    .select('*')
    .eq('workspace_id', ws)
    .eq('discord_id', discordId)
    .single();

  if (error || !m) {
    return NextResponse.json({ error: 'Membre ikke funnet' }, { status: 404 });
  }

  const username = m.display_name ?? m.username ?? '';

  const [memoryByUsername, followUpRes] = await Promise.all([
    username
      ? db.from('ai_agent_memory')
          .select('key,summary,memory_type,occurrence_count,agent_type,updated_at')
          .eq('workspace_id', ws)
          .ilike('summary', `%${username}%`)
          .not('memory_type', 'eq', 'follow_up')
          .order('occurrence_count', { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] }),
    db.from('ai_agent_memory')
      .select('id')
      .eq('workspace_id', ws)
      .eq('memory_type', 'follow_up')
      .eq('key', `followup_${discordId}`)
      .maybeSingle(),
  ]);

  const memories = (memoryByUsername.data ?? []);
  const isFollowUp = !!followUpRes.data;

  // ── AI Profil (rule-based) ────────────────────────────────────────────────
  const now = Date.now();
  const daysSinceLastSeen = m.last_seen
    ? (now - new Date(m.last_seen).getTime()) / 86400_000
    : 999;
  const joinedTs = m.joined_at ?? m.created_at;
  const daysSinceJoined = joinedTs
    ? Math.max(1, (now - new Date(joinedTs).getTime()) / 86400_000)
    : 1;
  const supportScore = (m.subs ?? 0) + (m.gift_subs ?? 0) * 2 + (m.raids ?? 0) * 3;

  const atRisk     = daysSinceLastSeen > 14 && (m.xp ?? 0) > 100;
  const erHero     = (m.level ?? 0) >= 30 || supportScore >= 5;
  const erCore     = (m.streams_attended ?? 0) >= 5 && daysSinceLastSeen < 7 && ((m.messages ?? 0) > 10 || (m.engagement_score ?? 0) >= 20);
  const erSupporter = supportScore >= 3;
  const erRetention = (m.streams_attended ?? 0) >= 8 && daysSinceLastSeen < 14;

  const trend = daysSinceLastSeen < 7 ? 'vekst' : daysSinceLastSeen < 14 ? 'stabil' : 'fallende';

  const viktighetScore = Math.min(100, Math.round(
    (Math.min(m.xp ?? 0, 5000) / 5000) * 30 +
    (Math.min(supportScore, 10) / 10) * 30 +
    (Math.min(m.engagement_score ?? 0, 100) / 100) * 20 +
    (Math.min(m.streams_attended ?? 0, 20) / 20) * 20
  ));

  const punkter: string[] = [];
  if (erHero)      punkter.push(`Lv ${m.level} — ${supportScore > 0 ? `support-score ${supportScore}` : 'veteran-nivå'}`);
  if (erCore)      punkter.push(`${m.streams_attended} streams attended — kjernemedlem`);
  if (erRetention) punkter.push(`Blant de mest konsekvent tilstedeværende`);
  if (erSupporter && !erHero) punkter.push(`${m.subs ?? 0}s / ${m.gift_subs ?? 0}g / ${m.raids ?? 0}r — aktivt støttende`);
  if (atRisk)      punkter.push(`${Math.round(daysSinceLastSeen)} dager inaktiv — bør følges opp`);
  if (daysSinceLastSeen < 2)     punkter.push('Svært aktiv siste 48 timer');
  if ((m.voice_minutes ?? 0) > 60) punkter.push(`${m.voice_minutes} minutter i voice — engasjerer seg utover chat`);
  if ((m.reactions ?? 0) > 50)     punkter.push(`${m.reactions} reactions — reagerer aktivt på andres innhold`);

  // ── GPT-beskrivelse ───────────────────────────────────────────────────────
  let aiBeskrivelse: string | null = null;
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 130,
        temperature: 0.4,
        messages: [{
          role: 'user',
          content: `Du er AI Community Manager for ${brandName} (norsk Twitch-community). Beskriv dette community-medlemmet i 2-3 setninger på norsk. Vær konkret og bruk tallene. Ikke gjenta navn i starten.

Navn: ${username}
Level: ${m.level} | XP: ${m.xp}
Meldinger: ${m.messages} | Reactions: ${m.reactions} | Voice: ${m.voice_minutes}min
Streams attended: ${m.streams_attended}
Subs: ${m.subs} | Gift subs: ${m.gift_subs} | Raids: ${m.raids}
Sist sett: ${Math.round(daysSinceLastSeen)} dager siden
Engagement score: ${m.engagement_score} | Community score: ${m.community_score}
Segment: ${[erHero && 'Hero', erCore && 'Core', atRisk && 'At Risk', erSupporter && 'Supporter'].filter(Boolean).join(', ') || 'Inaktiv/Ny'}`,
        }],
      });
      aiBeskrivelse = res.choices[0]?.message?.content?.trim() ?? null;
    } catch {}
  }

  return NextResponse.json({
    member: {
      id: m.discord_id,
      username: m.username,
      displayName: m.display_name ?? m.username,
      xp: m.xp ?? 0,
      level: m.level ?? 1,
      messages: m.messages ?? 0,
      reactions: m.reactions ?? 0,
      voiceMinutes: m.voice_minutes ?? 0,
      streamsAttended: m.streams_attended ?? 0,
      subs: m.subs ?? 0,
      giftSubs: m.gift_subs ?? 0,
      raids: m.raids ?? 0,
      engagementScore: m.engagement_score ?? 0,
      communityScore: m.community_score ?? 0,
      badges: m.badges ?? [],
      lastSeen: m.last_seen,
      joinedAt: m.joined_at ?? m.created_at,
    },
    aiProfil: {
      viktighetScore,
      trend,
      atRisk,
      erHero,
      erCore,
      erSupporter,
      erRetention,
      punkter,
      aiBeskrivelse,
    },
    historikk: {
      aktiv7d:  daysSinceLastSeen < 7,
      aktiv30d: daysSinceLastSeen < 30,
      aktiv90d: daysSinceLastSeen < 90,
      daysSinceJoined: Math.round(daysSinceJoined),
      daysSinceLastSeen: Math.round(daysSinceLastSeen),
      snitMeldingerPerDag: Math.round(((m.messages ?? 0) / daysSinceJoined) * 10) / 10,
      snitStreamsPerUke:   Math.round(((m.streams_attended ?? 0) / (daysSinceJoined / 7)) * 10) / 10,
    },
    kontekst: memories.map(mem => ({
      key: mem.key,
      summary: mem.summary,
      type: mem.memory_type,
      agent: mem.agent_type,
      occurrences: mem.occurrence_count,
      updatedAt: mem.updated_at,
    })),
    isFollowUp,
  });
}
