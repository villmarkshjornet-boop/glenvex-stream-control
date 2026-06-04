import fs from 'fs';
import path from 'path';

export interface Partner {
  id: string;
  navn: string;
  logo?: string;
  nettadresse: string;
  affiliateLink: string;
  rabattkode: string;
  beskrivelse: string;
  kategori: string;
  provisjonstype: string;
  provisjon: number;
  avtaleStart: string;
  avtaleSlutt?: string;
  aktiv: boolean;
  featured: boolean;
  ownedBrand: boolean;
  prioritet: number;
  eksponering: number;
  sistePromotert?: string;
  klikk: number;
  estimertInntekt: number;
  kampanjer: any[];
  opprettet: string;
}

const FILE = path.join(process.cwd(), 'data', 'partners.json');

export function getPartners(): Partner[] {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return [];
}

export function savePartners(data: Partner[]) {
  try {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}
