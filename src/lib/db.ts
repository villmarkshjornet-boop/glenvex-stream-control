import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getDb(): SupabaseClient | null {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _client;
}

export function isDbAvailable(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// ── Generic helpers ───────────────────────────────────────────────────────────

export async function dbSelect<T>(table: string, filters?: Record<string, any>): Promise<T[]> {
  const db = getDb();
  if (!db) return [];
  let q = db.from(table).select('*');
  if (filters) {
    for (const [k, v] of Object.entries(filters)) {
      q = q.eq(k, v);
    }
  }
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) { console.error(`[DB] select ${table}:`, error.message); return []; }
  return (data ?? []) as T[];
}

export async function dbInsert<T>(table: string, row: Record<string, any>): Promise<T | null> {
  const db = getDb();
  if (!db) return null;
  const { data, error } = await db.from(table).insert(row).select().single();
  if (error) { console.error(`[DB] insert ${table}:`, error.message); return null; }
  return data as T;
}

export async function dbUpdate<T>(table: string, id: string, updates: Record<string, any>): Promise<T | null> {
  const db = getDb();
  if (!db) return null;
  const { data, error } = await db.from(table).update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error) { console.error(`[DB] update ${table}:`, error.message); return null; }
  return data as T;
}

export async function dbDelete(table: string, id: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const { error } = await db.from(table).delete().eq('id', id);
  if (error) { console.error(`[DB] delete ${table}:`, error.message); return false; }
  return true;
}

export async function dbUpsert<T>(table: string, row: Record<string, any>, onConflict: string): Promise<T | null> {
  const db = getDb();
  if (!db) return null;
  const { data, error } = await db.from(table).upsert(row, { onConflict }).select().single();
  if (error) { console.error(`[DB] upsert ${table}:`, error.message); return null; }
  return data as T;
}

// Omgår potensielle klientautentiseringsproblemer – bruker service role key direkte via REST API
export async function dbRawInsert<T>(table: string, row: Record<string, any>): Promise<{ data: T | null; error: string | null }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { data: null, error: 'Supabase ikke konfigurert' };
  try {
    const res = await fetch(`${url}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      return { data: null, error: errText };
    }
    const data = await res.json();
    return { data: Array.isArray(data) ? data[0] : data, error: null };
  } catch (e: any) {
    return { data: null, error: e.message ?? 'Ukjent feil' };
  }
}
