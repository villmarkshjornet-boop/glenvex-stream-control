import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import type { MemberProfile } from './memberTracker';
import { deductXP, ALLE_BADGES } from './memberTracker';
import { renderPersonaCard } from './cardRenderer';
import { logSystemEvent } from './systemEvents';

const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'glenvex-default';
const REROLL_XP_COST = 250;

// ── Season ────────────────────────────────────────────────────────────────────

const SEASON = process.env.PERSONA_SEASON ?? 'default';

const SEASON_STYLE: Record<string, string> = {
  default:   'Dark cyberpunk. Neon green GLENVEX energy. Futuristic gaming aesthetic.',
  halloween: 'Spooky Halloween. Dark purple and orange neon. Gothic cyberpunk.',
  christmas: 'Winter holiday. Ice blue and neon red. Festive cyberpunk.',
  tarkov:    'Military tactical. Worn-out gear. Dark realism with green highlights.',
  gta:       'Street crime aesthetic. Graffiti neon. Urban chaos.',
  fantasy:   'High fantasy. Magic runes. Neon glowing swords and shields.',
};

const SEASON_SUFFIX = SEASON_STYLE[SEASON] ?? SEASON_STYLE.default;

// ── Rarity — deterministisk score ────────────────────────────────────────────

export type PersonaRarity = 'Common' | 'Rare' | 'Epic' | 'Legendary' | 'Mythic';

function trekkSjeldenhet(member: MemberProfile): PersonaRarity {
  const aktivitet   = Math.min(40, member.messages * 0.15 + member.voiceMinutes * 0.05 + member.streamsAttended * 2);
  const xpBonus     = Math.min(10, Math.floor(member.xp / 500));
  const badgeBonus  = Math.min(15, member.badges.length * 3);
  const streakBonus = Math.min(15, member.streakDays * 1.5);
  const tilfeldig   = Math.random() * 20;
  const score       = aktivitet + xpBonus + badgeBonus + streakBonus + tilfeldig;

  if (score >= 96) return 'Mythic';
  if (score >= 86) return 'Legendary';
  if (score >= 71) return 'Epic';
  if (score >= 51) return 'Rare';
  return 'Common';
}

// Rarity display config
export const RARITY_COLOR: Record<PersonaRarity, number> = {
  Common:    0x9e9e9e,
  Rare:      0x1565c0,
  Epic:      0x7b1fa2,
  Legendary: 0xf9a825,
  Mythic:    0xd50000,
};

const RARITY_BANNER: Record<PersonaRarity, string> = {
  Common:    '▪ COMMON',
  Rare:      '▸▸ RARE ◂◂',
  Epic:      '◈◈◈ EPIC ◈◈◈',
  Legendary: '✦ LEGENDARY ✦',
  Mythic:    '⚡ M Y T H I C ⚡',
};

const RARITY_STARS: Record<PersonaRarity, string> = {
  Common:    '⭐',
  Rare:      '⭐⭐',
  Epic:      '⭐⭐⭐',
  Legendary: '⭐⭐⭐⭐',
  Mythic:    '⭐⭐⭐⭐⭐',
};

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface PersonaStats {
  hype:        number;
  chaos:       number;
  community:   number;
  focus:       number;
  humor:       number;
  activity:    number;
  helpfulness: number;
  kreativitet: number;
  loyalitet:   number;
  lederskap:   number;
}

export interface PersonaCard {
  // Identitet
  title:          string;   // "THE MEME WARRIOR" — stor bokstav, slagkraftig
  class:          string;   // "Chaos Viking" / "The Strategist" / "Meme Lord"
  archetype:      string;   // RPG-arketype: Berserker, Paladin, Rogue, etc.
  rarity:         PersonaRarity;
  // Innhold
  description:    string;   // 3-4 korte linjer, ikke ett avsnitt
  signatureMove:  string;   // Navn på ultimate ability
  signatureMoveDesc: string; // Kort beskrivelse av ability
  quote:          string;   // Karaktersitat
  flavorText:     string;   // Lore-setning — som på ekte samlekort
  // Stats (10 stk)
  stats:          PersonaStats;
  // Bilde
  imagePrompt:    string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statBar(val: number, len = 8): string {
  const filled = Math.round((val / 100) * len);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, len - filled));
}

function getSb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const ws = require('ws');
  return createClient(url, key, { realtime: { transport: ws }, auth: { persistSession: false, autoRefreshToken: false } });
}

