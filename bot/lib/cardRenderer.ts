/**
 * PERSONA CARDS V4 — Hybrid compositor
 *
 * DALL-E generates the ENTIRE artistic card (frame + character + atmosphere).
 * Canvas overlays dynamic data only: rarity banner, name, XP, badges, footer.
 *
 * Layout zones (Canvas overlay):
 *   TOP  0–100px : Rarity banner strip (always visible in Discord thumbnail)
 *   MID  1000px+ : Safety gradient starts (over lower character zone)
 *   DATA 1060px+ : Name, title, XP bar, badges, flavor, footer
 */

import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import type { MemberProfile } from './memberTracker';
import type { PersonaCard, PersonaRarity } from './personaService';

// ── Dimensions — matches gpt-image-1 portrait output ─────────────────────────
const W = 1024;
const H = 1536;

const TOP_BANNER_H = 90;  // rarity banner zone at top
const PANEL_Y      = 840; // Canvas safety gradient starts (~55% down)
const DATA_Y       = 900; // first data element (~59% down)
const CORNER_R     = 30;
const PAD          = 52;

// ── Rarity accent palette ─────────────────────────────────────────────────────
interface RarityAccent {
  accent: string;
  glow:   string;
  dim:    string;
  text:   string;
  bg:     string; // dark tinted bg for mystical fallback
}

const ACCENT: Record<PersonaRarity, RarityAccent> = {
  Common:    { accent: '#c8c8e0', glow: 'rgba(200,200,224,0.65)', dim: '#6a6a90', text: '#a0a0c0', bg: '#14141e' },
  Rare:      { accent: '#42a5f5', glow: 'rgba(66,165,245,0.7)',   dim: '#1565c0', text: '#7ab8ee', bg: '#060d20' },
  Epic:      { accent: '#e040fb', glow: 'rgba(224,64,251,0.75)',  dim: '#8e24aa', text: '#d090f0', bg: '#100430' },
  Legendary: { accent: '#ffd740', glow: 'rgba(255,215,64,0.8)',   dim: '#ff8f00', text: '#ffe082', bg: '#1c1000' },
  Mythic:    { accent: '#ff5252', glow: 'rgba(255,82,82,0.85)',   dim: '#c50e29', text: '#ffbbbb', bg: '#1c0000' },
};

const RARITY_LABEL: Record<PersonaRarity, string> = {
  Common:    '◆  C O M M O N',
  Rare:      '◈◈  R A R E  ◈◈',
  Epic:      '⬡⬡⬡  E P I C  ⬡⬡⬡',
  Legendary: '✦  L E G E N D A R Y  ✦',
  Mythic:    '⚡  M Y T H I C  ⚡',
};

