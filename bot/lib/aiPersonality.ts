import OpenAI from 'openai';
import { getRecentCrossPlatformContext } from './crossPlatformContext';
import { logBotAgentEvent } from './agentLogger';
import { getMemoryContext } from './aiMemory';
import { callChatCompletion, callImageGeneration } from './openaiWrapper';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatReply {
  tekst: string | null;
  bildeUrl: string | null;
}

const history = new Map<string, Message[]>();
const cooldowns = new Map<string, number>();
const MAX_HISTORY = 14;
const COOLDOWN_MS = 8_000;

const BOT_BRAND  = process.env.BRAND_NAME ?? process.env.TWITCH_USERNAME ?? 'streameren';
const BOT_OWNER  = process.env.BOT_ADMIN_USERNAME ?? 'administrator';
const TWITCH_LINK = process.env.TWITCH_URL ?? `twitch.tv/${process.env.TWITCH_USERNAME ?? 'streameren'}`;

const SYSTEM_PROMPT = `Du er community-boten for ${BOT_BRAND} – AI-kompis og community manager for et norsk Twitch-community.

Personlighet:
- Norsk, litt rå og direkte – som en gaming-kompis, ikke en kundeservice-robot
- Mørk humor, gaming-sjargong, naturlig og ufiltrert tone
- Genuint engasjert i folka i communityet – husk navn og hva de sier
- Bred gaming-kunnskap – kjenner mange sjangre og spill, ikke låst til ett spill
- Bruker det du vet om communityet aktivt i svarene

Som "selger" for ${BOT_BRAND}:
- Skap FOMO – folk som ikke følger går glipp av noe genuint bra
- Vær konkret: "sist stream skjedde X og du var ikke der" slår "sjekk kanalen" 10-0
- Oppfordre til klipp og deling naturlig – ikke som en robot, men som en som faktisk ble imponert
- Minne om ${TWITCH_LINK} og varslinger når det passer naturlig
- Bruk community-kunnskap til å gjøre promotering personlig og relevant

Regler:
- Svar ALLTID på norsk (gaming-ord som clip, stream, chat er ok)
- Maks 2-3 setninger – vær punchline, ikke roman
- Bruk emojis naturlig og sparsomt
- Vær en faktisk kompis, ikke en bot
- Si ikke at du er en AI med mindre noen spør direkte
- Hvis noen spør hvem som lagde deg: ${BOT_OWNER} bygde deg

KRITISK – Minner og fakta:
- Bruk KUN det som faktisk er injisert i denne prompten om community-folk og hendelser
- Finn ALDRI opp minner, samtaler, hendelser eller detaljer om folk – selv om det høres sannsynlig ut
- Hvis du ikke har et faktum i prompten, si det ærlig: "husker ikke" / "har ikke den infoen"
- Det er bedre å si "vet ikke" enn å dikte opp noe som ikke skjedde`;

// ── Twitch top games ──────────────────────────────────────────────────────────

let _appToken: string | null = null;
let _appTokenExpiry = 0;
let _cachedGames: string[] = [];
let _sistHentetSpill = 0;
const SPILL_CACHE_MS = 10 * 60 * 1000;

