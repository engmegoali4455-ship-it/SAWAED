// حسابات لوحة القيادة وقائمة "يحتاج متابعة الآن". دوال نقية على صفوف محلية.
import type { Row } from './db';
import {
  ACTIVE_STATUSES, addDays, daysBetween, isUpdateLate, isWorkLate, permitAlert, projectProgress,
  riskLevel, staffingAlerts, stageProgress, todayRiyadh, weekStart, type StageLike,
} from './domain';
import { PERMIT_KIND } from './labels';

export interface Data {
  projects: Row[]; stages: (StageLike & Row)[]; updates: Row[]; works: Row[]; inspections: Row[]; violations: Row[];
  risks: Row[]; permits: Row[]; invoices: Row[]; actions: Row[]; engineers: Row[]; assignments: Row[];
  suggestions?: Row[]; reports?: Row[];
}

const isActive = (p: Row) => ACTIVE_STATUSES.includes(p.status);
export const progressOf = (p: Row, stages: StageLike[]) => projectProgress(p.manual_progress == null ? null : Number(p.manual_progress), stages, p.current_stage_id);
const updProgress = (u: Row, stages: StageLike[]) => (u.progress != null ? Number(u.progress) : stageProgress(stages, u.stage_id));
const shortDate = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;

/** آخر 12 أسبوعاً (بداية كل أسبوع سبت)، الأقدم أولاً */
export function lastWeeks(n = 12, today = todayRiyadh()): string[] {
  const cur = weekStart(today);
  return Array.from({ length: n }, (_, i) => addDays(cur, -7 * (n - 1 - i)));
}

export function portfolio(d: Data, today = todayRiyadh()) {
  const active = d.projects.filter(isActive);
  const byStatus: Record<string, number> = {};
  for (const p of d.projects) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const avgProgress = avg(active.map((p) => progressOf(p, d.stages)));

  // تطور متوسط الإنجاز: لكل أسبوع، آخر نسبة معروفة لكل مشروع نشط حتى نهاية ذلك الأسبوع
  const weeks = lastWeeks(12, today);
  const trend = weeks.map((w) => {
    const end = addDays(w, 6);
    const vals: number[] = [];
    for (const p of active) {
      const last = d.updates.filter((u) => u.project_id === p.id && u.update_date <= end).sort((a, b) => b.update_date.localeCompare(a.update_date))[0];
      if (last) vals.push(updProgress(last, d.stages));
    }
    const updated = new Set(d.updates.filter((u) => u.update_date >= w && u.update_date <= end).map((u) => u.project_id));
    return { label: shortDate(w), avg: vals.length ? avg(vals) : null, regular: active.length ? Math.round((active.filter((p) => updated.has(p.id)).length / active.length) * 100) : 0 };
  });

  const buckets = [[0, 25], [25, 50], [50, 75], [75, 101]].map(([lo, hi]) => ({
    label: `${lo}–${Math.min(hi, 100)}%`, value: active.filter((p) => { const v = progressOf(p, d.stages); return v >= lo && v < hi; }).length,
  }));
  const byStage = d.stages.map((s) => ({ label: s.name as string, value: active.filter((p) => p.current_stage_id === s.id).length }));
  const lateUpdates = active.filter((p) => isUpdateLate(p.status, p.last_update_date, today));
  const risksPerProject = active.map((p) => ({ label: p.name as string, value: d.risks.filter((r) => r.project_id === p.id && r.status !== 'closed' && riskLevel(r.probability, r.impact) === 'high').length }))
    .filter((x) => x.value).sort((a, b) => b.value - a.value).slice(0, 10);
  const months = Array.from({ length: 6 }, (_, i) => { const dt = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); dt.setUTCMonth(dt.getUTCMonth() - (5 - i)); return dt.toISOString().slice(0, 7); });
  const inspectionsMonthly = months.map((m) => ({ label: m.slice(5) + '/' + m.slice(2, 4), value: d.inspections.filter((i) => String(i.created_at ?? '').slice(0, 7) === m).length }));
  const invoiceStatus: Record<string, number> = {};
  for (const i of d.invoices) invoiceStatus[i.status] = (invoiceStatus[i.status] ?? 0) + Number(i.amount_sar ?? 0);
  const loads = d.engineers.filter((e) => e.status === 'active').map((e) => ({
    label: e.name as string,
    value: d.assignments.filter((a) => a.engineer_id === e.id && (!a.from_date || a.from_date <= today) && (!a.to_date || a.to_date >= today)).reduce((s, a) => s + Number(a.allocation_pct), 0),
  })).sort((a, b) => b.value - a.value);

  return { total: d.projects.length, active: active.length, byStatus, avgProgress, trend, buckets, byStage, lateUpdates, risksPerProject, inspectionsMonthly, invoiceStatus, loads };
}

