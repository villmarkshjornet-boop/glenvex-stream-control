/**
 * PERSONA CARDS — Premium TCG Card Renderer
 *
 * Architecture: Canvas owns ALL layout. AI supplies ONLY the illustration.
 * Reference: THE CHATTY NINJA card — all layout decisions derive from it.
 *
 * Grid (top → bottom):
 *   HDR   0–66       Header: rarity · GLENVEX · card#
 *   TTL  66–188      Title: THE CHATTY NINJA / Class  (semi-transparent — char shows through)
 *   MET 188–238      Meta: JOINED | ROLE              (semi-transparent)
 *   ART 238–820      AI character window (582px — more dominant than before)
 *   LXP 820–924      Level badge + XP bar
 *   STA 932–1120     Stats: 3 colored panels          (gap 8)
 *   BMV 1128–1316    Badges | Signature Move          (gap 8)
 *   QOT 1324–1416    Quote / flavor text              (gap 8)
 *   FTR 1424–1536    Footer: name · LV · XP · Season (gap 8)
 */

import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import * as fs from 'fs';
import { execSync } from 'child_process';
import type { MemberProfile } from './memberTracker';
import type { PersonaCard, PersonaRarity, PersonaStats } from './personaService';
import { loadPersonaImage } from './imageLoader';

// ── Font loading ───────────────────────────────────────────────────────────────
const GF = GlobalFonts as any;
try { if (typeof GF.loadSystemFonts === 'function') GF.loadSystemFonts(); } catch {}

if (GlobalFonts.families.length === 0) {
  const FONT_PATHS = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
  ];
  for (const fp of FONT_PATHS) {
    if (fs.existsSync(fp)) { try { GlobalFonts.registerFromPath(fp, 'sans-serif'); break; } catch {} }
  }
  if (GlobalFonts.families.length === 0) {
    try {
      const fp = execSync('find /usr/share/fonts /usr/local/share/fonts /nix -name "*.ttf" 2>/dev/null | head -1', { encoding: 'utf8', timeout: 5000 }).trim();
      if (fp) GlobalFonts.registerFromPath(fp, 'sans-serif');
    } catch {}
  }
}
console.log(`[cardRenderer] fonts: ${GlobalFonts.families.length} families`);

// ── Dimensions ────────────────────────────────────────────────────────────────
const W = 1024, H = 1536;
const CR  = 28;   // card corner radius
const PAD = 12;   // panel outer padding
const IPX = 18;   // panel inner padding
const PW  = W - PAD * 2;  // 1000
const PBR = 10;   // panel corner radius

// ── Strict layout grid ────────────────────────────────────────────────────────
const HDR_Y = 0,    HDR_H = 58;
const TTL_Y = 58,   TTL_H = 155;   // 3 lines: display name → title → class
const MET_Y = 213,  MET_H = 50;
// Art window: 263 → 820 = 557px
const LXP_Y = 820,  LXP_H = 104;
const STA_Y = 932,  STA_H = 188;   // gap 8 before
const BMV_Y = 1128, BMV_H = 188;   // gap 8 before
const QOT_Y = 1324, QOT_H = 92;   // gap 8 before
const FTR_Y = 1424, FTR_H = 112;  // gap 8 before
// 58+155+50+557+104+8+188+8+188+8+92+8+112 = 1536 ✓

// ── Rarity themes ─────────────────────────────────────────────────────────────
interface Theme {
  border: string; glow: string; accent: string; dim: string; text: string; stars: number;
  tier: 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';
}

const THEME: Record<PersonaRarity, Theme> = {
  Common:    { border: '#39ff14', glow: 'rgba(57,255,20,0.7)',    accent: '#a0ff60', dim: '#1a4a08', text: '#b0d898', stars: 1, tier: 'common'    },
  Rare:      { border: '#00b8ff', glow: 'rgba(0,184,255,0.7)',    accent: '#60d8ff', dim: '#004880', text: '#90c8ee', stars: 2, tier: 'rare'      },
  Epic:      { border: '#c840ff', glow: 'rgba(200,64,255,0.75)',  accent: '#e080ff', dim: '#5c0890', text: '#cc99ee', stars: 3, tier: 'epic'      },
  Legendary: { border: '#ffb800', glow: 'rgba(255,184,0,0.85)',   accent: '#ffe066', dim: '#7c3800', text: '#ffe090', stars: 4, tier: 'legendary' },
  Mythic:    { border: '#ff3030', glow: 'rgba(255,48,48,0.9)',    accent: '#ff9090', dim: '#7a0000', text: '#ffbbbb', stars: 5, tier: 'mythic'    },
};

