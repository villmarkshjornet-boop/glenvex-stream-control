import OpenAI, { toFile } from 'openai';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { MemberProfile } from './memberTracker';
import { ALLE_BADGES } from './memberTracker';
import { spendCoins, COIN_RATES } from './coinService';
import { addCardToCollection } from './cardCollectionService';
import { renderPersonaCard } from './cardRenderer';
import { logSystemEvent } from './systemEvents';
import { callChatCompletion, callImageGeneration } from './openaiWrapper';
import { selectArchetypeCandidates, getArchetype, archetypeExists, scoreAllArchetypes } from './archetypeLibrary';
import { XP_PER_LEVEL } from '@/lib/xp';
import { type PersonaRarity, RARITY_COLOR, rarityFromScore } from '@/lib/rarity';

const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'glenvex-default';
const REROLL_COIN_COST = COIN_RATES.CARD_REROLL_COST;  // 100 coins

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

// PersonaRarity, RARITY_COLOR — imported from @/lib/rarity (single source of truth)
export type { PersonaRarity };

function trekkSjeldenhet(member: MemberProfile): PersonaRarity {
  const aktivitet   = Math.min(40, member.messages * 0.15 + member.voiceMinutes * 0.05 + member.streamsAttended * 2);
  const xpBonus     = Math.min(10, Math.floor(member.xp / 500)); // 500 = XP bonus scale, not level threshold
  const badgeBonus  = Math.min(15, member.badges.length * 3);
  const streakBonus = Math.min(15, member.streakDays * 1.5);
  const score       = aktivitet + xpBonus + badgeBonus + streakBonus + Math.random() * 20;
  return rarityFromScore(score);
}

export { RARITY_COLOR };

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
// XP_PER_LEVEL imported from @/lib/xp

