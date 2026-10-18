import { describe, expect, it } from 'vitest';
import sample from '../fixtures/sample-export.json';
import { date, mapExport, normalizeWeights } from './mapping';

const m = mapExport(sample as Record<string, unknown>);
const ids = (t: string) => m.tables[t].map((r) => r.id);
const row = (t: string, id: string) => m.tables[t].find((r) => r.id === id)!;

describe('import mapping', () => {
  it('keeps original ids and relations', () => {
    expect(ids('projects')).toEqual(['p1', 'p2']);
    expect(row('assignments', 'a1')).toMatchObject({ engineer_id: 'e1', project_id: 'p1', role: 'project_manager', allocation_pct: 50 });
    expect(row('meeting_actions', 'm1-a1')).toMatchObject({ meeting_id: 'm1', project_id: 'p1', due_date: '2026-10-16' });
  });
  it('maps Arabic labels to codes', () => {
    expect(row('projects', 'p1')).toMatchObject({ status: 'ongoing', department: 'architecture', supervision_mode: 'full_staff', current_stage_id: 's3' });
    expect(row('projects', 'p2')).toMatchObject({ status: 'ending_soon', department: 'consulting', supervision_mode: 'visits', current_stage_id: 's9' });
    expect(row('inspections', 'i1')).toMatchObject({ kind: 'inspection_request', status: 'accepted_with_notes', closed_at: '2026-10-14' });
    expect(row('inspections', 'i2')).toMatchObject({ kind: 'ncr', status: 'open' });
    expect(row('violations', 'v1')).toMatchObject({ category: 'safety', severity: 'major', status: 'open' });
    expect(row('permits', 'pe2')).toMatchObject({ kind: 'civil_defense' });
    expect(row('invoices', 'inv1')).toMatchObject({ amount_sar: 25000, status: 'submitted', period_from: '2026-09-01', period_to: '2026-09-30' });
    expect(row('assignments', 'a3')).toMatchObject({ role: 'visiting_engineer' });
  });
  it('parses numbers and dates in several formats', () => {
    expect(row('engineers', 'e1')).toMatchObject({ sce_expiry: '2026-11-15' });
    expect(row('weekly_updates', 'u1')).toMatchObject({ labor_count: 14, visits_count: 3 });
    expect(row('works', 'w1')).toMatchObject({ actual_progress: 60, status: 'in_progress', location: 'الأرضي' });
    expect(date('٠٥/٠٣/٢٠٢٦')).toBe('2026-03-05');
    expect(date({ seconds: 1760745600 })).toBe('2025-10-18');
    expect(date('31/02/2026')).toBe(null);
  });
  it('flags pour-gate stages from their names', () => {
    expect(m.tables.stages.filter((s) => s.is_pour_gate).map((s) => s.id)).toEqual(['s3', 's4', 's5']);
  });
  it('rejects broken records with a reason', () => {
    const r = m.rejected.map((x) => `${x.key}:${x.id ?? x.index}:${x.reason}`);
    expect(r).toContain('projects:p3:اسم المشروع مفقود');
    expect(r).toContain('assignments:a4:المهندس e9 غير موجود');
    expect(r).toContain('updates:u2:المشروع pX غير موجود');
    expect(r).toContain('updates:u3:تاريخ التحديث مفقود أو غير صالح');
    expect(r.some((x) => x.startsWith('violations:v2:فئة غير معروفة'))).toBe(true);
    expect(r).toContain('risks:r2:الاحتمال أو الأثر خارج 1–5');
    expect(r.some((x) => x.startsWith('meetings.actions:1:'))).toBe(true);
    expect(m.rejected).toHaveLength(7);
  });
  it('collects photos with GPS', () => {
    expect(m.photos).toHaveLength(1);
    expect(m.photos[0]).toMatchObject({ entity_type: 'weekly_update', entity_id: 'u1', project_id: 'p1', lat: 24.7 });
  });
  it('warns when weights do not total 100 and can normalize', () => {
    const bad = mapExport({ stages: [{ name: 'أ', weight: 30 }, { name: 'ب', weight: 30 }] });
    expect(bad.warnings.some((w) => w.includes('مجموع أوزان المراحل 60'))).toBe(true);
    normalizeWeights(bad.tables.stages);
    expect(bad.tables.stages.map((s) => s.weight)).toEqual([50, 50]);
  });
});
