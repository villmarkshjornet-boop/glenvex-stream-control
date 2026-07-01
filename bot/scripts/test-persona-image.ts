/**
 * TEST: DALL-E persona card generation — standalone, no Canvas, no Discord, no renderer.
 *
 * Usage:  npm run test:persona-image
 * Output: data/test-persona-card.png  +  full console log
 *
 * Tests ONLY the Prompt → OpenAI → PNG pipeline so we can verify
 * DALL-E is actually generating the card art we expect.
 */

import OpenAI, { toFile } from 'openai';
import fs from 'node:fs';
import path from 'node:path';

// ── Hardcoded test card (mirrors what GPT generates for a Common member) ──────
// Edit rarity/class/archetype to test different rarities.

const RARITY   = 'Common' as const;    // change to Rare / Epic / Legendary / Mythic
const ARCHETYPE = 'Bard';
const CLASS     = 'Chat Champion';
const IMAGE_PROMPT = 'A heroic cyberpunk bard character with neon green glowing lute, dramatic stage lighting, futuristic gaming aesthetic';

// ── Prompt constants (identical to personaService.ts) ─────────────────────────

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

const RARITY_VISUAL: Record<string, { frame: string; colors: string; mood: string; fx: string }> = {
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
    fx:     'Dramatic arcane tendrils wrapping the character. Floating glowing spell fragments in air. Purple lightning crackling around hands and weapons. Strong shadow contrast amplified by bright violet light sources.',
  },
  Legendary: {
    frame:  '24-karat gold ornate baroque frame — intricate filigree scrollwork at every corner and edge. Warm golden light visibly emanating from frame edges. Multiple divine light rays shoot from all four corners into the card.',
    colors: 'Rich warm gold, deep amber, radiant divine white. God rays and golden particles fill the air. The world around the character basks in warm divine light.',
    mood:   'The chosen one. Destiny incarnate. Pure mythical grandeur and unshakeable authority.',
    fx:     'DRAMATIC gold god rays streaming from behind the character. Golden particle storm suspended in air. Warm amber bloom lighting their face. Glowing divine sigils in background. Character radiates visible golden energy.',
  },
  Mythic: {
    frame:  'Jet black cosmic void frame lined with blood-red plasma lightning crackling violently at every edge and corner. Void tendrils seeping inward from the black frame. Simultaneously beautiful and terrifying.',
    colors: 'Deep void black, explosive white-hot plasma cores, blood crimson energy. Reality itself looks wrong around this character.',
    mood:   'A being that transcended hero and legend. Cosmic horror turned champion. Divine wrath with total control.',
    fx:     'Crimson-white lightning erupting from all four corners toward the character. Dense particle storm. Dimensional cracks showing cosmic void. Character wreathed in dark void and blinding white plasma energy.',
  },
};

