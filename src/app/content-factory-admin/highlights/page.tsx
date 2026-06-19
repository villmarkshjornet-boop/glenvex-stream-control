'use client';

import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/ui';

const BRAND_SLUG = process.env.NEXT_PUBLIC_BRAND_SLUG ?? 'streamer';

interface Highlight {
  id: string;
  vod_id: string;
  start_time: number;
  end_time: number;
  score: number;
  category: string;
  title: string;
  begrunnelse: string;
  rank: number;
  status: string;
  clip_status?: string;
  clip_url?: string | null;
  vertical_clip_url?: string | null;
  clip_finished_at?: string | null;
  clip_error?: string | null;
  thumbnail_status?: string | null;
  thumbnail_youtube_url?: string | null;
  thumbnail_tiktok_url?: string | null;
  thumbnail_error?: string | null;
  thumbnail_headline?: string | null;
  thumbnail_subheadline?: string | null;
  thumbnail_quality_score?: number | null;
  thumbnail_source_frame?: number | null;
  thumbnail_variant_b_url?: string | null;
  thumbnail_variant_c_url?: string | null;
  thumbnail_ctr_score?: number | null;
  thumbnail_ctr_reason?: string | null;
}

interface Copy {
  id: string;
  highlight_id: string;
  platform: string;
  tittel: string;
  beskrivelse: string;
  hashtags: string[];
  caption: string;
  discord_post: string;
}

interface Asset {
  id: string;
  highlight_id: string;
  type: string;
  format: string;
  storage_url: string;
  status: string;
}

const KAT_FARGE: Record<string, string> = {
  FUNNY: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
  FAIL: 'text-red-400 border-red-400/30 bg-red-400/10',
  CLUTCH: 'text-g-green border-g-green/30 bg-g-green/10',
  RAGE: 'text-orange-400 border-orange-400/30 bg-orange-400/10',
  REACTION: 'text-blue-400 border-blue-400/30 bg-blue-400/10',
  TACTICAL: 'text-purple-400 border-purple-400/30 bg-purple-400/10',
  RP_MOMENT: 'text-pink-400 border-pink-400/30 bg-pink-400/10',
  EDUCATIONAL: 'text-cyan-400 border-cyan-400/30 bg-cyan-400/10',
};

