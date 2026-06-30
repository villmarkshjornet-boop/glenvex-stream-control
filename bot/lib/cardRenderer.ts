import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import type { MemberProfile } from './memberTracker';
import type { PersonaCard, PersonaRarity, PersonaStats } from './personaService';

// ── Card dimensions ───────────────────────────────────────────────────────────

const W  = 620;
const H  = 960;
const R  = 24; // corner radius

// ── Rarity theme ─────────────────────────────────────────────────────────────

interface RarityTheme {
  bg1: string;      // top gradient stop
  bg2: string;      // bottom gradient stop
  border: string;   // frame color
  glow: string;     // glow rgba
  text: string;     // primary text on dark bg
  accent: string;   // accent color
  banner: string;   // rarity label text
}

const RARITY_THEME: Record<PersonaRarity, RarityTheme> = {
  Common: {
    bg1: '#1a1a1f', bg2: '#0d0d12',
    border: '#6e6e7a', glow: 'rgba(110,110,122,0.35)',
    text: '#e0e0e8', accent: '#9e9eb8',
    banner: '▪ COMMON',
  },
  Rare: {
    bg1: '#0a1628', bg2: '#06101e',
    border: '#1e88e5', glow: 'rgba(30,136,229,0.45)',
    text: '#b3d4ff', accent: '#42a5f5',
    banner: '▸▸ RARE ◂◂',
  },
  Epic: {
    bg1: '#1a0a28', bg2: '#110618',
    border: '#ab47bc', glow: 'rgba(171,71,188,0.5)',
    text: '#e1b3ff', accent: '#ce93d8',
    banner: '◈◈◈ EPIC ◈◈◈',
  },
  Legendary: {
    bg1: '#1f1400', bg2: '#130d00',
    border: '#f9a825', glow: 'rgba(249,168,37,0.55)',
    text: '#ffe082', accent: '#ffca28',
    banner: '✦ LEGENDARY ✦',
  },
  Mythic: {
    bg1: '#1f0000', bg2: '#0d0000',
    border: '#d32f2f', glow: 'rgba(255,80,80,0.6)',
    text: '#ffb3b3', accent: '#ef5350',
    banner: '⚡ M Y T H I C ⚡',
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function statBar(ctx: SKRSContext2D, x: number, y: number, value: number, accent: string, barW = 140) {
  const BAR_H = 9;
  // Background
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, x, y, barW, BAR_H, 4);
  ctx.fill();
  // Fill
  const pct      = Math.max(0, Math.min(1, value / 100));
  const fillW    = Math.max(BAR_H, barW * pct);
  const fillGrad = ctx.createLinearGradient(x, 0, x + fillW, 0);
  fillGrad.addColorStop(0, accent);
  fillGrad.addColorStop(1, accent + 'aa');
  ctx.fillStyle = fillGrad;
  roundRect(ctx, x, y, fillW, BAR_H, 4);
  ctx.fill();
}

function truncateToWidth(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) {
    s = s.slice(0, -1);
  }
  return s + '…';
}

function wrapText(ctx: SKRSContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 3): number {
  const words = text.split(' ');
  let line = '';
  let lines = 0;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      if (lines >= maxLines - 1) {
        ctx.fillText(truncateToWidth(ctx, line, maxWidth), x, y);
        return y;
      }
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
      lines++;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(truncateToWidth(ctx, line, maxWidth), x, y);
  return y;
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch { return null; }
}

function clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }

// ── Main renderer ─────────────────────────────────────────────────────────────