export function projectStats(p: Row, d: Data, today = todayRiyadh()) {
  const ups = d.updates.filter((u) => u.project_id === p.id).sort((a, b) => a.update_date.localeCompare(b.update_date));
  const curve = ups.map((u) => ({ label: shortDate(u.update_date), progress: updProgress(u, d.stages) }));
  const weekly = lastWeeks(12, today).map((w) => {
    const inWeek = ups.filter((u) => u.update_date >= w && u.update_date <= addDays(w, 6));
    return { label: shortDate(w), labor: inWeek.length ? Math.max(...inWeek.map((u) => Number(u.labor_count ?? 0))) : null, visits: inWeek.reduce((s, u) => s + Number(u.visits_count ?? 0), 0) };
  });
  const risks = d.risks.filter((r) => r.project_id === p.id && r.status !== 'closed');
  const riskByLevel = (['high', 'medium', 'low'] as const).map((l) => ({ level: l, value: risks.filter((r) => riskLevel(r.probability, r.impact) === l).length }));
  const insp = d.inspections.filter((i) => i.project_id === p.id);
  const inspByStatus: Record<string, number> = {};
  for (const i of insp) inspByStatus[i.status] = (inspByStatus[i.status] ?? 0) + 1;
  let cum = 0;
  const invoicesCum = d.invoices.filter((i) => i.project_id === p.id && ['approved', 'paid'].includes(i.status))
    .sort((a, b) => String(a.submitted_at ?? a.period_to ?? '').localeCompare(String(b.submitted_at ?? b.period_to ?? '')))
    .map((i) => ({ label: `#${i.number ?? ''}`, total: (cum += Number(i.amount_sar ?? 0)) }));
  const lateWorks = d.works.filter((w) => w.project_id === p.id && isWorkLate(w.planned_end, Number(w.actual_progress), w.status, today));
  return { curve, weekly, riskByLevel, inspByStatus, invoicesCum, lateWorks, progress: progressOf(p, d.stages) };
}

// ---------------------------------------------------------------------
// يحتاج متابعة الآن
// ---------------------------------------------------------------------
export interface FollowUp { priority: 1 | 2 | 3; kind: string; title: string; detail: string; project_id?: string; href: string; date?: string | null }