function trekkFraXP(member: MemberProfile, antall: number): void {
  member.xp = Math.max(0, member.xp - antall);
  deductXP(member.id, antall);
}

// ── Collection number ─────────────────────────────────────────────────────────

async function hentCollectionNumber(discordId: string): Promise<number> {
  const sb = getSb();
  if (!sb) return 1;
  const { count } = await sb
    .from('community_persona_history')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .eq('discord_id', discordId);
  return (count ?? 0) + 1;
}

// ── Unlocks list ──────────────────────────────────────────────────────────────

function byggUnlocks(member: MemberProfile): string[] {
  const unlocks: string[] = [];
  const all = [
    { check: member.messages >= 1,            tekst: '💬 Første melding sendt' },
    { check: member.messages >= 10,           tekst: '📣 10 meldinger' },
    { check: member.messages >= 100,          tekst: '🗨️ 100 meldinger' },
    { check: member.voiceMinutes >= 5,        tekst: '🎙️ Første voice-økt' },
    { check: member.voiceMinutes >= 60,       tekst: '🎧 1 time i voice' },
    { check: member.streamsAttended >= 1,     tekst: '📺 Første stream' },
    { check: member.streamsAttended >= 5,     tekst: '⭐ 5 streams' },
    { check: member.streakDays >= 7,          tekst: '🔥 7-dagers streak' },
    { check: member.level >= 5,              tekst: '🏅 Level 5' },
    { check: member.level >= 10,             tekst: '💎 Level 10' },
    { check: member.level >= 20,             tekst: '👑 Level 20' },
    { check: member.giftSubs >= 1,           tekst: '🎁 Giftet en sub' },
    { check: member.raids >= 1,              tekst: '🚀 Raider' },
    { check: member.subs >= 1,              tekst: '💜 Subscriber' },
  ];
  for (const u of all) {
    if (u.check) unlocks.push(u.tekst);
  }
  return unlocks.slice(0, 6); // maks 6 i kortet
}

// ── XP progress bar ───────────────────────────────────────────────────────────

const XP_PER_LEVEL = 250;

function xpProgressBar(xp: number): string {
  const level    = Math.floor(xp / XP_PER_LEVEL) + 1;
  const levelXP  = (level - 1) * XP_PER_LEVEL;
  const nextXP   = level * XP_PER_LEVEL;
  const pct      = Math.min(1, (xp - levelXP) / (nextXP - levelXP));
  const bar      = statBar(Math.round(pct * 100), 10);
  return `Lv ${level}  ${bar}  ${xp - levelXP}/${nextXP - levelXP} XP`;
}

// ── Hent eksisterende persona fra DB ─────────────────────────────────────────

export async function hentSistePersona(discordId: string): Promise<{ card: PersonaCard; imageUrl: string | null; rerollCount: number; collectionNumber: number } | null> {
  const sb = getSb();
  if (!sb) return null;
  const { data } = await sb
    .from('community_personas')
    .select('*')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('discord_id', discordId)
    .eq('season', SEASON)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (!data) return null;

  // Hent faktisk posisjon i samlingen (antall historikk-rader)
  let collectionNumber = (data.reroll_count ?? 0) + 1;
  try {
    const { count } = await sb
      .from('community_persona_history')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', WORKSPACE_ID)
      .eq('discord_id', discordId);
    if (count !== null) collectionNumber = count;
  } catch {}

  return {
    card: {
      title:             data.persona_title ?? '',
      class:             data.persona_class ?? '',
      archetype:         data.archetype ?? data.persona_class ?? '',
      rarity:            data.rarity as PersonaRarity,
      description:       data.description ?? '',
      signatureMove:     data.signature_move ?? '',
      signatureMoveDesc: data.signature_move_desc ?? '',
      quote:             data.quote ?? '',
      flavorText:        data.flavor_text ?? '',
      stats:             (data.stats as PersonaStats) ?? defaultStats(),
      imagePrompt:       data.image_prompt ?? '',
    },
    imageUrl:        data.image_url ?? null,
    rerollCount:     data.reroll_count ?? 0,
    collectionNumber,
  };
}

function defaultStats(): PersonaStats {
  return { hype: 50, chaos: 50, community: 50, focus: 50, humor: 50, activity: 50, helpfulness: 50, kreativitet: 50, loyalitet: 50, lederskap: 50 };
}