function xpProgressBar(xp: number): string {
  const level   = Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1;
  const levelXP = (level - 1) * XP_PER_LEVEL;
  const nextXP  = level * XP_PER_LEVEL;
  const pct     = Math.min(1, Math.max(0, (xp - levelXP) / (nextXP - levelXP)));
  const bar     = statBar(Math.round(pct * 100), 10);
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

  // Score archetypes against member activity — deterministic scores for logging,
  // jittered candidates for GPT so rerolls diverge on identical stats.
  const allScored   = scoreAllArchetypes(member);
  const candidates  = selectArchetypeCandidates(member, 5);

  console.log(`[Persona] ── Archetype candidates for ${member.username} (${rarity}) ──`);
  for (const { arch, score, rank } of candidates) {
    console.log(`  #${rank}  ${arch.name.padEnd(24)} score=${score.toFixed(3)}  "${arch.personality.slice(0, 60)}…"`);
  }
  // Log what position each candidate holds in the deterministic ranking
  for (const cand of candidates) {
    const det = allScored.find(s => s.arch.name === cand.arch.name);
    if (det) console.log(`       deterministic rank: #${det.rank}  raw=${det.score.toFixed(3)}`);
  }

  const candidateList = candidates
    .map(s => `• ${s.arch.name} — ${s.arch.personality}`)
    .join('\n');

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

ARCHETYPE KANDIDATER — velg den som passer best til aktivitetsdataene:
${candidateList}

REGLER:
- ALDRI kommenter kjønn, alder, kropp, utseende, religion eller politikk.
- Stats skal speile faktiske data: høye meldinger → høy activity/chaos, mye voice → høy community/lederskap
- "title" = stort slagkraftig navn på STORE bokstaver. La den valgte archetypen forme tittelen: en Chaos Mage får kaotisk tittel, en Guild Master får autoritær tittel.
- "class" = en kreativ arketype-tittel, f.eks. "Chaos Viking", "The Strategist", "Meme Wizard"
- "archetype" = ett av kandidatnavnene over (skriv NØYAKTIG som vist — ingen varianter)
- "description" = 3-4 KORTE linjer (IKKE ett avsnitt). Tenk dikt-stil. Morsomt og treffende.
- "signatureMove" = navn på ultimate ability, store bokstaver. Skal passe archetypens kraft og stil naturlig.
- "signatureMoveDesc" = 1 kort, morsom setning — stil og tone skal matche archetypen
- "quote" = 1 karaktersitat på norsk, som på et ekte samlekort
- "flavorText" = én lore-setning som lyder som den kommer fra archetypens verden. Tenk "Ryktene sier..." eller "Ingen vet når han begynte å skrive..."
- Stats er 0-100. Lag variasjon — ikke alle 50.
- "imagePrompt" = 1 engelsk setning om karakterens vibes. Fiktiv karakter basert på klassen. ALDRI ekte ansikt.

Svar KUN med JSON (ingen annen tekst):
{
  "title": "THE [NOKO EPISK]",
  "class": "klasse-tittel",
  "archetype": "ett av kandidatnavnene",
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
  "imagePrompt": "english sentence about character vibes, no real face, trading card art"
}`;

  try {
    const res = await callChatCompletion(
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.92,
        max_tokens: 900,
        response_format: { type: 'json_object' },
      },
      { source: 'persona_service', workspaceId: WORKSPACE_ID },
    );
    if (!res) return null;

    const raw    = res.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as Partial<PersonaCard>;

    // Validate archetype — fall back to top-scored candidate if GPT hallucinated
    let chosenArchetype = parsed.archetype ?? '';
    const inLibrary = archetypeExists(chosenArchetype);
    if (!inLibrary) {
      const fallback = candidates[0]?.arch.name ?? 'Wanderer';
      console.warn(`[Persona] ⚠ GPT valgte "${chosenArchetype}" — ikke i library. Fallback → "${fallback}"`);
      chosenArchetype = fallback;
    }

    const candidateNames = candidates.map(s => s.arch.name).join(', ');
    const wasInCandidates = candidates.some(s => s.arch.name === chosenArchetype);
    console.log(`[Persona] Valgt archetype: "${chosenArchetype}" ${inLibrary ? '✅' : '⚠ fallback'}${!wasInCandidates && inLibrary ? ' (i library men ikke i topp-5)' : ''}`);
    console.log(`[Persona] Kandidater sendt til GPT: ${candidateNames}`);

    const archLib = getArchetype(chosenArchetype);
    if (archLib) {
      console.log(`[Persona] Personality match: "${archLib.personality}"`);
    }

    return {
      title:             (parsed.title ?? 'THE UNKNOWN').toUpperCase(),
      class:             parsed.class             ?? 'Mysterious',
      archetype:         chosenArchetype,
      rarity,
      description:       parsed.description       ?? '',
      signatureMove:     (parsed.signatureMove ?? 'UNKNOWN POWER').toUpperCase(),
      signatureMoveDesc: parsed.signatureMoveDesc ?? '...',
      quote:             parsed.quote             ?? '...',
      flavorText:        parsed.flavorText        ?? '',
      stats:             { ...defaultStats(), ...(parsed.stats ?? {}) },
      imagePrompt:       parsed.imagePrompt       ?? `Futuristic gaming character, neon green, cyberpunk trading card art`,
    };
  } catch (e: any) {
    // JSON parse errors or other non-OpenAI failures
    console.error('[Persona] genererPersonaJson feilet (parse/logic):', e?.message ?? e);
    return null;
  }
}

export { genererPersonaJson };

// ── gpt-image-1 — identity-based trading card ────────────────────────────────
// AI transforms the Discord avatar into an epic game character.
// Canvas only overlays: name, title, XP, badges, card#, season.
//
// Model: gpt-image-1  Size: 1024x1536  Quality: high
// Edit endpoint used when avatar is available (identity preservation).
// Generate endpoint used as fallback (no avatar).

// Per-rarity: frame description, color grade, mood, and visual effects
// These drive the entire WOW factor — each tier must feel dramatically different.

const RARITY_VISUAL: Record<PersonaRarity, {
  frame:  string;
  colors: string;
  mood:   string;
  fx:     string;
}> = {
  Common: {
    frame:  'Clean polished dark charcoal steel frame with precise geometric engravings. Brushed gunmetal finish. Silver corner reinforcements. Professional military-grade craft. No glow, no particles — pure earned mastery.',
    colors: 'High-contrast black and silver. Cool blue-gray highlights. Sharp crisp shadows. Deep rich darks. Matte finish with selective metallic sheen on armor and weapons.',
    mood:   'A veteran warrior — every scar earned. Gritty determination, grounded strength, dangerous competence.',
    fx:     'Sharp rim light from behind outlining the silhouette. Clean atmospheric depth. Subtle volumetric fog in the background. No particle effects — the person IS the spectacle.',
  },
  Rare: {
    frame:  'Cerulean blue crystal frame — cool blue light glowing from within the crystal channels. Azure energy particles slowly drifting upward at card edges. Sapphire gem accents at corners.',
    colors: 'Electric blue and cobalt with icy white highlights. Vibrant saturated blues. Cold chromatic energy. Background fades from deep navy to cobalt blue.',
    mood:   'Touched by elemental power. Noble dangerous confidence. A force of nature barely contained.',
    fx:     'Azure particle wisps rising from ground. Electric blue rim light from behind. Glowing blue accents on armor and weapons. Subtle ice crystal formations in environment.',
  },
  Epic: {
    frame:  'Dark violet arcane frame with glowing purple runes carved into every surface — runes pulse with visible magical energy. Purple and magenta energy tendrils curl inward from all four corners. Crackling arcane electricity sparks at the edges.',
    colors: 'Deep violet, electric magenta, dark purple. High-drama contrast — near-black shadows with explosive vivid purple highlights. Otherworldly and dangerous.',
    mood:   'Wielder of forbidden arcane power. Dark mastery. Controlled danger on the edge of catastrophe. Mysterious and magnificent.',
    fx:     'Dramatic arcane tendrils wrapping the character. Floating glowing spell fragments in air. Purple lightning crackling around hands and weapons. Glowing spell circles on the ground beneath them. Strong shadow contrast amplified by bright violet light sources.',
  },
  Legendary: {
    frame:  '24-karat gold ornate baroque frame — intricate filigree scrollwork at every corner and edge. Warm golden light visibly emanating from frame edges. Multiple divine light rays shoot from all four corners into the card. The frame radiates authority.',
    colors: 'Rich warm gold, deep amber, radiant divine white. God rays and golden particles fill the air. The world around the character basks in warm divine light.',
    mood:   'The chosen one. Destiny incarnate. A person the universe itself selected. Pure mythical grandeur and unshakeable authority.',
    fx:     'DRAMATIC gold god rays streaming from behind the character toward viewer. Golden particle storm suspended in air around them. Warm amber bloom lighting their face from below. Glowing divine sigils in background. Character radiates visible energy — they ARE the light source.',
  },
  Mythic: {
    frame:  'Jet black cosmic void frame lined with blood-red plasma lightning crackling violently at every edge and corner. Void tendrils seeping inward from the black frame into the card. Simultaneously beautiful and terrifying. A frame that should not exist.',
    colors: 'Deep void black, explosive white-hot plasma cores, blood crimson energy. Reality itself looks wrong around this character. Color exists as an afterthought to raw power.',
    mood:   'A being that transcended hero and legend. Cosmic horror turned champion. Divine wrath with total control. Power that reshapes what is possible.',
    fx:     'Crimson-white lightning erupting from all four corners toward the character. Dense particle storm engulfing the card. Dimensional cracks showing cosmic void beyond reality. Character wreathed in an impossible combination of dark void and blinding white plasma energy. Multiple overlapping light sources creating a transcendent impossible glow.',
  },
};

// Environment and visual data are now sourced from archetypeLibrary.ts

// ── Avatar download ───────────────────────────────────────────────────────────

async function downloadAvatar(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
}

// ── Avatar classification ─────────────────────────────────────────────────────
// Before generating, we need to know what the avatar actually IS.
// Real human photos → preserve identity (gpt-image-1 edit + identity prompt).
// Illustrations/logos/characters → use as style reference, not identity.

interface AvatarClassification {
  type: 'human' | 'art';
  description: string;  // "bearded man with glasses", "green anime ninja", "wolf mascot"
}

async function classifyAvatar(avatarBuf: Buffer, openai: OpenAI): Promise<AvatarClassification> {
  const base64 = avatarBuf.toString('base64');
  const res = await callChatCompletion(
    {
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}`, detail: 'low' } },
          {
            type: 'text',
            text: `Classify this Discord avatar.

Is this:
A) A REAL photograph of an actual human being (realistic face, real person)
B) ANYTHING ELSE: anime, cartoon, logo, game character, animal, mascot, drawing, illustration, AI art, robot, creature, symbol, etc.

Write a SHORT description (max 10 words) of what you see.

Respond with ONLY valid JSON, no other text:
{"type": "human" or "art", "description": "short description"}`,
          },
        ],
      }],
      max_tokens: 80,
      temperature: 0,
    },
    { source: 'persona_service', workspaceId: WORKSPACE_ID },
  );

  if (!res) {
    return { type: 'art', description: 'avatar character' };
  }

  try {
    const raw    = (res.choices[0]?.message?.content ?? '{}').trim();
    const parsed = JSON.parse(raw);
    const cls: AvatarClassification = {
      type:        parsed.type === 'human' ? 'human' : 'art',
      description: (parsed.description ?? 'avatar character') as string,
    };
    console.log(`[Persona] Avatar classified as "${cls.type}": ${cls.description}`);
    return cls;
  } catch (e: any) {
    console.warn('[Persona] Avatar classification JSON parse feilet:', e?.message, '— defaulter til "art"');
    return { type: 'art', description: 'avatar character' };
  }
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

