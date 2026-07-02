import { NextRequest, NextResponse } from 'next/server';
import { headers, cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
}

function parseSessionUserId(): string | null {
  const cookieStore = cookies();
  const all = cookieStore.getAll();
  let tokenValue = '';

  const single = all.find(c => /^sb-.+-auth-token$/.test(c.name));
  if (single?.value) tokenValue = single.value;

  if (!tokenValue) {
    const chunk0 = all.find(c => /^sb-.+-auth-token\.0$/.test(c.name));
    if (chunk0) {
      const base = chunk0.name.replace('.0', '');
      const chunks: string[] = [];
      for (let i = 0; i < 10; i++) {
        const v = cookieStore.get(`${base}.${i}`)?.value;
        if (!v) break;
        chunks.push(v);
      }
      tokenValue = chunks.join('');
    }
  }

  if (!tokenValue) return null;
  try {
    const session = JSON.parse(decodeURIComponent(tokenValue));
    const b64 = session.access_token?.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
    if (!b64) return null;
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString());
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const h    = headers();
  let userId = h.get('x-user-id');

  // Fallback: parse from cookie when workspace_id isn't in JWT yet (onboarding step 1)
  if (!userId) userId = parseSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Ikke autentisert' }, { status: 401 });

  // Previous workspace from JWT — used for audit trail
  const previousWorkspaceId = h.get('x-workspace-id') ?? null;

  const { brandName, workspaceSlug: rawSlug } = await req.json();
  if (!brandName || !rawSlug) {
    return NextResponse.json({ error: 'brandName og workspaceSlug påkrevd' }, { status: 400 });
  }

  const workspaceSlug = slugify(rawSlug);
  if (workspaceSlug.length < 2) {
    return NextResponse.json({ error: 'Workspace slug for kort' }, { status: 400 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 500 });

  // ── Ownership checks ──────────────────────────────────────────────────────
  const { data: existing } = await db.from('workspaces')
    .select('id,owner_user_id,twitch_login,discord_guild_id,brand_name')
    .eq('id', workspaceSlug)
    .single();

  if (existing) {
    // 1. Owned by a DIFFERENT user — hard block
    if (existing.owner_user_id && existing.owner_user_id !== userId) {
      await logWorkspaceEvent(db, workspaceSlug, userId, 'WORKSPACE_CLAIM_REJECTED_OWNED', {
        reason: 'owned_by_other',
        existingOwnerId: existing.owner_user_id,
        requestingUserId: userId,
      });
      return NextResponse.json({ error: `"${workspaceSlug}" er allerede i bruk av en annen bruker.` }, { status: 409 });
    }

    // 2. No owner BUT already configured for someone else (twitch or discord set)
    // This covers Railway/env-bootstrapped workspaces that have no auth owner yet.
    if (!existing.owner_user_id && (existing.twitch_login || existing.discord_guild_id)) {
      await logWorkspaceEvent(db, workspaceSlug, userId, 'WORKSPACE_CLAIM_REJECTED_CONFIGURED', {
        reason: 'configured_without_owner',
        twitchLogin: existing.twitch_login ?? null,
        discordGuildId: existing.discord_guild_id ?? null,
        requestingUserId: userId,
      });
      return NextResponse.json({
        error: `"${workspaceSlug}" er allerede konfigurert for en annen konto. Velg et annet workspace-ID.`,
      }, { status: 409 });
    }
  }

  const now = new Date().toISOString();

  if (existing) {
    // Only allow updating own unconfigured workspace (same user, no twitch/discord yet)
    await db.from('workspaces')
      .update({ owner_user_id: userId, brand_name: brandName, updated_at: now })
      .eq('id', workspaceSlug);
  } else {
    const { error: insErr } = await db.from('workspaces').insert({
      id:                  workspaceSlug,
      owner_user_id:       userId,
      brand_name:          brandName,
      streamer_name:       workspaceSlug,
      twitch_channel_name: workspaceSlug,
      bot_personality:     'dark_gaming',
      plan:                'alpha',
      alpha_enabled:       false,
      onboarding_step:     1,
      settings_json:       {},
      created_at:          now,
      updated_at:          now,
    });
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // ── Write workspace_id into user_metadata ─────────────────────────────────
  // Audit: log previous value so we have a paper trail if this ever changes
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (supabaseUrl && supabaseKey) {
    const admin = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: metaErr } = await admin.auth.admin.updateUserById(userId, {
      user_metadata: { workspace_id: workspaceSlug, brand_name: brandName, alpha_enabled: false },
    });
    if (metaErr) {
      console.error('[onboarding/workspace] updateUserById feilet:', metaErr.message);
    }
  }

  // ── Audit log ─────────────────────────────────────────────────────────────
  await logWorkspaceEvent(db, workspaceSlug, userId, 'WORKSPACE_ID_ASSIGNED', {
    source:             'onboarding_step1',
    action:             existing ? 'claimed' : 'created',
    userId,
    previousWorkspaceId,
    newWorkspaceId:     workspaceSlug,
    brandName,
  });

  return NextResponse.json({ ok: true, workspaceId: workspaceSlug });
}

async function logWorkspaceEvent(
  db: NonNullable<ReturnType<typeof getDb>>,
  workspaceId: string,
  userId: string,
  eventType: string,
  metadata: Record<string, unknown>,
) {
  try {
    await db.from('system_events').insert({
      workspace_id: workspaceId,
      source:       'onboarding',
      event_type:   eventType,
      title:        `[Auth] workspace_id-tilordning: ${eventType} for user ${userId}`,
      severity:     eventType.includes('REJECTED') ? 'warning' : 'info',
      metadata,
    });
  } catch {}
}
