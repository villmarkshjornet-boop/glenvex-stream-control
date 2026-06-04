import { NextRequest, NextResponse } from 'next/server';
import { getPartners, createPartner, updatePartner, deletePartner } from '@/lib/partners';

export const dynamic = 'force-dynamic';

export async function GET() {
  const partners = await getPartners();
  return NextResponse.json(partners);
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  // Kun én featured om gangen
  if (body.featured) {
    const all = await getPartners();
    for (const p of all.filter(p => p.featured)) {
      await updatePartner(p.id, { featured: false });
    }
  }

  const ny = await createPartner({
    navn: body.navn ?? '',
    logo: body.logo,
    nettadresse: body.nettadresse ?? '',
    affiliateLink: body.affiliateLink ?? '',
    rabattkode: body.rabattkode ?? '',
    beskrivelse: body.beskrivelse ?? '',
    kategori: body.kategori ?? 'annet',
    provisjonstype: body.provisjonstype ?? 'prosent',
    provisjon: body.provisjon ?? 0,
    avtaleStart: body.avtaleStart,
    avtaleSlutt: body.avtaleSlutt,
    aktiv: body.aktiv ?? true,
    featured: body.featured ?? false,
    ownedBrand: body.ownedBrand ?? false,
    prioritet: body.prioritet ?? 5,
    eksponering: 0,
    klikk: 0,
    estimertInntekt: 0,
    kampanjer: [],
  });

  if (!ny) return NextResponse.json({ error: 'Kunne ikke opprette partner' }, { status: 500 });
  return NextResponse.json(ny);
}

export async function PATCH(req: NextRequest) {
  const { id, ...updates } = await req.json();
  if (updates.featured) {
    const all = await getPartners();
    for (const p of all.filter(p => p.featured && p.id !== id)) {
      await updatePartner(p.id, { featured: false });
    }
  }
  const updated = await updatePartner(id, updates);
  if (!updated) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  await deletePartner(id);
  return NextResponse.json({ ok: true });
}