// ── Structured persona context (drives image prompt) ─────────────────────────

interface PersonaImageContext {
  displayName:        string;
  title:              string;
  archetype:          string;
  klass:              string;
  rarity:             PersonaRarity;
  personality:        string[];
  strengths:          string[];
  weaknesses:         string[];
  statLines:          string[];  // "HYPE: 92", "CHAOS: 81", ...
  ultimateName:       string;
  ultimateDesc:       string;
  flavor:             string;
  environment:        string;
  archetypeCharacter: string;
  archetypeEffects:   string;
  season:             string;
  rarityVisual:       { frame: string; colors: string; mood: string; fx: string };
}

function byggPersonaContext(card: PersonaCard, displayName: string): PersonaImageContext {
  const s = card.stats;

  // Personality from top stats
  const personality: string[] = [];
  if (s.humor     > 70) personality.push('funny and charismatic');
  if (s.hype      > 70) personality.push('high energy and hype-generating');
  if (s.community > 70) personality.push('community-focused and welcoming');
  if (s.chaos     > 70) personality.push('chaotic and unpredictable');
  if (s.focus     > 70) personality.push('sharp, focused and strategic');
  if (s.lederskap > 70) personality.push('natural-born leader');
  if (s.kreativitet > 70) personality.push('creative and expressive');
  if (s.loyalitet  > 70) personality.push('deeply loyal and protective');
  if (s.helpfulness > 70) personality.push('helpful and supportive');
  if (s.activity   > 70) personality.push('constantly active and engaged');
  if (personality.length === 0) personality.push('powerful and self-assured');

  // Strengths = stats above 75
  const strengths = (Object.entries(s) as [keyof PersonaStats, number][])
    .filter(([, v]) => v > 75)
    .sort(([, a], [, b]) => b - a)
    .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1));

  // Weaknesses = stats below 45
  const weaknesses = (Object.entries(s) as [keyof PersonaStats, number][])
    .filter(([, v]) => v < 45)
    .sort(([, a], [, b]) => a - b)
    .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1));

  // Top 5 stat lines for the prompt
  const statLines = (Object.entries(s) as [keyof PersonaStats, number][])
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([k, v]) => `${k.toUpperCase()}: ${v}`);

  const archLib           = getArchetype(card.archetype);
  const environment       = archLib?.environment ?? `epic dramatic setting perfectly matching a ${card.archetype} archetype`;
  const archetypeCharacter = archLib?.character  ?? `powerful ${card.archetype} with epic equipment fitting their class`;
  const archetypeEffects   = archLib?.effects    ?? `dramatic atmospheric effects matching their power level`;

  return {
    displayName,
    title:              card.title,
    archetype:          card.archetype,
    klass:              card.class,
    rarity:             card.rarity,
    personality,
    strengths,
    weaknesses,
    statLines,
    ultimateName:       card.signatureMove,
    ultimateDesc:       card.signatureMoveDesc,
    flavor:             card.flavorText,
    environment,
    archetypeCharacter,
    archetypeEffects,
    season:             SEASON_SUFFIX,
    rarityVisual:       RARITY_VISUAL[card.rarity],
  };
}

