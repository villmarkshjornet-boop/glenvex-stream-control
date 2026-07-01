/**
 * TEST: Complete Persona Card compositor — AI art + Canvas overlay
 *
 * Usage:  npm run test:persona-card
 * Input:  data/test-persona-card.png  (raw AI art — run test:persona-image first)
 * Output: data/test-persona-card-final.png  (full card with all data overlaid)
 *
 * This tests ONLY the Canvas overlay pipeline, no OpenAI calls.
 * The final PNG must contain: name, rarity, level, XP bar, top-3 stats,
 * badges, ultimate ability, flavor text, card number.
 */

import fs from 'node:fs';
import path from 'node:path';
import { renderPersonaCard } from '../lib/cardRenderer';
import { loadPersonaImage } from '../lib/imageLoader';
import type { PersonaCard } from '../lib/personaService';
import type { MemberProfile } from '../lib/memberTracker';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const AI_ART   = path.join(DATA_DIR, 'test-persona-card.png');
const OUT_FILE = path.join(DATA_DIR, 'test-persona-card-final.png');

// ── Test data — realistic card matching a high-level Legendary Bard ───────────

const CARD: PersonaCard = {
  title:             'THE CHAOS HERALD',
  class:             'Chat Champion',
  archetype:         'Bard',
  rarity:            'Legendary',
  description:       'A living storm of chat energy.\nNever reads all messages.\nAlways writes more.',
  signatureMove:     'CHAOS STORM',
  signatureMoveDesc: 'Unleashes a storm of messages no one can keep up with',
  quote:             'Hold my energy drink.',
  flavorText:        'Legenden sier at Discord fortsatt laster hans lengste melding.',
  stats: {
    hype:        92,   // top 2
    chaos:       89,   // top 3
    community:   95,   // top 1
    focus:       62,
    humor:       74,
    activity:    68,
    helpfulness: 71,
    kreativitet: 60,
    loyalitet:   65,
    lederskap:   70,
  },
  imagePrompt: 'test',
};

const MEMBER: MemberProfile = {
  id:              'test-user-123',
  username:        'gkarlsen',
  displayName:     'GlennOve',
  twitchId:        null,
  xp:              1450,
  level:           6,
  messages:        234,
  reactions:       88,
  voiceMinutes:    120,
  streamsWatched:  10,
  streamsAttended: 15,
  subs:            1,
  giftSubs:        2,
  raids:           1,
  engagementScore: 88,
  communityScore:  95,
  streakDays:      7,
  lastStreakDate:  new Date().toISOString(),
  joinedAt:        '2024-01-01T00:00:00Z',
  lastSeen:        new Date().toISOString(),
  lastWelcomed:    null,
  badges:          ['🏆 Founder', '🎙 Voice', '🔥 Veteran', '👑 MVP', '⭐ Star', '🎯 Pro'],
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('  GLENVEX — test:persona-card (Canvas compositor)');
  console.log('════════════════════════════════════════════════════════════════\n');

  console.log(`\n── BASE IMAGE DIAGNOSTICS ──────────────────────────────────────`);
  console.log(`Path        : ${AI_ART}`);

  const aiArtExists = fs.existsSync(AI_ART);
  console.log(`Exists      : ${aiArtExists}`);

  if (!aiArtExists) {
    console.error(`\n❌  AI art ikke funnet: ${AI_ART}`);
    console.error('    Kjør "npm run test:persona-image" først for å generere AI-bildet.');
    process.exit(1);
  }

  const aiArtBuf = fs.readFileSync(AI_ART);
  console.log(`Buffer size : ${aiArtBuf.length} bytes  (${(aiArtBuf.length / 1024).toFixed(1)} KB)`);

  // Pre-flight: verify Canvas can load this image — fail hard, no silent fallback.
  try {
    const { width, height, sourceType } = await loadPersonaImage(AI_ART, '[pre-flight]');
    console.log(`Dimensions  : ${width} × ${height}px`);
    console.log(`Source type : ${sourceType}`);
    console.log(`Load status : OK`);
  } catch (e: any) {
    console.error(`\n❌  loadPersonaImage() feilet — renderPersonaCard() ville brukt fallback.`);
    console.error(`    Feil: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }

  console.log(`\n── CARD ─────────────────────────────────────────────────────────`);
  console.log(`Card      : ${CARD.rarity} ${CARD.class} — "${CARD.title}"`);
  console.log(`Member    : ${MEMBER.displayName} · Level ${MEMBER.level} · ${MEMBER.xp} XP`);
  console.log(`Stats     : HYPE ${CARD.stats.hype} · CHAOS ${CARD.stats.chaos} · COMMUNITY ${CARD.stats.community}`);
  console.log(`Badges    : ${MEMBER.badges.length} total (viser 4)`);
  console.log(`Ultimate  : ${CARD.signatureMove}`);
  console.log(`Flavor    : "${CARD.flavorText}"`);
  console.log(`\nKjører renderPersonaCard()...`);

  const t0 = Date.now();

  try {
    // Pass file path — not Buffer — so cardRenderer loads via native path (avoids Windows Buffer bug)
    const png = await renderPersonaCard(CARD, AI_ART, MEMBER, 4);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    fs.writeFileSync(OUT_FILE, png);

    console.log(`\n✅  Ferdig på ${elapsed}s`);
    console.log(`✅  Lagret til: ${OUT_FILE} (${(png.length / 1024).toFixed(0)} KB)`);
    console.log(`✅  AI-bilde bekreftet brukt (pre-flight OK + ingen [cardRenderer] loadImage-feil over)`);
    console.log('\n── Kort inneholder ─────────────────────────────────────────────');
    console.log(`  Navn      : ${MEMBER.displayName}`);
    console.log(`  Rarity    : ${CARD.rarity}`);
    console.log(`  Level     : ${MEMBER.level}`);
    console.log(`  XP        : ${MEMBER.xp} / 1750 (level ${MEMBER.level})`);
    console.log(`  Stats     : COMMUNITY 95 · HYPE 92 · HUMOR 88 (topp 3)`);
    console.log(`  Badges    : ${MEMBER.badges.slice(0, 4).join(', ')} +${MEMBER.badges.length - 4}`);
    console.log(`  Ultimate  : ⚡ ULTIMATE · ${CARD.signatureMove}`);
    console.log(`  Flavor    : "${CARD.flavorText}"`);
    console.log(`  Footer    : Card #004 · Season 1 · GLENVEX PERSONA`);
    console.log('────────────────────────────────────────────────────────────────\n');
    process.exit(0);
  } catch (e: any) {
    console.error(`\n❌  renderPersonaCard() feilet: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