export function followUps(d: Data, today = todayRiyadh(), opts: { staffing?: boolean } = { staffing: true }): FollowUp[] {
  const out: FollowUp[] = [];
  const pname = (id: string) => d.projects.find((p) => p.id === id)?.name ?? '';
  const known = new Set(d.projects.map((p) => p.id));
  const href = (t: string, pid: string, id?: string) => (id ? `/entry/?t=${t}&p=${pid}&id=${id}` : `/project/?id=${pid}`);

  for (const v of d.violations.filter((v) => known.has(v.project_id) && ['open', 'correcting', 'escalated'].includes(v.status))) {
    const overdue = v.deadline && v.deadline < today;
    if (v.severity === 'major' || overdue) {
      out.push({ priority: 1, kind: v.severity === 'major' ? 'major_violation' : 'violation_overdue', project_id: v.project_id, date: v.deadline,
        title: v.severity === 'major' ? 'مخالفة جسيمة مفتوحة' : 'مخالفة تجاوزت مهلة التصحيح',
        detail: `${pname(v.project_id)} — ${v.description}${overdue ? ` (متأخرة ${daysBetween(v.deadline, today)} يوم)` : ''}`, href: href('violations', v.project_id, v.id) });
    }
  }
  for (const p of d.projects.filter((p) => isUpdateLate(p.status, p.last_update_date, today))) {
    out.push({ priority: 2, kind: 'update_late', project_id: p.id, date: p.last_update_date, title: 'تحديث أسبوعي متأخر',
      detail: `${p.name} — ${p.last_update_date ? `آخر تحديث قبل ${daysBetween(p.last_update_date, today)} يوم` : 'لا يوجد أي تحديث'}`, href: `/entry/?t=weekly_updates&p=${p.id}` });
  }
  for (const pe of d.permits.filter((x) => known.has(x.project_id))) {
    const a = permitAlert(pe.expiry_date, today);
    if (!a) continue;
    out.push({ priority: a === 'd30' ? 3 : 2, kind: 'permit', project_id: pe.project_id, date: pe.expiry_date,
      title: a === 'expired' ? 'ترخيص منتهٍ' : 'ترخيص يقارب الانتهاء',
      detail: `${pname(pe.project_id)} — ${PERMIT_KIND[pe.kind] ?? pe.kind} ${a === 'expired' ? 'انتهى' : `خلال ${daysBetween(today, pe.expiry_date)} يوم`}`, href: href('permits', pe.project_id, pe.id) });
  }
  const staff = opts.staffing === false ? [] : staffingAlerts(d.projects as any, d.engineers as any, d.assignments as any, today);
  for (const s of staff) {
    const e = d.engineers.find((x) => x.id === s.engineer_id);
    const text = { no_manager: 'مشروع بلا مدير مشروع', no_resident: 'طاقم كامل بلا مهندس مقيم', overload: `تحميل ${s.value}%`, sce_expiring: (s.value ?? 0) < 0 ? 'عضوية الهيئة منتهية' : `عضوية الهيئة تنتهي خلال ${s.value} يوم` }[s.kind];
    out.push({ priority: s.kind === 'no_manager' || s.kind === 'overload' ? 2 : 3, kind: s.kind, project_id: s.project_id, title: text,
      detail: s.project_id ? pname(s.project_id) : (e?.name ?? ''), href: '/staffing/' });
  }
  for (const a of d.actions.filter((a) => known.has(a.project_id) && ['open', 'in_progress'].includes(a.status) && a.due_date && a.due_date < today)) {
    out.push({ priority: 3, kind: 'action_overdue', project_id: a.project_id, date: a.due_date, title: 'بند اجتماع تجاوز موعده',
      detail: `${pname(a.project_id)} — ${a.item}${a.owner ? ` (${a.owner})` : ''}`, href: href('meetings', a.project_id, a.meeting_id) });
  }
  for (const w of d.works.filter((w) => known.has(w.project_id) && isWorkLate(w.planned_end, Number(w.actual_progress), w.status, today))) {
    out.push({ priority: 3, kind: 'work_late', project_id: w.project_id, date: w.planned_end, title: 'بند عمل متأخر',
      detail: `${pname(w.project_id)} — ${w.item} (${Number(w.actual_progress)}%)`, href: href('works', w.project_id, w.id) });
  }
  for (const r of d.risks.filter((r) => known.has(r.project_id) && r.status !== 'closed' && riskLevel(r.probability, r.impact) === 'high')) {
    out.push({ priority: 3, kind: 'risk_high', project_id: r.project_id, date: r.due_date, title: `مخاطرة مرتفعة (${r.probability * r.impact})`,
      detail: `${pname(r.project_id)} — ${r.title}`, href: href('risks', r.project_id, r.id) });
  }
  for (const s of (d.suggestions ?? []).filter((s) => s.status === 'pending' && known.has(s.project_id))) {
    out.push({ priority: 3, kind: 'stage_suggestion', project_id: s.project_id, title: 'اقتراح نقل للمرحلة التالية بانتظار التأكيد', detail: pname(s.project_id), href: `/project/?id=${s.project_id}` });
  }
  for (const r of (d.reports ?? []).filter((r) => r.status === 'draft' && known.has(r.project_id) && addDays(r.week_start, 5) <= today)) {
    out.push({ priority: 3, kind: 'report_pending', project_id: r.project_id, title: 'تقرير أسبوعي بانتظار الاعتماد', detail: pname(r.project_id), href: `/report/?id=${r.id}` });
  }
  return out.sort((a, b) => a.priority - b.priority || String(a.date ?? '9').localeCompare(String(b.date ?? '9')));
}