// ── Stat-driven visual direction ─────────────────────────────────────────────
// The DOMINANT stat determines what the entire illustration SHOWS.
// A Chaos Mage (99 chaos) and a Community Guardian (98 community) must look
// like completely different heroes — not just different armor.

function statDrivenVisual(ctx: PersonaImageContext): string[] {
  const topLine  = ctx.statLines[0] ?? '';
  const colonIdx = topLine.indexOf(':');
  const topKey   = topLine.slice(0, colonIdx).trim().toLowerCase();
  const topVal   = parseInt(topLine.slice(colonIdx + 1).trim(), 10);

  if (topVal < 70) {
    return [`Show the full power of the ${ctx.archetype} archetype — commanding presence, dramatic environment, and effects that make this card look like a collector trophy.`];
  }

  const visuals: Record<string, string[]> = {
    chaos: [
      `CHAOS IS THE DOMINANT FORCE. This character does not just have chaos around them — they ARE chaos incarnate.`,
      `Reality tears apart around them. Chat bubbles, message fragments, arcane symbols, and digital glitch artifacts FLY in all directions as if expelled by their very presence.`,
      `Lightning arcs between floating debris. Spell circles explode outward. A vortex of wild uncontrolled energy erupts from the ground beneath them.`,
      `The environment is actively breaking down — walls crack, physics fails, explosions bloom in the background. This is the eye of a storm that answers only to them.`,
    ],
    community: [
      `COMMUNITY AND CONNECTION RADIATE FROM THIS CHARACTER. They are the undeniable heart of a gathering.`,
      `Warm welcoming light emanates outward from their body — reaching toward others like a beacon. Shield emblems, unity sigils, and crowd energy encircle them.`,
      `Silhouettes of followers are visible in the background — they orbit this person like planets orbit a star.`,
      `The atmosphere is warm but powerful: this is the protector, the anchor, the one everyone follows into the unknown.`,
    ],
    hype: [
      `PURE HYPE. This character is caught at the absolute peak of a hype moment — maximum energy, maximum impact.`,
      `Dynamic explosive pose. Speed lines. Motion blur trails. Energy rings erupting outward in all directions.`,
      `The entire image feels like it is MOVING — kinetic, electric, and completely unstoppable. You feel the adrenaline through the screen.`,
      `Crowd energy aura, explosive light effects, impact shockwaves. Looking at this card gives you a physical rush.`,
    ],
    lederskap: [
      `ABSOLUTE AUTHORITY. This figure radiates command — everyone in the image, and everyone looking at the image, knows who is in charge.`,
      `Elevated position, commanding stance, army banners or insignia rising behind them like monuments.`,
      `Golden authority energy streams downward from above. Imposing armor that says "I have led armies and I will lead more."`,
      `Followers are visible as silhouettes behind them — loyal, ready. The light chooses this person deliberately.`,
    ],
    focus: [
      `PERFECT FOCUS. Absolute stillness surrounded by total chaos — and the character does not flinch.`,
      `Laser-focused eyes narrow with extreme precision. Every element of the scene is exactly where they calculated it would be.`,
      `Geometric targeting energy, sharp tactical lines, a calm tactical overlay effect in the air around them.`,
      `The world slows down for this person. They are the fixed point that everything else rotates around.`,
    ],
    humor: [
      `THE GRIN IS THE MOST POWERFUL THING ON THIS CARD. This character's charisma and humor are their primary weapon.`,
      `Their expression dominates the illustration — wide magnetic grin, bright mischievous eyes, energy that makes everyone feel included.`,
      `Jester-like chaos but CONTROLLED. Vibrant impossible colors. Fun and danger exist in perfect balance.`,
      `The environment reflects their personality — nothing is quite where it should be, and somehow that makes everything better.`,
    ],
    kreativitet: [
      `CREATION ENERGY IS PHYSICALLY VISIBLE. Art and reality are being actively shaped by this character's presence.`,
      `Light trails, color explosions, and brushstroke-like energy effects radiate from their hands and body.`,
      `Reality is being reshaped and reinvented. Colors manifest and crystallize wherever they gesture.`,
      `A creator deity made flesh — they do not follow rules because they are writing new ones in real time.`,
    ],
    loyalitet: [
      `UNBREAKABLE LOYALTY HAS BECOME A PHYSICAL FORCE. This guardian cannot and will not retreat.`,
      `Protective shield energy forms around them like a second skin — visible, glowing, impenetrable.`,
      `Steadfast immovable stance. Shield glyphs, protective ward circles, guardian emblems radiate outward.`,
      `Warm protective aura reaching toward others. They have always been here. They will always be here.`,
    ],
    helpfulness: [
      `HEALING AND SUPPORT LIGHT RADIATES OUTWARD FROM EVERY PART OF THIS CHARACTER.`,
      `Warm golden healing light streams from their hands and body toward others — visible, physical, and beautiful.`,
      `Support runes, healing particle streams, protective glow surround them completely.`,
      `The environment brightens and stabilizes in their presence. Others would never fall while this character stands.`,
    ],
    activity: [
      `PERPETUAL MOTION — this character has been everywhere simultaneously and the evidence is all around them.`,
      `Motion blur trails, overlapping energy signatures showing constant presence in multiple locations.`,
      `Speed, presence, blur effects — they appear in six places at once and somehow that feels right.`,
      `The most active force in this universe — always moving, always here, always there, always everywhere.`,
    ],
  };

  return visuals[topKey] ?? [`The ${ctx.archetype} archetype at full power — every visual element of this illustration must express what this archetype IS.`];
}

