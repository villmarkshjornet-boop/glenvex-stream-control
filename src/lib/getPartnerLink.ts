/**
 * Vercel-side partner link helper.
 * Henter affiliate_link med streng enforcement.
 */

import { getDb } from '@/lib/db';

export interface PartnerLinkResult {
  navn: string;
  affiliateUrl: string | null;
  fallbackUrl: string | null;
  finalUrl: string | null;
  rabattkode: string | null;
  canPost: boolean;
  missedAffiliate: boolean;
}

export async function getPartnerLink(partnerId: string): Promise<PartnerLinkResult | null> {
  const db = getDb();
  if (!db) return null;

  try {
    const { data } = await db
      .from('partners')
      .select('navn,affiliate_link,nettadresse,rabattkode')
      .eq('id', partnerId)
      .eq('aktiv', true)
      .single();

    if (!data) return null;

    const affiliateUrl: string | null = (data as any).affiliate_link?.trim() || null;
    const fallbackUrl: string | null = (data as any).nettadresse?.trim() || null;
    const finalUrl = affiliateUrl ?? fallbackUrl;
    const canPost = finalUrl !== null;
    const missedAffiliate = !affiliateUrl && fallbackUrl !== null;

    if (missedAffiliate) {
      console.warn(`[AFFILIATE_LINK_MISSING] Partner: ${(data as any).navn} (${partnerId})`);
    }

    return {
      navn: (data as any).navn,
      affiliateUrl,
      fallbackUrl,
      finalUrl,
      rabattkode: (data as any).rabattkode ?? null,
      canPost,
      missedAffiliate,
    };
  } catch { return null; }
}
