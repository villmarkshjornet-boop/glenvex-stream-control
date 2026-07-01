import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

type PersonaRarity = 'Common' | 'Rare' | 'Epic' | 'Legendary' | 'Mythic';

const RARITY_COLOR: Record<PersonaRarity, number> = {
  Common: 0x9e9e9e, Rare: 0x1565c0, Epic: 0x7b1fa2, Legendary: 0xf9a825, Mythic: 0xd50000,
};

const RARITY_VISUAL: Record<PersonaRarity, string> = {
  Common:    'dark steel military frame, high-contrast black and silver, veteran warrior with earned scars',
  Rare:      'cerulean blue crystal frame glowing from within, electric blue and cobalt, elemental power barely contained',
  Epic:      'dark violet arcane frame with pulsing glowing runes, deep purple and electric magenta, forbidden arcane mastery',
  Legendary: 'ornate 24-karat gold baroque frame with filigree, divine god rays and golden particles, chosen one destiny incarnate',
  Mythic:    'jet black cosmic void frame with blood-red plasma lightning, void black and explosive white plasma, transcendent cosmic power',
};

function trekkSjeldenhet(m: any): PersonaRarity {
  const aktivitet   = Math.min(40, (m.messages ?? 0) * 0.15 + (m.voice_minutes ?? 0) * 0.05 + (m.streams_attended ?? 0) * 2);
  const xpBonus     = Math.min(10, Math.floor((m.xp ?? 0) / 500));
  const badgeBonus  = Math.min(15, (m.badges?.length ?? 0) * 3);
  const streakBonus = Math.min(15, (m.streak_days ?? 0) * 1.5);
  const score       = aktivitet + xpBonus + badgeBonus + streakBonus + Math.random() * 20;
  if (score >= 96) return 'Mythic';
  if (score >= 86) return 'Legendary';
  if (score >= 71) return 'Epic';
  if (score >= 51) return 'Rare';
  return 'Common';
}

const ARCHETYPE_LIST = [
  'Chat Anchor', 'Hype Machine', 'Voice Hero', 'Raid Boss', 'Lurker',
  'Meme Lord', 'Community Builder', 'Strategist', 'Chaos Agent', 'Storyteller',
  'Scholar', 'Mentor', 'Wanderer', 'Berserker', 'Paladin', 'Shadow',
  'Bard', 'Sage', 'Guardian', 'Rogue', 'Alchemist', 'Warlord',
  'Trickster', 'Oracle', 'Crusader', 'Phantom', 'Artificer', 'Champion',
];

function byggPrompt(m: any, rarity: PersonaRarity): string {
  const badgeStr  = ((m.badges ?? []) as string[]).slice(-5).join(', ') || 'ingen';
  const rarityHint =
    rarity === 'Mythic'    ? 'MYTHIC — transcendent power. Gå ALL IN!'
    : rarity === 'Legendary' ? 'LEGENDARY — særdeles spesiell. Makt og personlighet.'
    : rarity === 'Epic'      ? 'EPIC — sterk, unik personlighet.'
    : rarity === 'Rare'      ? 'RARE — distinkt, skiller seg ut.'
    : 'COMMON — vanlig, men sjarmerende.';

  return `Du er en RPG-spillmester som lager Discord community samlekort — tenk Pokémon, Hearthstone.
Lag ett UNIKT, morsomt og positivt samlekort basert KUN på aktivitetsdataene nedenfor.

AKTIVITETSDATA:
- Brukernavn: ${m.username ?? 'ukjent'}
- Level: ${m.level ?? 1}  XP: ${m.xp ?? 0}
- Meldinger: ${m.messages ?? 0}
- Voice-minutter: ${m.voice_minutes ?? 0}
- Streams deltatt: ${m.streams_attended ?? 0}
- Reaksjoner: ${m.reactions ?? 0}
- Badges: ${badgeStr}
- Streak: ${m.streak_days ?? 0} dager
- Gift Subs: ${m.gift_subs ?? 0}

SJELDENHET: ${rarityHint}

ARCHETYPE — velg én: ${ARCHETYPE_LIST.join(', ')}
(Skriv nøyaktig som vist. Stats skal speile data: mye meldinger → høy activity/chaos, mye voice → høy community.)

Svar KUN med JSON (ingen annen tekst):
{
  "title": "THE [NOKO EPISK I STORE BOKSTAVER]",
  "class": "klasse-tittel",
  "archetype": "ett av navnene over",
  "description": "linje1\\nlinje2\\nlinje3",
  "signatureMove": "ABILITY NAME",
  "signatureMoveDesc": "én kort morsom setning",
  "quote": "karaktersitat på norsk",
  "flavorText": "lore-setning",
  "stats": { "hype": 0-100, "chaos": 0-100, "community": 0-100, "focus": 0-100, "humor": 0-100, "activity": 0-100, "helpfulness": 0-100, "kreativitet": 0-100, "loyalitet": 0-100, "lederskap": 0-100 },
  "imagePrompt": "english sentence about character vibes, trading card art, no real face"
}`;
}

