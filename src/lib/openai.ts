import OpenAI from 'openai';
import type { StreamInfo, PromoContent } from '@/types';

export async function generatePromo(stream: StreamInfo): Promise<PromoContent> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return buildFallbackPromo(stream);
  }

  const client = new OpenAI({ apiKey });

  const prompt = `Du er promo-hjelper for den norske streameren GLENVEX.
Lag kortfattet, mørk og energisk promo-tekst TILPASSET spillet som spilles.

Streamer: GLENVEX
Spill: ${stream.game || 'Gaming'}
Stream-tittel: ${stream.title || 'Live nå'}
Status: ${stream.isLive ? 'ER LIVE NÅ' : 'Generell promo'}

Regler:
- Norsk språk (unntatt hashtags)
- Mørk gaming/hacker-vibe, energisk og rå
- Innholdet MÅ bruke terminologi og tema fra spillet
- IKKE generisk – teksten skal passe akkurat dette spillet
- IKKE barnslig – dette er en seriøs streamer
- Maks 3 linjer per plattform (ikke tell hashtags som linjer)

Twitter-regler:
- Inkluder 4-6 hashtags som faktisk er i bruk på Twitter for dette spillet
- Eksempel GTA RP: #GTARP #NoPixel #GTA5 #Twitch #NorwegianStreamer
- Eksempel Tarkov: #EscapeFromTarkov #Tarkov #EFT #Twitch #Gaming
- Avslutt alltid med twitch.tv/glenvex

Instagram-regler:
- Inkluder 8-10 relevante hashtags for spillet og gaming-nisjen
- Mix av store og mellomstore hashtags

Svar KUN med gyldig JSON (ingen forklaring, ingen markdown):
{
  "tiktok": "...",
  "instagram": "...",
  "twitter": "...",
  "discord": "...",
  "youtube": "...",
  "clipTitles": ["...", "...", "..."]
}`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    max_tokens: 800,
    temperature: 0.85,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Ingen respons fra OpenAI');

  const promo = JSON.parse(content) as PromoContent;

  if (stream.thumbnailUrl) {
    promo.imageUrl = stream.thumbnailUrl;
  } else {
    promo.imageUrl = await generatePromoImage(client, stream);
  }

  return promo;
}

async function generatePromoImage(client: OpenAI, stream: StreamInfo): Promise<string | undefined> {
  try {
    const game = stream.game || 'gaming';
    const response = await client.images.generate({
      model: 'dall-e-3',
      prompt: `Dark cinematic gaming thumbnail for Norwegian streamer GLENVEX. Game: ${game}. Dark neon green and black, dramatic lighting, cyberpunk aesthetic. No text or logos.`,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
    });
    return response.data[0]?.url ?? undefined;
  } catch {
    return undefined;
  }
}

function buildFallbackPromo(stream: StreamInfo): PromoContent {
  const game = stream.game || 'Gaming';
  const safeGame = game.replace(/\s+/g, '');

  return {
    tiktok: `🔴 GLENVEX er LIVE.\nSystemet er aktivert. ${game}-kaoset starter nå.\nKom inn før alt går galt. #GLENVEX #${safeGame} #Gaming`,
    instagram: `Ny stream er LIVE!\n${game} – action og kaos.\nLink i bio!\n#${safeGame} #Gaming #GLENVEX #Live`,
    twitter: `LIVE NÅ: ${game} med GLENVEX!\nKom inn og se kaoset unfold.\ntwitch.tv/glenvex\n#${safeGame} #Live #GLENVEX`,
    discord: `🔴 **GLENVEX ER LIVE!**\nSystemet er aktivert. ${game}-kaoset starter nå.\nBli med på stream nå! → twitch.tv/glenvex`,
    youtube: `GLENVEX LIVE: ${game} – ${stream.title || 'Kaos og action på stream'}`,
    clipTitles: [
      `Dette skjedde på GLENVEX sin stream... 😱`,
      `GLENVEX ${game} – Umulig øyeblikk`,
      `Ingen tror det skjedde her 🔥 #GLENVEX`,
    ],
  };
}
