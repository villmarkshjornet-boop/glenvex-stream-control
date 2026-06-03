import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { LogEntry } from '@/types';

const DATA_DIR = path.join(process.cwd(), 'data');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');
const MAX_LOGS = 500;

const READ_ONLY_FS = process.env.VERCEL === '1';

function ensureDataDir(): void {
  if (READ_ONLY_FS) return;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch {}
}

export function getLogs(): LogEntry[] {
  ensureDataDir();
  if (!fs.existsSync(LOGS_FILE)) return [];
  try {
    const raw = fs.readFileSync(LOGS_FILE, 'utf-8');
    return JSON.parse(raw) as LogEntry[];
  } catch {
    return [];
  }
}

export function addLog(
  type: LogEntry['type'],
  message: string,
  status: string = 'OK'
): LogEntry {
  ensureDataDir();
  const logs = getLogs();
  const entry: LogEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    message,
    status,
  };
  logs.unshift(entry);
  if (logs.length > MAX_LOGS) {
    logs.splice(MAX_LOGS);
  }
  try {
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2), 'utf-8');
  } catch {}
  return entry;
}

export function countAlerts(): number {
  return getLogs().filter(
    (l) => l.type === 'success' && l.message.toLowerCase().includes('varsel')
  ).length;
}
