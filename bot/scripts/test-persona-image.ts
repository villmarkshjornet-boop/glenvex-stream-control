/**
 * TEST: DALL-E persona card generation — standalone, no Canvas, no Discord, no renderer.
 *
 * Usage:  npm run test:persona-image
 * Output: data/test-persona-card.png  +  full console log
 *
 * Tests ONLY the Prompt → OpenAI → PNG pipeline so we can verify
 * DALL-E is actually generating the card art we expect.
 */

import OpenAI from 'openai';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';

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

const RARITY_FRAME_STYLE = {
  Common:
    'matte dark steel frame with subtle engraved geometric patterns, deep charcoal and gunmetal tones, ' +
    'no glow, dignified and restrained, industrial craft',
  Rare:
    'royal navy and cerulean blue crystal frame, glowing azure energy lines along frame edges, ' +
    'cool cerulean particle wisps drifting at borders, elegant naval authority',
  Epic:
    'dark violet arcane frame carved with glowing runes, purple and magenta energy tendrils curling at ' +
    'corners, mystical floating rune fragments, crackling arcane electricity',
  Legendary:
    'ornate 24-karat gold filigree frame with intricate scrollwork and baroque details, warm divine ' +
    'light rays shooting from all four corners, particles of celestial golden light suspended mid-air, ' +
    'radiant and majestic',
  Mythic:
    'blood-red and cosmic void obsidian frame, crimson lightning crackling at corners, swirling void ' +
    'tendrils, dense particle storm, otherworldly light that defies physics, simultaneously terrifying ' +
    'and magnificent, divine wrath incarnate',
};

const RARITY_COLOR_GRADE = {
  Common:    'desaturated cool steel grays, subtle blue-gray shadows, matte finish',
  Rare:      'cool azure and navy tones, cerulean highlights, crisp clarity',
  Epic:      'deep purples, violet shadows, electric magenta highlights, arcane shimmer',
  Legendary: 'warm gold color grade, amber god rays, rich contrast, divine warmth',
  Mythic:    'blood red with cosmic desaturation, bursts of pure white-hot light, void black shadows',
};

const RARITY_MOOD = {
  Common:    'gritty determination, grounded strength, earned respect',
  Rare:      'noble strength, elemental mastery, quiet confidence',
  Epic:      'mysterious arcane power, dark mastery, controlled danger',
  Legendary: 'chosen one energy, mythical grandeur, destiny fulfilled',
  Mythic:    'cosmic horror turned champion, divine wrath, power that reshapes reality',
};

const RARITY_MATERIALS = {
  Common:    'engraved brushed steel, dark pewter with silver highlights',
  Rare:      'polished sapphire, cerulean ice formations, gleaming naval steel',
  Epic:      'glowing amethyst crystals, carved arcane stone, pulsing violet runes',
  Legendary: 'gleaming gold, radiant warm crystals, polished divine brass',
  Mythic:    'crackling crimson plasma, void-black obsidian, glowing red gems',
};

function buildPrompt(rarity: keyof typeof RARITY_FRAME_STYLE, archetype: string, klass: string, imagePrompt: string): string {
  return [
    `Ultra-premium collectible trading card. Portrait orientation. Print-quality illustration.`,
    `Art direction: Riot Games × Blizzard Entertainment × Wizards of the Coast × Marvel Snap.`,
    `This MUST look like official AAA trading card game art — not generic AI art.`,
    ``,
    `SEASON VISUAL THEME: ${SEASON_SUFFIX}`,
    ``,
    `CHARACTER — the absolute hero filling this card:`,
    `${archetype} archetype. ${klass} class. ${imagePrompt}`,
    `This is a legendary stylized game CHAMPION — fictional, not a real person. Epic heroic pose.`,
    `CRITICAL VISUAL REQUIREMENT: The character illustration MUST use VIVID, SATURATED, HIGH-CONTRAST colors.`,
    `Rich chromatic lighting. The character pops off the card — vibrant, electrifying, visually stunning.`,
    `Cinematic rim lighting from behind + frontal key light. Volumetric god rays / energy beams visible.`,
    `Strong bloom on bright elements. Depth of field — character razor-sharp, background atmospheric.`,
    `Rarity particle effects surround them. Character DOMINATES the frame — massive, powerful, unmistakable.`,
    `DO NOT use muddy, desaturated, or dark colors for the character. The art must POP and WOW.`,
    ``,
    `RARITY: ${rarity.toUpperCase()}`,
    `FRAME STYLE: ${RARITY_FRAME_STYLE[rarity]}`,
    `COLOR GRADE: ${RARITY_COLOR_GRADE[rarity]}`,
    `MOOD: ${RARITY_MOOD[rarity]}`,
    ``,
    `CARD LAYOUT — portrait (tall), strictly:`,
    `TOP 8% : Decorative rarity sigil banner strip. Ornate metallic detail, rarity embellishments. No text.`,
    `CENTER 63% : THE CHAMPION fills 100% of this zone. Zero empty space. Rich colors, dramatic lighting.`,
    `  Materials: ${RARITY_MATERIALS[rarity]}`,
    `BOTTOM 29% : Dark info panel. Near-black or very dark toned, clean, elegant.`,
    `  Subtle ornamental decorative lines within it. Elegant divider at panel top.`,
    `  ONLY decorative linework — absolutely zero text, numbers, or symbols.`,
    ``,
    `NON-NEGOTIABLE RULES:`,
    `- ZERO TEXT anywhere on the card. No letters, numbers, runes, or words.`,
    `- Character is VIVID and COLORFUL — not dark, muted, or muddy.`,
    `- Bottom panel is CLEARLY DARKER than the character zone — it's the data area.`,
    `- This card must make a collector say "WOW" and immediately want to keep it.`,
    `- Portrait format (tall, not wide) maintained throughout.`,
  ].join('\n');
}