function tidFormat(sek: number | string | null | undefined): string {
  const n = parseFloat(String(sek ?? ''));
  if (!n && n !== 0) return 'Ukjent';
  if (isNaN(n) || !isFinite(n)) return 'Ukjent';
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = Math.floor(n % 60);
  return h > 0
    ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function sikkerDato(dato: string | null | undefined): string {
  if (!dato) return 'Ukjent dato';
  const d = new Date(dato);
  if (isNaN(d.getTime())) return 'Ukjent dato';
  return d.toLocaleDateString('no-NO');
}

export default function HighlightViewerPage() {
  const [vods, setVods] = useState<any[]>([]);
  const [valgtVod, setValgtVod] = useState('');
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [copies, setCopies] = useState<Copy[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [valgtH, setValgtH] = useState<Highlight | null>(null);
  const [loading, setLoading] = useState(false);
  const [klipperH, setKlipperH] = useState<string | null>(null);
  const [kopiert, setKopiert] = useState<string | null>(null);
  const [pollerKlipp, setPollerKlipp] = useState(false);
  const [phase2Running, setPhase2Running] = useState(false);
  const [phase2Res, setPhase2Res] = useState<any>(null);
  const [lasterZip, setLasterZip] = useState<string | null>(null);
  const [regenerererThumb, setRegenerererThumb] = useState<string | null>(null);
  const [posterDiscord, setPosterDiscord] = useState<string | null>(null);
  const [discordPostet, setDiscordPostet] = useState<string | null>(null);
  const [discordFeil, setDiscordFeil] = useState<string | null>(null);
  const [thumbFeil, setThumbFeil] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/content-factory').then(r => r.json()).then(d => {
      // API returnerer snake_case direkte fra DB
      setVods(d.vods ?? []);
    });
  }, []);

  async function hentHighlights(vodId: string) {
    setLoading(true);
    setValgtVod(vodId);
    setValgtH(null);
    const res = await fetch(`/api/content-factory/${vodId}`).then(r => r.json());
    setHighlights((res.highlights ?? []).sort((a: Highlight, b: Highlight) => (a.rank ?? 99) - (b.rank ?? 99)));
    setCopies(res.copy ?? []);
    setAssets([]);
    setLoading(false);
  }

  async function genererKlipp(highlightId: string) {
    setKlipperH(highlightId);
    const res = await fetch('/api/content-factory/clip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vodId: valgtVod, highlightId }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok && d.error) {
      console.error('[Klipp]', d.error);
    }
    setKlipperH(null);
    await hentHighlights(valgtVod);
    setPollerKlipp(true);
  }

  // Poll så lenge noe er READY_FOR_CLIP eller CLIPPING (maks 15 min)
  const pollerStartRef = useRef<number>(0);
  useEffect(() => {
    if (!pollerKlipp || !valgtVod) return;
    if (!pollerStartRef.current) pollerStartRef.current = Date.now();
    const harAktiv = highlights.some(h =>
      h.clip_status === 'CLIPPING' || h.clip_status === 'READY_FOR_CLIP' ||
      // Stop thumbnail polling the moment the URL arrives, regardless of status
      ((h.thumbnail_status === 'GENERATING' || h.thumbnail_status === 'PENDING') && !h.thumbnail_youtube_url)
    );
    const timeoutNådd = Date.now() - pollerStartRef.current > 15 * 60 * 1000;
    if (!harAktiv || timeoutNådd) {
      setPollerKlipp(false);
      pollerStartRef.current = 0;
      return;
    }
    const t = setTimeout(() => hentHighlights(valgtVod), 5000);
    return () => clearTimeout(t);
  }, [pollerKlipp, highlights, valgtVod]);

  function kopier(tekst: string, id: string) {
    navigator.clipboard.writeText(tekst);
    setKopiert(id);
    setTimeout(() => setKopiert(null), 2000);
  }

  async function kjørPhase2() {
    if (!valgtVod) return;
    setPhase2Running(true);
    setPhase2Res(null);
    const res = await fetch('/api/content-factory/phase2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vodId: valgtVod }),
    });
    const d = await res.json().catch(() => ({ error: 'Timeout/nettverksfeil' }));
    setPhase2Res(d);
    setPhase2Running(false);
    if (d.ok) await hentHighlights(valgtVod);
  }

  async function lastNedZip(highlightId: string, tittel: string) {
    setLasterZip(highlightId);
    try {
      const res = await fetch(`/api/content-factory/zip/${highlightId}`);
      if (!res.ok) { console.error('ZIP feil:', await res.text()); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${BRAND_SLUG}_highlight_${tittel.replace(/\s+/g, '_').slice(0, 40)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error('ZIP nedlasting feil:', e); }
    setLasterZip(null);
  }

  const hCopy = (h: Highlight) => copies.filter(c => c.highlight_id === h.id);
  const hAssets = (h: Highlight) => assets.filter(a => a.highlight_id === h.id);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <PageHeader title="Highlight Viewer" subtitle="Se alle highlights, captions og generer videoklipp" />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* VOD-velger */}
        <div className="bg-g-card border border-g-border rounded-2xl p-4 space-y-2">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">VODs ({vods.length})</p>
          {vods.length === 0 ? (
            <p className="text-[10px] text-g-muted">Ingen VODs. Start pipeline i Content Factory.</p>
          ) : vods.map(v => (
            <button key={v.id} onClick={() => hentHighlights(v.id)}
              className={`w-full text-left p-2.5 rounded-lg border text-xs transition-all ${valgtVod === v.id ? 'border-g-green/30 bg-g-green/5' : 'border-g-border hover:border-g-green/20'}`}>
              <p className="font-bold text-g-text truncate">{v.title ?? 'Ukjent stream'}</p>
              <p className="text-[9px] text-g-muted mt-0.5">
                {v.category || 'Ukjent'} · {sikkerDato(v.created_at)}
              </p>
              <span className={`text-[8px] font-bold ${
                v.status === 'COMPLETE' ? 'text-g-green' :
                v.status === 'FAILED' ? 'text-red-400' :
                'text-yellow-400'
              }`}>{v.status}</span>
            </button>
          ))}
        </div>

        {/* Highlight-liste */}
        <div className="lg:col-span-3 space-y-3">
          {loading && (
            <div className="bg-g-card border border-g-border rounded-2xl p-8 text-center">
              <span className="w-6 h-6 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin inline-block" />
            </div>
          )}

          {!loading && highlights.length === 0 && valgtVod && (
            <div className="bg-g-card border border-g-border rounded-2xl p-6 text-center space-y-3">
              <p className="text-xs text-g-muted">Ingen highlights for denne VOD-en.</p>
              <p className="text-[9px] text-g-muted">Railway må ha fullført Phase 1 (transkripsjon) før Phase 2 kan kjøres.</p>
              <button
                onClick={kjørPhase2}
                disabled={phase2Running}
                className="px-4 py-2 bg-g-green/10 border border-g-green/20 text-g-green text-xs font-bold rounded hover:bg-g-green/20 transition-all"
              >
                {phase2Running ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 border border-g-green/30 border-t-g-green rounded-full animate-spin" />
                    Kjører Phase 2...
                  </span>
                ) : '◆ Kjør Phase 2 (Highlights + tekster)'}
              </button>
              {phase2Res && (
                <div className={`text-xs p-2 rounded border ${phase2Res.ok ? 'border-g-green/30 text-g-green' : 'border-red-500/30 text-red-400'}`}>
                  {phase2Res.ok
                    ? `✓ ${phase2Res.antallHighlights} highlights funnet`
                    : `✗ ${phase2Res.error}`}
                </div>
              )}
            </div>
          )}

          {!loading && highlights.map(h => {
            const copy = hCopy(h);
            const yt = copy.find(c => c.platform === 'youtube');
            const tt = copy.find(c => c.platform === 'tiktok');
            const ig = copy.find(c => c.platform === 'instagram');
            const erValgt = valgtH?.id === h.id;

            return (
              <div key={h.id} className={`bg-g-card border rounded-2xl overflow-hidden transition-all ${erValgt ? 'border-g-green/30' : 'border-g-border'}`}>
                {/* Highlight-header */}
                <div className="p-4 cursor-pointer" onClick={() => setValgtH(erValgt ? null : h)}>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-g-green/10 border border-g-green/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-g-green font-black text-xs">#{h.rank ?? '?'}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase ${KAT_FARGE[h.category] ?? 'text-g-muted border-g-border'}`}>
                          {h.category}
                        </span>
                        <span className="text-[9px] text-g-green font-black">Score: {h.score}/100</span>
                        <span className="text-[9px] text-g-muted ml-auto">
                          {tidFormat(h.start_time)} → {tidFormat(h.end_time)}
                          {' '}({Math.round(h.end_time - h.start_time)}s)
                        </span>
                      </div>
                      <p className="text-xs font-bold text-g-text truncate">{h.title}</p>
                      {h.begrunnelse && <p className="text-[9px] text-g-muted mt-0.5 italic">{h.begrunnelse}</p>}
                    </div>
                    <span className="text-g-muted text-xs flex-shrink-0">{erValgt ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Utvidet visning */}
                {erValgt && (
                  <div className="border-t border-g-border p-4 space-y-4">
                    {/* Klipp-status og handlinger */}
                    <div className="bg-g-bg border border-g-border rounded-lg p-4 space-y-3">
                      {/* Status-header */}
                      <div className="flex items-center justify-between">
                        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Videoklipp</p>
                        <span className={`text-[8px] px-2 py-0.5 rounded border font-bold uppercase ${
                          h.clip_status === 'CLIPPED'        ? 'text-g-green border-g-green/30 bg-g-green/5' :
                          h.clip_status === 'CLIPPING'       ? 'text-yellow-400 border-yellow-400/30 animate-pulse' :
                          h.clip_status === 'READY_FOR_CLIP' ? 'text-blue-400 border-blue-400/30' :
                          h.clip_status === 'CLIP_FAILED'    ? 'text-red-400 border-red-400/30' :
                          'text-g-muted border-g-border'
                        }`}>{h.clip_status ?? 'READY_FOR_CLIP'}</span>
                      </div>

                      {/* Synlig statusboks */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono">
                        <span className="text-g-muted">Highlight ID</span>
                        <span className="text-g-text truncate">{h.id}</span>
                        <span className="text-g-muted">Start → Slutt</span>
                        <span className="text-g-green">{tidFormat(h.start_time)} → {tidFormat(h.end_time)} ({Math.round(h.end_time - h.start_time)}s)</span>
                        <span className="text-g-muted">Status</span>
                        <span className={h.clip_status === 'CLIPPED' ? 'text-g-green' : h.clip_status === 'CLIPPING' ? 'text-yellow-400' : 'text-g-muted'}>
                          {h.clip_status ?? 'READY_FOR_CLIP'}
                        </span>
                        {h.clip_finished_at && <>
                          <span className="text-g-muted">Ferdig</span>
                          <span className="text-g-muted">{sikkerDato(h.clip_finished_at)}</span>
                        </>}
                        {h.clip_url && <>
                          <span className="text-g-muted">16:9 URL</span>
                          <span className="text-g-green truncate">✓ Tilgjengelig</span>
                        </>}
                        {h.vertical_clip_url && <>
                          <span className="text-g-muted">9:16 URL</span>
                          <span className="text-g-green truncate">✓ Tilgjengelig</span>
                        </>}
                        {h.clip_error && <>
                          <span className="text-red-400">Feil</span>
                          <span className="text-red-400 break-all">{h.clip_error}</span>
                        </>}
                      </div>

                      {/* Statusmeldinger */}
                      {h.clip_status === 'READY_FOR_CLIP' && (
                        <div className="flex items-center gap-2 p-2 bg-blue-400/5 border border-blue-400/20 rounded text-[10px] text-blue-400">
                          <span className="w-2 h-2 border border-blue-400/40 border-t-blue-400 rounded-full animate-spin flex-shrink-0" />
                          I kø – bruk «Force klipp nå» for øyeblikkelig klipping
                        </div>
                      )}
                      {h.clip_status === 'CLIPPING' && (
                        <div className="flex items-center gap-2 p-2 bg-yellow-400/5 border border-yellow-400/20 rounded text-[10px] text-yellow-400">
                          <span className="w-2 h-2 border border-yellow-400/40 border-t-yellow-400 rounded-full animate-spin flex-shrink-0" />
                          Railway klipper nå – laster ned og koder video (2–5 min)...
                        </div>
                      )}

                      {/* Handlingsknapper */}
                      <div className="flex flex-wrap gap-2">
                        {/* Force klipp – alltid tilgjengelig unntatt når CLIPPING */}
                        {h.clip_status !== 'CLIPPING' && (
                          <button
                            onClick={async () => {
                              setKlipperH(h.id);
                              await fetch('/api/content-factory/clip-force', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ highlightId: h.id }),
                              });
                              setKlipperH(null);
                              setPollerKlipp(true);
                              await hentHighlights(valgtVod);
                            }}
                            disabled={klipperH === h.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-g-green/10 border border-g-green/30 text-g-green text-[10px] font-black rounded hover:bg-g-green/20 transition-all disabled:opacity-40"
                          >
                            {klipperH === h.id ? (
                              <><span className="w-2.5 h-2.5 border border-g-green/40 border-t-g-green rounded-full animate-spin" /> Starter...</>
                            ) : (
                              <>{h.clip_status === 'CLIPPED' ? '↻' : '▶'} {h.clip_status === 'CLIPPED' ? 'Re-klipp' : 'Force klipp nå'}</>
                            )}
                          </button>
                        )}

                        {/* Vanlig Generer klipp (via syklus) */}
                        {(h.clip_status === 'CLIP_FAILED' || !h.clip_status) && (
                          <button
                            onClick={() => genererKlipp(h.id)}
                            className="px-3 py-1.5 bg-g-bg border border-g-border text-g-muted text-[10px] font-bold rounded hover:text-g-green hover:border-g-green/30 transition-all"
                          >
                            ↺ Legg i kø (60s polling)
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Nedlasting av ferdige videoer */}
                    {(h.clip_url || h.vertical_clip_url) && (
                      <div className="bg-g-bg border border-g-green/20 rounded-lg p-4 space-y-3">
                        <p className="text-[9px] text-g-green uppercase tracking-widest font-bold">Klar for nedlasting</p>

                        {h.clip_url && (
                          <div className="space-y-2">
                            <p className="text-[9px] text-g-muted font-bold uppercase">16:9 – YouTube / Twitch</p>
                            <video controls className="w-full rounded border border-g-border" style={{ maxHeight: '200px' }}>
                              <source src={h.clip_url} type="video/mp4" />
                            </video>
                            <a href={h.clip_url} download={`${h.title ?? 'highlight'}_16x9.mp4`}
                              className="inline-block px-3 py-1.5 bg-g-bg border border-g-green/30 rounded text-[10px] text-g-green hover:bg-g-green/10 transition-all font-bold">
                              ↓ Last ned 16:9 MP4
                            </a>
                          </div>
                        )}

                        {h.vertical_clip_url && (
                          <div className="space-y-2">
                            <p className="text-[9px] text-g-muted font-bold uppercase">9:16 – TikTok / Shorts / Reel</p>
                            <video controls className="mx-auto rounded border border-g-border" style={{ maxHeight: '300px', maxWidth: '170px' }}>
                              <source src={h.vertical_clip_url} type="video/mp4" />
                            </video>
                            <a href={h.vertical_clip_url} download={`${h.title ?? 'highlight'}_9x16.mp4`}
                              className="inline-block px-3 py-1.5 bg-g-bg border border-g-green/30 rounded text-[10px] text-g-green hover:bg-g-green/10 transition-all font-bold">
                              ↓ Last ned 9:16 MP4
                            </a>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Post til Discord */}
                    {h.clip_status === 'CLIPPED' && h.clip_url && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={async () => {
                            setPosterDiscord(h.id);
                            setDiscordPostet(null);
                            const res = await fetch('/api/content-factory/post-discord', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ highlightId: h.id }),
                            });
                            const d = await res.json().catch(() => ({}));
                            setPosterDiscord(null);
                            if (res.ok) {
                              setDiscordPostet(h.id);
                              setDiscordFeil(null);
                              setTimeout(() => setDiscordPostet(null), 4000);
                            } else {
                              setDiscordFeil(d.error ?? 'Discord-posting feilet');
                              setTimeout(() => setDiscordFeil(null), 6000);
                            }
                          }}
                          disabled={posterDiscord === h.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-[10px] font-black rounded hover:bg-indigo-500/20 transition-all disabled:opacity-40"
                        >
                          {posterDiscord === h.id ? (
                            <><span className="w-2.5 h-2.5 border border-indigo-400/40 border-t-indigo-400 rounded-full animate-spin" /> Poster...</>
                          ) : discordPostet === h.id ? (
                            <>✓ Postet!</>
                          ) : (
                            <>◈ Post til Discord</>
                          )}
                        </button>
                        {discordFeil && <p className="text-[9px] text-red-400 mt-1">{discordFeil}</p>}
                      </div>
                    )}

                    {/* AI Thumbnails – kun når klippet er ferdig */}
                    {h.clip_status === 'CLIPPED' && (
                      <div className="bg-g-bg border border-purple-400/20 rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-[9px] text-purple-400 uppercase tracking-widest font-bold">AI Thumbnails</p>
                          <span className={`text-[8px] px-2 py-0.5 rounded border font-bold uppercase ${
                            h.thumbnail_status === 'DONE'               ? 'text-purple-400 border-purple-400/30 bg-purple-400/5' :
                            h.thumbnail_status === 'GENERATING'         ? 'text-yellow-400 border-yellow-400/30 animate-pulse' :
                            h.thumbnail_status === 'PENDING'            ? 'text-blue-400 border-blue-400/30' :
                            h.thumbnail_status === 'FAILED'             ? 'text-red-400 border-red-400/30' :
                            h.thumbnail_status === 'NEEDS_MANUAL_REVIEW'? 'text-orange-400 border-orange-400/30 bg-orange-400/5' :
                            'text-g-muted border-g-border'
                          }`}>
                            {h.thumbnail_status === 'DONE' ? 'COMPLETE' : (h.thumbnail_status ?? 'IKKE GENERERT')}
                          </span>
                        </div>

                        {/* Quality score + CTR score + source frame */}
                        {h.thumbnail_status === 'DONE' && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              {h.thumbnail_quality_score != null && (
                                <span className={`text-[9px] px-2 py-0.5 rounded border font-bold ${
                                  h.thumbnail_quality_score >= 80 ? 'text-green-400 border-green-400/30 bg-green-400/5' :
                                  h.thumbnail_quality_score >= 60 ? 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5' :
                                  'text-red-400 border-red-400/30 bg-red-400/5'
                                }`}>
                                  ★ Score {h.thumbnail_quality_score}/100
                                </span>
                              )}
                              {h.thumbnail_ctr_score != null && (
                                <span className={`text-[9px] px-2 py-0.5 rounded border font-bold ${
                                  h.thumbnail_ctr_score >= 75 ? 'text-purple-400 border-purple-400/30 bg-purple-400/5' :
                                  h.thumbnail_ctr_score >= 55 ? 'text-blue-400 border-blue-400/30 bg-blue-400/5' :
                                  'text-g-muted border-g-border'
                                }`}>
                                  ◈ CTR {h.thumbnail_ctr_score}/100
                                </span>
                              )}
                              {h.thumbnail_source_frame != null && (
                                <span className="text-[9px] text-g-muted">
                                  Frame @ {h.thumbnail_source_frame.toFixed(1)}s
                                </span>
                              )}
                            </div>
                            {h.thumbnail_ctr_reason && (
                              <p className="text-[9px] text-g-muted italic">
                                Vision: {h.thumbnail_ctr_reason}
                              </p>
                            )}
                          </div>
                        )}

                        {(h.thumbnail_status === 'GENERATING' || h.thumbnail_status === 'PENDING') && (
                          <div className="flex items-center gap-2 p-2 bg-yellow-400/5 border border-yellow-400/20 rounded text-[10px] text-yellow-400">
                            <span className="w-2 h-2 border border-yellow-400/40 border-t-yellow-400 rounded-full animate-spin flex-shrink-0" />
                            {h.thumbnail_status === 'GENERATING'
                              ? 'Genererer V7 (Pango + IMPACT_DRAMA) – ca 60s...'
                              : 'Thumbnail i kø – plukkes opp automatisk...'}
                          </div>
                        )}

                        {h.thumbnail_youtube_url && (
                          <div className="space-y-1.5">
                            <p className="text-[9px] text-g-muted font-bold uppercase">▶ YouTube 16:9</p>
                            <img
                              src={h.thumbnail_youtube_url}
                              alt="YouTube thumbnail"
                              className="w-full rounded border border-g-border"
                              style={{ maxHeight: '160px', objectFit: 'cover' }}
                            />
                            {h.thumbnail_headline && (
                              <p className="text-[9px] text-purple-400 font-bold">
                                {h.thumbnail_headline}
                                {h.thumbnail_subheadline ? ` · ${h.thumbnail_subheadline}` : ''}
                              </p>
                            )}
                            <a
                              href={h.thumbnail_youtube_url}
                              download="thumbnail_youtube.png"
                              className="inline-block px-3 py-1 bg-g-bg border border-purple-400/30 rounded text-[10px] text-purple-400 hover:bg-purple-400/10 transition-all font-bold"
                            >
                              ↓ Last ned YouTube thumbnail
                            </a>
                          </div>
                        )}

                        {h.thumbnail_tiktok_url && (
                          <div className="space-y-1.5">
                            <p className="text-[9px] text-g-muted font-bold uppercase">♪ TikTok 9:16</p>
                            <img
                              src={h.thumbnail_tiktok_url}
                              alt="TikTok thumbnail"
                              className="mx-auto rounded border border-g-border"
                              style={{ maxHeight: '210px', maxWidth: '120px', objectFit: 'cover' }}
                            />
                            <a
                              href={h.thumbnail_tiktok_url}
                              download="thumbnail_tiktok.png"
                              className="inline-block px-3 py-1 bg-g-bg border border-purple-400/30 rounded text-[10px] text-purple-400 hover:bg-purple-400/10 transition-all font-bold"
                            >
                              ↓ Last ned TikTok thumbnail
                            </a>
                          </div>
                        )}

                        {/* Variant B – Cinema */}
                        {h.thumbnail_variant_b_url && (
                          <div className="space-y-1.5 border-t border-g-border pt-3">
                            <p className="text-[9px] text-indigo-400 font-bold uppercase">◈ Variant B – Cinema</p>
                            <img
                              src={h.thumbnail_variant_b_url}
                              alt="Variant B thumbnail"
                              className="w-full rounded border border-indigo-400/20"
                              style={{ maxHeight: '160px', objectFit: 'cover' }}
                            />
                            <a
                              href={h.thumbnail_variant_b_url}
                              download="thumbnail_variant_b.png"
                              className="inline-block px-3 py-1 bg-g-bg border border-indigo-400/30 rounded text-[10px] text-indigo-400 hover:bg-indigo-400/10 transition-all font-bold"
                            >
                              ↓ Last ned Variant B
                            </a>
                          </div>
                        )}

                        {/* Variant C – Impact Block */}
                        {h.thumbnail_variant_c_url && (
                          <div className="space-y-1.5 border-t border-g-border pt-3">
                            <p className="text-[9px] text-orange-400 font-bold uppercase">◈ Variant C – Impact Block</p>
                            <img
                              src={h.thumbnail_variant_c_url}
                              alt="Variant C thumbnail"
                              className="w-full rounded border border-orange-400/20"
                              style={{ maxHeight: '160px', objectFit: 'cover' }}
                            />
                            <a
                              href={h.thumbnail_variant_c_url}
                              download="thumbnail_variant_c.png"
                              className="inline-block px-3 py-1 bg-g-bg border border-orange-400/30 rounded text-[10px] text-orange-400 hover:bg-orange-400/10 transition-all font-bold"
                            >
                              ↓ Last ned Variant C
                            </a>
                          </div>
                        )}

                        {h.thumbnail_error && (
                          <p className="text-[9px] text-red-400 break-all">Feil: {h.thumbnail_error}</p>
                        )}

                        {/* Generer/regenerer-knapp */}
                        {h.thumbnail_status !== 'GENERATING' && (
                          <>
                          <button
                            onClick={async () => {
                              setRegenerererThumb(h.id);
                              setHighlights(prev => prev.map(x =>
                                x.id === h.id ? { ...x, thumbnail_status: 'GENERATING', thumbnail_error: null, thumbnail_youtube_url: null } : x
                              ));
                              const res = await fetch('/api/content-factory/thumbnails/generate-v2', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ highlight_id: h.id }),
                              });
                              const d = await res.json().catch(() => ({}));
                              setRegenerererThumb(null);
                              if (!res.ok) {
                                setThumbFeil(d.error ?? 'Thumbnail-generering feilet');
                                setTimeout(() => setThumbFeil(null), 8000);
                                await hentHighlights(valgtVod);
                              } else {
                                // Start polling — stopper automatisk når status er DONE/FAILED
                                pollerStartRef.current = Date.now();
                                setPollerKlipp(true);
                              }
                            }}
                            disabled={regenerererThumb === h.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-g-bg border border-purple-400/30 text-purple-400 text-[10px] font-black rounded hover:bg-purple-400/10 transition-all disabled:opacity-40"
                          >
                            {regenerererThumb === h.id ? (
                              <><span className="w-2.5 h-2.5 border border-purple-400/40 border-t-purple-400 rounded-full animate-spin" /> Genererer V7 (~60s)...</>
                            ) : (
                              <>↻ {h.thumbnail_status === 'DONE' ? 'Regenerer thumbnail' : 'Generer thumbnail'}</>
                            )}
                          </button>
                          {thumbFeil && <p className="text-[9px] text-red-400 mt-1">{thumbFeil}</p>}
                          </>
                        )}
                      </div>
                    )}

                    {/* ZIP-pakke */}
                    <div className="flex items-center gap-3 pt-1">
                      <button
                        onClick={() => lastNedZip(h.id, h.title ?? 'highlight')}
                        disabled={lasterZip === h.id}
                        className="flex items-center gap-2 px-4 py-2 bg-g-green/10 border border-g-green/30 text-g-green text-xs font-bold rounded-lg hover:bg-g-green/20 transition-all disabled:opacity-50"
                      >
                        {lasterZip === h.id ? (
                          <>
                            <span className="w-3 h-3 border border-g-green/30 border-t-g-green rounded-full animate-spin" />
                            Pakker...
                          </>
                        ) : (
                          <>
                            ↓ Last ned pakke (ZIP)
                          </>
                        )}
                      </button>
                      <p className="text-[9px] text-g-muted">tekster + metadata + thumbnails (hvis klare)</p>
                    </div>

                    {/* Captions */}
                    <div className="space-y-3">
                      {yt && (
                        <div className="p-3 bg-g-bg border border-red-400/20 rounded-lg">
                          <div className="flex justify-between items-center mb-1">
                            <p className="text-[9px] text-red-400 font-bold uppercase">▶ YouTube</p>
                            <button onClick={() => kopier(`${yt.tittel}\n\n${yt.beskrivelse}\n\n${(yt.hashtags ?? []).join(' ')}`, `yt-${h.id}`)}
                              className="text-[9px] text-g-muted hover:text-g-green transition-colors">
                              {kopiert === `yt-${h.id}` ? '✓ Kopiert!' : 'Kopier'}
                            </button>
                          </div>
                          <p className="text-xs font-bold text-g-text">{yt.tittel}</p>
                          <p className="text-[10px] text-g-muted mt-1">{yt.beskrivelse}</p>
                          <p className="text-[9px] text-g-green mt-1">{(yt.hashtags ?? []).join(' ')}</p>
                        </div>
                      )}
                      {tt && (
                        <div className="p-3 bg-g-bg border border-pink-400/20 rounded-lg">
                          <div className="flex justify-between items-center mb-1">
                            <p className="text-[9px] text-pink-400 font-bold uppercase">♪ TikTok</p>
                            <button onClick={() => kopier(`${tt.caption}\n\n${(tt.hashtags ?? []).join(' ')}`, `tt-${h.id}`)}
                              className="text-[9px] text-g-muted hover:text-g-green transition-colors">
                              {kopiert === `tt-${h.id}` ? '✓ Kopiert!' : 'Kopier'}
                            </button>
                          </div>
                          <p className="text-xs text-g-text">{tt.caption}</p>
                          <p className="text-[9px] text-g-green mt-1">{(tt.hashtags ?? []).join(' ')}</p>
                        </div>
                      )}
                      {ig && (
                        <div className="p-3 bg-g-bg border border-purple-400/20 rounded-lg">
                          <div className="flex justify-between items-center mb-1">
                            <p className="text-[9px] text-purple-400 font-bold uppercase">Instagram</p>
                            <button onClick={() => kopier(`${ig.caption}\n\n${(ig.hashtags ?? []).join(' ')}`, `ig-${h.id}`)}
                              className="text-[9px] text-g-muted hover:text-g-green transition-colors">
                              {kopiert === `ig-${h.id}` ? '✓ Kopiert!' : 'Kopier'}
                            </button>
                          </div>
                          <p className="text-xs text-g-text">{ig.caption}</p>
                          <p className="text-[9px] text-g-green mt-1">{(ig.hashtags ?? []).join(' ')}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
