'use client';
import { useState } from 'react';
import { HBars, STATUS_COLOR } from '@/components/charts';
import { EntityForm } from '@/components/entity-form';
import { AppShell } from '@/components/shell';
import { Badge, Btn, Card, DualDate, Empty, Modal, PageTitle, Row, Spinner, Tabs } from '@/components/ui';
import type { Row as DbRow } from '@/lib/db';
import { daysBetween, isAssignmentActive, staffingAlerts, todayRiyadh } from '@/lib/domain';
import { useAllData } from '@/lib/hooks';
import { ASSIGNMENT_ROLE, ENGINEER_STATUS } from '@/lib/labels';
import { createRecord, deleteRecord, updateRecord } from '@/lib/mutations';
import { useSession } from '@/lib/session';

export default function StaffingPage() {
  return <AppShell><Inner /></AppShell>;
}

function Inner() {
  const s = useSession();
  const d = useAllData();
  const [tab, setTab] = useState('engineers');
  const [engForm, setEngForm] = useState<{ id?: string } | null>(null);
  const [asg, setAsg] = useState<Partial<DbRow> | null>(null);
  if (!d) return <Spinner />;
  if (!s.isGlobal) return <Empty title="التسكين لمدير القسم" />;
  const today = todayRiyadh();
  const alerts = staffingAlerts(d.projects, d.engineers, d.assignments, today);
  const active = d.assignments.filter((a: any) => isAssignmentActive(a, today));
  const load = (eid: string) => active.filter((a: any) => a.engineer_id === eid).reduce((x: number, a: any) => x + Number(a.allocation_pct), 0);
  const pname = (id: string) => d.projects.find((p: any) => p.id === id)?.name ?? id;
  const ename = (id: string) => d.engineers.find((e: any) => e.id === id)?.name ?? id;
  const alertText = (a: any) => ({ no_manager: `${pname(a.project_id)}: بلا مدير مشروع`, no_resident: `${pname(a.project_id)}: طاقم كامل بلا مهندس مقيم`, overload: `${ename(a.engineer_id)}: تحميل ${a.value}%`, sce_expiring: `${ename(a.engineer_id)}: عضوية الهيئة ${a.value < 0 ? 'منتهية' : `تنتهي خلال ${a.value} يوم`}` } as any)[a.kind];

  return (
    <>
      <PageTitle title="تسكين المهندسين" sub={`${d.engineers.length} مهندس · ${active.length} تكليف ساري`}
        actions={<><Btn size="sm" variant="ghost" onClick={() => setEngForm({})}>+ مهندس</Btn><Btn size="sm" onClick={() => setAsg({ allocation_pct: 100, role: 'site_engineer', from_date: today })}>+ تكليف</Btn></>} />
      {!!alerts.length && (
        <Card title={`تنبيهات التسكين (${alerts.length})`} className="mb-4">
          <ul className="space-y-1.5 text-sm">{alerts.map((a, i) => <li key={i} className="flex items-center gap-2"><Badge tone={a.kind === 'overload' || a.kind === 'no_manager' ? 'red' : 'amber'}>!</Badge>{alertText(a)}</li>)}</ul>
        </Card>
      )}
      <Tabs tabs={[{ key: 'engineers', label: 'المهندسون' }, { key: 'assignments', label: 'التكليفات' }, { key: 'load', label: 'الأحمال' }]} active={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'engineers' && (
          <Card>
            {d.engineers.sort((a: any, b: any) => a.name.localeCompare(b.name, 'ar')).map((e: any) => {
              const l = load(e.id);
              const sce = e.sce_expiry ? daysBetween(today, e.sce_expiry) : null;
              return (
                <Row key={e.id} onClick={() => setEngForm({ id: e.id })}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">{e.name}
                      <Badge code={e.status === 'active' ? 'approved' : 'closed'}>{ENGINEER_STATUS[e.status]}</Badge>
                      {!e.user_id && <Badge tone="amber">بلا حساب</Badge>}
                      {sce != null && sce <= 30 && <Badge tone="red">العضوية {sce < 0 ? 'منتهية' : `${sce} يوم`}</Badge>}
                    </div>
                    <div className="text-xs text-ink-soft">{[e.discipline, e.grade, e.sce_no && `هيئة ${e.sce_no}`, e.mobile].filter(Boolean).join(' · ')}</div>
                    <div className="mt-1 text-xs">{active.filter((a: any) => a.engineer_id === e.id).map((a: any) => `${pname(a.project_id)} (${ASSIGNMENT_ROLE[a.role]})`).join('، ') || <span className="text-ink-soft">غير مكلّف</span>}</div>
                  </div>
                  <span className={`num text-sm font-semibold ${l > 100 ? 'text-red' : ''}`}>{l}%</span>
                </Row>
              );
            })}
          </Card>
        )}
        {tab === 'assignments' && (
          <Card>
            {!d.assignments.length && <Empty title="لا توجد تكليفات" />}
            {[...d.assignments].sort((a: any, b: any) => Number(isAssignmentActive(b, today)) - Number(isAssignmentActive(a, today)) || pname(a.project_id).localeCompare(pname(b.project_id), 'ar')).map((a: any) => (
              <Row key={a.id} onClick={() => setAsg(a)}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{ename(a.engineer_id)} ← {pname(a.project_id)}</div>
                  <div className="text-xs text-ink-soft">{ASSIGNMENT_ROLE[a.role]} · <span className="num">{Number(a.allocation_pct)}%</span></div>
                </div>
                <div className="text-left text-xs">
                  {isAssignmentActive(a, today) ? <Badge tone="green">ساري</Badge> : <Badge>{a.from_date && a.from_date > today ? 'لم يبدأ' : 'منتهٍ'}</Badge>}
                  <div className="mt-1 text-ink-soft">{a.from_date ?? '…'} ← {a.to_date ?? 'مفتوح'}</div>
                </div>
              </Row>
            ))}
          </Card>
        )}
        {tab === 'load' && <HBars title="الأحمال الحالية" unit="%" data={d.engineers.filter((e: any) => e.status === 'active').map((e: any) => ({ label: e.name, value: load(e.id), color: load(e.id) > 100 ? STATUS_COLOR.critical : undefined })).sort((a: any, b: any) => b.value - a.value)} />}
      </div>

      <Modal open={!!engForm} onClose={() => setEngForm(null)} title={engForm?.id ? 'ملف المهندس' : 'مهندس جديد'} wide>
        {engForm && <EntityForm table="engineers" id={engForm.id} onDone={() => setEngForm(null)} />}
        {engForm?.id && <p className="mt-3 text-xs text-ink-soft">ربط الحساب يتم من الإدارة ← المستخدمون عبر البريد.</p>}
      </Modal>
      <Modal open={!!asg} onClose={() => setAsg(null)} title={asg?.id ? 'تعديل التكليف' : 'تكليف جديد'}>
        {asg && <AssignmentForm value={asg} projects={d.projects} engineers={d.engineers} onDone={() => setAsg(null)} />}
      </Modal>
    </>
  );
}

