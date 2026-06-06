import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

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

const SYSTEM_PROMPT = `Du er GLENVEX BOT – skapt av Glenn Ove Karlsen (gkarlsen) som AI-kompis og community manager for det norske Twitch-communityet GLENVEX.

Personlighet:
- Norsk, litt rå og direkte – som en gaming-kompis, ikke en kundeservice-robot
- Mørk humor, gaming-sjargong, naturlig og ufiltrert tone
- Genuint engasjert i folka i communityet – husk navn og hva de sier
- Bred gaming-kunnskap – kjenner mange sjangre og spill, ikke låst til ett spill
- Bruker det du vet om communityet aktivt i svarene

Som "selger" for GLENVEX:
- Skap FOMO – folk som ikke følger går glipp av noe genuint bra
- Vær konkret: "sist stream skjedde X og du var ikke der" slår "sjekk kanalen" 10-0
- Oppfordre til klipp og deling naturlig – ikke som en robot, men som en som faktisk ble imponert
- Minne om twitch.tv/glenvex og varslinger når det passer naturlig
- Bruk community-kunnskap til å gjøre promotering personlig og relevant

Regler:
- Svar ALLTID på norsk (gaming-ord som clip, stream, chat er ok)
- Maks 2-3 setninger – vær punchline, ikke roman
- Bruk emojis naturlig og sparsomt
- Vær en faktisk kompis, ikke en bot
- Si ikke at du er en AI med mindre noen spør direkte
- Hvis noen spør hvem som lagde deg: Glenn Ove Karlsen (gkarlsen) bygde deg`;

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

let _kontekstCache: string | null = null;
let _sistHentetKontekst = 0;
const KONTEKST_CACHE_MS = 5 * 60 * 1000;

async function hentKommunitetKontekst(): Promise<string> {
  if (_kontekstCache !== null && Date.now() - _sistHentetKontekst < KONTEKST_CACHE_MS) return _kontekstCache;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return '';
  try {
    const sb = createClient(url, key);
    const ws = process.env.WORKSPACE_ID || 'glenvex-default';
    const [viewersRes, jokesRes, insightsRes] = await Promise.all([
      sb.from('ai_agent_memory').select('key,summary').eq('workspace_id', ws).eq('memory_type', 'viewer').order('occurrence_count', { ascending: false }).limit(5),
      sb.from('ai_agent_memory').select('summary').eq('workspace_id', ws).in('memory_type', ['joke', 'topic']).order('occurrence_count', { ascending: false }).limit(4),
      sb.from('ai_agent_insights').select('title,summary').eq('workspace_id', ws).order('created_at', { ascending: false }).limit(2),
    ]);
    const deler: string[] = [];
    if (viewersRes.data?.length) deler.push('Kjente community-folk: ' + viewersRes.data.map((v: any) => `${v.key} (${v.summary})`).join(', '));
    if (jokesRes.data?.length) deler.push('Community-temaer/inside jokes: ' + jokesRes.data.map((j: any) => j.summary).join('; '));
    if (insightsRes.data?.length) deler.push('Ferske innsikter: ' + insightsRes.data.map((i: any) => `${i.title} – ${i.summary}`).join('. '));
    _kontekstCache = deler.join('\n');
    _sistHentetKontekst = Date.now();
    return _kontekstCache;
  } catch { return ''; }
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

async function genererBilde(client: OpenAI, prompt: string): Promise<string | null> {
  try {
    const response = await client.images.generate({
      model: 'dall-e-3',
      prompt: `${prompt}. Dark cinematic style, neon green accents, gaming aesthetic. Norwegian gaming community GLENVEX.`,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
    });
    return response.data?.[0]?.url ?? null;
  } catch { return null; }
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

  // Hent kontekst parallelt
  const [kommunitetKontekst, topSpill] = await Promise.all([
    hentKommunitetKontekst(),
    erSpillTipForespørsel(message) ? hentTopTwitchSpill() : Promise.resolve([] as string[]),
  ]);

  // Bygg dynamisk systemmelding
  let systemMelding = SYSTEM_PROMPT;
  if (kommunitetKontekst) systemMelding += `\n\nCommunity-kunnskap (bruk dette aktivt):\n${kommunitetKontekst}`;
  if (topSpill.length > 0) systemMelding += `\n\nDette er de mest sette spillene på Twitch akkurat nå (bruk som utgangspunkt for anbefalinger):\n${topSpill.slice(0, 10).join(', ')}`;

  const erBilde = erBildeForespørsel(message);

  try {
    if (erBilde) {
      const promptRes = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Lag en kort DALL-E bildeprompt på engelsk (maks 50 ord). Kun prompt, ingen forklaring.' },
          { role: 'user', content: `Bruker ber om: ${message}. Kontekst: GLENVEX norsk gaming community.` },
        ],
        max_tokens: 80,
        temperature: 0.7,
      });
      const bildePrompt = promptRes.choices[0]?.message?.content ?? message;
      const [bildeUrl, svarRes] = await Promise.all([
        genererBilde(client, bildePrompt),
        client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: systemMelding }, ...hist, { role: 'user', content: 'Kommenter kort at du genererer bildet (1 setning, norsk).' }],
          max_tokens: 80,
          temperature: 0.9,
        }),
      ]);
      const tekst = svarRes.choices[0]?.message?.content ?? null;
      if (tekst) { hist.push({ role: 'assistant', content: tekst }); history.set(channelId, hist.slice(-MAX_HISTORY)); }
      return { tekst, bildeUrl };
    }

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: systemMelding }, ...hist],
      max_tokens: 200,
      temperature: 0.92,
    });

    const reply = response.choices[0]?.message?.content ?? null;
    if (reply) { hist.push({ role: 'assistant', content: reply }); history.set(channelId, hist.slice(-MAX_HISTORY)); }
    return { tekst: reply, bildeUrl: null };
  } catch {
    return { tekst: `Noe gikk galt der, prøv igjen 😅`, bildeUrl: null };
  }
}

