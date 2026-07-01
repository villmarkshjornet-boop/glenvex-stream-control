/**
 * PERSONA CARDS — Premium TCG Card Renderer
 *
 * Architecture: Canvas owns ALL layout. AI supplies ONLY the character illustration.
 * Layout reference: THE CHATTY NINJA card (locked template).
 *
 * Grid (top → bottom):
 *   HDR   0–72      Header:  rarity · GLENVEX logo · card#
 *   TTL  72–202     Title:   THE CHATTY NINJA / Class subtitle
 *   MET 202–260     Meta:    JOINED date | ROLE
 *   ART 260–816     AI character illustration (window)
 *   LXP 816–924     Level badge + XP bar
 *   STA 932–1112    Stats: 3 colored panels (gap 8)
 *   BMV 1120–1316   Badges | Signature Move (gap 8)
 *   QOT 1324–1424   Quote / flavor text (gap 8)
 *   FTR 1432–1536   Footer: name · LV · XP · Season (gap 8)
 */

import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import * as fs from 'fs';
import { execSync } from 'child_process';
import type { MemberProfile } from './memberTracker';
import type { PersonaCard, PersonaRarity, PersonaStats } from './personaService';
import { loadPersonaImage } from './imageLoader';

// ── Font loading — critical for text rendering on Railway (Linux) ──────────────
// Fonts are installed via aptPkgs in nixpacks.toml → /usr/share/fonts/
// fontconfig finds them there automatically via loadSystemFonts().

const GF = GlobalFonts as any;
try {
  if (typeof GF.loadSystemFonts === 'function') GF.loadSystemFonts();
} catch {}

// Step 2: if loadSystemFonts found nothing, try known apt-installed paths
if (GlobalFonts.families.length === 0) {
  const APT_FONT_PATHS = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
  ];
  for (const fp of APT_FONT_PATHS) {
    if (fs.existsSync(fp)) {
      try { GlobalFonts.registerFromPath(fp, 'sans-serif'); break; } catch {}
    }
  }
}

// Step 3: last resort — use find to locate any TTF on the filesystem
if (GlobalFonts.families.length === 0) {
  try {
    const fp = execSync(
      'find /usr/share/fonts /usr/local/share/fonts /nix -name "*.ttf" 2>/dev/null | head -1',
      { encoding: 'utf8', timeout: 5000 },
    ).trim();
    if (fp) GlobalFonts.registerFromPath(fp, 'sans-serif');
  } catch {}
}

console.log(`[cardRenderer] fonts: ${GlobalFonts.families.length} families`);

// ── Canvas dimensions ─────────────────────────────────────────────────────────
const W = 1024, H = 1536;
const CR = 28;   // card corner radius
const PAD = 12;  // outer gap from card edge to panel
const IPX = 18;  // inner padding inside panels
const PW  = W - PAD * 2;   // 1000
const PBR = 10;  // panel border radius

// ── Strict layout grid ────────────────────────────────────────────────────────
const HDR_Y = 0,    HDR_H = 72;
const TTL_Y = 72,   TTL_H = 130;
const MET_Y = 202,  MET_H = 58;
const LXP_Y = 816,  LXP_H = 108;
const STA_Y = 932,  STA_H = 180;
const BMV_Y = 1120, BMV_H = 196;
const QOT_Y = 1324, QOT_H = 100;
const FTR_Y = 1432, FTR_H = 104;
// Art window: 260–816 (556px)
// Gaps of 8px between LXP→STA, STA→BMV, BMV→QOT, QOT→FTR
// Total: 72+130+58+556+108+8+180+8+196+8+100+8+104 = 1536 ✓

// ── Rarity themes ─────────────────────────────────────────────────────────────
interface Theme {
  border: string;     // neon border / primary glow color
  glow:   string;     // rgba glow for shadow
  accent: string;     // brighter accent for text highlights
  dim:    string;     // dark version for gradient starts
  text:   string;     // secondary text color
  stars:  number;     // how many stars in header
}

const THEME: Record<PersonaRarity, Theme> = {
  Common:    { border: '#39ff14', glow: 'rgba(57,255,20,0.7)',    accent: '#a0ff60', dim: '#1a4a08', text: '#b0d898', stars: 1 },
  Rare:      { border: '#00b8ff', glow: 'rgba(0,184,255,0.7)',    accent: '#60d8ff', dim: '#004880', text: '#90c8ee', stars: 2 },
  Epic:      { border: '#c840ff', glow: 'rgba(200,64,255,0.75)',  accent: '#e080ff', dim: '#5c0890', text: '#cc99ee', stars: 3 },
  Legendary: { border: '#ffb800', glow: 'rgba(255,184,0,0.85)',   accent: '#ffe066', dim: '#7c3800', text: '#ffe090', stars: 4 },
  Mythic:    { border: '#ff3030', glow: 'rgba(255,48,48,0.9)',    accent: '#ff9090', dim: '#7a0000', text: '#ffbbbb', stars: 5 },
};

