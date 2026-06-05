'use client';

/**
 * Content Factory Admin – INTERN SIDE
 * IKKE synlig i navigasjon.
 * Kun tilgjengelig via direkte URL.
 * Krever CONTENT_FACTORY_ENABLED=true
 */

import { useEffect, useState } from 'react';

interface VOD { id: string; title: string; category: string; status: string; duration_seconds: number; created_at: string; twitch_vod_id?: string; }
interface Pakke {
  highlight: { id: string; rank: number; tittel: string; score: number; kategori: string; begrunnelse: string; start: number; slutt: number; };
  videoer: { type: string; format: string; status: string; url?: string; path?: string; størrelse?: number; }[];
  tekster: { youtube?: any; tiktok?: any; instagram?: any; discord?: any; };
}

function tidFormat(sek: number): string {
  const m = Math.floor(sek / 60);
  const s = Math.floor(sek % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function ContentFactoryAdminPage() {
  const [aktivert, setAktivert] = useState<boolean | null>(null);
  const [vods, setVods] = useState<VOD[]>([]);
  const [valgtVod, setValgtVod] = useState<string>('');
  const [pakker, setPakker] = useState<Pakke[]>([]);
  const [sammendrag, setSammendrag] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [startForm, setStartForm] = useState({ streamId: '', audioUrl: '' });
  const [starter, setStarter] = useState(false);
  const [startRes, setStartRes] = useState<any>(null);
  const [feil, setFeil] = useState('');
  const [jobbStatus, setJobbStatus] = useState<any>(null);
  const [valgtHøydepunkt, setValgtHøydepunkt] = useState<string>('');

  useEffect(() => {
    // Sjekk om feature er aktivert
    fetch('/api/content-factory')
      .then(r => {
        if (r.status === 403) { setAktivert(false); return null; }
        setAktivert(true);
        return r.json();
      })
      .then(d => { if (d?.vods) setVods(d.vods); })
      .catch(() => setAktivert(false));
  }, []);

  async function hentDetaljer(vodId: string) {
    setLoading(true);
    setValgtVod(vodId);
    const res = await fetch(`/api/content-factory/download?vodId=${vodId}`).then(r => r.json());
    setPakker(res.pakker ?? []);
    setSammendrag(res.sammendrag ?? null);
    setLoading(false);
  }

  async function startPipeline() {
    if (!startForm.streamId) return;
    setStarter(true);
    setFeil('');
    setStartRes(null);
    try {
      const res = await fetch('/api/content-factory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(startForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStartRes(data);
      const vodsRes = await fetch('/api/content-factory').then(r => r.json());
      setVods(vodsRes.vods ?? []);

      // Hvis Railway-jobb er startet, poll status fra nettleseren
      if (data.steg?.find((s: any) => s.steg === 'UPLOAD_AUDIO' && s.status === 'VENTER')) {
        const botUrl = process.env.NEXT_PUBLIC_BOT_API_URL;
        if (botUrl && data.vodId) {
          const pollInterval = setInterval(async () => {
            const st = await fetch(`${botUrl}/content-factory/status/${data.vodId}`).then(r => r.json()).catch(() => null);
            if (st) {
              setJobbStatus(st);
              if (st.status === 'COMPLETE' || st.status === 'FAILED') {
                clearInterval(pollInterval);
              }
            }
          }, 15000);
        }
      }
    } catch (e) {
      setFeil((e as Error).message);
    }
    setStarter(false);
  }

  if (aktivert === false) {
    return (
      <div className="max-w-2xl mx-auto p-8 space-y-4">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
          <p className="text-red-400 font-black text-lg">🔒 Content Factory er ikke aktivert</p>
          <p className="text-g-muted text-sm mt-2">Sett <code className="text-red-400">CONTENT_FACTORY_ENABLED=true</code> i Vercel og Railway</p>
        </div>
      </div>
    );
  }

  if (aktivert === null) return (
    <div className="flex items-center justify-center h-64">
      <span className="w-8 h-8 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-3 h-3 rounded-full bg-g-green animate-pulse" />
        <div>
          <h1 className="text-xl font-black text-g-text uppercase tracking-wider">Content Factory</h1>
          <p className="text-[10px] text-g-muted">Intern testside · Kun manuell kjøring · Ingen autopublisering</p>
        </div>
        <span className="ml-auto text-[9px] px-2 py-1 bg-yellow-400/10 border border-yellow-400/30 text-yellow-400 rounded-full font-bold">BETA</span>
      </div>

      {/* Start pipeline */}
      <div className="bg-g-card border border-g-border rounded-xl p-5 space-y-4">
        <p className="text-xs font-bold text-g-text">▶ Start Content Factory Pipeline</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[9px] text-g-muted uppercase tracking-widest block mb-1">Twitch VOD ID eller URL</label>
            <input value={startForm.streamId} onChange={e => setStartForm(p => ({ ...p, streamId: e.target.value }))}
              placeholder="2786985500 eller https://twitch.tv/videos/..."
              className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text outline-none focus:border-g-green/50" />
            <p className="text-[9px] text-g-muted mt-1">Finn på twitch.tv/glenvex/videos → klikk video → kopier tall fra URL</p>
          </div>
          <div>
            <label className="text-[9px] text-g-muted uppercase tracking-widest block mb-1">Direkte lyd-URL (valgfritt)</label>
            <input value={startForm.audioUrl} onChange={e => setStartForm(p => ({ ...p, audioUrl: e.target.value }))}
              placeholder="https://... (hopp over Railway-nedlasting)"
              className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text outline-none focus:border-g-green/50" />
            <p className="text-[9px] text-g-muted mt-1">Kun hvis du vil bruke ekstern lydfil direkte</p>
          </div>
        </div>
        <div className="p-3 bg-g-bg border border-g-border rounded-lg">
          <p className="text-[9px] text-g-muted font-bold uppercase mb-1">Pipeline-flyt</p>
          <p className="text-[9px] text-g-muted">VOD ID → Railway laster ned → FFmpeg → Supabase Storage → Whisper → Highlights → Tekster</p>
        </div>
        <button onClick={startPipeline} disabled={!startForm.streamId || starter}
          className="px-5 py-2.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold rounded transition-all disabled:opacity-40">
          {starter ? (
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 border border-g-green/30 border-t-g-green rounded-full animate-spin" />
              Kjører pipeline...
            </span>
          ) : '◆ Start Pipeline'}
        </button>
        {feil && <p className="text-xs text-red-400 font-mono p-2 bg-red-500/10 rounded">✗ {feil}</p>}

        {jobbStatus && (
          <div className={`p-3 rounded border text-xs font-mono space-y-1 ${jobbStatus.status === 'COMPLETE' ? 'border-g-green/30 bg-g-green/5' : jobbStatus.status === 'FAILED' ? 'border-red-500/30 bg-red-500/5' : 'border-yellow-400/30 bg-yellow-400/5'}`}>
            <p className={jobbStatus.status === 'COMPLETE' ? 'text-g-green font-bold' : jobbStatus.status === 'FAILED' ? 'text-red-400 font-bold' : 'text-yellow-400 font-bold'}>
              Railway jobb: {jobbStatus.status}
            </p>
            <p className="text-g-muted">{jobbStatus.melding}</p>
          </div>
        )}
        {startRes && (
          <div className="p-3 bg-g-bg border border-g-green/20 rounded-lg space-y-2">
            <p className="text-xs text-g-green font-bold">✓ Pipeline fullført</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[['Highlights', startRes.antallHighlights], ['Tekster', startRes.antallCopy], ['I kø', startRes.antallIKø]].map(([l, v]) => (
                <div key={l as string} className="bg-g-card border border-g-border rounded p-2">
                  <p className="text-[9px] text-g-muted">{l}</p>
                  <p className="text-sm font-black text-g-green">{v}</p>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              {(startRes.steg ?? []).map((s: any, i: number) => (
                <div key={i} className={`flex items-center gap-2 text-[10px] ${s.status === 'OK' ? 'text-g-green' : s.status === 'FEILET' ? 'text-red-400' : 'text-g-muted'}`}>
                  <span>{s.status === 'OK' ? '✓' : s.status === 'FEILET' ? '✗' : '○'}</span>
                  <span className="font-bold">{s.steg}</span>
                  {s.melding && <span className="text-g-muted">– {s.melding}</span>}
                </div>
              ))}
            </div>
            {startRes.vodId && (
              <button onClick={() => hentDetaljer(startRes.vodId)}
                className="w-full py-1.5 border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                Se resultater →
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-4">
        {/* VOD-liste */}
        <div className="bg-g-card border border-g-border rounded-xl p-4 space-y-2">
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-3">VODs ({vods.length})</p>
          {vods.length === 0 ? (
            <p className="text-[10px] text-g-muted">Ingen VODs ennå. Start en pipeline.</p>
          ) : vods.map(v => (
            <button key={v.id} onClick={() => hentDetaljer(v.id)}
              className={`w-full text-left p-2 rounded-lg border transition-all ${valgtVod === v.id ? 'border-g-green/30 bg-g-green/5' : 'border-g-border hover:border-g-green/20'}`}>
              <p className="text-[10px] font-bold text-g-text truncate">{v.title ?? v.twitch_vod_id ?? v.id.slice(0, 8)}</p>
              <p className="text-[9px] text-g-muted">{v.category} · {v.status}</p>
              <p className="text-[9px] text-g-muted">{new Date(v.created_at).toLocaleDateString('no-NO')}</p>
            </button>
          ))}
        </div>

        {/* Resultater */}
        <div className="col-span-3 space-y-4">
          {loading && (
            <div className="bg-g-card border border-g-border rounded-xl p-8 text-center">
              <span className="w-6 h-6 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin inline-block" />
            </div>
          )}

          {sammendrag && !loading && (
            <div className="grid grid-cols-4 gap-2">
              {[['Highlights', sammendrag.antallHighlights], ['Videoer', sammendrag.antallAssets], ['Tekster', sammendrag.antallTekster], ['I kø', sammendrag.venterGodkjenning]].map(([l, v]) => (
                <div key={l as string} className="bg-g-card border border-g-border rounded-lg p-3 text-center">
                  <p className="text-[9px] text-g-muted uppercase">{l}</p>
                  <p className="text-xl font-black text-g-green font-mono">{v}</p>
                </div>
              ))}
            </div>
          )}

          {pakker.length > 0 && !loading && (
            <div className="space-y-3">
              <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">Highlights og nedlasting</p>
              {pakker.map((p, i) => (
                <div key={p.highlight.id}
                  className={`bg-g-card border rounded-xl p-4 cursor-pointer transition-all ${valgtHøydepunkt === p.highlight.id ? 'border-g-green/30' : 'border-g-border hover:border-g-green/20'}`}
                  onClick={() => setValgtHøydepunkt(valgtHøydepunkt === p.highlight.id ? '' : p.highlight.id)}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-g-green/10 border border-g-green/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-g-green font-black text-xs">#{p.highlight.rank}</span>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-g-text">{p.highlight.tittel ?? `Highlight ${i + 1}`}</p>
                        <p className="text-[9px] text-g-muted">{p.highlight.kategori} · Score: {p.highlight.score}/100 · {tidFormat(p.highlight.start)}–{tidFormat(p.highlight.slutt)}</p>
                        {p.highlight.begrunnelse && <p className="text-[9px] text-g-muted italic mt-0.5">{p.highlight.begrunnelse}</p>}
                      </div>
                    </div>
                    <span className="text-[9px] text-g-muted">{valgtHøydepunkt === p.highlight.id ? '▲' : '▼'}</span>
                  </div>

                  {valgtHøydepunkt === p.highlight.id && (
                    <div className="mt-4 space-y-3 border-t border-g-border/40 pt-4">
                      {/* Videoer */}
                      {p.videoer.length > 0 && (
                        <div>
                          <p className="text-[9px] text-g-muted font-bold uppercase mb-2">Videoer</p>
                          <div className="flex gap-2 flex-wrap">
                            {p.videoer.map((v, j) => (
                              <div key={j} className="flex items-center gap-2 px-3 py-1.5 bg-g-bg border border-g-border rounded-lg">
                                <span className="text-[9px] font-bold text-g-text">{v.type} {v.format}</span>
                                <span className={`text-[8px] font-bold ${v.status === 'READY' ? 'text-g-green' : 'text-g-muted'}`}>{v.status}</span>
                                {v.url && (
                                  <a href={v.url} download className="text-[9px] text-g-green hover:underline">↓ Last ned</a>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Tekster */}
                      <div>
                        <p className="text-[9px] text-g-muted font-bold uppercase mb-2">Tekster (klar til kopiere)</p>
                        <div className="space-y-2">
                          {p.tekster.youtube && (
                            <div className="p-3 bg-g-bg border border-g-border rounded-lg">
                              <p className="text-[9px] text-red-400 font-bold mb-1">▶ YouTube</p>
                              <p className="text-xs font-bold text-g-text">{p.tekster.youtube.tittel}</p>
                              <p className="text-[10px] text-g-muted mt-0.5">{p.tekster.youtube.beskrivelse}</p>
                              <p className="text-[9px] text-g-green mt-1">{(p.tekster.youtube.hashtags ?? []).join(' ')}</p>
                            </div>
                          )}
                          {p.tekster.tiktok && (
                            <div className="p-3 bg-g-bg border border-g-border rounded-lg">
                              <p className="text-[9px] text-pink-400 font-bold mb-1">♪ TikTok</p>
                              <p className="text-xs text-g-text">{p.tekster.tiktok.caption}</p>
                              <p className="text-[9px] text-g-green mt-1">{(p.tekster.tiktok.hashtags ?? []).join(' ')}</p>
                            </div>
                          )}
                          {p.tekster.instagram && (
                            <div className="p-3 bg-g-bg border border-g-border rounded-lg">
                              <p className="text-[9px] text-purple-400 font-bold mb-1">📸 Instagram</p>
                              <p className="text-xs text-g-text">{p.tekster.instagram.caption}</p>
                              <p className="text-[9px] text-g-green mt-1">{(p.tekster.instagram.hashtags ?? []).join(' ')}</p>
                            </div>
                          )}
                          {p.tekster.discord && (
                            <div className="p-3 bg-g-bg border border-g-border rounded-lg">
                              <p className="text-[9px] text-blue-400 font-bold mb-1">◈ Discord</p>
                              <p className="text-xs text-g-text">{p.tekster.discord.discord_post}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Security notice */}
      <div className="border border-yellow-400/20 rounded-lg p-3 text-center">
        <p className="text-[9px] text-yellow-400">⚠ Intern testside · Ingen autopublisering · Alle assets lastes ned manuelt</p>
      </div>
    </div>
  );
}
