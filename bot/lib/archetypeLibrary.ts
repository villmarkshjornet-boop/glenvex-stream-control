/**
 * ARCHETYPE LIBRARY — 52 curated archetypes for GLENVEX Persona Cards
 *
 * Each archetype has:
 *   personality    — one-liner GPT reads when choosing the best fit
 *   environment    — DALL-E background / setting description
 *   character      — costume, weapons, aesthetic of the character itself
 *   effects        — archetype-specific atmospheric particles and lighting
 *   signals        — raw MemberProfile metric weights (0–3) for candidate scoring
 *
 * selectArchetypeCandidates() normalises each metric and returns the top N
 * matches, with a small jitter (±10%) so identical stat-members still diverge.
 */

import type { MemberProfile } from './memberTracker';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ArchetypeSignals {
  messages?:        number;
  voiceMinutes?:    number;
  streamsAttended?: number;
  giftSubs?:        number;
  badges?:          number;
  streakDays?:      number;
  xp?:              number;
  reactions?:       number;
}

export interface Archetype {
  name:        string;
  personality: string;    // shown to GPT when selecting
  environment: string;    // DALL-E background
  character:   string;    // DALL-E character visual
  effects:     string;    // DALL-E atmospheric effects
  signals:     ArchetypeSignals;
}

// ── Library ───────────────────────────────────────────────────────────────────

