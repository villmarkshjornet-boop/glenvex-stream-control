'use client';

import { useEffect, useState } from 'react';

interface ContentItem {
  id: string;
  tittel: string;
  type: string;
  status: string;
  tekst: string;
  bildeUrl?: string;
  kanalId?: string;
  kanalNavn?: string;
  modul: string;
  opprettet: string;
  publisert?: string;
  discordMsgId?: string;
  feilmelding?: string;
}

const STATUS_STIL: Record<string, string> = {
  draft: 'text-g-muted border-g-border bg-g-bg',
  klar: 'text-blue-400 border-blue-400/30 bg-blue-400/10',
  godkjent: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
  publisert: 'text-g-green border-g-green/30 bg-g-green/10',
  feilet: 'text-red-400 border-red-400/30 bg-red-400/10',
  arkivert: 'text-g-muted border-g-border bg-g-bg opacity-50',
};

const TYPE_IKON: Record<string, string> = {
  'live-varsel': '🔴', 'rp-karakter': '🎭', 'promo': '📣', 'partner-post': '🤝',
  'giveaway': '🎁', 'poll': '📊', 'clip-post': '🎬', 'streamplan': '📅',
  'discord-melding': '💬', 'twitch-melding': '🟣', 'event': '⭐', 'velkomst': '👋',
  'kanal-oppsett': '⚙', 'annet': '◆',
};

