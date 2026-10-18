// ملخص أسبوعي بالبريد لمديري القسم ومدير النظام (كل خميس بعد توليد التقارير).
// يتطلب RESEND_API_KEY و MAIL_FROM؛ دونهما يعيد الملخص دون إرسال (للاختبار).
import { env, handle, HttpError, json, serviceClient } from '../_shared/http.ts';

Deno.serve(handle(async (req) => {
  const secret = env('PUSH_SECRET');
  if (!secret || req.headers.get('x-push-secret') !== secret) throw new HttpError(401, 'unauthorized');
  const svc = serviceClient();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
  const [{ data: projects }, { data: violations }, { data: reports }, { data: managers }, { data: admins }] = await Promise.all([
    svc.from('v_projects').select('id, name, status, progress, is_update_late'),
    svc.from('violations').select('project_id, severity, status, deadline').in('status', ['open', 'correcting', 'escalated']),
    svc.from('weekly_reports').select('project_id, status, week_start').order('week_start', { ascending: false }).limit(500),
    svc.from('dept_managers').select('user_id').eq('is_active', true).not('user_id', 'is', null),
    svc.from('profiles').select('id').eq('is_admin', true).eq('is_active', true),
  ]);
  const active = (projects ?? []).filter((p) => ['ongoing', 'ending_soon', 'in_process'].includes(p.status));
  const late = active.filter((p) => p.is_update_late);
  const major = (violations ?? []).filter((v) => v.severity === 'major');
  const overdue = (violations ?? []).filter((v) => v.deadline && v.deadline < today);
  const week = reports?.[0]?.week_start;
  const thisWeek = (reports ?? []).filter((r) => r.week_start === week);
  const avg = active.length ? Math.round(active.reduce((a, p) => a + Number(p.progress ?? 0), 0) / active.length) : 0;
  const rows = (label: string, v: string | number) => `<tr><td style="padding:6px 10px;color:#726a62">${label}</td><td style="padding:6px 10px;font-weight:600">${v}</td></tr>`;
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial;background:#f1eee9;padding:20px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:8px;overflow:hidden">
    <div style="background:#221f1d;color:#f1eee9;padding:16px 20px;border-bottom:3px solid #e85e30"><b>سواعد للإشراف الهندسي</b> — الملخص الأسبوعي (${today})</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${rows('المشاريع النشطة', active.length)}${rows('متوسط الإنجاز', `${avg}%`)}
    ${rows('تحديثات متأخرة (أكثر من 7 أيام)', late.length)}${rows('مخالفات جسيمة مفتوحة', major.length)}${rows('مخالفات تجاوزت المهلة', overdue.length)}
    ${rows('تقارير هذا الأسبوع المعتمدة', `${thisWeek.filter((r) => r.status !== 'draft').length} من ${thisWeek.length}`)}</table>
    ${late.length ? `<p style="padding:0 20px;font-size:13px">المشاريع المتأخرة: ${late.map((p) => p.name).join('، ')}</p>` : ''}
    <p style="padding:0 20px 16px;font-size:13px"><a href="${env('APP_URL')}/" style="color:#c94a22">فتح لوحة القيادة</a></p></div></div>`;
  const ids = [...new Set([...(managers ?? []).map((m) => m.user_id), ...(admins ?? []).map((a) => a.id)])];
  const { data: to } = ids.length ? await svc.from('profiles').select('email').in('id', ids) : { data: [] };
  const recipients = (to ?? []).map((p) => p.email).filter(Boolean);
  if (!env('RESEND_API_KEY') || !recipients.length) return json({ sent: false, recipients, summary: { active: active.length, late: late.length, major: major.length } });
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('MAIL_FROM') || 'Sawaed <noreply@sawaed.sa>', to: recipients, subject: `الملخص الأسبوعي للإشراف — ${today}`, html }),
  });
  if (!r.ok) throw new Error(`mail ${r.status}: ${await r.text()}`);
  return json({ sent: true, recipients: recipients.length });
}));
