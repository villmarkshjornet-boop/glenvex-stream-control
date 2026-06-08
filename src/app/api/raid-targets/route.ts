import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getStreamInfo, getBroadcasterId } from '@/lib/twitch';
import { logSystemEvent } from '@/lib/systemEvents';
import { upsertMemory } from '@/lib/ai/creatorContext';
import { logAgentDecision } from '@/lib/ai/eventLogger';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const stream = await getStreamInfo();
    if (!stream.isLive) return NextResponse.json({ targets: [], reason: 'Ikke live' });

    const broadcasterId = await getBroadcasterId();
    const clientId = process.env.TWITCH_CLIENT_ID;

    const token = clientId ? await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
      { method: 'POST' }
    ).then(r => r.json()).then(d => d.access_token as string).catch(() => null) : null;

    let targets: any[] = [];
    let gameId: string | null = null;

    if (token && stream.game) {
      // Resolve game name → game_id first
      const gameRes = await fetch(
        `https://api.twitch.tv/helix/games?name=${encodeURIComponent(stream.game)}`,
        { headers: { 'Client-ID': clientId!, Authorization: `Bearer ${token}` } }
      );
      if (gameRes.ok) {
        const gameData = await gameRes.json() as any;
        gameId = gameData.data?.[0]?.id ?? null;
      }

      if (gameId) {
        // Try Norwegian-language streams first, fall back to all languages
        const tryFetch = async (lang?: string) => {
          const langParam = lang ? `&language=${lang}` : '';
          const res = await fetch(
            `https://api.twitch.tv/helix/streams?game_id=${encodeURIComponent(gameId!)}&first=30${langParam}`,
            { headers: { 'Client-ID': clientId!, Authorization: `Bearer ${token}` } }
          );
          if (!res.ok) return [];
          const data = await res.json() as any;
          return (data.data ?? []).filter((s: any) =>
            s.user_login !== process.env.TWITCH_USERNAME?.toLowerCase() &&
            s.user_id !== broadcasterId
          );
        };

        let streams = await tryFetch('no');
        if (streams.length < 3) {
          // Not enough Norwegian streamers — fetch all and take top
          streams = await tryFetch();
        }

        targets = streams.slice(0, 10).map((s: any) => ({
          username: s.user_name,
          login: s.user_login,
          viewers: s.viewer_count,
          game: s.game_name,
          title: s.title,
          url: `https://twitch.tv/${s.user_login}`,
          language: s.language,
        }));
      }
    }

    await logSystemEvent({
      source: 'raid_manager',
      event_type: 'RAID_CANDIDATES_CHECKED',
      title: `Raid-kandidater hentet: ${targets.length} kanaler funnet`,
      severity: 'info',
      metadata: { game: stream.game, gameId, candidateCount: targets.length, currentViewers: stream.viewerCount },
    });

    // AI scoring av targets
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey && targets.length > 0) {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `GLENVEX streamer ${stream.game} med ${stream.viewerCount} seere. Ranger disse potensielle raid-målene og gi en kort begrunnelse for topp 3. Foretrekk kanaler med lignende seertal og norsk språk. Returner KUN JSON:
{"anbefalinger": [{"login": "...", "score": 85, "grunn": "..."}]}

Kanaler:
${targets.map(t => `- ${t.username}: ${t.viewers} seere, ${t.game}, språk: ${t.language}`).join('\n')}`,
        }],
        max_tokens: 400,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });
      try {
        const ai = JSON.parse(res.choices[0]?.message?.content ?? '{}');
        const scores = new Map(ai.anbefalinger?.map((a: any) => [a.login, { score: a.score, grunn: a.grunn }]) ?? []);
        targets = targets.map(t => ({ ...t, ...((scores.get(t.login) as any) ?? { score: 50, grunn: '' }) }))
          .sort((a: any, b: any) => b.score - a.score);

        if (targets.length > 0) {
          const top = targets[0];
          await Promise.all([
            logSystemEvent({
              source: 'raid_manager',
              event_type: 'RAID_RECOMMENDATION_CREATED',
              title: `Raid-anbefaling: ${top?.username} (score: ${top?.score})`,
              severity: 'info',
              metadata: { topTarget: top?.login, score: top?.score, grunn: top?.grunn },
            }),
            // Store raid recommendation in memory so future runs can check history
            upsertMemory({
              agent_type: 'content',
              memory_type: 'stream_pattern',
              key: `raid_target_${top?.login ?? 'unknown'}`,
              summary: `Raid-mål ${top?.username}: score ${top?.score}, ${top?.game}, ${top?.viewers} seere. Grunn: ${(top?.grunn ?? '').slice(0, 100)}`,
              confidence_score: Math.min(1, (top?.score ?? 50) / 100),
              metadata: { login: top?.login, game: top?.game, viewers: top?.viewers, score: top?.score, raidTarget: true, lastRecommendedAt: new Date().toISOString() },
            }),
            logAgentDecision({
              agent_type: 'raid_manager',
              decision_type: 'raid_recommendation',
              input_context: { game: stream.game, currentViewers: stream.viewerCount, candidateCount: targets.length },
              decision_summary: `Anbefalte raid til ${top?.username} (score: ${top?.score}): ${(top?.grunn ?? '').slice(0, 100)}`,
              outcome: 'recommended',
            }),
          ]).catch(() => {});
        }
      } catch {}
    }

    return NextResponse.json({
      targets: targets.slice(0, 5),
      currentGame: stream.game,
      currentViewers: stream.viewerCount,
      gameId,
    });
  } catch (err) {
    console.error('[RaidTargets]', (err as Error).message);
    return NextResponse.json({ targets: [], reason: 'API-feil' });
  }
}