async function hentAppToken(): Promise<string | null> {
  if (_appToken && Date.now() < _appTokenExpiry) return _appToken;
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) return null;
  try {
    const res = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`,
      { method: 'POST' }
    );
    const d = await res.json() as any;
    _appToken = d.access_token ?? null;
    _appTokenExpiry = Date.now() + (d.expires_in ?? 3600) * 1000 - 60_000;
    return _appToken;
  } catch { return null; }
}

async function hentTopTwitchSpill(): Promise<string[]> {
  if (Date.now() - _sistHentetSpill < SPILL_CACHE_MS && _cachedGames.length > 0) return _cachedGames;
  const token = await hentAppToken();
  const id = process.env.TWITCH_CLIENT_ID;
  if (!token || !id) return _cachedGames;
  try {
    const res = await fetch('https://api.twitch.tv/helix/games/top?first=15', {
      headers: { 'Client-Id': id, Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) { _appToken = null; return _cachedGames; }
    const d = await res.json() as any;
    _cachedGames = (d.data ?? []).map((g: any) => g.name as string);
    _sistHentetSpill = Date.now();
    return _cachedGames;
  } catch { return _cachedGames; }
}

// ── Community-kontekst fra Supabase ──────────────────────────────────────────
// Delegated to aiMemory.ts (unified read path for ai_agent_memory).
// The old inline hentKommunitetKontekst() is replaced by getMemoryContext()
// which covers all memory_types (viewer, member, joke, topic, feedback_pattern)
// and caches with the same 5-minute TTL.

async function hentKommunitetKontekst(): Promise<string> {
  return getMemoryContext();
}

// ── Hjelpefunksjoner ──────────────────────────────────────────────────────────

const SPILL_TIP_NØKKELORD = [
  'spilltips', 'spillanbefaling', 'hva skal jeg spille', 'anbefal spill',
  'hva spiller folk', 'populære spill', 'beste spill', 'nye spill',
  'hva bør jeg spille', 'hvilket spill', 'game recommendation',
];

function erSpillTipForespørsel(melding: string): boolean {
  const lower = melding.toLowerCase();
  return SPILL_TIP_NØKKELORD.some(k => lower.includes(k));
}

const BILDE_NOEKKELORD = [
  'bilde', 'bild', 'bilde av', 'vis meg', 'generer', 'lag et bilde',
  'image', 'show me', 'tegn', 'draw', 'foto', 'illustrasjon',
];

export function erBildeForespørsel(melding: string): boolean {
  return BILDE_NOEKKELORD.some(k => melding.toLowerCase().includes(k));
}

export function isOnCooldown(userId: string): boolean {
  const last = cooldowns.get(userId);
  return last !== undefined && Date.now() - last < COOLDOWN_MS;
}

export function setCooldown(userId: string): void {
  cooldowns.set(userId, Date.now());
}

async function genererBilde(_client: OpenAI, prompt: string): Promise<string | null> {
  const response = await callImageGeneration(
    {
      model: 'dall-e-3',
      prompt: `${prompt}. Dark cinematic style, neon green accents, gaming aesthetic. Norwegian gaming community.`,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
    },
    { source: 'ai_personality' },
  );
  return response?.data?.[0]?.url ?? null;
}

// ── Hovedfunksjon ─────────────────────────────────────────────────────────────

export async function generateChatReply(
  channelId: string,
  username: string,
  message: string
): Promise<ChatReply> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { tekst: `Hei ${username}! AI-nøkkel mangler. Sjekk Railway-variabler. 🤖`, bildeUrl: null };
  }

  const client = new OpenAI({ apiKey });
  const hist = history.get(channelId) ?? [];
  hist.push({ role: 'user', content: `${username}: ${message}` });

  // Hent kontekst parallelt – inkluder fersk Twitch-aktivitet
  const vilHaTwitchInfo = /twitch|stream|chat|hva skjedde|hva sa|boss|fight|raid|sub/i.test(message);
  const [kommunitetKontekst, topSpill, twitchCtx] = await Promise.all([
    hentKommunitetKontekst(),
    erSpillTipForespørsel(message) ? hentTopTwitchSpill() : Promise.resolve([] as string[]),
    getRecentCrossPlatformContext({ includeTwitch: true, includeDiscord: false, minutesBack: 60, maxMessages: 20 }),
  ]);

  // Bygg dynamisk systemmelding
  let systemMelding = SYSTEM_PROMPT;
  if (kommunitetKontekst) systemMelding += `\n\nCommunity-kunnskap (bruk dette aktivt):\n${kommunitetKontekst}`;
  if (topSpill.length > 0) systemMelding += `\n\nDette er de mest sette spillene på Twitch akkurat nå (bruk som utgangspunkt for anbefalinger):\n${topSpill.slice(0, 10).join(', ')}`;
  if (twitchCtx) {
    systemMelding += `\n\nFersk Twitch-aktivitet (bruk for å svare på "hva skjedde på Twitch" etc.):\n${twitchCtx}`;
    logBotAgentEvent({ source: 'discord', event_type: 'cross_platform_context_used', metadata: { type: 'DISCORD_BOT_USED_TWITCH_CONTEXT' } });
  }

  const erBilde = erBildeForespørsel(message);

  if (erBilde) {
    const promptRes = await callChatCompletion(
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Lag en kort DALL-E bildeprompt på engelsk (maks 50 ord). Kun prompt, ingen forklaring.' },
          { role: 'user', content: `Bruker ber om: ${message}. Kontekst: ${BOT_BRAND} norsk gaming community.` },
        ],
        max_tokens: 80,
        temperature: 0.7,
      },
      { source: 'ai_personality' },
    );
    const bildePrompt = promptRes?.choices[0]?.message?.content ?? message;
    const [bildeUrl, svarRes] = await Promise.all([
      genererBilde(client, bildePrompt),
      callChatCompletion(
        {
          model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: systemMelding }, ...hist, { role: 'user', content: 'Kommenter kort at du genererer bildet (1 setning, norsk).' }],
          max_tokens: 80,
          temperature: 0.9,
        },
        { source: 'ai_personality' },
      ),
    ]);
    const tekst = svarRes?.choices[0]?.message?.content ?? null;
    if (tekst) { hist.push({ role: 'assistant', content: tekst }); history.set(channelId, hist.slice(-MAX_HISTORY)); }
    return { tekst, bildeUrl };
  }

  const response = await callChatCompletion(
    {
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: systemMelding }, ...hist],
      max_tokens: 200,
      temperature: 0.92,
    },
    { source: 'ai_personality' },
  );

  if (!response) {
    return { tekst: `Noe gikk galt der, prøv igjen 😅`, bildeUrl: null };
  }

  const reply = response.choices[0]?.message?.content ?? null;
  if (reply) { hist.push({ role: 'assistant', content: reply }); history.set(channelId, hist.slice(-MAX_HISTORY)); }
  return { tekst: reply, bildeUrl: null };
}

// ── Proaktive meldinger ───────────────────────────────────────────────────────

const PROAKTIVE_MELDINGER = [
  `👀 Er det noen her som ikke har fulgt ${TWITCH_LINK} ennå? Det er ulovlig og dere vet det 🔴`,
  `🎬 Seriøst spørsmål – hva er den beste clipsen dere har sett fra ${BOT_BRAND}? Del den her, beste clip vinner æren 👑`,
  `🔥 Hvilket spill vil dere se ${BOT_BRAND} ta mer? Stem i chatten – vi hører faktisk på dere (noen ganger)`,
  '⚡ Utfordring: Send stream-linken til én venn i dag. Én ny seer fra deg = du er offisielt en MVP 💪',
  '🎮 Hva er det kuleste som har skjedd på stream så langt? Noen som har clipset det? Hvis ikke – GJØR DET neste gang 📸',
  `💬 Hot take: Hva er ${BOT_BRAND} sitt beste spill? Diskuter. Jeg har meninger og de er riktige 😤`,
  `🔔 PSA: Hvis du ikke har slått på Twitch-varslinger for ${BOT_BRAND}, sover du gjennom de beste øyeblikkene. Fix it. ${TWITCH_LINK}`,
  `🚀 Én deling av en clip kan gi ${BOT_BRAND} hundrevis av nye seere. Del gjerne neste gang dere ser noe bra 📢`,
  '🎯 Ukens spørsmål: Hva vil dere se mer av på stream? Fortell meg alt, jeg videresender (kanskje) 👂',
  '😤 Ingen clips fra siste stream? Hva holder dere på med? Neste gang det skjer noe episk – klikk clip-knappen.',
];

export function getProaktivMelding(): string {
  return PROAKTIVE_MELDINGER[Math.floor(Math.random() * PROAKTIVE_MELDINGER.length)];
}

// Cache to prevent spam — one generation per 8 hours
let _proaktivCache: { message: string; generatedAt: number } | null = null;
const PROAKTIV_CACHE_MS = 8 * 60 * 60_000;

export async function getProaktivMeldingAsync(workspaceId: string): Promise<string> {
  // Return cached version if fresh
  if (_proaktivCache && Date.now() - _proaktivCache.generatedAt < PROAKTIV_CACHE_MS) {
    return _proaktivCache.message;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const sbUrl  = process.env.SUPABASE_URL;
  const sbKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey || !sbUrl || !sbKey) {
    return getProaktivMelding(); // fallback
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createClient } = require('@supabase/supabase-js');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ws = require('ws');
    const db = createClient(sbUrl, sbKey, { realtime: { transport: ws }, auth: { persistSession: false, autoRefreshToken: false } });

    // Get top ai_agent_memory entries
    const { data: memory } = await db
      .from('ai_agent_memory')
      .select('memory_type,summary,content,occurrence_count')
      .eq('workspace_id', workspaceId)
      .order('occurrence_count', { ascending: false })
      .limit(6);

    const memContext = (memory ?? [])
      .map((m: any) => `[${m.memory_type}] ${String(m.summary ?? m.content ?? '').slice(0, 100)}`)
      .join('\n') || '(ingen data ennå)';

    // Get recent proactive messages to avoid repeating same theme
    const { data: recentDecisions } = await db
      .from('system_events')
      .select('metadata')
      .eq('workspace_id', workspaceId)
      .eq('event_type', 'PROACTIVE_MESSAGE_DECISION')
      .order('created_at', { ascending: false })
      .limit(5);

    const recentThemes = (recentDecisions ?? [])
      .map((d: any) => d.metadata?.theme as string | undefined)
      .filter(Boolean)
      .join(', ');

    const openai = new OpenAI({ apiKey });
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `Du er community-boten for ${BOT_BRAND}. Du sender proaktive meldinger til Discord-community.\n\nPersonlighet: Norsk, rå og direkte. Gaming-kompis, ikke robot. Mørk humor ok.\n\nKrav:\n- Maks 1-2 setninger\n- Ingen overskrifter, ingen lister\n- Ikke repeter temaer: ${recentThemes || 'ingen'}\n- Bruk community-kunnskap fra AI-minne\n- Kan nevne ${TWITCH_LINK} naturlig, men ikke alltid`,
      }, {
        role: 'user',
        content: `AI-minne om communityet:\n${memContext}\n\nLag én kort, engasjerende proaktiv melding til Discord. Svar KUN med meldingen, ingen forklaring.`,
      }],
      max_tokens: 120,
      temperature: 0.85,
    });

    const message = res.choices[0]?.message?.content?.trim() ?? '';
    if (!message || message.length < 10) throw new Error('Tom GPT-respons');

    // Cache the result
    _proaktivCache = { message, generatedAt: Date.now() };

    // Log the decision
    const theme = message.toLowerCase().split(/\s+/).filter(w => w.length > 4)[0] ?? 'ukjent';
    try {
      await db.from('system_events').insert({
        workspace_id: workspaceId,
        source:       'ai_personality',
        event_type:   'PROACTIVE_MESSAGE_DECISION',
        title:        `Proaktiv melding generert: "${message.slice(0, 60)}"`,
        severity:     'info',
        metadata:     { message, theme, memoryUsed: memory?.length ?? 0, confidence: 0.8, source: 'gpt' },
      });
    } catch {}

    return message;
  } catch {
    // Fallback to static messages on any error
    return getProaktivMelding();
  }
}