const RARITY_ICON: Record<PersonaRarity, string> = {
  Common:    '◆',
  Rare:      '◈',
  Epic:      '⬡',
  Legendary: '✦',
  Mythic:    '⚡',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function wrap(ctx: SKRSContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines = 99): number {
  const words = text.split(' ');
  let line = '';
  let n = 0;
  for (const word of words) {
    const t = line ? `${line} ${word}` : word;
    if (ctx.measureText(t).width > maxW && line) {
      if (n >= maxLines - 1) { ctx.fillText(trunc(ctx, line, maxW), x, y); return y; }
      ctx.fillText(line, x, y);
      line = word; y += lineH; n++;
    } else { line = t; }
  }
  if (line) ctx.fillText(trunc(ctx, line, maxW), x, y);
  return y;
}

async function fetchBuf(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
}

// ── Mystical fallback ─────────────────────────────────────────────────────────
// Shown when DALL-E image is unavailable. Shows card identity so it's still
// useful — the "face-down premium card" aesthetic with real data visible.

function drawMysticalFallback(ctx: SKRSContext2D, card: PersonaCard, a: RarityAccent) {
  const cx  = W / 2;
  const cy  = H * 0.34; // center of character zone

  // Rich dark background — rarity-tinted, NOT pure black
  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.9);
  bg.addColorStop(0,    a.bg);
  bg.addColorStop(0.45, '#0c0c14');
  bg.addColorStop(1,    '#04040a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Vivid rarity glow (was 0.13 — now 0.55)
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 520);
  glow.addColorStop(0,   a.accent + '8c'); // 55% opacity
  glow.addColorStop(0.4, a.accent + '30'); // 19% opacity
  glow.addColorStop(1,   'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Secondary edge glow from bottom (rarity atmosphere)
  const edgeGlow = ctx.createRadialGradient(cx, H, 0, cx, H, 700);
  edgeGlow.addColorStop(0,   a.accent + '33');
  edgeGlow.addColorStop(0.5, a.accent + '0d');
  edgeGlow.addColorStop(1,   'transparent');
  ctx.fillStyle = edgeGlow;
  ctx.fillRect(0, 0, W, H);

  // Subtle card-back grid
  ctx.save();
  ctx.globalAlpha = 0.045;
  ctx.strokeStyle = a.accent;
  ctx.lineWidth   = 1;
  for (let x = 0; x < W; x += 56) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 56) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.restore();

  // Radiating lines (was 0.055 — now 0.18)
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = a.accent;
  ctx.lineWidth   = 1.5;
  for (let ang = 0; ang < Math.PI * 2; ang += Math.PI / 12) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang) * 1000, cy + Math.sin(ang) * 1000);
    ctx.stroke();
  }
  ctx.restore();

  // Concentric rings (was 0.12/0.08/0.05 — now 0.4/0.25/0.14)
  for (const [r, alpha, lw] of [[190, 0.40, 2.5], [320, 0.25, 1.5], [470, 0.14, 1]] as [number, number, number][]) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = a.accent;
    ctx.lineWidth   = lw;
    ctx.shadowColor = a.glow;
    ctx.shadowBlur  = 20;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // White rarity icon layer (large, subtly visible)
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font         = 'bold 280px sans-serif';
  ctx.fillStyle    = '#ffffff';
  ctx.globalAlpha  = 0.06;
  ctx.fillText(RARITY_ICON[card.rarity], cx, cy);
  ctx.restore();

  // Bright accent "?" — the central mystery symbol (was 0.55 — now 0.88)
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor  = a.glow;
  ctx.shadowBlur   = 80;
  ctx.font         = 'bold 240px sans-serif';
  ctx.fillStyle    = a.accent;
  ctx.globalAlpha  = 0.88;
  ctx.fillText('?', cx, cy);
  ctx.restore();

  // Inner glow orb behind the ?
  const orb = ctx.createRadialGradient(cx, cy, 0, cx, cy, 220);
  orb.addColorStop(0,   a.accent + '55');
  orb.addColorStop(0.5, a.accent + '1a');
  orb.addColorStop(1,   'transparent');
  ctx.fillStyle = orb;
  ctx.fillRect(0, 0, W, H);

  // ── Card identity section (GPT data shown even when art is missing) ─────────
  // Dark backdrop for text readability
  const idY = H * 0.65;
  const idBg = ctx.createLinearGradient(0, idY - 20, 0, idY + 220);
  idBg.addColorStop(0, 'transparent');
  idBg.addColorStop(0.2, 'rgba(0,0,0,0.75)');
  idBg.addColorStop(1,   'rgba(0,0,0,0.92)');
  ctx.fillStyle = idBg;
  ctx.fillRect(0, idY - 20, W, 260);

  // Divider line
  const dl = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  dl.addColorStop(0, 'transparent');
  dl.addColorStop(0.15, a.accent + '88');
  dl.addColorStop(0.5,  a.accent + 'cc');
  dl.addColorStop(0.85, a.accent + '88');
  dl.addColorStop(1,    'transparent');
  ctx.save();
  ctx.strokeStyle = dl;
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(PAD, idY);
  ctx.lineTo(W - PAD, idY);
  ctx.stroke();
  ctx.restore();

  // Card title (class)
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor  = a.glow;
  ctx.shadowBlur   = 24;
  ctx.font         = 'bold 64px sans-serif';
  ctx.fillStyle    = '#ffffff';
  let px = 64;
  while (ctx.measureText(card.title).width > W - PAD * 2 && px > 32) {
    px -= 2;
    ctx.font = `bold ${px}px sans-serif`;
  }
  ctx.fillText(trunc(ctx, card.title, W - PAD * 2), cx, idY + 80);
  ctx.restore();

  // Card class
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor  = a.glow;
  ctx.shadowBlur   = 14;
  ctx.font         = '34px sans-serif';
  ctx.fillStyle    = a.accent;
  ctx.fillText(card.class, cx, idY + 130);
  ctx.restore();

  // Quote (if available)
  if (card.quote) {
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font         = 'italic 20px sans-serif';
    ctx.fillStyle    = a.text + 'bb';
    wrap(ctx, `"${card.quote}"`, cx, idY + 180, W - PAD * 2 - 40, 26, 2);
    ctx.restore();
  }

  // "Card art generating" notice
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font         = '18px sans-serif';
  ctx.fillStyle    = a.text + '77';
  ctx.fillText('— Card Art Generating —', cx, H * 0.89);
  ctx.restore();
}

