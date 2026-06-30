import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import type { MemberProfile } from './memberTracker';
import { deductXP } from './memberTracker';

const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'glenvex-default';
const REROLL_XP_COST = 250;

// ── Season-konfigurasjon ──────────────────────────────────────────────────────

const SEASON = process.env.PERSONA_SEASON ?? 'default';

const SEASON_STYLE: Record<string, string> = {
  default:    'Dark cyberpunk. Neon green GLENVEX energy. Futuristic gaming aesthetic.',
  halloween:  'Spooky Halloween. Dark purple and orange neon. Gothic cyberpunk.',
  christmas:  'Winter holiday. Ice blue and neon red. Festive cyberpunk.',
  tarkov:     'Military tactical. Worn-out gear. Dark realism with green highlights.',
  gta:        'Street crime aesthetic. Graffiti neon. Urban chaos.',
  fantasy:    'High fantasy. Magic runes. Neon glowing swords and shields.',
};

const SEASON_SUFFIX = SEASON_STYLE[SEASON] ?? SEASON_STYLE.default;

// ── Sjeldenhet-loddtrekning ───────────────────────────────────────────────────

export type PersonaRarity = 'Common' | 'Rare' | 'Epic' | 'Legendary' | 'Mythic';

function trekkSjeldenhet(xp: number, streakDays: number, rerollCount: number): PersonaRarity {
  const boost = Math.min(20, Math.floor(xp / 500)) + Math.min(10, streakDays);
  const roll  = Math.random() * 100 + boost;
  if (roll >= 98) return 'Mythic';
  if (roll >= 88) return 'Legendary';
  if (roll >= 72) return 'Epic';
  if (roll >= 50) return 'Rare';
  return 'Common';
}

const RARITY_COLOR: Record<PersonaRarity, number> = {
  Common:    0x9e9e9e,
  Rare:      0x1565c0,
  Epic:      0x7b1fa2,
  Legendary: 0xe65100,
  Mythic:    0xffd700,
};

const RARITY_STARS: Record<PersonaRarity, string> = {
  Common:    '⭐☆☆☆☆',
  Rare:      '⭐⭐☆☆☆',
  Epic:      '⭐⭐⭐☆☆',
  Legendary: '⭐⭐⭐⭐☆',
  Mythic:    '⭐⭐⭐⭐⭐',
};

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface PersonaStats {
  chaos:       number;
  hype:        number;
  community:   number;
  focus:       number;
  helpfulness: number;
}

export interface PersonaCard {
  title:         string;
  class:         string;
  rarity:        PersonaRarity;
  description:   string;
  strengths:     string[];
  weaknesses:    string[];
  signatureMove: string;
  quote:         string;
  stats:         PersonaStats;
  imagePrompt:   string;
}