export const ARCHETYPES: Archetype[] = [

  // ── CHAT-HEAVY: expression, chaos, creativity ───────────────────────────

  {
    name: 'Chaos Mage',
    personality: 'Unpredictable arcane force — writes walls of text, derails conversations into gold, the most chaotic energy in any room.',
    environment: 'collapsing arcane tower with spell circles exploding outward, dimensional rifts tearing reality, floating debris in crackling purple energy',
    character:   'tattered arcane robes with glowing rune tears, staff wreathed in chaotic energy, wild hair and manic brilliance in the eyes',
    effects:     'Reality fractures visibly around them. Arcane lightning arcs between floating spell fragments. Swirling vortex of purple chaos energy erupts from the ground.',
    signals:     { messages: 3, reactions: 2, xp: 1 },
  },
  {
    name: 'Bard',
    personality: 'The community\'s voice and entertainer — storyteller, hype generator, the one who makes every moment memorable.',
    environment: 'concert stage with neon spotlights above, crowd silhouettes in the darkness behind, giant screens showing their legend',
    character:   'vibrant performer outfit with glowing neon accents, enchanted instrument radiating harmonic energy, charismatic open stance',
    effects:     'Musical notes become golden light particles drifting upward. Stage lights beam down dramatically. The crowd\'s energy forms a visible aura.',
    signals:     { messages: 3, reactions: 3, voiceMinutes: 1 },
  },
  {
    name: 'Herald',
    personality: 'Announcer of important events — always first with the news, their words carry weight and shape the community narrative.',
    environment: 'grand courtyard with towering announcement banner, sunlight breaking through clouds, crowd assembled and attentive below',
    character:   'ceremonial armor with gold trim and community insignia, ornate announcement horn, commanding forward posture',
    effects:     'Golden proclamation energy radiates outward like a ripple. Light breaks through clouds directly overhead.',
    signals:     { messages: 2, reactions: 2, streamsAttended: 2 },
  },
  {
    name: 'Trickster',
    personality: 'Master of surprise and misdirection — makes everyone laugh, never where you expect, always three moves ahead.',
    environment: 'shadowy carnival with trick mirrors and floating playing cards, moonlit stage with smoke and illusions everywhere',
    character:   'jester-rogue hybrid outfit, vanishing smoke in one hand, an ace card in the other, knowing smile hiding sharp intelligence',
    effects:     'Playing cards swirl in orbit. Multiple shadow-copies appear and vanish. The air smells of smoke and impossible possibility.',
    signals:     { messages: 2, reactions: 3, xp: 1 },
  },
  {
    name: 'Wordsmith',
    personality: 'Crafts the most detailed, thoughtful messages — essays as chat, lore keeper, the one whose words are always saved.',
    environment: 'ancient grand library with floating open books, golden candlelight, endless shelves of knowledge stretching to infinity',
    character:   'scholar robes with arcane ink stains, quill radiating golden light, reading glasses, surrounded by orbiting tomes',
    effects:     'Glowing text fragments drift upward and dissolve into light. Ink flows like living energy through the air.',
    signals:     { messages: 3, xp: 2, streakDays: 1 },
  },
  {
    name: 'Storyteller',
    personality: 'Ancient keeper of tales — every story becomes lore, every event becomes legend, the community\'s living memory.',
    environment: 'ancient stone firepit under open sky, glowing embers rising, listeners gathered in shadows, visions of past events in the flames',
    character:   'weathered traveler cloak, staff carved with memory runes, eyes that have seen everything, calm knowing expression',
    effects:     'Stories from the past appear as glowing visions in the smoke. Firelight casts long dramatic shadows on the listeners.',
    signals:     { messages: 2, streakDays: 2, reactions: 2 },
  },
  {
    name: 'Jester',
    personality: 'Chaos incarnate with a grin — brings humor to every moment, refuses to be serious, makes the server feel alive.',
    environment: 'upside-down castle where gravity is optional, checkered floor tilting at impossible angles, bells and chaos everywhere',
    character:   'rogue-jester outfit in chaotic clashing colors, bells that ring with arcane energy, mischievous grin hiding sharp intelligence',
    effects:     'Reality seems slightly wrong around them — objects float at wrong angles. Laughter ripples through the air as visible waves.',
    signals:     { messages: 3, reactions: 3 },
  },
  {
    name: 'Provocateur',
    personality: 'Fearless opinion-sharer — sparks the best debates, never afraid to be wrong, charges conversations with electric energy.',
    environment: 'electric storm arena with crackling lightning, charged atmosphere, crowd on edge, sparks flying from every surface',
    character:   'battle-worn debate champion outfit, crackling lightning gauntlets, forward-leaning aggressive stance, fire in the eyes',
    effects:     'Electric arcs jump between their fingertips. Storm clouds gather directly overhead. The air itself crackles with tension.',
    signals:     { messages: 3, reactions: 1, xp: 1 },
  },

  // ── VOICE-HEAVY: community, leadership, presence ────────────────────────

  {
    name: 'Guild Master',
    personality: 'Undisputed community leader — the voice everyone listens to, shapes the culture, everyone knows their name.',
    environment: 'grand guild hall with faction banners hanging from vaulted ceiling, loyal knights at attention behind, throne of earned authority',
    character:   'ornate guild master armor with faction crest, commanding staff, embroidered cape with guild insignia, calm authority in every line',
    effects:     'Guild insignia glows gold above them. Warm authority light radiates from their presence. The hall itself feels alive with their command.',
    signals:     { voiceMinutes: 3, badges: 2, xp: 1 },
  },
  {
    name: 'Community Guardian',
    personality: 'Protector of the community — always present, welcomes everyone, makes the server feel safe and belonging.',
    environment: 'warm gathering hall with soft amber light, community members visible in background celebrating, protective shields on the wall',
    character:   'guardian plate armor with warm gold highlights, great shield with community emblem glowing, open protective stance, gentle eyes',
    effects:     'A warm protective glow emanates from the shield. Community energy visible as golden particles floating upward.',
    signals:     { voiceMinutes: 3, streamsAttended: 2, badges: 1 },
  },
  {
    name: 'Chieftain',
    personality: 'Tribal leader with raw presence — commands with authority, speaks truth, the natural center of any gathering.',
    environment: 'towering cliff overlooking a valley of followers, ancient bonfire roaring behind, tribal banners snapping in the wind',
    character:   'tribal war armor with bone and hammered gold, war paint that glows faintly, weapon of choice at rest, unyielding stance',
    effects:     'Bonfire sparks rise dramatically around them. The wind carries their power. Ancient totems glow in the middle distance.',
    signals:     { voiceMinutes: 3, messages: 1, xp: 2 },
  },
  {
    name: 'Warlord',
    personality: 'Fearless commander who leads from the front — their presence alone changes the outcome of any conflict.',
    environment: 'fortress battlements at dusk, armies assembled below, fallen enemy banners, smoke of recent victory in the air',
    character:   'heavy war-scarred armor with a hundred campaigns recorded in its dents, massive weapon that has seen everything, strategic intelligence behind fierce eyes',
    effects:     'Army banners flutter dramatically in the battle wind. Sunset battle light cuts through smoke. The weight of command visible.',
    signals:     { voiceMinutes: 2, xp: 3, badges: 2 },
  },
  {
    name: 'Voice of the North',
    personality: 'Nordic authority — ancient wisdom, unbreakable will, speaks rarely but every word reshapes the room.',
    environment: 'frozen mountain peak with aurora borealis blazing above, ancient glowing rune stones in a circle, the cold air bowing before them',
    character:   'nordic warrior plate with carved frost runes, ancient ceremonial horn, wolf companion at their side, frost energy in every breath',
    effects:     'Northern lights dance and intensify above them. Frost crystals form in the air as they exhale. Rune stones pulse with ancient power.',
    signals:     { voiceMinutes: 3, streakDays: 2, xp: 1 },
  },
  {
    name: 'Council Elder',
    personality: 'Wise mediator and decision-maker — sees all sides, resolves conflicts, their judgment is trusted absolutely.',
    environment: 'ancient round council chamber, candles casting long shadows on the curved walls, maps and scrolls everywhere, weight of decisions in every stone',
    character:   'distinguished elder robes with council insignia, staff of mediation, reading glasses, calm overwhelming power in every gesture',
    effects:     'Candlelight creates a perfect circle of wisdom around them. Ancient scrolls orbit slowly. Quiet absolute gravitas in the air.',
    signals:     { voiceMinutes: 2, xp: 2, streakDays: 3, badges: 2 },
  },
  {
    name: 'Oathkeeper',
    personality: 'Unbreakable in loyalty — never breaks a commitment, the one everyone counts on, living proof that their word is bond.',
    environment: 'sacred oath-temple with binding light pillars, sworn knights bearing witness behind, ancient promises written in light on the walls',
    character:   'ceremonial oath-armor with inscribed vows visible in the metal, sacred blade of judgment, absolute stillness of absolute commitment',
    effects:     'Words of their oaths appear as glowing text in the air. Sacred binding light seals from above. The air hums with kept promises.',
    signals:     { voiceMinutes: 2, streakDays: 3, giftSubs: 1 },
  },

  // ── STREAM-LOYAL: devotion, presence, vigilance ─────────────────────────

  {
    name: 'Sentinel',
    personality: 'Always present, never misses a stream — the eternal watchful guardian whose loyalty is absolute and unwavering.',
    environment: 'ancient watchtower with eternal flame at the top, vast night sky with stars, the land spread far below, alone but never lonely',
    character:   'vigilant light armor built for long watch, lantern of eternal flame, alert eyes that miss absolutely nothing, calm patience',
    effects:     'Eternal flame burns steady in wind that moves nothing else. Stars form a crown above. Watch never ends and never needs to.',
    signals:     { streamsAttended: 3, streakDays: 3, voiceMinutes: 1 },
  },
  {
    name: 'Chronicler',
    personality: 'Records everything — the community\'s historian, remembers every event, every joke, every milestone in perfect detail.',
    environment: 'living map room with events pinned in glowing light, shelves of community journals, timeline of the server stretching to the beginning',
    character:   'historian robes with ink-stained sleeves, enchanted quill that writes by itself, journals orbiting like loyal satellites',
    effects:     'Past community events appear as glowing visions on the maps. Ink flows through the air like living rivers of memory.',
    signals:     { streamsAttended: 3, streakDays: 2, messages: 1 },
  },
  {
    name: 'Devoted Scout',
    personality: 'First arrival, last to leave — the one who shows up before the stream starts and stays until the very end.',
    environment: 'misty forest path at dawn, golden light just breaking through the canopy, well-worn tracks of devotion in the earth',
    character:   'ranger traveling cloak, glowing lantern, bow or short blade of reliability, loyal animal companion at their side',
    effects:     'Dawn light breaks through trees specifically for their arrival. Forest creatures approach with complete trust.',
    signals:     { streamsAttended: 3, reactions: 2, badges: 1 },
  },
  {
    name: 'Night Watch',
    personality: 'The late-night constant — always there during the off-hours, sees the community from angles nobody else does.',
    environment: 'moonlit city walls at midnight, torch flickering in the darkness, distant city lights glowing far below, stars above, solitary and alert',
    character:   'dark vigilance armor built for night work, torch staff casting warm light, eyes adapted to darkness, comfortable in solitude',
    effects:     'Moonlight finds them specifically and nowhere else. City glow in the far distance. Stars are unusually close.',
    signals:     { streamsAttended: 2, streakDays: 3, voiceMinutes: 1 },
  },

  // ── HIGH XP / LEVEL: mastery, power, achievement ────────────────────────

  {
    name: 'Archmage',
    personality: 'Master of ancient knowledge — deeply experienced, commands the most complex abilities, knowledge is power and weapon.',
    environment: 'floating arcane tower surrounded by star fields, concentric spell circles on every surface, constellations moving to their will',
    character:   'legendary mage robes covered in living star charts, staff with a captured supernova at the tip, ancient wisdom in calm eyes',
    effects:     'Constellation patterns visible and shifting in their robes. Orbiting astronomical instruments. The universe bends near them.',
    signals:     { xp: 3, messages: 2, streakDays: 1 },
  },
  {
    name: 'Dragon Knight',
    personality: 'Pinnacle of combat mastery — bonded with a dragon, commands fire and sky, nothing stands before their combined power.',
    environment: 'volcanic mountain peak with dragon wingbeats above, rivers of molten rock below, the sky itself on fire with scale and power',
    character:   'legendary dragonscale armor absorbing volcanic light, dragon-forged greatsword, massive dragon companion visible behind',
    effects:     'Dragon fire crowns the entire scene. Molten light from the rivers below. Dragonscale armor catches volcanic glow perfectly.',
    signals:     { xp: 3, voiceMinutes: 1, badges: 2 },
  },
  {
    name: 'Void Hunter',
    personality: 'Pursues the impossible — hunts through dimensional rifts, sees what others cannot, power that bends what is real.',
    environment: 'cosmic void between dimensions, reality tears showing other universes, impossible geometry of beautiful and terrifying scale',
    character:   'void-black armor that absorbs light at the edges, dimensional rift blades, eyes that glow with sight beyond normal space',
    effects:     'Reality cracks visibly around them. Stars visible through tears in the air itself. Void tendrils reach from their hands.',
    signals:     { xp: 3, streakDays: 1, messages: 1 },
  },
  {
    name: 'Storm Caller',
    personality: 'Commands the weather of the server — brings energy when it\'s calm, electricity when it\'s flat, undeniable natural force.',
    environment: 'cloudscape above the world, eye of the storm perfectly calm while chaos rages in every direction around them',
    character:   'storm armor with living lightning channels running through every plate, crackling energy staff, wind moving their hair constantly',
    effects:     'Lightning answers their gestures immediately. The eye of the storm is exactly where they stand. Thunder echoes as visible light.',
    signals:     { xp: 2, messages: 2, reactions: 2 },
  },
  {
    name: 'Shadow Rogue',
    personality: 'Moves unseen, strikes precisely — the silent contributor who influences everything without being noticed.',
    environment: 'rain-soaked neon city rooftop at midnight, neon reflections in puddles far below, smoke curling from ventilation shafts',
    character:   'sleek shadow-cloth armor that absorbs neon into darkness, twin blades that catch city light beautifully, calm perfect readiness',
    effects:     'Neon city lights reflect everywhere. Rain creates a curtain of falling light. Shadows move with their own independent purpose.',
    signals:     { xp: 2, streakDays: 2, messages: 1 },
  },
  {
    name: 'Berserker',
    personality: 'Unleashed, unfiltered energy — massive contribution in bursts, brings chaotic intensity that cannot be ignored.',
    environment: 'epic chaotic battlefield with fire and destruction everywhere, storm clouds cracking overhead, fallen banners in the mud below',
    character:   'battle-worn heavy armor with dents earned in glory, massive weapon still radiating battle energy, war paint, raw determination',
    effects:     'Battle energy radiates as visible heat waves. Lightning strikes around them. The chaos of battle is already won.',
    signals:     { messages: 3, xp: 2, reactions: 1 },
  },
  {
    name: 'Arcane Engineer',
    personality: 'Builder and inventor — designs the systems others use, finds the elegant solution, their work runs in the background of everything.',
    environment: 'vast arcane workshop with mechanical constructs being assembled, blueprints floating in holographic light, gears and magic beautifully merged',
    character:   'engineer\'s coat covered in arcane diagrams and ink, wrench and spell-pen both in hand, precision goggles, creative chaos in their posture',
    effects:     'Mechanical constructs assemble themselves nearby in real time. Holographic blueprints float and rotate. The workshop breathes.',
    signals:     { xp: 2, messages: 2, badges: 2 },
  },
  {
    name: 'Blood Knight',
    personality: 'Dark glory and earned power — not evil, but hard — every achievement came at a cost and that cost shows beautifully.',
    environment: 'crimson-lit battlefield at midnight, smoke and aftermath of great victory, the cost of power visible and respected',
    character:   'battle-worn crimson armor that has seen everything there is to see, sword carried with the weight of history, fierce surviving eyes',
    effects:     'Crimson energy surrounds like an aura of earned history. Battle smoke creates dramatic frames. Victory hangs in the air.',
    signals:     { xp: 2, badges: 3, voiceMinutes: 1 },
  },
  {
    name: 'Titan',
    personality: 'Massive, unignorable presence — not the loudest but the most felt, bends the space of the server by simply being there.',
    environment: 'ancient titan ruins with scale beyond comprehension, the world visible far below, gravity feels different, awe is absolute',
    character:   'armor of impossible scale, weapon that rewrites what\'s physically possible, the calm of someone who has genuinely never lost',
    effects:     'Ground cracks slightly under their weight. The sky itself adjusts. The scale is impossible yet completely legible.',
    signals:     { xp: 3, badges: 2, voiceMinutes: 2 },
  },

  // ── GIFT SUBS / GENEROSITY: abundance, giving ───────────────────────────

  {
    name: 'Merchant King',
    personality: 'Master of giving — runs the economy of goodwill, gives subs because it\'s natural, wealth shared freely and gladly.',
    environment: 'opulent trade hall with towers of coin, scrolls of deals sealed, merchant fleet visible through tall arched windows, abundance everywhere',
    character:   'merchant-king robes with gold that means earned not inherited, ledger of generosity in hand, open giving stance',
    effects:     'Coins orbit slowly in warm golden light. Trade winds blow through the hall. Abundance is visible as glowing energy.',
    signals:     { giftSubs: 3, reactions: 2, xp: 1 },
  },
  {
    name: 'Patron Saint',
    personality: 'Gives without expectation — blesses the community with generosity that makes everyone feel valued and supported.',
    environment: 'golden cathedral with divine giving light from above, community members visible receiving blessings, warmth total and absolute',
    character:   'saint\'s robes with giving light emanating from open hands, gentle strength, blessings visible in every direction',
    effects:     'Golden blessing light falls from above onto everything. Open hands radiate giving energy. The cathedral fills with genuine warmth.',
    signals:     { giftSubs: 3, voiceMinutes: 1, badges: 1 },
  },
  {
    name: 'Benefactor',
    personality: 'Quietly powerful contributor — not loud about it, just consistently making things better without asking for credit.',
    environment: 'grand philanthropist\'s hall at dusk, people gathered in quiet gratitude, gifts given and received, understated majesty',
    character:   'refined understated armor of quiet wealth built to help rather than show, steady eyes of someone who gives well',
    effects:     'Warm evening light turns everything golden. Quiet power radiates without announcing itself. Gratitude visible in the environment.',
    signals:     { giftSubs: 2, streakDays: 2, voiceMinutes: 2 },
  },

  // ── HIGH BADGES / ACHIEVEMENT ───────────────────────────────────────────

  {
    name: 'Champion',
    personality: 'Peak performer — achieved the highest level in every metric, the benchmark everyone measures themselves against.',
    environment: 'victory arena at the exact moment of triumph, crowd roaring, championship laurels falling from above',
    character:   'champion\'s ceremonial armor polished for victory, championship weapon raised in the winning moment, crowd behind them',
    effects:     'Victory light descends specifically and only on them. Crowd energy forms a visible golden aura. Championship energy eternal.',
    signals:     { badges: 3, xp: 2, reactions: 2 },
  },
  {
    name: 'Trophy Hunter',
    personality: 'Achievement collector — has unlocked everything there is, their badge list is legendary, every goal conquered.',
    environment: 'personal trophy hall with achievements displayed magnificently, each one a story, display cases as far as the eye can see',
    character:   'collector\'s armor with embedded achievements on every surface, trophy staff, eyes that always see the next target clearly',
    effects:     'Achievement displays glow and react as they pass. New trophies arrive even now. The collection never stops growing.',
    signals:     { badges: 3, streakDays: 2, xp: 1 },
  },
  {
    name: 'Veteran',
    personality: 'Been here since the beginning — battle-worn, respected, the anchor of the community\'s history and identity.',
    environment: 'old guard post with memories of campaigns past displayed on the walls, weathered medals and maps, long service honored',
    character:   'veteran armor with earned damage in every plate, medals of actual significance, battle scars worn with absolute pride',
    effects:     'Old glory light from behind. Medals glow with remembered importance. The history of the server is written on their armor.',
    signals:     { badges: 2, streakDays: 3, xp: 2 },
  },
  {
    name: 'Legend',
    personality: 'Their name is already being told in stories — became part of the community\'s mythology, everyone knows who they are.',
    environment: 'mythological arena where tales are actively inscribed in golden light on the walls, stories writing themselves in the air',
    character:   'legendary armor that looks like it was made specifically for the mythology it carries, weapon of storied significance',
    effects:     'Their legend writes itself in golden light around them in real time. Stories appear in the air. The myth is happening now.',
    signals:     { badges: 3, xp: 3, voiceMinutes: 1 },
  },
  {
    name: 'Ironclad',
    personality: 'Cannot be broken — every challenge made them stronger, their consistency is both armor and weapon.',
    environment: 'blacksmith forge of self-mastery, anvil of challenges hammered into permanent strength, fire of determination eternal',
    character:   'self-forged armor with every challenge embedded visibly in the metal, hammer that built themselves, unbreakable stance',
    effects:     'Forge fire creates dramatic backlight. The armor they wear was made from everything that tried to break them.',
    signals:     { badges: 2, streakDays: 3, xp: 2 },
  },

  // ── STREAK / CONSISTENCY: endurance, devotion ───────────────────────────

  {
    name: 'Undying',
    personality: 'Rises from every setback — impossibly resilient, always comes back stronger, phoenix energy defines them.',
    environment: 'ash-covered rebirth landscape, phoenix fire blazing in the background, new growth visibly emerging from old destruction',
    character:   'phoenix-touched armor at the exact moment of transformation, fire that creates rather than destroys, rebirth eyes',
    effects:     'Phoenix flames surround without burning. Ash rises upward becoming pure light. Rebirth is the entire scene\'s story.',
    signals:     { streakDays: 3, xp: 1, badges: 1 },
  },
  {
    name: 'Pilgrim',
    personality: 'Devoted to the journey — not here for the destination, here because the community itself is the purpose.',
    environment: 'ancient mountain pilgrimage path at dawn, misty sacred peaks ahead, the path worn deep by years of devoted walking',
    character:   'humble pilgrim\'s traveling gear that has walked everywhere, staff carved with distances traveled, peaceful certainty',
    effects:     'Dawn light breaks specifically for their journey. The path glows faintly where they walk. Every step is a meditation.',
    signals:     { streakDays: 3, streamsAttended: 2, voiceMinutes: 1 },
  },

  // ── SPECIAL / HYBRID ────────────────────────────────────────────────────

  {
    name: 'Cyber Assassin',
    personality: 'Precise digital operative — works in the shadows of the server, accomplishes things nobody else sees, always ahead.',
    environment: 'neon cyberpunk megacity at night, holographic targets glowing in the rain, digital shadows existing in physical space',
    character:   'cybernetic stealth suit with neon edge accents, digital-physical blade, targeting reticle in one eye, calm precision',
    effects:     'Holographic displays flicker with acquired targets. Neon rain creates light-curtains behind them. Digital shadows move independently.',
    signals:     { xp: 2, streakDays: 2, messages: 2 },
  },
  {
    name: 'Spirit Walker',
    personality: 'Connected to something beyond the server — brings wisdom from outside, sees patterns others miss, ethereal perspective.',
    environment: 'ancestral spirit forest where past and present merge, spirit guides visible as translucent light, mist between living and memory',
    character:   'spirit-touched robes with ancestral markings that glow, spirit companions hovering nearby, eyes that see two worlds simultaneously',
    effects:     'Ancestors appear as translucent forms nearby. Spirit light in cool blues and ancestral greens. The veil is very thin here.',
    signals:     { streakDays: 2, voiceMinutes: 2, reactions: 1 },
  },
  {
    name: 'Rune Knight',
    personality: 'Ancient power made modern — carries wisdom of ages, each action carved in permanent rune, their history is their power.',
    environment: 'ancient rune circle with carved standing stones glowing with power, nordic sky above, power older than memory awakening',
    character:   'dark knight armor with living runes carved into every surface pulsing with energy, rune-etched sword, ancient power completely natural to them',
    effects:     'Runes pulse with golden energy in sequence. The ancient stone circle activates. Power that predates the server itself.',
    signals:     { xp: 2, streakDays: 2, badges: 2 },
  },
  {
    name: 'Beast Tamer',
    personality: 'Connects with everyone on a primal level — the animal communicator, senses who is real before anyone speaks.',
    environment: 'primeval forest at magic hour, powerful creature companions surrounding them in trust, nature in absolute perfect balance',
    character:   'ranger-naturalist armor of living wood and leather, primary beast companion bonded fully at their side, nature communion',
    effects:     'Multiple creature companions visible and bonded. Nature energy flows visibly between them. The forest knows their name.',
    signals:     { reactions: 3, voiceMinutes: 2, streamsAttended: 1 },
  },
  {
    name: 'Necromancer',
    personality: 'Dark arts scholar — finds power in what others overlook, raises forgotten things to new purpose, complex and fascinating.',
    environment: 'dark stone sanctum of forbidden knowledge, arcane diagrams glowing on the floor, the power of entropy and rebirth made beautiful',
    character:   'dark necromancer robes with bone and crystal accents, staff of life-death mastery, the eyes of forbidden knowledge',
    effects:     'Dark energy with unexpected light at its core. Power that requires understanding before fear. Ancient and genuinely compelling.',
    signals:     { xp: 2, messages: 2, streakDays: 1 },
  },
  {
    name: 'Alchemist',
    personality: 'Transforms what they touch — takes raw engagement and refines it into something valuable, the server\'s creative catalyst.',
    environment: 'baroque alchemical laboratory with bubbling transmutations, formulas being solved mid-air, discovery perpetually in progress',
    character:   'alchemist coat with transformation stains of every beautiful color, mortar and pestle that changes reality, discovery mid-gesture',
    effects:     'Formulas solve themselves in the surrounding air. Colors of active transformation everywhere. Every element is mid-change.',
    signals:     { reactions: 2, xp: 2, messages: 1 },
  },
  {
    name: 'Gladiator',
    personality: 'Performs at peak under pressure — thrives when all eyes are on them, delivers when it counts, spectacular when watched.',
    environment: 'epic colosseum with a full roaring crowd, sand of a hundred battles, the crowd came specifically and only for this',
    character:   'gladiator armor polished for the spectacle of victory, weapon of choice raised in victor\'s pose, crowd energy as pure fuel',
    effects:     'Crowd noise becomes visible energy waves. Championship light descends from above. The arena was built for this exact moment.',
    signals:     { streamsAttended: 2, reactions: 3, voiceMinutes: 1 },
  },
  {
    name: 'Pirate Admiral',
    personality: 'Charts their own course — doesn\'t follow rules they didn\'t write, leads their crew through uncharted waters with confidence.',
    environment: 'flagship deck in a dramatic storm, lightning on the horizon, loyal fleet behind them, the unexplored horizon always ahead',
    character:   'admiral\'s coat with the confidence of someone who has never once been lost, wheel of the ship or cutlass raised, sea salt and certainty',
    effects:     'Ocean spray and storm lightning frame them. Fleet visible and loyal in the background. The horizon always holds more.',
    signals:     { messages: 2, xp: 2, reactions: 1 },
  },
  {
    name: 'Cosmic Voyager',
    personality: 'Sees the server as part of something much larger — brings perspective from vast scale, mind always partly on the infinite.',
    environment: 'deep space nebula cartography station, star maps being charted in real time, galaxies visible through every viewport',
    character:   'space explorer suit with nebula colors reflected in every surface, stellar cartography tools, eyes that have seen the edge',
    effects:     'Nebula colors visible and shifting everywhere. Stars seem closer than physics allows. The universe is intimate and known here.',
    signals:     { xp: 2, streakDays: 1, messages: 2 },
  },
  {
    name: 'Oracle',
    personality: 'Sees what\'s coming before it arrives — predictions are suspiciously accurate, the community\'s forward-looking voice.',
    environment: 'ancient prophecy temple with vision pools and time-threading light, past and future simultaneously visible in the columns',
    character:   'oracle\'s ceremonial garb with third eye open and glowing, vision staff, one eye seeing now and one seeing what comes next',
    effects:     'Time itself visible as threads in the surrounding air. Past visions and future possibilities both present. Impossible clarity.',
    signals:     { streakDays: 2, reactions: 2, xp: 1 },
  },
  {
    name: 'Phoenix',
    personality: 'Transformation is their identity — reinvents constantly, each version better than the last, rising is their permanent state.',
    environment: 'volcanic rebirth peak at the exact apex of transformation, fire that creates rather than destroys, a new world visibly emerging',
    character:   'phoenix-form armor at the apex of transformation, fire becoming feathers becoming more fire, rebirth as a continuous beautiful act',
    effects:     'Fire becomes light becomes power becomes more fire. The cycle of transformation visible as pure beauty. Rising never stops.',
    signals:     { xp: 2, messages: 2, streakDays: 2 },
  },
  {
    name: 'Paladin',
    personality: 'Holy warrior of community values — defends what matters, calls out what\'s wrong, unwavering moral compass.',
    environment: 'grand cathedral interior with divine light through stained glass windows of every color, holy energy rising from the floor',
    character:   'gleaming paladin plate with divine light channels running through it, consecrated sword and shield, righteousness in every line',
    effects:     'Divine light falls from above in multiple rays. Sacred energy rises from the stone floor. The cathedral bears permanent witness.',
    signals:     { voiceMinutes: 2, streakDays: 2, badges: 2 },
  },
  {
    name: 'Hunter',
    personality: 'Relentless tracker and achiever — once a target is set they never stop, methodical, focused, always on the hunt.',
    environment: 'misty ancient forest at dawn, golden light shafting through the canopy, tracks in the earth, the quarry just moments ahead',
    character:   'ranger tracking armor built for long pursuit, bow of perfect accuracy, focus that has room only for the target',
    effects:     'Dawn light through forest creates dramatic shafts specifically for them. Heightened awareness visible. The hunt is on.',
    signals:     { xp: 2, streakDays: 2, badges: 1 },
  },
  {
    name: 'Wanderer',
    personality: 'Has been everywhere in the server, knows every corner, brings experience from across the whole community.',
    environment: 'dramatic scenic vista at golden hour, epic landscape stretching to the horizon in every direction, roads traveled behind them',
    character:   'well-traveled cloak of accumulated experience, walking staff with memory charms, peaceful wisdom of great distances walked',
    effects:     'Golden hour light that only exists for travelers. Horizon stretches further than normal just for them. Beautiful roads behind.',
    signals:     { streamsAttended: 2, voiceMinutes: 1, messages: 2 },
  },
];