// ── TOP: Rarity banner overlay ────────────────────────────────────────────────
// Canvas draws this over the top of EVERY card (real or fallback).
// Shown as the FIRST THING in Discord's compressed thumbnail view.

function drawTopRarityBanner(ctx: SKRSContext2D, rarity: PersonaRarity, a: RarityAccent) {
  // Dark gradient strip at very top
  const bg = ctx.createLinearGradient(0, 0, 0, TOP_BANNER_H + 30);
  bg.addColorStop(0, 'rgba(0,0,0,0.92)');
  bg.addColorStop(0.6, 'rgba(0,0,0,0.72)');
  bg.addColorStop(1, 'transparent');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, TOP_BANNER_H + 30);

  // Rarity text — large, bold, centered, colored
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor  = a.glow;
  ctx.shadowBlur   = 28;
  ctx.font         = 'bold 40px sans-serif';
  ctx.fillStyle    = a.accent;
  ctx.fillText(RARITY_LABEL[rarity], W / 2, 52);
  ctx.restore();

  // Thin accent bottom line
  const lg = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  lg.addColorStop(0, 'transparent');
  lg.addColorStop(0.15, a.accent + '55');
  lg.addColorStop(0.5,  a.accent + '88');
  lg.addColorStop(0.85, a.accent + '55');
  lg.addColorStop(1, 'transparent');
  ctx.save();
  ctx.strokeStyle = lg;
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(PAD, TOP_BANNER_H - 4);
  ctx.lineTo(W - PAD, TOP_BANNER_H - 4);
  ctx.stroke();
  ctx.restore();
}

// ── BOTTOM: Safety dark panel ─────────────────────────────────────────────────
// Fades from transparent into near-black to guarantee overlay readability.

function drawSafetyPanel(ctx: SKRSContext2D, a: RarityAccent) {
  const g = ctx.createLinearGradient(0, PANEL_Y - 100, 0, H);
  g.addColorStop(0,    'transparent');
  g.addColorStop(0.15, 'rgba(0,0,0,0.45)');
  g.addColorStop(0.4,  'rgba(0,0,0,0.78)');
  g.addColorStop(0.7,  'rgba(0,0,0,0.90)');
  g.addColorStop(1,    'rgba(0,0,0,0.95)');
  ctx.fillStyle = g;
  ctx.fillRect(0, PANEL_Y - 100, W, H - (PANEL_Y - 100));

  // Accent divider at top of data zone
  const dl = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  dl.addColorStop(0, 'transparent');
  dl.addColorStop(0.12, a.accent + '55');
  dl.addColorStop(0.5,  a.accent + '99');
  dl.addColorStop(0.88, a.accent + '55');
  dl.addColorStop(1, 'transparent');
  ctx.save();
  ctx.strokeStyle = dl;
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(PAD, DATA_Y + 2);
  ctx.lineTo(W - PAD, DATA_Y + 2);
  ctx.stroke();
  ctx.restore();
}

// ── Name ──────────────────────────────────────────────────────────────────────

function drawName(ctx: SKRSContext2D, displayName: string, a: RarityAccent) {
  const nameY = DATA_Y + 96;
  const maxW  = W - PAD * 2;

  let px = 110; // bigger start (was 88)
  ctx.font = `bold ${px}px sans-serif`;
  while (ctx.measureText(displayName.toUpperCase()).width > maxW && px > 44) {
    px -= 2;
    ctx.font = `bold ${px}px sans-serif`;
  }
  const name = trunc(ctx, displayName.toUpperCase(), maxW);

  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';

  // Black drop-shadow
  ctx.shadowColor   = 'rgba(0,0,0,0.99)';
  ctx.shadowBlur    = 18;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle     = '#ffffff';
  ctx.fillText(name, W / 2, nameY);

  // Rarity glow pass
  ctx.shadowColor   = a.glow;
  ctx.shadowBlur    = 40;
  ctx.shadowOffsetY = 0;
  ctx.globalAlpha   = 0.6;
  ctx.fillText(name, W / 2, nameY);

  ctx.restore();
}

// ── Title ─────────────────────────────────────────────────────────────────────

