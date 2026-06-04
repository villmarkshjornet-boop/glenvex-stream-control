import OpenAI from 'openai';

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

const SYSTEM_PROMPT = `Du er GLENVEX BOT – AI-kompisen og community manager for det norske Twitch-communityet rundt streameren GLENVEX.

Personlighet:
- Norsk, litt rå og direkte – som en gaming-kompis, ikke en kundeservice-robot
- Mørk humor, gaming-sjargong, naturlig og ufiltrert tone
- Genuint engasjert i folka i chatten – husk navn og hva de sier
- Kjenner spillene GLENVEX spiller: GTA RP (Future RP), Escape from Tarkov, FPS
- Kjenner karakteren Mats Haugland: politibetjent på Future RP, regelrytter, galning, kjøreglad, god skytter

Dine oppgaver i samtaler:
- Engasjer folk – still spørsmål, skryt av dem, kall dem ut (vennlig)
- Oppfordre naturlig til å lage og dele klipp når noe kult nevnes
- Minne folk på å følge twitch.tv/glenvex og slå på varslinger
- Markedsføre GLENVEX organisk – aldri desperat, alltid naturlig
- Starte debatter og diskusjoner om gaming, streams og klipp

Regler:
- Svar ALLTID på norsk (gaming-ord som clip, stream, chat er ok)
- Maks 2-3 setninger – vær punchline, ikke roman
- Bruk emojis naturlig og sparsomt
- Vær en faktisk kompis, ikke en bot
- Si ikke at du er en AI med mindre noen spør direkte
- Hvis du ikke har OpenAI-tilgang, svar med en enkel norsk tekst uansett`;

const BILDE_NOEKKELORD = [
  'bilde', 'bild', 'bilde av', 'vis meg', 'generer', 'lag et bilde',
  'image', 'show me', 'tegn', 'draw', 'foto', 'illustrasjon',
];

export function erBildeForespørsel(melding: string): boolean {
  const lower = melding.toLowerCase();
  return BILDE_NOEKKELORD.some(k => lower.includes(k));
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
      prompt: `${prompt}. Dark cinematic style, neon green accents, gaming aesthetic. Norwegian RP community GLENVEX.`,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
    });
    return response.data?.[0]?.url ?? null;
  } catch {
    return null;
  }
}

export async function generateChatReply(
  channelId: string,
  username: string,
  message: string
): Promise<ChatReply> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return { tekst: `Hei ${username}! Systemet er aktivert men AI-nøkkel mangler. Sjekk Railway-variabler. 🤖`, bildeUrl: null };
  }

  // Hent personlighets-instruksjon fra bot-settings
  let personalityExtra = '';
  try {
    const { getBotSettings, getPersonalityPrompt } = require('@/lib/botMemory');
    personalityExtra = getPersonalityPrompt();
  } catch {}

  const client = new OpenAI({ apiKey });
  const hist = history.get(channelId) ?? [];
  hist.push({ role: 'user', content: `${username}: ${message}` });

  const erBilde = erBildeForespørsel(message);

  try {
    if (erBilde) {
      // Generer bildeprompt fra samtalehistorikk
      const promptRes = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Lag en kort DALL-E bildeprompt på engelsk (maks 50 ord) basert på brukerens forespørsel. Kun prompt, ingen forklaring.' },
          { role: 'user', content: `Bruker ber om: ${message}. Kontekst: GLENVEX gaming community, GTA RP, Mats Haugland politibetjent.` },
        ],
        max_tokens: 80,
        temperature: 0.7,
      });

      const bildePrompt = promptRes.choices[0]?.message?.content ?? message;
      const [bildeUrl, svarRes] = await Promise.all([
        genererBilde(client, bildePrompt),
        client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...hist,
            { role: 'user', content: 'Kommenter kort at du genererer bildet de ba om (1 setning, norsk).' },
          ],
          max_tokens: 80,
          temperature: 0.9,
        }),
      ]);

      const tekst = svarRes.choices[0]?.message?.content ?? null;
      if (tekst) {
        hist.push({ role: 'assistant', content: tekst });
        history.set(channelId, hist.slice(-MAX_HISTORY));
      }

      return { tekst, bildeUrl };
    }

    // Vanlig tekstsvar
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: `${SYSTEM_PROMPT}${personalityExtra ? '\n\n' + personalityExtra : ''}` }, ...hist],
      max_tokens: 200,
      temperature: 0.92,
    });

    const reply = response.choices[0]?.message?.content ?? null;
    if (reply) {
      hist.push({ role: 'assistant', content: reply });
      history.set(channelId, hist.slice(-MAX_HISTORY));
    }

    return { tekst: reply, bildeUrl: null };
  } catch (err) {
    return {
      tekst: `Noe gikk galt der, prøv igjen 😅`,
      bildeUrl: null,
    };
  }
}

const PROAKTIVE_MELDINGER = [
  '👀 Er det noen her som ikke har fulgt twitch.tv/glenvex ennå? Det er ulovlig og dere vet det 🔴',
  '🎬 Seriøst spørsmål – hva er den beste clipsen dere har sett fra GLENVEX? Del den her, beste clip vinner æren 👑',
  '🔥 Hvilket spill vil dere se GLENVEX ta mer? Stem i chatten – vi hører faktisk på dere (noen ganger)',
  '⚡ Utfordring: Send stream-linken til én venn i dag. Én ny seer fra deg = du er offisielt en MVP i dette communityet 💪',
  '🎮 Hva er det kuleste som har skjedd på stream så langt? Noen som har clipset det? Hvis ikke – GJØR DET neste gang 📸',
  '💬 Hot take: Hva er GLENVEX sitt beste spill? Diskuter. Jeg har meninger og de er riktige 😤',
  '🔔 PSA: Hvis du ikke har slått på Twitch-varslinger for GLENVEX, sover du gjennom de beste øyeblikkene. Fix it. twitch.tv/glenvex',
  '🚀 Visste dere at én deling av en clip kan gi GLENVEX hundrevis av nye seere? Del gjerne neste gang dere ser noe bra 📢',
  '🎯 Ukens spørsmål: Hva vil dere se mer av på stream? Fortell meg alt, jeg videresender (kanskje) 👂',
  '😤 Ingen clips fra siste stream? Hva holder dere på med? Neste gang det skjer noe episk – klikk den clip-knappen. Det er hva den er der for.',
];

export function getProaktivMelding(): string {
  return PROAKTIVE_MELDINGER[Math.floor(Math.random() * PROAKTIVE_MELDINGER.length)];
}
