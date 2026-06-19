'use client';

import { useEffect, useState } from 'react';
import { PageHeader, TabBar, Spinner, EmptyState } from '@/components/ui';

interface ClipContent {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string;
  viewCount: number;
  duration: number;
  createdAt: string;
  innhold?: {
    tiktok: { tittel: string; beskrivelse: string; hashtags: string };
    youtube: { tittel: string; beskrivelse: string };
    instagram: { caption: string; hashtags: string };
  };
  genererer?: boolean;
}

export default function ClipFactoryPage() {
  const [clips, setClips] = useState<ClipContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [valgt, setValgt] = useState<string | null>(null);
  const [plattform, setPlattform] = useState<'tiktok' | 'youtube' | 'instagram'>('tiktok');
  const [kopiert, setKopiert] = useState(false);

  useEffect(() => {
    fetch('/api/clip-factory').then(r => r.json()).then(d => {
      setClips(d.clips ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function genererInnhold(clipId: string) {
    setClips(prev => prev.map(c => c.id === clipId ? { ...c, genererer: true } : c));
    try {
      const clip = clips.find(c => c.id === clipId);
      if (!clip) return;
      const res = await fetch('/api/clip-factory/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId, title: clip.title, duration: clip.duration, viewCount: clip.viewCount }),
      });
      const data = await res.json();
      setClips(prev => prev.map(c => c.id === clipId ? { ...c, innhold: data, genererer: false } : c));
      setValgt(clipId);
    } catch {
      setClips(prev => prev.map(c => c.id === clipId ? { ...c, genererer: false } : c));
    }
  }

  const valgtClip = clips.find(c => c.id === valgt);
  const valgtInnhold = valgtClip?.innhold?.[plattform];

  const plattformTekst = valgtInnhold ? (() => {
    const v = valgtInnhold as any;
    if (plattform === 'tiktok') return `${v.tittel ?? ''}\n\n${v.beskrivelse ?? ''}\n\n${v.hashtags ?? ''}`;
    if (plattform === 'youtube') return `${v.tittel ?? ''}\n\n${v.beskrivelse ?? ''}`;
    return `${v.caption ?? ''}\n\n${v.hashtags ?? ''}`;
  })() : '';

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <PageHeader title="Clip Factory" subtitle="Gjør streams om til innhold for TikTok, YouTube og Instagram" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Clip-liste */}
        <div className="bg-g-card border border-g-border rounded-2xl p-5 space-y-3">
          <p className="text-[9px] text-g-muted font-bold tracking-widest uppercase">Clips denne uken</p>
          {loading ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : clips.length === 0 ? (
            <EmptyState icon="▶" title="Ingen clips" description="Clips hentes automatisk fra Twitch." />
          ) : clips.map(clip => (
            <div key={clip.id}
              onClick={() => setValgt(valgt === clip.id ? null : clip.id)}
              className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-all ${valgt === clip.id ? 'border-g-green/30 bg-g-green/5' : 'border-g-border hover:border-g-green/20'}`}>
              {clip.thumbnailUrl && (
                <img src={clip.thumbnailUrl} alt={clip.title} className="w-20 h-12 object-cover rounded-lg flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-g-text truncate">{clip.title}</p>
                <p className="text-[10px] text-g-muted mt-0.5">{clip.viewCount} visninger · {Math.round(clip.duration)}s</p>
                <button
                  onClick={e => { e.stopPropagation(); genererInnhold(clip.id); }}
                  disabled={clip.genererer}
                  className="mt-1.5 text-[10px] text-g-green hover:underline font-bold">
                  {clip.genererer ? 'Genererer...' : clip.innhold ? '✓ Vis innhold' : '◆ Generer innhold'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Innhold-preview */}
        <div className="bg-g-card border border-g-border rounded-2xl overflow-hidden">
          {!valgtClip?.innhold ? (
            <div className="p-8 h-full flex items-center justify-center">
              <EmptyState icon="◆" title="Velg et klipp" description='Velg et klipp og trykk "Generer innhold"' />
            </div>
          ) : (
            <>
              <div className="flex border-b border-g-border">
                {(['tiktok', 'youtube', 'instagram'] as const).map(p => (
                  <button key={p} onClick={() => setPlattform(p)}
                    className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wider transition-all ${plattform === p ? 'text-g-green border-b-2 border-g-green bg-g-green/5' : 'text-g-muted hover:text-g-text'}`}>
                    {p === 'tiktok' ? 'TikTok' : p === 'youtube' ? 'YouTube' : 'Instagram'}
                  </button>
                ))}
              </div>
              <div className="p-5 space-y-3">
                {valgtInnhold && (
                  <>
                    {'tittel' in valgtInnhold && (
                      <div>
                        <p className="text-[9px] text-g-muted uppercase tracking-widest mb-1">Tittel</p>
                        <p className="text-xs font-bold text-g-text">{(valgtInnhold as any).tittel}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-[9px] text-g-muted uppercase tracking-widest mb-1">
                        {plattform === 'instagram' ? 'Caption' : 'Beskrivelse'}
                      </p>
                      <p className="text-xs text-g-text font-mono whitespace-pre-wrap leading-relaxed">
                        {(valgtInnhold as any).beskrivelse ?? (valgtInnhold as any).caption}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] text-g-muted uppercase tracking-widest mb-1">Hashtags</p>
                      <p className="text-xs text-g-green font-mono">{(valgtInnhold as any).hashtags}</p>
                    </div>
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(plattformTekst);
                        setKopiert(true);
                        setTimeout(() => setKopiert(false), 2000);
                      }}
                      className="w-full py-2 border border-g-border rounded-lg text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                      {kopiert ? '✓ Kopiert!' : 'Kopier til utklippstavle'}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
