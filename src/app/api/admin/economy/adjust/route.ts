import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getAuthenticatedWorkspace } from '@/lib/requireAuth';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

interface AdjustBody {
  discord_id: string;
  amount: number;
  reason: string;
}

export async function POST(req: NextRequest) {
  const wsId = getAuthenticatedWorkspace(req);
  if (!wsId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'Database ikke tilgjengelig' }, { status: 503 });
  }

  let body: AdjustBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }

  const { discord_id, amount, reason } = body;

  // Validate inputs
  if (!discord_id || typeof discord_id !== 'string') {
    return NextResponse.json({ error: 'discord_id kreves' }, { status: 400 });
  }
  if (!Number.isInteger(amount) || amount === 0) {
    return NextResponse.json({ error: 'amount må være et heltall som ikke er null' }, { status: 400 });
  }
  if (!reason || typeof reason !== 'string' || reason.trim() === '') {
    return NextResponse.json({ error: 'reason kan ikke være tom' }, { status: 400 });
  }

  const adminEmail = req.headers.get('x-user-email') ?? 'unknown';

  try {
    // Fetch current member
    const { data: memberData, error: fetchError } = await db
      .from('community_members')
      .select('coins_balance, total_coins_earned, total_coins_spent')
      .eq('workspace_id', wsId)
      .eq('discord_id', discord_id)
      .single();

    if (fetchError || !memberData) {
      return NextResponse.json({ error: 'Bruker ikke funnet' }, { status: 404 });
    }

    const currentBalance: number = memberData.coins_balance ?? 0;
    const rawNewBalance = currentBalance + amount;
    const new_balance = Math.max(0, rawNewBalance);

    // Build update object
    const updateFields: Record<string, number> = { coins_balance: new_balance };
    if (amount > 0) {
      updateFields.total_coins_earned = (memberData.total_coins_earned ?? 0) + amount;
    } else {
      updateFields.total_coins_spent = (memberData.total_coins_spent ?? 0) + Math.abs(amount);
    }

    // Update member balance
    const { error: updateError } = await db
      .from('community_members')
      .update(updateFields)
      .eq('workspace_id', wsId)
      .eq('discord_id', discord_id);

    if (updateError) {
      console.error('[economy/adjust] Update error:', updateError.message);
      return NextResponse.json({ error: 'Kunne ikke oppdatere saldo' }, { status: 500 });
    }

    // Insert transaction record
    await db.from('community_coin_transactions').insert({
      workspace_id: wsId,
      user_id: discord_id,
      source: 'admin_adjustment',
      amount,
      balance_after: new_balance,
      metadata: { reason: reason.trim(), admin_email: adminEmail },
    });

    // Queue Discord DM
    const dmMessage =
      `GLENVEX ga deg ${amount > 0 ? '+' : ''}${amount} coins 🪙\n` +
      `Grunn: ${reason.trim()}\n` +
      `Ny saldo: ${new_balance} coins`;

    const { error: dmError } = await db.from('discord_dm_queue').insert({
      workspace_id: wsId,
      discord_id,
      message: dmMessage,
    });

    const dm_queued = !dmError;

    // Log to system_events
    await db.from('system_events').insert({
      workspace_id: wsId,
      source: 'admin',
      event_type: 'ADMIN_COIN_ADJUSTMENT',
      title: `Admin ga ${amount} coins til ${discord_id}`,
      severity: 'info',
      metadata: { discord_id, amount, reason: reason.trim(), new_balance },
    });

    return NextResponse.json({ ok: true, new_balance, dm_queued });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Ukjent feil';
    console.error('[economy/adjust] Unexpected error:', msg);
    return NextResponse.json({ error: 'Intern serverfeil' }, { status: 500 });
  }
}
