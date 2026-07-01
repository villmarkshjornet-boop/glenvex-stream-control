import OpenAI, { toFile } from 'openai';
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

// ── gpt-image-1 — identity-based trading card ────────────────────────────────
// AI transforms the Discord avatar into an epic game character.
// Canvas only overlays: name, title, XP, badges, card#, season.
//
// Model: gpt-image-1  Size: 1024x1536  Quality: high
// Edit endpoint used when avatar is available (identity preservation).
// Generate endpoint used as fallback (no avatar).

const RARITY_FRAME_STYLE: Record<PersonaRarity, string> = {
  Common:
    'matte dark steel frame, subtle engraved geometric patterns, deep charcoal gunmetal tones, industrial craft, dignified',
  Rare:
    'royal cerulean blue crystal frame, glowing azure energy lines on frame edges, cool particle wisps drifting at borders',
  Epic:
    'dark violet arcane frame carved with glowing runes, purple magenta energy tendrils at corners, crackling arcane electricity',
  Legendary:
    'ornate 24-karat gold filigree frame, intricate baroque scrollwork, warm divine light rays from corners, celestial golden particles',
  Mythic:
    'blood-red cosmic void obsidian frame, crimson lightning at corners, swirling void tendrils, dense particle storm, terrifying and magnificent',
};

const RARITY_COLOR_GRADE: Record<PersonaRarity, string> = {
  Common:    'cool steel grays, subtle blue-gray shadows, grounded matte finish',
  Rare:      'azure navy tones, cerulean highlights, crisp elemental clarity',
  Epic:      'deep purples, violet shadows, electric magenta accents, arcane shimmer',
  Legendary: 'warm gold color grade, amber god rays, rich divine contrast',
  Mythic:    'blood red and cosmic black, bursts of white-hot plasma, void shadows',
};

const RARITY_MOOD: Record<PersonaRarity, string> = {
  Common:    'gritty determination, grounded strength, earned respect',
  Rare:      'noble elemental mastery, quiet dangerous confidence',
  Epic:      'mysterious arcane power, dark mastery, controlled danger',
  Legendary: 'chosen one energy, mythical grandeur, destiny fulfilled',
  Mythic:    'cosmic horror turned champion, divine wrath, power that reshapes reality',
};

const ARCHETYPE_ENVIRONMENT: Record<string, string> = {
  Bard:       'concert stage with neon spotlights, crowd silhouettes behind, screens and light rigs above',
  Berserker:  'epic chaotic battlefield, fire and destruction behind them, storm clouds, fallen enemy banners',
  Paladin:    'grand cathedral interior, divine light through stained glass windows, holy energy rising from floor',
  Rogue:      'rain-soaked rooftop at night, city neon reflections in puddles below, smoke, moonlight and shadows',
  Warlock:    'dark forbidden arcane library, floating spell crystals, dimensional rift portal, ancient tomes orbiting',
  Support:    'warm grand community hall, banners and crowd in background, sense of belonging and protection',
  Hunter:     'misty ancient forest at dawn, golden light shafts through canopy, leaves falling, animal tracks',
  Mage:       'floating ethereal arcane laboratory, glowing spell circles on floor, magical instruments orbiting',
  Warrior:    'fortress battlements at sunset, banners flying, sense of victory, army behind them',
  Wanderer:   'dramatic scenic vista at golden hour, epic landscape stretching to horizon, wind energy',
};

// ── Avatar download ───────────────────────────────────────────────────────────

async function downloadAvatar(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
}

// ── Supabase Storage upload → permanent public URL ────────────────────────────

async function uploadKortBilde(buf: Buffer, discordId: string): Promise<string | null> {
  const sb = getSb();
  if (!sb) return null;

  const bucket  = 'persona-cards';
  const filePath = `${WORKSPACE_ID}/${discordId}/${SEASON}.png`;

  const doUpload = async () =>
    sb.storage.from(bucket).upload(filePath, buf, { contentType: 'image/png', upsert: true });

  let { error } = await doUpload();

  if (error) {
    // Bucket might not exist yet — try creating it
    if (error.message?.toLowerCase().includes('not found') || error.message?.toLowerCase().includes('does not exist')) {
      try {
        await sb.storage.createBucket(bucket, { public: true });
        ({ error } = await doUpload());
      } catch {}
    }
    if (error) {
      console.warn('[Persona] Storage upload feilet:', error.message);
      return null;
    }
  }

  const { data } = sb.storage.from(bucket).getPublicUrl(filePath);
  return data?.publicUrl ?? null;
}

// ── Image prompt (identity-based) ────────────────────────────────────────────

