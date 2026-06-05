/**
 * VOD Watcher – Automatisk deteksjon av nye VODs etter stream
 * Kjøres fra bot/index.ts som bakgrunnsjobb
 * Krever: CONTENT_FACTORY_ENABLED=true
 */

import { isContentFactoryEnabled } from '../index';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

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

async function hentSisteVod(token: string): Promise<{ id: string; title: string; category: string; duration: number; url: string } | null> {
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

    // Hent siste arkiverte stream
    const vodRes = await fetch(`${TWITCH_API}/videos?user_id=${userId}&type=archive&first=1`, {
      headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${token}` },
    });
    const vodData = await vodRes.json() as any;
    const vod = vodData.data?.[0];
    if (!vod) return null;

    let durationSek = 0;
    const m = (vod.duration ?? '').match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
    if (m) durationSek = (parseInt(m[1]??'0')*3600)+(parseInt(m[2]??'0')*60)+parseInt(m[3]??'0');

    return { id: vod.id, title: vod.title, category: vod.game_name ?? 'Ukjent', duration: durationSek, url: vod.url };
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
  if (forrigeStream && !erLive) {
    offlineSiden = new Date();
    console.log('[VODWatcher] Stream gikk offline – venter 15 min');
  }
  forrigeStream = erLive;

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
  const token = await getTwitchToken();
  if (!token) return { funnet: false, melding: 'Ingen Twitch-token' };

  const vod = await hentSisteVod(token);
  if (!vod) return { funnet: false, melding: 'Ingen VOD funnet på Twitch' };

  // Duplikatsjekk
  const alleredeBehandlet = await erVodAlleredeBehandlet(vod.id);
  if (alleredeBehandlet) {
    offlineSiden = null; // Reset
    return { funnet: false, melding: `VOD ${vod.id} er allerede behandlet` };
  }

  console.log(`[VODWatcher] Ny VOD funnet: "${vod.title}" (${vod.id}) – starter pipeline`);
  offlineSiden = null; // Reset så vi ikke starter flere ganger

  // Start pipeline asynkront
  startPipeline(vod.id, `https://www.twitch.tv/videos/${vod.id}`).catch(console.error);

  return { funnet: true, vodId: vod.id, melding: `Pipeline startet for: "${vod.title}"` };
}
