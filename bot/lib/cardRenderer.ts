/**
 * PERSONA CARDS — Premium Trading Card Renderer
 *
 * Design reference: full TCG layout with bordered dark panels.
 *
 * Structure (top → bottom):
 *   HDR  0–70px    : Header bar  (rarity · GLENVEX · #card)
 *   TTL  70–194px  : Title section (THE CHATTY NINJA / Message Whisperer)
 *   MET  194–244px : Meta bar (joined · archetype)
 *   ART  244–820px : Character art window (AI image shows through)
 *   LXP  820–936px : Level + XP panel
 *   STA  944–1120px: Stats (3 individual colored panels)
 *   BMV  1128–1328px: Badges | Signature Move (side by side)
 *   QOT  1336–1436px: Quote / flavor text
 *   FTR  1444–1536px: Footer bar (player · lv+xp · season)
 */

import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { MemberProfile } from './memberTracker';
import type { PersonaCard, PersonaRarity, PersonaStats } from './personaService';
import { loadPersonaImage } from './imageLoader';

// ── Dimensions ────────────────────────────────────────────────────────────────
const W        = 1024;
const H        = 1536;
const CORNER_R = 24;
const OP       = 8;    // outer padding — gap from card edge to panel edge
const IP       = 18;   // inner padding inside panels
const PR       = 10;   // panel corner radius
const PW       = W - OP * 2;   // panel width: 1008
const GAP      = 8;    // gap between sections

// ── Section Y + H positions ───────────────────────────────────────────────────
const HDR_Y = 0;    const HDR_H = 70;
const TTL_Y = 70;   const TTL_H = 124;
const MET_Y = 194;  const MET_H = 50;
// character art window: 244 → 820
const DAT_Y = 820;  // data panels start here
const LXP_H = 116;
const STA_H = 176;
const BMV_H = 200;
const QOT_H = 100;
const FTR_H = 92;
// total data: 116+8+176+8+200+8+100+8+92 = 716  →  820+716 = 1536 ✓

// ── Rarity accent palette ─────────────────────────────────────────────────────
interface RarityAccent { accent: string; glow: string; dim: string; text: string; bg: string; }

const ACCENT: Record<PersonaRarity, RarityAccent> = {
  Common:    { accent: '#b0b8d0', glow: 'rgba(176,184,208,0.65)', dim: '#5a6080', text: '#8090b0', bg: '#10101a' },
  Rare:      { accent: '#42a5f5', glow: 'rgba(66,165,245,0.70)',  dim: '#1565c0', text: '#7ab8ee', bg: '#040d1e' },
  Epic:      { accent: '#e040fb', glow: 'rgba(224,64,251,0.75)',  dim: '#8e24aa', text: '#cc88ee', bg: '#0e0330' },
  Legendary: { accent: '#ffd740', glow: 'rgba(255,215,64,0.85)',  dim: '#e65100', text: '#ffe082', bg: '#180f00' },
  Mythic:    { accent: '#ff5252', glow: 'rgba(255,82,82,0.85)',   dim: '#b71c1c', text: '#ffaaaa', bg: '#1a0000' },
};

// Per-stat accent colors (each stat has its own identity)
const STAT_COLOR: Partial<Record<keyof PersonaStats, string>> = {
  community:   '#00e676',
  hype:        '#ff9100',
  chaos:       '#e040fb',
  focus:       '#42a5f5',
  humor:       '#ffee58',
  activity:    '#00bcd4',
  helpfulness: '#66bb6a',
  kreativitet: '#f48fb1',
  loyalitet:   '#ffd740',
  lederskap:   '#ff6f00',
};

// ── Stat metadata ─────────────────────────────────────────────────────────────
const STAT_META: Record<keyof PersonaStats, { label: string; icon: string }> = {
  hype:        { label: 'HYPE',      icon: '▲' },
  chaos:       { label: 'CHAOS',     icon: '◆' },
  community:   { label: 'COMMUNITY', icon: '●' },
  focus:       { label: 'FOCUS',     icon: '◎' },
  humor:       { label: 'HUMOR',     icon: '◉' },
  activity:    { label: 'ACTIVE',    icon: '◇' },
  helpfulness: { label: 'HELP',      icon: '○' },
  kreativitet: { label: 'CREATE',    icon: '✦' },
  loyalitet:   { label: 'LOYAL',     icon: '◈' },
  lederskap:   { label: 'LEADER',    icon: '★' },
};