function byggImagePrompt(card: PersonaCard): string {
  const s = card.stats;
  const visuals: string[] = [];
  if (s.humor     > 75) visuals.push('laughing or grinning — joyful positive energy radiating from them');
  if (s.chaos     > 75) visuals.push('chaotic magical explosions and wild energy swirling around them');
  if (s.focus     > 75) visuals.push('calm, intense focused eyes — precise controlled masterful stance');
  if (s.community > 75) visuals.push('strong leadership presence — protective posture, others drawn to their energy');
  if (s.hype      > 75) visuals.push('dramatically energetic dynamic pose, spotlight on them');
  if (s.lederskap > 75) visuals.push('commanding natural authority, born leader — inspiring and powerful');
  if (s.kreativitet > 75) visuals.push('creative tools or instruments visible, artistic energy from hands');
  if (s.loyalitet > 75) visuals.push('steadfast loyal protector stance, shield or banner element');
  if (s.helpfulness > 75) visuals.push('open welcoming gesture, warm approachable energy');
  if (s.activity  > 80) visuals.push('dynamic action pose, motion blur effect, constant energy aura');

  const env = ARCHETYPE_ENVIRONMENT[card.archetype]
    ?? `epic ${card.archetype.toLowerCase()} setting, dramatic atmosphere matching the class`;

  return [
    `TRADING CARD CHARACTER TRANSFORMATION — COLLECTOR EDITION`,
    ``,
    `═══ IDENTITY PRESERVATION — MOST IMPORTANT RULE ═══`,
    `Transform THIS SPECIFIC PERSON into their epic game character version.`,
    `Preserve EXACTLY: facial structure, hair style and color, beard or stubble if present,`,
    `eye shape and color, skin tone, distinctive facial features, overall body silhouette.`,
    `Do NOT create a random new person. This IS the same person, as an epic hero.`,
    `They must look at this card and immediately think: "That is ME."`,
    ``,
    `STYLE CONSISTENCY (critical for rerolls):`,
    `The FACE stays the same person across every version.`,
    `Only OUTFIT, ARMOR, WEAPONS, ENVIRONMENT, and EFFECTS may vary per reroll.`,
    `Think: same actor, different costume and set.`,
    ``,
    `ARTISTIC STYLE:`,
    `Premium digital painting. Blizzard × Riot Games × Wizards of the Coast quality.`,
    `NOT photorealistic. NOT anime. NOT cartoon. NOT generic AI look.`,
    `High-end collector edition trading card illustration. Cinematic, epic, hand-crafted feel.`,
    ``,
    `CHARACTER:`,
    `Class: ${card.class} (${card.archetype} archetype)`,
    `Title: ${card.title}`,
    `Personality: ${card.description.split('\n').join(' ')}`,
    ``,
    `VISUAL PERSONALITY — show these traits in expression, pose, and effects:`,
    visuals.length > 0 ? visuals.join('; ') : 'powerful confident presence, commanding the frame',
    ``,
    `ENVIRONMENT: ${env}`,
    ``,
    `SEASON THEME: ${SEASON_SUFFIX}`,
    ``,
    `RARITY: ${card.rarity.toUpperCase()}`,
    `FRAME: ${RARITY_FRAME_STYLE[card.rarity]}`,
    `COLOR GRADE: ${RARITY_COLOR_GRADE[card.rarity]}`,
    `MOOD: ${RARITY_MOOD[card.rarity]}`,
    ``,
    `CARD COMPOSITION — STRICT PORTRAIT:`,
    `- Character fills 70–75% of frame, close to mid-shot, dominant and powerful`,
    `- BOTTOM 25–30% of card: dark, calm, no important details — reserved for data overlay`,
    `- Decorative rarity frame/border around entire card matching rarity style`,
    ``,
    `NON-NEGOTIABLE:`,
    `- ZERO TEXT anywhere. No letters, numbers, words, symbols.`,
    `- Preserve the person's identity. They must recognize themselves.`,
    `- Portrait orientation (tall, not wide).`,
    `- Must make the viewer say: "WOW — that is actually me as a game character."`,
  ].join('\n');
}

// ── Image generation — edit (avatar) or generate (fallback) ──────────────────

async function genererBilde(
  card:      PersonaCard,
  avatarBuf: Buffer | null,
  openai:    OpenAI,
): Promise<Buffer | null> {
  const prompt = byggImagePrompt(card);

  try {
    let raw: string | null | undefined;

    if (avatarBuf) {
      // Transform Discord avatar into game character (identity-preserving)
      const avatarFile = await toFile(avatarBuf, 'avatar.png', { type: 'image/png' });
      const res = await (openai.images as any).edit({
        model:   'gpt-image-1',
        image:   avatarFile,
        prompt,
        size:    '1024x1536',
        quality: 'high',
      });
      raw = res.data?.[0]?.b64_json;
    } else {
      // No avatar available — generate from scratch
      const res = await openai.images.generate({
        model:   'gpt-image-1' as any,
        prompt,
        n:       1,
        size:    '1024x1536' as any,
        quality: 'high' as any,
      });
      raw = (res.data?.[0] as any)?.b64_json;
    }

    if (!raw) return null;
    return Buffer.from(raw, 'base64');
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

export async function genererPersona(
  member: MemberProfile,
  erReroll: boolean,
  avatarUrl?: string | null,
): Promise<PersonaResult | { feil: string }> {
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

  // Download Discord avatar for identity-based transformation
  const avatarBuf = avatarUrl ? await downloadAvatar(avatarUrl) : null;

  // Generate image via gpt-image-1 (edit=avatar-based, generate=fallback)
  const imageBuf  = await genererBilde(card, avatarBuf, openai);

  // Upload to Supabase Storage → persistent URL (never expires)
  let imageUrl: string | null = null;
  if (imageBuf) {
    imageUrl = await uploadKortBilde(imageBuf, member.id);
  }

  const collectionNumber = await hentCollectionNumber(member.id);
  await lagrePersona(member, card, imageUrl, xpCost, rerollCount);

  // Render PNG — pass buffer directly (skip re-fetch, same data we just generated)
  let cardPng: Buffer | null = null;
  try {
    cardPng = await renderPersonaCard(card, imageBuf, member, collectionNumber, avatarUrl);
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
