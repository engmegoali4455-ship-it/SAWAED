'use client';
import Link from 'next/link';
import { HBars, STATUS_COLOR, Trend } from '@/components/charts';
import { FollowUpList } from '@/components/follow-ups';
import { AppShell, RefreshButton } from '@/components/shell';
import { Badge, Card, DualDate, Empty, LinkBtn, PageTitle, Progress, Spinner, Stat } from '@/components/ui';
import { followUps, portfolio, progressOf } from '@/lib/analytics';
import { formatHijri, isUpdateLate, todayRiyadh } from '@/lib/domain';
import { useAllData } from '@/lib/hooks';
import { INVOICE_STATUS, PROJECT_STATUS, REPORT_STATUS } from '@/lib/labels';
import { useSession } from '@/lib/session';

export default function Home() {
  return <AppShell><HomeInner /></AppShell>;
}

function HomeInner() {
  const s = useSession();
  if (s.isGlobal) return <Dashboard />;
  if (s.isExternal) return <OwnerHome />;
  return <FieldHome />;
}

// ---------------------------------------------------------------------
// لوحة القيادة (مدير القسم / مدير النظام)
// ---------------------------------------------------------------------
function Dashboard() {
  const d = useAllData();
  if (!d) return <Spinner />;
  const today = todayRiyadh();
  const p = portfolio(d, today);
  const f = followUps(d, today);
  const statusTone: Record<string, string> = { ongoing: STATUS_COLOR.good, ending_soon: STATUS_COLOR.warning, in_process: '#2a78d6', done: STATUS_COLOR.neutral, stopped: STATUS_COLOR.critical };
  const invTone: Record<string, string> = { preparing: STATUS_COLOR.neutral, submitted: STATUS_COLOR.warning, approved: '#2a78d6', paid: STATUS_COLOR.good, rejected: STATUS_COLOR.critical };
  return (
    <>
      <PageTitle title="لوحة القيادة" sub={<>اليوم {formatHijri(today)} · <RefreshButton /></>}
        actions={<LinkBtn href="/projects/" variant="primary">المشاريع</LinkBtn>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="المشاريع النشطة" value={p.active} hint={`من ${p.total} مشروع`} />
        <Stat label="متوسط الإنجاز" value={`${p.avgProgress}%`} />
        <Stat label="تحديثات متأخرة" value={p.lateUpdates.length} tone={p.lateUpdates.length ? 'red' : 'green'} hint="أكثر من 7 أيام" />
        <Stat label="يحتاج متابعة" value={f.length} tone={f.some((x) => x.priority === 1) ? 'red' : f.length ? 'amber' : 'green'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="يحتاج متابعة الآن" className="lg:col-span-1 lg:row-span-2"><FollowUpList items={f} limit={12} /></Card>
        <div className="grid gap-4 lg:col-span-2 md:grid-cols-2">
          <Trend title="تطور متوسط الإنجاز (12 أسبوعاً)" data={p.trend} series={[{ key: 'avg', label: 'متوسط الإنجاز' }]} unit="%" domain={[0, 100]} />
          <Trend title="انتظام التحديثات الأسبوعية" data={p.trend} series={[{ key: 'regular', label: 'نسبة المشاريع المحدّثة' }]} unit="%" domain={[0, 100]} />
          <HBars title="المشاريع حسب الحالة" data={Object.entries(PROJECT_STATUS).map(([k, l]) => ({ label: l, value: p.byStatus[k] ?? 0, color: statusTone[k] }))} />
          <HBars title="شرائح الإنجاز (المشاريع النشطة)" data={p.buckets} />
          <HBars title="التوزيع على المراحل" data={p.byStage} />
          <HBars title="المخاطر المرتفعة لكل مشروع" data={p.risksPerProject} />
          <HBars title="الفحوصات شهرياً" data={p.inspectionsMonthly} />
          <HBars title="المستخلصات حسب الحالة (ريال)" data={Object.entries(INVOICE_STATUS).map(([k, l]) => ({ label: l, value: Math.round(p.invoiceStatus[k] ?? 0), color: invTone[k] }))} />
          <div className="md:col-span-2"><HBars title="أحمال المهندسين (نسبة التفرغ)" data={p.loads.map((l) => ({ ...l, color: l.value > 100 ? STATUS_COLOR.critical : undefined }))} unit="%" /></div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// التطبيق الميداني (المهندس / مدير المشروع)
// ---------------------------------------------------------------------
function FieldHome() {
  const s = useSession();
  const d = useAllData();
  if (!d) return <Spinner />;
  const mine = new Set(s.activeAssignments.map((a) => a.project_id));
  const projects = d.projects.filter((p: any) => mine.has(p.id));
  const f = followUps({ ...d, projects }, todayRiyadh(), { staffing: false });
  return (
    <>
      <PageTitle title={`مرحباً ${s.engineer?.name ?? s.profile?.full_name ?? ''}`} sub={<>مشاريعك المكلّف بها · <RefreshButton /></>} />
      {!projects.length && <Empty title="لا توجد مشاريع مكلّف بها حالياً" hint="يظهر المشروع هنا فور تكليفك به من مدير القسم." />}
      <div className="grid gap-3 md:grid-cols-2">
        {projects.map((p: any) => {
          const late = isUpdateLate(p.status, p.last_update_date);
          const role = s.projectRole(p.id);
          return (
            <Card key={p.id} title={<Link href={`/project/?id=${p.id}`} className="hover:text-brand-text">{p.name}</Link>}
              action={<Badge code={p.status}>{PROJECT_STATUS[p.status]}</Badge>}>
              <div className="mb-2 flex items-center justify-between text-xs text-ink-soft">
                <span>{d.stages.find((x: any) => x.id === p.current_stage_id)?.name ?? '—'}</span>
                <span className="num">{progressOf(p, d.stages)}%</span>
              </div>
              <Progress value={progressOf(p, d.stages)} />
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="text-ink-soft">آخر تحديث:</span><DualDate d={p.last_update_date} compact />
                {late && <Badge tone="red">متأخر</Badge>}
                <span className="mr-auto text-ink-soft">{role === 'manager' ? 'مدير المشروع' : 'مهندس'}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <LinkBtn href={`/entry/?t=weekly_updates&p=${p.id}`} variant={late ? 'primary' : 'ghost'}>تحديث أسبوعي</LinkBtn>
                <LinkBtn href={`/entry/?t=inspections&p=${p.id}`}>طلب فحص</LinkBtn>
                <LinkBtn href={`/entry/?t=violations&p=${p.id}`}>مخالفة</LinkBtn>
                <LinkBtn href={`/entry/?t=meetings&p=${p.id}`}>محضر</LinkBtn>
              </div>
            </Card>
          );
        })}
      </div>
      {!!projects.length && <Card title="يحتاج متابعة" className="mt-4"><FollowUpList items={f} limit={8} /></Card>}
    </>
  );
}

// ---------------------------------------------------------------------
// بوابة المالك / المقاول
// ---------------------------------------------------------------------
function OwnerHome() {
  const d = useAllData();
  if (!d) return <Spinner />;
  return (
    <>
      <PageTitle title="مشروعي" sub="التقارير المعتمدة والمخالفات وطلبات الفحص" />
      {d.projects.map((p: any) => (
        <Card key={p.id} className="mb-3" title={<Link href={`/project/?id=${p.id}`}>{p.name}</Link>} action={<Badge code={p.status}>{PROJECT_STATUS[p.status]}</Badge>}>
          <Progress value={progressOf(p, d.stages)} />
          <ul className="mt-3 divide-y divide-line text-sm">
            {d.reports.filter((r: any) => r.project_id === p.id).sort((a: any, b: any) => b.week_start.localeCompare(a.week_start)).map((r: any) => (
              <li key={r.id}><Link href={`/report/?id=${r.id}`} className="flex justify-between py-2"><span>تقرير أسبوع <DualDate d={r.week_start} compact /></span><Badge code={r.status}>{REPORT_STATUS[r.status]}</Badge></Link></li>
            ))}
          </ul>
        </Card>
      ))}
      <p className="text-xs text-ink-soft">الاطلاع للقراءة فقط. يمكنك الرد على المخالفات وطلبات الفحص من صفحة المشروع.</p>
    </>
  );
}
