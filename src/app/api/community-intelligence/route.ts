import { NextResponse } from 'next/server';
import { getDb, isDbAvailable } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  if (!isDbAvailable()) {
    return NextResponse.json({ error: 'Supabase ikke tilkoblet' }, { status: 500 });
  }

  const db = getDb()!;
  const ws = getWorkspaceId();

  const { data: wsBrand } = await db.from('workspaces').select('brand_name').eq('id', ws).single();
  const brandName = wsBrand?.brand_name ?? 'streameren';
  if (!wsBrand?.brand_name) {
    void db.from('system_events').insert({ workspace_id: ws, source: 'community_intelligence', event_type: 'WORKSPACE_MISSING_BRAND_CONTEXT', title: 'Community Intelligence: workspace mangler brand_name', severity: 'warning', metadata: { wsId: ws } });
  }

  const now = Date.now();
  const cut24h = new Date(now - 24 * 3600_000).toISOString();
  const cut7d  = new Date(now - 7  * 24 * 3600_000).toISOString();
  const cut14d = new Date(now - 14 * 24 * 3600_000).toISOString();
  const cut30d = new Date(now - 30 * 24 * 3600_000).toISOString();

  // Parallelle spørringer
  const [membersRes, memoryRes, crossRes] = await Promise.all([
    db.from('community_members').select('*').eq('workspace_id', ws).order('xp', { ascending: false }),
    db.from('ai_agent_memory')
      .select('memory_type,key,summary,confidence_score,occurrence_count')
      .eq('workspace_id', ws)
      .in('memory_type', ['topic', 'joke', 'member', 'community_pattern'])
      .order('occurrence_count', { ascending: false })
      .limit(20),
    db.from('cross_platform_users')
      .select('id,confidence_score', { count: 'exact' })
      .eq('workspace_id', ws)
      .limit(0),
  ]);

  const members = membersRes.data ?? [];
  const communityMemory = memoryRes.data ?? [];
  const crossPlatformCount = crossRes.count ?? 0;
  const total = members.length;

  // ── Health metrics ────────────────────────────────────────────────────────
  const aktive24h  = members.filter(m => m.last_seen > cut24h).length;
  const aktive7d   = members.filter(m => m.last_seen > cut7d).length;
  const aktive30d  = members.filter(m => m.last_seen > cut30d).length;
  const nyeSiste30d = members.filter(m => (m.joined_at ?? m.created_at ?? '') > cut30d).length;
  const churn     = total > 0 ? Math.round(((total - aktive30d) / total) * 100) : 0;
  const retention = total > 0 ? Math.round((aktive30d / total) * 100) : 0;

  // ── Helpers ───────────────────────────────────────────────────────────────
  const supportScore = (m: any) => (m.subs ?? 0) + (m.gift_subs ?? 0) * 2 + (m.raids ?? 0) * 3;
  const mapBase = (m: any) => ({
    id: m.discord_id,
    username: m.display_name ?? m.username,
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
  });

  // ── Leaders ───────────────────────────────────────────────────────────────
  const toppXP          = members.slice(0, 10).map(mapBase);
  const toppChattere    = [...members].sort((a, b) => (b.messages ?? 0) - (a.messages ?? 0)).slice(0, 5).map(mapBase);
  const toppSupportere  = [...members].sort((a, b) => supportScore(b) - supportScore(a)).slice(0, 5).map(mapBase);
  const toppEngasjement = [...members].sort((a, b) => (b.engagement_score ?? 0) - (a.engagement_score ?? 0)).slice(0, 5).map(mapBase);

  // ── Core Members — bærebjelken i communityet ──────────────────────────────
  // Betingelse: minst 5 streams attended OG aktiv siste 7d OG (>10 msg ELLER engagement>=20)
  const coreMembers = members
    .filter(m =>
      (m.streams_attended ?? 0) >= 5 &&
      (m.last_seen ?? '') > cut7d &&
      ((m.messages ?? 0) > 10 || (m.engagement_score ?? 0) >= 20)
    )
    .sort((a, b) => (b.streams_attended ?? 0) - (a.streams_attended ?? 0))
    .slice(0, 8)
    .map(m => ({ ...mapBase(m) }));

  // ── Community Heroes — veteraner og dedikerte ─────────────────────────────
  // Betingelse: Lv>=30 ELLER support-score>=5
  const communityHeroes = members
    .filter(m => (m.level ?? 0) >= 30 || supportScore(m) >= 5)
    .sort((a, b) => supportScore(b) + (b.level ?? 0) * 2 - (supportScore(a) + (a.level ?? 0) * 2))
    .slice(0, 6)
    .map(m => ({ ...mapBase(m) }));

  // ── Streamer Supporters — finansiell og event-støtte ─────────────────────
  // Betingelse: support-score >= 3
  const streamerSupportere = [...members]
    .filter(m => supportScore(m) >= 3)
    .sort((a, b) => supportScore(b) - supportScore(a))
    .slice(0, 6)
    .map(m => ({ ...mapBase(m) }));

  // ── Retention Leaders — alltid til stede ─────────────────────────────────
  // Betingelse: streams_attended >= 8 OG aktiv siste 14d
  const retentionLeaders = members
    .filter(m => (m.streams_attended ?? 0) >= 8 && (m.last_seen ?? '') > cut14d)
    .sort((a, b) => (b.streams_attended ?? 0) - (a.streams_attended ?? 0))
    .slice(0, 6)
    .map(m => ({ ...mapBase(m) }));

  // ── At Risk ───────────────────────────────────────────────────────────────
  const atRisk = members
    .filter(m => (m.last_seen ?? '') < cut14d && (m.xp ?? 0) > 100 && (m.joined_at ?? m.created_at ?? '') < cut30d)
    .slice(0, 10)
    .map(mapBase);

  // ── New Members ───────────────────────────────────────────────────────────
  const newMembers = members
    .filter(m => (m.joined_at ?? m.created_at ?? '') > cut30d)
    .sort((a, b) => (b.joined_at ?? b.created_at ?? '').localeCompare(a.joined_at ?? a.created_at ?? ''))
    .slice(0, 10)
    .map(mapBase);

  // ── Hidden Gems ───────────────────────────────────────────────────────────
  const hiddenGems = [...members]
    .filter(m => (m.community_score ?? 0) >= 30 && (m.messages ?? 0) < 50 && (m.last_seen ?? '') > cut30d)
    .sort((a, b) => (b.community_score ?? 0) - (a.community_score ?? 0))
    .slice(0, 5)
    .map(mapBase);

  // ── AI Memory — hva systemet vet om communityet ───────────────────────────
  const communitySignaler = communityMemory.filter(m => m.memory_type === 'topic' || m.memory_type === 'community_pattern');
  const runningJokes      = communityMemory.filter(m => m.memory_type === 'joke');
  const kjenteMembres     = communityMemory.filter(m => m.memory_type === 'member');
  const aiMemoryKontekst = {
    communitySignaler: communitySignaler.slice(0, 8).map(m => ({ key: m.key, summary: m.summary, occurrences: m.occurrence_count })),
    runningJokes:      runningJokes.slice(0, 5).map(m => ({ key: m.key, summary: m.summary })),
    kjenteMembres:     kjenteMembres.slice(0, 5).map(m => ({ key: m.key, summary: m.summary })),
    crossPlatformCount,
    dataKvalitet: communityMemory.length === 0 ? 'for_lite_datagrunnlag' : communityMemory.length < 5 ? 'lav' : 'medium',
  };

  // ── Anbefalinger (basert utelukkende på eksisterende data) ───────────────
  const anbefalinger: { type: string; member: string; begrunnelse: string; prioritet: 'høy' | 'medium' | 'lav' }[] = [];

  for (const hero of communityHeroes.slice(0, 2)) {
    const dagerSiden = Math.round((now - new Date(hero.lastSeen ?? 0).getTime()) / 86400_000);
    if (dagerSiden <= 7) {
      anbefalinger.push({
        type: 'gi_vip',
        member: hero.username,
        begrunnelse: `Lv ${hero.level}, ${hero.subs}s/${hero.giftSubs}g/${hero.raids}r — community hero-status. Vurder VIP-rolle.`,
        prioritet: 'høy',
      });
    }
  }

  for (const m of atRisk.slice(0, 2)) {
    const dager = Math.round((now - new Date(m.lastSeen ?? 0).getTime()) / 86400_000);
    anbefalinger.push({
      type: 'følg_opp',
      member: m.username,
      begrunnelse: `${dager} dager inaktiv — hadde ${m.xp} XP. Vurder personlig invitasjon.`,
      prioritet: 'medium',
    });
  }

  for (const gem of hiddenGems.slice(0, 2)) {
    anbefalinger.push({
      type: 'spotlight',
      member: gem.username,
      begrunnelse: `Community score ${gem.communityScore} men bare ${gem.messages} meldinger — fremhev i Discord.`,
      prioritet: 'lav',
    });
  }

  for (const core of coreMembers.slice(0, 1)) {
    if ((core.streamsAttended ?? 0) >= 10) {
      anbefalinger.push({
        type: 'takk',
        member: core.username,
        begrunnelse: `${core.streamsAttended} streams attended — konsekvent lojalitet. Nevn dem i neste stream.`,
        prioritet: 'lav',
      });
    }
  }

  // ── AI analyse (bruker nå rikere kontekst) ────────────────────────────────
  let aiAnalyse: string | null = null;
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && members.length > 0) {
    try {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        temperature: 0.4,
        messages: [{
          role: 'user',
          content: `Du er AI Community Manager for ${brandName} (norsk Twitch-community).

COMMUNITY DATA:
- Totale membres: ${total} | Aktive 24t: ${aktive24h} | 7d: ${aktive7d} | 30d: ${aktive30d}
- Retention: ${retention}% | Churn: ${churn}% | Nye 30d: ${nyeSiste30d}
- Core Members: ${coreMembers.length} | Heroes: ${communityHeroes.length} | At Risk: ${atRisk.length}
- Topp XP: ${toppXP.slice(0, 3).map(m => `${m.username} (Lv${m.level})`).join(', ')}
- Streams attended (snitt): ${members.length > 0 ? Math.round(members.reduce((s, m) => s + (m.streams_attended ?? 0), 0) / members.length * 10) / 10 : 0}
${communitySignaler.length > 0 ? `- Community-signaler: ${communitySignaler.slice(0, 3).map(s => s.key).join(', ')}` : ''}

Analyser community-helsen og gi 2 konkrete handlingsanbefalinger. Norsk. Maks 100 ord.`,
        }],
      });
      aiAnalyse = res.choices[0]?.message?.content?.trim() ?? null;
    } catch {}
  }

  return NextResponse.json({
    health: { total, aktive24h, aktive7d, aktive30d, nyeSiste30d, retention, churn },
    leaders: { toppXP, toppChattere, toppSupportere, toppEngasjement },
    coreMembers,
    communityHeroes,
    streamerSupportere,
    retentionLeaders,
    atRisk,
    newMembers,
    hiddenGems,
    anbefalinger,
    aiMemoryKontekst,
    aiAnalyse,
    generertKl: new Date().toLocaleTimeString('no-NO'),
  });
}