// ── GPT-generering av persona (V2) ───────────────────────────────────────────

async function genererPersonaJson(member: MemberProfile, rarity: PersonaRarity, openai: OpenAI): Promise<PersonaCard | null> {
  const badgeStr    = member.badges.slice(-5).join(', ') || 'ingen ennå';
  const rarityHint  =
    rarity === 'Mythic'    ? 'MYTHIC — ekstremt sjelden. Lag en legendarisk, episk karakter. Gå ALL IN!'
    : rarity === 'Legendary' ? 'LEGENDARY — særdeles spesiell. Gi karakteren makt og personlighet.'
    : rarity === 'Epic'      ? 'EPIC — sterk, unik personlighet. Noe over gjennomsnittet.'
    : rarity === 'Rare'      ? 'RARE — distinkt. En karakter som skiller seg ut.'
    : 'COMMON — vanlig, men sjarmerende. Litt humor er bra.';

  const prompt = `Du er en humoristisk RPG-spillmester som lager Discord community samlekort — tenk Pokémon, Hearthstone, Clash Royale.
Lag ett UNIKT, morsomt og positivt samlekort basert KUN på aktivitetsdataene nedenfor.

AKTIVITETSDATA:
- Brukernavn: ${member.username}
- Level: ${member.level}
- XP: ${member.xp}
- Meldinger: ${member.messages}
- Voice-minutter: ${member.voiceMinutes}
- Streams deltatt: ${member.streamsAttended}
- Reaksjoner: ${member.reactions}
- Badges: ${badgeStr}
- Streak (dager aktiv): ${member.streakDays}
- Gift Subs: ${member.giftSubs}

SJELDENHET: ${rarityHint}

REGLER:
- ALDRI kommenter kjønn, alder, kropp, utseende, religion eller politikk.
- Stats skal speile faktiske data: høye meldinger → høy activity/chaos, mye voice → høy community/lederskap
- "title" = stort slagkraftig navn på STORE bokstaver, f.eks. "THE MEME WARRIOR" eller "CHAOS ARCHITECT" eller "VOICE OF THE NORTH"
- "class" = en arketype-tittel, f.eks. "Chaos Viking", "The Strategist", "Meme Wizard"
- "archetype" = RPG-klasse, f.eks. "Berserker", "Support", "Rogue", "Paladin", "Bard", "Warlock"
- "description" = 3-4 KORTE linjer (IKKE ett avsnitt). Tenk dikt-stil. Morsomt og treffende.
- "signatureMove" = navn på ultimate ability, store bokstaver, f.eks. "WALL OF TEXT" eller "CHAOS BURST"
- "signatureMoveDesc" = 1 kort, morsom setning om hva abilityen gjør
- "quote" = 1 karaktersitat på norsk, som på et ekte samlekort
- "flavorText" = én lore-setning nederst på kortet. Tenk "Ryktene sier..." eller "Ingen vet når han begynte å skrive..."
- Stats er 0-100. Lag variasjon — ikke alle 50.
- "imagePrompt" = 1 engelsk setning for DALL-E 3. Fiktiv karakter basert på klassen. ALDRI ekte ansikt. ALDRI realistisk person.

Svar KUN med JSON (ingen annen tekst):
{
  "title": "THE [NOKO EPISK]",
  "class": "klasse-tittel",
  "archetype": "RPG-klasse",
  "description": "linje1\\nlinje2\\nlinje3",
  "signatureMove": "ABILITY NAME",
  "signatureMoveDesc": "én setning om hva abilityen gjør",
  "quote": "karaktersitat på norsk",
  "flavorText": "lore-setning nederst på kortet",
  "stats": {
    "hype": 0-100,
    "chaos": 0-100,
    "community": 0-100,
    "focus": 0-100,
    "humor": 0-100,
    "activity": 0-100,
    "helpfulness": 0-100,
    "kreativitet": 0-100,
    "loyalitet": 0-100,
    "lederskap": 0-100
  },
  "imagePrompt": "english DALL-E prompt, fictional stylized character, no real face, trading card art"
}`;

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.92,
      max_tokens: 900,
      response_format: { type: 'json_object' },
    });
    const raw    = res.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as Partial<PersonaCard>;
    return {
      title:             (parsed.title ?? 'THE UNKNOWN').toUpperCase(),
      class:             parsed.class             ?? 'Mysterious',
      archetype:         parsed.archetype         ?? 'Wanderer',
      rarity,
      description:       parsed.description       ?? '',
      signatureMove:     (parsed.signatureMove ?? 'UNKNOWN POWER').toUpperCase(),
      signatureMoveDesc: parsed.signatureMoveDesc ?? '...',
      quote:             parsed.quote             ?? '...',
      flavorText:        parsed.flavorText        ?? '',
      stats:             { ...defaultStats(), ...(parsed.stats ?? {}) },
      imagePrompt:       parsed.imagePrompt       ?? `Futuristic gaming character, neon green, cyberpunk trading card art`,
    };
  } catch { return null; }
}

