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

function statBar(ctx: SKRSContext2D, x: number, y: number, value: number, accent: string) {
  const BAR_W = 140, BAR_H = 10;
  // Background
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, x, y, BAR_W, BAR_H, 5);
  ctx.fill();
  // Fill
  const pct = Math.max(0, Math.min(1, value / 100));
  const fillGrad = ctx.createLinearGradient(x, 0, x + BAR_W * pct, 0);
  fillGrad.addColorStop(0, accent);
  fillGrad.addColorStop(1, accent + 'aa');
  ctx.fillStyle = fillGrad;
  roundRect(ctx, x, y, Math.max(BAR_H, BAR_W * pct), BAR_H, 5);
  ctx.fill();
}

function wrapText(ctx: SKRSContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(' ');
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);
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

  // ── Title (large) ────────────────────────────────────────────────────────────
  ctx.fillStyle    = '#ffffff';
  ctx.font         = 'bold 28px sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';

  const titleFits  = ctx.measureText(card.title).width < W - 60;
  if (!titleFits) ctx.font = 'bold 22px sans-serif';
  ctx.shadowColor = theme.accent;
  ctx.shadowBlur  = 16;
  ctx.fillText(card.title, W / 2, 84);
  ctx.shadowBlur = 0;

  // Class · Archetype
  ctx.fillStyle = theme.accent;
  ctx.font      = '13px sans-serif';
  ctx.fillText(`${card.class}  ·  ${card.archetype}`, W / 2, 104);

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
  ctx.fillText(card.signatureMove, 24, curY + 32);

  ctx.fillStyle = theme.text;
  ctx.font      = '11px sans-serif';
  const descShort = (card.signatureMoveDesc || '').slice(0, 80);
  ctx.fillText(descShort, 24, curY + 48);

  curY += 60;
  divider(curY);
  curY += 10;

  // ── Stats (two columns of 5) ─────────────────────────────────────────────────
  const statEntries: [string, number][] = [
    ['🔥 Hype',      card.stats.hype],
    ['😂 Humor',     card.stats.humor],
    ['⚡ Chaos',     card.stats.chaos],
    ['🤝 Community', card.stats.community],
    ['🎯 Focus',     card.stats.focus],
    ['💬 Aktivitet', card.stats.activity],
    ['💡 Kreativitet',card.stats.kreativitet],
    ['❤️ Lojalitet',  card.stats.loyalitet],
    ['🧠 Lederskap', card.stats.lederskap],
    ['🙌 Hjelpsom',  card.stats.helpfulness],
  ];

  const COL1_X = 24, COL2_X = W / 2 + 10;
  const STAT_ROW_H = 24;

  ctx.font      = '11px sans-serif';
  ctx.textAlign = 'left';

  for (let i = 0; i < statEntries.length; i++) {
    const [label, val] = statEntries[i];
    const col  = i < 5 ? 0 : 1;
    const row  = i % 5;
    const sx   = col === 0 ? COL1_X : COL2_X;
    const sy   = curY + row * STAT_ROW_H;

    ctx.fillStyle    = theme.text;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, sx, sy + 6);

    const BAR_X = col === 0 ? COL1_X + 100 : COL2_X + 100;
    statBar(ctx, BAR_X, sy, val, theme.accent);

    ctx.fillStyle = theme.accent;
    ctx.font      = 'bold 10px sans-serif';
    ctx.fillText(String(val), BAR_X + 146, sy + 6);
    ctx.font      = '11px sans-serif';
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
    const ft = card.flavorText.length > 100 ? card.flavorText.slice(0, 97) + '...' : card.flavorText;
    wrapText(ctx, `"${ft}"`, W / 2, curY + 12, W - 60, 16);
    curY += 30;
  }

  // ── Footer: collection number + season ───────────────────────────────────────
  ctx.fillStyle    = theme.border + '88';
  ctx.font         = '10px sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Card #${String(collectionNumber).padStart(3, '0')}  ·  GLENVEX PERSONA  ·  Season: ${process.env.PERSONA_SEASON ?? 'default'}`, W / 2, H - 16);

  return canvas.toBuffer('image/png');
}
