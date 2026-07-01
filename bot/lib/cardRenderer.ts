/**
 * PERSONA CARDS — Premium Canvas Overlay
 *
 * gpt-image-1 generates the full art (character + frame + atmosphere).
 * This module overlays dynamic data only — the AI art is never touched.
 *
 * Layout:
 *   TOP  0–155px : Header (rarity + community + class title)
 *   MID           : Character art (untouched)
 *   BOT  820–end  : Data panel (gradient into dark + all stats/text)
 */

import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { MemberProfile } from './memberTracker';
import type { PersonaCard, PersonaRarity, PersonaStats } from './personaService';
import { loadPersonaImage } from './imageLoader';

// ── Dimensions ────────────────────────────────────────────────────────────────
const W        = 1024;
const H        = 1536;
const CORNER_R = 28;
const PAD      = 52;   // horizontal padding

// Data panel constants
const PANEL_Y  = 820;  // gradient starts
const TITLE_Y  = 980;  // card title baseline
const CLASS_Y  = 1042; // class subtitle baseline
const DIV1_Y   = 1068; // first divider
const STATS_Y  = 1090; // stat grid top
const DIV2_Y   = 1290; // second divider
const FLAVOR_Y = 1315; // flavor text
const DIV3_Y   = 1388; // third divider
const BADGE_Y  = 1408; // badges row
const PLAYER_Y = 1468; // player name + level (small)
const FOOT_Y   = 1516; // footer baseline

// ── Rarity accent palette ─────────────────────────────────────────────────────
interface RarityAccent { accent: string; glow: string; dim: string; text: string; bg: string; }

const ACCENT: Record<PersonaRarity, RarityAccent> = {
  Common:    { accent: '#b0b8d0', glow: 'rgba(176,184,208,0.65)', dim: '#5a6080', text: '#8090b0', bg: '#10101a' },
  Rare:      { accent: '#42a5f5', glow: 'rgba(66,165,245,0.70)',  dim: '#1565c0', text: '#7ab8ee', bg: '#040d1e' },
  Epic:      { accent: '#e040fb', glow: 'rgba(224,64,251,0.75)',  dim: '#8e24aa', text: '#cc88ee', bg: '#0e0330' },
  Legendary: { accent: '#ffd740', glow: 'rgba(255,215,64,0.85)',  dim: '#e65100', text: '#ffe082', bg: '#180f00' },
  Mythic:    { accent: '#ff5252', glow: 'rgba(255,82,82,0.85)',   dim: '#b71c1c', text: '#ffaaaa', bg: '#1a0000' },
};

const RARITY_HEADER: Record<PersonaRarity, string> = {
  Common:    '◆  C O M M O N  ◆',
  Rare:      '◈  R A R E  ◈',
  Epic:      '⬡  E P I C  ⬡',
  Legendary: '✦  L E G E N D A R Y  ✦',
  Mythic:    '⚡  M Y T H I C  ⚡',
};

// ── Stat metadata ─────────────────────────────────────────────────────────────
// Uses BMP Unicode geometric shapes — renders correctly on any platform
// without requiring emoji fonts (avoids □ boxes on Linux / canvas renderers).
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
    .map(([key, val]) => ({ ...STAT_META[key], value: val }));
}

// ── Canvas helpers ────────────────────────────────────────────────────────────

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  const s = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + s, y);
  ctx.lineTo(x + w - s, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + s);
  ctx.lineTo(x + w, y + h - s);
  ctx.quadraticCurveTo(x + w, y + h, x + w - s, y + h);
  ctx.lineTo(x + s, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - s);
  ctx.lineTo(x, y + s);
  ctx.quadraticCurveTo(x, y, x + s, y);
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

function accentLine(ctx: SKRSContext2D, y: number, a: RarityAccent, alpha = 0.6) {
  const lg = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  lg.addColorStop(0,    'transparent');
  lg.addColorStop(0.12, a.accent + Math.round(alpha * 255).toString(16).padStart(2, '0'));
  lg.addColorStop(0.5,  a.accent + Math.round(alpha * 255 * 1.3).toString(16).padStart(2, '0'));
  lg.addColorStop(0.88, a.accent + Math.round(alpha * 255).toString(16).padStart(2, '0'));
  lg.addColorStop(1,    'transparent');
  ctx.save();
  ctx.strokeStyle = lg;
  ctx.lineWidth   = 1.5;
  ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
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
  ctx.shadowColor = a.glow; ctx.shadowBlur = 20;
  ctx.font = 'bold 52px sans-serif'; ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.9;
  ctx.fillText(card.class.toUpperCase(), cx, cy + 340); ctx.restore();

  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = '18px sans-serif'; ctx.fillStyle = a.text + '88'; ctx.globalAlpha = 1;
  ctx.fillText('— Card Art Generating —', cx, H * 0.88); ctx.restore();
}