// ── Lookup ────────────────────────────────────────────────────────────────────

export function getArchetype(name: string): Archetype | undefined {
  return ARCHETYPES.find(a => a.name === name);
}

export function archetypeExists(name: string): boolean {
  return ARCHETYPES.some(a => a.name === name);
}

// ── Candidate selection ───────────────────────────────────────────────────────

export interface ScoredArchetype {
  arch:  Archetype;
  score: number;  // 0–max (sum of signal_weight × normalised_stat)
  rank:  number;  // 1-based position in sorted list
}

function clamp(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function rawScore(signals: ArchetypeSignals, m: MemberProfile): number {
  let score = 0;
  if (signals.messages)        score += signals.messages        * clamp(m.messages        / 500);
  if (signals.voiceMinutes)    score += signals.voiceMinutes    * clamp(m.voiceMinutes    / 1000);
  if (signals.streamsAttended) score += signals.streamsAttended * clamp(m.streamsAttended / 30);
  if (signals.giftSubs)        score += signals.giftSubs        * clamp(m.giftSubs        / 10);
  if (signals.badges)          score += signals.badges          * clamp(m.badges.length   / 8);
  if (signals.streakDays)      score += signals.streakDays      * clamp(m.streakDays      / 30);
  if (signals.xp)              score += signals.xp              * clamp(m.xp              / 5000);
  if (signals.reactions)       score += signals.reactions       * clamp(m.reactions       / 200);
  return score;
}

/**
 * Returns ALL archetypes sorted by deterministic signal score (no jitter).
 * Use for logging and diagnostics — shows what the model "sees" before jitter.
 */
export function scoreAllArchetypes(member: MemberProfile): ScoredArchetype[] {
  return ARCHETYPES
    .map(arch => ({ arch, score: rawScore(arch.signals, member) }))
    .sort((a, b) => b.score - a.score)
    .map((item, i) => ({ ...item, rank: i + 1 }));
}

/**
 * Returns the top N candidates with their jittered scores (±10%) so members
 * with identical stats still get different archetypes on reroll.
 * Use this for GPT candidate selection — not for logging.
 */
export function selectArchetypeCandidates(member: MemberProfile, n = 5): ScoredArchetype[] {
  return ARCHETYPES
    .map(arch => ({
      arch,
      score: rawScore(arch.signals, member) * (0.9 + Math.random() * 0.2),
      rank:  0,  // re-assigned after sort
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((item, i) => ({ ...item, rank: i + 1 }));
}
