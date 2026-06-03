import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'data', 'rp-notes.json');

export interface RPNote {
  id: string;
  type: 'karakter' | 'relasjon' | 'konflikt' | 'hendelse';
  tittel: string;
  innhold: string;
  karakter?: string;
  dato: string;
  viktig: boolean;
}

function load(): RPNote[] {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return [];
}

function save(data: RPNote[]) {
  try {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

export function getNotes(): RPNote[] { return load(); }
export function getImportantNotes(): RPNote[] { return load().filter(n => n.viktig); }

export function addNote(note: Omit<RPNote, 'id' | 'dato'>): RPNote {
  const notes = load();
  const ny: RPNote = { ...note, id: Date.now().toString(), dato: new Date().toISOString() };
  notes.unshift(ny);
  save(notes);
  return ny;
}

export function deleteNote(id: string) {
  const notes = load().filter(n => n.id !== id);
  save(notes);
}

export function updateNote(id: string, updates: Partial<RPNote>) {
  const notes = load();
  const idx = notes.findIndex(n => n.id === id);
  if (idx >= 0) notes[idx] = { ...notes[idx], ...updates };
  save(notes);
}