export default function DiscordLibraryPage() {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [valgt, setValgt] = useState<ContentItem | null>(null);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [redigerTekst, setRedigerTekst] = useState('');
  const [publisererKanal, setPublisererKanal] = useState('');
  const [visSlettDialog, setVisSlettDialog] = useState(false);
  const [msg, setMsg] = useState('');

  const hent = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterType) params.set('type', filterType);
    if (filterStatus) params.set('status', filterStatus);
    fetch(`/api/content-library?${params}`).then(r => r.json()).then(d => { setItems(d); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { hent(); }, [filterType, filterStatus]);

  async function publiser() {
    if (!valgt) return;
    if (redigerTekst !== valgt.tekst) {
      await fetch('/api/content-library', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: valgt.id, tekst: redigerTekst }) });
    }
    const res = await fetch('/api/content-library/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: valgt.id, kanalId: publisererKanal || undefined }),
    });
    const data = await res.json();
    setMsg(data.ok ? '✓ Publisert til Discord!' : `✗ ${data.error}`);
    hent();
  }

  async function slett(slettDiscord: boolean) {
    if (!valgt) return;
    await fetch('/api/content-library/publish', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: valgt.id, slettDiscord }),
    });
    setValgt(null);
    setVisSlettDialog(false);
    hent();
  }

  async function oppdaterStatus(status: string) {
    if (!valgt) return;
    await fetch('/api/content-library', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: valgt.id, status }) });
    hent();
  }

  const TYPER = ['live-varsel', 'rp-karakter', 'promo', 'partner-post', 'giveaway', 'poll', 'clip-post', 'event', 'discord-melding'];
  const STATUSER = ['draft', 'klar', 'godkjent', 'publisert', 'feilet', 'arkivert'];

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-black tracking-wider text-g-text uppercase">Discord Library</h1>
        <p className="text-xs text-g-muted mt-0.5">Alt boten har laget, forberedt og publisert</p>
      </div>

      {/* Filtre */}
      <div className="flex gap-2 flex-wrap">
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50">
          <option value="">Alle typer</option>
          {TYPER.map(t => <option key={t} value={t}>{TYPE_IKON[t]} {t}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50">
          <option value="">Alle statuser</option>
          {STATUSER.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => { setFilterType(''); setFilterStatus(''); }}
          className="px-3 py-1.5 border border-g-border rounded text-xs text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
          Nullstill
        </button>
        <div className="ml-auto">
          <button onClick={() => {
            const ny = { tittel: 'Ny draft', type: 'discord-melding', tekst: '', status: 'draft', modul: 'manuell' };
            fetch('/api/content-library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ny) }).then(() => hent());
          }} className="px-3 py-1.5 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold rounded transition-all">
            + Ny draft
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Liste */}
        <div className="lg:col-span-2 space-y-2">
          {loading ? <p className="text-xs text-g-muted p-4">Laster...</p> :
           items.length === 0 ? (
            <div className="bg-g-card border border-g-border rounded-xl p-8 text-center">
              <p className="text-xs text-g-muted">Ingen innhold ennå. Innhold lagres automatisk når boten genererer noe.</p>
            </div>
          ) : items.map(item => (
            <div key={item.id}
              onClick={() => { setValgt(valgt?.id === item.id ? null : item); setRedigerTekst(item.tekst); setMsg(''); }}
              className={`bg-g-card border rounded-xl p-4 cursor-pointer transition-all hover:border-g-green/20 ${valgt?.id === item.id ? 'border-g-green/30 bg-g-green/5' : 'border-g-border'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base flex-shrink-0">{TYPE_IKON[item.type] ?? '◆'}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-g-text truncate">{item.tittel}</p>
                    <p className="text-[9px] text-g-muted">{item.modul} • {new Date(item.opprettet).toLocaleDateString('no-NO')}</p>
                  </div>
                </div>
                <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider flex-shrink-0 ${STATUS_STIL[item.status] ?? STATUS_STIL.draft}`}>
                  {item.status}
                </span>
              </div>
              {item.tekst && (
                <p className="text-[10px] text-g-muted mt-2 line-clamp-2 leading-relaxed">{item.tekst}</p>
              )}
            </div>
          ))}
        </div>

        {/* Sidepanel */}
        <div>
          {valgt ? (
            <div className="bg-g-card border border-g-border rounded-xl p-5 space-y-4 sticky top-4">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-base">{TYPE_IKON[valgt.type] ?? '◆'}</span>
                  <p className="text-xs font-black text-g-text mt-1">{valgt.tittel}</p>
                </div>
                <button onClick={() => setValgt(null)} className="text-g-muted hover:text-g-text text-xs">✕</button>
              </div>

              {/* Status-knapper */}
              <div className="flex gap-1.5 flex-wrap">
                {['draft', 'klar', 'godkjent', 'arkivert'].map(s => (
                  <button key={s} onClick={() => oppdaterStatus(s)}
                    className={`px-2 py-1 text-[9px] font-bold uppercase rounded border transition-all ${
                      valgt.status === s ? STATUS_STIL[s] : 'border-g-border text-g-muted hover:text-g-text'
                    }`}>{s}</button>
                ))}
              </div>

              {/* Rediger tekst */}
              <div>
                <p className="text-[9px] text-g-muted uppercase tracking-widest mb-1">Tekst</p>
                <textarea value={redigerTekst} onChange={e => setRedigerTekst(e.target.value)} rows={6}
                  className="w-full bg-g-bg border border-g-border rounded px-3 py-2 text-xs text-g-text font-mono resize-none outline-none focus:border-g-green/50 leading-relaxed" />
              </div>

              {valgt.bildeUrl && (
                <img src={valgt.bildeUrl} alt="Innhold" className="w-full rounded border border-g-border" />
              )}

              {/* Kanal-ID for publisering */}
              <div>
                <p className="text-[9px] text-g-muted uppercase tracking-widest mb-1">Kanal-ID (valgfritt)</p>
                <input value={publisererKanal} onChange={e => setPublisererKanal(e.target.value)}
                  placeholder="Standard chat-kanal brukes"
                  className="w-full bg-g-bg border border-g-border rounded px-3 py-1.5 text-xs text-g-text outline-none focus:border-g-green/50" />
              </div>

              {valgt.discordMsgId && (
                <p className="text-[9px] text-g-green">✓ Publisert – Discord msg: {valgt.discordMsgId}</p>
              )}
              {valgt.feilmelding && (
                <p className="text-[9px] text-red-400">✗ {valgt.feilmelding}</p>
              )}
              {msg && <p className={`text-xs font-mono ${msg.startsWith('✓') ? 'text-g-green' : 'text-red-400'}`}>{msg}</p>}

              <div className="space-y-1.5">
                <button onClick={publiser}
                  className="w-full py-2 bg-g-green/10 border border-g-green/20 hover:bg-g-green/20 text-g-green text-xs font-bold rounded transition-all">
                  ◆ Publiser til Discord
                </button>
                <button onClick={() => setVisSlettDialog(true)}
                  className="w-full py-2 border border-red-500/20 text-red-400 text-xs font-bold rounded hover:bg-red-500/10 transition-all">
                  Slett
                </button>
              </div>

              {/* Slett-dialog */}
              {visSlettDialog && (
                <div className="border border-red-500/30 rounded-lg p-3 bg-red-500/5 space-y-2">
                  <p className="text-xs font-bold text-red-400">Hva vil du gjøre?</p>
                  <div className="space-y-1">
                    <button onClick={() => slett(false)} className="w-full py-1.5 border border-g-border rounded text-xs text-g-muted hover:text-g-text text-left px-3 transition-all">
                      Arkiver kun i appen
                    </button>
                    <button onClick={() => slett(true)} className="w-full py-1.5 border border-red-500/30 rounded text-xs text-red-400 hover:bg-red-500/10 text-left px-3 transition-all">
                      Slett også Discord-meldingen
                    </button>
                    <button onClick={() => setVisSlettDialog(false)} className="w-full py-1.5 text-xs text-g-muted hover:text-g-text transition-all">
                      Avbryt
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-g-card border border-g-border rounded-xl p-6 text-center">
              <p className="text-xs text-g-muted">Velg et element for å redigere og publisere</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
