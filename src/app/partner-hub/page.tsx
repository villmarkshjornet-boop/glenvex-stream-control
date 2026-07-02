'use client';

import { useEffect, useState } from 'react';
import { tidSiden } from '@/components/dashboard/helpers';
import { PageHeader, ConfirmDialog } from '@/components/ui';

interface PartnerStats {
  contentLog: {
    total: number;
    discord: number;
    twitch: number;
    recent7d: number;
    recent30d: number;
    lastPosted: string | null;
    channels: string[];
  };
  proposals: {
    total: number;
    sent: number;
    approved: number;
    rejected: number;
    pending: number;
    approvalRate: number | null;
  };
  lastDecision: {
    id: string;
    score: number | null;
    reasonCode: string | null;
    triggerType: string | null;
    outcome: string | null;
    createdAt: string;
  } | null;
  dataStrength: 'god' | 'moderat' | 'svak';
  recommendation: string;
}

interface Partner {
  id: string;
  navn: string;
  logo?: string;
  nettadresse: string;
  affiliateLink: string;
  rabattkode: string;
  beskrivelse: string;
  kategori: string;
  provisjonstype: string;
  provisjon: number;
  avtaleStart: string;
  avtaleSlutt?: string;
  aktiv: boolean;
  featured: boolean;
  ownedBrand: boolean;
  prioritet: number;
  eksponering: number;
  klikk: number;
  estimertInntekt: number;
  sistePromotert?: string;
  kampanjer: any[];
}

interface GenerertInnhold {
  tekst: string;
  overskrift: string;
  cta: string;
  bildeUrl?: string;
}

const KATEGORI_FARGE: Record<string, string> = {
  gaming: 'text-g-green border-g-green/30 bg-g-green/10',
  hardware: 'text-blue-400 border-blue-400/30 bg-blue-400/10',
  energidrikk: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
  bil: 'text-orange-400 border-orange-400/30 bg-orange-400/10',
  jakt: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10',
  ownedBrand: 'text-purple-400 border-purple-400/30 bg-purple-400/10',
  annet: 'text-g-muted border-g-border bg-g-bg',
};

const TOM_PARTNER: Partial<Partner> = {
  navn: '', nettadresse: '', affiliateLink: '', rabattkode: '', beskrivelse: '',
  kategori: 'gaming', provisjonstype: 'prosent', provisjon: 10,
  aktiv: true, featured: false, ownedBrand: false, prioritet: 5,
};