// ── HEADER (top overlay) ─────────────────────────────────────────────────────
// Rarity · Community brand · Card class — always visible, even in thumbnails.

function drawHeader(ctx: SKRSContext2D, card: PersonaCard, a: RarityAccent) {
  // Background gradient (top dark fade)
  const bg = ctx.createLinearGradient(0, 0, 0, 175);
  bg.addColorStop(0,   'rgba(0,0,0,0.94)');
  bg.addColorStop(0.65, 'rgba(0,0,0,0.70)');
  bg.addColorStop(1,   'transparent');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, 175);

  const cx = W / 2;

  // Rarity label — large, spaced, accent colored
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = a.glow; ctx.shadowBlur = 30;
  ctx.font      = 'bold 34px sans-serif';
  ctx.fillStyle = a.accent;
  ctx.fillText(RARITY_HEADER[card.rarity], cx, 36);
  ctx.restore();

  // Community brand — bold white, large
  const community = (process.env.WORKSPACE_ID ?? 'GLENVEX').replace(/-.*/, '').toUpperCase();
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 16;
  ctx.font      = 'bold 52px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(community, cx, 88);
  ctx.restore();

  // Card class — accent color, uppercase
  const classLabel = card.class.toUpperCase();
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 10;
  ctx.font      = '28px sans-serif';
  ctx.fillStyle = a.accent;
  let px = 28;
  while (ctx.measureText(classLabel).width > W - PAD * 2 && px > 18) { px--; ctx.font = `${px}px sans-serif`; }
  ctx.fillText(trunc(ctx, classLabel, W - PAD * 2), cx, 132);
  ctx.restore();

  // Decorative line under header
  accentLine(ctx, 155, a, 0.5);
}

// ── DATA PANEL BACKGROUND ─────────────────────────────────────────────────────

function drawPanelBackground(ctx: SKRSContext2D, a: RarityAccent) {
  const g = ctx.createLinearGradient(0, PANEL_Y - 80, 0, H);
  g.addColorStop(0,    'transparent');
  g.addColorStop(0.12, 'rgba(0,0,0,0.40)');
  g.addColorStop(0.30, 'rgba(0,0,0,0.78)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.92)');
  g.addColorStop(1,    'rgba(0,0,0,0.97)');
  ctx.fillStyle = g;
  ctx.fillRect(0, PANEL_Y - 80, W, H - (PANEL_Y - 80));

  // Subtle rarity tint at bottom
  const tint = ctx.createLinearGradient(0, H - 200, 0, H);
  tint.addColorStop(0, 'transparent');
  tint.addColorStop(1, a.accent + '12');
  ctx.fillStyle = tint;
  ctx.fillRect(0, H - 200, W, 200);
}

// ── TITLE + CLASS ─────────────────────────────────────────────────────────────

function drawTitle(ctx: SKRSContext2D, card: PersonaCard, a: RarityAccent) {
  const cx   = W / 2;
  const maxW = W - PAD * 2;

  // Card title — large bold white
  let px = 72;
  ctx.font = `bold ${px}px sans-serif`;
  const title = card.title.toUpperCase();
  while (ctx.measureText(title).width > maxW && px > 36) { px -= 2; ctx.font = `bold ${px}px sans-serif`; }

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,1)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(trunc(ctx, title, maxW), cx, TITLE_Y);
  ctx.shadowColor = a.glow; ctx.shadowBlur = 60; ctx.shadowOffsetY = 0; ctx.globalAlpha = 0.45;
  ctx.fillText(trunc(ctx, title, maxW), cx, TITLE_Y);
  ctx.restore();

  // Class subtitle — accent, uppercase
  let cpx = 30;
  const classLabel = card.class.toUpperCase();
  ctx.font = `bold ${cpx}px sans-serif`;
  while (ctx.measureText(classLabel).width > maxW - 40 && cpx > 18) { cpx--; ctx.font = `bold ${cpx}px sans-serif`; }

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = a.glow; ctx.shadowBlur = 22;
  ctx.fillStyle = a.accent;
  ctx.fillText(trunc(ctx, classLabel, maxW - 40), cx, CLASS_Y);
  ctx.restore();
}

