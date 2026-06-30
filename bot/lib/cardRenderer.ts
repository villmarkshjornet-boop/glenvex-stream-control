/**
 * PERSONA CARDS V4
 * Component-based premium trading card renderer.
 * Architecture: drawOuterGlow → clip → background → character → panel → overlays → frame
 */

import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import type { MemberProfile } from './memberTracker';
import type { PersonaCard, PersonaRarity } from './personaService';

// ── Dimensions ────────────────────────────────────────────────────────────────

const W        = 680;   // card width
const H        = 1040;  // card height (trading card proportions)
const CORNER_R = 26;    // card corner radius
const CHAR_H   = 640;   // character zone height (61.5% of card)
const PANEL_Y  = 620;   // bottom panel start — 20px overlap with character zone
const PAD      = 28;    // horizontal padding

// ── Design tokens ─────────────────────────────────────────────────────────────

interface RarityTheme {
  bg1: string; bg2: string;
  border: string; borderInner: string;
  glow: string; glowBlur: number;
  accent: string; accentDim: string;
  textPrimary: string; textSecondary: string;
  panelBg: string;
  bannerLabel: string;
  bannerGlow: string;
}

const RARITY_THEME: Record<PersonaRarity, RarityTheme> = {
  Common: {
    bg1: '#111318', bg2: '#080a0e',
    border: '#7a7a8c', borderInner: '#3a3a48',
    glow: 'rgba(120,120,150,0.35)', glowBlur: 18,
    accent: '#9898b8', accentDim: '#5a5a78',
    textPrimary: '#d0d0e0', textSecondary: '#7878a0',
    panelBg: 'rgba(7,7,12,0.93)',
    bannerLabel: '  COMMON  ',
    bannerGlow: 'rgba(150,150,180,0.5)',
  },
  Rare: {
    bg1: '#050f1c', bg2: '#03080e',
    border: '#1976d2', borderInner: '#0d47a1',
    glow: 'rgba(30,118,220,0.55)', glowBlur: 28,
    accent: '#42a5f5', accentDim: '#1565c0',
    textPrimary: '#b3d4ff', textSecondary: '#5588bb',
    panelBg: 'rgba(3,6,14,0.94)',
    bannerLabel: '  R A R E  ',
    bannerGlow: 'rgba(80,180,255,0.65)',
  },
  Epic: {
    bg1: '#13081f', bg2: '#0b0414',
    border: '#9c27b0', borderInner: '#6a1b9a',
    glow: 'rgba(155,40,180,0.6)', glowBlur: 32,
    accent: '#e040fb', accentDim: '#8e24aa',
    textPrimary: '#e0b8ff', textSecondary: '#9966cc',
    panelBg: 'rgba(9,3,16,0.94)',
    bannerLabel: '  E P I C  ',
    bannerGlow: 'rgba(220,80,255,0.72)',
  },
  Legendary: {
    bg1: '#1b1000', bg2: '#110900',
    border: '#f9a825', borderInner: '#e65100',
    glow: 'rgba(249,168,37,0.65)', glowBlur: 40,
    accent: '#ffca28', accentDim: '#ff8f00',
    textPrimary: '#ffe082', textSecondary: '#cc9900',
    panelBg: 'rgba(12,7,0,0.95)',
    bannerLabel: '  L E G E N D A R Y  ',
    bannerGlow: 'rgba(255,220,80,0.85)',
  },
  Mythic: {
    bg1: '#1e0000', bg2: '#0f0000',
    border: '#ff1744', borderInner: '#c62828',
    glow: 'rgba(255,30,70,0.7)', glowBlur: 52,
    accent: '#ff5252', accentDim: '#c50e29',
    textPrimary: '#ffcccc', textSecondary: '#cc4455',
    panelBg: 'rgba(14,0,0,0.96)',
    bannerLabel: '  M Y T H I C  ',
    bannerGlow: 'rgba(255,100,120,0.9)',
  },
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  const safe = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + safe, y);
  ctx.lineTo(x + w - safe, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + safe);
  ctx.lineTo(x + w, y + h - safe);
  ctx.quadraticCurveTo(x + w, y + h, x + w - safe, y + h);
  ctx.lineTo(x + safe, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - safe);
  ctx.lineTo(x, y + safe);
  ctx.quadraticCurveTo(x, y, x + safe, y);
  ctx.closePath();
}