// ── Image prompt — identity-first, stat-driven visual story ───────────────────

function byggImagePrompt(ctx: PersonaImageContext): string {
  const r          = ctx.rarityVisual;
  const statVisual = statDrivenVisual(ctx);

  return [
    `IDENTITY — THIS IS THE SINGLE MOST IMPORTANT INSTRUCTION IN THIS ENTIRE PROMPT:`,
    `The reference image shows the EXACT person whose card this is.`,
    `You are NOT creating a new character. You are TRANSFORMING the person in the reference image.`,
    `Their face MUST be immediately recognizable. If someone held this card next to their Discord profile photo they must say "that is ME."`,
    ``,
    `PRESERVE WITHOUT EXCEPTION:`,
    `• Face shape and facial proportions`,
    `• Eye color and eye shape`,
    `• Hair color, length, and style`,
    `• Beard, stubble, or clean shave — exactly as shown`,
    `• Glasses if worn — same shape and style`,
    `• Skin tone`,
    `• Distinctive facial features, scars, marks`,
    ``,
    `TRANSFORM everything else: clothing, armor, weapons, costume, background, lighting, atmospheric effects.`,
    `NEVER change the face. The face is the anchor. The face is the card.`,
    ``,
    `═══ STAT-DRIVEN VISUAL STORY ═══`,
    `Top stats: ${ctx.statLines.slice(0, 3).join(' | ')}`,
    ``,
    ...statVisual,
    ``,
    `═══ PERSONA ═══`,
    `Archetype: ${ctx.archetype}  |  Class: ${ctx.klass}  |  Title: ${ctx.title}`,
    `Environment: ${ctx.environment}`,
    `Character costume and equipment: ${ctx.archetypeCharacter}`,
    `Archetype atmospheric effects: ${ctx.archetypeEffects}`,
    `Season style: ${ctx.season}`,
    ``,
    `═══ RARITY: ${ctx.rarity.toUpperCase()} ═══`,
    r.mood,
    `Frame: ${r.frame}`,
    `Colors: ${r.colors}`,
    `Effects: ${r.fx}`,
    ``,
    `═══ COMPOSITION + LIGHTING ═══`,
    `Portrait tall card. Character fills 65–75% of image height.`,
    `ZONE ARCHITECTURE — the card overlays semi-transparent panels on top of your image:`,
    `  TOP 0–4%: small header bar — very dark`,
    `  TOP 4–16%: title zone — SEMI-TRANSPARENT panel, character BODY shows through here`,
    `  16%–53%: CHARACTER WINDOW — face and upper body DOMINATE this zone`,
    `  BOTTOM 53–100%: data panels — very dark, fade to near-black at 60%`,
    `CRITICAL: Character's FACE must be at 18–40% of image height.`,
    `Character body starts at ~10%, face at 18–40%, body fills down to 65%.`,
    `Below 60%: fade to near-black (data overlays here — keep dark).`,
    `Strong dramatic rim light from behind. Powerful key light on the face.`,
    `Volumetric god rays or energy beams in environment. Character is the light source.`,
    ``,
    `═══ STYLE ═══`,
    `Premium digital painting. AAA collector trading card quality.`,
    `Reference aesthetic: Magic: The Gathering × Hearthstone × Riot Games.`,
    `NOT photorealistic. NOT anime. NOT generic AI art. Hand-crafted, intentional, collector-tier.`,
    ``,
    `═══ HARD RESTRICTIONS ═══`,
    `⚠ NO TEXT. No letters. No numbers. No runes. No symbols. No watermarks. No logos. No UI.`,
    `⚠ PRESERVE THE FACE FROM THE REFERENCE IMAGE — this is non-negotiable.`,
    `⚠ Vivid, high-contrast colors. Never muddy, never flat, never desaturated.`,
    `⚠ The image alone must look like a premium collector card before any text is added.`,
  ].join('\n');
}