const STAT_CLR: Partial<Record<keyof PersonaStats, string>> = {
  community:   '#39ff14',
  hype:        '#ff7700',
  chaos:       '#c840ff',
  focus:       '#00b8ff',
  humor:       '#ffdd00',
  activity:    '#00e5ff',
  helpfulness: '#44ff80',
  kreativitet: '#ff70a0',
  loyalitet:   '#ffb800',
  lederskap:   '#ff5500',
};

const STAT_LABEL: Partial<Record<keyof PersonaStats, string>> = {
  community: 'COMMUNITY', hype: 'HYPE', chaos: 'CHAOS', focus: 'FOCUS',
  humor: 'HUMOR', activity: 'ACTIVE', helpfulness: 'HELP',
  kreativitet: 'CREATE', loyalitet: 'LOYAL', lederskap: 'LEADER',
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

function hex(a: number) { return Math.round(a * 255).toString(16).padStart(2, '0'); }

// ── Panels ────────────────────────────────────────────────────────────────────

function panel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, t: Theme, bgAlpha = 0.93, borderAlpha = 0.6) {
  ctx.save();
  ctx.fillStyle = `rgba(6,8,18,${bgAlpha})`;
  roundRect(ctx, x, y, w, h, PBR); ctx.fill();
  ctx.shadowColor = t.glow; ctx.shadowBlur = 18;
  ctx.strokeStyle = t.border + hex(borderAlpha);
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, PBR); ctx.stroke();
  ctx.restore();
}

function colorPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.save();
  ctx.fillStyle = 'rgba(6,8,18,0.95)';
  roundRect(ctx, x, y, w, h, PBR); ctx.fill();
  ctx.shadowColor = color + '99'; ctx.shadowBlur = 28;
  ctx.strokeStyle = color + 'dd'; ctx.lineWidth = 2.5;
  roundRect(ctx, x, y, w, h, PBR); ctx.stroke();
  ctx.restore();
}

// ── Stat icons (drawn — no font dependency) ───────────────────────────────────