// ── TOP 3 STATS GRID (3 columns) ─────────────────────────────────────────────

function drawStatsGrid(ctx: SKRSContext2D, stats: PersonaStats, a: RarityAccent) {
  const rows  = topStats(stats, 3);
  const colW  = (W - PAD * 2) / 3;

  accentLine(ctx, STATS_Y - 6, a, 0.4);

  rows.forEach((stat, i) => {
    const cx = PAD + colW * i + colW / 2;

    // Big number
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = a.glow; ctx.shadowBlur = 36;
    ctx.font      = 'bold 72px sans-serif';
    ctx.fillStyle = a.accent;
    ctx.fillText(String(stat.value), cx, STATS_Y + 90);
    ctx.restore();

    // Icon + label below number
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 8;
    ctx.font      = 'bold 20px sans-serif';
    ctx.fillStyle = a.text;
    ctx.fillText(`${stat.icon}  ${stat.label}`, cx, STATS_Y + 122);
    ctx.restore();

    // Subtle vertical divider between columns
    if (i < 2) {
      const dx = PAD + colW * (i + 1);
      ctx.save();
      ctx.strokeStyle = a.accent + '30';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(dx, STATS_Y + 8);
      ctx.lineTo(dx, STATS_Y + 140);
      ctx.stroke();
      ctx.restore();
    }
  });
}

// ── BADGES ────────────────────────────────────────────────────────────────────

function drawBadges(ctx: SKRSContext2D, member: MemberProfile, a: RarityAccent) {
  if (member.badges.length === 0) return;

  const SHOW   = 4;
  const badges = member.badges.slice(0, SHOW);
  const extra  = member.badges.length - SHOW;
  const BH     = 52;
  const BPAD   = 20;
  const GAP    = 12;

  ctx.font = 'bold 18px sans-serif';
  const dims = badges.map(b => {
    const lbl = b.length > 14 ? b.slice(0, 12) + '…' : b;
    return { lbl, w: Math.max(88, ctx.measureText(lbl).width + BPAD * 2) };
  });

  let totalW = dims.reduce((s, d) => s + d.w + GAP, -GAP);
  if (extra > 0) totalW += 60 + GAP;
  let bx = Math.max(PAD, (W - totalW) / 2);

  accentLine(ctx, BADGE_Y - 14, a, 0.4);

  for (const { lbl, w } of dims) {
    const bg = ctx.createLinearGradient(bx, BADGE_Y, bx, BADGE_Y + BH);
    bg.addColorStop(0, a.accent + '38'); bg.addColorStop(1, a.accent + '14');
    ctx.fillStyle = bg;
    roundRect(ctx, bx, BADGE_Y, w, BH, BH / 2); ctx.fill();

    ctx.save();
    ctx.shadowColor = a.glow; ctx.shadowBlur = 14;
    ctx.strokeStyle = a.accent + 'dd'; ctx.lineWidth = 2;
    roundRect(ctx, bx, BADGE_Y, w, BH, BH / 2); ctx.stroke();
    ctx.restore();

    ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = a.glow; ctx.shadowBlur = 10;
    ctx.fillText(lbl, bx + w / 2, BADGE_Y + BH / 2);
    bx += w + GAP;
  }

  if (extra > 0) {
    const mw = 60;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    roundRect(ctx, bx, BADGE_Y, mw, BH, BH / 2); ctx.fill();
    ctx.strokeStyle = a.accent + '66'; ctx.lineWidth = 1.5;
    roundRect(ctx, bx, BADGE_Y, mw, BH, BH / 2); ctx.stroke();
    ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = a.text;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`+${extra}`, bx + mw / 2, BADGE_Y + BH / 2);
  }
}

// ── SIGNATURE MOVE + FLAVOR TEXT ─────────────────────────────────────────────

