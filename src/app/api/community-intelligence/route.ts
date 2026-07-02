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
    void db.from('system_events').insert({
      workspace_id: ws, source: 'community_intelligence',
      event_type: 'WORKSPACE_MISSING_BRAND_CONTEXT',
      title: 'Community Intelligence: workspace mangler brand_name',
      severity: 'warning', metadata: { wsId: ws },
    });
  }

  const now   = Date.now();
  const cut24h = new Date(now -  1 * 24 * 3600_000).toISOString();
  const cut7d  = new Date(now -  7 * 24 * 3600_000).toISOString();
  const cut14d = new Date(now - 14 * 24 * 3600_000).toISOString();
  const cut30d = new Date(now - 30 * 24 * 3600_000).toISOString();

  // ── Data — alt fra community_member_overview (inkl. Twitch/coins/kort) ──────
  const [membersRes, memoryRes] = await Promise.all([
    db.from('community_member_overview')
      .select('*')
      .eq('workspace_id', ws)
      .neq('member_type', 'merged')          // utelat sammenslåtte tw_-rader
      .order('total_xp', { ascending: false }),
    db.from('ai_agent_memory')
      .select('memory_type,key,summary,confidence_score,occurrence_count')
      .eq('workspace_id', ws)
      .in('memory_type', ['topic', 'joke', 'member', 'community_pattern'])
      .order('occurrence_count', { ascending: false })
      .limit(20),
  ]);

  const members        = membersRes.data ?? [];
  const communityMemory = memoryRes.data ?? [];
  const total          = members.length;

  // ── Helpers ───────────────────────────────────────────────────────────────
  const supportScore = (m: any) =>
    (m.subs ?? 0) + (m.gift_subs ?? 0) * 2 + (m.raids ?? 0) * 3 +
    (m.twitch_sub_status ? 1 : 0);           // sub bidrar i support-score

  const mapBase = (m: any) => ({
    id:               m.discord_id,
    username:         m.display_name ?? m.username,
    xp:               m.xp ?? 0,
    totalXp:          m.total_xp ?? m.xp ?? 0,
    discordXp:        m.discord_xp ?? 0,
    twitchXp:         m.twitch_xp ?? 0,
    level:            m.level ?? 1,
    messages:         m.messages ?? 0,
    messagesDiscord:  m.messages_discord ?? 0,
    messagesTwitch:   m.messages_twitch ?? 0,
    reactions:        m.reactions ?? 0,
    voiceMinutes:     m.voice_minutes ?? 0,
    streamsAttended:  m.streams_attended ?? 0,
    subs:             m.subs ?? 0,
    giftSubs:         m.gift_subs ?? 0,
    raids:            m.raids ?? 0,
    engagementScore:  m.engagement_score ?? 0,
    communityScore:   m.community_score ?? 0,
    coinsBalance:     m.coins_balance ?? 0,
    totalCoinsEarned: m.total_coins_earned ?? 0,
    totalCoinsSpent:  m.total_coins_spent ?? 0,
    totalCards:       m.total_cards ?? 0,
    commonCards:      m.common_cards ?? 0,
    rareCards:        m.rare_cards ?? 0,
    epicCards:        m.epic_cards ?? 0,
    legendaryCards:   m.legendary_cards ?? 0,
    mythicCards:      m.mythic_cards ?? 0,
    activeCardTitle:  m.active_card_title ?? null,
    activeCardRarity: m.active_card_rarity ?? null,
    twitchLinked:     m.twitch_linked ?? false,
    twitchSubStatus:  m.twitch_sub_status ?? false,
    twitchSubTier:    m.twitch_sub_tier ?? null,
    memberType:       m.member_type ?? 'discord',
    topRole:          m.top_role ?? null,
    badges:           m.badges ?? [],
    lastSeen:         m.last_seen,
    lastActivityAt:   m.last_activity_at,
    joinedAt:         m.joined_at ?? m.created_at,
  });

  // ── Health metrics (bruker last_activity_at) ──────────────────────────────
  const aktive24h   = members.filter(m => (m.last_activity_at ?? '') > cut24h).length;
  const aktive7d    = members.filter(m => (m.last_activity_at ?? '') > cut7d).length;
  const aktive30d   = members.filter(m => (m.last_activity_at ?? '') > cut30d).length;
  const nyeSiste30d = members.filter(m => (m.joined_at ?? m.created_at ?? '') > cut30d).length;
  const linkedCount = members.filter(m => m.twitch_linked).length;
  const subCount    = members.filter(m => m.twitch_sub_status).length;
  const totalCards  = members.reduce((s, m) => s + (m.total_cards ?? 0), 0);
  const churn       = total > 0 ? Math.round(((total - aktive30d) / total) * 100) : 0;
  const retention   = total > 0 ? Math.round((aktive30d / total) * 100) : 0;

  // ── Leaders ───────────────────────────────────────────────────────────────
  const toppXP          = members.slice(0, 10).map(mapBase);
  const toppChattere    = [...members].sort((a, b) => (b.messages_discord ?? b.messages ?? 0) - (a.messages_discord ?? a.messages ?? 0)).slice(0, 5).map(mapBase);
  const toppSupportere  = [...members].sort((a, b) => supportScore(b) - supportScore(a)).slice(0, 5).map(mapBase);
  const toppEngasjement = [...members].sort((a, b) => (b.engagement_score ?? 0) - (a.engagement_score ?? 0)).slice(0, 5).map(mapBase);

  // ── Eksisterende segmenter ────────────────────────────────────────────────

  const coreMembers = members
    .filter(m =>
      (m.streams_attended ?? 0) >= 5 &&
      (m.last_activity_at ?? '') > cut7d &&
      ((m.messages ?? 0) > 10 || (m.engagement_score ?? 0) >= 20)
    )
    .sort((a, b) => (b.streams_attended ?? 0) - (a.streams_attended ?? 0))
    .slice(0, 8).map(mapBase);

  const communityHeroes = members
    .filter(m => (m.level ?? 0) >= 30 || supportScore(m) >= 5)
    .sort((a, b) =>
      supportScore(b) + (b.level ?? 0) * 2 -
      (supportScore(a) + (a.level ?? 0) * 2)
    )
    .slice(0, 6).map(mapBase);

  const streamerSupportere = [...members]
    .filter(m => supportScore(m) >= 3)
    .sort((a, b) => supportScore(b) - supportScore(a))
    .slice(0, 6).map(mapBase);

  const retentionLeaders = members
    .filter(m => (m.streams_attended ?? 0) >= 8 && (m.last_activity_at ?? '') > cut14d)
    .sort((a, b) => (b.streams_attended ?? 0) - (a.streams_attended ?? 0))
    .slice(0, 6).map(mapBase);

  const atRisk = members
    .filter(m =>
      (m.last_activity_at ?? '') < cut14d &&
      (m.xp ?? 0) > 100 &&
      (m.joined_at ?? m.created_at ?? '') < cut30d
    )
    .slice(0, 10).map(mapBase);

  const newMembers = members
    .filter(m => (m.joined_at ?? m.created_at ?? '') > cut30d)
    .sort((a, b) => (b.joined_at ?? b.created_at ?? '').localeCompare(a.joined_at ?? a.created_at ?? ''))
    .slice(0, 10).map(mapBase);

  const hiddenGems = [...members]
    .filter(m => (m.community_score ?? 0) >= 30 && (m.messages ?? 0) < 50 && (m.last_activity_at ?? '') > cut30d)
    .sort((a, b) => (b.community_score ?? 0) - (a.community_score ?? 0))
    .slice(0, 5).map(mapBase);

  // ── Nye segmenter (Community Core) ───────────────────────────────────────

  // Collectors — stort kortbibliotek
  const collectors = members
    .filter(m => (m.total_cards ?? 0) >= 5)
    .sort((a, b) => (b.total_cards ?? 0) - (a.total_cards ?? 0))
    .slice(0, 8).map(mapBase);

  // High Rollers — rik coin-balanse
  const highRollers = members
    .filter(m => (m.coins_balance ?? 0) >= 300 && (m.last_activity_at ?? '') > cut30d)
    .sort((a, b) => (b.coins_balance ?? 0) - (a.coins_balance ?? 0))
    .slice(0, 6).map(mapBase);

  // Cross Platform — aktive på begge plattformer
  const crossPlatform = members
    .filter(m => m.twitch_linked && (m.last_activity_at ?? '') > cut14d)
    .sort((a, b) => (b.total_xp ?? b.xp ?? 0) - (a.total_xp ?? a.xp ?? 0))
    .slice(0, 8).map(mapBase);

  // Subscribers — Twitch subs med Discord-konto
  const subscribers = members
    .filter(m => m.twitch_sub_status)
    .sort((a, b) => (b.total_xp ?? b.xp ?? 0) - (a.total_xp ?? a.xp ?? 0))
    .slice(0, 10).map(mapBase);

  // Future Mods — høy score, stabil aktivitet, modkandidater
  const futureMods = members
    .filter(m =>
      (m.community_score ?? 0) >= 50 &&
      (m.last_activity_at ?? '') > cut14d &&
      (m.level ?? 0) >= 10 &&
      (m.engagement_score ?? 0) >= 30
    )
    .sort((a, b) => ((b.community_score ?? 0) + (b.level ?? 0)) - ((a.community_score ?? 0) + (a.level ?? 0)))
    .slice(0, 5).map(mapBase);

  // Card Hunters — bruker coins på rerolls
  const cardHunters = members
    .filter(m => (m.total_cards ?? 0) >= 3 && (m.total_coins_spent ?? 0) >= 150)
    .sort((a, b) => (b.total_coins_spent ?? 0) - (a.total_coins_spent ?? 0))
    .slice(0, 6).map(mapBase);

  // Whales — eier sjeldne kort
  const whales = members
    .filter(m => (m.mythic_cards ?? 0) >= 1 || (m.legendary_cards ?? 0) >= 2)
    .sort((a, b) =>
      ((b.mythic_cards ?? 0) * 5 + (b.legendary_cards ?? 0) * 2) -
      ((a.mythic_cards ?? 0) * 5 + (a.legendary_cards ?? 0) * 2)
    )
    .slice(0, 6).map(mapBase);

  // ── AI Memory ─────────────────────────────────────────────────────────────
  const communitySignaler = communityMemory.filter(m => m.memory_type === 'topic' || m.memory_type === 'community_pattern');
  const runningJokes      = communityMemory.filter(m => m.memory_type === 'joke');
  const kjenteMembres     = communityMemory.filter(m => m.memory_type === 'member');
  const aiMemoryKontekst = {
    communitySignaler: communitySignaler.slice(0, 8).map(m => ({ key: m.key, summary: m.summary, occurrences: m.occurrence_count })),
    runningJokes:      runningJokes.slice(0, 5).map(m => ({ key: m.key, summary: m.summary })),
    kjenteMembres:     kjenteMembres.slice(0, 5).map(m => ({ key: m.key, summary: m.summary })),
    crossPlatformCount: linkedCount,
    dataKvalitet: communityMemory.length === 0 ? 'for_lite_datagrunnlag' : communityMemory.length < 5 ? 'lav' : 'medium',
  };

  // ── Anbefalinger ──────────────────────────────────────────────────────────
  const anbefalinger: { type: string; member: string; begrunnelse: string; prioritet: 'høy' | 'medium' | 'lav' }[] = [];

  for (const hero of communityHeroes.slice(0, 2)) {
    const dager = Math.round((now - new Date(hero.lastActivityAt ?? hero.lastSeen ?? 0).getTime()) / 86400_000);
    if (dager <= 7) {
      anbefalinger.push({
        type: 'gi_vip',
        member: hero.username,
        begrunnelse: `Lv ${hero.level}, support-score ${hero.subs + hero.giftSubs * 2 + hero.raids * 3} — vurder VIP-rolle.`,
        prioritet: 'høy',
      });
    }
  }

  for (const m of atRisk.slice(0, 2)) {
    const dager = Math.round((now - new Date(m.lastActivityAt ?? m.lastSeen ?? 0).getTime()) / 86400_000);
    anbefalinger.push({
      type: 'følg_opp',
      member: m.username,
      begrunnelse: `${dager} dager inaktiv — hadde ${m.xp} XP og ${m.totalCards} kort. Vurder personlig invitasjon.`,
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
    if (core.streamsAttended >= 10) {
      anbefalinger.push({
        type: 'takk',
        member: core.username,
        begrunnelse: `${core.streamsAttended} streams attended — konsekvent lojalitet. Nevn dem i neste stream.`,
        prioritet: 'lav',
      });
    }
  }

  // Anbefal linking for aktive Discord-brukere uten Twitch-kobling
  const aktivUtenLink = members.find(m =>
    !m.twitch_linked &&
    (m.total_xp ?? m.xp ?? 0) > 500 &&
    (m.last_activity_at ?? '') > cut7d
  );
  if (aktivUtenLink) {
    anbefalinger.push({
      type: 'link_twitch',
      member: aktivUtenLink.display_name ?? aktivUtenLink.username,
      begrunnelse: `Aktiv Discord-bruker uten Twitch-kobling — /linktwitch for å samle XP på tvers av plattformer.`,
      prioritet: 'lav',
    });
  }

  // ── AI analyse ────────────────────────────────────────────────────────────
  let aiAnalyse: string | null = null;
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && members.length > 0) {
    try {
      const openai = new OpenAI({ apiKey });
      const avgVoice  = members.length > 0 ? Math.round(members.reduce((s, m) => s + (m.voice_minutes ?? 0), 0) / members.length) : 0;
      const totalCoinsEconomy = members.reduce((s, m) => s + (m.total_coins_earned ?? 0), 0);
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
- Topp XP: ${toppXP.slice(0, 3).map(m => `${m.username} (Lv${m.level}, ${m.totalXp} XP)`).join(', ')}
- Twitch-koblet: ${linkedCount} av ${total} | Aktive SUBs: ${subCount}
- Totale kort: ${totalCards} | Whales: ${whales.length} | Collectors: ${collectors.length}
- Coin-økonomi: ${totalCoinsEconomy} coins tjent totalt
- Snitt voice: ${avgVoice} min | Cross-platform: ${crossPlatform.length} aktive
${communitySignaler.length > 0 ? `- Community-signaler: ${communitySignaler.slice(0, 3).map(s => s.key).join(', ')}` : ''}

Analyser community-helsen og gi 2 konkrete handlingsanbefalinger. Norsk. Maks 100 ord.`,
        }],
      });
      aiAnalyse = res.choices[0]?.message?.content?.trim() ?? null;
    } catch {}
  }

  return NextResponse.json({
    health: { total, aktive24h, aktive7d, aktive30d, nyeSiste30d, retention, churn, linkedCount, subCount, totalCards },
    leaders: { toppXP, toppChattere, toppSupportere, toppEngasjement },
    // Eksisterende segmenter
    coreMembers,
    communityHeroes,
    streamerSupportere,
    retentionLeaders,
    atRisk,
    newMembers,
    hiddenGems,
    // Nye segmenter (Community Core)
    collectors,
    highRollers,
    crossPlatform,
    subscribers,
    futureMods,
    cardHunters,
    whales,
    anbefalinger,
    aiMemoryKontekst,
    aiAnalyse,
    generertKl: new Date().toLocaleTimeString('no-NO'),
  });
}