function truncate(ctx: SKRSContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

function wrap(ctx: SKRSContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines = 99): number {
  const words = text.split(' ');
  let line = '';
  let linesDrawn = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      if (linesDrawn >= maxLines - 1) { ctx.fillText(truncate(ctx, line, maxW), x, y); return y; }
      ctx.fillText(line, x, y);
      line = word; y += lineH; linesDrawn++;
    } else { line = test; }
  }
  if (line) ctx.fillText(truncate(ctx, line, maxW), x, y);
  return y;
}

async function fetchBuf(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
}

function hDiv(ctx: SKRSContext2D, y: number, theme: RarityTheme) {
  const g = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  g.addColorStop(0, 'transparent');
  g.addColorStop(0.15, theme.border + '44');
  g.addColorStop(0.5,  theme.border + '66');
  g.addColorStop(0.85, theme.border + '44');
  g.addColorStop(1, 'transparent');
  ctx.save();
  ctx.strokeStyle = g; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
  ctx.restore();
}

// ── Component: Outer glow (drawn BEFORE clip so it bleeds outside card) ───────

function drawOuterGlow(ctx: SKRSContext2D, theme: RarityTheme, rarity: PersonaRarity) {
  ctx.save();
  ctx.shadowColor = theme.glow;
  ctx.shadowBlur  = theme.glowBlur;
  ctx.strokeStyle = theme.border;
  ctx.lineWidth   = 3;
  roundRect(ctx, 7, 7, W - 14, H - 14, CORNER_R - 1);
  ctx.stroke();
  if (rarity === 'Mythic' || rarity === 'Legendary') {
    ctx.shadowBlur  = theme.glowBlur * 1.6;
    ctx.globalAlpha = 0.4;
    ctx.stroke();
  }
  ctx.restore();
}

// ── Component: Card background + texture ─────────────────────────────────────

function drawBackground(ctx: SKRSContext2D, theme: RarityTheme) {
  const g = ctx.createLinearGradient(W * 0.15, 0, W * 0.85, H);
  g.addColorStop(0, theme.bg1);
  g.addColorStop(0.65, theme.bg2);
  g.addColorStop(1, '#010101');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Diagonal texture lines
  ctx.save();
  ctx.globalAlpha = 0.022;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = 1;
  for (let i = -H; i < W + H; i += 22) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.stroke();
  }
  ctx.restore();
}

// ── Component: Character — premium gem silhouette (when no image available) ──

