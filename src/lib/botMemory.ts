import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'data', 'bot-memory.json');
const SETTINGS_FILE = path.join(process.cwd(), 'data', 'bot-settings.json');

export interface BotMemoryEntry {
  type: string;
  innhold: string;
  kanal?: string;
  partner?: string;
  dato: string;
}

export interface BotSettings {
  tone: 'cinematic' | 'humoristisk' | 'dark_gaming' | 'rp_stil' | 'profesjonell' | 'hype';
  pauseDiscord: boolean;
  pauseTwitch: boolean;
  pausePartnerPromo: boolean;
  pauseLiveVarsler: boolean;
  pauseProaktiv: boolean;
  aktiv: boolean;
}

const DEFAULT_SETTINGS: BotSettings = {
  tone: 'dark_gaming',
  pauseDiscord: false,
  pauseTwitch: false,
  pausePartnerPromo: false,
  pauseLiveVarsler: false,
  pauseProaktiv: false,
  aktiv: true,
};

// ── Memory ──────────────────────────────────────────────────────────────────

function loadMemory(): BotMemoryEntry[] {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return [];
}

function saveMemory(data: BotMemoryEntry[]) {
  try {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

export function addToMemory(entry: Omit<BotMemoryEntry, 'dato'>) {
  const memory = loadMemory();
  memory.unshift({ ...entry, dato: new Date().toISOString() });
  saveMemory(memory.slice(0, 200)); // Maks 200 entries
}

export function getRecentMemory(type?: string, limit = 10): BotMemoryEntry[] {
  const memory = loadMemory();
  if (type) return memory.filter(m => m.type === type).slice(0, limit);
  return memory.slice(0, limit);
}

export function harPublisertNylig(type: string, innholdFragment: string, timerSiden = 24): boolean {
  const cutoff = Date.now() - timerSiden * 60 * 60 * 1000;
  return loadMemory().some(m =>
    m.type === type &&
    m.innhold.toLowerCase().includes(innholdFragment.toLowerCase()) &&
    new Date(m.dato).getTime() > cutoff
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function getBotSettings(): BotSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) };
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

export function saveBotSettings(settings: Partial<BotSettings>) {
  try {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const current = getBotSettings();
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...current, ...settings }, null, 2), 'utf-8');
  } catch {}
}

// ── Personality prompts ───────────────────────────────────────────────────────

export function getPersonalityPrompt(): string {
  const { tone } = getBotSettings();
  const toner: Record<string, string> = {
    cinematic: 'Cinematisk og dramatisk tone. Korte, slagkraftige setninger. Som en film-trailer.',
    humoristisk: 'Lett, humoristisk og litt selvironisk. Vennlig og inkluderende.',
    dark_gaming: 'Mørk, rå gaming-vibe. Direkte og ufiltrert. Hacker-estetikk.',
    rp_stil: 'Fortellende, RP-inspirert. Snakk som en karakter i spillet.',
    profesjonell: 'Profesjonell og ryddig. Kort og informativ. Ingen slang.',
    hype: 'Ekstremt hype og energisk. Caps, utropstegn, emojis. Alt er episk.',
  };
  return `Skriv i denne tonen: ${toner[tone] ?? toner.dark_gaming}`;
}
