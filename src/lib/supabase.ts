import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

let client: SupabaseClient | null = null;

/** عميل واحد للتطبيق. الجلسة محفوظة محلياً فتعمل الشاشات دون اتصال. */
export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sawaed-auth' },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return client;
}

export const SUPABASE_URL = url;