function drawSilhouette(ctx: SKRSContext2D, theme: RarityTheme) {
  const cx = W / 2, cy = CHAR_H * 0.42;

  // Radial dark gradient
  const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, CHAR_H) * 0.8);
  rg.addColorStop(0, theme.bg1);
  rg.addColorStop(0.55, theme.bg2);
  rg.addColorStop(1, '#000000');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, CHAR_H);

  // Subtle radiating lines
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth   = 1.5;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 9) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * 600, cy + Math.sin(a) * 600);
    ctx.stroke();
  }
  ctx.restore();

  // Gem body (hexagon-diamond hybrid)
  const gS = 115;
  ctx.save();
  ctx.shadowColor = theme.glow;
  ctx.shadowBlur  = 55;
  ctx.globalAlpha = 0.78;
  ctx.fillStyle   = theme.border;
  ctx.beginPath();
  ctx.moveTo(cx,             cy - gS);
  ctx.lineTo(cx + gS * 0.65, cy - gS * 0.22);
  ctx.lineTo(cx + gS * 0.58, cy + gS * 0.62);
  ctx.lineTo(cx,             cy + gS * 0.92);
  ctx.lineTo(cx - gS * 0.58, cy + gS * 0.62);
  ctx.lineTo(cx - gS * 0.65, cy - gS * 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Gem inner highlight (top facet)
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.fillStyle   = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx,             cy - gS * 0.88);
  ctx.lineTo(cx + gS * 0.42, cy - gS * 0.16);
  ctx.lineTo(cx,             cy - gS * 0.08);
  ctx.lineTo(cx - gS * 0.42, cy - gS * 0.16);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Small secondary highlight
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle   = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx - gS * 0.08, cy - gS * 0.42);
  ctx.lineTo(cx - gS * 0.04, cy - gS * 0.08);
  ctx.lineTo(cx - gS * 0.28, cy - gS * 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── Component: Character — Discord avatar (fallback level 2) ─────────────────

async function drawAvatarCharacter(ctx: SKRSContext2D, buf: Buffer, theme: RarityTheme): Promise<void> {
  const img   = await loadImage(buf);
  const scale = Math.max(W / img.width, CHAR_H / img.height) * 1.08;
  const dw    = img.width  * scale;
  const dh    = img.height * scale;
  const dx    = (W - dw)  / 2;
  const dy    = 0;

  // Soft behind-glow (pseudo-blur: 4 semi-transparent copies at offsets)
  ctx.save();
  ctx.globalAlpha = 0.12;
  for (const [ox, oy] of [[6,0],[-6,0],[0,6],[0,-6]]) {
    ctx.drawImage(img, dx + ox, dy + oy, dw, dh);
  }
  ctx.globalAlpha = 1;
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();

  // Side vignettes so avatar blends with background
  const lv = ctx.createLinearGradient(0, 0, W * 0.3, 0);
  lv.addColorStop(0, theme.bg2 + 'dd'); lv.addColorStop(1, 'transparent');
  ctx.fillStyle = lv; ctx.fillRect(0, 0, W, CHAR_H);

  const rv = ctx.createLinearGradient(W, 0, W * 0.7, 0);
  rv.addColorStop(0, theme.bg2 + 'dd'); rv.addColorStop(1, 'transparent');
  ctx.fillStyle = rv; ctx.fillRect(0, 0, W, CHAR_H);
}

// ── Component: Character — DALL-E art (primary) ───────────────────────────────

async function drawCharacterArt(ctx: SKRSContext2D, buf: Buffer): Promise<void> {
  const img   = await loadImage(buf);
  // Top-aligned: head always visible, bottom fades into panel
  const scale = Math.max(W / img.width, CHAR_H / img.height);
  const dw    = img.width  * scale;
  const dh    = img.height * scale;
  const dx    = (W - dw)  / 2;
  const dy    = 0;
  ctx.drawImage(img, dx, dy, dw, dh);
}

// ── Component: Character vignette (side + bottom fade) ────────────────────────

function drawCharacterVignette(ctx: SKRSContext2D, theme: RarityTheme) {
  // Left edge
  const lv = ctx.createLinearGradient(0, 0, W * 0.22, 0);
  lv.addColorStop(0, theme.bg2 + 'bb'); lv.addColorStop(1, 'transparent');
  ctx.fillStyle = lv; ctx.fillRect(0, 0, W, CHAR_H);

  // Right edge
  const rv = ctx.createLinearGradient(W, 0, W * 0.78, 0);
  rv.addColorStop(0, theme.bg2 + 'bb'); rv.addColorStop(1, 'transparent');
  ctx.fillStyle = rv; ctx.fillRect(0, 0, W, CHAR_H);

  // Bottom fade into panel
  const bv = ctx.createLinearGradient(0, CHAR_H - 240, 0, CHAR_H);
  bv.addColorStop(0, 'transparent');
  bv.addColorStop(0.45, theme.panelBg.replace(/,[^,]+\)$/, ',0.65)'));
  bv.addColorStop(1, theme.panelBg);
  ctx.fillStyle = bv;
  ctx.fillRect(0, CHAR_H - 240, W, 240);
}

// ── Component: Rarity banner (overlaid on top of character image) ─────────────

