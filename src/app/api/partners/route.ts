import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

const FILE = path.join(process.cwd(), 'data', 'partners.json');

export interface Partner {
  id: string;
  navn: string;
  logo?: string;
  nettadresse: string;
  affiliateLink: string;
  rabattkode: string;
  beskrivelse: string;
  kategori: 'gaming' | 'hardware' | 'energidrikk' | 'bil' | 'jakt' | 'ownedBrand' | 'annet';
  provisjonstype: 'fast' | 'prosent';
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
  kampanjer: Kampanje[];
  opprettet: string;
}

export interface Kampanje {
  id: string;
  navn: string;
  budskap: string;
  rabattkode: string;
  startDato: string;
  sluttDato: string;
  aktiv: boolean;
  prioritet: number;
}

function load(): Partner[] {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {}
  return [];
}

function save(data: Partner[]) {
  try {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

export function getPartners() { return load(); }

export async function GET() {
  return NextResponse.json(load());
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Partial<Partner>;
  const partners = load();

  // Kun én featured
  if (body.featured) {
    partners.forEach(p => { p.featured = false; });
  }

  const ny: Partner = {
    id: randomUUID(),
    navn: body.navn ?? '',
    logo: body.logo,
    nettadresse: body.nettadresse ?? '',
    affiliateLink: body.affiliateLink ?? '',
    rabattkode: body.rabattkode ?? '',
    beskrivelse: body.beskrivelse ?? '',
    kategori: body.kategori ?? 'annet',
    provisjonstype: body.provisjonstype ?? 'prosent',
    provisjon: body.provisjon ?? 0,
    avtaleStart: body.avtaleStart ?? new Date().toISOString().split('T')[0],
    avtaleSlutt: body.avtaleSlutt,
    aktiv: body.aktiv ?? true,
    featured: body.featured ?? false,
    ownedBrand: body.ownedBrand ?? false,
    prioritet: body.prioritet ?? 5,
    eksponering: 0,
    klikk: 0,
    estimertInntekt: 0,
    kampanjer: [],
    opprettet: new Date().toISOString(),
  };

  partners.unshift(ny);
  save(partners);
  return NextResponse.json(ny);
}

export async function PATCH(req: NextRequest) {
  const { id, ...updates } = await req.json() as Partial<Partner> & { id: string };
  const partners = load();
  const idx = partners.findIndex(p => p.id === id);
  if (idx < 0) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });

  if (updates.featured) {
    partners.forEach(p => { p.featured = false; });
  }

  partners[idx] = { ...partners[idx], ...updates };
  save(partners);
  return NextResponse.json(partners[idx]);
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  save(load().filter(p => p.id !== id));
  return NextResponse.json({ ok: true });
}