// Per-stat colors
const STAT_CLR: Partial<Record<keyof PersonaStats, string>> = {
  community:   '#39ff14',
  hype:        '#ff7700',
  chaos:       '#cc44ff',
  focus:       '#00b8ff',
  humor:       '#ffdd00',
  activity:    '#00e5ff',
  helpfulness: '#44ff80',
  kreativitet: '#ff70a0',
  loyalitet:   '#ffb800',
  lederskap:   '#ff5500',
};

// ── Path helpers ──────────────────────────────────────────────────────────────

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
  while (s.length > 1 && ctx.measureText(s + '...').width > maxW) s = s.slice(0, -1);
  return s + '...';
}

function hex(alpha: number): string {
  return Math.round(alpha * 255).toString(16).padStart(2, '0');
}

// ── Panel: dark bg + glowing colored border ───────────────────────────────────

function panel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, t: Theme, bAlpha = 0.6) {
  ctx.save();
  ctx.fillStyle = 'rgba(6,8,18,0.93)';
  roundRect(ctx, x, y, w, h, PBR); ctx.fill();
  ctx.shadowColor = t.glow; ctx.shadowBlur = 18;
  ctx.strokeStyle = t.border + hex(bAlpha);
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, PBR); ctx.stroke();
  ctx.restore();
}

function colorPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.save();
  ctx.fillStyle = 'rgba(6,8,18,0.95)';
  roundRect(ctx, x, y, w, h, PBR); ctx.fill();
  ctx.shadowColor = color + '99'; ctx.shadowBlur = 24;
  ctx.strokeStyle = color + 'dd';
  ctx.lineWidth = 2.5;
  roundRect(ctx, x, y, w, h, PBR); ctx.stroke();
  ctx.restore();
}

// ── Drawn stat icons (no font dependency) ─────────────────────────────────────

