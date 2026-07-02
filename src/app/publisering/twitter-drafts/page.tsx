'use client';

import { useEffect, useState, useCallback } from 'react';
import { PageHeader } from '@/components/ui';

interface TwitterDraft {
  id: string;
  partner_name: string;
  draft_text: string;
  hashtags: string[] | null;
  affiliate_url: string | null;
  status: 'draft' | 'approved' | 'posted' | 'rejected' | 'archived';
  ai_model: string | null;
  posted_at: string | null;
  posted_url: string | null;
  created_at: string;
  updated_at: string;
}

interface Partner {
  id: string;
  navn: string;
  affiliate_link: string | null;
  beskrivelse: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Utkast',
  approved: 'Godkjent',
  posted: 'Postet',
  rejected: 'Avvist',
  archived: 'Arkivert',
};

const STATUS_BADGE: Record<string, string> = {
  draft:    'bg-g-border text-g-muted text-[11px] font-medium px-2 py-0.5 rounded-full',
  approved: 'bg-g-green/15 text-g-green text-[11px] font-medium px-2 py-0.5 rounded-full',
  posted:   'bg-blue-400/15 text-blue-400 text-[11px] font-medium px-2 py-0.5 rounded-full',
  rejected: 'bg-red-500/15 text-red-400 text-[11px] font-medium px-2 py-0.5 rounded-full',
  archived: 'bg-g-border/50 text-g-muted/60 text-[11px] font-medium px-2 py-0.5 rounded-full',
};