// ── DALL-E bilgenerering ──────────────────────────────────────────────────────

async function genererBilde(card: PersonaCard, openai: OpenAI): Promise<string | null> {
  // Pure character art — no card borders, no text, no card layout elements
  const fullPrompt =
    `Stylized fantasy character portrait. ${SEASON_SUFFIX} ` +
    `${card.archetype} class character — ${card.class} archetype. ` +
    `${card.imagePrompt}. ` +
    `Dramatic cinematic lighting. Dynamic pose. Detailed illustration. ` +
    `NO text, NO words, NO card frame, NO UI elements, NO realistic human face. ` +
    `Semi-cartoon game art. Centered portrait composition. Square format.`;
  try {
    const res = await openai.images.generate({
      model: 'dall-e-3', prompt: fullPrompt, n: 1, size: '1024x1024', quality: 'standard',
    });
    return res.data?.[0]?.url ?? null;
  } catch (e: any) {
    console.warn('[Persona] Bildegenerering feilet:', e?.message);
    return null;
  }
}

// ── Lagre i DB ────────────────────────────────────────────────────────────────

const PERSONA_PROMPT_VERSION = 'v2';
const PERSONA_MODEL           = 'gpt-4o-mini';
const PERSONA_IMAGE_MODEL     = 'dall-e-3';

async function lagrePersona(
  member: MemberProfile,
  card: PersonaCard,
  imageUrl: string | null,
  xpCost: number,
  rerollCount: number,
): Promise<void> {
  const sb = getSb();
  if (!sb) return;

  const personaRow = {
    workspace_id:       WORKSPACE_ID,
    discord_id:         member.id,
    username:           member.username,
    display_name:       member.displayName,
    season:             SEASON,
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
    xp_cost:            xpCost,
    reroll_count:       rerollCount,
    generator_version:  PERSONA_PROMPT_VERSION,
    model:              PERSONA_MODEL,
    image_model:        PERSONA_IMAGE_MODEL,
    generated_at:       new Date().toISOString(),
    created_at:         new Date().toISOString(),
    updated_at:         new Date().toISOString(),
  };

  await sb.from('community_personas').upsert(personaRow, { onConflict: 'workspace_id,discord_id,season' });

  const { id: _omit, ...historikkRow } = personaRow as any;
  await sb.from('community_persona_history').insert(historikkRow);
}

// ── Bygg Discord embed (V2 — Samlekort-design) ───────────────────────────────