function drawStatIcon(ctx: SKRSContext2D, statKey: string, cx: number, cy: number, sz: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.shadowColor = color + '99'; ctx.shadowBlur = 14;
  ctx.lineJoin = 'round';

  switch (statKey) {
    case 'community': {
      // Three circles = group of people
      for (const [dx, dy] of [[0, -0.44], [-0.42, 0.22], [0.42, 0.22]] as [number, number][]) {
        ctx.beginPath();
        ctx.arc(cx + dx * sz, cy + dy * sz, sz * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'hype': {
      // Flame: pointed tip, organic shape
      ctx.beginPath();
      ctx.moveTo(cx, cy - sz * 0.56);                                                // tip
      ctx.bezierCurveTo(cx + sz * 0.14, cy - sz * 0.22, cx + sz * 0.52, cy + sz * 0.1, cx + sz * 0.38, cy + sz * 0.56);
      ctx.quadraticCurveTo(cx, cy + sz * 0.44, cx - sz * 0.38, cy + sz * 0.56);
      ctx.bezierCurveTo(cx - sz * 0.52, cy + sz * 0.1, cx - sz * 0.14, cy - sz * 0.22, cx, cy - sz * 0.56);
      ctx.fill();
      break;
    }
    case 'chaos': {
      // Lightning bolt — wide and punchy
      ctx.beginPath();
      ctx.moveTo(cx + sz * 0.26, cy - sz * 0.56);
      ctx.lineTo(cx - sz * 0.2, cy - sz * 0.02);
      ctx.lineTo(cx + sz * 0.18, cy - sz * 0.02);
      ctx.lineTo(cx - sz * 0.26, cy + sz * 0.56);
      ctx.lineTo(cx + sz * 0.2, cy + sz * 0.02);
      ctx.lineTo(cx - sz * 0.18, cy + sz * 0.02);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'focus': {
      // Crosshair / eye: outer ring + dot
      ctx.lineWidth = sz * 0.12;
      ctx.beginPath(); ctx.arc(cx, cy, sz * 0.46, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, sz * 0.14, 0, Math.PI * 2); ctx.fill();
      // Crosshair lines
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as [number, number][]) {
        ctx.beginPath();
        ctx.moveTo(cx + dx * sz * 0.22, cy + dy * sz * 0.22);
        ctx.lineTo(cx + dx * sz * 0.46, cy + dy * sz * 0.46);
        ctx.stroke();
      }
      break;
    }
    case 'humor': {
      // Smiley face
      ctx.lineWidth = sz * 0.1;
      ctx.beginPath(); ctx.arc(cx, cy, sz * 0.44, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx - sz * 0.16, cy - sz * 0.1, sz * 0.08, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + sz * 0.16, cy - sz * 0.1, sz * 0.08, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy + sz * 0.06, sz * 0.22, 0.15, Math.PI - 0.15); ctx.stroke();
      break;
    }
    case 'lederskap': {
      // Crown (5 points)
      ctx.beginPath();
      ctx.moveTo(cx - sz * 0.48, cy + sz * 0.4);
      ctx.lineTo(cx - sz * 0.48, cy - sz * 0.12);
      ctx.lineTo(cx - sz * 0.24, cy + sz * 0.18);
      ctx.lineTo(cx, cy - sz * 0.52);
      ctx.lineTo(cx + sz * 0.24, cy + sz * 0.18);
      ctx.lineTo(cx + sz * 0.48, cy - sz * 0.12);
      ctx.lineTo(cx + sz * 0.48, cy + sz * 0.4);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'loyalitet': {
      // Shield
      ctx.beginPath();
      ctx.moveTo(cx, cy - sz * 0.52);
      ctx.lineTo(cx + sz * 0.44, cy - sz * 0.26);
      ctx.lineTo(cx + sz * 0.44, cy + sz * 0.08);
      ctx.quadraticCurveTo(cx + sz * 0.44, cy + sz * 0.5, cx, cy + sz * 0.56);
      ctx.quadraticCurveTo(cx - sz * 0.44, cy + sz * 0.5, cx - sz * 0.44, cy + sz * 0.08);
      ctx.lineTo(cx - sz * 0.44, cy - sz * 0.26);
      ctx.closePath(); ctx.fill();
      break;
    }
    default: {
      // Diamond
      ctx.beginPath();
      ctx.moveTo(cx, cy - sz * 0.52);
      ctx.lineTo(cx + sz * 0.46, cy);
      ctx.lineTo(cx, cy + sz * 0.52);
      ctx.lineTo(cx - sz * 0.46, cy);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}

// ── Drawn badge icons ─────────────────────────────────────────────────────────

function drawBadgeIcon(ctx: SKRSContext2D, badge: string, cx: number, cy: number, sz: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';

  const key = badge.toLowerCase().replace(/[\s_-]/g, '');

  if (key.includes('found') || key.includes('ceo') || key.includes('owner')) {
    // Crown
    ctx.beginPath();
    ctx.moveTo(cx - sz * 0.44, cy + sz * 0.36);
    ctx.lineTo(cx - sz * 0.44, cy - sz * 0.08);
    ctx.lineTo(cx - sz * 0.2, cy + sz * 0.16);
    ctx.lineTo(cx, cy - sz * 0.44);
    ctx.lineTo(cx + sz * 0.2, cy + sz * 0.16);
    ctx.lineTo(cx + sz * 0.44, cy - sz * 0.08);
    ctx.lineTo(cx + sz * 0.44, cy + sz * 0.36);
    ctx.closePath(); ctx.fill();
  } else if (key.includes('chat') || key.includes('message') || key.includes('msg')) {
    // Speech bubble
    ctx.beginPath();
    ctx.arc(cx, cy - sz * 0.06, sz * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(6,8,18,0.9)';
    ctx.beginPath();
    ctx.arc(cx - sz * 0.12, cy - sz * 0.06, sz * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + sz * 0.12, cy - sz * 0.06, sz * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    // Tail
    ctx.beginPath();
    ctx.moveTo(cx - sz * 0.12, cy + sz * 0.36);
    ctx.lineTo(cx + sz * 0.18, cy + sz * 0.3);
    ctx.lineTo(cx - sz * 0.26, cy + sz * 0.18);
    ctx.closePath(); ctx.fill();
  } else if (key.includes('voice') || key.includes('mic') || key.includes('audio')) {
    // Microphone body (rounded rect via helper)
    ctx.lineWidth = sz * 0.15;
    roundRect(ctx, cx - sz * 0.16, cy - sz * 0.44, sz * 0.32, sz * 0.58, sz * 0.16);
    ctx.fill();
    ctx.fillStyle = 'rgba(6,8,18,0.9)';
    ctx.beginPath(); ctx.arc(cx, cy - sz * 0.18, sz * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    // Stand
    ctx.lineWidth = sz * 0.1;
    ctx.beginPath();
    ctx.arc(cx, cy, sz * 0.3, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy + sz * 0.3); ctx.lineTo(cx, cy + sz * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - sz * 0.2, cy + sz * 0.5); ctx.lineTo(cx + sz * 0.2, cy + sz * 0.5); ctx.stroke();
  } else if (key.includes('vet') || key.includes('shield') || key.includes('guard')) {
    // Shield
    ctx.beginPath();
    ctx.moveTo(cx, cy - sz * 0.5);
    ctx.lineTo(cx + sz * 0.4, cy - sz * 0.24);
    ctx.lineTo(cx + sz * 0.4, cy + sz * 0.06);
    ctx.quadraticCurveTo(cx + sz * 0.4, cy + sz * 0.48, cx, cy + sz * 0.54);
    ctx.quadraticCurveTo(cx - sz * 0.4, cy + sz * 0.48, cx - sz * 0.4, cy + sz * 0.06);
    ctx.lineTo(cx - sz * 0.4, cy - sz * 0.24);
    ctx.closePath(); ctx.fill();
    // Checkmark on shield
    ctx.strokeStyle = 'rgba(6,8,18,0.9)'; ctx.lineWidth = sz * 0.12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - sz * 0.16, cy + sz * 0.06);
    ctx.lineTo(cx - sz * 0.02, cy + sz * 0.22);
    ctx.lineTo(cx + sz * 0.2, cy - sz * 0.1);
    ctx.stroke();
  } else if (key.includes('mvp') || key.includes('star') || key.includes('best')) {
    // 5-point star
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const ao = (i * Math.PI * 2) / 5 - Math.PI / 2;
      const ai = ao + Math.PI / 5;
      if (i === 0) ctx.moveTo(cx + Math.cos(ao) * sz * 0.48, cy + Math.sin(ao) * sz * 0.48);
      else         ctx.lineTo(cx + Math.cos(ao) * sz * 0.48, cy + Math.sin(ao) * sz * 0.48);
      ctx.lineTo(cx + Math.cos(ai) * sz * 0.2, cy + Math.sin(ai) * sz * 0.2);
    }
    ctx.closePath(); ctx.fill();
  } else if (key.includes('mod') || key.includes('admin')) {
    // Hammer (mod icon)
    ctx.fillRect(cx - sz * 0.36, cy - sz * 0.44, sz * 0.36, sz * 0.22);
    ctx.fillRect(cx - sz * 0.06, cy - sz * 0.28, sz * 0.14, sz * 0.78);
  } else {
    // Default: glowing dot
    ctx.beginPath(); ctx.arc(cx, cy, sz * 0.38, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// ── Hexagonal GLENVEX logo (drawn) ───────────────────────────────────────────

function drawGlenvexHex(ctx: SKRSContext2D, cx: number, cy: number, r: number, t: Theme) {
  ctx.save();
  ctx.shadowColor = t.glow; ctx.shadowBlur = 16;

  // Filled hexagon
  ctx.fillStyle = t.dim;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    i === 0 ? ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
            : ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  ctx.closePath(); ctx.fill();

  // Hexagon stroke
  ctx.strokeStyle = t.border; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    i === 0 ? ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
            : ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  ctx.closePath(); ctx.stroke();

  // "G" text inside
  ctx.font = `bold ${Math.round(r * 1.1)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = t.border;
  ctx.fillText('G', cx, cy + 1);
  ctx.restore();
}

// ── Art gradients ─────────────────────────────────────────────────────────────

function drawArtGradients(ctx: SKRSContext2D) {
  // Top: fade from meta bar bottom into art
  const tg = ctx.createLinearGradient(0, 260, 0, 320);
  tg.addColorStop(0, 'rgba(6,8,18,0.92)');
  tg.addColorStop(1, 'transparent');
  ctx.fillStyle = tg; ctx.fillRect(0, 260, W, 60);

  // Bottom: fade art into level panel
  const bg = ctx.createLinearGradient(0, 716, 0, 816);
  bg.addColorStop(0, 'transparent');
  bg.addColorStop(1, 'rgba(6,8,18,0.97)');
  ctx.fillStyle = bg; ctx.fillRect(0, 716, W, 100);
}

// ── Mystical fallback (when AI image fails) ───────────────────────────────────

function drawMystical(ctx: SKRSContext2D, card: PersonaCard, t: Theme) {
  const bg = ctx.createRadialGradient(W / 2, H * 0.35, 0, W / 2, H * 0.35, 900);
  bg.addColorStop(0, '#0c0f1a'); bg.addColorStop(1, '#040508');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W / 2, H * 0.35, 0, W / 2, H * 0.35, 560);
  glow.addColorStop(0, t.border + '55'); glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = t.glow; ctx.shadowBlur = 90;
  ctx.font = 'bold 200px sans-serif'; ctx.fillStyle = t.border + 'cc';
  ctx.fillText('?', W / 2, H * 0.38);
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 44px sans-serif'; ctx.fillStyle = '#ffffff99';
  ctx.fillText(card.class.toUpperCase(), W / 2, H * 0.55);
  ctx.restore();
}

// ── HEADER ─────────────────────────────────────────────────────────────────────

function drawHeader(ctx: SKRSContext2D, card: PersonaCard, cn: number, t: Theme) {
  panel(ctx, PAD, HDR_Y, PW, HDR_H, t, 0.75);
  const mid = HDR_Y + HDR_H / 2;

  // Center: hexagonal G logo + GLENVEX text
  const logoR = 16;
  const logoX = W / 2 - logoR - 6;
  drawGlenvexHex(ctx, logoX, mid, logoR, t);
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 28px sans-serif'; ctx.fillStyle = '#ffffff';
  ctx.shadowColor = t.glow; ctx.shadowBlur = 20;
  ctx.fillText('GLENVEX', logoX + logoR + 10, mid);
  ctx.restore();

  // Left: stars + rarity
  const STARS = ['', '★', '★★', '★★★', '★★★★', '★★★★★'];
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = t.accent;
  ctx.shadowColor = t.glow; ctx.shadowBlur = 10;
  ctx.fillText(`${STARS[t.stars]}  ${card.rarity.toUpperCase()}`, PAD + IPX, mid);
  ctx.restore();

  // Right: card number
  ctx.save();
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 20px sans-serif'; ctx.fillStyle = t.border + 'cc';
  ctx.fillText(`#${String(cn).padStart(5, '0')}`, PAD + PW - IPX, mid);
  ctx.restore();
}

// ── TITLE ──────────────────────────────────────────────────────────────────────

function drawTitle(ctx: SKRSContext2D, card: PersonaCard, t: Theme) {
  panel(ctx, PAD, TTL_Y, PW, TTL_H, t, 0.5);
  const cx   = W / 2;
  const maxW = PW - IPX * 2;

  // Big title — shrink until it fits
  let px = 72;
  const title = card.title.toUpperCase();
  ctx.font = `bold ${px}px sans-serif`;
  while (ctx.measureText(title).width > maxW && px > 32) { px -= 2; ctx.font = `bold ${px}px sans-serif`; }

  // Double render: solid + glow pass
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.95)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(trunc(ctx, title, maxW), cx, TTL_Y + 86);
  ctx.shadowColor = t.glow; ctx.shadowBlur = 50; ctx.shadowOffsetY = 0; ctx.globalAlpha = 0.45;
  ctx.fillText(trunc(ctx, title, maxW), cx, TTL_Y + 86);
  ctx.restore();

  // Class subtitle in rarity border color
  let cpx = 30;
  const classLabel = card.class.toUpperCase();
  ctx.font = `bold ${cpx}px sans-serif`;
  while (ctx.measureText(classLabel).width > maxW - 60 && cpx > 14) { cpx--; ctx.font = `bold ${cpx}px sans-serif`; }
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = t.glow; ctx.shadowBlur = 18;
  ctx.fillStyle = t.border;
  ctx.fillText(trunc(ctx, classLabel, maxW - 60), cx, TTL_Y + 120);
  ctx.restore();
}

// ── META BAR ──────────────────────────────────────────────────────────────────

function drawMeta(ctx: SKRSContext2D, card: PersonaCard, member: MemberProfile, t: Theme) {
  panel(ctx, PAD, MET_Y, PW, MET_H, t, 0.4);
  const mid = MET_Y + MET_H / 2;

  // Left: JOINED date (draw Discord-like icon as a small circle)
  const joined = (member as any).joinedAt
    ? new Date((member as any).joinedAt as string)
        .toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : null;
  if (joined) {
    // Small circle icon
    ctx.save();
    ctx.fillStyle = t.text + '88';
    ctx.beginPath(); ctx.arc(PAD + IPX + 8, mid, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(6,8,18,0.6)';
    ctx.beginPath(); ctx.arc(PAD + IPX + 8, mid, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 16px sans-serif'; ctx.fillStyle = t.text;
    ctx.fillText(`JOINED  ${joined}`, PAD + IPX + 22, mid);
    ctx.restore();
  }

  // Right: ROLE
  const role = ((member as any).roles?.[0] ?? (member as any).topRole ?? 'Member') as string;
  ctx.save();
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 16px sans-serif'; ctx.fillStyle = t.accent;
  ctx.shadowColor = t.glow; ctx.shadowBlur = 8;
  ctx.fillText(`ROLE  ${role.toUpperCase()}`, PAD + PW - IPX, mid);
  ctx.restore();
}

// ── LEVEL + XP ────────────────────────────────────────────────────────────────

function drawLevelXP(ctx: SKRSContext2D, member: MemberProfile, t: Theme) {
  panel(ctx, PAD, LXP_Y, PW, LXP_H, t);

  const XPL   = 250;
  const level = Math.floor(member.xp / XPL) + 1;
  const curXP = member.xp - (level - 1) * XPL;
  const pct   = Math.max(0, Math.min(1, curXP / XPL));

  // Level badge box
  const bW = 104, bH = LXP_H - 16;
  const bX = PAD + IPX, bY = LXP_Y + 8;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRect(ctx, bX, bY, bW, bH, 8); ctx.fill();
  ctx.shadowColor = t.glow; ctx.shadowBlur = 18;
  ctx.strokeStyle = t.border + 'cc'; ctx.lineWidth = 2;
  roundRect(ctx, bX, bY, bW, bH, 8); ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = t.text;
  ctx.fillText('LEVEL', bX + bW / 2, bY + 22);
  ctx.font = 'bold 52px sans-serif'; ctx.fillStyle = '#ffffff';
  ctx.shadowColor = t.glow; ctx.shadowBlur = 22;
  ctx.fillText(String(level), bX + bW / 2, bY + bH - 4);
  ctx.restore();

  // XP section right of level box
  const rX  = bX + bW + 16;
  const rW  = PW - IPX - bW - 16 - IPX;
  const mid = LXP_Y + LXP_H / 2;

  // XP label + numbers (show total XP / next level threshold like the reference)
  const nextLvlXP = level * XPL;
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = t.border;
  ctx.fillText('XP', rX, mid - 12);
  ctx.font = '17px sans-serif'; ctx.fillStyle = '#aaaaaa';
  ctx.fillText(`  ${member.xp.toLocaleString('no')} / ${nextLvlXP.toLocaleString('no')}`, rX + 28, mid - 12);
  ctx.restore();

  // Bar track
  const barY = mid + 8, barH = 28;
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  roundRect(ctx, rX, barY, rW, barH, barH / 2); ctx.fill();

  // Bar fill (uses within-level pct so bar reflects current level progress)
  const fw = Math.max(barH, rW * pct);
  const fg = ctx.createLinearGradient(rX, 0, rX + fw, 0);
  fg.addColorStop(0, t.dim);
  fg.addColorStop(0.6, t.border);
  fg.addColorStop(1, '#ffffff');
  ctx.save();
  ctx.shadowColor = t.glow; ctx.shadowBlur = 18;
  ctx.fillStyle = fg;
  roundRect(ctx, rX, barY, fw, barH, barH / 2); ctx.fill();
  ctx.restore();
}

// ── STATS (3 colored panels) ──────────────────────────────────────────────────

function drawStats(ctx: SKRSContext2D, stats: PersonaStats, t: Theme) {
  const LABELS: Partial<Record<keyof PersonaStats, string>> = {
    community: 'COMMUNITY', hype: 'HYPE', chaos: 'CHAOS', focus: 'FOCUS',
    humor: 'HUMOR', activity: 'ACTIVE', helpfulness: 'HELP',
    kreativitet: 'CREATE', loyalitet: 'LOYAL', lederskap: 'LEADER',
  };

  const top3 = (Object.entries(stats) as [keyof PersonaStats, number][])
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([key, val]) => ({ key, label: LABELS[key] ?? key.toUpperCase(), value: val }));

  const gapX = 8;
  const colW = Math.floor((PW - gapX * 2) / 3);

  top3.forEach((s, i) => {
    const sx    = PAD + i * (colW + gapX);
    const color = STAT_CLR[s.key] ?? t.border;

    colorPanel(ctx, sx, STA_Y, colW, STA_H, color);

    const icx = sx + colW / 2;

    // Drawn stat icon (no font required)
    drawStatIcon(ctx, s.key as string, icx, STA_Y + 48, 26, color);

    // Big number
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 84px sans-serif'; ctx.fillStyle = '#ffffff';
    ctx.shadowColor = color + 'bb'; ctx.shadowBlur = 30;
    ctx.fillText(String(s.value), icx, STA_Y + 146);
    ctx.restore();

    // Stat label
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 17px sans-serif'; ctx.fillStyle = color;
    ctx.shadowColor = color + '88'; ctx.shadowBlur = 8;
    ctx.fillText(s.label, icx, STA_Y + 170);
    ctx.restore();
  });
}

// ── BADGES + SIGNATURE MOVE ───────────────────────────────────────────────────

function drawBadgesAndMove(ctx: SKRSContext2D, member: MemberProfile, card: PersonaCard, t: Theme) {
  const gapX = 8;
  const bdgW = Math.floor((PW - gapX) * 0.56);
  const mvW  = PW - bdgW - gapX;
  const bx   = PAD;
  const mx   = PAD + bdgW + gapX;

  // ── Badges panel ──────────────────────────────────────────────────────────
  panel(ctx, bx, BMV_Y, bdgW, BMV_H, t);

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = t.accent + 'cc';
  ctx.shadowColor = t.glow; ctx.shadowBlur = 8;
  ctx.fillText('BADGES', bx + bdgW / 2, BMV_Y + 22);
  ctx.restore();

  const badges = member.badges.slice(0, 5);
  if (badges.length === 0) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'italic 15px sans-serif'; ctx.fillStyle = '#444455';
    ctx.fillText('No badges yet', bx + bdgW / 2, BMV_Y + BMV_H / 2);
    ctx.restore();
  } else {
    const avail = bdgW - IPX * 2;
    const d     = Math.min(52, Math.floor((avail - (badges.length - 1) * 8) / badges.length));
    const r     = d / 2;
    const bcy   = BMV_Y + 40 + r;
    let   bsx   = bx + IPX + r;

    for (const badge of badges) {
      // Strip emoji/symbols from badge name so we get clean text for labels + key lookup
      const cleanBadge = badge.replace(/[^\w\s]/g, '').trim();

      // Outer glow ring
      ctx.save();
      ctx.shadowColor = t.glow; ctx.shadowBlur = 18;
      ctx.strokeStyle = t.border; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(bsx, bcy, r, 0, Math.PI * 2); ctx.stroke();
      // Dark fill
      ctx.fillStyle = 'rgba(6,8,18,0.9)';
      ctx.beginPath(); ctx.arc(bsx, bcy, r - 2, 0, Math.PI * 2); ctx.fill();
      // Inner ring
      ctx.strokeStyle = t.accent + '66'; ctx.lineWidth = 1; ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(bsx, bcy, r - 6, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();

      // Badge icon (drawn using clean name for lookup)
      drawBadgeIcon(ctx, cleanBadge, bsx, bcy, r * 0.52, t.accent);

      // Badge name below (clean, no emoji)
      const lbl = (cleanBadge.length > 9 ? cleanBadge.slice(0, 8) + '…' : cleanBadge).toUpperCase();
      const fSz = Math.max(9, Math.round(r * 0.38));
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = `bold ${fSz}px sans-serif`; ctx.fillStyle = t.text + 'aa';
      ctx.fillText(lbl, bsx, bcy + r + 14);
      ctx.restore();

      bsx += d + 8;
    }
  }

  // ── Signature move panel ──────────────────────────────────────────────────
  panel(ctx, mx, BMV_Y, mvW, BMV_H, t);

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = t.accent + 'cc';
  ctx.shadowColor = t.glow; ctx.shadowBlur = 8;
  ctx.fillText('SIGNATURE MOVE', mx + mvW / 2, BMV_Y + 22);
  ctx.restore();

  // Move name with drawn diamond prefix
  const moveName  = card.signatureMove.toUpperCase();
  const mvMaxW    = mvW - IPX * 2;
  let mpx = 24;
  ctx.font = `bold ${mpx}px sans-serif`;
  while (ctx.measureText(moveName).width > mvMaxW - 30 && mpx > 12) { mpx--; ctx.font = `bold ${mpx}px sans-serif`; }

  const mcy      = BMV_Y + 62;
  const nameW    = Math.min(ctx.measureText(moveName).width, mvMaxW - 30);
  const totalW   = nameW + 24;
  const startX   = mx + mvW / 2 - totalW / 2;
  const diamondX = startX + 9;
  const textX    = startX + 24;

  // Diamond shape
  ctx.save();
  ctx.fillStyle = t.border;
  ctx.shadowColor = t.glow; ctx.shadowBlur = 14;
  const ds = mpx * 0.38;
  ctx.beginPath();
  ctx.moveTo(diamondX, mcy - mpx * 0.55);
  ctx.lineTo(diamondX + ds, mcy - mpx * 0.06);
  ctx.lineTo(diamondX, mcy + ds * 0.42);
  ctx.lineTo(diamondX - ds, mcy - mpx * 0.06);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = t.glow; ctx.shadowBlur = 16;
  ctx.font = `bold ${mpx}px sans-serif`; ctx.fillStyle = '#ffffff';
  ctx.fillText(trunc(ctx, moveName, mvMaxW - 30), textX, mcy);
  ctx.restore();

  // Move description
  if (card.signatureMoveDesc) {
    const words = card.signatureMoveDesc.split(' ');
    let line = '', y = BMV_Y + 88;
    ctx.font = 'italic 15px sans-serif';
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = t.text + 'bb';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > mvMaxW && line) {
        ctx.fillText(line, mx + mvW / 2, y);
        line = word; y += 20;
        if (y > BMV_Y + BMV_H - 10) break;
      } else line = test;
    }
    if (line && y <= BMV_Y + BMV_H - 10) ctx.fillText(line, mx + mvW / 2, y);
    ctx.restore();
  }
}

// ── QUOTE ─────────────────────────────────────────────────────────────────────

function drawQuote(ctx: SKRSContext2D, card: PersonaCard, t: Theme) {
  panel(ctx, PAD, QOT_Y, PW, QOT_H, t, 0.35);

  const text = card.flavorText || card.quote || '';
  if (!text) return;

  // Large decorative quote marks (drawn as big characters)
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 58px sans-serif'; ctx.fillStyle = t.border + '55';
  ctx.fillText('"', PAD + IPX, QOT_Y + 64);
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 58px sans-serif'; ctx.fillStyle = t.border + '55';
  ctx.fillText('"', PAD + PW - IPX, QOT_Y + 90);
  ctx.restore();

  // Quote text
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'italic 20px sans-serif'; ctx.fillStyle = '#e0e0e0';
  ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 8;
  ctx.fillText(trunc(ctx, text, PW - IPX * 2 - 64), W / 2, QOT_Y + 58);
  ctx.restore();
}

// ── FOOTER ────────────────────────────────────────────────────────────────────

function drawFooter(ctx: SKRSContext2D, member: MemberProfile, cn: number, t: Theme) {
  panel(ctx, PAD, FTR_Y, PW, FTR_H, t, 0.42);
  const mid = FTR_Y + FTR_H / 2;
  const XPL = 250;
  const lvl = Math.floor(member.xp / XPL) + 1;
  const nm  = (member.displayName || member.username).toUpperCase();
  const sea = process.env.PERSONA_SEASON ?? '1';

  // Person icon (drawn)
  const ix = PAD + IPX + 12;
  ctx.save();
  ctx.fillStyle = t.text + '99';
  ctx.beginPath(); ctx.arc(ix, mid - 5, 6, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.arc(ix, mid + 14, 10, Math.PI, 0); ctx.fill();
  ctx.restore();

  // Username
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 17px sans-serif'; ctx.fillStyle = '#bbbbbb';
  ctx.fillText(trunc(ctx, nm, 220), PAD + IPX + 26, mid);
  ctx.restore();

  // Center: LV · XP
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 17px sans-serif'; ctx.fillStyle = '#dddddd';
  ctx.fillText(`LV ${lvl}  •  ${member.xp.toLocaleString('no')} XP`, W / 2, mid);
  ctx.restore();

  // Season (right)
  ctx.save();
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 17px sans-serif'; ctx.fillStyle = '#bbbbbb';
  ctx.fillText(`SEASON ${sea}`, PAD + PW - IPX, mid);
  ctx.restore();
}

// ── CARD FRAME (outer border with glow) ──────────────────────────────────────

function drawCardFrame(ctx: SKRSContext2D, t: Theme) {
  // Outer glowing border
  ctx.save();
  ctx.shadowColor = t.glow; ctx.shadowBlur = 42;
  ctx.strokeStyle = t.border + 'cc'; ctx.lineWidth = 4;
  roundRect(ctx, 5, 5, W - 10, H - 10, CR); ctx.stroke();
  // Inner thin accent border
  ctx.shadowBlur = 12;
  ctx.strokeStyle = t.accent + '44'; ctx.lineWidth = 1;
  roundRect(ctx, 11, 11, W - 22, H - 22, CR - 5); ctx.stroke();
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
  const t      = THEME[card.rarity];

  // 1. Clip to rounded card shape
  ctx.save();
  roundRect(ctx, 0, 0, W, H, CR);
  ctx.clip();

  // 2. Black base background
  ctx.fillStyle = '#050508';
  ctx.fillRect(0, 0, W, H);

  // 3. AI illustration (fills full canvas, panels overlay it)
  let aiLoaded = false;
  if (fullCardImage) {
    try {
      const { img } = await loadPersonaImage(fullCardImage, '[cardRenderer]');
      const scale   = Math.max(W / img.width, H / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      aiLoaded = true;
    } catch (e: any) {
      console.error('[cardRenderer] image load failed — using fallback:', e?.message);
    }
  }
  if (!aiLoaded) drawMystical(ctx, card, t);

  // 4. Gradient fades (art → panel zones)
  drawArtGradients(ctx);

  // 5. Top panels
  drawHeader(ctx, card, collectionNumber, t);
  drawTitle(ctx, card, t);
  drawMeta(ctx, card, member, t);

  // 6. Bottom data panels (ALL data ALWAYS drawn — missing data is a bug)
  drawLevelXP(ctx, member, t);
  drawStats(ctx, card.stats, t);
  drawBadgesAndMove(ctx, member, card, t);
  drawQuote(ctx, card, t);
  drawFooter(ctx, member, collectionNumber, t);

  ctx.restore(); // end clip

  // 7. Card frame (outside clip — sharp outer edge)
  drawCardFrame(ctx, t);

  return canvas.toBuffer('image/png');
}