function AssignmentForm({ value, projects, engineers, onDone }: { value: Partial<DbRow>; projects: DbRow[]; engineers: DbRow[]; onDone: () => void }) {
  const [v, setV] = useState<any>({ ...value });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, x: any) => setV((o: any) => ({ ...o, [k]: x }));
  async function save() {
    if (!v.engineer_id || !v.project_id || !v.role) return setErr('اختر المهندس والمشروع والدور');
    const pct = Number(v.allocation_pct);
    if (!(pct > 0 && pct <= 100)) return setErr('نسبة التفرغ بين 1 و100');
    if (v.from_date && v.to_date && v.to_date < v.from_date) return setErr('تاريخ النهاية قبل البداية');
    const data = { engineer_id: v.engineer_id, project_id: v.project_id, role: v.role, allocation_pct: pct, from_date: v.from_date || null, to_date: v.to_date || null };
    if (v.id) await updateRecord('assignments', v.id, data); else await createRecord('assignments', data);
    onDone();
  }
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <label className="block text-sm">المهندس<select className="field mt-1" value={v.engineer_id ?? ''} onChange={(e) => set('engineer_id', e.target.value)}><option value="">—</option>{engineers.filter((e) => e.status === 'active' || e.id === v.engineer_id).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      <label className="block text-sm">المشروع<select className="field mt-1" value={v.project_id ?? ''} onChange={(e) => set('project_id', e.target.value)}><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="block text-sm">الدور<select className="field mt-1" value={v.role} onChange={(e) => set('role', e.target.value)}>{Object.entries(ASSIGNMENT_ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <div className="grid grid-cols-3 gap-2">
        <label className="block text-sm">التفرغ %<input className="field num mt-1" type="number" min={1} max={100} value={v.allocation_pct ?? ''} onChange={(e) => set('allocation_pct', e.target.value)} /></label>
        <label className="block text-sm">من<input className="field num mt-1" type="date" value={v.from_date ?? ''} onChange={(e) => set('from_date', e.target.value)} /></label>
        <label className="block text-sm">إلى<input className="field num mt-1" type="date" value={v.to_date ?? ''} onChange={(e) => set('to_date', e.target.value)} /></label>
      </div>
      <p className="text-xs text-ink-soft">دور «مدير مشروع الإشراف» يمنح صلاحية مدير المشروع. انتهاء التاريخ يسحب الصلاحية تلقائياً.</p>
      {err && <p className="text-sm text-red">{err}</p>}
      <div className="flex gap-2">
        <Btn type="submit">حفظ</Btn>
        {v.id && <Btn type="button" variant="ghost" onClick={async () => { await updateRecord('assignments', v.id, { to_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10) }); onDone(); }}>إنهاء التكليف</Btn>}
        {v.id && <Btn type="button" variant="danger" className="mr-auto" onClick={async () => { if (confirm('حذف التكليف نهائياً؟')) { await deleteRecord('assignments', v.id); onDone(); } }}>حذف</Btn>}
      </div>
    </form>
  );
}