function drawRarityBanner(ctx: SKRSContext2D, theme: RarityTheme) {
  const BY = 20, BH = 44;

  const bg = ctx.createLinearGradient(0, 0, W, 0);
  bg.addColorStop(0,   'transparent');
  bg.addColorStop(0.08, theme.border + '44');
  bg.addColorStop(0.3,  theme.border + '77');
  bg.addColorStop(0.5,  theme.border + '99');
  bg.addColorStop(0.7,  theme.border + '77');
  bg.addColorStop(0.92, theme.border + '44');
  bg.addColorStop(1,   'transparent');
  ctx.fillStyle = bg;
  ctx.fillRect(0, BY, W, BH);

  // Thin accent lines top + bottom of banner
  const lg = ctx.createLinearGradient(0, 0, W, 0);
  lg.addColorStop(0, 'transparent');
  lg.addColorStop(0.12, theme.accent + '88');
  lg.addColorStop(0.88, theme.accent + '88');
  lg.addColorStop(1, 'transparent');
  ctx.save();
  ctx.strokeStyle = lg; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, BY);      ctx.lineTo(W, BY);      ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, BY + BH); ctx.lineTo(W, BY + BH); ctx.stroke();
  ctx.restore();

  // Banner text
  ctx.save();
  ctx.shadowColor  = theme.bannerGlow;
  ctx.shadowBlur   = 18;
  ctx.fillStyle    = '#ffffff';
  ctx.font         = 'bold 14px sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(theme.bannerLabel, W / 2, BY + BH / 2);
  ctx.restore();
}

// ── Component: Name + title overlaid on character (bottom of character zone) ──

function drawNameOverlay(ctx: SKRSContext2D, card: PersonaCard, displayName: string, theme: RarityTheme) {
  const nameY  = CHAR_H - 76;
  const titleY = CHAR_H - 42;

  // Username — large, white, all caps
  const maxNameW = W - 80;
  let namePx = 58;
  ctx.font = `bold ${namePx}px sans-serif`;
  while (ctx.measureText(displayName.toUpperCase()).width > maxNameW && namePx > 26) {
    namePx -= 2;
    ctx.font = `bold ${namePx}px sans-serif`;
  }
  const nameStr = truncate(ctx, displayName.toUpperCase(), maxNameW);

  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  // Black drop shadow for legibility on any background
  ctx.shadowColor   = 'rgba(0,0,0,0.97)';
  ctx.shadowBlur    = 10;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle     = '#ffffff';
  ctx.fillText(nameStr, W / 2, nameY);
  // Rarity glow layer
  ctx.shadowColor   = theme.glow;
  ctx.shadowBlur    = 24;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.globalAlpha   = 0.55;
  ctx.fillText(nameStr, W / 2, nameY);
  ctx.restore();

  // Card title (AI archetype/class title) — accent color, medium
  const maxTitleW = W - 100;
  let titlePx = 19;
  ctx.font = `${titlePx}px sans-serif`;
  while (ctx.measureText(card.title).width > maxTitleW && titlePx > 11) {
    titlePx--;
    ctx.font = `${titlePx}px sans-serif`;
  }

  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor   = 'rgba(0,0,0,0.92)';
  ctx.shadowBlur    = 8;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle     = theme.accent;
  ctx.fillText(truncate(ctx, card.title, maxTitleW), W / 2, titleY);
  ctx.restore();
}

// ── Component: Bottom dark panel ──────────────────────────────────────────────

function drawBottomPanel(ctx: SKRSContext2D, theme: RarityTheme) {
  ctx.fillStyle = theme.panelBg;
  ctx.fillRect(0, PANEL_Y, W, H - PANEL_Y);

  // Panel top divider
  const g = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  g.addColorStop(0, 'transparent');
  g.addColorStop(0.1,  theme.border + '55');
  g.addColorStop(0.5,  theme.border + '88');
  g.addColorStop(0.9,  theme.border + '55');
  g.addColorStop(1, 'transparent');
  ctx.save();
  ctx.strokeStyle = g; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(PAD, PANEL_Y + 6); ctx.lineTo(W - PAD, PANEL_Y + 6); ctx.stroke();
  ctx.restore();
}

// ── Component: Ultimate ability ───────────────────────────────────────────────

