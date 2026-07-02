/**
 * TEST: GPT archetype selection + persona JSON generation
 *
 * Usage:  npm run test:persona-gpt
 *
 * Part 1 (no API key needed):
 *   - Shows archetype scoring for test member
 *   - Shows top 5 candidates that would be sent to GPT
 *   - Shows what the prompt would look like
 *
 * Part 2 (requires OPENAI_API_KEY):
 *   - Calls GPT, generates full persona JSON
 *   - Validates archetype is in library
 *   - Shows fallback behavior if needed
 *   - Logs full output including cascade through title/ultimate/flavor
 */

import OpenAI from 'openai';
import type { MemberProfile } from '../lib/memberTracker';
import { scoreAllArchetypes, selectArchetypeCandidates, getArchetype, archetypeExists } from '../lib/archetypeLibrary';
import { genererPersonaJson } from '../lib/personaService';

// ── Test member — realistic mid-level community member ────────────────────────

const MEMBER: MemberProfile = {
  id:              'test-user-123',
  username:        'gkarlsen',
  displayName:     'GlennOve',
  nickname:        'GKarlsen',
  topRole:         'OWNER',
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
  memberType:            'discord',
  twitchUsername:        null,
  twitchDisplayName:     null,
  twitchLinked:          false,
  discordAvatarUrl:      null,
  discordXp:             1450,
  twitchXp:              0,
  messagesDiscord:       234,
  messagesTwitch:        0,
  lastDiscordActivityAt: new Date().toISOString(),
  lastTwitchActivityAt:  null,
  lastSeenStreamAt:      null,
  joinedDiscordAt:       '2024-01-01T00:00:00Z',
};

const RARITY = 'Legendary' as const;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('  GLENVEX — test:persona-gpt (Archetype selection + GPT)');
  console.log('════════════════════════════════════════════════════════════════\n');

  console.log(`Member   : ${MEMBER.displayName}  (${MEMBER.username})`);
  console.log(`Level    : ${MEMBER.level}  XP: ${MEMBER.xp}`);
  console.log(`Messages : ${MEMBER.messages}  Voice: ${MEMBER.voiceMinutes}m  Streams: ${MEMBER.streamsAttended}`);
  console.log(`Reactions: ${MEMBER.reactions}  GiftSubs: ${MEMBER.giftSubs}  Streak: ${MEMBER.streakDays}d`);
  console.log(`Badges   : ${MEMBER.badges.join(', ')}`);
  console.log(`Rarity   : ${RARITY}`);

  // ── Part 1: Deterministic scoring (no jitter, no API key) ─────────────────

  console.log('\n── DETERMINISTIC ARCHETYPE SCORES (alle 52) ────────────────────');
  const allScored = scoreAllArchetypes(MEMBER);
  const top10 = allScored.slice(0, 10);
  for (const { arch, score, rank } of top10) {
    const signals = Object.entries(arch.signals)
      .map(([k, v]) => `${k}×${v}`)
      .join(' + ');
    console.log(`  #${String(rank).padEnd(2)}  ${arch.name.padEnd(24)}  ${score.toFixed(3).padStart(6)}  [${signals}]`);
  }
  if (allScored.length > 10) {
    console.log(`  ... (${allScored.length - 10} lavere scorede archetypes skjult)`);
  }

  // ── Part 2: Jittered candidates (what GPT would see on this specific call) ─

  console.log('\n── JITTERED KANDIDATER (disse sendes til GPT denne kjøringen) ──');
  const candidates = selectArchetypeCandidates(MEMBER, 5);
  for (const { arch, score, rank } of candidates) {
    const det = allScored.find(s => s.arch.name === arch.name)!;
    console.log(`  #${rank}  ${arch.name.padEnd(24)}  jittered=${score.toFixed(3)}  det=#${det.rank}(${det.score.toFixed(3)})`);
    console.log(`       "${arch.personality.slice(0, 80)}"`);
  }

  // ── Part 3: GPT call ───────────────────────────────────────────────────────

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('\n⚠  OPENAI_API_KEY ikke satt — hopper over GPT-kall.');
    console.log('   Sett API-nøkkel i .env og kjør igjen for full test.\n');
    process.exit(0);
  }

  console.log('\n── GPT PERSONA GENERATION ───────────────────────────────────────');
  console.log('Kaller genererPersonaJson()...\n');

  const openai = new OpenAI({ apiKey });
  const t0     = Date.now();
  const card   = await genererPersonaJson(MEMBER, RARITY, openai);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (!card) {
    console.error(`\n❌  genererPersonaJson returnerte null etter ${elapsed}s`);
    process.exit(1);
  }

  console.log(`\n── RESULTAT (${elapsed}s) ────────────────────────────────────────`);
  console.log(`Archetype    : ${card.archetype}`);
  const inLibrary    = archetypeExists(card.archetype);
  const inCandidates = candidates.some(s => s.arch.name === card.archetype);
  console.log(`  I library  : ${inLibrary  ? '✅ ja' : '❌ nei — fallback ble brukt'}`);
  console.log(`  I topp-5   : ${inCandidates ? '✅ ja' : '⚠  nei (i library men utenfor topp-5)'}`);

  const archLib = getArchetype(card.archetype);
  if (archLib) {
    console.log(`  Personality: "${archLib.personality}"`);
  }

  console.log(`\nTitle        : ${card.title}`);
  console.log(`Class        : ${card.class}`);
  console.log(`Rarity       : ${card.rarity}`);
  console.log(`\nDescription  :\n${card.description.split('\n').map(l => `  ${l}`).join('\n')}`);
  console.log(`\nUltimate     : ${card.signatureMove}`);
  console.log(`  desc       : ${card.signatureMoveDesc}`);
  console.log(`Quote        : "${card.quote}"`);
  console.log(`FlavorText   : "${card.flavorText}"`);

  console.log(`\nStats        :`);
  const sorted = Object.entries(card.stats).sort(([, a], [, b]) => b - a);
  for (const [k, v] of sorted) {
    const bar = '█'.repeat(Math.round(v / 10)) + '░'.repeat(10 - Math.round(v / 10));
    console.log(`  ${k.padEnd(14)} ${bar} ${v}`);
  }

  if (archLib) {
    console.log(`\n── ARCHETYPE VISUAL DATA ───────────────────────────────────────`);
    console.log(`Environment  : ${archLib.environment}`);
    console.log(`Character    : ${archLib.character}`);
    console.log(`Effects      : ${archLib.effects}`);
  }

  // Archetype cascade check — do title/ultimate/flavor feel aligned?
  console.log(`\n── CASCADE CHECK (manuell vurdering) ────────────────────────────`);
  console.log(`Archetype personality: "${archLib?.personality ?? '?'}"`);
  console.log(`Title:       ${card.title}`);
  console.log(`Ultimate:    ${card.signatureMove}`);
  console.log(`Flavor:      ${card.flavorText}`);
  console.log(`→ Spør: Matcher tittel/ultimate/flavor archetypens essens?`);

  console.log('\n────────────────────────────────────────────────────────────────\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Uventet feil:', err);
  process.exit(1);
});