export default function PartnerHubPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<Record<string, PartnerStats>>({});
  const [visForm, setVisForm] = useState(false);
  const [form, setForm] = useState<Partial<Partner>>(TOM_PARTNER);
  const [redigerId, setRedigerId] = useState<string | null>(null);
  const [valgt, setValgt] = useState<Partner | null>(null);
  const [genType, setGenType] = useState<string>('discord');
  const [genererBilde, setGenererBilde] = useState(false);
  const [generert, setGenerert] = useState<GenerertInnhold | null>(null);
  const [genererer, setGenererer] = useState(false);
  const [promoterer, setPromoterer] = useState(false);
  const [promotertMsg, setPromotertMsg] = useState('');
  const [kopiert, setKopiert] = useState(false);
  const [confirmState, setConfirmState] = useState<import('@/components/ui').ConfirmState | null>(null);
  const [lagreFeil, setLagreFeil] = useState('');

  const hent = () => {
    setLoading(true);
    fetch('/api/partners').then(r => r.json()).then(d => { setPartners(d); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { hent(); }, []);

  useEffect(() => {
    fetch('/api/partner-hub/analytics')
      .then(r => r.json())
      .then(d => setAnalytics(d.byPartner ?? {}))
      .catch(() => {});
  }, []);

  async function lagre() {
    setLagreFeil('');
    const method = redigerId ? 'PATCH' : 'POST';
    const body = redigerId ? { ...form, id: redigerId } : form;
    try {
      const res = await fetch('/api/partners', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setLagreFeil(`Feil: ${data.error ?? res.status}`);
        return;
      }
      setVisForm(false);
      setRedigerId(null);
      setForm(TOM_PARTNER);
      hent();
    } catch (e) {
      setLagreFeil(`Nettverksfeil: ${(e as Error).message}`);
    }
  }

  async function slett(id: string) {
    setConfirmState({
      title: 'Slett partner',
      message: 'Partneren og all tilknyttet data slettes permanent.',
      danger: true,
      confirmLabel: 'Slett partner',
      onConfirm: async () => {
        await fetch('/api/partners', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
        setValgt(null);
        hent();
      },
    });
  }

  async function settFeatured(id: string) {
    await fetch('/api/partners', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, featured: true }) });
    hent();
  }

  async function genererInnhold() {
    if (!valgt) return;
    setGenererer(true);
    setGenerert(null);
    const res = await fetch('/api/partners/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner: valgt, type: genType, genererBilde }),
    });
    const data = await res.json();
    setGenerert(data);
    setGenererer(false);
  }

  async function postTilDiscord(partnerId?: string) {
    setPromoterer(true);
    const res = await fetch('/api/partners/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partnerId ? { manuellPartnerId: partnerId } : {}),
    });
    const data = await res.json();
    setPromotertMsg(data.ok ? `✓ Postet ${data.partner} til Discord!` : `✗ ${data.error ?? 'Feil'}`);
    setPromoterer(false);
    hent();
  }

  const featured = partners.find(p => p.featured);
  const aktive = partners.filter(p => p.aktiv);
  const totalEksponering = partners.reduce((s, p) => s + p.eksponering, 0);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
      <PageHeader title="Partner Hub" subtitle="Affiliate-avtaler, sponsorer og egne merker">
          <button onClick={() => postTilDiscord()} disabled={promoterer}
            className="px-3 py-2 bg-g-bg border border-g-border hover:border-g-green/30 text-g-muted hover:text-g-green text-xs font-bold rounded-lg transition-all">
            {promoterer ? 'Poster...' : '▶ Auto-promoter'}
          </button>
          <button onClick={() => { setVisForm(true); setRedigerId(null); setForm(TOM_PARTNER); }}
            className="px-3 py-2 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold rounded-lg transition-all">
            + Ny partner
          </button>
      </PageHeader>

      {promotertMsg && (
        <p className={`text-xs font-mono ${promotertMsg.startsWith('✓') ? 'text-g-green' : 'text-red-400'}`}>{promotertMsg}</p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Totalt partnere', value: partners.length },
          { label: 'Aktive', value: aktive.length },
          { label: 'Eksponeringer', value: totalEksponering },
          { label: 'Featured', value: featured?.navn ?? '–' },
        ].map(s => (
          <div key={s.label} className="bg-g-card border border-g-border rounded-2xl p-4 text-center">
            <p className="text-[11px] text-g-muted uppercase tracking-widest">{s.label}</p>
            <p className="text-sm font-black text-g-green font-mono mt-1 truncate">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Featured banner */}
      {featured && (
        <div className="bg-g-card border border-yellow-400/20 rounded-2xl p-6 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-yellow-400/5 to-transparent pointer-events-none" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-yellow-400/10 border border-yellow-400/30 rounded-xl flex items-center justify-center flex-shrink-0">
                <span className="text-yellow-400 text-xl font-black">★</span>
              </div>
              <div>
                <p className="text-[11px] text-yellow-400 uppercase tracking-widest font-bold">Featured Partner</p>
                <p className="text-lg font-black text-g-text mt-0.5">{featured.navn}</p>
                <p className="text-xs text-g-muted mt-0.5">{featured.beskrivelse}</p>
                {featured.rabattkode && (
                  <p className="text-xs text-yellow-400 font-mono font-bold mt-1">Kode: {featured.rabattkode}</p>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 items-end">
              <a href={featured.affiliateLink} target="_blank" rel="noopener noreferrer"
                className="px-4 py-2 bg-yellow-400/10 border border-yellow-400/30 text-yellow-400 text-xs font-bold rounded hover:bg-yellow-400/20 transition-all">
                Besøk ↗
              </a>
              <button onClick={() => postTilDiscord(featured.id)}
                className="px-4 py-2 bg-g-bg border border-g-border text-g-muted text-xs font-bold rounded hover:border-g-green/30 hover:text-g-green transition-all">
                Post til Discord
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Partner-liste */}
        <div className="lg:col-span-2 space-y-3">
          <p className="text-xs text-g-muted font-bold tracking-widest uppercase">Alle partnere</p>
          {loading ? <p className="text-xs text-g-muted">Laster...</p> :
           partners.length === 0 ? (
            <div className="bg-g-card border border-g-border rounded-xl p-8 text-center">
              <p className="text-xs text-g-muted">Ingen partnere ennå. Trykk "+ Ny partner" for å starte.</p>
            </div>
          ) : partners.map(p => (
            <div key={p.id}
              onClick={() => setValgt(valgt?.id === p.id ? null : p)}
              className={`bg-g-card border rounded-2xl p-5 cursor-pointer transition-all hover:border-g-green/20 ${valgt?.id === p.id ? 'border-g-green/30 bg-g-green/5' : 'border-g-border'} ${!p.aktiv ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 ${KATEGORI_FARGE[p.kategori]}`}>
                    <span className="text-xs font-black">{p.navn[0]}</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-g-text">{p.navn}</p>
                      {p.featured && <span className="text-[11px] text-yellow-400 font-bold">★ FEATURED</span>}
                      {p.ownedBrand && <span className="text-[11px] text-purple-400 font-bold">OWNED</span>}
                      {!p.aktiv && <span className="text-[11px] text-g-muted font-bold">INAKTIV</span>}
                    </div>
                    <p className="text-xs text-g-muted">{p.kategori} • {p.eksponering} eksponeringer</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <span className={`text-[11px] px-1.5 py-0.5 rounded border font-bold uppercase ${KATEGORI_FARGE[p.kategori]}`}>{p.kategori}</span>
                </div>
              </div>
              <p className="text-xs text-g-muted truncate">{p.beskrivelse}</p>
              {p.rabattkode && <p className="text-xs text-g-green font-mono mt-1">Kode: {p.rabattkode}</p>}
            </div>
          ))}
        </div>

        {/* Sidepanel: valgt partner / AI Studio */}
        <div className="space-y-4">
          {valgt ? (
            <>
              {/* Partner-detaljer */}
              <div className="bg-g-card border border-g-border rounded-2xl p-5 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-black text-g-text">{valgt.navn}</p>
                    {(() => {
                      const stats = analytics[valgt.navn];
                      if (!stats) return null;
                      const c = { god: 'text-g-green border-g-green/30 bg-g-green/10', moderat: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10', svak: 'text-g-muted/50 border-g-border/30' }[stats.dataStrength];
                      return <span className={`mt-0.5 inline-block px-1.5 py-0.5 border rounded text-[11px] font-bold ${c}`}>{stats.dataStrength} datagrunnlag</span>;
                    })()}
                  </div>
                  <button onClick={() => setValgt(null)} className="text-g-muted text-xs hover:text-g-text">✕</button>
                </div>

                {/* Avtale-info */}
                <div className="space-y-1">
                  {[
                    ['Kode', valgt.rabattkode || '–'],
                    ['Provisjon', `${valgt.provisjon}${valgt.provisjonstype === 'prosent' ? '%' : ' kr'}`],
                  ].map(([l, v]) => (
                    <div key={l as string} className="flex justify-between text-xs">
                      <span className="text-g-muted">{l}</span>
                      <span className="text-g-text font-mono">{v}</span>
                    </div>
                  ))}
                </div>

                {/* Historikk fra ekte data */}
                {(() => {
                  const stats = analytics[valgt.navn];
                  if (!stats) return (
                    <p className="text-xs text-g-muted/40 italic">Henter historikk...</p>
                  );
                  const { contentLog: cl, proposals: pr, lastDecision: ld } = stats;
                  const hasData = cl.total > 0 || pr.total > 0;
                  if (!hasData) return (
                    <p className="text-xs text-g-muted/40 italic">Ingen historikk funnet ennå</p>
                  );
                  return (
                    <div className="space-y-2 border-t border-g-border/30 pt-2">
                      <p className="text-[11px] text-g-muted uppercase tracking-wider font-bold">Promo-historikk</p>
                      <div className="grid grid-cols-3 gap-1.5 text-center">
                        {[
                          { l: '7d', v: cl.recent7d },
                          { l: '30d', v: cl.recent30d },
                          { l: 'Totalt', v: cl.total },
                        ].map(s => (
                          <div key={s.l} className="bg-g-card border border-g-border/40 rounded p-2">
                            <p className="text-[11px] text-g-muted">{s.l}</p>
                            <p className="text-sm font-black text-g-green font-mono">{s.v}</p>
                          </div>
                        ))}
                      </div>
                      {(cl.discord > 0 || cl.twitch > 0) && (
                        <div className="flex gap-2 text-xs text-g-muted">
                          {cl.discord > 0 && <span>Discord: {cl.discord}</span>}
                          {cl.twitch > 0  && <span>Twitch: {cl.twitch}</span>}
                          {cl.channels.length > 0 && <span className="text-g-muted/50">· {cl.channels.slice(0, 2).join(', ')}</span>}
                        </div>
                      )}
                      {cl.lastPosted && (
                        <p className="text-xs text-g-muted">Sist sendt: <span className="text-g-text">{tidSiden(cl.lastPosted)} siden</span></p>
                      )}

                      {pr.total > 0 && (
                        <>
                          <p className="text-[11px] text-g-muted uppercase tracking-wider font-bold pt-1">Forslag (AI)</p>
                          <div className="flex gap-3 text-xs">
                            <span className="text-g-green">{pr.approved + pr.sent} godkjent</span>
                            {pr.rejected > 0 && <span className="text-red-400/70">{pr.rejected} avvist</span>}
                            {pr.pending > 0 && <span className="text-yellow-400">{pr.pending} venter</span>}
                            {pr.approvalRate !== null && (
                              <span className="text-g-muted/60 ml-auto">{Math.round(pr.approvalRate * 100)}% rate</span>
                            )}
                          </div>
                        </>
                      )}

                      {ld && (
                        <>
                          <p className="text-[11px] text-g-muted uppercase tracking-wider font-bold pt-1">Siste AI-vurdering</p>
                          <div className="flex gap-2 text-xs flex-wrap">
                            {ld.score !== null && (
                              <span className={`font-bold ${ld.score >= 0.7 ? 'text-g-green' : ld.score >= 0.4 ? 'text-yellow-400' : 'text-red-400/70'}`}>
                                Score: {Math.round(ld.score * 100)}%
                              </span>
                            )}
                            {ld.reasonCode && <span className="text-g-muted/60 font-mono">{ld.reasonCode}</span>}
                            {ld.triggerType && <span className="text-g-muted/50">{ld.triggerType}</span>}
                            <span className={`ml-auto font-bold ${ld.outcome === 'success' ? 'text-g-green' : ld.outcome === 'rejected' ? 'text-red-400' : 'text-g-muted/50'}`}>
                              {ld.outcome ?? 'pending'}
                            </span>
                          </div>
                        </>
                      )}

                      <div className="pt-1 border-t border-g-border/20">
                        <p className="text-[11px] text-g-muted uppercase tracking-wider font-bold mb-0.5">Anbefaling</p>
                        <p className="text-xs text-g-text leading-relaxed">{stats.recommendation}</p>
                      </div>
                    </div>
                  );
                })()}

                <div className="grid grid-cols-2 gap-1.5">
                  <button onClick={() => { setRedigerId(valgt.id); setForm(valgt); setVisForm(true); }}
                    className="py-1.5 border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                    Rediger
                  </button>
                  <button onClick={() => settFeatured(valgt.id)} disabled={valgt.featured}
                    className="py-1.5 border border-yellow-400/30 rounded text-xs text-yellow-400 hover:bg-yellow-400/10 transition-all disabled:opacity-40">
                    {valgt.featured ? '★ Featured' : 'Sett featured'}
                  </button>
                  <button onClick={() => postTilDiscord(valgt.id)} disabled={promoterer}
                    className="py-1.5 border border-g-green/20 rounded text-xs text-g-green hover:bg-g-green/10 transition-all col-span-2">
                    Post til Discord
                  </button>
                  <button onClick={() => slett(valgt.id)}
                    className="py-1.5 border border-red-500/20 rounded text-xs text-red-400 hover:bg-red-500/10 transition-all col-span-2">
                    Slett
                  </button>
                </div>
              </div>

              {/* AI Content Studio */}
              <div className="bg-g-card border border-g-border rounded-2xl p-5 space-y-3">
                <p className="text-xs text-g-green uppercase tracking-widest font-bold">◆ AI Content Studio</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {['discord', 'twitch', 'instagram', 'twitter', 'facebook', 'giveaway'].map(t => (
                    <button key={t} onClick={() => setGenType(t)}
                      className={`py-1.5 text-xs font-bold uppercase rounded border transition-all ${genType === t ? 'bg-g-green/10 border-g-green/30 text-g-green' : 'border-g-border text-g-muted hover:text-g-text'}`}>
                      {t}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={genererBilde} onChange={e => setGenererBilde(e.target.checked)} className="accent-green-400" />
                  <span className="text-xs text-g-text">Generer bilde (DALL-E)</span>
                </label>
                <button onClick={genererInnhold} disabled={genererer}
                  className="w-full py-2 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold rounded transition-all">
                  {genererer ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-3 h-3 border border-g-green/30 border-t-g-green rounded-full animate-spin" />
                      Genererer...
                    </span>
                  ) : '◆ Generer innhold'}
                </button>

                {generert && (
                  <div className="space-y-2 border-t border-g-border pt-3">
                    {generert.bildeUrl && (
                      <img src={generert.bildeUrl} alt="Partner-bilde" className="w-full rounded-lg border border-g-border" />
                    )}
                    {generert.overskrift && <p className="text-xs font-bold text-g-text">{generert.overskrift}</p>}
                    <p className="text-xs text-g-muted font-mono whitespace-pre-wrap leading-relaxed">{generert.tekst}</p>
                    {generert.cta && <p className="text-xs text-g-green font-bold">{generert.cta}</p>}
                    <button onClick={async () => {
                      await navigator.clipboard.writeText(`${generert.overskrift ?? ''}\n\n${generert.tekst}\n\n${generert.cta ?? ''}`);
                      setKopiert(true);
                      setTimeout(() => setKopiert(false), 2000);
                    }} className="w-full py-1.5 border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                      {kopiert ? '✓ Kopiert!' : 'Kopier tekst'}
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="bg-g-card border border-g-border rounded-2xl p-6 text-center">
              <p className="text-xs text-g-muted">Velg en partner for å se detaljer og generere innhold</p>
            </div>
          )}
        </div>
      </div>

      {/* Skjema */}
      {visForm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-g-card border border-g-border rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-black text-g-text">{redigerId ? 'Rediger partner' : 'Ny partner'}</h2>
              <button onClick={() => { setVisForm(false); setRedigerId(null); setForm(TOM_PARTNER); }} className="text-g-muted hover:text-g-text text-sm">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { felt: 'navn', label: 'Navn', ph: 'Komplett.no' },
                { felt: 'rabattkode', label: 'Rabattkode', ph: 'PARTNER10' },
                { felt: 'nettadresse', label: 'Nettadresse', ph: 'https://komplett.no' },
                { felt: 'affiliateLink', label: 'Affiliate-link', ph: 'https://...' },
              ].map(({ felt, label, ph }) => (
                <div key={felt}>
                  <label className="text-[11px] text-g-muted uppercase tracking-widest block mb-1">{label}</label>
                  <input value={(form as any)[felt] ?? ''} onChange={e => setForm(p => ({ ...p, [felt]: e.target.value }))}
                    placeholder={ph} className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text outline-none focus:border-g-green/50" />
                </div>
              ))}
            </div>

            <div>
              <label className="text-[11px] text-g-muted uppercase tracking-widest block mb-1">Beskrivelse</label>
              <textarea value={form.beskrivelse ?? ''} onChange={e => setForm(p => ({ ...p, beskrivelse: e.target.value }))} rows={2}
                className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text outline-none focus:border-g-green/50 resize-none" />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] text-g-muted uppercase tracking-widest block mb-1">Kategori</label>
                <select value={form.kategori ?? 'gaming'} onChange={e => setForm(p => ({ ...p, kategori: e.target.value as any }))}
                  className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text outline-none">
                  {['gaming', 'hardware', 'energidrikk', 'bil', 'jakt', 'ownedBrand', 'annet'].map(k => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-g-muted uppercase tracking-widest block mb-1">Provisjon %</label>
                <input type="number" value={form.provisjon ?? 10} onChange={e => setForm(p => ({ ...p, provisjon: +e.target.value }))}
                  className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text outline-none" />
              </div>
              <div>
                <label className="text-[11px] text-g-muted uppercase tracking-widest block mb-1">Prioritet (1-10)</label>
                <input type="number" min="1" max="10" value={form.prioritet ?? 5} onChange={e => setForm(p => ({ ...p, prioritet: +e.target.value }))}
                  className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text outline-none" />
              </div>
            </div>

            <div className="flex gap-4">
              {[
                { felt: 'aktiv', label: 'Aktiv' },
                { felt: 'featured', label: 'Featured' },
                { felt: 'ownedBrand', label: 'Eget merke' },
              ].map(({ felt, label }) => (
                <label key={felt} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={(form as any)[felt] ?? false}
                    onChange={e => setForm(p => ({ ...p, [felt]: e.target.checked }))} className="accent-green-400" />
                  <span className="text-xs text-g-text">{label}</span>
                </label>
              ))}
            </div>

            <button onClick={lagre} className="w-full py-2.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold rounded transition-all">
              ◆ {redigerId ? 'Oppdater' : 'Legg til partner'}
            </button>
            {lagreFeil && (
              <p className="text-xs text-red-400 font-mono p-2 bg-red-500/10 border border-red-500/20 rounded">{lagreFeil}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