function drawAbility(ctx: SKRSContext2D, card: PersonaCard, theme: RarityTheme, startY: number): number {
  let y = startY;

  // Section label
  ctx.font         = 'bold 9px sans-serif';
  ctx.fillStyle    = theme.accentDim;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('ULTIMATE ABILITY', PAD, y + 10);
  y += 22;

  // Ability name — large & impactful
  const abilityName = card.signatureMove || 'UNKNOWN ABILITY';
  const maxAW = W - PAD * 2 - 30;
  let apx = 22;
  ctx.font = `bold ${apx}px sans-serif`;
  while (ctx.measureText(abilityName).width > maxAW && apx > 13) { apx--; ctx.font = `bold ${apx}px sans-serif`; }

  ctx.save();
  ctx.shadowColor = theme.glow;
  ctx.shadowBlur  = 12;
  ctx.fillStyle   = '#ffffff';
  ctx.textAlign   = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(truncate(ctx, abilityName, maxAW), PAD + 26, y);
  ctx.restore();

  // Lightning prefix
  ctx.font      = '17px sans-serif';
  ctx.fillStyle = theme.accent;
  ctx.textAlign = 'left';
  ctx.fillText('⚡', PAD + 2, y);

  y += 18;

  // Description
  ctx.font         = '11px sans-serif';
  ctx.fillStyle    = theme.textSecondary;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
  const descEnd = wrap(ctx, card.signatureMoveDesc || card.description || '', PAD + 26, y, maxAW, 15, 2);
  return descEnd + 16;
}

// ── Component: Stat bar (RPG-style, large) ────────────────────────────────────

function drawStatBar(
  ctx: SKRSContext2D,
  x: number, y: number,
  icon: string, label: string, value: number,
  theme: RarityTheme,
): number {
  const ROW_H  = 40;
  const BAR_H  = 20;
  const ICON_W = 24;
  const LBL_W  = 100;
  const VAL_W  = 46;
  const barX   = x + ICON_W + LBL_W;
  const barW   = W - PAD * 2 - ICON_W - LBL_W - VAL_W;
  const barY   = y + (ROW_H - BAR_H) / 2;
  const midY   = y + ROW_H / 2;

  // Icon
  ctx.font      = '15px sans-serif';
  ctx.fillStyle = theme.accent;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, x, midY);

  // Label
  ctx.font      = 'bold 12px sans-serif';
  ctx.fillStyle = theme.textPrimary;
  ctx.fillText(label, x + ICON_W, midY);

  // Track
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  roundRect(ctx, barX, barY, barW, BAR_H, BAR_H / 2);
  ctx.fill();

  // Fill gradient
  const pct    = Math.max(0, Math.min(1, value / 100));
  const fillW  = Math.max(BAR_H, barW * pct);
  const fillG  = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
  fillG.addColorStop(0,   theme.accent + 'ff');
  fillG.addColorStop(0.75, theme.accent + 'cc');
  fillG.addColorStop(1,   theme.accentDim + '99');
  ctx.save();
  ctx.shadowColor = theme.glow;
  ctx.shadowBlur  = 10;
  ctx.fillStyle   = fillG;
  roundRect(ctx, barX, barY, fillW, BAR_H, BAR_H / 2);
  ctx.fill();
  ctx.restore();

  // Bright tip
  if (fillW > BAR_H) {
    ctx.save();
    ctx.shadowColor = theme.accent;
    ctx.shadowBlur  = 18;
    ctx.fillStyle   = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(barX + fillW - BAR_H / 2, barY + BAR_H / 2, BAR_H / 2 - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Value number
  ctx.save();
  ctx.shadowColor  = theme.glow;
  ctx.shadowBlur   = 10;
  ctx.font         = 'bold 20px sans-serif';
  ctx.fillStyle    = theme.accent;
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), barX + barW + VAL_W - 2, midY);
  ctx.restore();

  return ROW_H;
}

// ── Component: Stats section (3 stats: HYPE, CHAOS, COMMUNITY) ───────────────

