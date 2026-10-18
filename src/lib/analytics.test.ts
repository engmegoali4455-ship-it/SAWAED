import { describe, expect, it } from 'vitest';
import { followUps, lastWeeks, portfolio, projectStats, type Data } from './analytics';

const stages = [10, 10, 20, 20, 20, 20].map((weight, i) => ({ id: `s${i + 1}`, name: `مرحلة ${i + 1}`, sort_order: i + 1, weight }));
const today = '2026-10-22'; // خميس
const base: Data = {
  stages: stages as any,
  projects: [
    { id: 'A', name: 'أ', status: 'ongoing', current_stage_id: 's3', last_update_date: '2026-10-20', supervision_mode: 'full_staff' },
    { id: 'B', name: 'ب', status: 'ongoing', current_stage_id: 's5', manual_progress: 90, last_update_date: '2026-10-01', supervision_mode: 'visits' },
    { id: 'C', name: 'ج', status: 'done', current_stage_id: 's6', last_update_date: null, supervision_mode: 'visits' },
  ],
  updates: [
    { id: 'u1', project_id: 'A', update_date: '2026-10-06', stage_id: 's2' },
    { id: 'u2', project_id: 'A', update_date: '2026-10-20', stage_id: 's3', labor_count: 12, visits_count: 2 },
    { id: 'u3', project_id: 'B', update_date: '2026-10-01', progress: 90 },
  ],
  works: [{ id: 'w1', project_id: 'A', item: 'حديد', planned_end: '2026-10-21', actual_progress: 50, status: 'in_progress' }],
  inspections: [{ id: 'i1', project_id: 'A', status: 'open', created_at: '2026-10-05T10:00:00Z' }],
  violations: [
    { id: 'v1', project_id: 'A', severity: 'major', status: 'open', description: 'بدون حزام', deadline: '2026-10-30' },
    { id: 'v2', project_id: 'B', severity: 'minor', status: 'correcting', description: 'نظافة', deadline: '2026-10-10' },
    { id: 'v3', project_id: 'B', severity: 'major', status: 'closed', description: 'مغلقة' },
  ],
  risks: [{ id: 'r1', project_id: 'A', title: 'توريد', probability: 3, impact: 5, status: 'open' }],
  permits: [{ id: 'pe1', project_id: 'A', kind: 'building_permit', expiry_date: '2026-10-28' }],
  invoices: [
    { id: 'n1', project_id: 'A', number: 1, amount_sar: 1000, status: 'paid', submitted_at: '2026-08-01' },
    { id: 'n2', project_id: 'A', number: 2, amount_sar: 500, status: 'approved', submitted_at: '2026-09-01' },
    { id: 'n3', project_id: 'A', number: 3, amount_sar: 700, status: 'submitted', submitted_at: '2026-10-01' },
  ],
  actions: [{ id: 'a1', project_id: 'A', meeting_id: 'm1', item: 'جدول', status: 'open', due_date: '2026-10-20' }],
  engineers: [{ id: 'e1', name: 'فهد', status: 'active', sce_expiry: '2027-10-01' }],
  assignments: [{ id: 'as1', engineer_id: 'e1', project_id: 'A', role: 'project_manager', allocation_pct: 120, from_date: null, to_date: null }],
};

describe('portfolio', () => {
  const p = portfolio(base, today);
  it('counts and averages active projects only', () => {
    expect(p.total).toBe(3);
    expect(p.active).toBe(2);
    expect(p.avgProgress).toBe(Math.round((40 + 90) / 2));
    expect(p.byStatus).toEqual({ ongoing: 2, done: 1 });
  });
  it('flags late updates (>7 days)', () => expect(p.lateUpdates.map((x) => x.id)).toEqual(['B']));
  it('trend uses last known progress per week', () => {
    expect(p.trend).toHaveLength(12);
    expect(p.trend.at(-1)!.avg).toBe(65);      // A=40 (s3), B=90
    expect(p.trend.at(-1)!.regular).toBe(50);  // A حدّث هذا الأسبوع، B لا
  });
  it('loads include allocations', () => expect(p.loads[0]).toEqual({ label: 'فهد', value: 120 }));
});

describe('project stats', () => {
  const s = projectStats(base.projects[0], base, today);
  it('builds curve and cumulative approved invoices', () => {
    expect(s.curve.map((c) => c.progress)).toEqual([20, 40]);
    expect(s.invoicesCum.map((c) => c.total)).toEqual([1000, 1500]);
  });
  it('lists late works and risks by level', () => {
    expect(s.lateWorks.map((w) => w.id)).toEqual(['w1']);
    expect(s.riskByLevel.find((r) => r.level === 'high')!.value).toBe(1);
  });
});

describe('needs follow-up now', () => {
  const f = followUps(base, today);
  it('puts major and overdue violations first', () => {
    expect(f.slice(0, 2).map((x) => x.kind).sort()).toEqual(['major_violation', 'violation_overdue']);
    expect(f.every((x, i) => i === 0 || f[i - 1].priority <= x.priority)).toBe(true);
  });
  it('includes late update, permit ≤7 days, overload, overdue action, late work, high risk', () => {
    const kinds = f.map((x) => x.kind);
    for (const k of ['update_late', 'permit', 'overload', 'action_overdue', 'work_late', 'risk_high', 'no_resident']) expect(kinds).toContain(k);
    expect(f.find((x) => x.kind === 'permit')!.priority).toBe(2);
  });
  it('ignores closed violations and finished projects', () => {
    expect(f.some((x) => x.detail.includes('مغلقة'))).toBe(false);
    expect(f.some((x) => x.project_id === 'C')).toBe(false);
  });
});

describe('weeks', () => {
  it('returns Saturdays oldest first', () => {
    const w = lastWeeks(3, '2026-10-22');
    expect(w).toEqual(['2026-10-03', '2026-10-10', '2026-10-17']);
  });
});