function drawTitle(ctx: SKRSContext2D, title: string, a: RarityAccent) {
  const titleY = DATA_Y + 150;
  const maxW   = W - PAD * 2 - 40;
  let px = 30; // was 26
  ctx.font = `${px}px sans-serif`;
  while (ctx.measureText(title).width > maxW && px > 16) { px--; ctx.font = `${px}px sans-serif`; }

  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor   = 'rgba(0,0,0,0.95)';
  ctx.shadowBlur    = 10;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle     = a.accent;
  ctx.fillText(trunc(ctx, title, maxW), W / 2, titleY);
  ctx.restore();
}

// ── XP progress bar ───────────────────────────────────────────────────────────

function drawXP(ctx: SKRSContext2D, member: MemberProfile, a: RarityAccent): number {
  const XPL   = 250;
  const level = Math.floor(member.xp / XPL) + 1;
  const curXP = member.xp - (level - 1) * XPL;
  const pct   = Math.max(0, Math.min(1, curXP / XPL));

  const y  = DATA_Y + 210;
  const BW = W - PAD * 2;
  const BH = 24; // was 18

  // Level label
  ctx.save();
  ctx.font         = 'bold 18px sans-serif'; // was 15px
  ctx.fillStyle    = a.accent;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor  = a.glow;
  ctx.shadowBlur   = 12;
  ctx.fillText(`Lv ${level}`, PAD, y + 16);
  ctx.restore();

  // XP counter
  ctx.font         = '15px sans-serif'; // was 13px
  ctx.fillStyle    = a.text;
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${curXP} / ${XPL} XP`, W - PAD, y + 16);

  // Track
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  roundRect(ctx, PAD, y + 24, BW, BH, BH / 2);
  ctx.fill();

  // Fill
  const fw = Math.max(BH, BW * pct);
  const fg = ctx.createLinearGradient(PAD, 0, PAD + fw, 0);
  fg.addColorStop(0, a.dim);
  fg.addColorStop(0.6, a.accent);
  fg.addColorStop(1, '#ffffff');
  ctx.save();
  ctx.shadowColor = a.glow;
  ctx.shadowBlur  = 18;
  ctx.fillStyle   = fg;
  roundRect(ctx, PAD, y + 24, fw, BH, BH / 2);
  ctx.fill();
  ctx.restore();

  return y + 24 + BH + 16;
}

// ── Badges ────────────────────────────────────────────────────────────────────

function drawBadges(ctx: SKRSContext2D, member: MemberProfile, a: RarityAccent, startY: number): number {
  if (member.badges.length === 0) return startY;

  const SHOW   = 5;
  const badges = member.badges.slice(0, SHOW);
  const extra  = member.badges.length - SHOW;
  const BH     = 38; // was 36
  const BPAD   = 14;
  const GAP    = 10;

  ctx.font = 'bold 14px sans-serif'; // was 13px
  const dims = badges.map(b => {
    const lbl = b.length > 13 ? b.slice(0, 11) + '…' : b;
    return { lbl, w: Math.max(68, ctx.measureText(lbl).width + BPAD * 2) };
  });

  let totalW = dims.reduce((s, d) => s + d.w + GAP, -GAP);
  if (extra > 0) totalW += 48 + GAP;
  let bx = (W - totalW) / 2;

  for (const { lbl, w } of dims) {
    const bg = ctx.createLinearGradient(bx, startY, bx, startY + BH);
    bg.addColorStop(0, a.accent + '28');
    bg.addColorStop(1, a.accent + '0f');
    ctx.fillStyle = bg;
    roundRect(ctx, bx, startY, w, BH, BH / 2);
    ctx.fill();

    ctx.save();
    ctx.shadowColor = a.glow;
    ctx.shadowBlur  = 10;
    ctx.strokeStyle = a.accent + 'cc';
    ctx.lineWidth   = 1.5;
    roundRect(ctx, bx, startY, w, BH, BH / 2);
    ctx.stroke();
    ctx.restore();

    ctx.font         = 'bold 14px sans-serif';
    ctx.fillStyle    = a.accent;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(lbl, bx + w / 2, startY + BH / 2);
    bx += w + GAP;
  }

  if (extra > 0) {
    const mw = 48;
    ctx.fillStyle   = 'rgba(255,255,255,0.05)';
    roundRect(ctx, bx, startY, mw, BH, BH / 2);
    ctx.fill();
    ctx.strokeStyle = a.accent + '55';
    ctx.lineWidth   = 1;
    roundRect(ctx, bx, startY, mw, BH, BH / 2);
    ctx.stroke();
    ctx.font         = 'bold 14px sans-serif';
    ctx.fillStyle    = a.text;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${extra}`, bx + mw / 2, startY + BH / 2);
  }

  return startY + BH + 12;
}