function drawStats(ctx: SKRSContext2D, card: PersonaCard, theme: RarityTheme, startY: number): number {
  let y = startY;
  const GAP = 5;
  y += drawStatBar(ctx, PAD, y, '🔥', 'HYPE',      card.stats.hype,      theme) + GAP;
  y += drawStatBar(ctx, PAD, y, '⚡',       'CHAOS',     card.stats.chaos,     theme) + GAP;
  y += drawStatBar(ctx, PAD, y, '🤝', 'COMMUNITY', card.stats.community, theme) + GAP;
  return y;
}

// ── Component: XP progress bar ────────────────────────────────────────────────

function drawXPBar(ctx: SKRSContext2D, member: MemberProfile, theme: RarityTheme, startY: number): number {
  const XPL   = 250;
  const level = Math.floor(member.xp / XPL) + 1;
  const curXP = member.xp - (level - 1) * XPL;
  const pct   = Math.max(0, Math.min(1, curXP / XPL));
  let y = startY;

  ctx.save();
  ctx.font         = 'bold 12px sans-serif';
  ctx.fillStyle    = theme.accent;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor  = theme.glow;
  ctx.shadowBlur   = 8;
  ctx.fillText(`Level ${level}`, PAD, y + 13);
  ctx.restore();

  ctx.font         = '10px sans-serif';
  ctx.fillStyle    = theme.textSecondary;
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${curXP} / ${XPL} XP`, W - PAD, y + 13);

  y += 18;
  const BW = W - PAD * 2, BH = 13;

  // Track
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  roundRect(ctx, PAD, y, BW, BH, BH / 2);
  ctx.fill();

  // Fill
  const fw = Math.max(BH, BW * pct);
  const fg = ctx.createLinearGradient(PAD, 0, PAD + fw, 0);
  fg.addColorStop(0, theme.accentDim);
  fg.addColorStop(0.6, theme.accent);
  fg.addColorStop(1, '#ffffff');
  ctx.save();
  ctx.shadowColor = theme.glow;
  ctx.shadowBlur  = 12;
  ctx.fillStyle   = fg;
  roundRect(ctx, PAD, y, fw, BH, BH / 2);
  ctx.fill();
  ctx.restore();

  return y + BH + 6;
}

// ── Component: Badges (icon-boxes with rarity border) ────────────────────────

function drawBadges(ctx: SKRSContext2D, member: MemberProfile, theme: RarityTheme, startY: number): number {
  const y = startY;

  if (member.badges.length === 0) {
    ctx.font         = 'italic 11px sans-serif';
    ctx.fillStyle    = theme.textSecondary + '66';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('No badges unlocked yet', W / 2, y + 14);
    return y + 26;
  }

  const SHOW   = 4;
  const badges = member.badges.slice(0, SHOW);
  const extra  = member.badges.length - SHOW;
  const BH     = 28;
  const PAD_H  = 12;
  const GAP    = 8;

  ctx.font = 'bold 10px sans-serif';
  const dims = badges.map(b => {
    const lbl = b.length > 11 ? b.slice(0, 9) + '…' : b;
    return { lbl, w: Math.max(56, ctx.measureText(lbl).width + PAD_H * 2) };
  });

  let totalW = dims.reduce((s, d) => s + d.w + GAP, -GAP);
  if (extra > 0) totalW += 36 + GAP;
  let bx = (W - totalW) / 2;

  for (const { lbl, w } of dims) {
    // Badge fill
    const bg = ctx.createLinearGradient(bx, y, bx, y + BH);
    bg.addColorStop(0, theme.border + '22');
    bg.addColorStop(1, theme.border + '0e');
    ctx.fillStyle = bg;
    roundRect(ctx, bx, y, w, BH, BH / 2);
    ctx.fill();
    // Badge border
    ctx.save();
    ctx.shadowColor = theme.glow;
    ctx.shadowBlur  = 7;
    ctx.strokeStyle = theme.border + 'aa';
    ctx.lineWidth   = 1.5;
    roundRect(ctx, bx, y, w, BH, BH / 2);
    ctx.stroke();
    ctx.restore();
    // Badge label
    ctx.font         = 'bold 10px sans-serif';
    ctx.fillStyle    = theme.accent;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(lbl, bx + w / 2, y + BH / 2);
    bx += w + GAP;
  }

  if (extra > 0) {
    const mw = 36;
    ctx.fillStyle   = 'rgba(255,255,255,0.04)';
    roundRect(ctx, bx, y, mw, BH, BH / 2);
    ctx.fill();
    ctx.strokeStyle = theme.border + '44';
    ctx.lineWidth   = 1;
    roundRect(ctx, bx, y, mw, BH, BH / 2);
    ctx.stroke();
    ctx.font         = 'bold 10px sans-serif';
    ctx.fillStyle    = theme.textSecondary;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${extra}`, bx + mw / 2, y + BH / 2);
  }

  return y + BH + 6;
}

