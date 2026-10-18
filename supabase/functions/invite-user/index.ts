// يرسل دعوة إنشاء حساب (مدير النظام فقط). الربط بالمهندس يتم بعدها من شاشة الإدارة.
import { env, handle, HttpError, json, serviceClient, userClient } from '../_shared/http.ts';

Deno.serve(handle(async (req) => {
  const { email } = await req.json().catch(() => ({}));
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'بريد غير صالح');
  const user = userClient(req);
  const { data: me } = await user.auth.getUser();
  if (!me.user) throw new HttpError(401, 'unauthorized');
  const { data: prof } = await user.from('profiles').select('is_admin, is_active').eq('id', me.user.id).maybeSingle();
  if (!prof?.is_admin || !prof.is_active) throw new HttpError(403, 'مدير النظام فقط');
  const { data, error } = await serviceClient().auth.admin.inviteUserByEmail(email.trim().toLowerCase(), { redirectTo: `${env('APP_URL') || 'http://localhost:3000'}/account/` });
  if (error) throw new HttpError(400, error.message);
  return json({ id: data.user?.id });
}));
