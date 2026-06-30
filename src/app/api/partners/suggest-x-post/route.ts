import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { partnerNavn } = await req.json().catch(() => ({}));

  const wsId = getWorkspaceId();
  const db   = getDb();
  const apiKey = process.env.OPENAI_API_KEY;

  if (!db)     return NextResponse.json({ error: 'DB utilgjengelig' }, { status: 503 });
  if (!apiKey) return NextResponse.json({ error: 'OpenAI ikke konfigurert' }, { status: 503 });

  // Hent partner (spesifisert eller den mest oversett)
  let partnerQuery = db.from('partners').select('id, navn, beskrivelse, affiliate_url, rabattkode, eksponering, siste_promotert')
    .eq('workspace_id', wsId).eq('aktiv', true);
  if (partnerNavn) partnerQuery = partnerQuery.eq('navn', partnerNavn);

  const { data: allePartnere } = await partnerQuery.limit(10);
  if (!allePartnere?.length) {
    return NextResponse.json({ error: 'Ingen aktive partnere funnet' }, { status: 404 });
  }

  // Velg partner med eldst siste_promotert (lengst ventet)
  const partner = partnerNavn
    ? allePartnere[0]
    : [...allePartnere].sort((a, b) => {
        if (!a.siste_promotert) return -1;
        if (!b.siste_promotert) return 1;
        return new Date(a.siste_promotert).getTime() - new Date(b.siste_promotert).getTime();
      })[0];

  if (!partner) return NextResponse.json({ error: 'Fant ikke partner' }, { status: 404 });

  // Hent workspace for kontekst (kanal-navn etc.)
  const { data: ws } = await db.from('workspaces')
    .select('twitch_login, twitch_display_name, settings_json')
    .eq('id', wsId).single();

  const kanalNavn   = ws?.twitch_display_name ?? ws?.twitch_login ?? 'streameren';
  const dagSiden    = partner.siste_promotert
    ? Math.floor((Date.now() - new Date(partner.siste_promotert).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const kodeInfo    = partner.rabattkode ? ` Kode: ${partner.rabattkode}.` : '';
  const affiliateUrl = partner.affiliate_url ?? null;

  const openai = new OpenAI({ apiKey });

  const prompt = `Du er sosiale medier-ansvarlig for Twitch-streameren ${kanalNavn}. Skriv ett X (Twitter)-innlegg på norsk for å promotere partneren "${partner.navn}".

Partner-info:
- Navn: ${partner.navn}
- Beskrivelse: ${partner.beskrivelse ?? 'ikke oppgitt'}
- Affiliate-lenke: ${affiliateUrl ?? 'mangler (bruk generell nettside)'}
- Rabattkode: ${partner.rabattkode ?? 'ingen'}${kodeInfo}
- Sist promotert: ${dagSiden !== null ? `${dagSiden} dager siden` : 'aldri'}
- Antall promoer totalt: ${partner.eksponering ?? 0}

Krav:
- Maks 280 tegn inkludert emojis og lenke
- Norsk, autentisk streamer-tone — ikke salgsprosa
- Inkluder affiliate-lenken naturlig hvis den finnes
- Avslutt med 1-2 relevante hashtags
- Returner KUN selve innlegget, ingen forklaring eller metakommentar

Analyser: ${dagSiden !== null && dagSiden >= 7 ? `Det er ${dagSiden} dager siden siste promo — god timing for et nytt innlegg.` : dagSiden === null ? 'Partneren har aldri vært promotert — perfekt tidspunkt for debut.' : 'Relativt nylig promotert, men fortsatt verdt å kjøre.'}`;

  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 200,
    temperature: 0.85,
  }).catch(() => null);

  const forslag = res?.choices[0]?.message?.content?.trim() ?? null;
  if (!forslag) return NextResponse.json({ error: 'AI genererte ikke innlegg' }, { status: 500 });

  return NextResponse.json({
    partnerNavn: partner.navn,
    forslag,
    dagSidenPromo: dagSiden,
    affiliateUrl,
    rabattkode: partner.rabattkode ?? null,
    eksponering: partner.eksponering ?? 0,
  });
}