// ── Component: Flavor text ────────────────────────────────────────────────────

function drawFlavorText(ctx: SKRSContext2D, card: PersonaCard, theme: RarityTheme, startY: number): number {
  if (!card.flavorText) return startY;
  ctx.font         = 'italic 11px sans-serif';
  ctx.fillStyle    = theme.textSecondary + 'aa';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  const endY = wrap(ctx, `"${card.flavorText}"`, W / 2, startY + 12, W - PAD * 2 - 16, 15, 2);
  return endY + 16;
}

// ── Component: Footer ─────────────────────────────────────────────────────────

function drawFooter(ctx: SKRSContext2D, collectionNumber: number, theme: RarityTheme) {
  const fy = H - 16;
  const season = process.env.PERSONA_SEASON ?? '1';

  const lg = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  lg.addColorStop(0, 'transparent');
  lg.addColorStop(0.25, theme.border + '33');
  lg.addColorStop(0.75, theme.border + '33');
  lg.addColorStop(1, 'transparent');
  ctx.save();
  ctx.strokeStyle = lg; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, fy - 12); ctx.lineTo(W - PAD, fy - 12); ctx.stroke();
  ctx.restore();

  ctx.font         = '9px sans-serif';
  ctx.fillStyle    = theme.border + '66';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  const ftxt = `Card #${String(collectionNumber).padStart(3, '0')}  ·  GLENVEX PERSONA  ·  Season ${season}`;
  ctx.fillText(truncate(ctx, ftxt, W - PAD * 2), W / 2, fy);
}

// ── Component: Card frame (border + gems + rarity effects) — drawn LAST ───────

