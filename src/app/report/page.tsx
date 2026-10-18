'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ReportView } from '@/components/report-view';
import { AppShell } from '@/components/shell';
import { Badge, Btn, Empty, PageTitle, Spinner } from '@/components/ui';
import { formatDual } from '@/lib/domain';
import { useRow } from '@/lib/hooks';
import { REPORT_STATUS } from '@/lib/labels';
import { updateRecord } from '@/lib/mutations';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { syncNow } from '@/lib/sync';
import { openPdf } from '@/lib/pdf';

export default function ReportPage() {
  return <AppShell><Suspense fallback={<Spinner />}><Inner /></Suspense></AppShell>;
}

function Inner() {
  const id = useSearchParams().get('id') ?? '';
  const s = useSession();
  const r = useRow('weekly_reports', id);
  const project = useRow('projects', r?.project_id);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  if (r === undefined) return <Spinner />;
  if (!r) return <Empty title="التقرير غير متاح" />;
  const manager = s.canManageProject(r.project_id);

  const run = async (k: string, fn: () => Promise<void>) => {
    setBusy(k); setErr(null);
    try { await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  const pdf = () => run('pdf', async () => {
    await syncNow();
    const url = await openPdf('weekly_report', r.id);
    window.open(url, '_blank', 'noopener');
  });

  return (
    <>
      <PageTitle title={<span className="flex items-center gap-2">التقرير الأسبوعي <Badge code={r.status}>{REPORT_STATUS[r.status]}</Badge></span>}
        sub={`${project?.name ?? ''} · ${formatDual(r.week_start)} ← ${formatDual(r.week_end)}`}
        actions={<>
          {manager && r.status === 'draft' && <Btn size="sm" variant="ghost" disabled={!!busy} onClick={() => run('regen', async () => {
            const { error } = await supabase().rpc('generate_weekly_report', { p_project_id: r.project_id, p_day: r.week_start });
            if (error) throw new Error('التحديث يتطلب اتصالاً'); await syncNow();
          })}>{busy === 'regen' ? 'جارٍ…' : 'تحديث البيانات'}</Btn>}
          {manager && r.status === 'draft' && <Btn size="sm" disabled={!!busy} onClick={() => run('approve', async () => { await updateRecord('weekly_reports', r.id, { status: 'approved' }); })}>اعتماد</Btn>}
          {manager && r.status === 'approved' && <Btn size="sm" disabled={!!busy} onClick={() => run('send', async () => {
            await syncNow();
            const { error } = await supabase().rpc('send_weekly_report', { p_report_id: r.id });
            if (error) throw new Error(error.code === '22023' ? 'اعتمد التقرير أولاً' : 'الإرسال يتطلب اتصالاً'); await syncNow();
          })}>إرسال للمالك</Btn>}
          <Btn size="sm" variant="dark" disabled={!!busy} onClick={pdf}>{busy === 'pdf' ? 'جارٍ التوليد…' : 'تنزيل PDF'}</Btn>
        </>} />
      {err && <p role="alert" className="mb-3 text-sm text-red">{err}</p>}
      {manager && r.status === 'draft' && (
        <div className="mb-4 space-y-2">
          <label className="block text-sm font-medium" htmlFor="notes">ملاحظات مدير المشروع (تظهر في التقرير)</label>
          <textarea id="notes" className="field min-h-20" value={notes ?? r.notes ?? ''} onChange={(e) => setNotes(e.target.value)} />
          {notes !== null && notes !== (r.notes ?? '') && <Btn size="sm" variant="ghost" onClick={async () => { await updateRecord('weekly_reports', r.id, { notes }); setNotes(null); }}>حفظ الملاحظات</Btn>}
        </div>
      )}
      {r.notes && r.status !== 'draft' && <p className="mb-3 rounded-lg border border-line bg-card p-3 text-sm"><b>ملاحظات مدير المشروع:</b> {r.notes}</p>}
      <div className="overflow-hidden rounded-lg border border-line">
        {r.snapshot && Object.keys(r.snapshot).length ? <ReportView snap={r.snapshot} /> : <Empty title="التقرير فارغ" hint="اضغط «تحديث البيانات» لجمع بيانات الأسبوع." />}
      </div>
      {r.approved_at && <p className="mt-2 text-xs text-ink-soft">اعتُمد في {new Date(r.approved_at).toLocaleString('ar-SA-u-nu-latn')}</p>}
    </>
  );
}
