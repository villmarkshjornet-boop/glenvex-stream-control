/**
 * PERSONA CARDS V4 — Hybrid compositor
 *
 * Architecture:
 *   DALL-E generates the ENTIRE artistic card (frame + character + atmosphere + rarity effects)
 *   Canvas ONLY overlays dynamic data: name, title, XP, badges, card number
 *
 * Canvas never draws the artistic elements — that is AI's domain.
 */

import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import type { MemberProfile } from './memberTracker';
import type { PersonaCard, PersonaRarity } from './personaService';

// ── Dimensions — matches DALL-E 3 portrait output ────────────────────────────
const W = 1024;
const H = 1792;

// Panel zone: where the AI leaves a dark area for our data overlay
// We draw our own safety gradient too, so this works regardless of exact AI layout
const PANEL_Y  = 1270;   // where our dark safety panel starts
const DATA_Y   = 1310;   // first data element start y
const CORNER_R = 30;
const PAD      = 52;

// ── Rarity accent tokens (for text glow + bar colors only) ───────────────────
interface RarityAccent {
  accent: string;   // main color (for name glow, bar fill, badge border)
  glow:   string;   // rgba glow
  dim:    string;   // dimmer version
  text:   string;   // secondary text color
}

const ACCENT: Record<PersonaRarity, RarityAccent> = {
  Common:    { accent: '#9898b8', glow: 'rgba(152,152,184,0.45)', dim: '#5a5a78', text: '#9090a8' },
  Rare:      { accent: '#42a5f5', glow: 'rgba(66,165,245,0.55)',  dim: '#1565c0', text: '#7ab8ee' },
  Epic:      { accent: '#e040fb', glow: 'rgba(224,64,251,0.6)',   dim: '#8e24aa', text: '#c080ee' },
  Legendary: { accent: '#ffca28', glow: 'rgba(255,202,40,0.7)',   dim: '#ff8f00', text: '#ffe082' },
  Mythic:    { accent: '#ff5252', glow: 'rgba(255,82,82,0.75)',   dim: '#c50e29', text: '#ffaaaa' },
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

// ── Fallback: Mystical unrevealed card (when DALL-E fails) ───────────────────
// Looks like a face-down "mystery card" — intentional, not a broken placeholder.

function drawMysticalFallback(ctx: SKRSContext2D, rarity: PersonaRarity, a: RarityAccent) {
  // Deep dark background
  const bg = ctx.createRadialGradient(W / 2, H * 0.38, 0, W / 2, H * 0.38, Math.max(W, H) * 0.75);
  bg.addColorStop(0, '#1a1a1a');
  bg.addColorStop(0.45, '#0a0a0a');
  bg.addColorStop(1, '#000000');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Rarity-tinted radial pulse
  const pulse = ctx.createRadialGradient(W / 2, H * 0.38, 0, W / 2, H * 0.38, 420);
  pulse.addColorStop(0, a.accent + '22');
  pulse.addColorStop(0.5, a.accent + '0a');
  pulse.addColorStop(1, 'transparent');
  ctx.fillStyle = pulse;
  ctx.fillRect(0, 0, W, H);

  // Radiating lines
  ctx.save();
  ctx.globalAlpha = 0.055;
  ctx.strokeStyle = a.accent;
  ctx.lineWidth   = 1.5;
  const cx = W / 2, cy = H * 0.38;
  for (let ang = 0; ang < Math.PI * 2; ang += Math.PI / 11) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang) * 900, cy + Math.sin(ang) * 900);
    ctx.stroke();
  }
  ctx.restore();

  // Outer concentric rings (atmosphere)
  for (const [r, alpha] of [[200, 0.12], [320, 0.08], [450, 0.05]] as [number, number][]) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = a.accent;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Central mystical symbol: large question mark / seal
  ctx.save();
  ctx.shadowColor = a.glow;
  ctx.shadowBlur  = 80;
  ctx.fillStyle   = a.accent + 'cc';
  ctx.font        = 'bold 220px sans-serif';
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.55;
  ctx.fillText('?', cx, cy);
  ctx.restore();

  // Inner glow orb
  const orb = ctx.createRadialGradient(cx, cy, 0, cx, cy, 160);
  orb.addColorStop(0, a.accent + '30');
  orb.addColorStop(0.6, a.accent + '10');
  orb.addColorStop(1, 'transparent');
  ctx.fillStyle = orb;
  ctx.fillRect(0, 0, W, H);

  // Rarity label at top (text, since this is fallback)
  ctx.save();
  ctx.shadowColor  = a.glow;
  ctx.shadowBlur   = 25;
  ctx.fillStyle    = a.accent + 'dd';
  ctx.font         = 'bold 22px sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`✦  ${rarity.toUpperCase()}  ✦`, W / 2, 55);
  ctx.restore();

  // "GENERATING" subtitle
  ctx.fillStyle    = a.text + '66';
  ctx.font         = '16px sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Card Art Generating…', W / 2, H * 0.62);
}

