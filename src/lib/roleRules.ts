import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const RULES_FILE = path.join(process.cwd(), 'data', 'role-rules.json');
const LOG_FILE = path.join(process.cwd(), 'data', 'role-change-log.json');

export type RuleStatus = 'aktiv' | 'pause' | 'kun_forslag';
export type RuleTrigger = 'meldinger' | 'level' | 'subs' | 'xp' | 'dager_som_medlem' | 'gjennomsnittsaktivitet';

export interface RoleRule {
  id: string;
  navn: string;
  beskrivelse: string;
  trigger: RuleTrigger;
  terskel: number;
  rolleNavn: string;
  rolleFarge: number;
  status: RuleStatus;
  opprettet: string;
  antallTildelt: number;
}

export interface RoleChangeLog {
  id: string;
  brukerNavn: string;
  brukerId: string;
  rolle: string;
  handling: 'lagt_til' | 'fjernet' | 'foreslått';
  aarsak: string;
  regelId?: string;
  utfortAv: 'bot' | 'admin';
  dato: string;
  godkjent?: boolean;
}

// ── Rules ────────────────────────────────────────────────────────────────────

function loadRules(): RoleRule[] {
  try {
    if (fs.existsSync(RULES_FILE)) return JSON.parse(fs.readFileSync(RULES_FILE, 'utf-8'));
  } catch {}
  return [
    {
      id: 'default-1',
      navn: 'Aktiv Member',
      beskrivelse: 'Gis når bruker har skrevet 100+ meldinger',
      trigger: 'meldinger',
      terskel: 100,
      rolleNavn: 'Aktiv',
      rolleFarge: 0x00aa44,
      status: 'aktiv',
      opprettet: new Date().toISOString(),
      antallTildelt: 0,
    },
    {
      id: 'default-2',
      navn: 'Level 10',
      beskrivelse: 'Gis ved level 10 i XP-systemet',
      trigger: 'level',
      terskel: 10,
      rolleNavn: 'Erfaren',
      rolleFarge: 0x00aaff,
      status: 'aktiv',
      opprettet: new Date().toISOString(),
      antallTildelt: 0,
    },
    {
      id: 'default-3',
      navn: 'Veteran',
      beskrivelse: 'Etter 90 dager som Discord-membre',
      trigger: 'dager_som_medlem',
      terskel: 90,
      rolleNavn: 'Veteran',
      rolleFarge: 0xff8800,
      status: 'aktiv',
      opprettet: new Date().toISOString(),
      antallTildelt: 0,
    },
    {
      id: 'default-4',
      navn: 'Moderator Kandidat',
      beskrivelse: 'Forslås når bruker er meget aktiv og positiv',
      trigger: 'meldinger',
      terskel: 500,
      rolleNavn: 'Mod Kandidat',
      rolleFarge: 0x9146ff,
      status: 'kun_forslag',
      opprettet: new Date().toISOString(),
      antallTildelt: 0,
    },
  ];
}

function saveRules(data: RoleRule[]) {
  try {
    const dir = path.dirname(RULES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(RULES_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

export function getRules(): RoleRule[] { return loadRules(); }

export function saveRuleList(rules: RoleRule[]) { saveRules(rules); }

export function addRule(rule: Omit<RoleRule, 'id' | 'opprettet' | 'antallTildelt'>): RoleRule {
  const rules = loadRules();
  const ny: RoleRule = { ...rule, id: randomUUID(), opprettet: new Date().toISOString(), antallTildelt: 0 };
  rules.push(ny);
  saveRules(rules);
  return ny;
}

export function updateRule(id: string, updates: Partial<RoleRule>): RoleRule | null {
  const rules = loadRules();
  const idx = rules.findIndex(r => r.id === id);
  if (idx < 0) return null;
  rules[idx] = { ...rules[idx], ...updates };
  saveRules(rules);
  return rules[idx];
}

export function deleteRule(id: string) {
  saveRules(loadRules().filter(r => r.id !== id));
}

// ── Log ──────────────────────────────────────────────────────────────────────

function loadLog(): RoleChangeLog[] {
  try {
    if (fs.existsSync(LOG_FILE)) return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
  } catch {}
  return [];
}

function saveLog(data: RoleChangeLog[]) {
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LOG_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

export function getLog(): RoleChangeLog[] { return loadLog(); }

export function addLog(entry: Omit<RoleChangeLog, 'id' | 'dato'>): RoleChangeLog {
  const log = loadLog();
  const ny: RoleChangeLog = { ...entry, id: randomUUID(), dato: new Date().toISOString() };
  log.unshift(ny);
  saveLog(log.slice(0, 200));
  return ny;
}

export function getPendingApprovals(): RoleChangeLog[] {
  return loadLog().filter(l => l.handling === 'foreslått' && l.godkjent === undefined);
}

export function approveProposal(id: string, godkjent: boolean) {
  const log = loadLog();
  const idx = log.findIndex(l => l.id === id);
  if (idx >= 0) {
    log[idx].godkjent = godkjent;
    saveLog(log);
  }
  return log[idx];
}