// ── DALL-E 3 fallback prompt (under 4000 chars, no identity) ─────────────────

function byggDALLE3Prompt(ctx: PersonaImageContext): string {
  const r          = ctx.rarityVisual;
  const statVisual = statDrivenVisual(ctx);
  return [
    `Premium collector trading card illustration. ${ctx.rarity} rarity.`,
    `Archetype: ${ctx.archetype}. Class: ${ctx.klass}. Title: ${ctx.title}.`,
    `Top stats: ${ctx.statLines.slice(0, 3).join(' | ')}.`,
    ``,
    statVisual[0] ?? '',
    statVisual[1] ?? '',
    ``,
    `Environment: ${ctx.environment}`,
    `Character: ${ctx.archetypeCharacter}`,
    `Effects: ${ctx.archetypeEffects}`,
    ``,
    `Rarity mood: ${r.mood}`,
    `Frame: ${r.frame}`,
    `Colors: ${r.colors}`,
    `Effects: ${r.fx}`,
    ``,
    `Style: AAA digital painting. Magic: The Gathering × Hearthstone quality.`,
    `Portrait tall card. Character face centered in upper-middle area. TOP 16% and BOTTOM 46% must be very dark.`,
    `NO TEXT. NO LETTERS. NO RUNES. NO WATERMARKS. Vivid high-contrast colors.`,
  ].join('\n').slice(0, 3900);
}

// ── Art/style-reference prompt (for non-human avatars) ───────────────────────
// When the avatar is an illustration, logo, or character — we DON'T preserve
// a face. Instead we amplify the character's existing identity: colors,
// type, symbolism, expression, theme → epic trading card version.

