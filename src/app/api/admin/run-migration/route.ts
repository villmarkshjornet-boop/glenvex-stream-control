import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SQL = `
CREATE TABLE IF NOT EXISTS community_personas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     TEXT NOT NULL,
  discord_id       TEXT NOT NULL,
  username         TEXT NOT NULL,
  display_name     TEXT,
  season           TEXT NOT NULL DEFAULT 'default',
  persona_title    TEXT,
  persona_class    TEXT,
  rarity           TEXT NOT NULL DEFAULT 'Common',
  description      TEXT,
  strengths        JSONB,
  weaknesses       JSONB,
  signature_move   TEXT,
  quote            TEXT,
  stats            JSONB,
  image_prompt     TEXT,
  image_url        TEXT,
  xp_cost          INTEGER NOT NULL DEFAULT 0,
  reroll_count     INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_community_personas_workspace_discord
  ON community_personas (workspace_id, discord_id);
CREATE INDEX IF NOT EXISTS idx_community_personas_rarity
  ON community_personas (workspace_id, rarity, created_at DESC);
`;

export async function POST(req: NextRequest) {
  const pwd = req.headers.get('x-admin-password');
  if (pwd !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sbUrl = process.env.SUPABASE_URL ?? '';
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!sbUrl || !sbKey) {
    return NextResponse.json({ error: 'Supabase env-variabler mangler på serveren' }, { status: 500 });
  }

  // Ekstraher project_ref fra https://{ref}.supabase.co
  const refMatch = sbUrl.match(/https:\/\/([^.]+)\.supabase\.co/);
  if (!refMatch) {
    return NextResponse.json({ error: `Klarte ikke parse project_ref fra SUPABASE_URL: ${sbUrl}` }, { status: 500 });
  }
  const projectRef = refMatch[1];

  // Supabase Management API — krever Supabase personal access token, IKKE service role key
  // Prøv likevel (kjenner ikke til om Railway-prosjektet har dette satt opp)
  const mgmtRes = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${sbKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: SQL }),
  });

  if (mgmtRes.ok) {
    const data = await mgmtRes.json();
    return NextResponse.json({ ok: true, melding: 'Migrasjon kjørt via Management API', data });
  }

  const mgmtErr = await mgmtRes.text().catch(() => mgmtRes.statusText);

  // Fallback: prøv via Supabase SQL-endepunkt (Supabase v2 har dette som intern rute)
  const sqlRes = await fetch(`${sbUrl}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'apikey': sbKey,
      'Authorization': `Bearer ${sbKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql: SQL }),
  });

  if (sqlRes.ok) {
    return NextResponse.json({ ok: true, melding: 'Migrasjon kjørt via exec_sql RPC' });
  }

  const sqlErr = await sqlRes.text().catch(() => sqlRes.statusText);

  return NextResponse.json({
    ok: false,
    projectRef,
    mgmtFeil: mgmtErr.slice(0, 300),
    sqlFeil: sqlErr.slice(0, 300),
    melding: 'Automatisk migrasjon støttes ikke uten Supabase Personal Access Token. Kjør SQL manuelt i Supabase SQL Editor.',
    sql: SQL,
  }, { status: 422 });
}
