/**
 * VOD Watcher – Automatisk deteksjon av nye VODs etter stream
 * Kjøres fra bot/index.ts som bakgrunnsjobb
 * Krever: CONTENT_FACTORY_ENABLED=true
 */

import { isContentFactoryEnabled } from '../index';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import { logSystemEvent } from '@/lib/systemEvents';

const TWITCH_API = 'https://api.twitch.tv/helix';

async function getTwitchToken(): Promise<string | null> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const res = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
      { method: 'POST' }
    );
    const data = await res.json() as any;
    return data.access_token ?? null;
  } catch { return null; }
}

async function hentSisteVod(token: string, minDurationSek = 5 * 60): Promise<{ id: string; title: string; category: string; duration: number; url: string; stream_id?: string; created_at?: string } | null> {
  const username = process.env.TWITCH_USERNAME;
  if (!username) return null;

  try {
    // Hent bruker-ID
    const userRes = await fetch(`${TWITCH_API}/users?login=${username}`, {
      headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${token}` },
    });
    const userData = await userRes.json() as any;
    const userId = userData.data?.[0]?.id;
    if (!userId) return null;

    // Hent siste 3 arkiverte streams (fallback-kandidater hvis nyeste ikke er klar ennå)
    const vodRes = await fetch(`${TWITCH_API}/videos?user_id=${userId}&type=archive&first=3`, {
      headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${token}` },
    });
    const vodData = await vodRes.json() as any;
    const vods: any[] = vodData.data ?? [];
    if (vods.length === 0) return null;

    const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;

    for (const vod of vods) {
      let durationSek = 0;
      const m = (vod.duration ?? '').match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
      if (m) durationSek = (parseInt(m[1]??'0')*3600)+(parseInt(m[2]??'0')*60)+parseInt(m[3]??'0');

      // Filtrer: for kort (sannsynligvis ikke den riktige streamen)
      if (durationSek < minDurationSek) continue;

      // Filtrer: eldre enn 24 timer (forrige stream, ikke den som nettopp endte)
      const vodCreatedAt = vod.created_at ? new Date(vod.created_at).getTime() : 0;
      if (vodCreatedAt > 0 && vodCreatedAt < cutoff24h) continue;

      return { id: vod.id, title: vod.title, category: vod.game_name ?? 'Ukjent', duration: durationSek, url: vod.url, stream_id: vod.stream_id, created_at: vod.created_at };
    }

    return null;
  } catch { return null; }
}

async function erVodAlleredeBehandlet(twitchVodId: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const { count } = await db.from('content_vods')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', getWorkspaceId())
    .eq('twitch_vod_id', twitchVodId);
  return (count ?? 0) > 0;
}

let forrigeStream = false;
let offlineSiden: Date | null = null;

export async function sjekkForNyVod(
  erLive: boolean,
  startPipeline: (twitchVodId: string, twitchVodUrl: string) => Promise<void>
): Promise<{ funnet: boolean; vodId?: string; melding: string }> {
  if (!isContentFactoryEnabled()) return { funnet: false, melding: 'Content Factory deaktivert' };

  // Detekter overgang fra live til offline
  // STREAM_OFFLINE_DETECTED eies av bot/index.ts — logg ikke her for å unngå duplikater
  if (forrigeStream && !erLive) {
    offlineSiden = new Date();
    console.log('[VODWatcher] Stream gikk offline – venter 15 min');
  }
  forrigeStream = erLive;

  // Fallback: boten restartet mens streamen var offline — sjekk system_events for å gjenopprette tilstand
  if (!erLive && !offlineSiden) {
    try {
      const db = getDb();
      const ws = getWorkspaceId();
      if (db && ws) {
        const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
        const { data } = await db
          .from('system_events')
          .select('created_at')
          .eq('workspace_id', ws)
          .eq('event_type', 'STREAM_OFFLINE_DETECTED')
          .gte('created_at', cutoff)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data?.created_at) {
          const offlineAt = new Date(data.created_at);
          const minutesSince = (Date.now() - offlineAt.getTime()) / 60_000;
          if (minutesSince >= 15) {
            // Boten restartet og 15 min har allerede gått — start VOD-søk umiddelbart
            console.log(`[VODWatcher] Gjenopprettet offline-tilstand fra system_events (${Math.round(minutesSince)} min siden)`);
            offlineSiden = offlineAt;
            forrigeStream = false;
          }
        }
      }
    } catch {}
  }

  if (erLive || !offlineSiden) {
    return { funnet: false, melding: erLive ? 'Stream er live' : 'Ingen stream registrert' };
  }

  // Sjekk om 15 minutter har gått siden stream stoppet
  const venteSek = 15 * 60;
  const gåttSek = (Date.now() - offlineSiden.getTime()) / 1000;
  if (gåttSek < venteSek) {
    const gjenståendeSek = Math.round(venteSek - gåttSek);
    return { funnet: false, melding: `Venter ${gjenståendeSek}s til (15 min etter offline)` };
  }

  // Finn nyeste VOD
  logSystemEvent({ source: 'vod_watcher', event_type: 'VOD_LOOKUP_STARTED', title: 'Søker etter ny VOD på Twitch', severity: 'info' }).catch(() => {});
  const token = await getTwitchToken();
  if (!token) return { funnet: false, melding: 'Ingen Twitch-token' };

  const vod = await hentSisteVod(token);
  if (!vod) {
    logSystemEvent({ source: 'vod_watcher', event_type: 'VOD_NOT_FOUND', title: 'Ingen VOD funnet på Twitch', severity: 'warning' }).catch(() => {});
    return { funnet: false, melding: 'Ingen VOD funnet på Twitch' };
  }

  // Duplikatsjekk
  const alleredeBehandlet = await erVodAlleredeBehandlet(vod.id);
  if (alleredeBehandlet) {
    offlineSiden = null; // Reset
    return { funnet: false, melding: `VOD ${vod.id} er allerede behandlet` };
  }

  console.log(`[VODWatcher] Ny VOD funnet: "${vod.title}" (${vod.id}) – starter pipeline`);
  logSystemEvent({ source: 'vod_watcher', event_type: 'VOD_AUTO_QUEUE_STARTED', title: `VOD satt i kø: "${vod.title}"`, severity: 'info', metadata: { vodId: vod.id, title: vod.title, category: vod.category, duration: vod.duration, stream_id: vod.stream_id } }).catch(() => {});
  offlineSiden = null; // Reset så vi ikke starter flere ganger

  // Start pipeline asynkront
  startPipeline(vod.id, `https://www.twitch.tv/videos/${vod.id}`).catch(console.error);

  return { funnet: true, vodId: vod.id, melding: `Pipeline startet for: "${vod.title}"` };
}
