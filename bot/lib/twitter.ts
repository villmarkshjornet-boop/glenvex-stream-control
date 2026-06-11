import { TwitterApi } from 'twitter-api-v2';
import type { StreamInfo } from '@/types';

let twitterClient: TwitterApi | null = null;

function getClient(): TwitterApi | null {
  if (twitterClient) return twitterClient;
  const { TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET } = process.env;
  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) return null;
  twitterClient = new TwitterApi({
    appKey: TWITTER_API_KEY,
    appSecret: TWITTER_API_SECRET,
    accessToken: TWITTER_ACCESS_TOKEN,
    accessSecret: TWITTER_ACCESS_SECRET,
  });
  return twitterClient;
}

export async function tweetLiveNå(stream: StreamInfo): Promise<void> {
  const client = getClient();
  if (!client) return;

  const spill = stream.game || 'Gaming';
  const tittel = stream.title || 'Live nå';
  const url = stream.streamUrl || process.env.TWITCH_URL || 'https://twitch.tv';
  const brand = process.env.BRAND_NAME ?? process.env.TWITCH_USERNAME ?? 'NorwegianStreamer';

  const tekst = `🔴 LIVE NÅ på Twitch!\n\n🎮 ${spill}\n📺 ${tittel}\n\n${url}\n\n#Twitch #${spill.replace(/\s/g, '')} #NorwegianStreamer #${brand}`;

  try {
    await client.v2.tweet(tekst.slice(0, 280));
    console.log('  ✓ Tweet postet');
  } catch (err) {
    console.error('  ✗ Twitter feil:', err);
  }
}