function statBar(val: number, len = 10): string {
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

// ── XP-behandling ─────────────────────────────────────────────────────────────

function trekkFraXP(member: MemberProfile, antall: number): void {
  member.xp = Math.max(0, member.xp - antall);
  deductXP(member.id, antall);
}

// ── Hent eksisterende persona fra DB ─────────────────────────────────────────

export async function hentSistePersona(discordId: string): Promise<{ card: PersonaCard; imageUrl: string | null; rerollCount: number } | null> {
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
  return {
    card: {
      title: data.persona_title ?? '',
      class: data.persona_class ?? '',
      rarity: data.rarity as PersonaRarity,
      description: data.description ?? '',
      strengths: (data.strengths as string[]) ?? [],
      weaknesses: (data.weaknesses as string[]) ?? [],
      signatureMove: data.signature_move ?? '',
      quote: data.quote ?? '',
      stats: (data.stats as PersonaStats) ?? { chaos: 50, hype: 50, community: 50, focus: 50, helpfulness: 50 },
      imagePrompt: data.image_prompt ?? '',
    },
    imageUrl: data.image_url ?? null,
    rerollCount: data.reroll_count ?? 0,
  };
}

// ── GPT-generering av persona ─────────────────────────────────────────────────

async function genererPersonaJson(member: MemberProfile, rarity: PersonaRarity, openai: OpenAI): Promise<PersonaCard | null> {
  const badgeStr  = member.badges.slice(-5).join(', ') || 'ingen';
  const rarityHint = rarity === 'Mythic' ? 'MYTHIC — ekstremt sjelden og episk. Gjør den legendarisk!'
    : rarity === 'Legendary' ? 'Legendary — meget spesiell, kraftfull karakter.'
    : rarity === 'Epic'      ? 'Epic — sterk og unik personlighet.'
    : rarity === 'Rare'      ? 'Rare — over gjennomsnittet, distinkt.'
    : 'Common — vanlig, men likevel sjarmerende og morsom.';

  const prompt = `Du er en humoristisk RPG-spillmester som lager Discord community persona-kort.
Lag en morsom, positiv og IKKE-sårende karakter basert på Discord-aktivitet.

AKTIVITETSDATA (bruk BARE dette):
- Brukernavn: ${member.username}
- Level: ${member.level}
- XP: ${member.xp}
- Meldinger: ${member.messages}
- Voice-minutter: ${member.voiceMinutes}
- Streams deltatt: ${member.streamsAttended}
- Reaksjoner: ${member.reactions}
- Badges: ${badgeStr}
- Streak (dager aktiv): ${member.streakDays}
- Subs gitt: ${member.giftSubs}

SJELDENHET: ${rarityHint}

REGLER:
- Ikke kommenter kjønn, alder, kropp, utseende, religion eller politikk.
- Ikke finn på ting som ikke er støttet av dataene.
- Lag noe brukeren ønsker å dele videre.
- Stats skal reflektere faktisk aktivitet (høye messages → høy chaos/hype, høy voice → høy community).
- Tenk World of Warcraft klasse-stil: Paladin, Rogue, Berserker, Support, etc.
- imagePrompt: 1 kort engelsk setning for DALL-E 3, beskriver den fiktive karakteren visuelt.
  ALDRI ekte ansikt, ALDRI realistisk person. Fiktiv karakter.

Svar KUN med JSON (ingen annen tekst):
{
  "title": "kortfattet tittel",
  "class": "klasse/type",
  "description": "2 setninger på norsk som beskriver denne personaen morsomt",
  "strengths": ["styrke1", "styrke2", "styrke3"],
  "weaknesses": ["svakhet1", "svakhet2"],
  "signatureMove": "signaturtrekk",
  "quote": "karaktersitat på norsk (1 setning)",
  "stats": { "chaos": 0-100, "hype": 0-100, "community": 0-100, "focus": 0-100, "helpfulness": 0-100 },
  "imagePrompt": "english DALL-E prompt, fictional character, no real face"
}`;

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
      max_tokens: 700,
      response_format: { type: 'json_object' },
    });
    const raw = res.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as Partial<PersonaCard>;
    return {
      title:         parsed.title         ?? 'The Unknown',
      class:         parsed.class         ?? 'Mysterious',
      rarity,
      description:   parsed.description   ?? '',
      strengths:     parsed.strengths     ?? [],
      weaknesses:    parsed.weaknesses    ?? [],
      signatureMove: parsed.signatureMove ?? '?',
      quote:         parsed.quote         ?? '...',
      stats:         parsed.stats         ?? { chaos: 50, hype: 50, community: 50, focus: 50, helpfulness: 50 },
      imagePrompt:   parsed.imagePrompt   ?? `Futuristic gaming character, neon green, cyberpunk`,
    };
  } catch { return null; }
}

// ── DALL-E bilgenerering ──────────────────────────────────────────────────────

async function genererBilde(card: PersonaCard, openai: OpenAI): Promise<string | null> {
  const fullPrompt =
    `Collectible trading card art. Stylized gaming character portrait. ` +
    `${SEASON_SUFFIX} ` +
    `Character: ${card.class} — ${card.title}. ` +
    `${card.imagePrompt}. ` +
    `Card frame with glowing border. Epic lighting. No text. No real face. Semi-cartoon. 1:1 portrait.`;
  try {
    const res = await openai.images.generate({
      model: 'dall-e-3',
      prompt: fullPrompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
    });
    return res.data?.[0]?.url ?? null;
  } catch (e: any) {
    console.warn('[Persona] Bildegenerering feilet:', e?.message);
    return null;
  }
}

// ── Lagre i DB ────────────────────────────────────────────────────────────────

