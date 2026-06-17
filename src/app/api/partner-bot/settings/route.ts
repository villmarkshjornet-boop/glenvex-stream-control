import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceId } from '@/lib/workspace';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export interface PartnerBotSettings {
  enabled: boolean;
  twitchEnabled: boolean;
  discordEnabled: boolean;
  pollsEnabled: boolean;
  affiliateDisclosure: string;
  maxPostsPerStream: number;
  cooldownMinutes: number;
  pollCooldownMinutes: number;
  viewerPeakMultiplier: number;
  chatSilenceMinutes: number;
  allowBothChannels: boolean;
  requireApproval: boolean;
  tone: 'natural' | 'energetic' | 'minimal';
}

const DEFAULTS: PartnerBotSettings = {
  enabled: true,
  twitchEnabled: true,
  discordEnabled: true,
  pollsEnabled: false,
  affiliateDisclosure: '',
  maxPostsPerStream: 3,
  cooldownMinutes: 45,
  pollCooldownMinutes: 120,
  viewerPeakMultiplier: 1.5,
  chatSilenceMinutes: 8,
  allowBothChannels: false,
  requireApproval: true,
  tone: 'natural',
};

export async function GET() {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB ikke tilkoblet' }, { status: 500 });

  const wsId = getWorkspaceId();
  const { data, error } = await db
    .from('workspaces')
    .select('settings_json')
    .eq('id', wsId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const stored = (data?.settings_json as any)?.partnerBot ?? {};
  const settings: PartnerBotSettings = { ...DEFAULTS, ...stored };

  return NextResponse.json({ settings });
}

export async function POST(req: NextRequest) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'DB ikke tilkoblet' }, { status: 500 });

  const wsId = getWorkspaceId();
  const body = await req.json() as Partial<PartnerBotSettings>;

  // Merge with current settings_json to avoid wiping other keys
  const { data: current, error: fetchErr } = await db
    .from('workspaces')
    .select('settings_json')
    .eq('id', wsId)
    .single();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  const currentJson = (current?.settings_json as Record<string, unknown>) ?? {};
  const currentPartnerBot = (currentJson.partnerBot as Partial<PartnerBotSettings>) ?? {};

  const merged: PartnerBotSettings = { ...DEFAULTS, ...currentPartnerBot, ...body };

  const { error: updateErr } = await db
    .from('workspaces')
    .update({
      settings_json: { ...currentJson, partnerBot: merged },
      updated_at: new Date().toISOString(),
    })
    .eq('id', wsId);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ success: true, settings: merged });
}