async function genererJson(m: any, rarity: PersonaRarity, openai: OpenAI) {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: byggPrompt(m, rarity) }],
    temperature: 0.9,
    max_tokens: 900,
    response_format: { type: 'json_object' },
  });
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
  return {
    title:             ((parsed.title ?? 'THE UNKNOWN') as string).toUpperCase(),
    class:             (parsed.class             ?? 'Mysterious') as string,
    archetype:         (parsed.archetype         ?? 'Wanderer')   as string,
    rarity,
    description:       (parsed.description       ?? '')           as string,
    signatureMove:     ((parsed.signatureMove ?? 'UNKNOWN POWER') as string).toUpperCase(),
    signatureMoveDesc: (parsed.signatureMoveDesc ?? '...')        as string,
    quote:             (parsed.quote             ?? '...')        as string,
    flavorText:        (parsed.flavorText        ?? '')           as string,
    stats:             parsed.stats ?? {},
    imagePrompt:       (parsed.imagePrompt ?? 'futuristic gaming character, cyberpunk trading card art') as string,
  };
}

async function genererBilde(card: Awaited<ReturnType<typeof genererJson>>, openai: OpenAI): Promise<Buffer | null> {
  const prompt = `Premium collector trading card illustration. Character: ${card.archetype} — ${card.class}. ${card.imagePrompt}. Visual style: ${RARITY_VISUAL[card.rarity]}. Portrait orientation tall card. Rich dramatic environment. GLENVEX cyberpunk gaming aesthetic, neon green energy. No text. No watermarks. No logos. AAA quality.`;
  try {
    const res = await openai.images.generate({
      model:   'dall-e-3',
      prompt,
      n:       1,
      size:    '1024x1792',
      quality: 'hd',
    });
    const url = res.data?.[0]?.url;
    if (!url) return null;
    const imgRes = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!imgRes.ok) return null;
    return Buffer.from(await imgRes.arrayBuffer());
  } catch (e: any) {
    console.warn('[personas/generate] Bildegenerering feilet:', e?.message);
    return null;
  }
}

async function uploadBilde(buf: Buffer, wsId: string, discordId: string, db: any, season: string): Promise<string | null> {
  const bucket   = 'persona-cards';
  const filePath = `${wsId}/${discordId}/${season}-admin.png`;
  const doUpload = async () => db.storage.from(bucket).upload(filePath, buf, { contentType: 'image/png', upsert: true });

  let { error } = await doUpload();
  if (error) {
    const msg = (error.message ?? '').toLowerCase();
    if (msg.includes('not found') || msg.includes('does not exist')) {
      try { await db.storage.createBucket(bucket, { public: true }); } catch {}
      ({ error } = await doUpload());
    }
    if (error) { console.warn('[personas/generate] Upload feilet:', error.message); return null; }
  }
  const { data } = db.storage.from(bucket).getPublicUrl(filePath);
  return (data?.publicUrl ?? null) as string | null;
}

