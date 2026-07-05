import { createClient } from '@supabase/supabase-js';
import { logSystemEvent } from './systemEvents';

function getSb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ws = require('ws');
  return createClient(url, key, { realtime: { transport: ws }, auth: { persistSession: false, autoRefreshToken: false } });
}

const WORKSPACE_ID = process.env.WORKSPACE_ID ?? '';
if (!WORKSPACE_ID) {
  // Fail loudly — denne servicen brukes kun fra bot, og boten krever WORKSPACE_ID
  throw new Error('[twitchLinkService] WORKSPACE_ID env var is not set');
}
const CODE_CHARS   = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusables (0/O, 1/I)

function generateCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

// ─── Create a pending link request ───────────────────────────────────────────

export async function createLinkRequest(
  discordId: string,
  discordUsername: string,
  twitchUsername: string,
): Promise<{ code: string; expiresAt: string } | { error: string }> {
  const sb = getSb();
  if (!sb) return { error: 'Database ikke tilgjengelig' };

  // Cancel any existing pending request for this user
  await sb
    .from('community_twitch_link_requests')
    .update({ status: 'cancelled' })
    .eq('workspace_id', WORKSPACE_ID)
    .eq('discord_id', discordId)
    .eq('status', 'pending');

  const code      = generateCode(6);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { error } = await sb
    .from('community_twitch_link_requests')
    .insert({
      workspace_id:     WORKSPACE_ID,
      discord_id:       discordId,
      discord_username: discordUsername,
      twitch_username:  twitchUsername.toLowerCase().replace(/^@/, ''),
      verify_code:      code,
      status:           'pending',
      expires_at:       expiresAt,
    });

  if (error) return { error: `Kunne ikke opprette kobling: ${error.message}` };

  return { code, expiresAt };
}

// ─── Verify a code from Twitch chat ──────────────────────────────────────────
// Returns the discord_id to update if successful, null otherwise