// ── Download helper ───────────────────────────────────────────────────────────

function downloadToBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const lib   = url.startsWith('https') ? https : http;
    const chunks: Buffer[] = [];
    lib.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} downloading image`));
        return;
      }
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
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

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('  GLENVEX — test:persona-image');
  console.log('════════════════════════════════════════════════════════════════\n');
  console.log(`Rarity    : ${RARITY}`);
  console.log(`Archetype : ${ARCHETYPE}`);
  console.log(`Class     : ${CLASS}`);
  console.log(`Model     : dall-e-3`);
  console.log(`Size      : 1024x1792`);
  console.log(`Quality   : hd`);
  console.log(`Season    : ${SEASON} — "${SEASON_SUFFIX}"`);
  console.log('\n── FULL PROMPT ─────────────────────────────────────────────────');
  console.log(prompt);
  console.log('────────────────────────────────────────────────────────────────\n');
  console.log('Kaller OpenAI...');

  const t0 = Date.now();
  let imageUrl: string | null = null;

  try {
    const res = await openai.images.generate({
      model:   'dall-e-3',
      prompt,
      n:       1,
      size:    '1024x1792',
      quality: 'hd',
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    imageUrl = res.data?.[0]?.url ?? null;
    const revisedPrompt = (res.data?.[0] as any)?.revised_prompt ?? null;

    console.log(`✅  Svar mottatt på ${elapsed}s`);
    console.log(`\nBilde-URL:\n  ${imageUrl}\n`);

    if (revisedPrompt) {
      console.log('── DALL-E revised prompt ───────────────────────────────────────');
      console.log(revisedPrompt);
      console.log('────────────────────────────────────────────────────────────────\n');
    }

  } catch (err: any) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`❌  OpenAI-kall feilet etter ${elapsed}s:`);
    console.error(`    ${err?.message ?? err}`);
    if (err?.status) console.error(`    HTTP status: ${err.status}`);
    if (err?.code)   console.error(`    Error code:  ${err.code}`);
    process.exit(1);
  }

  if (!imageUrl) {
    console.error('❌  Fikk ingen URL fra OpenAI (tom respons)');
    process.exit(1);
  }

  // Download PNG
  console.log('Laster ned PNG...');
  const t1 = Date.now();
  let buf: Buffer;

  try {
    buf = await downloadToBuffer(imageUrl);
    const elapsed = ((Date.now() - t1) / 1000).toFixed(1);
    console.log(`✅  Lastet ned ${(buf.length / 1024).toFixed(0)} KB på ${elapsed}s`);
  } catch (err: any) {
    console.error(`❌  Download feilet: ${err.message}`);
    process.exit(1);
  }

  fs.writeFileSync(outFile, buf);
  console.log(`\n✅  Lagret til:  ${outFile}`);
  console.log('\nÅpne filen for å se om DALL-E genererer et fullverdig trading card.\n');
}

main().catch((err) => {
  console.error('Uventet feil:', err);
  process.exit(1);
});
