import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getPartners, savePartners, type Partner } from '@/lib/partners';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getPartners());
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Partial<Partner>;
  const partners = getPartners();

  if (body.featured) partners.forEach(p => { p.featured = false; });

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
  savePartners(partners);
  return NextResponse.json(ny);
}

export async function PATCH(req: NextRequest) {
  const { id, ...updates } = await req.json() as Partial<Partner> & { id: string };
  const partners = getPartners();
  const idx = partners.findIndex(p => p.id === id);
  if (idx < 0) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });

  if (updates.featured) partners.forEach(p => { p.featured = false; });

  partners[idx] = { ...partners[idx], ...updates };
  savePartners(partners);
  return NextResponse.json(partners[idx]);
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  savePartners(getPartners().filter(p => p.id !== id));
  return NextResponse.json({ ok: true });
}
