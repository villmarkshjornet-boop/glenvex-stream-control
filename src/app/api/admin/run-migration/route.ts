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
  if (!sbUrl) return NextResponse.json({ error: 'SUPABASE_URL mangler' }, { status: 500 });

  // Ekstraher project_ref fra https://{ref}.supabase.co
  const projectRef = sbUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (!projectRef) return NextResponse.json({ error: `Klarte ikke parse project_ref fra ${sbUrl}` }, { status: 500 });

  // Bruk pg direkte mot Supabase Transaction Pooler
  // Supabase støtter pg-tilkobling via: postgresql://postgres.{ref}:{serviceRoleKey}@{region}.pooler.supabase.com:6543/postgres
  // Prøv begge region-konvensjoner
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const dbPassword = encodeURIComponent(sbKey);

  // Finn region fra Supabase REST API (OPTIONS-kall avslører region i headers)
  let region = 'aws-0-eu-central-1'; // vanlig norsk region
  try {
    const optRes = await fetch(`${sbUrl}/rest/v1/`, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
    const server = optRes.headers.get('server') ?? '';
    if (server.includes('us-east')) region = 'aws-0-us-east-1';
    else if (server.includes('us-west')) region = 'aws-0-us-west-1';
  } catch {}

  const pgUrls = [
    `postgresql://postgres.${projectRef}:${dbPassword}@${region}.pooler.supabase.com:6543/postgres?sslmode=require`,
    `postgresql://postgres:${dbPassword}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
  ];

  const { Client } = require('pg');

  for (const connStr of pgUrls) {
    const client = new Client({ connectionString: connStr, connectionTimeoutMillis: 8000 });
    try {
      await client.connect();
      await client.query(SQL);
      await client.end();
      return NextResponse.json({ ok: true, melding: 'community_personas tabell opprettet!', connectionUsed: connStr.split('@')[1] });
    } catch (err: any) {
      try { await client.end(); } catch {}
      console.warn(`[Migration] Forsøk feilet: ${err.message?.slice(0, 100)}`);
    }
  }

  return NextResponse.json({
    ok: false,
    projectRef,
    melding: 'Direkte pg-tilkobling feilet. Kjør SQL manuelt i Supabase SQL Editor.',
    supabaseUrl: `https://supabase.com/dashboard/project/${projectRef}/sql/new`,
    sql: SQL,
  }, { status: 422 });
}
