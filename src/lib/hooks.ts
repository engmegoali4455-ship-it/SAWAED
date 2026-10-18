'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncExternalStore } from 'react';
import { db, type Row } from './db';
import { syncStore } from './sync';

export function useSyncState() {
  return useSyncExternalStore(syncStore.subscribe, syncStore.get, syncStore.get);
}

/** كل صفوف جدول (اختيارياً لمشروع واحد)، مرتبة */
export function useRows(table: string, projectId?: string | null, sort?: (a: Row, b: Row) => number): Row[] | undefined {
  return useLiveQuery(async () => {
    const rows = projectId ? await db.t(table).where('project_id').equals(projectId).toArray() : await db.t(table).toArray();
    return sort ? rows.sort(sort) : rows;
  }, [table, projectId]);
}

export function useRow(table: string, id: string | null | undefined): Row | undefined {
  return useLiveQuery(() => (id ? db.t(table).get(id) : undefined), [table, id]);
}

export function useStages(): Row[] {
  return useLiveQuery(() => db.t('stages').orderBy('sort_order').toArray(), []) ?? [];
}

export function useSetting<T = any>(key: string): T | undefined {
  return useLiveQuery(async () => (await db.t('app_settings').get(key))?.value as T, [key]);
}

export const byDesc = (k: string) => (a: Row, b: Row) => String(b[k] ?? '').localeCompare(String(a[k] ?? ''));
export const byAsc = (k: string) => (a: Row, b: Row) => String(a[k] ?? '').localeCompare(String(b[k] ?? ''));

/** كل البيانات المحلية للوحة القيادة والتنبيهات */
export function useAllData() {
  return useLiveQuery(async () => {
    const [projects, stages, updates, works, inspections, violations, risks, permits, invoices, actions, engineers, assignments, suggestions, reports] = await Promise.all(
      ['projects', 'stages', 'weekly_updates', 'works', 'inspections', 'violations', 'risks', 'permits', 'invoices', 'meeting_actions', 'engineers', 'assignments', 'stage_suggestions', 'weekly_reports']
        .map((t) => db.t(t).toArray()),
    );
    stages.sort((a, b) => a.sort_order - b.sort_order);
    return { projects, stages, updates, works, inspections, violations, risks, permits, invoices, actions, engineers, assignments, suggestions, reports } as any;
  }, []);
}
