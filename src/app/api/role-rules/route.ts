import { NextRequest, NextResponse } from 'next/server';
import { getRules, addRule, updateRule, deleteRule, getLog, getPendingApprovals, approveProposal } from '@/lib/roleRules';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  if (action === 'log') return NextResponse.json(getLog());
  if (action === 'pending') return NextResponse.json(getPendingApprovals());

  return NextResponse.json(getRules());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (body.action === 'approve') {
    const result = approveProposal(body.id, body.godkjent);
    return NextResponse.json(result);
  }
  const rule = addRule(body);
  return NextResponse.json(rule);
}

export async function PATCH(req: NextRequest) {
  const { id, ...updates } = await req.json();
  const rule = updateRule(id, updates);
  if (!rule) return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  return NextResponse.json(rule);
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  deleteRule(id);
  return NextResponse.json({ ok: true });
}
