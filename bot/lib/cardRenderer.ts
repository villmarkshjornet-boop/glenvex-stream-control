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
const PANEL_Y  = 820;  // gradient starts (transparent→dark)
const NAME_Y   = 958;  // name baseline
const XP_Y     = 1005; // XP section top
const STATS_Y  = 1128; // stats section top (after XP bar + labels)
const BADGE_Y  = 1318; // badge row top (3 stats × 60px = 180px → 1128+180+10=1318)
const ULT_Y    = 1378; // ultimate section top (badges 40px + 20px gap)
const FLAVOR_Y = 1448; // flavor text top (ultimate 22+20+gap)
const FOOT_Y   = 1515; // footer baseline

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

// ── NAME ──────────────────────────────────────────────────────────────────────

function drawName(ctx: SKRSContext2D, displayName: string, a: RarityAccent) {
  const maxW = W - PAD * 2;
  let px = 84;
  ctx.font = `bold ${px}px sans-serif`;
  const name = displayName.toUpperCase();
  while (ctx.measureText(name).width > maxW && px > 40) { px -= 2; ctx.font = `bold ${px}px sans-serif`; }

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  // Black drop shadow
  ctx.shadowColor = 'rgba(0,0,0,1)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(trunc(ctx, name, maxW), W / 2, NAME_Y);
  // Rarity glow pass
  ctx.shadowColor = a.glow; ctx.shadowBlur = 50; ctx.shadowOffsetY = 0; ctx.globalAlpha = 0.55;
  ctx.fillText(trunc(ctx, name, maxW), W / 2, NAME_Y);
  ctx.restore();
}

// ── XP BAR ────────────────────────────────────────────────────────────────────

