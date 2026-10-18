'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/shell';
import { Badge, Btn, Card, DualDate, Empty, PageTitle, Row, Spinner } from '@/components/ui';
import { weekStart, todayRiyadh } from '@/lib/domain';
import { useAllData } from '@/lib/hooks';
import { REPORT_STATUS } from '@/lib/labels';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { syncNow } from '@/lib/sync';

export default function ReportsPage() {
  return <AppShell><Inner /></AppShell>;
}

function Inner() {
  const router = useRouter();
  const s = useSession();
  const d = useAllData();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!d) return <Spinner />;
  const thisWeek = weekStart(todayRiyadh());
  const reports = [...d.reports].sort((a: any, b: any) => b.week_start.localeCompare(a.week_start) || 0);
  const pname = (id: string) => d.projects.find((p: any) => p.id === id)?.name ?? '';
  const manageable = d.projects.filter((p: any) => s.canManageProject(p.id) && ['ongoing', 'ending_soon', 'in_process'].includes(p.status));
  const missing = manageable.filter((p: any) => !d.reports.some((r: any) => r.project_id === p.id && r.week_start === thisWeek));

  async function generate(pid: string) {
    setBusy(pid); setErr(null);
    const { data, error } = await supabase().rpc('generate_weekly_report', { p_project_id: pid });
    setBusy(null);
    if (error) return setErr(navigator.onLine ? error.message : 'التوليد يتطلب اتصالاً بالإنترنت');
    await syncNow();
    router.push(`/report/?id=${data}`);
  }

  return (
    <>
      <PageTitle title="التقارير الأسبوعية" sub={<>الأسبوع الحالي يبدأ السبت <DualDate d={thisWeek} compact /> · تُولَّد تلقائياً كل خميس</>} />
      {err && <p className="mb-3 text-sm text-red">{err}</p>}
      {!!missing.length && (
        <Card title="لم يُولَّد تقرير هذا الأسبوع بعد" className="mb-4">
          {missing.map((p: any) => (
            <Row key={p.id}><span className="flex-1 text-sm">{p.name}</span><Btn size="sm" variant="ghost" disabled={busy === p.id} onClick={() => generate(p.id)}>{busy === p.id ? 'جارٍ…' : 'توليد الآن'}</Btn></Row>
          ))}
        </Card>
      )}
      {!reports.length ? <Empty title="لا توجد تقارير بعد" /> : (
        <Card>
          {reports.map((r: any) => (
            <Row key={r.id} href={`/report/?id=${r.id}`}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{pname(r.project_id)}</div>
                <div className="flex items-center gap-1 text-xs text-ink-soft">أسبوع <DualDate d={r.week_start} compact /> ← <DualDate d={r.week_end} compact /></div>
              </div>
              <Badge code={r.status}>{REPORT_STATUS[r.status]}</Badge>
            </Row>
          ))}
        </Card>
      )}
    </>
  );
}