function topStats(stats: PersonaStats, n = 3) {
  return (Object.entries(stats) as [keyof PersonaStats, number][])
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([key, val]) => ({ ...STAT_META[key], key, value: val }));
}

// ── Canvas helpers ────────────────────────────────────────────────────────────

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  const s = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + s, y);          ctx.lineTo(x + w - s, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + s);
  ctx.lineTo(x + w, y + h - s);  ctx.quadraticCurveTo(x + w, y + h, x + w - s, y + h);
  ctx.lineTo(x + s, y + h);      ctx.quadraticCurveTo(x, y + h, x, y + h - s);
  ctx.lineTo(x, y + s);          ctx.quadraticCurveTo(x, y, x + s, y);
  ctx.closePath();
}

function trunc(ctx: SKRSContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

function wrap2(ctx: SKRSContext2D, text: string, x: number, y: number, maxW: number, lineH: number): number {
  const words = text.split(' ');
  let line = '';
  let lines = 0;
  for (const word of words) {
    const t = line ? `${line} ${word}` : word;
    if (ctx.measureText(t).width > maxW && line) {
      ctx.fillText(trunc(ctx, line, maxW), x, y);
      line = word; y += lineH; lines++;
      if (lines >= 1) { ctx.fillText(trunc(ctx, line, maxW), x, y); return y; }
    } else { line = t; }
  }
  if (line) ctx.fillText(trunc(ctx, line, maxW), x, y);
  return y;
}

// ── Panel primitives ──────────────────────────────────────────────────────────

function drawPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, a: RarityAccent, borderAlpha = 0.55) {
  ctx.save();
  ctx.fillStyle = 'rgba(6,8,18,0.93)';
  roundRect(ctx, x, y, w, h, PR); ctx.fill();
  ctx.shadowColor = a.glow; ctx.shadowBlur = 14;
  ctx.strokeStyle = a.accent + Math.round(borderAlpha * 255).toString(16).padStart(2, '0');
  ctx.lineWidth   = 1.5;
  roundRect(ctx, x, y, w, h, PR); ctx.stroke();
  ctx.restore();
}

function drawColoredPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.save();
  ctx.fillStyle = 'rgba(6,8,18,0.95)';
  roundRect(ctx, x, y, w, h, PR); ctx.fill();
  ctx.shadowColor = color + '88';
  ctx.shadowBlur  = 18;
  ctx.strokeStyle = color + 'cc';
  ctx.lineWidth   = 2;
  roundRect(ctx, x, y, w, h, PR); ctx.stroke();
  ctx.restore();
}

// ── MYSTICAL FALLBACK ─────────────────────────────────────────────────────────

function drawMysticalFallback(ctx: SKRSContext2D, card: PersonaCard, a: RarityAccent) {
  const cx = W / 2;
  const cy = H * 0.33;

  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.9);
  bg.addColorStop(0, a.bg); bg.addColorStop(0.45, '#0c0c14'); bg.addColorStop(1, '#040408');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 560);
  glow.addColorStop(0, a.accent + '88'); glow.addColorStop(0.4, a.accent + '22'); glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  ctx.save(); ctx.globalAlpha = 0.045; ctx.strokeStyle = a.accent; ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 56) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 56) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();

  for (const [r, alpha, lw] of [[200, 0.35, 2.5], [340, 0.2, 1.5], [490, 0.12, 1]] as [number, number, number][]) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = a.accent; ctx.lineWidth = lw;
    ctx.shadowColor = a.glow; ctx.shadowBlur = 20;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }

  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = a.glow; ctx.shadowBlur = 80;
  ctx.font = 'bold 220px sans-serif'; ctx.fillStyle = a.accent; ctx.globalAlpha = 0.85;
  ctx.fillText('?', cx, cy); ctx.restore();

  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 52px sans-serif'; ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.9;
  ctx.fillText(card.class.toUpperCase(), cx, cy + 340); ctx.restore();

  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = '18px sans-serif'; ctx.fillStyle = a.text + '88';
  ctx.fillText('— Card Art Generating —', cx, H * 0.88); ctx.restore();
}

// ── TOP GRADIENTS (blend art into panel zone) ────────────────────────────────

