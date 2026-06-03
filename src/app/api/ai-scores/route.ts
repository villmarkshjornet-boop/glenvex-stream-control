import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getBroadcasterId, getChannelStats, getStreamInfo } from '@/lib/twitch';
import { getGuildInfo } from '@/lib/discord';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

function loadEvents() {
  try {
    const f = path.join(process.cwd(), 'data', 'events.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch {}
  return { raids: [], giftSubs: [] };
}

function loadMembers() {
  try {
    const f = path.join(process.cwd(), 'data', 'members.json');
    if (fs.existsSync(f)) return Object.values(JSON.parse(fs.readFileSync(f, 'utf-8'))) as any[];
  } catch {}
  return [];
}

function loadHistory() {
  try {
    const f = path.join(process.cwd(), 'data', 'stream-history.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8')) as any[];
  } catch {}
  return [];
}

export async function GET() {
  try {
    const [broadcasterId, guild, stream] = await Promise.all([
      getBroadcasterId(),
      getGuildInfo(),
      getStreamInfo().catch(() => null),
    ]);

    const stats = broadcasterId ? await getChannelStats(broadcasterId) : null;
    const events = loadEvents();
    const members = loadMembers();
    const history = loadHistory();

    const followers = stats?.followerCount ?? 0;
    const avgViewers = history.length > 0 ? Math.round(history.slice(0, 5).reduce((s: number, h: any) => s + h.avgViewers, 0) / Math.min(history.length, 5)) : 0;
    const discordMembers = guild?.approximate_member_count ?? 0;
    const activeMembers = members.filter((m: any) => m.messages > 0).length;
    const totalMessages = members.reduce((s: number, m: any) => s + (m.messages ?? 0), 0);

    // Community Score (0-100)
    const communityScore = Math.min(100, Math.round(
      (Math.min(activeMembers, 100) / 100) * 30 +
      (Math.min(totalMessages, 1000) / 1000) * 30 +
      (Math.min(discordMembers, 500) / 500) * 20 +
      (events.raids?.length ?? 0) * 2 +
      (events.giftSubs?.reduce((s: number, g: any) => s + g.count, 0) ?? 0) * 0.5
    ));

    // Growth Score (0-100)
    const clipCount = stats?.topClips?.length ?? 0;
    const growthScore = Math.min(100, Math.round(
      (Math.min(followers, 5000) / 5000) * 40 +
      (Math.min(avgViewers, 100) / 100) * 30 +
      (Math.min(clipCount, 20) / 20) * 20 +
      (Math.min(discordMembers, 500) / 500) * 10
    ));

    // Sponsor Score (0-100)
    const sponsorScore = Math.min(100, Math.round(
      (Math.min(avgViewers, 200) / 200) * 40 +
      (Math.min(followers, 5000) / 5000) * 30 +
      (Math.min(activeMembers, 100) / 100) * 20 +
      (Math.min(discordMembers, 500) / 500) * 10
    ));

    // AI-anbefalinger
    const apiKey = process.env.OPENAI_API_KEY;
    let prioriteter: string[] = [];
    if (apiKey) {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Du er AI-coach for Twitch-streameren GLENVEX. Basert på disse dataene, generer 4 konkrete handlingsprioriteter for denne uken på norsk. Returner KUN en JSON-array med strenger.

Data:
- Følgere: ${followers}
- Snitt-seere: ${avgViewers}
- Discord-membres: ${discordMembers}
- Aktive Discord-membres: ${activeMembers}
- Community Score: ${communityScore}/100
- Growth Score: ${growthScore}/100
- Sponsor Score: ${sponsorScore}/100
- Klipp denne uken: ${clipCount}
- Raids mottatt: ${events.raids?.length ?? 0}

Eksempel output: ["Lag 3 TikTok-klipp fra siste stream", "Stream Escape from Tarkov mer – høyere retention"]`,
        }],
        max_tokens: 200,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });
      try {
        const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
        prioriteter = parsed.prioriteter ?? parsed.actions ?? parsed.anbefalinger ?? [];
      } catch {}
    }

    return NextResponse.json({
      communityScore,
      growthScore,
      sponsorScore,
      prioriteter,
      data: { followers, avgViewers, discordMembers, activeMembers, totalMessages, clipCount, isLive: stream?.isLive ?? false },
    });
  } catch (err) {
    return NextResponse.json({ communityScore: 0, growthScore: 0, sponsorScore: 0, prioriteter: [], data: {} });
  }
}