export function byggPersonaEmbed(
  card: PersonaCard,
  imageUrl: string | null,
  username: string,
  rerollCount: number,
  member: MemberProfile,
  collectionNumber: number,
) {
  const color   = RARITY_COLOR[card.rarity];
  const banner  = RARITY_BANNER[card.rarity];
  const stars   = RARITY_STARS[card.rarity];

  const topStats = [
    ['🔥 Hype',     card.stats.hype],
    ['😂 Humor',    card.stats.humor],
    ['⚡ Chaos',    card.stats.chaos],
    ['🤝 Community',card.stats.community],
    ['🎯 Focus',    card.stats.focus],
    ['💬 Aktivitet',card.stats.activity],
    ['💡 Kreativitet',card.stats.kreativitet],
    ['❤️ Lojalitet', card.stats.loyalitet],
    ['🧠 Lederskap', card.stats.lederskap],
    ['🙌 Hjelpsom', card.stats.helpfulness],
  ] as [string, number][];

  // Top 5 stats + bottom 5 stats (to kolonner)
  const sorted = [...topStats].sort((a, b) => b[1] - a[1]);
  const col1   = sorted.slice(0, 5).map(([n, v]) => `${n}\n${statBar(v)} ${v}`).join('\n');
  const col2   = sorted.slice(5).map(([n, v]) => `${n}\n${statBar(v)} ${v}`).join('\n');

  const unlocks    = byggUnlocks(member);
  const unlockStr  = unlocks.length > 0 ? unlocks.join('\n') : '—';
  const xpProgress = xpProgressBar(member.xp);
  const badgesStr  = member.badges.length > 0
    ? member.badges.slice(-6).join(' · ')
    : '—';

  const description =
    `**${banner}**  ${stars}\n` +
    `### ${card.title}\n` +
    `*${card.class}*  ·  **${card.archetype}**\n\n` +
    `*"${card.quote}"*`;

  return {
    color,
    description,
    fields: [
      {
        name: '📖 Beskrivelse',
        value: card.description || '—',
        inline: false,
      },
      {
        name: '⚡ Ultimate Ability',
        value: `**${card.signatureMove}**\n*${card.signatureMoveDesc}*`,
        inline: false,
      },
      {
        name: '📊 Stats',
        value: '```' + col1 + '```',
        inline: true,
      },
      {
        name: '​',
        value: '```' + col2 + '```',
        inline: true,
      },
      {
        name: '🏆 Badges',
        value: badgesStr,
        inline: false,
      },
      {
        name: '🔓 Unlocks',
        value: unlockStr,
        inline: true,
      },
      {
        name: '📈 Progress',
        value: '`' + xpProgress + '`',
        inline: true,
      },
      {
        name: '​',
        value: `*${card.flavorText}*`,
        inline: false,
      },
    ],
    image:  imageUrl ? { url: imageUrl } : undefined,
    footer: {
      text: `GLENVEX PERSONA  ·  Season: ${SEASON}  ·  Card #${String(collectionNumber).padStart(3, '0')}  ·  @${username}`,
    },
    timestamp: new Date().toISOString(),
  };
}

// ── Hoved-eksport ─────────────────────────────────────────────────────────────

export interface PersonaResult {
  card:             PersonaCard;
  imageUrl:         string | null;
  cardPng:          Buffer | null;   // ferdig PNG-samlekort
  xpCost:           number;
  rerollCount:      number;
  collectionNumber: number;
  ersteGang:        boolean;
}

export async function genererPersona(member: MemberProfile, erReroll: boolean): Promise<PersonaResult | { feil: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { feil: 'OPENAI_API_KEY mangler på Railway.' };

  const eksisterende   = await hentSistePersona(member.id);
  const rerollCount    = (eksisterende?.rerollCount ?? 0) + (erReroll ? 1 : 0);
  const xpCost         = erReroll ? REROLL_XP_COST : 0;

  if (erReroll) {
    if (!eksisterende) return { feil: 'Du har ingen eksisterende persona å rerulle. Bruk `/persona` uten parametere først.' };
    if (member.xp < REROLL_XP_COST) return { feil: `Du trenger ${REROLL_XP_COST} XP for å rerulle. Du har ${member.xp} XP.` };
    trekkFraXP(member, REROLL_XP_COST);
  }

  const openai           = new OpenAI({ apiKey });
  const rarity           = trekkSjeldenhet(member);
  const card             = await genererPersonaJson(member, rarity, openai);
  if (!card) return { feil: 'AI klarte ikke å generere persona. Prøv igjen om litt.' };

  const imageUrl         = await genererBilde(card, openai);
  const collectionNumber = await hentCollectionNumber(member.id);
  await lagrePersona(member, card, imageUrl, xpCost, rerollCount);

  // Render PNG-samlekort (fallback til V2 embed hvis dette feiler)
  let cardPng: Buffer | null = null;
  try {
    cardPng = await renderPersonaCard(card, imageUrl, member, collectionNumber);
  } catch (e: any) {
    console.warn('[Persona] PNG-rendering feilet:', e?.message);
    logSystemEvent({
      source: 'discord_bot', event_type: 'PERSONA_CARD_IMAGE_FAILED',
      title: `Persona PNG-rendering feilet for ${member.username}`,
      severity: 'warning',
      metadata: { userId: member.id, username: member.username, error: e?.message, rarity: card.rarity },
    });
  }

  return { card, imageUrl, cardPng, xpCost, rerollCount, collectionNumber, ersteGang: !eksisterende };
}

export { renderPersonaCard } from './cardRenderer';
export { RARITY_STARS, RARITY_BANNER, REROLL_XP_COST };
