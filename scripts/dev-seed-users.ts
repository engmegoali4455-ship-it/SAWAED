// ينشئ حسابات تجريبية ويربطها بالأدوار (للتطوير والاختبارات فقط — لا يُشغَّل على الإنتاج).
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/dev-seed-users.ts
// يفترض أن بيانات scripts/fixtures/sample-export.json مستوردة.
import { createClient } from '@supabase/supabase-js';

export const DEMO_PASSWORD = 'Sawaed#2026';
export const DEMO_USERS = {
  admin: 'admin@sawaed.test',
  dept: 'dept@sawaed.test',
  pm: 'fahad@sawaed.sa',      // e1 مدير مشروع p1
  eng: 'reem@sawaed.test',    // e2 مقيم p1 + زيارات p2
  owner: 'owner@sawaed.test', // مالك p1
} as const;

export async function seedUsers(url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!) {
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const ids: Record<string, string> = {};
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
  for (const [k, email] of Object.entries(DEMO_USERS)) {
    const existing = list?.users.find((u) => u.email === email);
    if (existing) { ids[k] = existing.id; continue; }
    const { data, error } = await sb.auth.admin.createUser({ email, password: DEMO_PASSWORD, email_confirm: true, user_metadata: { full_name: k } });
    if (error) throw error;
    ids[k] = data.user.id;
  }
  const must = (r: { error: any }) => { if (r.error) throw r.error; };
  must(await sb.from('profiles').update({ is_admin: true }).eq('id', ids.admin));
  must(await sb.from('dept_managers').update({ user_id: ids.dept }).eq('id', 'dm1'));
  must(await sb.from('engineers').update({ user_id: ids.pm }).eq('id', 'e1'));
  must(await sb.from('engineers').update({ user_id: ids.eng }).eq('id', 'e2'));
  must(await sb.from('project_external_members').upsert({ project_id: 'p1', user_id: ids.owner, party: 'owner' }));
  return ids;
}

if (process.argv[1]?.endsWith('dev-seed-users.ts')) {
  seedUsers().then((ids) => { console.log('✔ الحسابات التجريبية (كلمة المرور:', DEMO_PASSWORD, ')'); console.table(ids); });
}
