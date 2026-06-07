/**
 * Sentralisert partner-hjelper for Railway-boten.
 *
 * Regler (ufravikelige):
 *   1. Bruk affiliate_link hvis den finnes.
 *   2. Bruk nettadresse som fallback, men logg AFFILIATE_LINK_MISSING.
 *   3. IKKE post promo hvis verken affiliate_link eller nettadresse finnes.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const WORKSPACE_ID = process.env.WORKSPACE_ID || 'glenvex-default';

let _sb: SupabaseClient | null = null;
function getSb(): SupabaseClient | null {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const ws = require('ws');
  _sb = createClient(url, key, { realtime: { transport: ws } });
  return _sb;
}

export interface PartnerInfo {
  navn: string;
  beskrivelse: string | null;
  affiliateUrl: string | null;
  fallbackUrl: string | null;
  finalUrl: string | null;
  rabattkode: string | null;
  canPost: boolean;
  missedAffiliate: boolean;
}

export async function getRandomActivePartner(): Promise<PartnerInfo | null> {
  const sb = getSb();
  if (!sb) return null;

  try {
    const { data } = await sb
      .from('partners')
      .select('navn,beskrivelse,affiliate_link,nettadresse,rabattkode,prioritet')
      .eq('aktiv', true)
      .order('prioritet', { ascending: false })
      .limit(10);

    if (!data || data.length === 0) return null;

    const candidates = data.slice(0, 3);
    const raw = candidates[Math.floor(Math.random() * candidates.length)];

    const affiliateUrl: string | null = raw.affiliate_link?.trim() || null;
    const fallbackUrl: string | null = raw.nettadresse?.trim() || null;
    const finalUrl = affiliateUrl ?? fallbackUrl;
    const canPost = finalUrl !== null;
    const missedAffiliate = !affiliateUrl && fallbackUrl !== null;

    if (missedAffiliate) {
      console.warn(`[AFFILIATE_LINK_MISSING] Partner: "${raw.navn}" – mangler affiliate_link, bruker nettadresse som fallback`);
    }
    if (!canPost) {
      console.warn(`[AFFILIATE_LINK_MISSING] Partner: "${raw.navn}" – INGEN URL, skipper promo`);
      return null;
    }

    return { navn: raw.navn, beskrivelse: raw.beskrivelse ?? null, affiliateUrl, fallbackUrl, finalUrl, rabattkode: raw.rabattkode ?? null, canPost, missedAffiliate };
  } catch { return null; }
}

export async function logPartnerPromoResult(opts: {
  partnerName: string;
  platform: 'discord' | 'twitch';
  channel?: string;
  affiliateUrlUsed: string | null;
  hadAffiliateUrl: boolean;
  missingAffiliate: boolean;
  copyText: string;
  ctaVariant?: string;
  discordMessageId?: string;
}): Promise<void> {
  const sb = getSb();
  if (!sb) return;
  try {
    await sb.from('partner_content_log').insert({
      workspace_id: WORKSPACE_ID,
      partner_name: opts.partnerName,
      platform: opts.platform,
      channel: opts.channel ?? null,
      affiliate_url_used: opts.affiliateUrlUsed,
      had_affiliate_url: opts.hadAffiliateUrl,
      missing_affiliate: opts.missingAffiliate,
      copy_text: opts.copyText.slice(0, 2000),
      cta_variant: opts.ctaVariant ?? null,
      discord_message_id: opts.discordMessageId ?? null,
    });
  } catch {}
}
