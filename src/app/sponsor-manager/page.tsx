'use client';

import { useEffect, useState } from 'react';
import { tidSiden } from '@/components/dashboard/helpers';
import { PageHeader } from '@/components/ui';

// ── Existing interfaces ────────────────────────────────────────────────────────

interface ScoreKomponent { navn: string; maks: number; oppnådd: number; mangler: string | null; }
interface Milestone { poeng: number; label: string; nådd: boolean; }
interface PeriodeData { streams: number; avgV: number; peakV: number; hoursStr: number; followersGained: number; klipp: number; }

interface PartnerHistorikkRad {
  navn: string;
  promoer30d: number;
  promoerTotalt: number;
  sisteSendt: string | null;
  godkjentRate: number | null;
  avvisninger: number;
  dataStyrke: 'god' | 'moderat' | 'svak';
  aktiv: boolean | null;
}

interface SponsorData {
  score: number;
  dataErSvak: boolean;
  avgViewers: number;
  peakViewers: number;
  followers: number;
  discordMembers: number;
  hoursStreamed: number;
  trends: { avgViewers: '↑'|'↓'|'→'; streams: '↑'|'↓'|'→'; klipp: '↑'|'↓'|'→'; followers: '↑'|'↓'|'→' };
  periode: { p7: PeriodeData; p30: PeriodeData; p90: PeriodeData };
  scoreKomponenter: ScoreKomponent[];
  milestones: Milestone[];
  nesteMillestone: Milestone | null;
  rapport: string;
  sterktePunkter: string[];
  forbedringer: string[];
  pitchEmail: string;
  pitchOneLiner: string;
  malgruppe: string;
  hvaOkerScoren: string;
  hvaRedusererScoren: string;
  trend: { followerGrowthLast30d: number; avgViewersLast30d: number; streamsLast30d: number; topSpill: string[] };
  contentStats: { ferdigeVods: number; totaleKlipp: number; aktivePartnere: number; streamsHistorikk: number; aiMemoryStreams: number };
  partnerHistorikk: PartnerHistorikkRad[];
  partnerTotaler: { totalePromoer: number; totaleForslag: number; promoer30d: number; godkjentRate: number | null; mestAktiv: string | null };
}

// ── Partner Report interfaces ─────────────────────────────────────────────────