function drawArtGradients(ctx: SKRSContext2D) {
  // Top: fade down from opaque header into art
  const topG = ctx.createLinearGradient(0, MET_Y + MET_H, 0, MET_Y + MET_H + 60);
  topG.addColorStop(0, 'rgba(6,8,18,0.85)');
  topG.addColorStop(1, 'transparent');
  ctx.fillStyle = topG; ctx.fillRect(0, MET_Y + MET_H, W, 60);

  // Bottom: fade art to dark before data panels
  const botG = ctx.createLinearGradient(0, DAT_Y - 100, 0, DAT_Y);
  botG.addColorStop(0, 'transparent');
  botG.addColorStop(1, 'rgba(6,8,18,0.97)');
  ctx.fillStyle = botG; ctx.fillRect(0, DAT_Y - 100, W, 100);
}

// ── HEADER BAR ───────────────────────────────────────────────────────────────
// ★ COMMON  ·  GLENVEX  ·  #00124

function drawHeaderBar(ctx: SKRSContext2D, card: PersonaCard, collectionNumber: number, a: RarityAccent) {
  drawPanel(ctx, OP, HDR_Y, PW, HDR_H, a, 0.6);

  const mid = HDR_Y + HDR_H / 2;
  const cx  = W / 2;

  // Rarity (left)
  const RARITY_STARS: Record<PersonaRarity, string> = {
    Common: '★', Rare: '★★', Epic: '★★★', Legendary: '★★★★', Mythic: '★★★★★',
  };
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = a.accent;
  ctx.shadowColor = a.glow; ctx.shadowBlur = 12;
  ctx.fillText(`${RARITY_STARS[card.rarity]}  ${card.rarity.toUpperCase()}`, OP + IP, mid);
  ctx.restore();

  // Brand (center)
  const community = (process.env.WORKSPACE_ID ?? 'GLENVEX').replace(/-.*/, '').toUpperCase();
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 30px sans-serif'; ctx.fillStyle = '#ffffff';
  ctx.shadowColor = a.glow; ctx.shadowBlur = 22;
  ctx.fillText(`⬡  ${community}  ⬡`, cx, mid);
  ctx.restore();

  // Card number (right)
  ctx.save();
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = a.accent + 'cc';
  ctx.fillText(`#${String(collectionNumber).padStart(5, '0')}`, OP + PW - IP, mid);
  ctx.restore();
}

// ── TITLE SECTION ─────────────────────────────────────────────────────────────
// THE CHATTY NINJA / Message Whisperer

function drawTitleSection(ctx: SKRSContext2D, card: PersonaCard, a: RarityAccent) {
  drawPanel(ctx, OP, TTL_Y, PW, TTL_H, a, 0.5);

  const cx   = W / 2;
  const maxW = PW - IP * 2;

  // Big title
  let px = 72;
  ctx.font = `bold ${px}px sans-serif`;
  const title = card.title.toUpperCase();
  while (ctx.measureText(title).width > maxW && px > 32) { px -= 2; ctx.font = `bold ${px}px sans-serif`; }

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,1)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(trunc(ctx, title, maxW), cx, TTL_Y + 78);
  ctx.shadowColor = a.glow; ctx.shadowBlur = 55; ctx.shadowOffsetY = 0; ctx.globalAlpha = 0.45;
  ctx.fillText(trunc(ctx, title, maxW), cx, TTL_Y + 78);
  ctx.restore();

  // Class subtitle (accent color)
  let cpx = 28;
  const classLabel = card.class.toUpperCase();
  ctx.font = `bold ${cpx}px sans-serif`;
  while (ctx.measureText(classLabel).width > maxW - 40 && cpx > 14) { cpx--; ctx.font = `bold ${cpx}px sans-serif`; }

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = a.glow; ctx.shadowBlur = 20;
  ctx.fillStyle = a.accent;
  ctx.fillText(trunc(ctx, classLabel, maxW - 40), cx, TTL_Y + 112);
  ctx.restore();
}

// ── META BAR ─────────────────────────────────────────────────────────────────
// JOINED date  ·  ARCHETYPE