function statIcon(ctx: SKRSContext2D, key: string, cx: number, cy: number, sz: number, color: string) {
  ctx.save();
  ctx.fillStyle = color; ctx.strokeStyle = color;
  ctx.shadowColor = color + '99'; ctx.shadowBlur = 16;
  ctx.lineJoin = 'round';

  switch (key) {
    case 'community':
      for (const [dx, dy] of [[0, -0.44], [-0.42, 0.22], [0.42, 0.22]] as [number, number][]) {
        ctx.beginPath(); ctx.arc(cx + dx * sz, cy + dy * sz, sz * 0.3, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case 'hype':
      ctx.beginPath();
      ctx.moveTo(cx, cy - sz * 0.56);
      ctx.bezierCurveTo(cx + sz * 0.14, cy - sz * 0.22, cx + sz * 0.52, cy + sz * 0.1, cx + sz * 0.38, cy + sz * 0.56);
      ctx.quadraticCurveTo(cx, cy + sz * 0.44, cx - sz * 0.38, cy + sz * 0.56);
      ctx.bezierCurveTo(cx - sz * 0.52, cy + sz * 0.1, cx - sz * 0.14, cy - sz * 0.22, cx, cy - sz * 0.56);
      ctx.fill(); break;
    case 'chaos':
      ctx.beginPath();
      ctx.moveTo(cx + sz * 0.26, cy - sz * 0.56); ctx.lineTo(cx - sz * 0.2, cy - sz * 0.02);
      ctx.lineTo(cx + sz * 0.18, cy - sz * 0.02); ctx.lineTo(cx - sz * 0.26, cy + sz * 0.56);
      ctx.lineTo(cx + sz * 0.2, cy + sz * 0.02);  ctx.lineTo(cx - sz * 0.18, cy + sz * 0.02);
      ctx.closePath(); ctx.fill(); break;
    case 'focus':
      ctx.lineWidth = sz * 0.12;
      ctx.beginPath(); ctx.arc(cx, cy, sz * 0.46, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, sz * 0.14, 0, Math.PI * 2); ctx.fill();
      for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]] as [number,number][]) {
        ctx.beginPath(); ctx.moveTo(cx+dx*sz*0.22, cy+dy*sz*0.22); ctx.lineTo(cx+dx*sz*0.42, cy+dy*sz*0.42); ctx.stroke();
      } break;
    case 'humor':
      ctx.lineWidth = sz * 0.1;
      ctx.beginPath(); ctx.arc(cx, cy, sz * 0.44, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx-sz*0.16, cy-sz*0.1, sz*0.08, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx+sz*0.16, cy-sz*0.1, sz*0.08, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy+sz*0.06, sz*0.22, 0.15, Math.PI-0.15); ctx.stroke(); break;
    case 'lederskap':
      ctx.beginPath();
      ctx.moveTo(cx-sz*0.46,cy+sz*0.38); ctx.lineTo(cx-sz*0.46,cy-sz*0.1);
      ctx.lineTo(cx-sz*0.22,cy+sz*0.16); ctx.lineTo(cx,cy-sz*0.52);
      ctx.lineTo(cx+sz*0.22,cy+sz*0.16); ctx.lineTo(cx+sz*0.46,cy-sz*0.1);
      ctx.lineTo(cx+sz*0.46,cy+sz*0.38); ctx.closePath(); ctx.fill(); break;
    case 'loyalitet':
      ctx.beginPath();
      ctx.moveTo(cx,cy-sz*0.52); ctx.lineTo(cx+sz*0.42,cy-sz*0.24);
      ctx.lineTo(cx+sz*0.42,cy+sz*0.06);
      ctx.quadraticCurveTo(cx+sz*0.42,cy+sz*0.5,cx,cy+sz*0.56);
      ctx.quadraticCurveTo(cx-sz*0.42,cy+sz*0.5,cx-sz*0.42,cy+sz*0.06);
      ctx.lineTo(cx-sz*0.42,cy-sz*0.24); ctx.closePath(); ctx.fill(); break;
    default:
      ctx.beginPath();
      ctx.moveTo(cx,cy-sz*0.52); ctx.lineTo(cx+sz*0.46,cy);
      ctx.lineTo(cx,cy+sz*0.52); ctx.lineTo(cx-sz*0.46,cy);
      ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// ── Badge icons ───────────────────────────────────────────────────────────────

function badgeIcon(ctx: SKRSContext2D, badge: string, cx: number, cy: number, sz: number, color: string) {
  ctx.save();
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineJoin = 'round';
  const key = badge.toLowerCase().replace(/[^\w]/g, '');

  if (key.includes('found') || key.includes('ceo') || key.includes('owner')) {
    // Crown
    ctx.beginPath();
    ctx.moveTo(cx-sz*0.46,cy+sz*0.36); ctx.lineTo(cx-sz*0.46,cy-sz*0.1);
    ctx.lineTo(cx-sz*0.2,cy+sz*0.16); ctx.lineTo(cx,cy-sz*0.48);
    ctx.lineTo(cx+sz*0.2,cy+sz*0.16); ctx.lineTo(cx+sz*0.46,cy-sz*0.1);
    ctx.lineTo(cx+sz*0.46,cy+sz*0.36); ctx.closePath(); ctx.fill();
  } else if (key.includes('chat') || key.includes('message') || key.includes('msg')) {
    // Speech bubble
    ctx.beginPath(); ctx.arc(cx, cy-sz*0.06, sz*0.44, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(6,8,18,0.88)';
    ctx.beginPath(); ctx.arc(cx-sz*0.14,cy-sz*0.06,sz*0.09,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx+sz*0.14,cy-sz*0.06,sz*0.09,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(cx-sz*0.12,cy+sz*0.4); ctx.lineTo(cx+sz*0.2,cy+sz*0.32); ctx.lineTo(cx-sz*0.28,cy+sz*0.2); ctx.closePath(); ctx.fill();
  } else if (key.includes('voice') || key.includes('mic') || key.includes('audio')) {
    // Microphone
    roundRect(ctx, cx-sz*0.17, cy-sz*0.45, sz*0.34, sz*0.6, sz*0.17); ctx.fill();
    ctx.fillStyle = 'rgba(6,8,18,0.85)';
    ctx.beginPath(); ctx.arc(cx, cy-sz*0.18, sz*0.09, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = sz*0.1;
    ctx.beginPath(); ctx.arc(cx, cy, sz*0.32, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy+sz*0.32); ctx.lineTo(cx, cy+sz*0.52); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx-sz*0.22,cy+sz*0.52); ctx.lineTo(cx+sz*0.22,cy+sz*0.52); ctx.stroke();
  } else if (key.includes('vet') || key.includes('shield') || key.includes('guard')) {
    // Shield with check
    ctx.beginPath();
    ctx.moveTo(cx,cy-sz*0.52); ctx.lineTo(cx+sz*0.42,cy-sz*0.24);
    ctx.lineTo(cx+sz*0.42,cy+sz*0.08);
    ctx.quadraticCurveTo(cx+sz*0.42,cy+sz*0.5,cx,cy+sz*0.56);
    ctx.quadraticCurveTo(cx-sz*0.42,cy+sz*0.5,cx-sz*0.42,cy+sz*0.08);
    ctx.lineTo(cx-sz*0.42,cy-sz*0.24); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(6,8,18,0.88)'; ctx.lineWidth = sz*0.13; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx-sz*0.18,cy+sz*0.06); ctx.lineTo(cx-sz*0.02,cy+sz*0.24); ctx.lineTo(cx+sz*0.22,cy-sz*0.1); ctx.stroke();
  } else if (key.includes('mvp') || key.includes('star') || key.includes('best')) {
    // Star
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const ao = (i * Math.PI * 2) / 5 - Math.PI / 2;
      const ai = ao + Math.PI / 5;
      if (i===0) ctx.moveTo(cx+Math.cos(ao)*sz*0.48, cy+Math.sin(ao)*sz*0.48);
      else        ctx.lineTo(cx+Math.cos(ao)*sz*0.48, cy+Math.sin(ao)*sz*0.48);
      ctx.lineTo(cx+Math.cos(ai)*sz*0.2, cy+Math.sin(ai)*sz*0.2);
    }
    ctx.closePath(); ctx.fill();
  } else if (key.includes('mod') || key.includes('admin')) {
    // Hammer
    ctx.fillRect(cx-sz*0.38, cy-sz*0.46, sz*0.38, sz*0.24);
    ctx.fillRect(cx-sz*0.07, cy-sz*0.28, sz*0.15, sz*0.78);
  } else {
    // Default: diamond
    ctx.beginPath();
    ctx.moveTo(cx,cy-sz*0.5); ctx.lineTo(cx+sz*0.44,cy);
    ctx.lineTo(cx,cy+sz*0.5); ctx.lineTo(cx-sz*0.44,cy);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// ── Medal badge (notched ring — looks like a collectible medal) ───────────────

function drawMedal(ctx: SKRSContext2D, badge: string, cx: number, cy: number, r: number, t: Theme) {
  const NOTCHES = 14;
  const clean   = badge.replace(/[^\w\s]/g, '').trim();

  ctx.save();
  ctx.shadowColor = t.glow; ctx.shadowBlur = 20;

  // Outer notched ring (gear-like)
  const outerR = r, innerR = r * 0.82;
  ctx.fillStyle = t.dim + 'cc';
  ctx.strokeStyle = t.border; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < NOTCHES * 2; i++) {
    const a  = (i * Math.PI) / NOTCHES - Math.PI / 2;
    const ri = i % 2 === 0 ? outerR : innerR;
    i === 0 ? ctx.moveTo(cx + ri * Math.cos(a), cy + ri * Math.sin(a))
            : ctx.lineTo(cx + ri * Math.cos(a), cy + ri * Math.sin(a));
  }
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // Inner dark circle
  ctx.fillStyle = 'rgba(6,8,18,0.92)';
  ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2); ctx.fill();

  // Accent ring
  ctx.strokeStyle = t.accent + '88'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2); ctx.stroke();

  // Icon
  ctx.shadowColor = t.glow; ctx.shadowBlur = 12;
  badgeIcon(ctx, clean, cx, cy, r * 0.44, t.accent);

  ctx.restore();
}

// ── GLENVEX hexagonal logo ────────────────────────────────────────────────────

function glenvexHex(ctx: SKRSContext2D, cx: number, cy: number, r: number, t: Theme) {
  ctx.save();
  ctx.shadowColor = t.glow; ctx.shadowBlur = 16;
  ctx.fillStyle = t.dim;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    i === 0 ? ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
            : ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = t.border; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    i === 0 ? ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
            : ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  ctx.closePath(); ctx.stroke();
  ctx.font = `bold ${Math.round(r * 1.1)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = t.border; ctx.fillText('G', cx, cy + 1);
  ctx.restore();
}

// ── Art gradients ─────────────────────────────────────────────────────────────

function drawArtGradients(ctx: SKRSContext2D) {
  // Top: subtle fade from meta bar into art (panels are semi-transparent so character shows through)
  const tg = ctx.createLinearGradient(0, 238, 0, 290);
  tg.addColorStop(0, 'rgba(6,8,18,0.7)');
  tg.addColorStop(1, 'transparent');
  ctx.fillStyle = tg; ctx.fillRect(0, 238, W, 52);

  // Bottom: hard fade into data panel zone
  const bg = ctx.createLinearGradient(0, 720, 0, 820);
  bg.addColorStop(0, 'transparent');
  bg.addColorStop(1, 'rgba(6,8,18,0.97)');
  ctx.fillStyle = bg; ctx.fillRect(0, 720, W, 100);
}

// ── Rarity corner ornaments (Rare+ only) ─────────────────────────────────────

function drawCornerOrnaments(ctx: SKRSContext2D, t: Theme) {
  if (t.tier === 'common') return;

  const sz   = t.tier === 'mythic' || t.tier === 'legendary' ? 38 : 28;
  const off  = PAD + 6;
  const corners: [number, number, number, number][] = [
    [off, off, 1, 1], [W-off, off, -1, 1],
    [off, H-off, 1, -1], [W-off, H-off, -1, -1],
  ];

  ctx.save();
  ctx.shadowColor = t.glow;
  ctx.strokeStyle = t.border; ctx.lineWidth = 2;
  ctx.fillStyle   = t.border;

  for (const [x, y, sx, sy] of corners) {
    // L-bracket
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(x + sx * sz, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * sz);
    ctx.stroke();

    // Diamond at corner
    if (t.tier === 'legendary' || t.tier === 'mythic') {
      const ds = 7;
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.moveTo(x, y - sy * ds); ctx.lineTo(x + sx * ds, y);
      ctx.lineTo(x, y + sy * ds); ctx.lineTo(x - sx * ds, y);
      ctx.closePath(); ctx.fill();

      // Mythic: extra inner diamond
      if (t.tier === 'mythic') {
        ctx.globalAlpha = 0.5;
        const ds2 = 3;
        ctx.beginPath();
        ctx.moveTo(x, y - sy * ds2); ctx.lineTo(x + sx * ds2, y);
        ctx.lineTo(x, y + sy * ds2); ctx.lineTo(x - sx * ds2, y);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
  ctx.restore();
}

// ── Mystical fallback ─────────────────────────────────────────────────────────

function drawMystical(ctx: SKRSContext2D, card: PersonaCard, t: Theme) {
  const bg = ctx.createRadialGradient(W/2, H*0.35, 0, W/2, H*0.35, 900);
  bg.addColorStop(0, '#0c0f1a'); bg.addColorStop(1, '#040508');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W/2, H*0.35, 0, W/2, H*0.35, 560);
  glow.addColorStop(0, t.border + '55'); glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = t.glow; ctx.shadowBlur = 90;
  ctx.font = 'bold 200px sans-serif'; ctx.fillStyle = t.border + 'cc';
  ctx.fillText('?', W/2, H*0.38); ctx.restore();

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 44px sans-serif'; ctx.fillStyle = '#ffffff99';
  ctx.fillText(card.class.toUpperCase(), W/2, H*0.55); ctx.restore();
}

// ── Section renderers ─────────────────────────────────────────────────────────

function drawHeader(ctx: SKRSContext2D, card: PersonaCard, cn: number, t: Theme) {
  panel(ctx, PAD, HDR_Y, PW, HDR_H, t, 0.90, 0.75);
  const mid = HDR_Y + HDR_H / 2;

  // Center: hex logo + GLENVEX
  const logoR = 15;
  const logoX = W / 2 - logoR - 6;
  glenvexHex(ctx, logoX, mid, logoR, t);
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 26px sans-serif'; ctx.fillStyle = '#ffffff';
  ctx.shadowColor = t.glow; ctx.shadowBlur = 20;
  ctx.fillText('GLENVEX', logoX + logoR + 10, mid);
  ctx.restore();

  // Stars + rarity (left)
  const STARS = ['','★','★★','★★★','★★★★','★★★★★'];
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 19px sans-serif'; ctx.fillStyle = t.accent;
  ctx.shadowColor = t.glow; ctx.shadowBlur = 10;
  ctx.fillText(`${STARS[t.stars]}  ${card.rarity.toUpperCase()}`, PAD + IPX, mid);
  ctx.restore();

  // Card number (right)
  ctx.save();
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 19px sans-serif'; ctx.fillStyle = t.border + 'cc';
  ctx.fillText(`#${String(cn).padStart(5, '0')}`, PAD + PW - IPX, mid);
  ctx.restore();
}

function drawTitle(ctx: SKRSContext2D, card: PersonaCard, member: MemberProfile, t: Theme) {
  // Semi-transparent — character shows through this panel
  panel(ctx, PAD, TTL_Y, PW, TTL_H, t, 0.76, 0.5);
  const cx = W / 2, maxW = PW - IPX * 2;

  // ── Line 1: Display name (server nickname > displayName > username) ──────
  const heroName = (member.nickname ?? member.displayName ?? member.username).toUpperCase();
  let npx = 58;
  ctx.font = `bold ${npx}px sans-serif`;
  while (ctx.measureText(heroName).width > maxW && npx > 28) { npx -= 2; ctx.font = `bold ${npx}px sans-serif`; }

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.98)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(trunc(ctx, heroName, maxW), cx, TTL_Y + 65);
  ctx.restore();

  // ── Line 2: Persona title (THE CHATTY NINJA) ─────────────────────────────
  const title = card.title.toUpperCase();
  let tpx = 46;
  ctx.font = `bold ${tpx}px sans-serif`;
  while (ctx.measureText(title).width > maxW && tpx > 22) { tpx -= 2; ctx.font = `bold ${tpx}px sans-serif`; }

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.95)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(trunc(ctx, title, maxW), cx, TTL_Y + 118);
  ctx.shadowColor = t.glow; ctx.shadowBlur = 40; ctx.shadowOffsetY = 0; ctx.globalAlpha = 0.5;
  ctx.fillText(trunc(ctx, title, maxW), cx, TTL_Y + 118);
  ctx.restore();

  // ── Line 3: Class / archetype ─────────────────────────────────────────────
  const cls = card.class;
  let cpx = 24;
  ctx.font = `bold ${cpx}px sans-serif`;
  while (ctx.measureText(cls.toUpperCase()).width > maxW - 60 && cpx > 12) { cpx--; ctx.font = `bold ${cpx}px sans-serif`; }
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = t.glow; ctx.shadowBlur = 14;
  ctx.fillStyle = t.accent;
  ctx.fillText(trunc(ctx, cls.toUpperCase(), maxW - 60), cx, TTL_Y + 148);
  ctx.restore();
}

