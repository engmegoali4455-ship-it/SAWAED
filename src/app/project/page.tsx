'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { HBars, StageLadder, STATUS_COLOR, Trend, VBars } from '@/components/charts';
import { EntityForm } from '@/components/entity-form';
import { EntityList } from '@/components/entity-list';
import { FollowUpList } from '@/components/follow-ups';
import { AppShell } from '@/components/shell';
import { Badge, Btn, Card, DualDate, Empty, LinkBtn, Modal, PageTitle, Progress, Row, Spinner, Stat, Tabs } from '@/components/ui';
import { followUps, projectStats } from '@/lib/analytics';
import { db } from '@/lib/db';
import { formatSAR, isAssignmentActive, isUpdateLate } from '@/lib/domain';
import { useAllData } from '@/lib/hooks';
import * as L from '@/lib/labels';
import { queueRpc } from '@/lib/mutations';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function ProjectPage() {
  return <AppShell><Suspense fallback={<Spinner />}><Inner /></Suspense></AppShell>;
}

const TABS = [
  { key: 'overview', label: 'نظرة عامة' }, { key: 'weekly_updates', label: 'التحديثات' }, { key: 'works', label: 'الأعمال' },
  { key: 'inspections', label: 'الفحوصات' }, { key: 'violations', label: 'المخالفات' }, { key: 'meetings', label: 'المحاضر' },
  { key: 'risks', label: 'المخاطر' }, { key: 'permits', label: 'التراخيص' }, { key: 'invoices', label: 'المستخلصات' },
  { key: 'team', label: 'الفريق' }, { key: 'reports', label: 'التقارير' }, { key: 'audit', label: 'السجل' },
];

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const s = useSession();
  const id = sp.get('id') ?? '';
  const [tab, setTab] = useState(sp.get('tab') ?? 'overview');
  const [editing, setEditing] = useState(false);
  useEffect(() => { setTab(sp.get('tab') ?? 'overview'); }, [sp]);
  const d = useAllData();
  const project = d?.projects.find((p: any) => p.id === id);
  if (!d) return <Spinner />;
  if (!project) return <Empty title="المشروع غير متاح" hint="قد لا تكون مكلّفاً به، أو لم تكتمل المزامنة بعد." action={<LinkBtn href="/">الرئيسية</LinkBtn>} />;

  const role = s.projectRole(id);
  const external = role === 'owner' || role === 'contractor';
  const countKey: Record<string, string> = { weekly_updates: 'updates', works: 'works', inspections: 'inspections', violations: 'violations', risks: 'risks', permits: 'permits', invoices: 'invoices' };
  const tabs = TABS.filter((t) => (external ? ['overview', 'inspections', 'violations', 'reports'].includes(t.key) : t.key !== 'audit' || s.canManageProject(id)))
    .map((t) => ({ ...t, count: countKey[t.key] ? d[countKey[t.key]].filter((r: any) => r.project_id === id).length : undefined }));
  const change = (k: string) => { setTab(k); router.replace(`/project/?id=${id}&tab=${k}`, { scroll: false }); };

  return (
    <>
      <PageTitle
        title={<span className="flex flex-wrap items-center gap-2">{project.name}<Badge code={project.status}>{L.PROJECT_STATUS[project.status]}</Badge>{isUpdateLate(project.status, project.last_update_date) && <Badge tone="red">تحديث متأخر</Badge>}</span>}
        sub={[project.owner_name, project.project_no && `رقم ${project.project_no}`, L.SUPERVISION_MODE[project.supervision_mode]].filter(Boolean).join(' · ')}
        actions={<>
          {s.canWrite(id) && <LinkBtn href={`/entry/?t=weekly_updates&p=${id}`} variant="primary">+ تحديث أسبوعي</LinkBtn>}
          {s.canManageProject(id) && <Btn size="sm" variant="ghost" onClick={() => setEditing(true)}>تعديل المشروع</Btn>}
        </>} />
      <Tabs tabs={tabs} active={tab} onChange={change} />
      <div className="mt-4">
        {tab === 'overview' && <Overview project={project} d={d} />}
        {['weekly_updates', 'works', 'inspections', 'violations', 'meetings', 'risks', 'permits', 'invoices'].includes(tab) && <EntityList table={tab} projectId={id} readOnly={external} />}
        {tab === 'team' && <Team projectId={id} d={d} />}
        {tab === 'reports' && <ReportsList projectId={id} />}
        {tab === 'audit' && <Audit projectId={id} />}
      </div>
      <Modal open={editing} onClose={() => setEditing(false)} title="بيانات المشروع" wide>
        <EntityForm table="projects" id={id} onDone={() => setEditing(false)} />
      </Modal>
    </>
  );
}