function drawFrame(ctx: SKRSContext2D, theme: RarityTheme, rarity: PersonaRarity) {
  // Outer border with glow
  ctx.save();
  ctx.shadowColor = theme.glow;
  ctx.shadowBlur  = 16;
  ctx.strokeStyle = theme.border;
  ctx.lineWidth   = 3.5;
  roundRect(ctx, 5, 5, W - 10, H - 10, CORNER_R - 1);
  ctx.stroke();
  ctx.restore();

  // Inner inset accent line
  ctx.save();
  ctx.strokeStyle = theme.borderInner + '55';
  ctx.lineWidth   = 1;
  roundRect(ctx, 15, 15, W - 30, H - 30, CORNER_R - 7);
  ctx.stroke();
  ctx.restore();

  // Corner gems (rotated diamond shapes)
  const gemSize = rarity === 'Mythic' ? 11 : rarity === 'Legendary' ? 10 : 8;
  const corners = [[20, 20], [W - 20, 20], [20, H - 20], [W - 20, H - 20]] as [number, number][];
  for (const [gx, gy] of corners) {
    ctx.save();
    ctx.shadowColor = theme.glow;
    ctx.shadowBlur  = 18;
    ctx.fillStyle   = theme.border;
    ctx.beginPath();
    ctx.moveTo(gx, gy - gemSize);
    ctx.lineTo(gx + gemSize, gy);
    ctx.lineTo(gx, gy + gemSize);
    ctx.lineTo(gx - gemSize, gy);
    ctx.closePath();
    ctx.fill();
    // Inner highlight
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = 'rgba(255,255,255,0.42)';
    ctx.beginPath();
    ctx.moveTo(gx, gy - gemSize * 0.85);
    ctx.lineTo(gx + gemSize * 0.44, gy - gemSize * 0.14);
    ctx.lineTo(gx, gy - gemSize * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Legendary: corner accent rays
  if (rarity === 'Legendary' || rarity === 'Mythic') {
    ctx.save();
    ctx.globalAlpha = rarity === 'Mythic' ? 0.5 : 0.32;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth   = 1;
    const rayLen = 38;
    const cDefs: [number, number, number[]][] = [
      [8, 8,     [Math.PI * 0.25, Math.PI * 0.5]],
      [W-8, 8,   [Math.PI * 0.5,  Math.PI * 0.75]],
      [8, H-8,   [Math.PI * 1.5,  Math.PI * 1.75]],
      [W-8, H-8, [Math.PI * 1.25, Math.PI * 1.5]],
    ];
    for (const [cx, cy, angles] of cDefs) {
      for (const a of angles) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * rayLen, cy + Math.sin(a) * rayLen);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Mythic: particle dots scattered around perimeter
  if (rarity === 'Mythic') {
    const perim = 2 * (W + H);
    for (let i = 0; i < 28; i++) {
      const t   = i / 28;
      const pos = t * perim;
      let px: number, py: number;
      if      (pos < W)         { px = pos;         py = 6; }
      else if (pos < W + H)     { px = W - 6;       py = pos - W; }
      else if (pos < 2 * W + H) { px = W - (pos - W - H); py = H - 6; }
      else                      { px = 6;            py = H - (pos - 2 * W - H); }

      ctx.save();
      ctx.shadowColor = theme.accent;
      ctx.shadowBlur  = 9;
      ctx.fillStyle   = theme.accent + 'bb';
      ctx.globalAlpha = 0.35 + (i % 3) * 0.18;
      ctx.beginPath();
      ctx.arc(px, py, 1.5 + (i % 3) * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

// ── Main renderer ─────────────────────────────────────────────────────────────

export async function renderPersonaCard(
  card: PersonaCard,
  characterImageUrl: string | null,
  member: MemberProfile,
  collectionNumber: number,
  avatarUrl?: string | null,
): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d') as SKRSContext2D;
  const theme  = RARITY_THEME[card.rarity];

  // ── Phase 1: Outer glow (before clip — bleeds outside card into transparency) ─
  drawOuterGlow(ctx, theme, card.rarity);

  // ── Phase 2: Card content (clipped to rounded card shape) ─────────────────
  ctx.save();
  roundRect(ctx, 0, 0, W, H, CORNER_R);
  ctx.clip();

  // Background
  drawBackground(ctx, theme);

  // Character zone (top 62% of card)
  let characterDrawn = false;

  if (characterImageUrl) {
    const buf = await fetchBuf(characterImageUrl);
    if (buf) {
      try { await drawCharacterArt(ctx, buf); characterDrawn = true; } catch {}
    }
  }

  if (!characterDrawn && avatarUrl) {
    const buf = await fetchBuf(avatarUrl);
    if (buf) {
      try { await drawAvatarCharacter(ctx, buf, theme); characterDrawn = true; } catch {}
    }
  }

  if (!characterDrawn) {
    drawSilhouette(ctx, theme);
  }

  // Vignette over character
  drawCharacterVignette(ctx, theme);

  // Bottom panel
  drawBottomPanel(ctx, theme);

  // Overlays on character zone
  drawRarityBanner(ctx, theme);
  drawNameOverlay(ctx, card, member.displayName || member.username, theme);

  // Panel content (flows downward)
  let y = PANEL_Y + 22;

  y = drawAbility(ctx, card, theme, y);
  hDiv(ctx, y, theme); y += 10;

  y = drawStats(ctx, card, theme, y);
  hDiv(ctx, y, theme); y += 10;

  y = drawXPBar(ctx, member, theme, y);
  hDiv(ctx, y, theme); y += 10;

  y = drawBadges(ctx, member, theme, y);

  if (card.flavorText) {
    hDiv(ctx, y + 4, theme); y += 12;
    y = drawFlavorText(ctx, card, theme, y);
  }

  drawFooter(ctx, collectionNumber, theme);

  ctx.restore(); // End clip

  // ── Phase 3: Frame on top of everything (after clip restore) ──────────────
  drawFrame(ctx, theme, card.rarity);

  return canvas.toBuffer('image/png');
}