// ── Data overlay: safety dark panel ──────────────────────────────────────────
// Guarantees readability regardless of what the AI generated at the bottom.

function drawSafetyPanel(ctx: SKRSContext2D, a: RarityAccent) {
  // Gradient: fades from transparent into near-black
  const g = ctx.createLinearGradient(0, PANEL_Y - 120, 0, H);
  g.addColorStop(0, 'transparent');
  g.addColorStop(0.25, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.82)');
  g.addColorStop(1, 'rgba(0,0,0,0.92)');
  ctx.fillStyle = g;
  ctx.fillRect(0, PANEL_Y - 120, W, H - (PANEL_Y - 120));

  // Thin accent divider line at panel top
  const lg = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  lg.addColorStop(0, 'transparent');
  lg.addColorStop(0.1,  a.accent + '44');
  lg.addColorStop(0.5,  a.accent + '77');
  lg.addColorStop(0.9,  a.accent + '44');
  lg.addColorStop(1, 'transparent');
  ctx.save();
  ctx.strokeStyle = lg;
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(PAD, PANEL_Y + 8);
  ctx.lineTo(W - PAD, PANEL_Y + 8);
  ctx.stroke();
  ctx.restore();
}

// ── Data overlay: name ────────────────────────────────────────────────────────

function drawName(ctx: SKRSContext2D, displayName: string, a: RarityAccent) {
  const nameY  = DATA_Y + 70;
  const maxW   = W - PAD * 2;

  let px = 88;
  ctx.font = `bold ${px}px sans-serif`;
  while (ctx.measureText(displayName.toUpperCase()).width > maxW && px > 36) {
    px -= 2;
    ctx.font = `bold ${px}px sans-serif`;
  }
  const name = trunc(ctx, displayName.toUpperCase(), maxW);

  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  // Black drop-shadow for readability
  ctx.shadowColor   = 'rgba(0,0,0,0.98)';
  ctx.shadowBlur    = 14;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle     = '#ffffff';
  ctx.fillText(name, W / 2, nameY);
  // Rarity glow pass
  ctx.shadowColor   = a.glow;
  ctx.shadowBlur    = 30;
  ctx.shadowOffsetY = 0;
  ctx.globalAlpha   = 0.5;
  ctx.fillText(name, W / 2, nameY);
  ctx.restore();
}

// ── Data overlay: title ───────────────────────────────────────────────────────

function drawTitle(ctx: SKRSContext2D, title: string, a: RarityAccent) {
  const titleY = DATA_Y + 120;
  const maxW   = W - PAD * 2 - 40;
  let px = 26;
  ctx.font = `${px}px sans-serif`;
  while (ctx.measureText(title).width > maxW && px > 14) { px--; ctx.font = `${px}px sans-serif`; }

  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor   = 'rgba(0,0,0,0.95)';
  ctx.shadowBlur    = 8;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle     = a.accent;
  ctx.fillText(trunc(ctx, title, maxW), W / 2, titleY);
  ctx.restore();
}

// ── Data overlay: XP progress bar ────────────────────────────────────────────

