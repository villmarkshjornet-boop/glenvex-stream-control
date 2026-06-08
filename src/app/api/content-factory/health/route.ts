import { NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const STORAGE_BUCKET = process.env.STORAGE_BUCKET ?? 'glenvex-assets';

export async function GET() {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const sjekker = await Promise.allSettled([
    // Railway
    (async () => {
      const url = process.env.BOT_API_URL;
      if (!url) return { ok: false, melding: 'BOT_API_URL mangler i Vercel env', url: null };
      // Vis domene (ikke full URL) for debugging
      let domene = '';
      try { domene = new URL(url).hostname; } catch {}
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        return { ok: res.ok, melding: res.ok ? `Online (${domene})` : `HTTP ${res.status} (${domene})`, url: domene };
      } catch (e: any) {
        return { ok: false, melding: `Timeout/offline (${domene}): ${e.message?.slice(0, 60)}`, url: domene };
      }
    })(),
    // Supabase
    (async () => {
      const db = getDb();
      if (!db) return { ok: false, melding: 'Supabase URL/KEY mangler' };
      const { error } = await db.from('content_vods').select('id').limit(1);
      return { ok: !error, melding: error ? error.message : 'OK' };
    })(),
    // Supabase Storage – bruk list() i stedet for getBucket() (admin-operasjon som kan feile)
    (async () => {
      const db = getDb();
      if (!db) return { ok: false, melding: 'Supabase ikke tilkoblet' };
      const { error } = await db.storage.from(STORAGE_BUCKET).list('', { limit: 1 });
      return { ok: !error, melding: error ? `Bucket feil: ${error.message}` : 'OK' };
    })(),
    // OpenAI
    (async () => {
      const key = process.env.OPENAI_API_KEY;
      if (!key) return { ok: false, melding: 'OPENAI_API_KEY mangler' };
      return { ok: true, melding: 'Nøkkel satt' };
    })(),
    // Twitch
    (async () => {
      const id = process.env.TWITCH_CLIENT_ID;
      const secret = process.env.TWITCH_CLIENT_SECRET;
      if (!id || !secret) return { ok: false, melding: 'TWITCH_CLIENT_ID/SECRET mangler' };
      return { ok: true, melding: 'Credentials satt' };
    })(),
  ]);

  const [railway, supabase, storage, openai, twitch] = sjekker.map(r =>
    r.status === 'fulfilled' ? r.value : { ok: false, melding: String((r as any).reason?.message ?? 'Ukjent feil') }
  );

  return NextResponse.json({
    railway,
    supabase,
    storage,
    openai,
    twitch,
    altOk: [railway, supabase, openai].every(s => s.ok),
  });
}
