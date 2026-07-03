import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getBotDb(): SupabaseClient | null {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ws = require('ws');
  _client = createClient(url, key, { realtime: { transport: ws }, auth: { persistSession: false, autoRefreshToken: false } });
  return _client;
}

// NOTE: Empty string is intentional — bot/index.ts exits at startup if WORKSPACE_ID is unset.
// This avoids TypeScript errors throughout the codebase while still failing fast at boot.
export const WORKSPACE_ID = process.env.WORKSPACE_ID ?? '';

export async function dbUpsert(table: string, row: Record<string, any>, onConflict: string): Promise<boolean> {
  const db = getBotDb();
  if (!db) return false;
  const { error } = await db.from(table).upsert(row, { onConflict });
  if (error) console.error(`[Supabase] ${table} upsert:`, error.message);
  return !error;
}

export async function dbInsert(table: string, row: Record<string, any>): Promise<boolean> {
  const db = getBotDb();
  if (!db) return false;
  const { error } = await db.from(table).insert(row);
  if (error) console.error(`[Supabase] ${table} insert:`, error.message);
  return !error;
}
