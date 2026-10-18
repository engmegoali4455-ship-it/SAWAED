'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { EntityForm } from '@/components/entity-form';
import { AppShell } from '@/components/shell';
import { Badge, Btn, Card, DualDate, Empty, Modal, PageTitle, Progress, Row, Spinner } from '@/components/ui';
import { progressOf } from '@/lib/analytics';
import { isUpdateLate } from '@/lib/domain';
import { useAllData } from '@/lib/hooks';
import { DEPARTMENT, PROJECT_STATUS, SUPERVISION_MODE } from '@/lib/labels';
import { useSession } from '@/lib/session';

export default function ProjectsPage() {
  return <AppShell><Inner /></AppShell>;
}

function Inner() {
  const router = useRouter();
  const s = useSession();
  const d = useAllData();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [dept, setDept] = useState('');
  const [adding, setAdding] = useState(false);
  const rows = useMemo(() => {
    if (!d) return [];
    return d.projects.filter((p: any) =>
      (!q || `${p.name} ${p.owner_name ?? ''} ${p.project_no ?? ''} ${p.license_no ?? ''}`.includes(q)) &&
      (status === 'all' || (status === 'active' ? ['ongoing', 'ending_soon', 'in_process'].includes(p.status) : status === 'late' ? isUpdateLate(p.status, p.last_update_date) : p.status === status)) &&
      (!dept || p.department === dept),
    ).sort((a: any, b: any) => a.name.localeCompare(b.name, 'ar'));
  }, [d, q, status, dept]);
  if (!d) return <Spinner />;
  return (
    <>
      <PageTitle title="المشاريع" sub={`${rows.length} مشروع`} actions={s.isGlobal && <Btn onClick={() => setAdding(true)}>+ مشروع جديد</Btn>} />
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input className="field col-span-2" placeholder="بحث بالاسم أو المالك أو الرقم" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="field" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="الحالة">
          <option value="active">النشطة</option><option value="late">التحديث متأخر</option><option value="all">الكل</option>
          {Object.entries(PROJECT_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="field" value={dept} onChange={(e) => setDept(e.target.value)} aria-label="القسم">
          <option value="">كل الأقسام</option>{Object.entries(DEPARTMENT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {!rows.length ? <Empty title="لا توجد مشاريع مطابقة" /> : (
        <Card>
          {rows.map((p: any) => {
            const pr = progressOf(p, d.stages);
            return (
              <Row key={p.id} href={`/project/?id=${p.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{p.name}</span>
                    <Badge code={p.status}>{PROJECT_STATUS[p.status]}</Badge>
                    {isUpdateLate(p.status, p.last_update_date) && <Badge tone="red">تحديث متأخر</Badge>}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-ink-soft">
                    {[p.owner_name, p.project_no && `رقم ${p.project_no}`, DEPARTMENT[p.department], SUPERVISION_MODE[p.supervision_mode]].filter(Boolean).join(' · ')}
                  </div>
                  <div className="mt-2 flex items-center gap-2"><Progress value={pr} /><span className="num w-10 text-xs">{pr}%</span></div>
                </div>
                <div className="hidden shrink-0 text-left text-xs sm:block"><div className="text-ink-soft">آخر تحديث</div><DualDate d={p.last_update_date} compact /></div>
              </Row>
            );
          })}
        </Card>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="مشروع جديد" wide>
        <EntityForm table="projects" onDone={(id) => { setAdding(false); if (id) router.push(`/project/?id=${id}`); }} />
      </Modal>
    </>
  );
}