export async function renderPersonaCard(
  card: PersonaCard,
  characterImageUrl: string | null,
  member: MemberProfile,
  collectionNumber: number,
): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');
  const theme  = RARITY_THEME[card.rarity];

  // ── Background ──────────────────────────────────────────────────────────────
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, theme.bg1);
  bgGrad.addColorStop(1, theme.bg2);
  ctx.fillStyle = bgGrad;
  roundRect(ctx, 0, 0, W, H, R);
  ctx.fill();

  // Subtle diagonal texture overlay
  ctx.globalAlpha = 0.03;
  for (let i = -H; i < W + H; i += 18) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + H, H);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // ── Outer glow border ───────────────────────────────────────────────────────
  ctx.shadowColor  = theme.glow;
  ctx.shadowBlur   = 30;
  ctx.strokeStyle  = theme.border;
  ctx.lineWidth    = 3;
  roundRect(ctx, 4, 4, W - 8, H - 8, R - 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // ── Inner frame (inset) ──────────────────────────────────────────────────────
  ctx.strokeStyle = theme.border + '44';
  ctx.lineWidth   = 1;
  roundRect(ctx, 12, 12, W - 24, H - 24, R - 6);
  ctx.stroke();

  // ── Rarity banner (top strip) ────────────────────────────────────────────────
  const bannerGrad = ctx.createLinearGradient(0, 0, W, 0);
  bannerGrad.addColorStop(0,   theme.bg2);
  bannerGrad.addColorStop(0.2, theme.border + 'aa');
  bannerGrad.addColorStop(0.5, theme.border + 'cc');
  bannerGrad.addColorStop(0.8, theme.border + 'aa');
  bannerGrad.addColorStop(1,   theme.bg2);
  ctx.fillStyle = bannerGrad;
  roundRect(ctx, 20, 20, W - 40, 36, 8);
  ctx.fill();

  ctx.fillStyle  = '#ffffff';
  ctx.font       = 'bold 14px sans-serif';
  ctx.textAlign  = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = theme.glow;
  ctx.shadowBlur  = 12;
  ctx.fillText(theme.banner, W / 2, 38);
  ctx.shadowBlur = 0;

  // ── Title (large, with truncation guard) ─────────────────────────────────────
  ctx.fillStyle    = '#ffffff';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';

  const MAX_TITLE_W = W - 60;
  let titleFont = 'bold 28px sans-serif';
  ctx.font = titleFont;
  if (ctx.measureText(card.title).width > MAX_TITLE_W) {
    titleFont = 'bold 22px sans-serif';
    ctx.font  = titleFont;
  }
  if (ctx.measureText(card.title).width > MAX_TITLE_W) {
    titleFont = 'bold 18px sans-serif';
    ctx.font  = titleFont;
  }
  const titleText = truncateToWidth(ctx, card.title, MAX_TITLE_W);
  ctx.shadowColor = theme.accent;
  ctx.shadowBlur  = 16;
  ctx.fillText(titleText, W / 2, 84);
  ctx.shadowBlur = 0;

  // Class · Archetype — truncated to fit
  ctx.fillStyle = theme.accent;
  ctx.font      = '13px sans-serif';
  const classLine = truncateToWidth(ctx, `${card.class}  ·  ${card.archetype}`, W - 60);
  ctx.fillText(classLine, W / 2, 104);

  // ── Character image ──────────────────────────────────────────────────────────
  const IMG_X = 30, IMG_Y = 115, IMG_W = W - 60, IMG_H = 280;

  // Frame around image
  ctx.strokeStyle = theme.border + '88';
  ctx.lineWidth   = 2;
  roundRect(ctx, IMG_X - 2, IMG_Y - 2, IMG_W + 4, IMG_H + 4, 10);
  ctx.stroke();

  if (characterImageUrl) {
    const imgBuf = await fetchImageBuffer(characterImageUrl);
    if (imgBuf) {
      try {
        const img = await loadImage(imgBuf);
        // Clip to rounded rect
        ctx.save();
        roundRect(ctx, IMG_X, IMG_Y, IMG_W, IMG_H, 10);
        ctx.clip();
        // Draw image centered/cropped
        const scale = Math.max(IMG_W / img.width, IMG_H / img.height);
        const dw    = img.width  * scale;
        const dh    = img.height * scale;
        const dx    = IMG_X + (IMG_W - dw) / 2;
        const dy    = IMG_Y + (IMG_H - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);
        ctx.restore();
        // Vignette overlay over image
        const vig = ctx.createLinearGradient(0, IMG_Y + IMG_H * 0.6, 0, IMG_Y + IMG_H);
        vig.addColorStop(0, 'transparent');
        vig.addColorStop(1, theme.bg2 + 'ee');
        ctx.fillStyle = vig;
        roundRect(ctx, IMG_X, IMG_Y, IMG_W, IMG_H, 10);
        ctx.fill();
      } catch {}
    }
  } else {
    // Fallback placeholder
    const placeholderGrad = ctx.createLinearGradient(IMG_X, IMG_Y, IMG_X + IMG_W, IMG_Y + IMG_H);
    placeholderGrad.addColorStop(0, theme.bg1);
    placeholderGrad.addColorStop(1, theme.border + '44');
    ctx.fillStyle = placeholderGrad;
    roundRect(ctx, IMG_X, IMG_Y, IMG_W, IMG_H, 10);
    ctx.fill();
    ctx.fillStyle   = theme.accent + '66';
    ctx.font        = '80px sans-serif';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎭', W / 2, IMG_Y + IMG_H / 2);
  }

  // ── Quote (overlaid on bottom of image) ─────────────────────────────────────
  ctx.fillStyle    = '#ffffffcc';
  ctx.font         = 'italic 12px sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  const shortQuote = card.quote.length > 80 ? card.quote.slice(0, 77) + '...' : card.quote;
  ctx.fillText(`"${shortQuote}"`, W / 2, IMG_Y + IMG_H - 10);

  // ── Section separator ────────────────────────────────────────────────────────
  let curY = IMG_Y + IMG_H + 14;

  const divider = (y: number) => {
    const lineGrad = ctx.createLinearGradient(20, 0, W - 20, 0);
    lineGrad.addColorStop(0, 'transparent');
    lineGrad.addColorStop(0.3, theme.border + '66');
    lineGrad.addColorStop(0.7, theme.border + '66');
    lineGrad.addColorStop(1, 'transparent');
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(20, y);
    ctx.lineTo(W - 20, y);
    ctx.stroke();
  };

  // ── Ultimate Ability ─────────────────────────────────────────────────────────
  ctx.fillStyle    = theme.accent;
  ctx.font         = 'bold 11px sans-serif';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('⚡ ULTIMATE ABILITY', 24, curY + 12);

  ctx.fillStyle = '#ffffff';
  ctx.font      = 'bold 17px sans-serif';
  ctx.fillText(truncateToWidth(ctx, card.signatureMove, W - 48), 24, curY + 32);

  ctx.fillStyle    = theme.text;
  ctx.font         = '11px sans-serif';
  ctx.textBaseline = 'alphabetic';
  wrapText(ctx, card.signatureMoveDesc || '', 24, curY + 48, W - 48, 14, 2);

  curY += 60;
  divider(curY);
  curY += 10;

  // ── Stats (two columns of 5) ─────────────────────────────────────────────────
  // Emoji-free labels for guaranteed consistent canvas width measurement
  const statEntries: [string, number][] = [
    ['HYPE',        card.stats.hype],
    ['HUMOR',       card.stats.humor],
    ['CHAOS',       card.stats.chaos],
    ['COMMUNITY',   card.stats.community],
    ['FOCUS',       card.stats.focus],
    ['AKTIVITET',   card.stats.activity],
    ['KREATIVITET', card.stats.kreativitet],
    ['LOJALITET',   card.stats.loyalitet],
    ['LEDERSKAP',   card.stats.lederskap],
    ['HJELPSOM',    card.stats.helpfulness],
  ];

  const COL1_X     = 24;
  const COL2_X     = W / 2 + 10;
  const LABEL_W    = 88;   // max label width before bar
  const BAR_W_STAT = 120;
  const STAT_ROW_H = 23;

  ctx.font         = 'bold 9px sans-serif';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';

  for (let i = 0; i < statEntries.length; i++) {
    const [label, val] = statEntries[i];
    const col  = i < 5 ? 0 : 1;
    const row  = i % 5;
    const sx   = col === 0 ? COL1_X : COL2_X;
    const sy   = curY + row * STAT_ROW_H;

    // Label (truncated to LABEL_W)
    ctx.fillStyle = theme.text + 'cc';
    ctx.fillText(truncateToWidth(ctx, label, LABEL_W - 4), sx, sy + 6);

    // Bar starts after LABEL_W gap
    const BAR_X = sx + LABEL_W;
    statBar(ctx, BAR_X, sy, val, theme.accent, BAR_W_STAT);

    // Value number
    ctx.fillStyle = theme.accent;
    ctx.font      = 'bold 9px sans-serif';
    ctx.fillText(String(val), BAR_X + BAR_W_STAT + 4, sy + 6);
    ctx.font      = 'bold 9px sans-serif';
  }

  curY += 5 * STAT_ROW_H + 10;
  divider(curY);
  curY += 10;

  // ── Badges ───────────────────────────────────────────────────────────────────
  if (member.badges.length > 0) {
    ctx.fillStyle = theme.accent;
    ctx.font      = 'bold 11px sans-serif';
    ctx.fillText('🏆 BADGES', 24, curY + 12);
    curY += 18;

    const badgesStr = member.badges.slice(-8).join('  ·  ');
    ctx.fillStyle   = theme.text;
    ctx.font        = '11px sans-serif';
    ctx.fillText(badgesStr.slice(0, 85), 24, curY + 10);
    curY += 22;
    divider(curY);
    curY += 10;
  }

  // ── XP Progress bar ──────────────────────────────────────────────────────────
  const XP_PER_LEVEL = 250;
  const level   = Math.floor(member.xp / XP_PER_LEVEL) + 1;
  const levelXP = (level - 1) * XP_PER_LEVEL;
  const nextXP  = level * XP_PER_LEVEL;
  const pct     = clamp((member.xp - levelXP) / XP_PER_LEVEL, 0, 1);

  ctx.fillStyle    = theme.accent;
  ctx.font         = 'bold 11px sans-serif';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Level ${level}`, 24, curY + 12);

  ctx.fillStyle = theme.text;
  ctx.font      = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${member.xp - levelXP} / ${nextXP - levelXP} XP`, W - 24, curY + 12);

  // Full-width XP bar
  const BAR_FULL_W = W - 48;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, 24, curY + 16, BAR_FULL_W, 12, 6);
  ctx.fill();

  const xpFillGrad = ctx.createLinearGradient(24, 0, 24 + BAR_FULL_W * pct, 0);
  xpFillGrad.addColorStop(0, theme.accent);
  xpFillGrad.addColorStop(1, theme.border);
  ctx.fillStyle = xpFillGrad;
  roundRect(ctx, 24, curY + 16, Math.max(12, BAR_FULL_W * pct), 12, 6);
  ctx.fill();

  curY += 34;
  divider(curY);
  curY += 10;

  // ── Flavor text ──────────────────────────────────────────────────────────────
  if (card.flavorText) {
    ctx.fillStyle    = theme.text + 'aa';
    ctx.font         = 'italic 11px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    wrapText(ctx, `"${card.flavorText}"`, W / 2, curY + 12, W - 60, 15, 2);
    curY += 34;
  }

  // ── Footer: collection number + season ───────────────────────────────────────
  ctx.fillStyle    = theme.border + '88';
  ctx.font         = '9px sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  const footerText = `Card #${String(collectionNumber).padStart(3, '0')}  ·  GLENVEX PERSONA  ·  Season: ${process.env.PERSONA_SEASON ?? 'default'}`;
  ctx.fillText(truncateToWidth(ctx, footerText, W - 40), W / 2, H - 14);

  return canvas.toBuffer('image/png');
}
