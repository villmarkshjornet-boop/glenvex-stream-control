import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { startAudienceTracking, recordViewerCount, stopAudienceTracking } from './audienceTracker';

const FILE = path.join(process.cwd(), 'data', 'stream-history.json');
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? 'glenvex-default';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return createClient(url, key, { realtime: { transport: require('ws') }, auth: { autoRefreshToken: false, persistSession: false } });
}

export interface StreamSession {
  id: string;
  title: string;
  game: string;
  startedAt: string;
  endedAt?: string;
  peakViewers: number;
  avgViewers: number;
  durationMinutes: number;
  followerGain: number;
  chatMessages: number;
  raidsDuring: number;
  subsGained: number;
}

function load(): StreamSession[] {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return [];
}

function save(data: StreamSession[]) {
  try {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

let activeSession: Partial<StreamSession> | null = null;
let chatMessageCount = 0;

export function startSession(stream: { id: string; title: string; game: string; startedAt: string; viewerCount?: number }) {
  activeSession = {
    id: stream.id,
    title: stream.title,
    game: stream.game,
    startedAt: stream.startedAt,
    peakViewers: stream.viewerCount ?? 0,
    avgViewers: stream.viewerCount ?? 0,
    chatMessages: 0,
    raidsDuring: 0,
    subsGained: 0,
    followerGain: 0,
    durationMinutes: 0,
  };
  chatMessageCount = 0;
  startAudienceTracking(stream.id, stream.game, stream.title);
}

export function updateSession(viewerCount: number) {
  if (!activeSession) return;
  if (viewerCount > (activeSession.peakViewers ?? 0)) activeSession.peakViewers = viewerCount;
  activeSession.avgViewers = Math.round(((activeSession.avgViewers ?? 0) + viewerCount) / 2);
  recordViewerCount(viewerCount);
}

export function incrementChatMessages() {
  if (activeSession) chatMessageCount++;
}

export function endSession(followerGain = 0) {
  if (!activeSession?.id || !activeSession.startedAt) return;
  const started = new Date(activeSession.startedAt).getTime();
  const duration = Math.round((Date.now() - started) / 60_000);

  const session: StreamSession = {
    id: activeSession.id,
    title: activeSession.title ?? '',
    game: activeSession.game ?? '',
    startedAt: activeSession.startedAt,
    endedAt: new Date().toISOString(),
    peakViewers: activeSession.peakViewers ?? 0,
    avgViewers: activeSession.avgViewers ?? 0,
    durationMinutes: duration,
    followerGain,
    chatMessages: chatMessageCount,
    raidsDuring: activeSession.raidsDuring ?? 0,
    subsGained: activeSession.subsGained ?? 0,
  };

  const history = load();
  history.unshift(session);
  save(history.slice(0, 50));
  activeSession = null;
  stopAudienceTracking().catch(() => {});

  // Sync til Supabase stream_history for at Sponsor Manager og andre API-er får data
  const sb = getSupabase();
  if (sb) {
    sb.from('stream_history').upsert({
      id: session.id,
      workspace_id: WORKSPACE_ID,
      title: session.title,
      game: session.game,
      started_at: session.startedAt,
      ended_at: session.endedAt,
      peak_viewers: session.peakViewers,
      avg_viewers: session.avgViewers,
      duration_minutes: session.durationMinutes,
      followers_gained: session.followerGain,
      chat_messages: session.chatMessages,
      raids_during: session.raidsDuring,
      subs_gained: session.subsGained,
    }, { onConflict: 'id' }).then(undefined, () => {});
  }
}

export function getHistory(): StreamSession[] {
  return load();
}

export function getActiveSession() {
  return activeSession;
}

export function addRaidToSession() {
  if (activeSession) activeSession.raidsDuring = (activeSession.raidsDuring ?? 0) + 1;
}

export function addSubToSession() {
  if (activeSession) activeSession.subsGained = (activeSession.subsGained ?? 0) + 1;
}
