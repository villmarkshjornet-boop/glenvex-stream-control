import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getPartners } from '@/lib/partners';

export const dynamic = 'force-dynamic';

export async function GET() {
  const partners = await getPartners();
  const totalInntekt = partners.reduce((s, p) => s + (p.estimertInntekt ?? 0), 0);
  const totalKlikk = partners.reduce((s, p) => s + (p.klikk ?? 0), 0);
  const totalEksponering = partners.reduce((s, p) => s + (p.eksponering ?? 0), 0);

  const ranked = [...partners]
    .filter(p => p.aktiv)
    .sort((a, b) => (b.estimertInntekt ?? 0) - (a.estimertInntekt ?? 0));

  const apiKey = process.env.OPENAI_API_KEY;
  let analyse = '';

  if (apiKey && partners.length > 0) {
    try {
      const openai = new OpenAI({ apiKey });
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Analyser disse partner-dataene for streameren GLENVEX og gi 3 konkrete anbefalinger på norsk. Returner KUN JSON: {"anbefalinger": ["...", "...", "..."]}

Partnere:
${partners.map(p => `- ${p.navn}: ${p.eksponering} eksponeringer, ${p.klikk} klikk, ${p.provisjon}% provisjon, ${p.kategori}`).join('\n')}`,
        }],
        max_tokens: 200,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
      analyse = (parsed.anbefalinger ?? []).join('\n\n');
    } catch {}
  }

  return NextResponse.json({ totalInntekt, totalKlikk, totalEksponering, ranked, analyse });
}
