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
    .from('community_member_overview')
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

  const memories   = memoryByUsername.data ?? [];
  const isFollowUp = !!followUpRes.data;

  // ── Tidspunkt-beregninger (bruker last_activity_at fra view) ─────────────
  const now = Date.now();
  const lastActivityTs = m.last_activity_at ?? m.last_seen;
  const daysSinceLastSeen = lastActivityTs
    ? (now - new Date(lastActivityTs).getTime()) / 86400_000
    : 999;
  const joinedTs = m.joined_at ?? m.created_at;
  const daysSinceJoined = joinedTs
    ? Math.max(1, (now - new Date(joinedTs).getTime()) / 86400_000)
    : 1;

  // ── Scores ────────────────────────────────────────────────────────────────
  const supportScore = (m.subs ?? 0) + (m.gift_subs ?? 0) * 2 + (m.raids ?? 0) * 3 +
    (m.twitch_sub_status ? 1 : 0);
  const totalXp = m.total_xp ?? m.xp ?? 0;

  // viktighetScore — Community Core utvidet formel (0-100)
  const viktighetScore = Math.min(100, Math.round(
    (Math.min(totalXp, 10000) / 10000) * 25 +             // XP (Discord + Twitch)
    (Math.min(supportScore, 10) / 10) * 20 +              // Support (subs, gifts, raids)
    (Math.min(m.engagement_score ?? 0, 100) / 100) * 15 + // Engagement
    (Math.min(m.streams_attended ?? 0, 20) / 20) * 15 +   // Streams
    (Math.min(m.total_coins_earned ?? 0, 2000) / 2000) * 10 + // Coin-aktivitet
    (Math.min(m.total_cards ?? 0, 20) / 20) * 5 +         // Kortsamling
    (m.twitch_linked ? 5 : 0) +                           // Kryssplattform-bonus
    (m.twitch_sub_status ? 5 : 0)                         // SUB-bonus
  ));

  // ── Segmenter ─────────────────────────────────────────────────────────────
  const atRisk      = daysSinceLastSeen > 14 && totalXp > 100;
  const erHero      = (m.level ?? 0) >= 30 || supportScore >= 5;
  const erCore      = (m.streams_attended ?? 0) >= 5 && daysSinceLastSeen < 7 && ((m.messages ?? 0) > 10 || (m.engagement_score ?? 0) >= 20);
  const erSupporter = supportScore >= 3;
  const erRetention = (m.streams_attended ?? 0) >= 8 && daysSinceLastSeen < 14;
  const erCollector = (m.total_cards ?? 0) >= 5;
  const erWhale     = (m.mythic_cards ?? 0) >= 1 || (m.legendary_cards ?? 0) >= 2;
  const erLinked    = m.twitch_linked ?? false;
  const erSub       = m.twitch_sub_status ?? false;

  const trend = daysSinceLastSeen < 7 ? 'vekst' : daysSinceLastSeen < 14 ? 'stabil' : 'fallende';

  // ── Punkter (humane observasjoner) ────────────────────────────────────────
  const punkter: string[] = [];
  if (erHero)       punkter.push(`Lv ${m.level ?? 0} — ${supportScore > 0 ? `support-score ${supportScore}` : 'veteran-nivå'}`);
  if (erCore)       punkter.push(`${m.streams_attended} streams attended — kjernemedlem`);
  if (erRetention)  punkter.push('Blant de mest konsekvent tilstedeværende');
  if (erSupporter && !erHero)
                    punkter.push(`${m.subs ?? 0}s / ${m.gift_subs ?? 0}g / ${m.raids ?? 0}r — aktivt støttende`);
  if (erSub)        punkter.push(`Twitch SUB${m.twitch_sub_tier ? ` (tier ${m.twitch_sub_tier})` : ''}`);
  if (erLinked && !erSub)
                    punkter.push('Discord + Twitch koblet — cross-platform aktiv');
  if (erWhale)      punkter.push(`Whale: ${m.mythic_cards ?? 0} Mythic / ${m.legendary_cards ?? 0} Legendary kort`);
  if (erCollector && !erWhale)
                    punkter.push(`Samler: ${m.total_cards ?? 0} kort`);
  if ((m.coins_balance ?? 0) >= 300)
                    punkter.push(`${m.coins_balance} coins — høy balanse`);
  if (atRisk)       punkter.push(`${Math.round(daysSinceLastSeen)} dager inaktiv — bør følges opp`);
  if (daysSinceLastSeen < 2)
                    punkter.push('Svært aktiv siste 48 timer');
  if ((m.voice_minutes ?? 0) > 60)
                    punkter.push(`${m.voice_minutes} minutter i voice — engasjerer seg utover chat`);
  if ((m.reactions ?? 0) > 50)
                    punkter.push(`${m.reactions} reactions — reagerer aktivt på andres innhold`);

  // ── GPT-beskrivelse ───────────────────────────────────────────────────────
  let aiBeskrivelse: string | null = null;
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    try {
      const openai = new OpenAI({ apiKey });
      const segmentStr = [
        erHero && 'Hero', erCore && 'Core', atRisk && 'At Risk',
        erSupporter && 'Supporter', erSub && 'SUB', erWhale && 'Whale',
        erCollector && 'Collector', erLinked && 'Cross-Platform',
      ].filter(Boolean).join(', ') || 'Ny/Inaktiv';

      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 130,
        temperature: 0.4,
        messages: [{
          role: 'user',
          content: `Du er AI Community Manager for ${brandName} (norsk Twitch-community). Beskriv dette community-medlemmet i 2-3 setninger på norsk. Vær konkret og bruk tallene. Ikke gjenta navn i starten.

Navn: ${username}
Level: ${m.level ?? 1} | Discord XP: ${m.discord_xp ?? m.xp ?? 0} | Twitch XP: ${m.twitch_xp ?? 0} | Total XP: ${totalXp}
Meldinger Discord: ${m.messages_discord ?? m.messages ?? 0} | Twitch: ${m.messages_twitch ?? 0}
Reactions: ${m.reactions ?? 0} | Voice: ${m.voice_minutes ?? 0}min | Streams attended: ${m.streams_attended ?? 0}
Subs: ${m.subs ?? 0} | Gift subs: ${m.gift_subs ?? 0} | Raids: ${m.raids ?? 0}
Twitch koblet: ${erLinked ? 'Ja' : 'Nei'} | Twitch SUB: ${erSub ? `Ja (tier ${m.twitch_sub_tier ?? '?'})` : 'Nei'}
Coins: ${m.coins_balance ?? 0} balanse | ${m.total_coins_earned ?? 0} tjent totalt
Kort: ${m.total_cards ?? 0} totalt (${m.mythic_cards ?? 0} Mythic, ${m.legendary_cards ?? 0} Legendary, ${m.epic_cards ?? 0} Epic)
Sist aktiv: ${Math.round(daysSinceLastSeen)} dager siden
Engagement: ${m.engagement_score ?? 0} | Community score: ${m.community_score ?? 0}
Segment: ${segmentStr}`,
        }],
      });
      aiBeskrivelse = res.choices[0]?.message?.content?.trim() ?? null;
    } catch {}
  }

  return NextResponse.json({
    member: {
      id:               m.discord_id,
      username:         m.username,
      displayName:      m.display_name ?? m.username,
      xp:               m.xp ?? 0,
      discordXp:        m.discord_xp ?? 0,
      twitchXp:         m.twitch_xp ?? 0,
      totalXp,
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
      twitchLinked:     erLinked,
      twitchSubStatus:  erSub,
      twitchSubTier:    m.twitch_sub_tier ?? null,
      twitchUsername:   m.twitch_username ?? null,
      memberType:       m.member_type ?? 'discord',
      topRole:          m.top_role ?? null,
      badges:           m.badges ?? [],
      lastSeen:         m.last_seen,
      lastActivityAt:   m.last_activity_at,
      joinedAt:         m.joined_at ?? m.created_at,
    },
    aiProfil: {
      viktighetScore,
      trend,
      atRisk,
      erHero,
      erCore,
      erSupporter,
      erRetention,
      erCollector,
      erWhale,
      erLinked,
      erSub,
      punkter,
      aiBeskrivelse,
    },
    historikk: {
      aktiv7d:             daysSinceLastSeen < 7,
      aktiv30d:            daysSinceLastSeen < 30,
      aktiv90d:            daysSinceLastSeen < 90,
      daysSinceJoined:     Math.round(daysSinceJoined),
      daysSinceLastSeen:   Math.round(daysSinceLastSeen),
      snitMeldingerPerDag: Math.round(((m.messages ?? 0) / daysSinceJoined) * 10) / 10,
      snitStreamsPerUke:   Math.round(((m.streams_attended ?? 0) / (daysSinceJoined / 7)) * 10) / 10,
    },
    kontekst: memories.map(mem => ({
      key:        mem.key,
      summary:    mem.summary,
      type:       mem.memory_type,
      agent:      mem.agent_type,
      occurrences: mem.occurrence_count,
      updatedAt:  mem.updated_at,
    })),
    isFollowUp,
  });
}
