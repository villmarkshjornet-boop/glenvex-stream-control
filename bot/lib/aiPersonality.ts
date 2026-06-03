import OpenAI from 'openai';

interface Message {
  role: 'user' | 'assistant';
  content: string;
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
- Kjenner spillene GLENVEX spiller: GTA RP, Escape from Tarkov, FPS

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
- Si ikke at du er en AI med mindre noen spør direkte`;

export function isOnCooldown(userId: string): boolean {
  const last = cooldowns.get(userId);
  return last !== undefined && Date.now() - last < COOLDOWN_MS;
}

export function setCooldown(userId: string): void {
  cooldowns.set(userId, Date.now());
}

export async function generateChatReply(
  channelId: string,
  username: string,
  message: string
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const client = new OpenAI({ apiKey });

  const hist = history.get(channelId) ?? [];
  hist.push({ role: 'user', content: `${username}: ${message}` });

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...hist],
      max_tokens: 200,
      temperature: 0.92,
    });

    const reply = response.choices[0]?.message?.content ?? null;
    if (reply) {
      hist.push({ role: 'assistant', content: reply });
      history.set(channelId, hist.slice(-MAX_HISTORY));
    }
    return reply;
  } catch {
    return null;
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
