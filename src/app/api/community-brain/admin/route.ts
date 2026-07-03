import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAuth, getAuthenticatedWorkspace } from '@/lib/requireAuth';

export const dynamic = 'force-dynamic';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminActionRequest {
  action: 'approve' | 'reject' | 'lock' | 'unlock' | 'delete' | 'boost' | 'reset_strength';
  memoryId?: string;
  insightId?: string;
  knowledgeId?: string;
  boostValue?: number;
  reason?: string;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const authError = requireAuth(req);
  if (authError) return authError;

  const workspaceId = getAuthenticatedWorkspace(req)!;

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'Database not available' }, { status: 500 });
  }

  let body: AdminActionRequest;
  try {
    body = await req.json() as AdminActionRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action, memoryId, insightId, knowledgeId, boostValue, reason } = body;

  if (!action) {
    return NextResponse.json({ error: 'action is required' }, { status: 400 });
  }
  if (!memoryId && !insightId && !knowledgeId) {
    return NextResponse.json({ error: 'One of memoryId, insightId, or knowledgeId is required' }, { status: 400 });
  }

  try {
    // ── ai_agent_memory actions ────────────────────────────────────────────
    if (memoryId) {
      switch (action) {
        case 'approve':
          await db.from('ai_agent_memory')
            .update({ admin_approved: true })
            .eq('id', memoryId)
            .eq('workspace_id', workspaceId);
          break;
        case 'reject':
          await db.from('ai_agent_memory')
            .update({ admin_approved: false })
            .eq('id', memoryId)
            .eq('workspace_id', workspaceId);
          break;
        case 'lock':
          await db.from('ai_agent_memory')
            .update({ locked: true })
            .eq('id', memoryId)
            .eq('workspace_id', workspaceId);
          break;
        case 'unlock':
          await db.from('ai_agent_memory')
            .update({ locked: false })
            .eq('id', memoryId)
            .eq('workspace_id', workspaceId);
          break;
        case 'delete':
          await db.from('ai_agent_memory')
            .delete()
            .eq('id', memoryId)
            .eq('workspace_id', workspaceId);
          break;
        case 'boost':
          await db.from('ai_agent_memory')
            .update({ importance_boost: boostValue ?? 0 })
            .eq('id', memoryId)
            .eq('workspace_id', workspaceId);
          break;
        case 'reset_strength':
          await db.from('ai_agent_memory')
            .update({ strength: 1.0, last_decayed_at: null })
            .eq('id', memoryId)
            .eq('workspace_id', workspaceId);
          break;
        default:
          return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
      }
    }

    // ── ai_agent_insights actions ──────────────────────────────────────────
    if (insightId) {
      switch (action) {
        case 'approve':
          await db.from('ai_agent_insights')
            .update({ admin_approved: true })
            .eq('id', insightId)
            .eq('workspace_id', workspaceId);
          break;
        case 'reject':
          await db.from('ai_agent_insights')
            .update({ admin_approved: false })
            .eq('id', insightId)
            .eq('workspace_id', workspaceId);
          break;
        case 'delete':
          await db.from('ai_agent_insights')
            .delete()
            .eq('id', insightId)
            .eq('workspace_id', workspaceId);
          break;
        default:
          return NextResponse.json({ error: `Action '${action}' not supported for insights` }, { status: 400 });
      }
    }

    // ── creator_knowledge actions ──────────────────────────────────────────
    if (knowledgeId) {
      switch (action) {
        case 'approve':
          await db.from('creator_knowledge')
            .update({ admin_approved: true })
            .eq('id', knowledgeId)
            .eq('workspace_id', workspaceId);
          break;
        case 'reject':
          await db.from('creator_knowledge')
            .update({ admin_approved: false })
            .eq('id', knowledgeId)
            .eq('workspace_id', workspaceId);
          break;
        case 'lock':
          await db.from('creator_knowledge')
            .update({ locked: true })
            .eq('id', knowledgeId)
            .eq('workspace_id', workspaceId);
          break;
        case 'unlock':
          await db.from('creator_knowledge')
            .update({ locked: false })
            .eq('id', knowledgeId)
            .eq('workspace_id', workspaceId);
          break;
        case 'delete':
          await db.from('creator_knowledge')
            .delete()
            .eq('id', knowledgeId)
            .eq('workspace_id', workspaceId);
          break;
        case 'reset_strength':
          await db.from('creator_knowledge')
            .update({ strength: 1.0, last_decayed_at: null })
            .eq('id', knowledgeId)
            .eq('workspace_id', workspaceId);
          break;
        default:
          return NextResponse.json({ error: `Action '${action}' not supported for creator_knowledge` }, { status: 400 });
      }
    }

    // ── Log to system_events ───────────────────────────────────────────────
    const targetLabel = memoryId
      ? `memory ${memoryId.slice(0, 8)}`
      : insightId
        ? `insight ${insightId.slice(0, 8)}`
        : `knowledge ${knowledgeId!.slice(0, 8)}`;

    await db.from('system_events').insert({
      workspace_id: workspaceId,
      source:       'admin_brain',
      event_type:   'MEMORY_ADMIN_ACTION',
      title:        `Admin action: ${action} on ${targetLabel}`,
      severity:     'info',
      metadata:     { action, memoryId, insightId, knowledgeId, boostValue, reason },
    });

    return NextResponse.json({ ok: true, action, affected: 1 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error('[community-brain/admin]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
