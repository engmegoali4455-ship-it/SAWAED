import { describe, expect, it } from 'vitest';
import {
  formatHijri, isUpdateLate, isWorkLate, permitAlert, projectProgress, riskLevel, riskScore,
  staffingAlerts, stageProgress, stageWeightsValid, todayRiyadh, weekRange, weekStart,
} from './domain';

const stages = [5, 5, 10, 10, 20, 10, 10, 10, 10, 5, 5].map((weight, i) => ({ id: `st${i + 1}`, sort_order: i + 1, weight }));

describe('stage progress', () => {
  it('sums weights up to and including the current stage', () => {
    expect(stageProgress(stages, 'st1')).toBe(5);
    expect(stageProgress(stages, 'st3')).toBe(20);
    expect(stageProgress(stages, 'st5')).toBe(50);
    expect(stageProgress(stages, 'st11')).toBe(100);
  });
  it('is 0 without a stage or with an unknown stage', () => {
    expect(stageProgress(stages, null)).toBe(0);
    expect(stageProgress(stages, 'nope')).toBe(0);
  });
  it('manual progress overrides weights, including 0', () => {
    expect(projectProgress(37, stages, 'st3')).toBe(37);
    expect(projectProgress(0, stages, 'st5')).toBe(0);
    expect(projectProgress(null, stages, 'st5')).toBe(50);
  });
  it('validates weights total 100', () => {
    expect(stageWeightsValid(stages)).toBe(true);
    expect(stageWeightsValid(stages.slice(1))).toBe(false);
  });
  it('does not depend on array order', () => {
    expect(stageProgress([...stages].reverse(), 'st3')).toBe(20);
  });
});

describe('risk', () => {
  it('score is probability × impact', () => expect(riskScore(3, 4)).toBe(12));
  it('15+ high, 8–14 medium, else low', () => {
    expect(riskLevel(3, 5)).toBe('high');
    expect(riskLevel(5, 5)).toBe('high');
    expect(riskLevel(2, 4)).toBe('medium');
    expect(riskLevel(2, 7)).toBe('medium');
    expect(riskLevel(1, 7)).toBe('low');
    expect(riskLevel(1, 1)).toBe('low');
  });
});

describe('late states', () => {
  it('update: more than 7 days is late', () => {
    expect(isUpdateLate('ongoing', '2026-10-11', '2026-10-18')).toBe(false);
    expect(isUpdateLate('ongoing', '2026-10-10', '2026-10-18')).toBe(true);
    expect(isUpdateLate('in_process', null, '2026-10-18')).toBe(true);
  });
  it('update: finished or stopped projects are never late', () => {
    expect(isUpdateLate('done', '2020-01-01', '2026-10-18')).toBe(false);
    expect(isUpdateLate('stopped', null, '2026-10-18')).toBe(false);
  });
  it('work: past planned end and incomplete', () => {
    expect(isWorkLate('2026-10-17', 80, 'in_progress', '2026-10-18')).toBe(true);
    expect(isWorkLate('2026-10-18', 80, 'in_progress', '2026-10-18')).toBe(false);
    expect(isWorkLate('2026-10-01', 100, 'in_progress', '2026-10-18')).toBe(false);
    expect(isWorkLate('2026-10-01', 90, 'completed', '2026-10-18')).toBe(false);
    expect(isWorkLate(null, 0, 'not_started', '2026-10-18')).toBe(false);
  });
  it('permit alerts at 30 and 7 days', () => {
    expect(permitAlert('2026-11-17', '2026-10-18')).toBe('d30');
    expect(permitAlert('2026-11-18', '2026-10-18')).toBe(null);
    expect(permitAlert('2026-10-25', '2026-10-18')).toBe('d7');
    expect(permitAlert('2026-10-17', '2026-10-18')).toBe('expired');
  });
});

describe('week Saturday → Friday', () => {
  it('maps every weekday to the previous Saturday', () => {
    // 2026-10-17 سبت
    for (const [d, s] of [['2026-10-17', '2026-10-17'], ['2026-10-18', '2026-10-17'], ['2026-10-22', '2026-10-17'],
      ['2026-10-23', '2026-10-17'], ['2026-10-24', '2026-10-24']]) expect(weekStart(d)).toBe(s);
  });
  it('range ends on Friday and crosses months', () => {
    expect(weekRange('2026-10-22')).toEqual({ start: '2026-10-17', end: '2026-10-23' });
    expect(weekRange('2026-11-01')).toEqual({ start: '2026-10-31', end: '2026-11-06' });
  });
});

describe('dates', () => {
  it('today follows Riyadh time zone', () => {
    expect(todayRiyadh(new Date('2026-10-17T21:30:00Z'))).toBe('2026-10-18'); // 00:30 الرياض
    expect(todayRiyadh(new Date('2026-10-17T20:59:00Z'))).toBe('2026-10-17');
  });
  it('formats Umm al-Qura Hijri', () => {
    expect(formatHijri('2026-10-18')).toMatch(/1448/);
  });
});

describe('staffing alerts', () => {
  const today = '2026-10-18';
  it('flags missing manager, missing resident, overload and SCE expiry', () => {
    const alerts = staffingAlerts(
      [{ id: 'A', status: 'ongoing', supervision_mode: 'full_staff' }, { id: 'B', status: 'done', supervision_mode: 'full_staff' }],
      [{ id: 'e1', status: 'active', sce_expiry: '2026-11-01' }, { id: 'e2', status: 'active', sce_expiry: '2027-12-01' }],
      [
        { engineer_id: 'e1', project_id: 'A', role: 'site_engineer', allocation_pct: 70, from_date: null, to_date: null },
        { engineer_id: 'e1', project_id: 'B', role: 'site_engineer', allocation_pct: 50, from_date: null, to_date: null },
        { engineer_id: 'e2', project_id: 'A', role: 'project_manager', allocation_pct: 100, from_date: null, to_date: '2026-10-17' },
      ],
      today,
    );
    expect(alerts).toContainEqual({ kind: 'no_manager', project_id: 'A' });   // التكليف انتهى أمس
    expect(alerts).toContainEqual({ kind: 'no_resident', project_id: 'A' });
    expect(alerts).toContainEqual({ kind: 'overload', engineer_id: 'e1', value: 120 });
    expect(alerts).toContainEqual({ kind: 'sce_expiring', engineer_id: 'e1', value: 14 });
    expect(alerts.some((a) => a.project_id === 'B')).toBe(false);              // المشروع المنتهي لا يُنبَّه عليه
  });
});