function drawXP(ctx: SKRSContext2D, member: MemberProfile, a: RarityAccent): number {
  const XPL   = 250;
  const level = Math.floor(member.xp / XPL) + 1;
  const curXP = member.xp - (level - 1) * XPL;
  const pct   = Math.max(0, Math.min(1, curXP / XPL));

  const y  = DATA_Y + 172;
  const BW = W - PAD * 2;
  const BH = 18;

  // Labels
  ctx.save();
  ctx.font         = 'bold 15px sans-serif';
  ctx.fillStyle    = a.accent;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor  = a.glow;
  ctx.shadowBlur   = 10;
  ctx.fillText(`Level ${level}`, PAD, y + 14);
  ctx.restore();

  ctx.font         = '13px sans-serif';
  ctx.fillStyle    = a.text;
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${curXP} / ${XPL} XP`, W - PAD, y + 14);

  // Track
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, PAD, y + 20, BW, BH, BH / 2);
  ctx.fill();

  // Fill
  const fw = Math.max(BH, BW * pct);
  const fg = ctx.createLinearGradient(PAD, 0, PAD + fw, 0);
  fg.addColorStop(0, a.dim);
  fg.addColorStop(0.6, a.accent);
  fg.addColorStop(1, '#ffffff');
  ctx.save();
  ctx.shadowColor = a.glow;
  ctx.shadowBlur  = 14;
  ctx.fillStyle   = fg;
  roundRect(ctx, PAD, y + 20, fw, BH, BH / 2);
  ctx.fill();
  ctx.restore();

  return y + 20 + BH + 14;
}

// ── Data overlay: badges ──────────────────────────────────────────────────────

function drawBadges(ctx: SKRSContext2D, member: MemberProfile, a: RarityAccent, startY: number): number {
  if (member.badges.length === 0) return startY;

  const SHOW   = 5;
  const badges = member.badges.slice(0, SHOW);
  const extra  = member.badges.length - SHOW;
  const BH     = 36;
  const BPAD   = 14;
  const GAP    = 10;

  ctx.font = 'bold 13px sans-serif';
  const dims = badges.map(b => {
    const lbl = b.length > 13 ? b.slice(0, 11) + '…' : b;
    return { lbl, w: Math.max(64, ctx.measureText(lbl).width + BPAD * 2) };
  });

  let totalW = dims.reduce((s, d) => s + d.w + GAP, -GAP);
  if (extra > 0) totalW += 44 + GAP;
  let bx = (W - totalW) / 2;

  for (const { lbl, w } of dims) {
    const bg = ctx.createLinearGradient(bx, startY, bx, startY + BH);
    bg.addColorStop(0, a.accent + '20');
    bg.addColorStop(1, a.accent + '0c');
    ctx.fillStyle = bg;
    roundRect(ctx, bx, startY, w, BH, BH / 2);
    ctx.fill();

    ctx.save();
    ctx.shadowColor = a.glow;
    ctx.shadowBlur  = 8;
    ctx.strokeStyle = a.accent + 'aa';
    ctx.lineWidth   = 1.5;
    roundRect(ctx, bx, startY, w, BH, BH / 2);
    ctx.stroke();
    ctx.restore();

    ctx.font         = 'bold 13px sans-serif';
    ctx.fillStyle    = a.accent;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(lbl, bx + w / 2, startY + BH / 2);
    bx += w + GAP;
  }

  if (extra > 0) {
    const mw = 44;
    ctx.fillStyle   = 'rgba(255,255,255,0.04)';
    roundRect(ctx, bx, startY, mw, BH, BH / 2);
    ctx.fill();
    ctx.strokeStyle = a.accent + '44';
    ctx.lineWidth   = 1;
    roundRect(ctx, bx, startY, mw, BH, BH / 2);
    ctx.stroke();
    ctx.font         = 'bold 13px sans-serif';
    ctx.fillStyle    = a.text;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${extra}`, bx + mw / 2, startY + BH / 2);
  }

  return startY + BH + 10;
}

// ── Data overlay: flavor text ─────────────────────────────────────────────────

