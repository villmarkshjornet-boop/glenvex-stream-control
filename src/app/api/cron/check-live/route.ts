import { NextRequest, NextResponse } from 'next/server';
import { getStreamInfo } from '@/lib/twitch';
import { postLiveEmbed } from '@/lib/discord';
import { getSettings } from '@/lib/settings';
import { addLog } from '@/lib/logger';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { getLiveKanalId } from '@/lib/discordChannel';

export const dynamic = 'force-dynamic';

async function logEvent(source: string, event_type: string, title: string, severity = 'info', metadata?: Record<string, any>) {
  try {
    const db = getDb();
    if (!db) return;
    await db.from('system_events').insert({
      workspace_id: getWorkspaceId(),
      source,
      event_type,
      title,
      severity,
      metadata: metadata ?? null,
    });
  } catch {}
}

export async function POST(req: NextRequest) {
  const secret =
    req.headers.get('x-cron-secret') ||
    new URL(req.url).searchParams.get('secret');

  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await logEvent('scheduler', 'HEARTBEAT', 'Cron check-live kjørte', 'info', {
    trigger: 'vercel_cron',
    ts: new Date().toISOString(),
  });

  try {
    const wsId = getWorkspaceId();
    const db   = getDb();

    // Load workspace Twitch identity from DB — never use env/hardcode fallback
    let twitchLogin: string | null = null;
    let brandName:   string        = 'Stream';

    if (db) {
      const { data: ws } = await db
        .from('workspaces')
        .select('twitch_login,brand_name')
        .eq('id', wsId)
        .single();
      twitchLogin = ws?.twitch_login ?? null;
      brandName   = ws?.brand_name   ?? 'Stream';
    }

    if (!twitchLogin) {
      await logEvent('scheduler', 'WORKSPACE_MISSING_TWITCH', 'Cron check-live: workspace mangler twitch_login — kjør Repair i admin', 'warning', {
        wsId, field: 'twitch_login',
      });
      return NextResponse.json({ status: 'skipped', reason: 'twitch_not_connected' });
    }

    // lastNotifiedStreamId MUST come from DB — the filesystem is ephemeral on Vercel.
    // getSettings() / saveSettings() use data/settings.json which resets each invocation.
    let lastNotifiedStreamId: string | null = null;
    if (db) {
      const { data: wsSnap } = await db
        .from('workspaces')
        .select('settings_json')
        .eq('id', wsId)
        .single();
      lastNotifiedStreamId = (wsSnap?.settings_json as any)?.lastNotifiedStreamId ?? null;
    }

    // File-based settings are still used for autoPostLive (default: true).
    // lastNotifiedStreamId is intentionally NOT read from here — see DB read above.
    const settings = getSettings();
    const stream   = await getStreamInfo(twitchLogin);

    addLog('info', `System sjekk fullført – ${stream.isLive ? 'LIVE' : 'Offline'}`, 'OK');

    if (stream.isLive) {
      if (stream.id && stream.id === lastNotifiedStreamId) {
        await logEvent('scheduler', 'LIVE_ALREADY_NOTIFIED', `Stream allerede varslet: ${stream.id}`, 'info', {
          streamId: stream.id,
          game: stream.game,
          viewerCount: stream.viewerCount,
        });
        return NextResponse.json({ status: 'already_notified', streamId: stream.id });
      }

      await logEvent('scheduler', 'LIVE_DETECTED', `Stream er live: ${stream.title?.slice(0, 60) ?? 'Ingen tittel'}`, 'info', {
        streamId: stream.id,
        game: stream.game,
        viewerCount: stream.viewerCount,
        title: stream.title,
      });

      // Reset per_stream goals when a new stream starts
      if (db && stream.id) {
        try {
          const { data: wsGoals } = await db
            .from('workspaces')
            .select('settings_json')
            .eq('id', wsId)
            .single();
          const currentGoals: any[] = wsGoals?.settings_json?.viewer_goals ?? [];
          const resetTime = new Date().toISOString();
          let resetCount = 0;

          const updatedGoals = currentGoals.map((g: any) => {
            if (g.resetPolicy === 'per_stream' && g.lastResetStreamId !== stream.id) {
              resetCount++;
              return {
                ...g,
                gjeldende: g.startValue ?? 0,
                lastResetStreamId: stream.id,
                lastResetAt: resetTime,
              };
            }
            return g;
          });

          if (resetCount > 0) {
            const currentSettings = wsGoals?.settings_json ?? {};
            await db.from('workspaces').update({
              settings_json: { ...currentSettings, viewer_goals: updatedGoals },
              updated_at: new Date().toISOString(),
            }).eq('id', wsId);
            await logEvent('scheduler', 'PER_STREAM_GOALS_RESET', `Nullstilte ${resetCount} per_stream-goal(s) ved ny stream`, 'info', {
              streamId: stream.id,
              resetCount,
            });
          }
        } catch {}
      }

      if (settings.autoPostLive) {
        const liveKanalId = await getLiveKanalId();
        if (!liveKanalId) {
          await logEvent('scheduler', 'DISCORD_LIVE_ANNOUNCEMENT_SKIPPED', 'Live-varsel hoppet over — ingen kanal konfigurert', 'warning', {
            reason: 'missing_channel_preference',
            streamId: stream.id,
            workspaceId: wsId,
          });
        } else {
          const liveSettings = { ...settings, discordLiveChannelId: liveKanalId };
          await postLiveEmbed(stream, liveSettings, { brandName, twitchLogin });
          addLog('success', 'Discord live-varsel sendt', 'OK');
          await logEvent('scheduler', 'DISCORD_LIVE_ANNOUNCEMENT_SENT', `Discord varslet: ${stream.title?.slice(0, 60) ?? ''}`, 'info', {
            workspaceId: wsId,
            channelId: liveKanalId,
            streamId: stream.id,
          });
        }
      }

      // Persist lastNotifiedStreamId to DB — filesystem is ephemeral on Vercel.
      if (stream.id && db) {
        try {
          const { data: current } = await db.from('workspaces').select('settings_json').eq('id', wsId).single();
          const merged = { ...(current?.settings_json as object ?? {}), lastNotifiedStreamId: stream.id };
          await db.from('workspaces').update({ settings_json: merged, updated_at: new Date().toISOString() }).eq('id', wsId);
        } catch {}
      }
      return NextResponse.json({ status: 'notified', stream });
    } else {
      if (lastNotifiedStreamId) {
        if (db) {
          try {
            const { data: current } = await db.from('workspaces').select('settings_json').eq('id', wsId).single();
            const merged = { ...(current?.settings_json as object ?? {}), lastNotifiedStreamId: null };
            await db.from('workspaces').update({ settings_json: merged, updated_at: new Date().toISOString() }).eq('id', wsId);
          } catch {}
        }
        addLog('info', 'Stream er offline – varslings-ID nullstilt', 'OK');
        await logEvent('scheduler', 'STREAM_OFFLINE_DETECTED', 'Stream er offline', 'info');
      }
      return NextResponse.json({ status: 'offline', stream });
    }
  } catch (error) {
    const msg = (error as Error).message;
    addLog('error', `Feil ved cron-sjekk: ${msg}`, 'ERROR');
    await logEvent('scheduler', 'CRON_FAILED', `check-live feilet: ${msg.slice(0, 120)}`, 'error', { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