function drawMeta(ctx: SKRSContext2D, card: PersonaCard, member: MemberProfile, t: Theme) {
  panel(ctx, PAD, MET_Y, PW, MET_H, t, 0.80, 0.4);
  const mid = MET_Y + MET_H / 2;

  const joined = (member as any).joinedAt
    ? new Date((member as any).joinedAt as string).toLocaleDateString('nb-NO', { day:'2-digit', month:'2-digit', year:'numeric' })
    : null;
  if (joined) {
    ctx.save();
    ctx.fillStyle = t.text + '88';
    ctx.beginPath(); ctx.arc(PAD + IPX + 8, mid, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(6,8,18,0.6)';
    ctx.beginPath(); ctx.arc(PAD + IPX + 8, mid, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 15px sans-serif'; ctx.fillStyle = t.text;
    ctx.fillText(`JOINED  ${joined}`, PAD + IPX + 22, mid);
    ctx.restore();
  }

  const role = (member.topRole || 'MEMBER') as string;
  ctx.save();
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 15px sans-serif'; ctx.fillStyle = t.accent;
  ctx.shadowColor = t.glow; ctx.shadowBlur = 8;
  ctx.fillText(`ROLE  ${role.toUpperCase()}`, PAD + PW - IPX, mid);
  ctx.restore();
}

function drawLevelXP(ctx: SKRSContext2D, member: MemberProfile, t: Theme) {
  panel(ctx, PAD, LXP_Y, PW, LXP_H, t);

  const XPL   = 250;
  const level = Math.floor(member.xp / XPL) + 1;
  const curXP = member.xp - (level - 1) * XPL;
  const pct   = Math.max(0, Math.min(1, curXP / XPL));
  const next  = level * XPL;

  // Level badge box
  const bW = 100, bH = LXP_H - 16, bX = PAD + IPX, bY = LXP_Y + 8;
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
  ctx.fillText('LEVEL', bX + bW / 2, bY + 21);
  ctx.font = 'bold 54px sans-serif'; ctx.fillStyle = '#ffffff';
  ctx.shadowColor = t.glow; ctx.shadowBlur = 22;
  ctx.fillText(String(level), bX + bW / 2, bY + bH - 4);
  ctx.restore();

  // XP bar
  const rX  = bX + bW + 14;
  const rW  = PW - IPX - bW - 14 - IPX;
  const mid = LXP_Y + LXP_H / 2;

  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = t.border;
  ctx.fillText('XP', rX, mid - 12);
  ctx.font = '17px sans-serif'; ctx.fillStyle = '#aaaaaa';
  ctx.fillText(`  ${member.xp.toLocaleString('no')} / ${next.toLocaleString('no')}`, rX + 28, mid - 12);
  ctx.restore();

  const bY2 = mid + 8, bH2 = 28;
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  roundRect(ctx, rX, bY2, rW, bH2, bH2 / 2); ctx.fill();

  const fw = Math.max(bH2, rW * pct);
  const fg = ctx.createLinearGradient(rX, 0, rX + fw, 0);
  fg.addColorStop(0, t.dim); fg.addColorStop(0.6, t.border); fg.addColorStop(1, '#ffffff');
  ctx.save();
  ctx.shadowColor = t.glow; ctx.shadowBlur = 18;
  ctx.fillStyle = fg;
  roundRect(ctx, rX, bY2, fw, bH2, bH2 / 2); ctx.fill();
  ctx.restore();
}

function drawStats(ctx: SKRSContext2D, stats: PersonaStats, t: Theme) {
  const top3 = (Object.entries(stats) as [keyof PersonaStats, number][])
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([key, val]) => ({ key, label: STAT_LABEL[key] ?? key.toUpperCase(), value: val }));

  const gapX = 8, colW = Math.floor((PW - gapX * 2) / 3);

  top3.forEach((s, i) => {
    const sx    = PAD + i * (colW + gapX);
    const color = STAT_CLR[s.key] ?? t.border;
    colorPanel(ctx, sx, STA_Y, colW, STA_H, color);
    const icx = sx + colW / 2;

    // Icon (drawn — no font dependency)
    statIcon(ctx, s.key as string, icx, STA_Y + 50, 28, color);

    // BIG number — the hero element
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 100px sans-serif'; ctx.fillStyle = '#ffffff';
    ctx.shadowColor = color + 'bb'; ctx.shadowBlur = 36;
    ctx.fillText(String(s.value), icx, STA_Y + 156);
    ctx.restore();

    // Stat label — smaller, bold, colored
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 15px sans-serif'; ctx.fillStyle = color;
    ctx.shadowColor = color + '88'; ctx.shadowBlur = 8;
    ctx.fillText(s.label, icx, STA_Y + 178);
    ctx.restore();
  });
}

function drawBadgesAndMove(ctx: SKRSContext2D, member: MemberProfile, card: PersonaCard, t: Theme) {
  const gapX = 8;
  const bdgW = Math.floor((PW - gapX) * 0.54);
  const mvW  = PW - bdgW - gapX;
  const bx   = PAD, mx = PAD + bdgW + gapX;

  // ── Badges ────────────────────────────────────────────────────────────────
  panel(ctx, bx, BMV_Y, bdgW, BMV_H, t);
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = t.accent + 'cc';
  ctx.shadowColor = t.glow; ctx.shadowBlur = 8;
  ctx.fillText('BADGES', bx + bdgW / 2, BMV_Y + 20);
  ctx.restore();

  const badges = member.badges.slice(0, 5);
  if (badges.length === 0) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'italic 14px sans-serif'; ctx.fillStyle = '#444455';
    ctx.fillText('No badges yet', bx + bdgW / 2, BMV_Y + BMV_H / 2);
    ctx.restore();
  } else {
    const avail = bdgW - IPX * 2;
    const d     = Math.min(54, Math.floor((avail - (badges.length - 1) * 8) / badges.length));
    const r     = d / 2;
    const bcy   = BMV_Y + 36 + r;
    let   bsx   = bx + IPX + r;

    for (const badge of badges) {
      const clean = badge.replace(/[^\w\s]/g, '').trim();
      drawMedal(ctx, clean, bsx, bcy, r, t);

      const lbl = (clean.length > 9 ? clean.slice(0, 8) + '…' : clean).toUpperCase();
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = `bold ${Math.max(9, Math.round(r * 0.36))}px sans-serif`;
      ctx.fillStyle = t.text + 'aa';
      ctx.fillText(lbl, bsx, bcy + r + 14);
      ctx.restore();

      bsx += d + 8;
    }
  }

  // ── Signature Move ────────────────────────────────────────────────────────
  panel(ctx, mx, BMV_Y, mvW, BMV_H, t);
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = t.accent + 'cc';
  ctx.shadowColor = t.glow; ctx.shadowBlur = 8;
  ctx.fillText('SIGNATURE MOVE', mx + mvW / 2, BMV_Y + 20);
  ctx.restore();

  const moveName = card.signatureMove.toUpperCase();
  const mvMaxW   = mvW - IPX * 2;
  let mpx = 24;
  ctx.font = `bold ${mpx}px sans-serif`;
  while (ctx.measureText(moveName).width > mvMaxW - 28 && mpx > 12) { mpx--; ctx.font = `bold ${mpx}px sans-serif`; }

  const mcy   = BMV_Y + 60;
  const nameW = Math.min(ctx.measureText(moveName).width, mvMaxW - 28);
  const dLeft = mx + mvW / 2 - nameW / 2 - 16;

  // Diamond prefix
  ctx.save();
  ctx.fillStyle = t.border; ctx.shadowColor = t.glow; ctx.shadowBlur = 14;
  const ds = mpx * 0.4;
  ctx.beginPath();
  ctx.moveTo(dLeft, mcy - mpx * 0.56); ctx.lineTo(dLeft + ds, mcy - mpx * 0.1);
  ctx.lineTo(dLeft, mcy + ds * 0.44);  ctx.lineTo(dLeft - ds, mcy - mpx * 0.1);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = `bold ${mpx}px sans-serif`; ctx.fillStyle = '#ffffff';
  ctx.shadowColor = t.glow; ctx.shadowBlur = 16;
  ctx.fillText(trunc(ctx, moveName, mvMaxW - 28), dLeft + ds + 6, mcy);
  ctx.restore();

  if (card.signatureMoveDesc) {
    const words = card.signatureMoveDesc.split(' ');
    let   line = '', y = BMV_Y + 84;
    ctx.font = 'italic 15px sans-serif';
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = t.text + 'bb';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > mvMaxW && line) {
        ctx.fillText(line, mx + mvW / 2, y); line = word; y += 20;
        if (y > BMV_Y + BMV_H - 12) break;
      } else line = test;
    }
    if (line && y <= BMV_Y + BMV_H - 12) ctx.fillText(line, mx + mvW / 2, y);
    ctx.restore();
  }
}