// ── Proaktive meldinger ───────────────────────────────────────────────────────

const PROAKTIVE_MELDINGER = [
  '👀 Er det noen her som ikke har fulgt twitch.tv/glenvex ennå? Det er ulovlig og dere vet det 🔴',
  '🎬 Seriøst spørsmål – hva er den beste clipsen dere har sett fra GLENVEX? Del den her, beste clip vinner æren 👑',
  '🔥 Hvilket spill vil dere se GLENVEX ta mer? Stem i chatten – vi hører faktisk på dere (noen ganger)',
  '⚡ Utfordring: Send stream-linken til én venn i dag. Én ny seer fra deg = du er offisielt en MVP 💪',
  '🎮 Hva er det kuleste som har skjedd på stream så langt? Noen som har clipset det? Hvis ikke – GJØR DET neste gang 📸',
  '💬 Hot take: Hva er GLENVEX sitt beste spill? Diskuter. Jeg har meninger og de er riktige 😤',
  '🔔 PSA: Hvis du ikke har slått på Twitch-varslinger for GLENVEX, sover du gjennom de beste øyeblikkene. Fix it. twitch.tv/glenvex',
  '🚀 Én deling av en clip kan gi GLENVEX hundrevis av nye seere. Del gjerne neste gang dere ser noe bra 📢',
  '🎯 Ukens spørsmål: Hva vil dere se mer av på stream? Fortell meg alt, jeg videresender (kanskje) 👂',
  '😤 Ingen clips fra siste stream? Hva holder dere på med? Neste gang det skjer noe episk – klikk clip-knappen.',
];

export function getProaktivMelding(): string {
  return PROAKTIVE_MELDINGER[Math.floor(Math.random() * PROAKTIVE_MELDINGER.length)];
}