function drawMetaBar(ctx: SKRSContext2D, card: PersonaCard, member: MemberProfile, a: RarityAccent) {
  drawPanel(ctx, OP, MET_Y, PW, MET_H, a, 0.4);

  const mid = MET_Y + MET_H / 2;

  // Joined date
  const joined = (member as any).joinedAt
    ? new Date((member as any).joinedAt as string)
        .toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : null;

  if (joined) {
    ctx.save();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 17px sans-serif'; ctx.fillStyle = a.text + 'cc';
    ctx.fillText(`◈  JOINED  ${joined}`, OP + IP, mid);
    ctx.restore();
  }

  // Archetype (right)
  ctx.save();
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 17px sans-serif'; ctx.fillStyle = a.accent;
  ctx.shadowColor = a.glow; ctx.shadowBlur = 10;
  ctx.fillText(`${card.archetype.toUpperCase()}  ◈`, OP + PW - IP, mid);
  ctx.restore();
}

// ── LEVEL + XP PANEL ─────────────────────────────────────────────────────────

function drawLevelXP(ctx: SKRSContext2D, member: MemberProfile, a: RarityAccent) {
  const y = DAT_Y;
  drawPanel(ctx, OP, y, PW, LXP_H, a);

  const XPL   = 250;
  const level = Math.floor(member.xp / XPL) + 1;
  const curXP = member.xp - (level - 1) * XPL;
  const pct   = Math.max(0, Math.min(1, curXP / XPL));

  // LEVEL badge box (left)
  const boxW = 108;
  const boxH = LXP_H - 20;
  const boxX = OP + IP;
  const boxY = y + 10;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(ctx, boxX, boxY, boxW, boxH, 8); ctx.fill();
  ctx.strokeStyle = a.accent + 'aa'; ctx.lineWidth = 1.5;
  roundRect(ctx, boxX, boxY, boxW, boxH, 8); ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = a.accent + 'bb';
  ctx.fillText('LEVEL', boxX + boxW / 2, boxY + 22);
  ctx.font = 'bold 48px sans-serif'; ctx.fillStyle = '#ffffff';
  ctx.shadowColor = a.glow; ctx.shadowBlur = 22;
  ctx.fillText(String(level), boxX + boxW / 2, boxY + boxH - 6);
  ctx.restore();

  // XP section (right of level box)
  const barX = boxX + boxW + 16;
  const barW = PW - IP - boxW - 16 - IP;
  const mid  = y + LXP_H / 2;

  // XP label + numbers
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = a.accent;
  ctx.fillText('XP', barX, mid - 16);
  ctx.font = '17px sans-serif'; ctx.fillStyle = a.text + 'bb';
  ctx.fillText(`  ${curXP.toLocaleString('no')} / ${(level * XPL).toLocaleString('no')}`, barX + 28, mid - 16);
  ctx.restore();

  // Track
  const bY = mid + 4;
  const bH = 28;
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  roundRect(ctx, barX, bY, barW, bH, bH / 2); ctx.fill();

  // Fill
  const fw = Math.max(bH, barW * pct);
  const fg = ctx.createLinearGradient(barX, 0, barX + fw, 0);
  fg.addColorStop(0, ACCENT[member.xp < 250 ? 'Common' : 'Rare'].dim);
  fg.addColorStop(0.55, a.accent);
  fg.addColorStop(1, '#ffffff');
  ctx.save();
  ctx.shadowColor = a.glow; ctx.shadowBlur = 18;
  ctx.fillStyle = fg;
  roundRect(ctx, barX, bY, fw, bH, bH / 2); ctx.fill();
  ctx.restore();
}

// ── STATS GRID (3 colored bordered panels) ────────────────────────────────────

function drawStatsGrid(ctx: SKRSContext2D, stats: PersonaStats, a: RarityAccent) {
  const y    = DAT_Y + LXP_H + GAP;
  const gapX = 8;
  const colW = Math.floor((PW - gapX * 2) / 3);

  topStats(stats, 3).forEach((stat, i) => {
    const sx     = OP + i * (colW + gapX);
    const sColor = STAT_COLOR[stat.key as keyof PersonaStats] ?? a.accent;

    drawColoredPanel(ctx, sx, y, colW, STA_H, sColor);

    const cx = sx + colW / 2;

    // Icon
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 28px sans-serif'; ctx.fillStyle = sColor + 'cc';
    ctx.fillText(stat.icon, cx, y + 44);
    ctx.restore();

    // Big number
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = sColor + 'bb'; ctx.shadowBlur = 32;
    ctx.font = 'bold 86px sans-serif'; ctx.fillStyle = '#ffffff';
    ctx.fillText(String(stat.value), cx, y + 140);
    ctx.restore();

    // Stat label
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = sColor + '66'; ctx.shadowBlur = 8;
    ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = sColor;
    ctx.fillText(stat.label, cx, y + 164);
    ctx.restore();
  });
}