async function lagrePersona(
  member: MemberProfile,
  card: PersonaCard,
  imageUrl: string | null,
  xpCost: number,
  rerollCount: number,
): Promise<void> {
  const sb = getSb();
  if (!sb) return;
  await sb.from('community_personas').insert({
    workspace_id:   WORKSPACE_ID,
    discord_id:     member.id,
    username:       member.username,
    display_name:   member.displayName,
    season:         SEASON,
    persona_title:  card.title,
    persona_class:  card.class,
    rarity:         card.rarity,
    description:    card.description,
    strengths:      card.strengths,
    weaknesses:     card.weaknesses,
    signature_move: card.signatureMove,
    quote:          card.quote,
    stats:          card.stats,
    image_prompt:   card.imagePrompt,
    image_url:      imageUrl,
    xp_cost:        xpCost,
    reroll_count:   rerollCount,
    created_at:     new Date().toISOString(),
    updated_at:     new Date().toISOString(),
  });
}

// ── Bygg Discord embed-data ──────────────────────────────────────────────────

export function byggPersonaEmbed(card: PersonaCard, imageUrl: string | null, username: string, rerollCount: number) {
  const color  = RARITY_COLOR[card.rarity];
  const stars  = RARITY_STARS[card.rarity];

  const statsFelt = [
    `Kaos        ${statBar(card.stats.chaos)}  ${card.stats.chaos}`,
    `Hype        ${statBar(card.stats.hype)}  ${card.stats.hype}`,
    `Community   ${statBar(card.stats.community)}  ${card.stats.community}`,
    `Fokus       ${statBar(card.stats.focus)}  ${card.stats.focus}`,
    `Hjelpsomhet ${statBar(card.stats.helpfulness)}  ${card.stats.helpfulness}`,
  ].join('\n');

  const embed: any = {
    color,
    title: `🎭  ${card.title}`,
    description:
      `**${card.class}**  ·  ${stars}  ·  *${card.rarity}*\n\n` +
      `*"${card.quote}"*`,
    fields: [
      {
        name: '📖 Beskrivelse',
        value: card.description,
        inline: false,
      },
      {
        name: '💪 Styrker',
        value: card.strengths.map(s => `• ${s}`).join('\n') || '—',
        inline: true,
      },
      {
        name: '😅 Svakheter',
        value: card.weaknesses.map(w => `• ${w}`).join('\n') || '—',
        inline: true,
      },
      {
        name: '⚡ Signaturtrekk',
        value: card.signatureMove,
        inline: false,
      },
      {
        name: '📊 Stats',
        value: '```' + statsFelt + '```',
        inline: false,
      },
    ],
    image:  imageUrl ? { url: imageUrl } : undefined,
    footer: { text: `GLENVEX AI Persona · Season: ${SEASON} · Persona #${rerollCount + 1} for @${username}` },
    timestamp: new Date().toISOString(),
  };

  return embed;
}

// ── Hoved-eksport ─────────────────────────────────────────────────────────────

export interface PersonaResult {
  card:        PersonaCard;
  imageUrl:    string | null;
  xpCost:      number;
  rerollCount: number;
  ersteGang:   boolean;
}

export async function genererPersona(member: MemberProfile, erReroll: boolean): Promise<PersonaResult | { feil: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { feil: 'OPENAI_API_KEY mangler på Railway.' };

  // Sjekk XP ved reroll
  const eksisterende = await hentSistePersona(member.id);
  const rerollCount   = eksisterende?.rerollCount ?? 0;
  const xpCost        = erReroll ? REROLL_XP_COST : 0;

  if (erReroll) {
    if (!eksisterende) return { feil: 'Du har ingen eksisterende persona å rerulle. Bruk `/persona` uten parametere først.' };
    if (member.xp < REROLL_XP_COST) return { feil: `Du trenger ${REROLL_XP_COST} XP for å rerulle. Du har ${member.xp} XP.` };
    trekkFraXP(member, REROLL_XP_COST);
  }

  const openai  = new OpenAI({ apiKey });
  const rarity  = trekkSjeldenhet(member.xp, member.streakDays, rerollCount + (erReroll ? 1 : 0));
  const card    = await genererPersonaJson(member, rarity, openai);
  if (!card) return { feil: 'AI klarte ikke å generere persona. Prøv igjen.' };

  const imageUrl = await genererBilde(card, openai);
  await lagrePersona(member, card, imageUrl, xpCost, rerollCount + (erReroll ? 1 : 0));

  return {
    card,
    imageUrl,
    xpCost,
    rerollCount: rerollCount + (erReroll ? 1 : 0),
    ersteGang: !eksisterende,
  };
}

export { RARITY_COLOR, RARITY_STARS, REROLL_XP_COST };
