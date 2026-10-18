// التخزين المحلي (IndexedDB عبر Dexie): نسخة من بيانات مشاريع المستخدم،
// وطابور المزامنة (outbox)، والتعارضات، والصور قبل رفعها.
import Dexie, { type Table } from 'dexie';

export type Row = Record<string, any> & { id: string };

export const PROJECT_TABLES = [
  'weekly_updates', 'works', 'inspections', 'stage_suggestions', 'meetings', 'meeting_actions',
  'violations', 'risks', 'permits', 'invoices', 'photos', 'weekly_reports', 'assignments', 'external_responses',
] as const;
export const GLOBAL_TABLES = ['projects', 'stages', 'code_references', 'engineers', 'dept_managers', 'profiles', 'app_settings'] as const;
export const DATA_TABLES = [...GLOBAL_TABLES, ...PROJECT_TABLES, 'stage_code_references', 'project_external_members', 'notifications'] as const;
export type DataTable = (typeof DATA_TABLES)[number];

export interface OutboxOp {
  seq?: number;
  op: 'insert' | 'update' | 'delete' | 'upload' | 'rpc';
  table: string;          // للرفع: اسم الحاوية (bucket)، وللـ rpc: اسم الدالة
  record_id: string;
  payload: Record<string, any>;
  base_version?: number;  // الإصدار الذي بُني عليه التعديل
  status: 'pending' | 'failed' | 'conflict';
  error?: string;
  attempts: number;
  created_at: string;
}
export interface Conflict {
  id: string;             // table:record_id
  table: string; record_id: string; seq: number;
  local: Record<string, any>;   // تعديلاتي
  server: Row;                   // النسخة الحالية في الخادم
  created_at: string;
}
export interface BlobRow { id: string; bucket: string; path: string; blob: Blob; uploaded: 0 | 1 }

class SawaedDB extends Dexie {
  outbox!: Table<OutboxOp, number>;
  conflicts!: Table<Conflict, string>;
  blobs!: Table<BlobRow, string>;
  meta!: Table<{ key: string; value: any }, string>;
  constructor() {
    super('sawaed');
    const stores: Record<string, string> = {
      outbox: '++seq, table, record_id, status',
      conflicts: 'id',
      blobs: 'id, uploaded',
      meta: 'key',
      projects: 'id, status, updated_at',
      stages: 'id, sort_order',
      code_references: 'id',
      engineers: 'id, user_id',
      dept_managers: 'id, user_id',
      profiles: 'id',
      app_settings: 'key',
      stage_code_references: '[stage_id+reference_id], stage_id',
      project_external_members: '[project_id+user_id], user_id',
      notifications: 'id, user_id, created_at',
    };
    for (const t of PROJECT_TABLES) stores[t] = 'id, project_id, updated_at';
    stores.photos = 'id, project_id, [entity_type+entity_id]';
    stores.meeting_actions = 'id, project_id, meeting_id';
    stores.assignments = 'id, project_id, engineer_id';
    stores.weekly_reports = 'id, project_id, week_start';
    this.version(1).stores(stores);
  }
  t(name: string): Table<Row, any> { return this.table(name); }
}

export const db = new SawaedDB();

export const nowISO = () => new Date().toISOString();
export const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** المعرّف الأساسي للجدول (الإعدادات بالمفتاح، والجداول الوسيطة بمفتاح مركّب) */
export function pkOf(table: string, row: Row | Record<string, any>): any {
  if (table === 'app_settings') return row.key;
  if (table === 'stage_code_references') return [row.stage_id, row.reference_id];
  if (table === 'project_external_members') return [row.project_id, row.user_id];
  return row.id;
}