// ── Flavor text ───────────────────────────────────────────────────────────────

function drawFlavor(ctx: SKRSContext2D, flavorText: string, a: RarityAccent, startY: number): number {
  if (!flavorText) return startY;
  ctx.font         = 'italic 16px sans-serif'; // was 14px
  ctx.fillStyle    = a.text + 'aa';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  const endY = wrap(ctx, `"${flavorText}"`, W / 2, startY + 18, W - PAD * 2 - 20, 22, 2);
  return endY + 20;
}

// ── Footer ────────────────────────────────────────────────────────────────────

function drawFooter(ctx: SKRSContext2D, collectionNumber: number, a: RarityAccent) {
  const fy = H - 26;

  const lg = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  lg.addColorStop(0, 'transparent');
  lg.addColorStop(0.2, a.accent + '44');
  lg.addColorStop(0.8, a.accent + '44');
  lg.addColorStop(1, 'transparent');
  ctx.save();
  ctx.strokeStyle = lg;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, fy - 18);
  ctx.lineTo(W - PAD, fy - 18);
  ctx.stroke();
  ctx.restore();

  ctx.font         = '14px sans-serif'; // was 12px
  ctx.fillStyle    = a.accent + '77';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  const season = process.env.PERSONA_SEASON ?? '1';
  ctx.fillText(
    trunc(ctx, `Card #${String(collectionNumber).padStart(3, '0')}  ·  GLENVEX PERSONA  ·  Season ${season}`, W - PAD * 2),
    W / 2, fy,
  );
}

// ── Card edge border ──────────────────────────────────────────────────────────

function drawCardEdge(ctx: SKRSContext2D, a: RarityAccent) {
  ctx.save();
  ctx.shadowColor = a.glow;
  ctx.shadowBlur  = 28;
  ctx.strokeStyle = a.accent + 'cc';
  ctx.lineWidth   = 3;
  roundRect(ctx, 5, 5, W - 10, H - 10, CORNER_R);
  ctx.stroke();
  ctx.restore();
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function renderPersonaCard(
  card: PersonaCard,
  fullCardImage: string | Buffer | null, // URL string OR raw buffer from gpt-image-1
  member: MemberProfile,
  collectionNumber: number,
  _avatarUrl?: string | null,
): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d') as SKRSContext2D;
  const a      = ACCENT[card.rarity];

  // ─ 1. Clip to card shape ────────────────────────────────────────────────────
  ctx.save();
  roundRect(ctx, 0, 0, W, H, CORNER_R);
  ctx.clip();

  // ─ 2. Base layer: AI card art or mystical fallback ──────────────────────────
  let aiLoaded = false;

  if (fullCardImage) {
    // Accept either a pre-fetched Buffer (from gpt-image-1 b64) or a URL string
    let imgBuf: Buffer | null = null;
    if (Buffer.isBuffer(fullCardImage)) {
      imgBuf = fullCardImage;
    } else if (typeof fullCardImage === 'string') {
      imgBuf = await fetchBuf(fullCardImage);
    }

    if (imgBuf) {
      try {
        const img   = await loadImage(imgBuf);
        const scale = Math.max(W / img.width, H / img.height);
        const dw    = img.width  * scale;
        const dh    = img.height * scale;
        const dx    = (W - dw) / 2;
        const dy    = (H - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);
        aiLoaded = true;
      } catch {}
    }
  }

  if (!aiLoaded) {
    drawMysticalFallback(ctx, card, a);
  }

  // ─ 3. Top rarity banner (always shown — first thing visible in any thumbnail)
  drawTopRarityBanner(ctx, card.rarity, a);

  // ─ 4. Bottom safety gradient (guarantees data readability over AI art) ──────
  drawSafetyPanel(ctx, a);

  // ─ 5. Data overlay ─────────────────────────────────────────────────────────
  drawName(ctx, member.displayName || member.username, a);
  drawTitle(ctx, card.title, a);

  let y = drawXP(ctx, member, a);

  if (member.badges.length > 0) {
    y += 10;
    y = drawBadges(ctx, member, a, y);
  }

  if (card.flavorText) {
    y += 8;
    y = drawFlavor(ctx, card.flavorText, a, y);
  }

  drawFooter(ctx, collectionNumber, a);

  ctx.restore(); // end clip

  // ─ 6. Card edge (drawn outside clip so border is always crisp) ─────────────
  drawCardEdge(ctx, a);

  return canvas.toBuffer('image/png');
}
