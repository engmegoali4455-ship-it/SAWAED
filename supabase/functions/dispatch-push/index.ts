// يرسل الإشعارات المنتظرة (pushed_at فارغ) لكل أجهزة أصحابها.
// يُستدعى فوراً من مشغّل قاعدة البيانات (pg_net) وكل دقيقة احتياطاً، ويحميه سر مشترك.
// claim_unpushed_notifications يحجز الدفعة ذرّياً فلا يُرسل إشعار مرتين.
import { env, handle, HttpError, json, serviceClient } from '../_shared/http.ts';
import { send, type Sub } from '../_shared/push.ts';

const urlFor = (n: any) => n.entity_type === 'violation' ? `/entry/?t=violations&p=${n.project_id}&id=${n.entity_id}`
  : n.entity_type === 'weekly_report' ? `/report/?id=${n.entity_id}` : n.project_id ? `/project/?id=${n.project_id}` : '/alerts/';

Deno.serve(handle(async (req) => {
  const secret = env('PUSH_SECRET');
  if (!secret || req.headers.get('x-push-secret') !== secret) throw new HttpError(401, 'unauthorized');
  const svc = serviceClient();
  const { data: batch, error } = await svc.rpc('claim_unpushed_notifications', { p_limit: 200 });
  if (error) throw error;
  if (!batch?.length) return json({ claimed: 0 });
  const users = [...new Set(batch.map((n: any) => n.user_id))];
  const { data: subs } = await svc.from('push_subscriptions').select('*').in('user_id', users);
  const stats = { claimed: batch.length, sent: 0, gone: 0, skipped: 0, failed: 0 };
  const gone: string[] = [];
  await Promise.all(batch.map(async (n: any) => {
    const body = n.kind === 'daily_digest' && Array.isArray(n.payload) ? `${n.body} — ${n.payload.slice(0, 3).map((x: any) => x.text).join('، ')}` : (n.body ?? '');
    for (const s of (subs ?? []).filter((x: Sub & { user_id: string }) => x.user_id === n.user_id) as Sub[]) {
      const r = await send(s, { title: n.title, body, url: urlFor(n), tag: n.dedupe_key ?? String(n.id) });
      stats[r]++;
      if (r === 'gone') gone.push(s.id);
    }
  }));
  if (gone.length) await svc.from('push_subscriptions').delete().in('id', gone);
  return json(stats);
}));
