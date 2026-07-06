/**
 * Sentralisert partner-hjelper for Railway-boten.
 *
 * Regler (ufravikelige):
 *   1. Bruk affiliate_link hvis den finnes.
 *   2. Bruk nettadresse som fallback, men logg AFFILIATE_LINK_MISSING.
 *   3. IKKE post promo hvis verken affiliate_link eller nettadresse finnes.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getCreatorState, CachedPartner } from './creatorState';

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
  id: string;
  navn: string;
  beskrivelse: string | null;
  affiliateUrl: string | null;
  fallbackUrl: string | null;
  finalUrl: string | null;
  rabattkode: string | null;
  canPost: boolean;
  missedAffiliate: boolean;
}

// Maps a CachedPartner from Creator State to the PartnerInfo shape used by callers.
function mapCached(raw: CachedPartner): PartnerInfo | null {
  const finalUrl = raw.affiliateUrl ?? raw.fallbackUrl;
  if (!finalUrl) return null;
  const missedAffiliate = !raw.affiliateUrl && !!raw.fallbackUrl;
  if (missedAffiliate) {
    console.warn(`[AFFILIATE_LINK_MISSING] Partner: "${raw.navn}" – mangler affiliate_link, bruker nettadresse som fallback`);
  }
  return {
    id: raw.id,
    navn: raw.navn,
    beskrivelse: raw.beskrivelse,
    affiliateUrl: raw.affiliateUrl,
    fallbackUrl: raw.fallbackUrl,
    finalUrl,
    rabattkode: raw.rabattkode,
    canPost: true,
    missedAffiliate,
  };
}

// A partner is "featured" if featured=true OR prioritet>=100 (legacy threshold)
function isFeatured(p: CachedPartner): boolean {
  return p.featured || p.prioritet >= 100;
}

// Phase 7+8: reads from Creator State (populated at startup + stream start by Creator Brain).
// Returns null if partner cache is empty (bot just started, cache not yet ready).
// workspaceId defaults to bot-level env var — explicit param required for multi-workspace.
export async function getFeaturedPartner(workspaceId?: string): Promise<PartnerInfo | null> {
  const partners = getCreatorState(workspaceId ?? WORKSPACE_ID).partners.activePartners;
  const raw = partners.find(isFeatured) ?? null;
  return raw ? mapCached(raw) : null;
}

// Phase 7+8: reads from Creator State. Selection logic (90% featured) unchanged.
export async function getRandomActivePartner(workspaceId?: string): Promise<PartnerInfo | null> {
  const partners = getCreatorState(workspaceId ?? WORKSPACE_ID).partners.activePartners;
  if (partners.length === 0) return null;

  // Featured partner gets 90% of all promo slots
  const featured = partners.find(isFeatured) ?? null;
  let raw: CachedPartner;
  if (featured && Math.random() < 0.90) {
    raw = featured;
  } else {
    const pool = partners.filter(p => p.prioritet < 100).slice(0, 3);
    const candidates = pool.length > 0 ? pool : partners.slice(0, 3);
    raw = candidates[Math.floor(Math.random() * candidates.length)];
  }

  if (!raw.affiliateUrl && !raw.fallbackUrl) {
    console.warn(`[AFFILIATE_LINK_MISSING] Partner: "${raw.navn}" – INGEN URL, skipper promo`);
    return null;
  }
  return mapCached(raw);
}

/**
 * Eneste sted i kodebasen som skriver partners.siste_promotert/eksponering.
 * Kalles ETTER en bekreftet, vellykket send – aldri før, aldri ved feilet send.
 * Svelger alle feil (logger PARTNER_PROMOTION_TRACKING_FAILED) – skal aldri krasje kalleren.
 */
export async function trackPartnerExposure(opts: {
  workspaceId?: string;
  partnerId?: string | null;
  partnerName: string;
  platform: 'discord' | 'twitch';
  channelId?: string | null;
  messageId?: string | null;
  source: string;
}): Promise<void> {
  const sb = getSb();
  if (!sb) return;
  const ws = opts.workspaceId ?? WORKSPACE_ID;

  try {
    let query = sb.from('partners').select('id,eksponering').eq('workspace_id', ws);
    query = opts.partnerId ? query.eq('id', opts.partnerId) : query.eq('navn', opts.partnerName);
    const { data: rows, error: selErr } = await query.limit(1);
    if (selErr) throw selErr;
    if (!rows || rows.length === 0) throw new Error(`partner ikke funnet: ${opts.partnerName}`);

    const row = rows[0];
    const nyEksponering = (row.eksponering ?? 0) + 1;

    const { error: updErr } = await sb
      .from('partners')
      .update({ siste_promotert: new Date().toISOString(), eksponering: nyEksponering })
      .eq('id', row.id);
    if (updErr) throw updErr;

    await sb.from('system_events').insert({
      workspace_id: ws,
      source: opts.platform === 'discord' ? 'discord_bot' : 'twitch_bot',
      event_type: opts.platform === 'discord' ? 'PARTNER_PROMOTION_SENT_DISCORD' : 'PARTNER_PROMOTION_SENT_TWITCH',
      title: `Partner promotert: ${opts.partnerName}`,
      severity: 'info',
      metadata: { partnerId: row.id, partnerName: opts.partnerName, platform: opts.platform, channelId: opts.channelId ?? null, messageId: opts.messageId ?? null, source: opts.source, eksponering: nyEksponering },
    });
  } catch (err: any) {
    try {
      await sb.from('system_events').insert({
        workspace_id: ws,
        source: 'partner_tracking',
        event_type: 'PARTNER_PROMOTION_TRACKING_FAILED',
        title: `Kunne ikke spore promo for ${opts.partnerName}`,
        severity: 'warning',
        metadata: { partnerName: opts.partnerName, platform: opts.platform, source: opts.source, error: err?.message?.slice(0, 200) ?? 'ukjent feil' },
      });
    } catch {}
  }
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