interface PartnerReport {
  generertAt: string;
  periode: '7d' | '30d';
  partnerName: string;
  partnerAktiv: boolean | null;
  sammendrag: {
    totalePromoer: number; discord: number; twitch: number;
    totaleForslag: number; godkjent: number; avvist: number; venter: number;
    streamerMedPartner: number; sistePromo: string | null; sisteAiVurdering: string | null;
  };
  partneroversikt: {
    dataStrength: 'god' | 'moderat' | 'svak';
    promoer7d: number; promoer30d: number; promoerTotalt: number;
    discord: number; twitch: number; sisteKanal: string | null;
    sistePromotert: string | null; godkjentRate: number | null;
    avvisningsrate: number | null; pending: number;
    aiScore: number | null; sisteReasonCode: string | null;
    sisteTriggerType: string | null; sisteOutcome: string | null;
  };
  historisk: {
    p7: { promoer: number; godkjennelser: number; eksponering: number };
    p30: { promoer: number; godkjennelser: number; eksponering: number };
    p90: { promoer: number; godkjennelser: number; eksponering: number };
  };
  streamHistorikk: Array<{
    title: string; startedAt: string; discord: number; twitch: number;
    promoer: number; highlights: number; game: string | null; avgViewers: number | null;
  }>;
  highlights: Array<{
    id: string; title: string | null; createdAt: string;
    streamTitle: string | null; vodId: string | null; vodTitle: string | null;
  }>;
  creatorLearning: {
    besteTidspunkt: { label: string; approvalRate: number | null; evidenceCount: number; confidence: number } | null;
    bestePlattform: { platform: string; percentage: number | null; evidenceCount: number; confidence: number } | null;
    approvalPattern: { approvalRate: number | null; evidenceCount: number; confidence: number; finding: string } | null;
    partnerPerformance: { finding: string; confidence: number; evidenceCount: number } | null;
    historiskeMonstre: string[];
  };
  aiAnbefaling: string | null;
  datagrunnlag: {
    styrke: 'god' | 'moderat' | 'svak';
    forklaring: string;
    basertPa: { streams: number; proposals: number; promoer: number; systemEvents: number };
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type Fane = '7d' | '30d' | '90d';

function trendFarge(t: '↑'|'↓'|'→') { return t === '↑' ? '#00ff41' : t === '↓' ? '#ff4444' : '#888'; }


function dato(iso: string | null): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString('no-NO', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function konfFarge(c: number): string {
  return c >= 75 ? '#00ff41' : c >= 40 ? '#ffd700' : '#888';
}

function styrkeKlasse(s: 'god' | 'moderat' | 'svak'): string {
  return s === 'god'     ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10' :
         s === 'moderat' ? 'text-yellow-400  border-yellow-400/30  bg-yellow-400/10'  :
                           'text-g-muted/50  border-g-border/30';
}

// ── PDF export ────────────────────────────────────────────────────────────────

function exportPDF(r: PartnerReport) {
  const decided = r.sammendrag.godkjent + r.sammendrag.avvist;
  const html = `<!DOCTYPE html>
<html lang="no">
<head>
<meta charset="UTF-8">
<title>Partnerrapport — ${r.partnerName}</title>
<style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #111; margin: 40px; font-size: 12px; line-height: 1.6; }
  h1 { font-size: 22px; font-weight: 900; margin-bottom: 4px; }
  h2 { font-size: 14px; font-weight: 700; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin: 24px 0 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #444; }
  .meta { color: #666; font-size: 11px; margin-bottom: 20px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .box { border: 1px solid #ddd; border-radius: 6px; padding: 10px; }
  .label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
  .value { font-size: 18px; font-weight: 900; color: #111; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 10px; color: #888; text-transform: uppercase; border-bottom: 1px solid #ddd; padding: 4px 8px; }
  td { padding: 6px 8px; border-bottom: 1px solid #f0f0f0; font-size: 11px; }
  .badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; }
  .good { background: #d4edda; color: #155724; }
  .mod  { background: #fff3cd; color: #856404; }
  .weak { background: #f8f9fa; color: #6c757d; }
  .ai-box { background: #f8f9fa; border-radius: 6px; padding: 14px; font-style: italic; color: #333; margin-top: 8px; }
  .footer { margin-top: 32px; font-size: 10px; color: #aaa; border-top: 1px solid #eee; padding-top: 8px; }
  @media print { body { margin: 20px; } }
</style>
</head>
<body>
<h1>Partnerrapport — ${r.partnerName}</h1>
<p class="meta">Periode: siste ${r.periode === '7d' ? '7 dager' : '30 dager'} &nbsp;·&nbsp; Generert: ${new Date(r.generertAt).toLocaleString('no-NO')}</p>

<h2>Sammendrag</h2>
<div class="grid3">
  <div class="box"><div class="label">Promoer totalt</div><div class="value">${r.sammendrag.totalePromoer}</div></div>
  <div class="box"><div class="label">Discord</div><div class="value">${r.sammendrag.discord}</div></div>
  <div class="box"><div class="label">Twitch</div><div class="value">${r.sammendrag.twitch}</div></div>
  <div class="box"><div class="label">Godkjent</div><div class="value">${r.sammendrag.godkjent}</div></div>
  <div class="box"><div class="label">Avvist</div><div class="value">${r.sammendrag.avvist}</div></div>
  <div class="box"><div class="label">Venter</div><div class="value">${r.sammendrag.venter}</div></div>
</div>
<p style="margin-top:10px;font-size:11px;color:#555;">
  Streams med partner: <strong>${r.sammendrag.streamerMedPartner}</strong>
  ${r.sammendrag.sistePromo ? ` &nbsp;·&nbsp; Siste promo: <strong>${dato(r.sammendrag.sistePromo)}</strong>` : ''}
  ${r.partneroversikt.godkjentRate !== null ? ` &nbsp;·&nbsp; Godkjennelsesrate: <strong>${r.partneroversikt.godkjentRate}%</strong>` : ''}
</p>

<h2>Historisk utvikling</h2>
<table>
  <tr><th>Periode</th><th>Promoer</th><th>Godkjennelser</th><th>Eksponering</th></tr>
  <tr><td>7 dager</td><td>${r.historisk.p7.promoer}</td><td>${r.historisk.p7.godkjennelser}</td><td>${r.historisk.p7.eksponering}</td></tr>
  <tr><td>30 dager</td><td>${r.historisk.p30.promoer}</td><td>${r.historisk.p30.godkjennelser}</td><td>${r.historisk.p30.eksponering}</td></tr>
  <tr><td>90 dager</td><td>${r.historisk.p90.promoer}</td><td>${r.historisk.p90.godkjennelser}</td><td>${r.historisk.p90.eksponering}</td></tr>
</table>

${r.streamHistorikk.length > 0 ? `
<h2>Streamhistorikk</h2>
<table>
  <tr><th>Stream</th><th>Dato</th><th>Discord</th><th>Twitch</th><th>Promoer</th><th>Highlights</th></tr>
  ${r.streamHistorikk.map(s => `<tr><td>${s.title}${s.game ? ` (${s.game})` : ''}</td><td>${dato(s.startedAt)}</td><td>${s.discord}</td><td>${s.twitch}</td><td>${s.promoer}</td><td>${s.highlights}</td></tr>`).join('')}
</table>` : ''}

${r.highlights.length > 0 ? `
<h2>Highlights</h2>
<table>
  <tr><th>Tittel</th><th>Tidspunkt</th><th>Stream</th></tr>
  ${r.highlights.map(h => `<tr><td>${h.title ?? '–'}</td><td>${dato(h.createdAt)}</td><td>${h.streamTitle ?? '–'}</td></tr>`).join('')}
</table>` : ''}

${(r.creatorLearning.approvalPattern || r.creatorLearning.besteTidspunkt || r.creatorLearning.partnerPerformance || r.creatorLearning.historiskeMonstre.length > 0) ? `
<h2>Creator Brain Learning</h2>
${r.creatorLearning.approvalPattern ? `<p>${r.creatorLearning.approvalPattern.finding} <em>(konfidensgrad: ${r.creatorLearning.approvalPattern.confidence}%, ${r.creatorLearning.approvalPattern.evidenceCount} datapunkt)</em></p>` : ''}
${r.creatorLearning.partnerPerformance ? `<p>${r.creatorLearning.partnerPerformance.finding} <em>(${r.creatorLearning.partnerPerformance.evidenceCount} datapunkt)</em></p>` : ''}
${r.creatorLearning.besteTidspunkt ? `<p>Beste tidspunkt: <strong>${r.creatorLearning.besteTidspunkt.label}</strong> — ${r.creatorLearning.besteTidspunkt.approvalRate}% godkjenning (${r.creatorLearning.besteTidspunkt.evidenceCount} datapunkt)</p>` : ''}
${r.creatorLearning.bestePlattform ? `<p>Beste plattform: <strong>${r.creatorLearning.bestePlattform.platform}</strong> — ${r.creatorLearning.bestePlattform.percentage}% av promoer</p>` : ''}
${r.creatorLearning.historiskeMonstre.map(m => `<p>— ${m}</p>`).join('')}` : ''}

${r.aiAnbefaling ? `
<h2>AI-anbefaling</h2>
<div class="ai-box">${r.aiAnbefaling}</div>` : ''}

<h2>Datagrunnlag</h2>
<p><span class="badge ${r.datagrunnlag.styrke === 'god' ? 'good' : r.datagrunnlag.styrke === 'moderat' ? 'mod' : 'weak'}">${r.datagrunnlag.styrke.toUpperCase()}</span> &nbsp; ${r.datagrunnlag.forklaring}</p>
<p style="color:#666;font-size:11px;">
  Basert på ${r.datagrunnlag.basertPa.streams} streams
  · ${r.datagrunnlag.basertPa.proposals} forslag
  · ${r.datagrunnlag.basertPa.promoer} promoer
  · ${r.datagrunnlag.basertPa.systemEvents} system-events
</p>

<div class="footer">
  Partnerrapport generert av Glenvex Stream Control &nbsp;·&nbsp; ${new Date(r.generertAt).toLocaleString('no-NO')}
  ${decided > 0 && r.partneroversikt.godkjentRate !== null ? ` &nbsp;·&nbsp; Godkjennelsesrate: ${r.partneroversikt.godkjentRate}% basert på ${decided} avgjorte forslag` : ''}
</div>
</body>
</html>`;
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 500);
}

// ── Existing sub-components ───────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const color = score >= 75 ? '#00ff41' : score >= 50 ? '#ffd700' : score >= 25 ? '#ff8c00' : '#ff4444';
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-end">
        <span className="text-[10px] text-g-muted uppercase tracking-widest">Sponsor Readiness Score</span>
        <span className="text-3xl font-black font-mono" style={{ color }}>{score}<span className="text-sm text-g-muted">/100</span></span>
      </div>
      <div className="relative w-full bg-g-border rounded-full h-4">
        {[25, 50, 75].map(p => (
          <div key={p} className="absolute top-0 bottom-0 w-px bg-black/40" style={{ left: `${p}%` }} />
        ))}
        <div className="h-4 rounded-full transition-all duration-700" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <div className="flex justify-between text-[9px] text-g-muted/60">
        <span>Nybegynner</span><span>Etablert</span><span>Seriøs</span><span>Klar</span>
      </div>
    </div>
  );
}

