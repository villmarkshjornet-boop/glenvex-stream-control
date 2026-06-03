import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getStreamInfo, getBroadcasterId } from '@/lib/twitch';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const stream = await getStreamInfo();
    if (!stream.isLive) return NextResponse.json({ targets: [], reason: 'Ikke live' });

    const broadcasterId = await getBroadcasterId();
    const clientId = process.env.TWITCH_CLIENT_ID;

    // Hent kanaler i samme kategori
    const token = broadcasterId ? await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
      { method: 'POST' }
    ).then(r => r.json()).then(d => d.access_token) : null;

    let targets: any[] = [];
    if (token && stream.game) {
      // Hent streams i samme kategori
      const res = await fetch(
        `https://api.twitch.tv/helix/streams?game_id=${encodeURIComponent(stream.game)}&first=20&language=no`,
        { headers: { 'Client-ID': clientId!, Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json() as any;
        targets = (data.data ?? [])
          .filter((s: any) => s.user_login !== process.env.TWITCH_USERNAME?.toLowerCase())
          .slice(0, 10)
          .map((s: any) => ({
            username: s.user_name,
            login: s.user_login,
            viewers: s.viewer_count,
            game: s.game_name,
            title: s.title,
            url: `https://twitch.tv/${s.user_login}`,
          }));
      }
    }

    // AI scoring av targets
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey && targets.length > 0) {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `GLENVEX streamer ${stream.game} med ${stream.viewerCount} seere. Ranger disse potensielle raid-målene og gi en kort begrunnelse for topp 3. Returner KUN JSON:
{"anbefalinger": [{"login": "...", "score": 85, "grunn": "..."}]}

Kanaler:
${targets.map(t => `- ${t.username}: ${t.viewers} seere, ${t.game}`).join('\n')}`,
        }],
        max_tokens: 300,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });
      try {
        const ai = JSON.parse(res.choices[0]?.message?.content ?? '{}');
        const scores = new Map(ai.anbefalinger?.map((a: any) => [a.login, { score: a.score, grunn: a.grunn }]) ?? []);
        targets = targets.map(t => ({ ...t, ...((scores.get(t.login) as any) ?? { score: 50, grunn: '' }) }))
          .sort((a: any, b: any) => b.score - a.score);
      } catch {}
    }

    return NextResponse.json({ targets: targets.slice(0, 5), currentGame: stream.game, currentViewers: stream.viewerCount });
  } catch {
    return NextResponse.json({ targets: [], reason: 'API-feil' });
  }
}