export default function TwitterDraftsPage() {
  const [drafts, setDrafts] = useState<TwitterDraft[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [filter, setFilter] = useState<string>('draft');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  // New draft form
  const [selectedPartner, setSelectedPartner] = useState('');
  const [promptHint, setPromptHint] = useState('');
  const [manualText, setManualText] = useState('');
  const [useManual, setUseManual] = useState(false);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/publisering/twitter-drafts?status=${filter}`);
      if (res.ok) {
        const { drafts: d } = await res.json();
        setDrafts(d ?? []);
      }
    } catch {}
    setLoading(false);
  }, [filter]);

  const loadPartners = useCallback(async () => {
    try {
      const res = await fetch('/api/partners');
      if (res.ok) {
        const data = await res.json();
        setPartners(data?.partners ?? data ?? []);
      }
    } catch {}
  }, []);

  useEffect(() => { loadDrafts(); }, [loadDrafts]);
  useEffect(() => { loadPartners(); }, [loadPartners]);

  const generate = async () => {
    if (!selectedPartner) { setGenError('Velg en partner'); return; }
    const partner = partners.find(p => p.id === selectedPartner);
    if (!partner) return;
    setGenerating(true);
    setGenError(null);

    try {
      const res = await fetch('/api/publisering/twitter-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partnerId: partner.id,
          partnerName: partner.navn,
          partnerDesc: partner.beskrivelse ?? undefined,
          affiliateUrl: partner.affiliate_link ?? undefined,
          promptHint: promptHint || undefined,
          manualText: useManual ? manualText : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPromptHint('');
      setManualText('');
      if (filter === 'draft') await loadDrafts();
    } catch (err: any) {
      setGenError(err?.message ?? 'Generering feilet');
    }
    setGenerating(false);
  };

  const updateStatus = async (id: string, status: TwitterDraft['status'], extra?: Partial<TwitterDraft>) => {
    const res = await fetch('/api/publisering/twitter-drafts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, ...extra }),
    });
    if (res.ok) await loadDrafts();
  };

  const saveEdit = async (id: string) => {
    const res = await fetch('/api/publisering/twitter-drafts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, draftText: editText }),
    });
    if (res.ok) {
      setEditingId(null);
      await loadDrafts();
    }
  };

  const deleteDraft = async (id: string) => {
    await fetch(`/api/publisering/twitter-drafts?id=${id}`, { method: 'DELETE' });
    await loadDrafts();
  };

  const charCount = (text: string) => text.length;

  return (
    <div className="max-w-3xl space-y-5 animate-fade-in">
      <PageHeader title="Twitter / X Utkast" subtitle="AI-genererte partner-innlegg. Godkjenn, rediger og post manuelt." />

      {/* ── Generate new draft ── */}
      <section className="p-5 bg-g-card border border-g-border rounded-2xl">
        <p className="text-xs font-semibold tracking-widest uppercase text-g-muted mb-4">Generer nytt utkast</p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-g-muted mb-1">Partner</label>
            <select
              value={selectedPartner}
              onChange={e => setSelectedPartner(e.target.value)}
              className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200"
            >
              <option value="">Velg partner…</option>
              {partners.map(p => (
                <option key={p.id} value={p.id}>{p.navn}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={useManual} onChange={e => setUseManual(e.target.checked)}
              className="accent-g-green" />
            <span className="text-sm text-g-text">Skriv manuelt (ikke bruk AI)</span>
          </label>

          {useManual ? (
            <div>
              <label className="block text-xs text-g-muted mb-1">Tekst (maks 280 tegn)</label>
              <textarea
                value={manualText}
                onChange={e => setManualText(e.target.value.slice(0, 280))}
                rows={3}
                className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200 resize-none"
                placeholder="Skriv din egen tekst…"
              />
              <div className="text-xs text-g-muted text-right mt-1">{charCount(manualText)}/280</div>
            </div>
          ) : (
            <div>
              <label className="block text-xs text-g-muted mb-1">Ekstra kontekst til AI (valgfritt)</label>
              <input
                type="text"
                value={promptHint}
                onChange={e => setPromptHint(e.target.value)}
                placeholder="f.eks. «fokuser på rabattkoden» eller «gaming-vinkel»"
                className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200"
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={generate}
              disabled={generating || !selectedPartner}
              className="px-4 py-2 bg-g-green/10 border border-g-green/25 text-g-green text-sm font-medium rounded-lg hover:bg-g-green/20 hover:shadow-green-sm transition-all duration-200 disabled:opacity-50"
            >
              {generating ? 'Genererer…' : 'Generer utkast'}
            </button>
          </div>
          {genError && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
              {genError}
            </div>
          )}
        </div>
      </section>

      {/* ── Filter tabs ── */}
      <div className="flex gap-2">
        {(['draft', 'approved', 'posted', 'archived'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${filter === s ? 'bg-g-green/10 text-g-green border-g-green/30' : 'text-g-muted border-g-border hover:text-g-text'}`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {/* ── Draft list ── */}
      {loading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-g-border/40 rounded w-3/4" />
          <div className="h-4 bg-g-border/40 rounded w-1/2" />
          <div className="h-4 bg-g-border/40 rounded w-2/3" />
        </div>
      ) : drafts.length === 0 ? (
        <div className="p-5 bg-g-card border border-g-border rounded-2xl">
          <div className="text-center py-12">
            <p className="text-sm text-g-muted">Ingen {STATUS_LABEL[filter]?.toLowerCase()} utkast ennå.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map(d => (
            <div key={d.id} className={`p-4 bg-g-card border border-g-border rounded-2xl ${filter === 'archived' ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-g-text">{d.partner_name}</span>
                  <span className={STATUS_BADGE[d.status]}>
                    {STATUS_LABEL[d.status]}
                  </span>
                  {d.ai_model && <span className="text-xs text-g-muted">AI: {d.ai_model}</span>}
                </div>
                <span className="text-xs text-g-muted flex-shrink-0">
                  {new Date(d.created_at).toLocaleDateString('nb-NO')}
                </span>
              </div>

              {editingId === d.id ? (
                <div>
                  <textarea
                    value={editText}
                    onChange={e => setEditText(e.target.value.slice(0, 280))}
                    rows={3}
                    className="w-full bg-g-bg border border-g-green/40 rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200 resize-none"
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-g-muted">{charCount(editText)}/280</span>
                    <button onClick={() => saveEdit(d.id)} className="text-xs text-g-green hover:underline">Lagre</button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-g-muted hover:text-g-text">Avbryt</button>
                  </div>
                </div>
              ) : (
                <p
                  className="text-sm text-g-text whitespace-pre-wrap cursor-text hover:bg-g-bg/50 p-1 rounded transition-colors"
                  onClick={() => { setEditingId(d.id); setEditText(d.draft_text); }}
                  title="Klikk for å redigere"
                >
                  {d.draft_text}
                </p>
              )}

              {d.affiliate_url && (
                <div className="mt-2 text-xs text-g-muted">
                  URL: <span className="text-g-green">{d.affiliate_url}</span>
                </div>
              )}

              {d.posted_url && (
                <div className="mt-1 text-xs">
                  <a href={d.posted_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                    Se postet innlegg →
                  </a>
                </div>
              )}

              {/* Action row */}
              {d.status === 'draft' && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => updateStatus(d.id, 'approved')}
                    className="px-3 py-1.5 bg-g-green/10 border border-g-green/25 text-g-green text-xs font-medium rounded-lg hover:bg-g-green/20 transition-all duration-200"
                  >
                    Godkjenn
                  </button>
                  <button
                    onClick={() => { setEditingId(d.id); setEditText(d.draft_text); }}
                    className="px-3 py-1.5 text-g-muted text-xs hover:text-g-text transition-colors"
                  >
                    Rediger
                  </button>
                  <button
                    onClick={() => deleteDraft(d.id)}
                    className="px-3 py-1.5 text-xs text-g-muted hover:text-red-400 transition-colors"
                  >
                    Arkiver
                  </button>
                </div>
              )}

              {d.status === 'approved' && (
                <div className="flex gap-2 mt-3 items-center">
                  <div className="text-xs text-g-muted">Klar til posting</div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(d.draft_text);
                    }}
                    className="px-3 py-1.5 bg-blue-400/10 border border-blue-400/25 text-blue-400 text-xs font-medium rounded-lg hover:bg-blue-400/20 transition-all duration-200"
                  >
                    Kopier tekst
                  </button>
                  <button
                    onClick={() => updateStatus(d.id, 'posted')}
                    className="px-3 py-1.5 text-g-muted text-xs hover:text-g-text transition-colors"
                  >
                    Merk som postet
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