function Overview({ project, d }: { project: any; d: any }) {
  const s = useSession();
  const st = projectStats(project, d);
  const suggestions = d.suggestions.filter((x: any) => x.project_id === project.id && x.status === 'pending');
  const f = followUps({ ...d, projects: [project] }, undefined, { staffing: s.isGlobal });
  const stageName = (sid: string) => d.stages.find((x: any) => x.id === sid)?.name;
  const decide = (sug: any, confirm: boolean) => queueRpc('decide_stage_suggestion', { p_id: sug.id, p_confirm: confirm }, async () => {
    await db.t('stage_suggestions').put({ ...sug, status: confirm ? 'confirmed' : 'dismissed' });
    if (confirm) await db.t('projects').put({ ...project, current_stage_id: sug.to_stage_id, manual_progress: null });
  });
  const lvlTone: Record<string, string> = { high: STATUS_COLOR.critical, medium: STATUS_COLOR.warning, low: STATUS_COLOR.good };
  return (
    <div className="space-y-4">
      {suggestions.map((sug: any) => (
        <div key={sug.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-brand bg-brand/5 p-3">
          <span className="flex-1 text-sm">قُبل فحص «قبل الصب» — هل ينتقل المشروع من <b>{stageName(sug.from_stage_id)}</b> إلى <b>{stageName(sug.to_stage_id)}</b>؟</span>
          {s.canWrite(project.id) && <><Btn size="sm" onClick={() => decide(sug, true)}>تأكيد النقل</Btn><Btn size="sm" variant="ghost" onClick={() => decide(sug, false)}>لاحقاً</Btn></>}
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="نسبة الإنجاز" value={`${st.progress}%`} hint={project.manual_progress != null ? 'نسبة يدوية' : 'من أوزان المراحل'} />
        <Stat label="آخر تحديث" value={<DualDate d={project.last_update_date} compact />} tone={isUpdateLate(project.status, project.last_update_date) ? 'red' : undefined} />
        <Stat label="أعمال متأخرة" value={st.lateWorks.length} tone={st.lateWorks.length ? 'red' : 'green'} />
        <Stat label="مخاطر مرتفعة" value={st.riskByLevel[0].value} tone={st.riskByLevel[0].value ? 'red' : 'green'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="سلّم المراحل">
          <Progress value={st.progress} />
          <div className="mt-3"><StageLadder stages={d.stages} currentId={project.current_stage_id} /></div>
          {project.stage_detail && <p className="mt-3 text-sm text-ink-soft">التفصيل: {project.stage_detail}</p>}
        </Card>
        <div className="grid gap-4 lg:col-span-2 md:grid-cols-2">
          <Trend title="منحنى الإنجاز" data={st.curve} series={[{ key: 'progress', label: 'الإنجاز' }]} unit="%" domain={[0, 100]} />
          <Trend title="العمالة والزيارات (12 أسبوعاً)" data={st.weekly} series={[{ key: 'labor', label: 'العمالة' }, { key: 'visits', label: 'الزيارات' }]} />
          <HBars title="المخاطر المفتوحة حسب المستوى" data={st.riskByLevel.map((r) => ({ label: L.RISK_LEVEL[r.level], value: r.value, color: lvlTone[r.level] }))} />
          <HBars title="الفحوصات حسب الحالة" data={Object.entries(L.INSPECTION_STATUS).map(([k, l]) => ({ label: l, value: st.inspByStatus[k] ?? 0 }))} />
          <VBars title="المستخلصات المعتمدة التراكمية (ريال)" data={st.invoicesCum.map((x) => ({ label: x.label, value: x.total }))} />
          <Card title="الأعمال المتأخرة">
            {!st.lateWorks.length ? <p className="text-sm text-green">✔ لا توجد أعمال متأخرة</p> : st.lateWorks.map((w: any) => (
              <Row key={w.id} href={`/entry/?t=works&p=${project.id}&id=${w.id}`}><span className="flex-1 text-sm">{w.item}</span><span className="num text-xs text-red">{Number(w.actual_progress)}%</span></Row>
            ))}
          </Card>
        </div>
      </div>
      <Card title="يحتاج متابعة في هذا المشروع"><FollowUpList items={f} /></Card>
      <Card title="بيانات المشروع">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          {[['القسم', L.DEPARTMENT[project.department]], ['رقم الرخصة', project.license_no], ['رقم الطلب', project.request_no], ['رقم الخدمة', project.service_no], ['نوع المستخلص', project.invoice_type], ['المستخلصات المعتمدة', formatSAR(st.invoicesCum.at(-1)?.total ?? 0)]]
            .map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-xs text-ink-soft">{k}</dt><dd className="truncate">{v || '—'}</dd></div>)}
        </dl>
      </Card>
    </div>
  );
}

function Team({ projectId, d }: { projectId: string; d: any }) {
  const rows = d.assignments.filter((a: any) => a.project_id === projectId);
  return (
    <Card title="فريق الإشراف" action={<Link href="/staffing/" className="text-xs text-brand-text underline">التسكين</Link>}>
      {!rows.length ? <Empty title="لا يوجد مهندسون مكلّفون" /> : rows.map((a: any) => {
        const e = d.engineers.find((x: any) => x.id === a.engineer_id);
        const active = isAssignmentActive(a);
        return (
          <Row key={a.id}>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{e?.name ?? '—'}</div>
              <div className="text-xs text-ink-soft">{L.ASSIGNMENT_ROLE[a.role]} · {e?.discipline ?? ''} · <span className="num">{Number(a.allocation_pct)}%</span></div>
            </div>
            <div className="text-left text-xs">{active ? <Badge tone="green">ساري</Badge> : <Badge>منتهٍ</Badge>}<div className="mt-1 text-ink-soft"><DualDate d={a.to_date} compact /></div></div>
          </Row>
        );
      })}
    </Card>
  );
}

function ReportsList({ projectId }: { projectId: string }) {
  const rows = useLiveQuery(() => db.t('weekly_reports').where('project_id').equals(projectId).reverse().sortBy('week_start'), [projectId]) ?? [];
  return (
    <Card title="التقارير الأسبوعية">
      {!rows.length ? <Empty title="لا توجد تقارير بعد" hint="يُولَّد التقرير تلقائياً كل خميس." /> : rows.map((r) => (
        <Row key={r.id} href={`/report/?id=${r.id}`}>
          <span className="flex-1 text-sm">أسبوع <DualDate d={r.week_start} compact /> ← <DualDate d={r.week_end} compact /></span>
          <Badge code={r.status}>{L.REPORT_STATUS[r.status]}</Badge>
        </Row>
      ))}
    </Card>
  );
}

const TABLE_AR: Record<string, string> = { projects: 'المشروع', weekly_updates: 'تحديث', works: 'عمل', inspections: 'فحص', violations: 'مخالفة', meetings: 'محضر', meeting_actions: 'بند متابعة', risks: 'مخاطرة', permits: 'ترخيص', invoices: 'مستخلص', photos: 'صورة', weekly_reports: 'تقرير', assignments: 'تكليف', stage_suggestions: 'اقتراح مرحلة' };
function Audit({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    supabase().from('audit_log').select('id, table_name, record_id, action, actor, at, old_data, new_data').eq('project_id', projectId).order('at', { ascending: false }).limit(200)
      .then(({ data, error }) => (error ? setErr('السجل يتطلب اتصالاً بالإنترنت') : setRows(data)));
  }, [projectId]);
  const names = useLiveQuery(() => db.t('profiles').toArray(), []) ?? [];
  if (err) return <Empty title={err} />;
  if (!rows) return <Spinner />;
  return (
    <Card title="سجل التدقيق (آخر 200 عملية)">
      {rows.map((r) => {
        const changed = r.action === 'update' ? Object.keys(r.new_data ?? {}).filter((k) => !['updated_at', 'version', 'updated_by'].includes(k) && JSON.stringify(r.new_data[k]) !== JSON.stringify(r.old_data?.[k])) : [];
        return (
          <Row key={r.id}>
            <div className="min-w-0 flex-1 text-sm">
              <b>{{ insert: 'إضافة', update: 'تعديل', delete: 'حذف' }[r.action as string]}</b> {TABLE_AR[r.table_name] ?? r.table_name}
              {changed.length > 0 && <div className="mt-0.5 space-y-0.5 text-xs text-ink-soft">{changed.slice(0, 4).map((k) => <div key={k} className="truncate">{k}: <s>{String(r.old_data?.[k] ?? '—')}</s> ← {String(r.new_data[k] ?? '—')}</div>)}</div>}
            </div>
            <div className="shrink-0 text-left text-xs text-ink-soft">
              <div>{names.find((n) => n.id === r.actor)?.full_name ?? (r.actor ? 'مستخدم' : 'النظام')}</div>
              <div className="num">{new Date(r.at).toLocaleString('ar-SA-u-nu-latn', { dateStyle: 'short', timeStyle: 'short' })}</div>
            </div>
          </Row>
        );
      })}
    </Card>
  );
}
