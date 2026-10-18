'use client';
// عرض لقطة التقرير الأسبوعي كما سيظهر في PDF
import { riskLevel } from '@/lib/domain';
import * as L from '@/lib/labels';
import { PhotoThumb } from './photos';
import { Badge, DualDate } from './ui';

function Section({ title, children, empty }: { title: string; children: React.ReactNode; empty?: boolean }) {
  return (
    <section className="break-inside-avoid border-t border-line pt-3">
      <h3 className="mb-2 text-[15px] font-semibold text-brand-text">{title}</h3>
      {empty ? <p className="text-sm text-ink-soft">لا يوجد</p> : children}
    </section>
  );
}

export function ReportView({ snap }: { snap: any }) {
  const p = snap.project ?? {};
  const u = (snap.updates ?? []).at(-1);
  return (
    <article className="space-y-4 bg-white p-4 text-sm sm:p-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Info k="المشروع" v={p.name} /><Info k="المالك" v={p.owner_name} />
        <Info k="المرحلة" v={p.current_stage_name} /><Info k="نسبة الإنجاز" v={p.progress != null ? `${Number(p.progress)}%` : '—'} />
        <Info k="رقم الرخصة" v={p.license_no} /><Info k="الحالة" v={L.PROJECT_STATUS[p.status]} />
        <Info k="من" v={<DualDate d={snap.week?.start} />} /><Info k="إلى" v={<DualDate d={snap.week?.end} />} />
      </div>
      <Section title="التحديث الأسبوعي" empty={!u}>
        {u && <div className="space-y-2">
          <P k="المنجز" v={u.done_text} /><P k="خطة الأسبوع القادم" v={u.next_week_plan} /><P k="المعوقات" v={u.obstacles} />
          <div className="flex gap-6 text-xs"><span>العمالة: <b className="num">{u.labor_count ?? '—'}</b></span><span>الزيارات: <b className="num">{(snap.updates ?? []).reduce((a: number, x: any) => a + (x.visits_count ?? 0), 0)}</b></span></div>
        </div>}
      </Section>
      <Section title="الأعمال الجارية" empty={!snap.works?.length}>
        <Table head={['البند', 'الموقع', 'النهاية المخططة', 'الإنجاز']} rows={(snap.works ?? []).map((w: any) => [w.item, w.location, <DualDate key="d" d={w.planned_end} compact />, <span key="p" className={w.is_late ? 'num text-red' : 'num'}>{Number(w.actual_progress)}%{w.is_late ? ' متأخر' : ''}</span>])} />
      </Section>
      <Section title="طلبات الفحص وعدم المطابقة" empty={!snap.inspections?.length}>
        <Table head={['النوع', 'الوصف', 'المرجع', 'الحالة']} rows={(snap.inspections ?? []).map((i: any) => [L.INSPECTION_KIND[i.kind], i.description, i.reference, <Badge key="s" code={i.status}>{L.INSPECTION_STATUS[i.status]}</Badge>])} />
      </Section>
      <Section title="المخالفات" empty={!snap.violations?.length}>
        <Table head={['الفئة', 'الخطورة', 'الوصف', 'المهلة', 'الحالة']} rows={(snap.violations ?? []).map((v: any) => [L.VIOLATION_CATEGORY[v.category], <Badge key="v" code={v.severity}>{L.SEVERITY[v.severity]}</Badge>, v.description, <DualDate key="d" d={v.deadline} compact />, L.VIOLATION_STATUS[v.status]])} />
      </Section>
      <Section title="الاجتماعات" empty={!snap.meetings?.length}>
        {(snap.meetings ?? []).map((m: any) => (
          <div key={m.id} className="mb-2">
            <div className="font-semibold">{m.kind ?? 'اجتماع'} {m.meeting_no ? `رقم ${m.meeting_no}` : ''} — <DualDate d={m.meeting_date} compact /></div>
            {m.decisions && <P k="القرارات" v={m.decisions} />}
            {!!m.actions?.length && <Table head={['بند المتابعة', 'المسؤول', 'الموعد', 'الحالة']} rows={m.actions.map((a: any) => [a.item, a.owner, <DualDate key="d" d={a.due_date} compact />, L.ACTION_STATUS[a.status]])} />}
          </div>
        ))}
      </Section>
      <Section title="المخاطر المفتوحة" empty={!snap.risks?.length}>
        <Table head={['المخاطرة', 'الدرجة', 'المسؤول', 'المعالجة']} rows={(snap.risks ?? []).map((r: any) => [r.title, <Badge key="l" code={riskLevel(r.probability, r.impact)}>{r.score} {L.RISK_LEVEL[riskLevel(r.probability, r.impact)]}</Badge>, r.owner, r.treatment])} />
      </Section>
      <Section title="فريق الإشراف" empty={!snap.team?.length}>
        <Table head={['الاسم', 'الدور', 'التخصص', 'التفرغ']} rows={(snap.team ?? []).map((t: any) => [t.name, L.ASSIGNMENT_ROLE[t.role], t.discipline, `${Number(t.allocation_pct)}%`])} />
      </Section>
      <Section title="صور مختارة" empty={!snap.photos?.length}>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{(snap.photos ?? []).slice(0, 12).map((ph: any) => <PhotoThumb key={ph.id} photo={{ ...ph, storage_path: ph.path, phase: 'general' }} />)}</div>
      </Section>
      <p className="border-t border-line pt-2 text-[11px] text-ink-soft">وُلِّد في {snap.generated_at ? new Date(snap.generated_at).toLocaleString('ar-SA-u-nu-latn') : '—'} · سواعد للاستشارات الهندسية</p>
    </article>
  );
}

const Info = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="min-w-0"><div className="text-[11px] text-ink-soft">{k}</div><div className="truncate font-medium">{v || '—'}</div></div>;
const P = ({ k, v }: { k: string; v?: string | null }) => (v ? <p><span className="font-semibold">{k}: </span><span className="whitespace-pre-line">{v}</span></p> : null);
function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-xs">
        <thead><tr className="bg-paper">{head.map((h) => <th key={h} className="px-2 py-1.5 text-right font-semibold">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-line">{r.map((c, j) => <td key={j} className="px-2 py-1.5 align-top">{c ?? '—'}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