export async function verifyLinkCode(
  twitchUserId: string,
  twitchUsername: string,
  code: string,
): Promise<{ discordId: string; twitchUsername: string; hasStoredSub: boolean } | null> {
  const sb = getSb();
  if (!sb) return null;

  const upperCode = code.toUpperCase().trim();

  const { data, error } = await sb
    .from('community_twitch_link_requests')
    .select('*')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('verify_code', upperCode)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .single();

  if (error || !data) return null;

  // Mark as verified
  await sb
    .from('community_twitch_link_requests')
    .update({
      status:         'verified',
      verified_at:    new Date().toISOString(),
      twitch_user_id: twitchUserId,
    })
    .eq('id', data.id);

  // Update community_members: set twitch link fields on the Discord member
  await sb
    .from('community_members')
    .update({
      twitch_id:           twitchUserId,
      twitch_username:     twitchUsername,
      twitch_display_name: twitchUsername,
      twitch_linked:       true,
      twitch_linked_at:    new Date().toISOString(),
      member_type:         'linked',
      updated_at:          new Date().toISOString(),
    })
    .eq('workspace_id', WORKSPACE_ID)
    .eq('discord_id', data.discord_id);

  // Merge tw_-prefixed Twitch row into Discord row (if exists)
  // Copy twitch_xp and messages_twitch from tw_ row, then delete it
  const twId = `tw_${twitchUserId}`;
  const { data: twRow } = await sb
    .from('community_members')
    .select('xp, messages, twitch_xp, messages_twitch, coins_balance, total_coins_earned, subs')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('discord_id', twId)
    .single();

  if (twRow) {
    // Merge Twitch XP into Discord member — try RPC, fall back to direct update
    try {
      const { error: rpcErr } = await sb.rpc('merge_twitch_member', {
        p_workspace_id:   WORKSPACE_ID,
        p_discord_id:     data.discord_id,
        p_twitch_user_id: twitchUserId,
      });
      if (rpcErr) throw rpcErr;
    } catch {
      // RPC may not exist yet — do simple field updates instead
      await sb.from('community_members').update({
        twitch_xp:       (twRow.twitch_xp ?? twRow.xp ?? 0),
        messages_twitch: (twRow.messages_twitch ?? twRow.messages ?? 0),
        total_xp:        0, // will be recomputed on next sync
      })
      .eq('workspace_id', WORKSPACE_ID)
      .eq('discord_id', data.discord_id);

      // Mark tw_ row as merged (don't delete to preserve ledger references)
      await sb.from('community_members').update({ member_type: 'merged' })
        .eq('workspace_id', WORKSPACE_ID)
        .eq('discord_id', twId);
    }
  }

  // ── Sub-status: sjekk om Twitch-brukeren hadde ulinket sub-data ─────────────
  const { data: unmatchedSub } = await sb
    .from('community_twitch_unlinked_subs')
    .select('sub_tier, months')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('twitch_user_id', twitchUserId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const hasStoredSub = !!unmatchedSub || (twRow?.subs ?? 0) > 0;

  if (hasStoredSub) {
    await sb.from('community_members').update({
      twitch_sub_status: true,
      subs: Math.max((twRow?.subs ?? 0), 1),
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', WORKSPACE_ID)
    .eq('discord_id', data.discord_id);

    logSystemEvent({
      workspaceId: WORKSPACE_ID,
      source:     'twitch_link',
      event_type: 'TWITCH_SUB_MATCHED_TO_DISCORD',
      title:      `Sub-status satt for ${twitchUsername} → ${data.discord_id} etter linking`,
      severity:   'info',
      metadata:   {
        discordId:        data.discord_id,
        twitchUserId,
        twitchUsername,
        fromUnlinkedSubs: !!unmatchedSub,
        fromTwRow:        (twRow?.subs ?? 0) > 0,
        subTier:          (unmatchedSub as any)?.sub_tier ?? null,
      },
    });
  }

  logSystemEvent({
    workspaceId: WORKSPACE_ID,
    source:     'twitch_link',
    event_type: 'TWITCH_DISCORD_LINK_FOUND',
    title:      `Twitch ${twitchUsername} koblet til Discord ${data.discord_id} — sub: ${hasStoredSub}`,
    severity:   'info',
    metadata:   {
      discordId:    data.discord_id,
      twitchUserId,
      twitchUsername,
      hasStoredSub,
    },
  });

  return { discordId: data.discord_id, twitchUsername, hasStoredSub };
}

// ─── Store unmatched sub (Twitch sub with no Discord link) ────────────────────

export async function storeUnmatchedSub(
  twitchUsername: string,
  twitchUserId: string | undefined,
  subTier?: string,
  eventType: 'sub' | 'resub' | 'gift' | 'mystery_gift' = 'sub',
  months?: number,
): Promise<void> {
  const sb = getSb();
  if (!sb) return;

  await sb.from('community_twitch_unlinked_subs').insert({
    workspace_id:    WORKSPACE_ID,
    twitch_username: twitchUsername.toLowerCase(),
    twitch_user_id:  twitchUserId ?? null,
    sub_tier:        subTier ?? 'tier1',
    event_type:      eventType,
    months:          months ?? null,
  }).then(() => {});
}

// ─── Look up community_member by twitch_user_id ───────────────────────────────

export async function findMemberByTwitchId(
  twitchUserId: string,
): Promise<{ discordId: string; displayName: string } | null> {
  const sb = getSb();
  if (!sb) return null;

  const { data } = await sb
    .from('community_members')
    .select('discord_id, display_name')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('twitch_id', twitchUserId)
    .neq('member_type', 'merged')
    .limit(1)
    .single();

  if (!data) return null;
  return { discordId: data.discord_id, displayName: data.display_name };
}

// ─── Pending link status (for UI / command feedback) ─────────────────────────

export async function getPendingLink(discordId: string) {
  const sb = getSb();
  if (!sb) return null;

  const { data } = await sb
    .from('community_twitch_link_requests')
    .select('twitch_username, verify_code, expires_at, status')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('discord_id', discordId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .single();

  return data ?? null;
}