function drawQuote(ctx: SKRSContext2D, card: PersonaCard, t: Theme) {
  panel(ctx, PAD, QOT_Y, PW, QOT_H, t, 0.92, 0.35);
  const text = card.flavorText || card.quote || '';
  if (!text) return;

  // Decorative quote marks
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 56px sans-serif'; ctx.fillStyle = t.border + '55';
  ctx.fillText('"', PAD + IPX, QOT_Y + 60);
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 56px sans-serif'; ctx.fillStyle = t.border + '55';
  ctx.fillText('"', PAD + PW - IPX, QOT_Y + 84);
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = 'italic 20px sans-serif'; ctx.fillStyle = '#e8e8e8';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 10;
  ctx.fillText(trunc(ctx, text, PW - IPX * 2 - 60), W / 2, QOT_Y + 56);
  ctx.restore();
}

function drawFooter(ctx: SKRSContext2D, member: MemberProfile, cn: number, t: Theme) {
  panel(ctx, PAD, FTR_Y, PW, FTR_H, t, 0.90, 0.42);
  const mid = FTR_Y + FTR_H / 2;
  const XPL = 250;
  const lvl = Math.floor(member.xp / XPL) + 1;
  const nm  = (member.nickname ?? member.displayName ?? member.username).toUpperCase();
  const sea = process.env.PERSONA_SEASON ?? '1';

  // Person icon (drawn)
  ctx.save();
  ctx.fillStyle = t.text + '99';
  const ix = PAD + IPX + 10;
  ctx.beginPath(); ctx.arc(ix, mid - 6, 7, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(ix, mid + 14, 12, Math.PI, 0); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = '#cccccc';
  ctx.fillText(trunc(ctx, nm, 220), PAD + IPX + 24, mid);
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = '#dddddd';
  ctx.fillText(`LV ${lvl}  •  ${member.xp.toLocaleString('no')} XP`, W / 2, mid);
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = '#cccccc';
  ctx.fillText(`SEASON ${sea}`, PAD + PW - IPX, mid);
  ctx.restore();
}

function drawCardFrame(ctx: SKRSContext2D, t: Theme) {
  ctx.save();

  // Outer glow
  ctx.shadowColor = t.glow;
  ctx.shadowBlur = t.tier === 'legendary' || t.tier === 'mythic' ? 55 : 40;
  ctx.strokeStyle = t.border + 'cc'; ctx.lineWidth = 4;
  roundRect(ctx, 5, 5, W - 10, H - 10, CR); ctx.stroke();

  // Secondary inner border (Epic+)
  if (t.tier !== 'common' && t.tier !== 'rare') {
    ctx.shadowBlur = 14;
    ctx.strokeStyle = t.accent + '55'; ctx.lineWidth = 1.5;
    roundRect(ctx, 11, 11, W - 22, H - 22, CR - 5); ctx.stroke();
  }

  // Tertiary innermost line (Legendary/Mythic)
  if (t.tier === 'legendary' || t.tier === 'mythic') {
    ctx.shadowBlur = 8;
    ctx.strokeStyle = '#ffffff22'; ctx.lineWidth = 1;
    roundRect(ctx, 17, 17, W - 34, H - 34, CR - 10); ctx.stroke();
  }
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

  ctx.save();
  roundRect(ctx, 0, 0, W, H, CR); ctx.clip();

  ctx.fillStyle = '#050508'; ctx.fillRect(0, 0, W, H);

  // AI illustration (fills full canvas — character shows through top panels)
  let aiLoaded = false;
  if (fullCardImage) {
    try {
      const { img } = await loadPersonaImage(fullCardImage, '[cardRenderer]');
      const scale   = Math.max(W / img.width, H / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      aiLoaded = true;
    } catch (e: any) {
      console.error('[cardRenderer] image failed:', e?.message);
    }
  }
  if (!aiLoaded) drawMystical(ctx, card, t);

  drawArtGradients(ctx);

  // Top panels (semi-transparent → character shows through)
  drawHeader(ctx, card, collectionNumber, t);
  drawTitle(ctx, card, member, t);
  drawMeta(ctx, card, member, t);

  // Data panels (opaque — all data always rendered)
  drawLevelXP(ctx, member, t);
  drawStats(ctx, card.stats, t);
  drawBadgesAndMove(ctx, member, card, t);
  drawQuote(ctx, card, t);
  drawFooter(ctx, member, collectionNumber, t);

  ctx.restore();

  // Card frame + corner ornaments (outside clip)
  drawCardFrame(ctx, t);
  drawCornerOrnaments(ctx, t);

  return canvas.toBuffer('image/png');
}
