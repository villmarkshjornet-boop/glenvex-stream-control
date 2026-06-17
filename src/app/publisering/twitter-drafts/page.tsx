'use client';

import { useEffect, useState, useCallback } from 'react';

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

const STATUS_COLOR: Record<string, string> = {
  draft: 'text-g-muted border-g-border',
  approved: 'text-g-green border-g-green/50',
  posted: 'text-blue-400 border-blue-400/50',
  rejected: 'text-red-400 border-red-400/50',
  archived: 'text-g-muted/50 border-g-border/50',
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
    <main className="min-h-screen bg-g-bg p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-g-text tracking-wide">Twitter / X Utkast</h1>
        <p className="text-g-muted text-sm mt-1">AI-genererte partner-innlegg. Godkjenn, rediger og post manuelt.</p>
      </div>

      {/* ── Generate new draft ── */}
      <section className="mb-8 p-5 bg-g-surface border border-g-border rounded-lg">
        <h2 className="text-sm font-semibold text-g-muted uppercase tracking-wider mb-4">Generer nytt utkast</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-g-muted mb-1">Partner</label>
            <select
              value={selectedPartner}
              onChange={e => setSelectedPartner(e.target.value)}
              className="w-full px-3 py-2 bg-g-bg border border-g-border rounded text-sm text-g-text focus:outline-none focus:border-g-green"
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
                className="w-full px-3 py-2 bg-g-bg border border-g-border rounded text-sm text-g-text resize-none focus:outline-none focus:border-g-green"
                placeholder="Skriv din egen tekst…"
              />
              <div className="text-xs text-g-muted text-right">{charCount(manualText)}/280</div>
            </div>
          ) : (
            <div>
              <label className="block text-xs text-g-muted mb-1">Ekstra kontekst til AI (valgfritt)</label>
              <input
                type="text"
                value={promptHint}
                onChange={e => setPromptHint(e.target.value)}
                placeholder="f.eks. «fokuser på rabattkoden» eller «gaming-vinkel»"
                className="w-full px-3 py-2 bg-g-bg border border-g-border rounded text-sm text-g-text focus:outline-none focus:border-g-green"
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={generate}
              disabled={generating || !selectedPartner}
              className="px-5 py-2 bg-g-green text-black font-bold text-sm rounded hover:bg-g-green/80 disabled:opacity-50 transition-colors"
            >
              {generating ? 'Genererer…' : 'Generer utkast'}
            </button>
            {genError && <span className="text-red-400 text-xs">{genError}</span>}
          </div>
        </div>
      </section>

      {/* ── Filter tabs ── */}
      <div className="flex gap-2 mb-5">
        {(['draft', 'approved', 'posted', 'archived'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded text-xs font-semibold border transition-colors ${filter === s ? 'bg-g-green text-black border-g-green' : 'text-g-muted border-g-border hover:text-g-text'}`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {/* ── Draft list ── */}
      {loading ? (
        <div className="text-g-muted text-sm animate-pulse">Laster utkast…</div>
      ) : drafts.length === 0 ? (
        <div className="p-5 bg-g-surface border border-g-border rounded-lg text-center text-g-muted text-sm">
          Ingen {STATUS_LABEL[filter]?.toLowerCase()} utkast.
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map(d => (
            <div key={d.id} className={`p-4 bg-g-surface border rounded-lg ${filter === 'archived' ? 'opacity-50' : ''}`} style={{ borderColor: 'var(--g-border)' }}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <span className="font-semibold text-g-text">{d.partner_name}</span>
                  <span className={`ml-2 text-xs border px-1.5 py-0.5 rounded ${STATUS_COLOR[d.status]}`}>
                    {STATUS_LABEL[d.status]}
                  </span>
                  {d.ai_model && <span className="ml-2 text-xs text-g-muted">AI: {d.ai_model}</span>}
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
                    className="w-full px-2 py-1.5 bg-g-bg border border-g-green rounded text-sm text-g-text resize-none focus:outline-none"
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
                    className="px-3 py-1 bg-g-green/20 text-g-green text-xs font-semibold rounded border border-g-green/40 hover:bg-g-green/30"
                  >
                    Godkjenn
                  </button>
                  <button
                    onClick={() => { setEditingId(d.id); setEditText(d.draft_text); }}
                    className="px-3 py-1 bg-g-border/30 text-g-muted text-xs font-semibold rounded border border-g-border hover:text-g-text"
                  >
                    Rediger
                  </button>
                  <button
                    onClick={() => deleteDraft(d.id)}
                    className="px-3 py-1 text-xs text-g-muted hover:text-red-400 transition-colors"
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
                    className="px-3 py-1 bg-blue-500/20 text-blue-400 text-xs font-semibold rounded border border-blue-400/40 hover:bg-blue-500/30"
                  >
                    Kopier tekst
                  </button>
                  <button
                    onClick={() => updateStatus(d.id, 'posted')}
                    className="px-3 py-1 bg-g-border/30 text-g-muted text-xs font-semibold rounded border border-g-border hover:text-g-text"
                  >
                    Merk som postet
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
