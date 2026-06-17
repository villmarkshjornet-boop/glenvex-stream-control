import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/workspace';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB ikke tilkoblet' }, { status: 500 });

  const wsId = getWorkspaceId();
  const { id } = params;
  const body = await req.json() as {
    action: 'approve' | 'reject';
    rejectedReason?: string;
    messageTwitch?: string;
    messageDiscord?: string;
  };

  if (!['approve', 'reject'].includes(body.action)) {
    return NextResponse.json({ error: 'action må være approve eller reject' }, { status: 400 });
  }

  // Fetch and verify ownership
  const { data: proposal, error: fetchErr } = await db
    .from('partner_proposals')
    .select('id,status,partner_name,platform,message_twitch,message_discord,affiliate_url,discount_code')
    .eq('id', id)
    .eq('workspace_id', wsId)
    .single();

  if (fetchErr || !proposal) {
    return NextResponse.json({ error: 'Forslag ikke funnet' }, { status: 404 });
  }

  if (proposal.status !== 'pending') {
    return NextResponse.json({ error: `Forslaget er allerede ${proposal.status}` }, { status: 409 });
  }

  const now = new Date().toISOString();

  if (body.action === 'reject') {
    const { error: updErr } = await db
      .from('partner_proposals')
      .update({ status: 'rejected', rejected_reason: body.rejectedReason ?? null, approved_at: now })
      .eq('id', id);

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    await db.from('system_events').insert({
      workspace_id: wsId,
      source: 'dashboard',
      event_type: 'PARTNER_PROPOSAL_REJECTED',
      title: `Promo-forslag avvist: ${proposal.partner_name}`,
      severity: 'info',
      metadata: { proposalId: id, partnerName: proposal.partner_name, reason: body.rejectedReason ?? null },
    });

    return NextResponse.json({ success: true, action: 'rejected' });
  }

  // Approve: update messages if edited, mark approved
  const finalMsgTwitch = body.messageTwitch ?? proposal.message_twitch;
  const finalMsgDiscord = body.messageDiscord ?? proposal.message_discord;

  const { error: updErr } = await db
    .from('partner_proposals')
    .update({
      status: 'approved',
      message_twitch: finalMsgTwitch,
      message_discord: finalMsgDiscord,
      approved_at: now,
    })
    .eq('id', id);

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  await db.from('system_events').insert({
    workspace_id: wsId,
    source: 'dashboard',
    event_type: 'PARTNER_PROPOSAL_APPROVED',
    title: `Promo-forslag godkjent: ${proposal.partner_name}`,
    severity: 'info',
    metadata: {
      proposalId: id,
      partnerName: proposal.partner_name,
      platform: proposal.platform,
      messageTwitch: finalMsgTwitch,
      messageDiscord: finalMsgDiscord,
    },
  });

  return NextResponse.json({
    success: true,
    action: 'approved',
    proposal: {
      id,
      partnerName: proposal.partner_name,
      platform: proposal.platform,
      messageTwitch: finalMsgTwitch,
      messageDiscord: finalMsgDiscord,
      affiliateUrl: proposal.affiliate_url,
      discountCode: proposal.discount_code,
    },
  });
}