function drawXP(ctx: SKRSContext2D, member: MemberProfile, a: RarityAccent) {
  const XPL   = 250;
  const level = Math.floor(member.xp / XPL) + 1;
  const curXP = member.xp - (level - 1) * XPL;
  const pct   = Math.max(0, Math.min(1, curXP / XPL));

  const y  = XP_Y;
  const BW = W - PAD * 2;
  const BH = 28;

  // LEVEL label
  ctx.save();
  ctx.font = 'bold 24px sans-serif'; ctx.fillStyle = a.accent;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = a.glow; ctx.shadowBlur = 14;
  ctx.fillText(`LEVEL ${level}`, PAD, y + 22);
  ctx.restore();

  // XP counter
  ctx.save();
  ctx.font = '18px sans-serif'; ctx.fillStyle = a.text + 'bb';
  ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${curXP} / ${XPL} XP`, W - PAD, y + 22);
  ctx.restore();

  // Track
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, PAD, y + 34, BW, BH, BH / 2);
  ctx.fill();

  // Fill gradient
  const fw = Math.max(BH, BW * pct);
  const fg = ctx.createLinearGradient(PAD, 0, PAD + fw, 0);
  fg.addColorStop(0,   a.dim);
  fg.addColorStop(0.6, a.accent);
  fg.addColorStop(1,   '#ffffff');
  ctx.save();
  ctx.shadowColor = a.glow; ctx.shadowBlur = 22;
  ctx.fillStyle   = fg;
  roundRect(ctx, PAD, y + 34, fw, BH, BH / 2);
  ctx.fill();
  ctx.restore();
}

// ── TOP 3 STATS ───────────────────────────────────────────────────────────────

function drawStats(ctx: SKRSContext2D, stats: PersonaStats, a: RarityAccent) {
  const rows = topStats(stats, 3);
  const BW   = W - PAD * 2;
  const BH   = 22;

  let y = STATS_Y;
  accentLine(ctx, y - 16, a, 0.45);

  for (const stat of rows) {
    // Row: [icon] LABEL (left)    [value] (right)
    ctx.save();
    ctx.font      = 'bold 26px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
    const labelText = `${stat.icon}  ${stat.label}`;
    ctx.fillText(labelText, PAD, y);
    ctx.restore();

    // Value (right aligned, accent color, large)
    ctx.save();
    ctx.font      = 'bold 30px sans-serif';
    ctx.fillStyle = a.accent;
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = a.glow; ctx.shadowBlur = 18;
    ctx.fillText(String(stat.value), W - PAD, y);
    ctx.restore();

    // Bar track
    const barY = y + 10;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    roundRect(ctx, PAD, barY, BW, BH, BH / 2);
    ctx.fill();

    // Bar fill
    const fw = Math.max(BH, BW * (stat.value / 100));
    const fg = ctx.createLinearGradient(PAD, 0, PAD + fw, 0);
    fg.addColorStop(0,   a.dim);
    fg.addColorStop(0.5, a.accent);
    fg.addColorStop(1,   '#ffffff');
    ctx.save();
    ctx.shadowColor = a.glow; ctx.shadowBlur = 16;
    ctx.fillStyle   = fg;
    roundRect(ctx, PAD, barY, fw, BH, BH / 2);
    ctx.fill();
    ctx.restore();

    y += 60; // next stat row
  }
}

// ── BADGES ────────────────────────────────────────────────────────────────────

function drawBadges(ctx: SKRSContext2D, member: MemberProfile, a: RarityAccent) {
  if (member.badges.length === 0) return;

  const SHOW   = 4; // max 4 badges shown
  const badges = member.badges.slice(0, SHOW);
  const extra  = member.badges.length - SHOW;
  const BH     = 40;
  const BPAD   = 16;
  const GAP    = 10;

  ctx.font = 'bold 15px sans-serif';
  const dims = badges.map(b => {
    const lbl = b.length > 14 ? b.slice(0, 12) + '…' : b;
    return { lbl, w: Math.max(72, ctx.measureText(lbl).width + BPAD * 2) };
  });

  let totalW = dims.reduce((s, d) => s + d.w + GAP, -GAP);
  if (extra > 0) totalW += 52 + GAP;
  let bx = Math.max(PAD, (W - totalW) / 2);

  accentLine(ctx, BADGE_Y - 14, a, 0.4);

  for (const { lbl, w } of dims) {
    // Badge pill background
    const bg = ctx.createLinearGradient(bx, BADGE_Y, bx, BADGE_Y + BH);
    bg.addColorStop(0, a.accent + '28'); bg.addColorStop(1, a.accent + '10');
    ctx.fillStyle = bg;
    roundRect(ctx, bx, BADGE_Y, w, BH, BH / 2); ctx.fill();

    // Border
    ctx.save();
    ctx.shadowColor = a.glow; ctx.shadowBlur = 10;
    ctx.strokeStyle = a.accent + 'cc'; ctx.lineWidth = 1.5;
    roundRect(ctx, bx, BADGE_Y, w, BH, BH / 2); ctx.stroke();
    ctx.restore();

    // Label
    ctx.font = 'bold 15px sans-serif'; ctx.fillStyle = a.accent;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(lbl, bx + w / 2, BADGE_Y + BH / 2);
    bx += w + GAP;
  }

  if (extra > 0) {
    const mw = 52;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    roundRect(ctx, bx, BADGE_Y, mw, BH, BH / 2); ctx.fill();
    ctx.strokeStyle = a.accent + '55'; ctx.lineWidth = 1;
    roundRect(ctx, bx, BADGE_Y, mw, BH, BH / 2); ctx.stroke();
    ctx.font = 'bold 15px sans-serif'; ctx.fillStyle = a.text;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`+${extra}`, bx + mw / 2, BADGE_Y + BH / 2);
  }
}

// ── ULTIMATE ──────────────────────────────────────────────────────────────────

function drawUltimate(ctx: SKRSContext2D, card: PersonaCard, a: RarityAccent) {
  accentLine(ctx, ULT_Y - 12, a, 0.35);

  const cx = W / 2;

  // "◆ ULTIMATE  ·  [ABILITY NAME]"
  const ultLabel = `◆ ULTIMATE  ·  ${card.signatureMove.toUpperCase()}`;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = a.glow; ctx.shadowBlur = 18;
  ctx.font = 'bold 26px sans-serif'; ctx.fillStyle = a.accent;
  let px = 26;
  while (ctx.measureText(ultLabel).width > W - PAD * 2 && px > 16) { px--; ctx.font = `bold ${px}px sans-serif`; }
  ctx.fillText(trunc(ctx, ultLabel, W - PAD * 2), cx, ULT_Y + 24);
  ctx.restore();

  // Ability description (short)
  if (card.signatureMoveDesc) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = 'italic 21px sans-serif'; ctx.fillStyle = a.text + 'cc';
    ctx.fillText(trunc(ctx, `"${card.signatureMoveDesc}"`, W - PAD * 2 - 20), cx, ULT_Y + 54);
    ctx.restore();
  }
}

// ── FLAVOR TEXT ───────────────────────────────────────────────────────────────

function drawFlavor(ctx: SKRSContext2D, flavorText: string, a: RarityAccent) {
  if (!flavorText) return;
  accentLine(ctx, FLAVOR_Y - 12, a, 0.30);

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'italic 21px sans-serif'; ctx.fillStyle = a.text + 'aa';
  wrap2(ctx, `"${flavorText}"`, W / 2, FLAVOR_Y + 18, W - PAD * 2 - 20, 26);
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

  // ─ 5. Name ────────────────────────────────────────────────────────────────
  drawName(ctx, member.displayName || member.username, a);

  // ─ 6. XP bar ──────────────────────────────────────────────────────────────
  drawXP(ctx, member, a);

  // ─ 7. Top 3 stats ─────────────────────────────────────────────────────────
  drawStats(ctx, card.stats, a);

  // ─ 8. Badges ──────────────────────────────────────────────────────────────
  drawBadges(ctx, member, a);

  // ─ 9. Ultimate ability ────────────────────────────────────────────────────
  if (card.signatureMove) drawUltimate(ctx, card, a);

  // ─ 10. Flavor text ────────────────────────────────────────────────────────
  if (card.flavorText) drawFlavor(ctx, card.flavorText, a);

  // ─ 11. Footer ─────────────────────────────────────────────────────────────
  drawFooter(ctx, collectionNumber, a);

  ctx.restore(); // end clip

  // ─ 12. Card border (drawn outside clip so corners are always sharp) ───────
  drawCardEdge(ctx, a);

  return canvas.toBuffer('image/png');
}