function byggArtStylePrompt(ctx: PersonaImageContext, avatarDescription: string): string {
  const r          = ctx.rarityVisual;
  const statVisual = statDrivenVisual(ctx);

  return [
    `CHARACTER STYLE TRANSFORMATION:`,
    `The reference image shows: "${avatarDescription}"`,
    `This is NOT a real person. DO NOT generate a human face from it.`,
    `Transform this character/avatar/symbol into an EPIC, premium trading card illustration.`,
    ``,
    `PRESERVE FROM THE REFERENCE:`,
    `• Color palette (exact dominant colors)`,
    `• Character type: ninja stays ninja, wolf stays wolf, robot stays robot`,
    `• Core symbolism and personality of the character`,
    `• Distinctive markings, shapes, accessories`,
    ``,
    `AMPLIFY: Make it dramatic, epic, AAA-quality. Triple the energy and detail.`,
    ``,
    `═══ STAT-DRIVEN VISUAL STORY ═══`,
    `Top stats: ${ctx.statLines.slice(0, 3).join(' | ')}`,
    ``,
    ...statVisual,
    ``,
    `═══ PERSONA ═══`,
    `Archetype: ${ctx.archetype}  |  Class: ${ctx.klass}  |  Title: ${ctx.title}`,
    `Environment: ${ctx.environment}`,
    `Equipment/build: ${ctx.archetypeCharacter}`,
    `Atmospheric effects: ${ctx.archetypeEffects}`,
    `Season style: ${ctx.season}`,
    ``,
    `═══ RARITY: ${ctx.rarity.toUpperCase()} ═══`,
    r.mood,
    `Frame: ${r.frame}`,
    `Colors: ${r.colors} (blend with the avatar's own color palette)`,
    `Effects: ${r.fx}`,
    ``,
    `═══ COMPOSITION ═══`,
    `Portrait tall card. Character fills 60–70% of image height.`,
    `TOP 4% very dark (header). BOTTOM 46% very dark (data panels).`,
    `CHARACTER centered in middle zone.`,
    ``,
    `═══ STYLE ═══`,
    `Premium digital painting. Magic: The Gathering × Hearthstone × Riot Games.`,
    `NOT photorealistic. NOT generic AI art. Intentional collector-tier illustration.`,
    ``,
    `⚠ NO TEXT. No letters. No numbers. No watermarks. No logos.`,
    `⚠ DO NOT create a realistic human face. Keep the original character type.`,
    `⚠ Vivid, high-contrast. Never muddy or flat.`,
  ].join('\n').slice(0, 3900);
}

// ── Image generation — gpt-image-1 primary, DALL-E 3 fallback ────────────────

async function genererBilde(
  card:        PersonaCard,
  avatarBuf:   Buffer | null,
  openai:      OpenAI,
  displayName: string,
): Promise<Buffer | null> {
  const personaCtx = byggPersonaContext(card, displayName);

  // ── Classify avatar: real human vs illustration/logo/character ────────────
  let avatarType: AvatarClassification = { type: 'art', description: 'avatar character' };
  if (avatarBuf) {
    avatarType = await classifyAvatar(avatarBuf, openai);
  }

  // Choose prompt based on avatar type
  const isHuman     = avatarType.type === 'human';
  const mainPrompt  = isHuman
    ? byggImagePrompt(personaCtx)                                    // identity-lock
    : byggArtStylePrompt(personaCtx, avatarType.description);       // style-reference
  const shortPrompt = isHuman
    ? byggDALLE3Prompt(personaCtx)
    : byggArtStylePrompt(personaCtx, avatarType.description);       // already ≤ 3900 chars

  console.log(`[Persona] Mode: ${isHuman ? 'identity-preserving (human photo)' : `style-reference (${avatarType.description})`}`);

  // ── Forsøk 1: gpt-image-1 (Tier 4 required for edit, generate as fallback) ─
  try {
    let raw: string | null | undefined;

    if (avatarBuf) {
      // Use avatar as reference regardless of type:
      // - human → identity preservation
      // - art   → style/character reference
      const avatarFile = await toFile(avatarBuf, 'avatar.png', { type: 'image/png' });
      const res = await (openai.images as any).edit({
        model: 'gpt-image-1', image: avatarFile,
        prompt: mainPrompt, size: '1024x1536', quality: 'high',
      });
      raw = res.data?.[0]?.b64_json;
    } else {
      const res = await openai.images.generate({
        model: 'gpt-image-1' as any, prompt: mainPrompt,
        n: 1, size: '1024x1536' as any, quality: 'high' as any,
      });
      raw = (res.data?.[0] as any)?.b64_json;
    }

    if (raw) {
      console.log('[Persona] gpt-image-1 OK');
      return Buffer.from(raw, 'base64');
    }
    console.warn('[Persona] gpt-image-1 returnerte ingen data — prøver DALL-E 3');
  } catch (e: any) {
    console.error('[Persona] gpt-image-1 feilet:', e?.message ?? e);
    console.log('[Persona] Faller tilbake til DALL-E 3...');
  }

  // ── Forsøk 2: DALL-E 3 (tilgjengelig på alle tiers, ingen referansebilde) ─
  const dalleRes = await callImageGeneration(
    { model: 'dall-e-3', prompt: shortPrompt, n: 1, size: '1024x1792', quality: 'hd' },
    { source: 'persona_service', workspaceId: WORKSPACE_ID },
  );
  if (!dalleRes) return null;

  try {
    const url = dalleRes.data?.[0]?.url;
    if (!url) { console.warn('[Persona] DALL-E 3 returnerte ingen URL'); return null; }

    const imgRes = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!imgRes.ok) { console.warn('[Persona] DALL-E 3 nedlasting feilet:', imgRes.status); return null; }

    console.log('[Persona] DALL-E 3 OK');
    return Buffer.from(await imgRes.arrayBuffer());
  } catch (e: any) {
    console.error('[Persona] DALL-E 3 nedlasting feilet:', e?.message ?? e);
    return null;
  }
}