function PeriodeKort({ label, data }: { label: string; data: PeriodeData }) {
  if (!data) return null;
  return (
    <div className="bg-g-sidebar border border-g-border rounded-lg p-4 space-y-2">
      <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {[
          { l: 'Streams', v: data.streams ?? 0 },
          { l: 'Snitt-seere', v: data.avgV ?? 0 },
          { l: 'Peak', v: data.peakV ?? 0 },
          { l: 'Timer', v: `${data.hoursStr ?? 0}t` },
          { l: 'Nye følgere', v: `+${data.followersGained ?? 0}` },
          { l: 'Klipp', v: data.klipp ?? 0 },
        ].map(s => (
          <div key={s.l} className="text-center">
            <p className="text-[8px] text-g-muted/70 uppercase tracking-wider">{s.l}</p>
            <p className="text-sm font-black font-mono text-g-green">{s.v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Partner Report component ──────────────────────────────────────────────────

function PartnerReportView({ report, onClose }: { report: PartnerReport; onClose: () => void }) {
  const { sammendrag: s, partneroversikt: p, historisk: h, creatorLearning: cl, datagrunnlag: dg } = report;
  const decided = s.godkjent + s.avvist;

  return (
    <div className="bg-g-card border border-g-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-g-border bg-g-sidebar">
        <div>
          <h2 className="text-sm font-black tracking-wide text-g-text uppercase">
            Partnerrapport — {report.partnerName}
          </h2>
          <p className="text-[10px] text-g-muted mt-0.5">
            Periode: siste {report.periode === '7d' ? '7 dager' : '30 dager'}
            &nbsp;·&nbsp; Generert {tidSiden(report.generertAt)}
            &nbsp;·&nbsp;
            <span className={`px-1.5 py-0.5 border rounded text-[9px] font-bold ${styrkeKlasse(dg.styrke)}`}>
              {dg.styrke}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportPDF(report)}
            className="px-3 py-1.5 border border-g-border rounded text-[10px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all"
          >
            ↓ PDF
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 border border-g-border rounded text-[10px] text-g-muted hover:text-red-400 hover:border-red-400/30 transition-all"
          >
            ✕ Lukk
          </button>
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* Section 2: Sammendrag */}
        <div>
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Sammendrag</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { l: 'Promoer totalt', v: s.totalePromoer },
              { l: 'Discord',        v: s.discord },
              { l: 'Twitch',         v: s.twitch },
              { l: 'Godkjent',       v: s.godkjent },
              { l: 'Avvist',         v: s.avvist },
              { l: 'Venter',         v: s.venter },
            ].map(x => (
              <div key={x.l} className="bg-g-sidebar border border-g-border rounded-lg p-3 text-center">
                <p className="text-[8px] text-g-muted uppercase tracking-wider">{x.l}</p>
                <p className="text-xl font-black text-g-green font-mono mt-0.5">{x.v}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-2 text-[10px] text-g-muted">
            <span>Streams med partner: <span className="text-g-text font-bold">{s.streamerMedPartner}</span></span>
            {s.sistePromo && <span>Siste promo: <span className="text-g-text">{dato(s.sistePromo)}</span></span>}
            {decided > 0 && p.godkjentRate !== null && <span>Godkjennelsesrate: <span className="text-g-green font-bold">{p.godkjentRate}%</span></span>}
          </div>
        </div>

        {/* Section 3: Partneroversikt */}
        <div>
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Partneroversikt</p>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            {[
              { l: 'Promoer 7d',      v: p.promoer7d },
              { l: 'Promoer 30d',     v: p.promoer30d },
              { l: 'Promoer totalt',  v: p.promoerTotalt },
              { l: 'Siste kanal',     v: p.sisteKanal ?? '–' },
              { l: 'Siste promotert', v: dato(p.sistePromotert) },
              { l: 'Godkjent %',      v: p.godkjentRate !== null ? `${p.godkjentRate}%` : '–' },
              { l: 'Avvist %',        v: p.avvisningsrate !== null ? `${p.avvisningsrate}%` : '–' },
              { l: 'AI-score',        v: p.aiScore !== null ? `${p.aiScore}%` : '–' },
              { l: 'ReasonCode',      v: p.sisteReasonCode ?? '–' },
              { l: 'TriggerType',     v: p.sisteTriggerType ?? '–' },
              { l: 'Siste outcome',   v: p.sisteOutcome ?? '–' },
              { l: 'Pending',         v: p.pending },
            ].map(x => (
              <div key={x.l} className="flex justify-between py-1 border-b border-g-border/20">
                <span className="text-g-muted">{x.l}</span>
                <span className="text-g-text font-mono">{x.v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Section 4: Historisk utvikling */}
        <div>
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Historisk utvikling</p>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-g-border/40">
                {['Periode', 'Promoer', 'Godkjennelser', 'Eksponering'].map(c => (
                  <th key={c} className="py-1.5 pr-3 text-left text-[9px] text-g-muted uppercase tracking-wider font-bold">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { l: '7 dager',   d: h.p7  },
                { l: '30 dager',  d: h.p30 },
                { l: '90 dager',  d: h.p90 },
              ].map(row => (
                <tr key={row.l} className="border-b border-g-border/10">
                  <td className="py-1.5 pr-3 text-g-muted">{row.l}</td>
                  <td className="py-1.5 pr-3 font-mono text-g-green">{row.d.promoer}</td>
                  <td className="py-1.5 pr-3 font-mono text-g-text">{row.d.godkjennelser}</td>
                  <td className="py-1.5 pr-3 font-mono text-g-text">{row.d.eksponering}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Section 5: Stream-historikk */}
        {report.streamHistorikk.length > 0 && (
          <div>
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Streamhistorikk</p>
            <div className="space-y-1.5">
              {report.streamHistorikk.map((s2, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-g-border/10 text-[10px]">
                  <div>
                    <span className="text-g-text font-medium">{s2.title}</span>
                    {s2.game && <span className="text-g-muted/60 ml-1">({s2.game})</span>}
                    <span className="text-g-muted/50 ml-2">{dato(s2.startedAt)}</span>
                  </div>
                  <div className="flex gap-3 text-g-muted flex-shrink-0">
                    <span>Discord: <span className="text-g-text font-mono">{s2.discord}</span></span>
                    <span>Twitch: <span className="text-g-text font-mono">{s2.twitch}</span></span>
                    {s2.highlights > 0 && <span>Highlights: <span className="text-amber-400 font-mono">{s2.highlights}</span></span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section 6: Highlights */}
        <div>
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Highlights</p>
          {report.highlights.length > 0 ? (
            <div className="space-y-1">
              {report.highlights.map(hl => (
                <div key={hl.id} className="flex items-center justify-between py-1 border-b border-g-border/10 text-[10px]">
                  <span className="text-g-text">{hl.title ?? '(uten tittel)'}</span>
                  <div className="flex gap-3 text-g-muted/60 flex-shrink-0">
                    <span>{dato(hl.createdAt)}</span>
                    {hl.streamTitle && <span>Stream: {hl.streamTitle}</span>}
                    {hl.vodTitle && <span>VOD: {hl.vodTitle}</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-g-muted/40">Ingen highlights funnet i streams der partneren var med.</p>
          )}
        </div>

        {/* Section 7: Creator Brain Learning */}
        {(cl.approvalPattern || cl.partnerPerformance || cl.besteTidspunkt || cl.bestePlattform || cl.historiskeMonstre.length > 0) && (
          <div>
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Creator Brain Learning</p>
            <div className="space-y-2">
              {cl.approvalPattern && (
                <div className="flex items-start gap-2">
                  <span className="text-emerald-400 text-xs mt-0.5 flex-shrink-0">✓</span>
                  <div>
                    <p className="text-[11px] text-g-text">{cl.approvalPattern.finding}</p>
                    <p className="text-[9px] mt-0.5" style={{ color: konfFarge(cl.approvalPattern.confidence) }}>
                      {cl.approvalPattern.confidence}% konfidensgrad · {cl.approvalPattern.evidenceCount} datapunkt
                    </p>
                  </div>
                </div>
              )}
              {cl.partnerPerformance && (
                <div className="flex items-start gap-2">
                  <span className="text-amber-400 text-xs mt-0.5 flex-shrink-0">★</span>
                  <div>
                    <p className="text-[11px] text-g-text">{cl.partnerPerformance.finding}</p>
                    <p className="text-[9px] text-g-muted/50 mt-0.5">{cl.partnerPerformance.evidenceCount} datapunkt</p>
                  </div>
                </div>
              )}
              {cl.besteTidspunkt?.approvalRate !== null && cl.besteTidspunkt !== null && (
                <div className="flex items-start gap-2">
                  <span className="text-blue-400 text-xs mt-0.5 flex-shrink-0">⏱</span>
                  <p className="text-[11px] text-g-text">
                    Beste tidspunkt: <span className="font-bold">{cl.besteTidspunkt.label}</span> — {cl.besteTidspunkt.approvalRate}% godkjenning ({cl.besteTidspunkt.evidenceCount} datapunkt)
                  </p>
                </div>
              )}
              {cl.bestePlattform?.percentage !== null && cl.bestePlattform !== null && (
                <div className="flex items-start gap-2">
                  <span className="text-purple-400 text-xs mt-0.5 flex-shrink-0">⊞</span>
                  <p className="text-[11px] text-g-text">
                    Beste plattform: <span className="font-bold">{cl.bestePlattform.platform}</span> ({cl.bestePlattform.percentage}% av promoer)
                  </p>
                </div>
              )}
              {cl.historiskeMonstre.map((m, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-g-muted/30 text-xs mt-0.5 flex-shrink-0">·</span>
                  <p className="text-[11px] text-g-muted/70">{m}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section 8: AI-anbefaling */}
        {report.aiAnbefaling && (
          <div>
            <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">AI-anbefaling</p>
            <div className="bg-g-sidebar border border-g-border/40 rounded-lg p-3">
              <p className="text-[11px] text-g-text/90 leading-relaxed italic">{report.aiAnbefaling}</p>
            </div>
          </div>
        )}

        {/* Section 9: Datagrunnlag */}
        <div>
          <p className="text-[9px] text-g-muted uppercase tracking-widest font-bold mb-2">Datagrunnlag</p>
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`px-2 py-0.5 border rounded text-[9px] font-bold ${styrkeKlasse(dg.styrke)}`}>{dg.styrke.toUpperCase()}</span>
            <p className="text-[10px] text-g-text">{dg.forklaring}</p>
          </div>
          <p className="text-[10px] text-g-muted/50">
            Basert på {dg.basertPa.streams} streams
            · {dg.basertPa.proposals} forslag
            · {dg.basertPa.promoer} promoer
            {dg.basertPa.systemEvents > 0 && ` · ${dg.basertPa.systemEvents} system-events`}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SponsorManagerPage() {
  const [data, setData] = useState<SponsorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fane, setFane] = useState<Fane>('30d');
  const [visEmail, setVisEmail] = useState(false);

  // Partner report state
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null);
  const [reportPeriod, setReportPeriod] = useState<'7d' | '30d'>('30d');
  const [partnerReport, setPartnerReport] = useState<PartnerReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/sponsor-report').then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  async function genererPartnerRapport(navn: string) {
    setSelectedPartner(navn);
    setPartnerReport(null);
    setReportError(null);
    setReportLoading(true);
    try {
      const res = await fetch(`/api/sponsor-report?partner=${encodeURIComponent(navn)}&period=${reportPeriod}`);
      if (!res.ok) throw new Error('Feil ved henting');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setPartnerReport(json as PartnerReport);
    } catch (e: any) {
      setReportError(e.message ?? 'Ukjent feil');
    } finally {
      setReportLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-8">
      <PageHeader title="Sponsor Manager" subtitle="Sponsorrapport, score og veksthistorikk" />

      {loading ? (
        <div className="bg-g-card border border-g-border rounded-lg p-12 flex items-center justify-center">
          <div className="text-center space-y-2">
            <span className="w-8 h-8 border-2 border-g-green/30 border-t-g-green rounded-full animate-spin inline-block" />
            <p className="text-xs text-g-muted">Henter statistikk og genererer rapport...</p>
          </div>
        </div>
      ) : !data ? (
        <p className="text-xs text-g-muted p-4">Kunne ikke hente sponsor-data.</p>
      ) : data.dataErSvak ? (
        <div className="bg-g-card border border-yellow-400/20 rounded-lg p-8 text-center space-y-2">
          <p className="text-yellow-400 font-bold">⚠ Datagrunnlaget er foreløpig for svakt.</p>
          <p className="text-xs text-g-muted">Kjør flere streams for mer nøyaktig analyse. Du trenger minst 3 registrerte streams og noen følgere.</p>
        </div>
      ) : (
        <>
          {/* Score + one-liner */}
          <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-4">
            <ScoreBar score={data.score} />
            {data.pitchOneLiner && (
              <p className="text-xs text-g-green font-mono italic border-l-2 border-g-green/30 pl-3">&ldquo;{data.pitchOneLiner}&rdquo;</p>
            )}
          </div>

          {/* Milestones */}
          <div className="bg-g-card border border-g-border rounded-lg p-4">
            <p className="text-[10px] text-g-muted uppercase tracking-widest font-bold mb-3">Milestones</p>
            <div className="flex items-center gap-0">
              {data.milestones.map((m, i) => (
                <div key={m.poeng} className="flex-1 flex items-center">
                  <div className="flex flex-col items-center gap-1 w-full">
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all ${m.nådd ? 'bg-g-green/20 border-g-green text-g-green' : 'border-g-border text-g-muted'}`}>
                      {m.nådd ? '✓' : m.poeng}
                    </div>
                    <p className={`text-[8px] text-center ${m.nådd ? 'text-g-green' : 'text-g-muted/50'}`}>{m.label}</p>
                  </div>
                  {i < data.milestones.length - 1 && <div className={`h-px flex-1 mx-1 ${m.nådd ? 'bg-g-green/40' : 'bg-g-border'}`} />}
                </div>
              ))}
            </div>
            {data.nesteMillestone && (
              <p className="text-[10px] text-g-muted mt-3">Neste: <span className="text-g-text">{data.nesteMillestone.label}</span> ({data.nesteMillestone.poeng} poeng)</p>
            )}
          </div>

          {/* Score breakdown */}
          <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-3">
            <p className="text-[10px] text-g-muted uppercase tracking-widest font-bold">Score Breakdown</p>
            <div className="space-y-2">
              {data.scoreKomponenter.map(k => (
                <div key={k.navn} className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex justify-between text-[10px] mb-0.5">
                      <span className="text-g-muted">{k.navn}</span>
                      <span className="font-mono text-g-text">{k.oppnådd}/{k.maks}</span>
                    </div>
                    <div className="w-full bg-g-border rounded-full h-1.5">
                      <div className="h-1.5 rounded-full transition-all" style={{ width: `${(k.oppnådd / k.maks) * 100}%`, backgroundColor: k.oppnådd >= k.maks * 0.8 ? '#00ff41' : k.oppnådd >= k.maks * 0.4 ? '#ffd700' : '#ff8c00' }} />
                    </div>
                  </div>
                  {k.mangler && <span className="text-[9px] text-g-muted/60 w-32 text-right flex-shrink-0">{k.mangler}</span>}
                </div>
              ))}
            </div>
            {(data.hvaOkerScoren || data.hvaRedusererScoren) && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-g-border">
                {data.hvaOkerScoren && (
                  <div>
                    <p className="text-[9px] text-g-green uppercase font-bold mb-1">Øker score</p>
                    <p className="text-[10px] text-g-text leading-relaxed">{data.hvaOkerScoren}</p>
                  </div>
                )}
                {data.hvaRedusererScoren && (
                  <div>
                    <p className="text-[9px] text-yellow-400 uppercase font-bold mb-1">Holder tilbake</p>
                    <p className="text-[10px] text-g-text leading-relaxed">{data.hvaRedusererScoren}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Historikk-tabs */}
          <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-g-muted uppercase tracking-widest font-bold">Veksthistorikk</p>
              <div className="flex gap-1">
                {(['7d', '30d', '90d'] as Fane[]).map(f => (
                  <button key={f} onClick={() => setFane(f)} className={`px-3 py-1 text-[10px] rounded border transition-all ${fane === f ? 'border-g-green/30 bg-g-green/10 text-g-green' : 'border-g-border text-g-muted hover:text-g-text'}`}>{f}</button>
                ))}
              </div>
            </div>
            {fane === '7d'  && <PeriodeKort label="Siste 7 dager"  data={data.periode?.p7} />}
            {fane === '30d' && <PeriodeKort label="Siste 30 dager" data={data.periode?.p30} />}
            {fane === '90d' && <PeriodeKort label="Siste 90 dager" data={data.periode?.p90} />}
            <div className="grid grid-cols-4 gap-2 pt-2 border-t border-g-border">
              {[
                { label: 'Seere',    t: data.trends.avgViewers },
                { label: 'Streams',  t: data.trends.streams },
                { label: 'Klipp',    t: data.trends.klipp },
                { label: 'Følgere',  t: data.trends.followers },
              ].map(({ label, t }) => (
                <div key={label} className="text-center">
                  <p className="text-[8px] text-g-muted uppercase">{label}</p>
                  <p className="text-xl font-bold" style={{ color: trendFarge(t as any) }}>{t}</p>
                </div>
              ))}
            </div>
            {data.trend.topSpill.length > 0 && (
              <p className="text-[10px] text-g-muted">Topp spill: <span className="text-g-text">{data.trend.topSpill.join(', ')}</span></p>
            )}
          </div>

          {/* Stats-grid */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Følgere',        value: data.followers.toLocaleString('no-NO'), trend: data.trends.followers },
              { label: 'Snitt-seere',    value: data.avgViewers, trend: data.trends.avgViewers },
              { label: 'Peak seere',     value: data.peakViewers },
              { label: 'Discord',        value: data.discordMembers.toLocaleString('no-NO') },
              { label: 'Timer streamet', value: `${data.hoursStreamed}t` },
              { label: 'Klipp publisert', value: data.contentStats.totaleKlipp, trend: data.trends.klipp },
            ].map(s => (
              <div key={s.label} className="bg-g-card border border-g-border rounded-lg p-4 text-center">
                <p className="text-[9px] text-g-muted uppercase tracking-widest">{s.label}</p>
                <div className="flex items-center justify-center gap-1 mt-1">
                  <p className="text-xl font-black text-g-green font-mono">{s.value}</p>
                  {s.trend && <span className="text-sm font-bold" style={{ color: trendFarge(s.trend as any) }}>{s.trend}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Sterke punkter + Forbedringer */}
          {(data.sterktePunkter.length > 0 || data.forbedringer.length > 0) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-g-card border border-g-border rounded-lg p-4 space-y-1.5">
                <p className="text-[10px] text-g-green uppercase tracking-widest font-bold mb-2">✓ Sterke punkter</p>
                {data.sterktePunkter.map((s2, i) => <p key={i} className="text-[11px] text-g-text leading-snug">{s2}</p>)}
              </div>
              <div className="bg-g-card border border-g-border rounded-lg p-4 space-y-1.5">
                <p className="text-[10px] text-yellow-400 uppercase tracking-widest font-bold mb-2">⚠ Kan forbedres</p>
                {data.forbedringer.map((s2, i) => <p key={i} className="text-[11px] text-g-text leading-snug">{s2}</p>)}
              </div>
            </div>
          )}

          {/* AI Sponsorrapport */}
          {data.rapport && (
            <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] text-g-muted font-semibold tracking-widest uppercase">AI Sponsorrapport</h2>
                <button onClick={() => {
                  const blob = new Blob([data.rapport], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = 'sponsor-rapport.txt'; a.click();
                }} className="px-3 py-1 border border-g-border rounded text-[10px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                  ↓ Last ned
                </button>
              </div>
              <p className="text-[11px] text-g-text leading-relaxed font-mono whitespace-pre-wrap">{data.rapport}</p>
            </div>
          )}

          {/* Målgruppe */}
          {data.malgruppe && (
            <div className="bg-g-card border border-g-border rounded-lg p-4">
              <p className="text-[10px] text-g-muted uppercase tracking-widest font-bold mb-2">Målgruppe</p>
              <p className="text-xs text-g-text leading-relaxed">{data.malgruppe}</p>
            </div>
          )}

          {/* Pitch e-post */}
          {data.pitchEmail && (
            <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] text-g-muted font-semibold tracking-widest uppercase">Pitch e-post</h2>
                <button onClick={() => setVisEmail(v => !v)} className="px-3 py-1 border border-g-border rounded text-[10px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                  {visEmail ? 'Skjul' : 'Vis e-post'}
                </button>
              </div>
              {visEmail && (
                <div className="space-y-2">
                  <pre className="text-[10px] text-g-text leading-relaxed whitespace-pre-wrap font-mono bg-g-sidebar rounded p-3 border border-g-border">{data.pitchEmail}</pre>
                  <button onClick={() => navigator.clipboard.writeText(data.pitchEmail)} className="px-3 py-1 border border-g-border rounded text-[10px] text-g-muted hover:text-g-green hover:border-g-green/30 transition-all">
                    Kopier tekst
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Partner-historikk + Partner Report */}
          {data.partnerHistorikk?.length > 0 && (
            <div className="bg-g-card border border-g-border rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] text-g-muted font-semibold tracking-widest uppercase">Partner-historikk (ekte data)</h2>
                {data.partnerTotaler && (
                  <span className="text-[10px] text-g-muted/60">
                    {data.partnerTotaler.totalePromoer} promoer totalt
                    {data.partnerTotaler.godkjentRate !== null && ` · ${data.partnerTotaler.godkjentRate}% godkjent`}
                  </span>
                )}
              </div>

              {/* Totaler */}
              {data.partnerTotaler && (
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Promoer siste 30d', value: data.partnerTotaler.promoer30d },
                    { label: 'Totale forslag',    value: data.partnerTotaler.totaleForslag },
                    { label: 'Mest aktiv',         value: data.partnerTotaler.mestAktiv ?? '–' },
                  ].map(s2 => (
                    <div key={s2.label} className="bg-g-sidebar border border-g-border rounded p-3 text-center">
                      <p className="text-[8px] text-g-muted uppercase tracking-wider">{s2.label}</p>
                      <p className="text-sm font-black text-g-green font-mono mt-0.5 truncate">{s2.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Periode-velger for rapport */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-g-muted uppercase">Rapport-periode:</span>
                {(['7d', '30d'] as const).map(p => (
                  <button key={p} onClick={() => setReportPeriod(p)} className={`px-2 py-0.5 text-[9px] rounded border transition-all ${reportPeriod === p ? 'border-g-green/30 bg-g-green/10 text-g-green' : 'border-g-border text-g-muted hover:text-g-text'}`}>{p}</button>
                ))}
              </div>

              {/* Per-partner tabell */}
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b border-g-border/40">
                      {['Partner', 'Promoer 30d', 'Totalt', 'Siste sendt', 'Godkjent %', 'Avvisninger', 'Datagrunnlag', 'Rapport'].map(h2 => (
                        <th key={h2} className="py-1.5 pr-3 text-left text-[9px] text-g-muted uppercase tracking-wider font-bold">{h2}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-g-border/20">
                    {data.partnerHistorikk
                      .sort((a, b) => b.promoerTotalt - a.promoerTotalt)
                      .map(p2 => {
                        const daysSince = p2.sisteSendt
                          ? Math.floor((Date.now() - new Date(p2.sisteSendt).getTime()) / 86_400_000)
                          : null;
                        const isLoading = reportLoading && selectedPartner === p2.navn;
                        return (
                          <tr key={p2.navn} className={`${!p2.aktiv ? 'opacity-40' : ''}`}>
                            <td className="py-2 pr-3 font-bold text-g-text">{p2.navn}</td>
                            <td className="py-2 pr-3 font-mono text-g-green">{p2.promoer30d}</td>
                            <td className="py-2 pr-3 font-mono text-g-muted">{p2.promoerTotalt}</td>
                            <td className="py-2 pr-3 text-g-muted">
                              {daysSince !== null ? `${daysSince}d siden` : <span className="text-g-muted/40">aldri</span>}
                            </td>
                            <td className="py-2 pr-3">
                              {p2.godkjentRate !== null
                                ? <span className={p2.godkjentRate >= 70 ? 'text-g-green font-bold' : p2.godkjentRate >= 40 ? 'text-yellow-400' : 'text-red-400'}>{p2.godkjentRate}%</span>
                                : <span className="text-g-muted/40">–</span>}
                            </td>
                            <td className="py-2 pr-3 text-g-muted">{p2.avvisninger > 0 ? p2.avvisninger : '–'}</td>
                            <td className="py-2 pr-3">
                              <span className={`px-1.5 py-0.5 border rounded text-[9px] font-bold ${styrkeKlasse(p2.dataStyrke)}`}>{p2.dataStyrke}</span>
                            </td>
                            <td className="py-2 pr-3">
                              <button
                                onClick={() => genererPartnerRapport(p2.navn)}
                                disabled={isLoading}
                                className={`px-2 py-1 border rounded text-[9px] transition-all ${isLoading ? 'border-g-border text-g-muted/40 cursor-wait' : 'border-g-green/30 text-g-green hover:bg-g-green/10'}`}
                              >
                                {isLoading ? '...' : 'Generer'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              <p className="text-[9px] text-g-muted/40">
                Basert på partner_content_log og partner_proposals · siste 90 dager
              </p>
            </div>
          )}

          {/* Partner Report display */}
          {reportError && (
            <div className="bg-red-900/10 border border-red-400/20 rounded-lg p-4">
              <p className="text-xs text-red-400">Rapport feilet: {reportError}</p>
            </div>
          )}
          {partnerReport && (
            <PartnerReportView
              report={partnerReport}
              onClose={() => { setPartnerReport(null); setSelectedPartner(null); }}
            />
          )}

          {/* AI Memory info */}
          {data.contentStats.aiMemoryStreams > 0 && (
            <p className="text-[10px] text-g-muted/50 text-right">
              Analyse basert på {data.contentStats.aiMemoryStreams} streams i AI Memory · {data.contentStats.streamsHistorikk} streams i historikk
            </p>
          )}
        </>
      )}
    </div>
  );
}
