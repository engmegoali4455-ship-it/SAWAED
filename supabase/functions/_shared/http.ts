// أدوات مشتركة لـ Edge Functions: CORS، العملاء، الأخطاء
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

export const env = (k: string) => Deno.env.get(k) ?? '';

/** عميل بصلاحيات المستخدم (RLS) */
export function userClient(req: Request): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
}
/** عميل الخادم (يتجاوز RLS) — يُستخدم فقط بعد التحقق من صلاحية المستخدم */
export function serviceClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
}

/** الرابط الذي يصل إليه المتصفح (محلياً: عنوان kong الداخلي يختلف عن العام) */
export function publicUrl(u: string): string {
  const pub = env('PUBLIC_SUPABASE_URL');
  if (!pub) return u;
  return u.replace(/^https?:\/\/[^/]+/, pub.replace(/\/$/, ''));
}

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    try { return await fn(req); }
    catch (e) {
      console.error(e);
      const status = (e as any)?.status ?? 500;
      return json({ error: (e as Error).message ?? 'error' }, status);
    }
  };
}
export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