function buildPrompt(rarity: string, archetype: string, klass: string, imagePrompt: string): string {
  const r = RARITY_VISUAL[rarity] ?? RARITY_VISUAL.Common;
  return `Transform the person in the reference image into a premium AAA trading card hero.

IDENTITY — NON-NEGOTIABLE:
Preserve their exact face: facial structure, hairstyle, hair color, beard or stubble, glasses if present, skin tone, eye color, and all distinctive features. Do NOT generate a random new person. This is the SAME person, reimagined as their ultimate hero self. They must look at this card and think: "That is ME." The face stays theirs — costume, armor, weapons and effects can be epic, but the face is the anchor.

ARTISTIC STYLE:
Premium digital painting at Blizzard Entertainment / Riot Games / Magic: The Gathering quality. Cinematic, epic, hand-crafted illustration. NOT photorealistic, NOT anime, NOT cartoon, NOT generic AI art.

LIGHTING (critical for WOW):
Strong dramatic rim light from behind creating glowing silhouette halo. Powerful key light on face from dramatic angle. Volumetric god rays in environment. Multiple colored light sources from rarity effects.

CHARACTER: ${klass} — ${archetype} archetype
Description: ${imagePrompt}
Season atmosphere: ${SEASON_SUFFIX}

RARITY: ${rarity.toUpperCase()}
Frame: ${r.frame}
Colors: ${r.colors}
Mood: ${r.mood}
Effects: ${r.fx}

COMPOSITION:
- Character fills 70–75% of card height, dominant close mid-shot framing
- Rich dramatic environment behind the character
- BOTTOM 25–30%: gradually fades to near-black — clean dark area for data overlay
- Rarity frame runs along all four edges

⚠ ABSOLUTE RULES:
- ZERO TEXT. No letters. No numbers. No symbols. No runes. No logos. No UI. Nothing.
- Preserve the person's face from the reference image.
- Portrait orientation only (tall card, not wide).
- Colors must be VIVID and HIGH-CONTRAST — not muddy, not dark and flat.
- The raw AI image alone must look like a premium collector card someone would pay for.`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('❌  OPENAI_API_KEY mangler i .env');
    process.exit(1);
  }

  const openai  = new OpenAI({ apiKey });
  const outDir  = path.resolve(process.cwd(), 'data');
  const outFile = path.join(outDir, 'test-persona-card.png');

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const prompt = buildPrompt(RARITY, ARCHETYPE, CLASS, IMAGE_PROMPT);

  // Avatar is REQUIRED — fail hard if missing (no silent fallback to generate)
  const avatarPath = path.join(outDir, 'test-avatar.png');
  if (!fs.existsSync(avatarPath)) {
    console.error('\n❌  data/test-avatar.png ikke funnet.');
    console.error('    Lagre Discord-avataren din som data/test-avatar.png for å teste identity mode.');
    console.error('    Hint: høyreklikk profilbilde i Discord → Kopier bildelenke, last ned.');
    process.exit(1);
  }
  const avatarBuf = fs.readFileSync(avatarPath);

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('  GLENVEX — test:persona-image (rå AI-bilde, ingen Canvas)');
  console.log('════════════════════════════════════════════════════════════════\n');
  console.log(`Rarity      : ${RARITY}`);
  console.log(`Archetype   : ${ARCHETYPE}`);
  console.log(`Class       : ${CLASS}`);
  console.log(`Model       : gpt-image-1`);
  console.log(`Size        : 1024x1536`);
  console.log(`Quality     : high`);
  console.log(`Season      : ${SEASON} — "${SEASON_SUFFIX}"`);
  console.log(`\n── AVATAR DIAGNOSTICS ──────────────────────────────────────────`);
  console.log(`Avatar path : ${avatarPath}`);
  console.log(`Avatar size : ${(avatarBuf.length / 1024).toFixed(1)} KB  (${avatarBuf.length} bytes)`);
  console.log(`Mime-type   : image/png  (sendt til edit() som 'avatar.png')`);
  console.log(`API call    : openai.images.edit() — identity-preserving transformation`);
  console.log(`Identity    : AI vil bevare ansikt, hår, skjegg, briller fra avatar`);
  console.log('\n── FULL PROMPT ─────────────────────────────────────────────────');
  console.log(prompt);
  console.log('────────────────────────────────────────────────────────────────\n');
  console.log('Kaller OpenAI images.edit()...');

  const t0  = Date.now();
  let buf: Buffer | null = null;

  try {
    let raw: string | null | undefined;

    // Always use images.edit() — avatar is required (fails above if missing)
    console.log(`Sender avatar (${(avatarBuf.length / 1024).toFixed(1)} KB) + prompt til openai.images.edit()...`);
    const avatarFile = await toFile(avatarBuf, 'avatar.png', { type: 'image/png' });
    console.log(`Avatar konvertert til File-objekt: name=${avatarFile.name} type=${avatarFile.type}`);

    const res = await (openai.images as any).edit({
      model:   'gpt-image-1',
      image:   avatarFile,
      prompt,
      size:    '1024x1536',
      quality: 'high',
    });
    raw = res.data?.[0]?.b64_json;

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    if (!raw) {
      console.error(`❌  OpenAI svarte uten b64_json (${elapsed}s)`);
      process.exit(1);
    }

    buf = Buffer.from(raw, 'base64');
    fs.writeFileSync(outFile, buf);
    console.log(`\n✅  Svar mottatt på ${elapsed}s`);
    console.log(`✅  Lagret til:  ${outFile}  (${(buf.length / 1024).toFixed(0)} KB)\n`);
    process.exit(0);

  } catch (err: any) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`\n❌  OpenAI feilet etter ${elapsed}s:`);
    console.error(`    message    : ${err?.message ?? err}`);
    console.error(`    HTTP status: ${err?.status ?? '?'}`);
    console.error(`    error.code : ${err?.code ?? '?'}`);
    console.error(`    error.type : ${err?.type ?? '?'}`);
    console.error(`    error.param: ${err?.param ?? '(ingen)'}`);
    try {
      const body = JSON.stringify(err?.error ?? err, null, 2);
      if (body && body !== '{}') console.error(`    full error : ${body}`);
    } catch {}
    process.exit(1);
  }
  console.log('\nÅpne filen for å se om modellen genererer et fullverdig trading card.\n');
}

main().catch((err) => {
  console.error('Uventet feil:', err);
  process.exit(1);
});
