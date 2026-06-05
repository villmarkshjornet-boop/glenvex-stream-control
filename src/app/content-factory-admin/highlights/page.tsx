'use client';

import { useEffect, useState } from 'react';

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

function tidFormat(sek: number): string {
  const h = Math.floor(sek / 3600);
  const m = Math.floor((sek % 3600) / 60);
  const s = Math.floor(sek % 60);
  return h > 0
    ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
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

  useEffect(() => {
    fetch('/api/content-factory').then(r => r.json()).then(d => setVods(d.vods ?? []));
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
    await fetch('/api/content-factory/clip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vodId: valgtVod, highlightId }),
    });
    setKlipperH(null);
  }

  function kopier(tekst: string, id: string) {
    navigator.clipboard.writeText(tekst);
    setKopiert(id);
    setTimeout(() => setKopiert(null), 2000);
  }

  const hCopy = (h: Highlight) => copies.filter(c => c.highlight_id === h.id);
  const hAssets = (h: Highlight) => assets.filter(a => a.highlight_id === h.id);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Highlight Viewer</h1>
        <p className="text-[10px] text-g-muted mt-0.5">Se alle highlights, captions og generer videoklipp</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* VOD-velger */}
        <div className="bg-g-card border border-g-border rounded-xl p-4 space-y-2">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">VODs</p>
          {vods.filter(v => v.status === 'COMPLETE').length === 0 ? (
            <p className="text-[10px] text-g-muted">Ingen fullførte VODs ennå.</p>
          ) : vods.filter(v => v.status === 'COMPLETE').map(v => (
            <button key={v.id} onClick={() => hentHighlights(v.id)}
              className={`w-full text-left p-2.5 rounded-lg border text-xs transition-all ${valgtVod === v.id ? 'border-g-green/30 bg-g-green/5' : 'border-g-border hover:border-g-green/20'}`}>
              <p className="font-bold text-g-text truncate">{v.title ?? 'Ukjent stream'}</p>
              <p className="text-[9px] text-g-muted mt-0.5">{v.category} · {new Date(v.created_at).toLocaleDateString('no-NO')}</p>
            </button>
          ))}
        </div>

        {/* Highlight-liste */}
        <div className="lg:col-span-3 space-y-3">
          {loading && (
            <div className="bg-g-card border border-g-border rounded-xl p-8 text-center">
              <span className="w-6 h-6 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin inline-block" />
            </div>
          )}

          {!loading && highlights.length === 0 && valgtVod && (
            <div className="bg-g-card border border-g-border rounded-xl p-6 text-center">
              <p className="text-xs text-g-muted">Ingen highlights. Kjør Phase 2 for denne VOD-en.</p>
            </div>
          )}

          {!loading && highlights.map(h => {
            const copy = hCopy(h);
            const yt = copy.find(c => c.platform === 'youtube');
            const tt = copy.find(c => c.platform === 'tiktok');
            const ig = copy.find(c => c.platform === 'instagram');
            const erValgt = valgtH?.id === h.id;

            return (
              <div key={h.id} className={`bg-g-card border rounded-xl overflow-hidden transition-all ${erValgt ? 'border-g-green/30' : 'border-g-border'}`}>
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
                    {/* Video / Preview / Download */}
                    <div className="bg-g-bg border border-g-border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Videoklipp</p>
                        <span className={`text-[8px] px-2 py-0.5 rounded border font-bold uppercase ${
                          (h as any).clip_status === 'CLIPPED' ? 'text-g-green border-g-green/30' :
                          (h as any).clip_status === 'CLIPPING' ? 'text-yellow-400 border-yellow-400/30 animate-pulse' :
                          (h as any).clip_status === 'CLIP_FAILED' ? 'text-red-400 border-red-400/30' :
                          'text-g-muted border-g-border'
                        }`}>{(h as any).clip_status ?? 'READY_FOR_CLIP'}</span>
                      </div>

                      <div className="flex items-start gap-3">
                        <div className="flex-1 text-xs space-y-0.5">
                          <p className="text-g-text">Start: <span className="text-g-green font-mono font-bold">{tidFormat(h.start_time)}</span></p>
                          <p className="text-g-text">Slutt: <span className="text-g-green font-mono font-bold">{tidFormat(h.end_time)}</span></p>
                          <p className="text-g-text">Varighet: <span className="text-g-green font-mono font-bold">{Math.round(h.end_time - h.start_time)}s</span></p>
                          {(h as any).clip_error && <p className="text-red-400 text-[9px] mt-1">✗ {(h as any).clip_error}</p>}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {(h as any).clip_status !== 'CLIPPING' && (
                            <button onClick={() => genererKlipp(h.id)} disabled={klipperH === h.id}
                              className="px-3 py-1.5 bg-g-green/10 border border-g-green/20 text-g-green text-[10px] font-bold rounded hover:bg-g-green/20 transition-all">
                              {klipperH === h.id ? '⏳...' : (h as any).clip_status === 'CLIPPED' ? '↻ Re-generer' : '▶ Generer klipp'}
                            </button>
                          )}
                          {(h as any).clip_status === 'CLIP_FAILED' && (
                            <button onClick={async () => {
                              await fetch('/api/content-factory/clip-retry', {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ highlightId: h.id }),
                              });
                              hentHighlights(valgtVod);
                            }} className="px-3 py-1.5 bg-yellow-400/10 border border-yellow-400/20 text-yellow-400 text-[10px] font-bold rounded hover:bg-yellow-400/20 transition-all">
                              ↺ Retry
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Video preview */}
                      {(h as any).clip_url && (
                        <div className="space-y-2">
                          <p className="text-[9px] text-g-muted font-bold uppercase">16:9 – YouTube / Twitch</p>
                          <video controls className="w-full rounded border border-g-border" style={{ maxHeight: '200px' }}>
                            <source src={(h as any).clip_url} type="video/mp4" />
                          </video>
                          <a href={(h as any).clip_url} download={`${h.title ?? 'highlight'}_16x9.mp4`}
                            className="inline-block px-3 py-1.5 bg-g-bg border border-g-border rounded text-[10px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                            ↓ Last ned 16:9
                          </a>
                        </div>
                      )}

                      {(h as any).vertical_clip_url && (
                        <div className="space-y-2">
                          <p className="text-[9px] text-g-muted font-bold uppercase">9:16 – TikTok / Shorts / Reel</p>
                          <video controls className="mx-auto rounded border border-g-border" style={{ maxHeight: '300px', maxWidth: '170px' }}>
                            <source src={(h as any).vertical_clip_url} type="video/mp4" />
                          </video>
                          <a href={(h as any).vertical_clip_url} download={`${h.title ?? 'highlight'}_9x16.mp4`}
                            className="inline-block px-3 py-1.5 bg-g-bg border border-g-border rounded text-[10px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                            ↓ Last ned 9:16
                          </a>
                        </div>
                      )}
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
                            <p className="text-[9px] text-purple-400 font-bold uppercase">📸 Instagram</p>
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
