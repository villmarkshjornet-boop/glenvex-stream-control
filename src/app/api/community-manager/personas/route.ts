import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getWorkspaceId } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET() {
  const wsId = getWorkspaceId();
  const db   = getDb();
  if (!db) return NextResponse.json({ personas: [] });

  try {
    const { data: members } = await db
      .from('community_members')
      .select('discord_id, display_name, username, xp, level, last_seen')
      .eq('workspace_id', wsId)
      .order('xp', { ascending: false });

    const discordIds = ((members ?? []) as any[]).map((m) => m.discord_id as string);

    let personasByMember: Record<string, any> = {};
    let historyLastByMember: Record<string, string> = {};

    if (discordIds.length > 0) {
      const { data: personas } = await db
        .from('community_personas')
        .select('discord_id, persona_title, archetype, rarity, image_url, reroll_count, generated_at, created_at')
        .eq('workspace_id', wsId)
        .in('discord_id', discordIds);

      for (const p of ((personas ?? []) as any[])) {
        personasByMember[p.discord_id as string] = p;
      }

      const { data: history } = await db
        .from('community_persona_history')
        .select('discord_id, created_at')
        .eq('workspace_id', wsId)
        .in('discord_id', discordIds)
        .order('created_at', { ascending: false });

      for (const h of ((history ?? []) as any[])) {
        const hid = h.discord_id as string;
        if (!historyLastByMember[hid]) {
          historyLastByMember[hid] = h.created_at as string;
        }
      }
    }

    const result = ((members ?? []) as any[]).map((m) => {
      const p = personasByMember[m.discord_id as string];
      return {
        discordId:       m.discord_id  as string,
        displayName:     (m.display_name || m.username || (m.discord_id as string).slice(0, 8)) as string,
        username:        m.username    as string,
        xp:              (m.xp    ?? 0) as number,
        level:           (m.level ?? 1) as number,
        lastSeen:        m.last_seen   as string | null,
        hasCard:         !!p,
        rarity:          (p?.rarity        ?? null) as string | null,
        archetype:       (p?.archetype     ?? null) as string | null,
        personaTitle:    (p?.persona_title ?? null) as string | null,
        imageUrl:        (p?.image_url     ?? null) as string | null,
        rerollCount:     (p?.reroll_count  ?? 0)   as number,
        generatedAt:     (p?.generated_at ?? p?.created_at ?? null) as string | null,
        lastGeneratedAt: (historyLastByMember[m.discord_id as string] ?? null) as string | null,
      };
    });

    return NextResponse.json({ personas: result });
  } catch (err: any) {
    console.error('[personas] GET feilet:', err?.message);
    return NextResponse.json({ personas: [] });
  }
}