// ── BADGES + SIGNATURE MOVE (side by side) ───────────────────────────────────

function drawBadgesAndMove(ctx: SKRSContext2D, member: MemberProfile, card: PersonaCard, a: RarityAccent) {
  const y    = DAT_Y + LXP_H + GAP + STA_H + GAP;
  const gapX = 8;
  const bdgW = Math.floor((PW - gapX) * 0.56);
  const mvW  = PW - bdgW - gapX;
  const bx   = OP;
  const mx   = OP + bdgW + gapX;

  // ── Badges panel ──────────────────────────────────────────────────────────
  drawPanel(ctx, bx, y, bdgW, BMV_H, a);

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 15px sans-serif'; ctx.fillStyle = a.accent + 'cc';
  ctx.fillText('BADGES', bx + bdgW / 2, y + 22);
  ctx.restore();

  const badges = member.badges.slice(0, 5);
  if (badges.length === 0) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'italic 16px sans-serif'; ctx.fillStyle = a.text + '55';
    ctx.fillText('No badges yet', bx + bdgW / 2, y + BMV_H / 2);
    ctx.restore();
  } else {
    const availW = bdgW - IP * 2;
    const circD  = Math.min(52, Math.floor((availW - (badges.length - 1) * 8) / badges.length));
    const circR  = circD / 2;
    const bcy    = y + 38 + circR;
    let   bsx    = bx + IP + circR;

    for (const badge of badges) {
      // Circle
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath(); ctx.arc(bsx, bcy, circR, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = a.glow; ctx.shadowBlur = 14;
      ctx.strokeStyle = a.accent + 'cc'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bsx, bcy, circR, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();

      // 2-char initials inside circle
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `bold ${Math.round(circR * 0.75)}px sans-serif`;
      ctx.fillStyle = a.accent;
      ctx.shadowColor = a.glow; ctx.shadowBlur = 10;
      ctx.fillText(badge.slice(0, 2).toUpperCase(), bsx, bcy);
      ctx.restore();

      // Label below
      const lbl = (badge.length > 10 ? badge.slice(0, 8) + '…' : badge).toUpperCase();
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = `bold ${Math.max(10, Math.round(circR * 0.38))}px sans-serif`;
      ctx.fillStyle = a.text + 'aa';
      ctx.fillText(lbl, bsx, bcy + circR + 14);
      ctx.restore();

      bsx += circD + 8;
    }
  }

  // ── Signature move panel ──────────────────────────────────────────────────
  drawPanel(ctx, mx, y, mvW, BMV_H, a);

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 15px sans-serif'; ctx.fillStyle = a.accent + 'cc';
  ctx.fillText('SIGNATURE MOVE', mx + mvW / 2, y + 22);
  ctx.restore();

  // Move name
  const moveName = `◆  ${card.signatureMove.toUpperCase()}`;
  const mvMaxW   = mvW - IP * 2;
  let mpx = 24;
  ctx.font = `bold ${mpx}px sans-serif`;
  while (ctx.measureText(moveName).width > mvMaxW && mpx > 13) { mpx--; ctx.font = `bold ${mpx}px sans-serif`; }

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = a.glow; ctx.shadowBlur = 18;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(trunc(ctx, moveName, mvMaxW), mx + mvW / 2, y + 62);
  ctx.restore();

  // Move description
  if (card.signatureMoveDesc) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = 'italic 16px sans-serif'; ctx.fillStyle = a.text + 'bb';
    wrap2(ctx, card.signatureMoveDesc, mx + mvW / 2, y + 92, mvMaxW, 21);
    ctx.restore();
  }
}

// ── QUOTE / FLAVOR TEXT ───────────────────────────────────────────────────────