export async function POST(req: Request) {
  const wsId = getWorkspaceId();
  const db   = getDb();
  if (!db) return NextResponse.json({ ok: false, error: 'DB ikke tilgjengelig' }, { status: 500 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: 'OPENAI_API_KEY mangler' }, { status: 500 });

  const body = await req.json() as { discordId?: string };
  if (!body.discordId) return NextResponse.json({ ok: false, error: 'discordId kreves' }, { status: 400 });
  const { discordId } = body;

  // Load cooldown setting
  const { data: wsRow } = await db.from('workspaces').select('settings_json').eq('id', wsId).single();
  const personaSettings = ((wsRow as any)?.settings_json?.personaSettings ?? {}) as any;
  const cooldownMin: number = personaSettings.cooldownMinutter ?? 60;

  // Cooldown check via history
  const { data: lastHist } = await db
    .from('community_persona_history')
    .select('created_at')
    .eq('workspace_id', wsId)
    .eq('discord_id', discordId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (lastHist?.created_at) {
    const minSince = (Date.now() - new Date(lastHist.created_at as string).getTime()) / 60_000;
    if (minSince < cooldownMin) {
      const minLeft = Math.ceil(cooldownMin - minSince);
      return NextResponse.json({ ok: false, error: `Cooldown aktiv — ${minLeft} min igjen` }, { status: 429 });
    }
  }

  // Fetch member
  const { data: member } = await db
    .from('community_members')
    .select('*')
    .eq('workspace_id', wsId)
    .eq('discord_id', discordId)
    .single();
  if (!member) return NextResponse.json({ ok: false, error: 'Membre ikke funnet' }, { status: 404 });

  // Existing reroll count
  const { data: existing } = await db
    .from('community_personas')
    .select('reroll_count')
    .eq('workspace_id', wsId)
    .eq('discord_id', discordId)
    .single();
  const rerollCount = ((existing?.reroll_count as number) ?? 0) + (existing ? 1 : 0);

  const openai  = new OpenAI({ apiKey });
  const rarity  = trekkSjeldenhet(member);
  const season  = process.env.PERSONA_SEASON ?? 'default';

  let card: Awaited<ReturnType<typeof genererJson>>;
  try {
    card = await genererJson(member, rarity, openai);
  } catch (e: any) {
    console.error('[personas/generate] GPT feilet:', e?.message, e?.stack);
    return NextResponse.json({ ok: false, error: 'AI-generering feilet' }, { status: 500 });
  }

  const imageBuf = await genererBilde(card, openai);
  const imageUrl = imageBuf ? await uploadBilde(imageBuf, wsId, discordId, db, season) : null;

  const now = new Date().toISOString();
  const personaRow = {
    workspace_id:       wsId,
    discord_id:         discordId,
    username:           (member as any).username    as string,
    display_name:       (member as any).display_name as string,
    season,
    persona_title:      card.title,
    persona_class:      card.class,
    archetype:          card.archetype,
    rarity:             card.rarity,
    description:        card.description,
    signature_move:     card.signatureMove,
    signature_move_desc: card.signatureMoveDesc,
    quote:              card.quote,
    flavor_text:        card.flavorText,
    stats:              card.stats,
    image_prompt:       card.imagePrompt,
    image_url:          imageUrl,
    xp_cost:            0,
    reroll_count:       rerollCount,
    generator_version:  'v3-admin',
    model:              'gpt-4o-mini',
    image_model:        'dall-e-3',
    generated_at:       now,
    created_at:         now,
    updated_at:         now,
  };

  await db.from('community_personas').upsert(personaRow, { onConflict: 'workspace_id,discord_id,season' });
  const { id: _omit, ...historikkRow } = personaRow as any;
  await db.from('community_persona_history').insert(historikkRow);

  // Discord showcase post
  if (personaSettings.showcaseAktiv && personaSettings.showcaseKanalId && imageUrl) {
    const token = process.env.DISCORD_TOKEN;
    if (token) {
      const displayName = (member as any).display_name || (member as any).username || discordId.slice(0, 8);
      const embed = {
        title:       `${card.title}`,
        description: `**${card.class}** · ${card.archetype}\n\n*"${card.quote}"*\n\n${card.description}`,
        color:       RARITY_COLOR[card.rarity],
        image:       { url: imageUrl },
        footer:      { text: `${displayName} · ${card.rarity} · Season: ${season}` },
        timestamp:   now,
      };
      try {
        await fetch(`https://discord.com/api/v10/channels/${personaSettings.showcaseKanalId}/messages`, {
          method:  'POST',
          headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ embeds: [embed] }),
        });
      } catch (e: any) {
        console.warn('[personas/generate] Discord showcase feilet:', e?.message);
      }
    }
  }

  // System event log
  try {
    await db.from('system_events').insert({
      workspace_id: wsId,
      source:       'dashboard',
      event_type:   'PERSONA_GENERATED_ADMIN',
      title:        `Admin genererte persona for ${(member as any).display_name || (member as any).username}`,
      severity:     'info',
      metadata:     { discordId, username: (member as any).username, rarity: card.rarity, archetype: card.archetype, imageUrl },
    });
  } catch {}

  return NextResponse.json({
    ok: true,
    card: { title: card.title, class: card.class, archetype: card.archetype, rarity: card.rarity, imageUrl },
  });
}