// ── Lagre i DB ────────────────────────────────────────────────────────────────

const PERSONA_PROMPT_VERSION = 'v3';
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
  xpCost:           number;          // always 0 (XP no longer deducted for reroll)
  coinCost:         number;          // 0 for first gen, REROLL_COIN_COST for rerolls
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

  const eksisterende = await hentSistePersona(member.id);
  const rerollCount  = (eksisterende?.rerollCount ?? 0) + (erReroll ? 1 : 0);
  const coinCost     = erReroll ? REROLL_COIN_COST : 0;

  if (erReroll) {
    if (!eksisterende) return { feil: 'Du har ingen eksisterende persona å rerulle. Bruk `/persona` uten parametere først.' };
    const { ok, error } = await spendCoins(member.id, REROLL_COIN_COST, 'card_reroll', { username: member.username });
    if (!ok) return { feil: error ?? `Du trenger ${REROLL_COIN_COST} coins for å rerulle.` };
  }

  const openai           = new OpenAI({ apiKey });
  const rarity           = trekkSjeldenhet(member);
  const card             = await genererPersonaJson(member, rarity, openai);
  if (!card) return { feil: 'AI klarte ikke å generere persona. Prøv igjen om litt.' };

  // Download Discord avatar for identity-based transformation
  const avatarBuf = avatarUrl ? await downloadAvatar(avatarUrl) : null;

  // Generate image via gpt-image-1 (edit=avatar-based, generate=fallback)
  const displayName = member.displayName || member.username;
  const imageBuf    = await genererBilde(card, avatarBuf, openai, displayName);

  // Upload to Supabase Storage → persistent URL (never expires)
  let imageUrl: string | null = null;
  if (imageBuf) {
    imageUrl = await uploadKortBilde(imageBuf, member.id);
  }

  const collectionNumber = await hentCollectionNumber(member.id);
  await lagrePersona(member, card, imageUrl, 0, rerollCount);

  // Save to card collection — all cards are kept, rerolls create new rows
  addCardToCollection({
    userId:      member.id,
    cardType:    'persona',
    rarity:      card.rarity,
    title:       card.title,
    klass:       card.class,
    archetype:   card.archetype,
    imageUrl,
    season:      SEASON,
    source:      rerollCount > 1 ? 'reroll' : 'generated',
    isActive:    true,
    isTradeable: true,
    stats:       card.stats as unknown as Record<string, number>,
    metadata:    {
      archetype:     card.archetype,
      signatureMove: card.signatureMove,
      quote:         card.quote,
      rerollCount,
      collectionNumber,
    },
  }).catch(() => {});

  // Render PNG — write imageBuf to temp file first so loadPersonaImage
  // can load via path (avoids @napi-rs/canvas Buffer bug on Windows).
  let cardPng:   Buffer | null = null;
  let imagePath: string | null = null;
  if (imageBuf) {
    imagePath = path.join(os.tmpdir(), `persona_${member.id}_${crypto.randomUUID()}.png`);
    fs.writeFileSync(imagePath, imageBuf);
    console.log(`[Persona] image temp path: ${imagePath} (${(imageBuf.length / 1024).toFixed(1)} KB)`);
  }
  try {
    cardPng = await renderPersonaCard(card, imagePath, member, collectionNumber, avatarUrl);
  } catch (e: any) {
    console.warn('[Persona] PNG-rendering feilet:', e?.message);
    console.error(e?.stack);
    logSystemEvent({
      source: 'discord_bot', event_type: 'PERSONA_CARD_IMAGE_FAILED',
      title: `Persona PNG-rendering feilet for ${member.username}`,
      severity: 'warning',
      metadata: { userId: member.id, username: member.username, error: e?.message, rarity: card.rarity },
    });
  } finally {
    if (imagePath) {
      try { fs.unlinkSync(imagePath); }
      catch { /* non-fatal */ }
    }
  }

  return { card, imageUrl, cardPng, xpCost: 0, coinCost, rerollCount, collectionNumber, ersteGang: !eksisterende };
}

export { renderPersonaCard } from './cardRenderer';
export { RARITY_STARS, RARITY_BANNER, REROLL_COIN_COST };
