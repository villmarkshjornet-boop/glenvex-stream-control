import { NextResponse } from 'next/server';
import { isContentFactoryEnabled } from '@/lib/content-factory';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

interface QAFeil {
  type: string;
  entitetId: string;
  felt: string;
  verdi: any;
  anbefaling: string;
}

function erGyldigTall(v: any): boolean {
  const n = parseFloat(String(v ?? ''));
  return !isNaN(n) && isFinite(n);
}

function erGyldigDato(v: any): boolean {
  if (!v) return false;
  const d = new Date(v);
  return !isNaN(d.getTime());
}

export async function GET() {
  if (!isContentFactoryEnabled()) {
    return NextResponse.json({ error: 'FEATURE_DISABLED' }, { status: 403 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ status: 'FAILED', feil: [{ type: 'DB', entitetId: '', felt: 'supabase', verdi: null, anbefaling: 'Supabase ikke tilkoblet' }] });

  const feil: QAFeil[] = [];

  // Hent siste 5 VODs
  const { data: vods } = await db.from('content_vods').select('*')
    .eq('workspace_id', getWorkspaceId())
    .order('created_at', { ascending: false })
    .limit(5);

  for (const v of vods ?? []) {
    if (!v.title) feil.push({ type: 'VOD', entitetId: v.id, felt: 'title', verdi: v.title, anbefaling: 'Hent Twitch VOD-metadata på nytt' });
    if (!erGyldigDato(v.created_at)) feil.push({ type: 'VOD', entitetId: v.id, felt: 'created_at', verdi: v.created_at, anbefaling: 'created_at mangler eller er ugyldig' });
    if (!v.status) feil.push({ type: 'VOD', entitetId: v.id, felt: 'status', verdi: v.status, anbefaling: 'VOD mangler status' });
  }

  // Hent siste 100 highlights
  const { data: highlights } = await db.from('content_highlights').select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  for (const h of highlights ?? []) {
    if (!h.vod_id) feil.push({ type: 'HIGHLIGHT', entitetId: h.id, felt: 'vod_id', verdi: null, anbefaling: 'Highlight mangler VOD-kobling' });
    if (!erGyldigTall(h.start_time)) feil.push({ type: 'HIGHLIGHT', entitetId: h.id, felt: 'start_time', verdi: h.start_time, anbefaling: 'start_time er null eller NaN – DISCOVER lagret feil' });
    if (!erGyldigTall(h.end_time)) feil.push({ type: 'HIGHLIGHT', entitetId: h.id, felt: 'end_time', verdi: h.end_time, anbefaling: 'end_time er null eller NaN – DISCOVER lagret feil' });
    if (erGyldigTall(h.start_time) && erGyldigTall(h.end_time)) {
      const start = parseFloat(h.start_time);
      const slutt = parseFloat(h.end_time);
      if (slutt <= start) feil.push({ type: 'HIGHLIGHT', entitetId: h.id, felt: 'end_time', verdi: h.end_time, anbefaling: `end_time (${slutt}) er ikke etter start_time (${start})` });
    }
    if (!erGyldigTall(h.score) || h.score < 0 || h.score > 100) feil.push({ type: 'HIGHLIGHT', entitetId: h.id, felt: 'score', verdi: h.score, anbefaling: 'Score må være tall 0-100' });
    if (!h.category) feil.push({ type: 'HIGHLIGHT', entitetId: h.id, felt: 'category', verdi: null, anbefaling: 'Kategori mangler – GPT-svar manglet category-felt' });
    if (!h.title) feil.push({ type: 'HIGHLIGHT', entitetId: h.id, felt: 'title', verdi: null, anbefaling: 'Tittel mangler – GPT-svar manglet title-felt' });
  }

  // Sammendrag
  const nanRisiko = (highlights ?? []).filter(h => !erGyldigTall(h.start_time) || !erGyldigTall(h.end_time)).length;
  const ugyldigDato = (vods ?? []).filter(v => !erGyldigDato(v.created_at)).length;
  const utenStartEnd = nanRisiko;
  const utenKategori = (highlights ?? []).filter(h => !h.category).length;

  const status = feil.length === 0 ? 'PASSED' : 'FAILED';

  return NextResponse.json({
    status,
    sjekket: { vods: (vods ?? []).length, highlights: (highlights ?? []).length },
    sammendrag: { nanRisiko, ugyldigDato, utenStartEnd, utenKategori, totalFeil: feil.length },
    feil: feil.slice(0, 50), // Maks 50 feil vist
  });
}
