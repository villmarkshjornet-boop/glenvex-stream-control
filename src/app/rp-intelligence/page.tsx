'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui';

interface RPNote {
  id: string;
  type: 'karakter' | 'relasjon' | 'konflikt' | 'hendelse';
  tittel: string;
  innhold: string;
  karakter?: string;
  dato: string;
  viktig: boolean;
}

const TYPE_FARGE: Record<string, string> = {
  karakter: 'text-blue-400 border-blue-400/30 bg-blue-400/10',
  relasjon: 'text-green-400 border-green-400/30 bg-green-400/10',
  konflikt: 'text-red-400 border-red-400/30 bg-red-400/10',
  hendelse: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
};

export default function RPIntelligencePage() {
  const [notes, setNotes] = useState<RPNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [visForm, setVisForm] = useState(false);
  const [form, setForm] = useState({ type: 'hendelse', tittel: '', innhold: '', karakter: '', viktig: false });
  const [søk, setSøk] = useState('');
  const [filter, setFilter] = useState<string>('alle');

  const hent = () => {
    setLoading(true);
    fetch('/api/rp-notes').then(r => r.json()).then(d => { setNotes(d); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { hent(); }, []);

  async function leggTil() {
    if (!form.tittel || !form.innhold) return;
    await fetch('/api/rp-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setForm({ type: 'hendelse', tittel: '', innhold: '', karakter: '', viktig: false });
    setVisForm(false);
    hent();
  }

  async function slett(id: string) {
    await fetch('/api/rp-notes', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    hent();
  }

  async function toggleViktig(note: RPNote) {
    await fetch('/api/rp-notes', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: note.id, viktig: !note.viktig }) });
    hent();
  }

  const viktige = notes.filter(n => n.viktig);
  const filtrerte = notes.filter(n =>
    (filter === 'alle' || n.type === filter) &&
    (n.tittel.toLowerCase().includes(søk.toLowerCase()) || n.innhold.toLowerCase().includes(søk.toLowerCase()))
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      <PageHeader title="RP Intelligence" subtitle="Future RP-notater, karakterer, relasjoner og hendelser" />

      {/* Viktige påminnelser */}
      {viktige.length > 0 && (
        <div className="bg-g-card border border-yellow-400/20 rounded-2xl p-5">
          <p className="text-xs font-semibold tracking-widest uppercase text-yellow-400 mb-3">Husk før stream</p>
          <div className="space-y-2">
            {viktige.map(n => (
              <div key={n.id} className="flex items-start gap-2">
                <span className="text-yellow-400 text-xs mt-0.5">◆</span>
                <div>
                  <p className="text-sm font-semibold text-g-text">{n.tittel}</p>
                  <p className="text-sm text-g-text leading-relaxed">{n.innhold}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Kontroller */}
      <div className="flex items-center gap-2 flex-wrap">
        <input value={søk} onChange={e => setSøk(e.target.value)} placeholder="Søk i notater..."
          className="bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200 flex-1 min-w-32" />
        {['alle', 'karakter', 'relasjon', 'konflikt', 'hendelse'].map(t => (
          <button key={t} onClick={() => setFilter(t)}
            className={`px-3 py-2 text-xs font-semibold tracking-wider uppercase rounded-lg border transition-all duration-200 ${filter === t ? 'bg-g-green/10 border-g-green/25 text-g-green' : 'border-g-border text-g-muted hover:text-g-text'}`}>
            {t}
          </button>
        ))}
        <button onClick={() => setVisForm(!visForm)}
          className="px-4 py-2 bg-g-green/10 border border-g-green/25 text-g-green text-sm font-medium rounded-lg hover:bg-g-green/20 hover:shadow-green-sm transition-all duration-200 ml-auto">
          + Ny note
        </button>
      </div>

      {/* Form */}
      {visForm && (
        <div className="bg-g-card border border-g-green/20 rounded-2xl p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-g-muted uppercase tracking-widest block mb-1">Type</label>
              <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}
                className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200">
                {['karakter', 'relasjon', 'konflikt', 'hendelse'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-g-muted uppercase tracking-widest block mb-1">Karakter (valgfritt)</label>
              <input value={form.karakter} onChange={e => setForm(p => ({ ...p, karakter: e.target.value }))}
                placeholder="Mats Haugland"
                className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200" />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-g-muted uppercase tracking-widest block mb-1">Tittel</label>
            <input value={form.tittel} onChange={e => setForm(p => ({ ...p, tittel: e.target.value }))}
              placeholder="Kort beskrivelse"
              className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200" />
          </div>
          <div>
            <label className="text-[11px] text-g-muted uppercase tracking-widest block mb-1">Innhold</label>
            <textarea value={form.innhold} onChange={e => setForm(p => ({ ...p, innhold: e.target.value }))} rows={3}
              className="w-full bg-g-bg border border-g-border rounded-lg px-3 py-2.5 text-sm text-g-text placeholder:text-g-muted/40 focus:outline-none focus:border-g-green/40 focus:ring-1 focus:ring-g-green/20 transition-all duration-200 resize-none" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.viktig} onChange={e => setForm(p => ({ ...p, viktig: e.target.checked }))} className="accent-yellow-400" />
            <span className="text-sm text-g-text">Marker som viktig (vises før stream)</span>
          </label>
          <button onClick={leggTil} className="w-full py-2 bg-g-green/10 border border-g-green/25 text-g-green text-sm font-medium rounded-lg hover:bg-g-green/20 hover:shadow-green-sm transition-all duration-200">
            ◆ Lagre note
          </button>
        </div>
      )}

      {/* Notat-liste */}
      <div className="space-y-2">
        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-g-border/40 rounded w-3/4" />
            <div className="h-4 bg-g-border/40 rounded w-1/2" />
            <div className="h-4 bg-g-border/40 rounded w-2/3" />
          </div>
        ) : filtrerte.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-g-muted">Ingen notater. Trykk &quot;+ Ny note&quot; for å starte.</p>
          </div>
        ) : filtrerte.map(n => (
          <div key={n.id} className="bg-g-card border border-g-border rounded-xl p-4 hover:bg-g-card-hover transition-all duration-200 space-y-2">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${TYPE_FARGE[n.type]}`}>{n.type}</span>
                {n.karakter && <span className="text-[11px] text-g-muted">— {n.karakter}</span>}
                {n.viktig && <span className="text-yellow-400 text-xs">⚠</span>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => toggleViktig(n)} className="text-[11px] text-g-muted hover:text-yellow-400 transition-colors">
                  {n.viktig ? 'Fjern viktig' : 'Merk viktig'}
                </button>
                <button onClick={() => slett(n.id)} className="text-[11px] text-g-muted hover:text-red-400 transition-colors">Slett</button>
              </div>
            </div>
            <p className="text-sm font-semibold text-g-text">{n.tittel}</p>
            <p className="text-sm text-g-text leading-relaxed">{n.innhold}</p>
            <p className="text-[11px] text-g-muted">{new Date(n.dato).toLocaleDateString('no-NO')}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
