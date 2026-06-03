import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getBroadcasterId, getChannelStats } from '@/lib/twitch';
import { getGuildInfo } from '@/lib/discord';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [broadcasterId, guild] = await Promise.all([getBroadcasterId(), getGuildInfo()]);
    const stats = broadcasterId ? await getChannelStats(broadcasterId) : null;

    const historyFile = path.join(process.cwd(), 'data', 'stream-history.json');
    const history = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf-8')) as any[] : [];

    const avgViewers = history.length > 0 ? Math.round(history.slice(0, 10).reduce((s: number, h: any) => s + h.avgViewers, 0) / Math.min(history.length, 10)) : 0;
    const peakViewers = history.length > 0 ? Math.max(...history.slice(0, 10).map((h: any) => h.peakViewers)) : 0;
    const hoursStreamed = Math.round(history.slice(0, 20).reduce((s: number, h: any) => s + h.durationMinutes, 0) / 60);
    const followers = stats?.followerCount ?? 0;
    const discordMembers = guild?.approximate_member_count ?? 0;

    const score = Math.min(100, Math.round(
      (Math.min(avgViewers, 200) / 200) * 35 +
      (Math.min(followers, 5000) / 5000) * 30 +
      (Math.min(discordMembers, 500) / 500) * 20 +
      (Math.min(hoursStreamed, 100) / 100) * 15
    ));

    const apiKey = process.env.OPENAI_API_KEY;
    let rapport = '';
    let sterktePunkter: string[] = [];
    let forbedringer: string[] = [];

    if (apiKey) {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Lag en profesjonell norsk sponsorrapport for Twitch-kanalen GLENVEX. Returner KUN JSON:
{
  "rapport": "Profesjonell rapporttekst (200 ord, e-postklar)",
  "sterktePunkter": ["...", "...", "..."],
  "forbedringer": ["...", "...", "..."]
}

Kanaldata:
- Snitt-seere: ${avgViewers}
- Peak viewers: ${peakViewers}
- Følgere: ${followers}
- Discord-membres: ${discordMembers}
- Timer streamet: ${hoursStreamed}h
- Sponsor Score: ${score}/100`,
        }],
        max_tokens: 600,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
      rapport = parsed.rapport ?? '';
      sterktePunkter = parsed.sterktePunkter ?? [];
      forbedringer = parsed.forbedringer ?? [];
    }

    return NextResponse.json({ score, avgViewers, peakViewers, followers, discordMembers, hoursStreamed, rapport, sterktePunkter, forbedringer });
  } catch {
    return NextResponse.json({ score: 0, avgViewers: 0, peakViewers: 0, followers: 0, discordMembers: 0, hoursStreamed: 0, rapport: '', sterktePunkter: [], forbedringer: [] });
  }
}
