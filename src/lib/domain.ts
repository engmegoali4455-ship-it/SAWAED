// منطق المجال المشترك بين الواجهة والتقارير. يطابق دوال app.* في قاعدة البيانات
// (الخادم هو المرجع؛ هذه النسخة للعرض الفوري وللعمل دون اتصال).

export type ProjectStatus = 'ongoing' | 'ending_soon' | 'in_process' | 'done' | 'stopped';
export const ACTIVE_STATUSES: ProjectStatus[] = ['ongoing', 'ending_soon', 'in_process'];

export interface StageLike { id: string; sort_order: number; weight: number }

/** تاريخ اليوم بتوقيت الرياض بصيغة YYYY-MM-DD */
export function todayRiyadh(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(now);
}

function parseISO(d: string): Date {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function toISO(d: Date): string { return d.toISOString().slice(0, 10); }

export function addDays(d: string, n: number): string {
  const x = parseISO(d); x.setUTCDate(x.getUTCDate() + n); return toISO(x);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((parseISO(to).getTime() - parseISO(from).getTime()) / 86_400_000);
}

/** بداية الأسبوع (السبت). الأسبوع من السبت إلى الجمعة. */
export function weekStart(d: string): string {
  const dow = parseISO(d).getUTCDay(); // الأحد = 0 ... السبت = 6
  return addDays(d, -((dow + 1) % 7));
}
export function weekRange(d: string): { start: string; end: string } {
  const start = weekStart(d);
  return { start, end: addDays(start, 6) };
}

/** مجموع أوزان المراحل حتى المرحلة الحالية (شاملة) */
export function stageProgress(stages: StageLike[], currentStageId: string | null | undefined): number {
  if (!currentStageId) return 0;
  const cur = stages.find((s) => s.id === currentStageId);
  if (!cur) return 0;
  return round2(stages.filter((s) => s.sort_order <= cur.sort_order).reduce((a, s) => a + Number(s.weight), 0));
}

export function projectProgress(manual: number | null | undefined, stages: StageLike[], stageId?: string | null): number {
  return manual ?? stageProgress(stages, stageId);
}

export function stageWeightsValid(stages: StageLike[]): boolean {
  return Math.abs(stages.reduce((a, s) => a + Number(s.weight), 0) - 100) < 0.001;
}

export type RiskLevel = 'high' | 'medium' | 'low';
export function riskScore(p: number, i: number): number { return p * i; }
export function riskLevel(p: number, i: number): RiskLevel {
  const s = p * i;
  return s >= 15 ? 'high' : s >= 8 ? 'medium' : 'low';
}

/** المشروع النشط بلا تحديث لأكثر من 7 أيام */
export function isUpdateLate(status: string, lastUpdate: string | null | undefined, today = todayRiyadh()): boolean {
  if (!ACTIVE_STATUSES.includes(status as ProjectStatus)) return false;
  return !lastUpdate || daysBetween(lastUpdate, today) > 7;
}

/** البند الذي تجاوز نهايته المخططة دون أن يكتمل */
export function isWorkLate(plannedEnd: string | null | undefined, progress: number, status: string, today = todayRiyadh()): boolean {
  return !!plannedEnd && plannedEnd < today && (progress ?? 0) < 100 && status !== 'completed';
}

/** تنبيه الترخيص: 30 يوماً ثم 7 أيام، ثم منتهٍ */
export function permitAlert(expiry: string | null | undefined, today = todayRiyadh()): 'expired' | 'd7' | 'd30' | null {
  if (!expiry) return null;
  const left = daysBetween(today, expiry);
  if (left < 0) return 'expired';
  if (left <= 7) return 'd7';
  if (left <= 30) return 'd30';
  return null;
}

export interface AssignmentLike {
  engineer_id: string; project_id: string; role: string; allocation_pct: number;
  from_date: string | null; to_date: string | null;
}
export function isAssignmentActive(a: Pick<AssignmentLike, 'from_date' | 'to_date'>, today = todayRiyadh()): boolean {
  return (!a.from_date || a.from_date <= today) && (!a.to_date || a.to_date >= today);
}

export interface StaffingAlert {
  kind: 'no_manager' | 'no_resident' | 'overload' | 'sce_expiring';
  project_id?: string; engineer_id?: string; value?: number;
}
export function staffingAlerts(
  projects: { id: string; status: string; supervision_mode: string }[],
  engineers: { id: string; status: string; sce_expiry: string | null }[],
  assignments: AssignmentLike[],
  today = todayRiyadh(),
): StaffingAlert[] {
  const out: StaffingAlert[] = [];
  const active = assignments.filter((a) => isAssignmentActive(a, today));
  for (const p of projects.filter((p) => ACTIVE_STATUSES.includes(p.status as ProjectStatus))) {
    const team = active.filter((a) => a.project_id === p.id);
    if (!team.some((a) => a.role === 'project_manager')) out.push({ kind: 'no_manager', project_id: p.id });
    if (p.supervision_mode === 'full_staff' && !team.some((a) => a.role === 'resident_engineer'))
      out.push({ kind: 'no_resident', project_id: p.id });
  }
  for (const e of engineers.filter((e) => e.status === 'active')) {
    const load = active.filter((a) => a.engineer_id === e.id).reduce((s, a) => s + Number(a.allocation_pct), 0);
    if (load > 100) out.push({ kind: 'overload', engineer_id: e.id, value: load });
    if (e.sce_expiry && daysBetween(today, e.sce_expiry) <= 30) out.push({ kind: 'sce_expiring', engineer_id: e.id, value: daysBetween(today, e.sce_expiry) });
  }
  return out;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------
// التواريخ: ميلادي + هجري (أم القرى)
// ---------------------------------------------------------------------
const hFmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

export function formatGregorian(d: string | null | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}
export function formatHijri(d: string | null | undefined): string {
  return d ? hFmt.format(parseISO(d)) : '—';
}
export function formatDual(d: string | null | undefined): string {
  return d ? `${formatGregorian(d)} — ${formatHijri(d)}` : '—';
}

export function formatSAR(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('ar-SA-u-nu-latn', { style: 'currency', currency: 'SAR', maximumFractionDigits: 2 }).format(n);
}