function drawQuote(ctx: SKRSContext2D, card: PersonaCard, a: RarityAccent) {
  const y = DAT_Y + LXP_H + GAP + STA_H + GAP + BMV_H + GAP;
  drawPanel(ctx, OP, y, PW, QOT_H, a, 0.4);

  const text = card.flavorText || card.quote || '';
  if (!text) return;

  const cx = W / 2;

  // Decorative opening quote mark
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 56px sans-serif'; ctx.fillStyle = a.accent + '44';
  ctx.fillText('“', OP + IP, y + 60);
  ctx.restore();

  // Text
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'italic 20px sans-serif'; ctx.fillStyle = '#e0e0e0';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
  wrap2(ctx, text, cx, y + 44, PW - IP * 2 - 56, 24);
  ctx.restore();

  // Closing quote
  ctx.save();
  ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 56px sans-serif'; ctx.fillStyle = a.accent + '44';
  ctx.fillText('”', OP + PW - IP, y + 88);
  ctx.restore();
}

// ── FOOTER BAR ────────────────────────────────────────────────────────────────

function drawFooterBar(ctx: SKRSContext2D, member: MemberProfile, collectionNumber: number, a: RarityAccent) {
  const y = DAT_Y + LXP_H + GAP + STA_H + GAP + BMV_H + GAP + QOT_H + GAP;
  drawPanel(ctx, OP, y, PW, FTR_H, a, 0.38);

  const mid    = y + FTR_H / 2;
  const XPL    = 250;
  const level  = Math.floor(member.xp / XPL) + 1;
  const name   = (member.displayName || member.username).toUpperCase();
  const season = process.env.PERSONA_SEASON ?? '1';

  // Left: player name
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = a.text + 'bb';
  ctx.fillText(`◈  ${trunc(ctx, name, 220)}`, OP + IP, mid);
  ctx.restore();

  // Center: LV · XP
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = '#d0d0d0';
  ctx.fillText(`LV ${level}  ·  ${member.xp.toLocaleString('no')} XP`, W / 2, mid);
  ctx.restore();

  // Right: season
  ctx.save();
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = a.text + 'bb';
  ctx.fillText(`SEASON ${season}`, OP + PW - IP, mid);
  ctx.restore();
}

// ── CARD EDGE ─────────────────────────────────────────────────────────────────

function drawCardEdge(ctx: SKRSContext2D, a: RarityAccent) {
  ctx.save();
  ctx.shadowColor = a.glow; ctx.shadowBlur = 32;
  ctx.strokeStyle = a.accent + 'cc'; ctx.lineWidth = 3.5;
  roundRect(ctx, 5, 5, W - 10, H - 10, CORNER_R); ctx.stroke();
  ctx.restore();
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────

export async function renderPersonaCard(
  card: PersonaCard,
  fullCardImage: string | Buffer | null,
  member: MemberProfile,
  collectionNumber: number,
  _avatarUrl?: string | null,
): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d') as SKRSContext2D;
  const a      = ACCENT[card.rarity];

  // 1. Clip to rounded card shape
  ctx.save();
  roundRect(ctx, 0, 0, W, H, CORNER_R);
  ctx.clip();

  // 2. AI art fills the full canvas (or mystical fallback)
  let aiLoaded = false;
  if (fullCardImage) {
    try {
      const { img } = await loadPersonaImage(fullCardImage, '[cardRenderer]');
      const scale   = Math.max(W / img.width, H / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      aiLoaded = true;
    } catch (e: any) {
      console.error('[cardRenderer] loadPersonaImage failed — using mystical fallback:', e?.message ?? e);
    }
  }
  if (!aiLoaded) drawMysticalFallback(ctx, card, a);

  // 3. Art gradients (fade into top/bottom panel zones)
  drawArtGradients(ctx);

  // 4. Top panels: Header · Title · Meta
  drawHeaderBar(ctx, card, collectionNumber, a);
  drawTitleSection(ctx, card, a);
  drawMetaBar(ctx, card, member, a);

  // 5. Bottom data panels
  drawLevelXP(ctx, member, a);
  drawStatsGrid(ctx, card.stats, a);
  drawBadgesAndMove(ctx, member, card, a);
  drawQuote(ctx, card, a);
  drawFooterBar(ctx, member, collectionNumber, a);

  ctx.restore(); // end clip

  // 6. Card border (outside clip — always sharp corners)
  drawCardEdge(ctx, a);

  return canvas.toBuffer('image/png');
}