function drawFlavor(ctx: SKRSContext2D, flavorText: string, a: RarityAccent, startY: number): number {
  if (!flavorText) return startY;
  ctx.font         = 'italic 14px sans-serif';
  ctx.fillStyle    = a.text + '99';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  const endY = wrap(ctx, `"${flavorText}"`, W / 2, startY + 16, W - PAD * 2 - 20, 19, 2);
  return endY + 18;
}

// ── Data overlay: footer ──────────────────────────────────────────────────────

function drawFooter(ctx: SKRSContext2D, collectionNumber: number, a: RarityAccent) {
  const fy = H - 24;

  const lg = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
  lg.addColorStop(0, 'transparent');
  lg.addColorStop(0.2, a.accent + '33');
  lg.addColorStop(0.8, a.accent + '33');
  lg.addColorStop(1, 'transparent');
  ctx.save();
  ctx.strokeStyle = lg;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, fy - 16);
  ctx.lineTo(W - PAD, fy - 16);
  ctx.stroke();
  ctx.restore();

  ctx.font         = '12px sans-serif';
  ctx.fillStyle    = a.accent + '66';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  const season = process.env.PERSONA_SEASON ?? '1';
  ctx.fillText(
    trunc(ctx, `Card #${String(collectionNumber).padStart(3, '0')}  ·  GLENVEX PERSONA  ·  Season ${season}`, W - PAD * 2),
    W / 2, fy,
  );
}

// ── Thin card edge (drawn last) ───────────────────────────────────────────────
// Just defines the card boundary — the artistic frame is done by DALL-E.

function drawCardEdge(ctx: SKRSContext2D, a: RarityAccent) {
  ctx.save();
  ctx.shadowColor = a.glow;
  ctx.shadowBlur  = 22;
  ctx.strokeStyle = a.accent + 'bb';
  ctx.lineWidth   = 2.5;
  roundRect(ctx, 6, 6, W - 12, H - 12, CORNER_R);
  ctx.stroke();
  ctx.restore();
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function renderPersonaCard(
  card: PersonaCard,
  fullCardImageUrl: string | null,  // DALL-E full card art (portrait 1024×1792)
  member: MemberProfile,
  collectionNumber: number,
  _avatarUrl?: string | null,       // Kept for interface compat, not used as fallback
): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d') as SKRSContext2D;
  const a      = ACCENT[card.rarity];

  // ─ Base layer: AI card or mystical fallback ─────────────────────────────────
  let aiLoaded = false;

  if (fullCardImageUrl) {
    const buf = await fetchBuf(fullCardImageUrl);
    if (buf) {
      try {
        // Clip to card shape first
        ctx.save();
        roundRect(ctx, 0, 0, W, H, CORNER_R);
        ctx.clip();
        const img   = await loadImage(buf);
        // Scale to fill card (AI outputs 1024×1792 — exact match)
        const scale = Math.max(W / img.width, H / img.height);
        const dw    = img.width  * scale;
        const dh    = img.height * scale;
        const dx    = (W - dw) / 2;
        const dy    = (H - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);
        ctx.restore();
        aiLoaded = true;
      } catch {}
    }
  }

  if (!aiLoaded) {
    ctx.save();
    roundRect(ctx, 0, 0, W, H, CORNER_R);
    ctx.clip();
    drawMysticalFallback(ctx, card.rarity, a);
    ctx.restore();
  }

  // ─ Data overlay (always on top of base layer) ───────────────────────────────
  drawSafetyPanel(ctx, a);
  drawName(ctx, member.displayName || member.username, a);
  drawTitle(ctx, card.title, a);

  let y = drawXP(ctx, member, a);

  if (member.badges.length > 0) {
    y += 8;
    y = drawBadges(ctx, member, a, y);
  }

  if (card.flavorText) {
    y += 6;
    y = drawFlavor(ctx, card.flavorText, a, y);
  }

  drawFooter(ctx, collectionNumber, a);

  // ─ Card edge (very last — always crisp on top) ──────────────────────────────
  drawCardEdge(ctx, a);

  return canvas.toBuffer('image/png');
}