function drawFlavor(ctx: SKRSContext2D, card: PersonaCard, a: RarityAccent) {
  accentLine(ctx, FLAVOR_Y - 12, a, 0.32);

  const cx   = W / 2;
  const maxW = W - PAD * 2 - 20;

  // Signature move label
  if (card.signatureMove) {
    const ultLabel = `◆  ${card.signatureMove.toUpperCase()}`;
    let px = 26;
    ctx.font = `bold ${px}px sans-serif`;
    while (ctx.measureText(ultLabel).width > maxW && px > 16) { px--; ctx.font = `bold ${px}px sans-serif`; }
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = a.glow; ctx.shadowBlur = 20;
    ctx.fillStyle   = a.accent;
    ctx.fillText(trunc(ctx, ultLabel, maxW), cx, FLAVOR_Y + 24);
    ctx.restore();
  }

  // Flavor / lore text (italic, below signature move)
  if (card.flavorText) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font      = 'italic 22px sans-serif';
    ctx.fillStyle = a.text + 'aa';
    wrap2(ctx, `"${card.flavorText}"`, cx, FLAVOR_Y + 58, maxW, 28);
    ctx.restore();
  }
}

// ── PLAYER INFO (small, below badges) ────────────────────────────────────────

function drawPlayerInfo(ctx: SKRSContext2D, member: MemberProfile, a: RarityAccent) {
  const cx      = W / 2;
  const XPL     = 250;
  const level   = Math.floor(member.xp / XPL) + 1;
  const name    = (member.displayName || member.username).toUpperCase();
  const label   = `${name}  ·  LV ${level}  ·  ${member.xp} XP`;

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font      = 'bold 20px sans-serif';
  ctx.fillStyle = a.text + 'aa';
  ctx.fillText(trunc(ctx, label, W - PAD * 2), cx, PLAYER_Y);
  ctx.restore();
}

// ── FOOTER ────────────────────────────────────────────────────────────────────

function drawFooter(ctx: SKRSContext2D, collectionNumber: number, a: RarityAccent) {
  accentLine(ctx, FOOT_Y - 16, a, 0.25);

  const season = process.env.PERSONA_SEASON ?? '1';
  const text   = `Card #${String(collectionNumber).padStart(3, '0')}  ·  Season ${season}  ·  GLENVEX PERSONA`;

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = '17px sans-serif'; ctx.fillStyle = a.accent + '77';
  ctx.fillText(trunc(ctx, text, W - PAD * 2), W / 2, FOOT_Y);
  ctx.restore();
}

// ── CARD EDGE ─────────────────────────────────────────────────────────────────

function drawCardEdge(ctx: SKRSContext2D, a: RarityAccent) {
  ctx.save();
  ctx.shadowColor = a.glow; ctx.shadowBlur = 30;
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

  // ─ 1. Clip to rounded card ─────────────────────────────────────────────────
  ctx.save();
  roundRect(ctx, 0, 0, W, H, CORNER_R);
  ctx.clip();

  // ─ 2. AI art or mystical fallback ─────────────────────────────────────────
  let aiLoaded = false;

  if (fullCardImage) {
    try {
      const { img } = await loadPersonaImage(fullCardImage, '[cardRenderer]');
      const scale   = Math.max(W / img.width, H / img.height);
      const dw      = img.width  * scale;
      const dh      = img.height * scale;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      aiLoaded = true;
    } catch (e: any) {
      console.error('[cardRenderer] loadPersonaImage failed — using mystical fallback:', e?.message ?? e);
      console.error(e?.stack);
    }
  }

  if (!aiLoaded) drawMysticalFallback(ctx, card, a);

  // ─ 3. Header overlay (top) ────────────────────────────────────────────────
  drawHeader(ctx, card, a);

  // ─ 4. Data panel background (bottom) ─────────────────────────────────────
  drawPanelBackground(ctx, a);

  // ─ 5. Title + class ───────────────────────────────────────────────────────
  drawTitle(ctx, card, a);

  // ─ 6. Top 3 stats grid ────────────────────────────────────────────────────
  drawStatsGrid(ctx, card.stats, a);

  // ─ 7. Signature move + flavor ─────────────────────────────────────────────
  drawFlavor(ctx, card, a);

  // ─ 8. Badges ──────────────────────────────────────────────────────────────
  drawBadges(ctx, member, a);

  // ─ 9. Player name + level ─────────────────────────────────────────────────
  drawPlayerInfo(ctx, member, a);

  // ─ 10. Footer ─────────────────────────────────────────────────────────────
  drawFooter(ctx, collectionNumber, a);

  ctx.restore(); // end clip

  // ─ 12. Card border (drawn outside clip so corners are always sharp) ───────
  drawCardEdge(ctx, a);

  return canvas.toBuffer('image/png');
}
