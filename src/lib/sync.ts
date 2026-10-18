// محرك المزامنة: يدفع طابور العمليات بالترتيب، ثم يسحب ما تغيّر من الخادم،
// ويستقبل البث اللحظي. كل الشاشات تقرأ من IndexedDB فتتحدث تلقائياً.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { db, DATA_TABLES, GLOBAL_TABLES, nowISO, pkOf, PROJECT_TABLES, type OutboxOp, type Row } from './db';
import { supabase } from './supabase';

// ---------------------------------------------------------------------
// حالة المزامنة (تشترك فيها الواجهة عبر useSyncState)
// ---------------------------------------------------------------------
export interface SyncState { online: boolean; syncing: boolean; pending: number; failed: number; conflicts: number; lastSync: string | null; error: string | null }
let state: SyncState = { online: typeof navigator === 'undefined' ? true : navigator.onLine, syncing: false, pending: 0, failed: 0, conflicts: 0, lastSync: null, error: null };
const listeners = new Set<() => void>();
function setState(p: Partial<SyncState>) { state = { ...state, ...p }; listeners.forEach((l) => l()); }
export const syncStore = {
  subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); },
  get: () => state,
};

/** العمليات الجاري إرسالها الآن (لا تُدمج فيها تعديلات جديدة) */
export const inflight = new Set<number>();

// جداول تُسحب كاملة كل مرة (صغيرة وبلا updated_at)
const FULL_TABLES = ['stage_code_references', 'project_external_members'] as const;
const INCREMENTAL = [...GLOBAL_TABLES, ...PROJECT_TABLES].filter((t) => t !== 'external_responses');
const OVERLAP_MS = 5 * 60_000; // هامش لتغطية المعاملات التي التُزمت متأخرة

export class NetworkError extends Error {}

function isNetworkError(e: any): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const msg = String(e?.message ?? e ?? '');
  return !e?.code && /fetch|network|load failed|timeout|ECONN/i.test(msg);
}

export function errorMessage(e: any): string {
  const code = e?.code ?? '';
  if (code === '42501') return 'لا تملك صلاحية تنفيذ هذا الإجراء';
  if (code === '23505') return 'السجل موجود مسبقاً';
  if (code === '23503') return 'السجل مرتبط بسجل غير موجود';
  if (code === '23514') return `قيمة غير مقبولة: ${e?.message ?? ''}`;
  if (code === 'P0409') return 'عُدّل السجل من جهاز آخر';
  return e?.message ?? String(e);
}

const strip = (r: Record<string, any>) => {
  const o: Record<string, any> = {};
  for (const [k, v] of Object.entries(r)) if (!k.startsWith('_')) o[k] = v;
  return o;
};

async function hasPending(table: string, id: string) {
  return (await db.outbox.where('record_id').equals(id).filter((o) => o.table === table).count()) > 0;
}

/** يكتب صفاً من الخادم محلياً، ما لم يكن للمستخدم تعديل معلّق عليه */
async function applyServerRow(table: string, row: Row) {
  const key = pkOf(table, row);
  if (typeof key === 'string' && (await hasPending(table, key))) return;
  await db.t(table).put(row);
}

// ---------------------------------------------------------------------
// الدفع
// ---------------------------------------------------------------------
const pkCol = (table: string) => (table === 'app_settings' ? 'key' : 'id');

async function pushOne(op: OutboxOp): Promise<void> {
  const sb = supabase();
  const pk = pkCol(op.table);
  if (op.op === 'insert') {
    const { data, error } = await sb.from(op.table).insert(strip(op.payload)).select().single();
    if (error?.code === '23505') {
      // أُدرج سابقاً وانقطع الاتصال قبل الرد: نأخذ نسخة الخادم
      const { data: existing, error: e2 } = await sb.from(op.table).select().eq(pk, op.record_id).maybeSingle();
      if (e2) throw e2;
      if (existing) return finish(op, existing);
    }
    if (error) throw error;
    return finish(op, data);
  }
  if (op.op === 'update') {
    const { data, error } = await sb.from(op.table).update({ ...strip(op.payload), version: op.base_version })
      .eq(pk, op.record_id).select().maybeSingle();
    if (error?.code === 'P0409') return conflict(op);
    if (error) throw error;
    if (!data) throw Object.assign(new Error('لا تملك صلاحية تعديل هذا السجل أو أنه حُذف'), { code: '42501' });
    return finish(op, data);
  }
  if (op.op === 'delete') {
    const { data, error } = await sb.from(op.table).delete().eq(pk, op.record_id).select(pk);
    if (error) throw error;
    if (!data?.length) {
      // RLS منعت الحذف (مهندس) أو السجل محذوف أصلاً: نعيد نسخة الخادم إن وُجدت
      const { data: back } = await sb.from(op.table).select().eq(pk, op.record_id).maybeSingle();
      await db.outbox.delete(op.seq!);
      if (back) { await db.t(op.table).put(back); throw Object.assign(new Error('لا تملك صلاحية الحذف'), { code: '42501', restored: true }); }
      return;
    }
    await db.outbox.delete(op.seq!);
    return;
  }
  if (op.op === 'upload') {
    const b = await db.blobs.get(op.record_id);
    if (!b) { await db.outbox.delete(op.seq!); return; }
    const { error } = await sb.storage.from(op.table).upload(op.payload.path, b.blob, { upsert: true, contentType: op.payload.content_type });
    if (error && !/exists/i.test(error.message)) throw error;
    await db.transaction('rw', db.blobs, db.outbox, async () => {
      await db.blobs.update(op.record_id, { uploaded: 1 });
      await db.outbox.delete(op.seq!);
    });
    return;
  }
  if (op.op === 'rpc') {
    const { error } = await sb.rpc(op.table, op.payload);
    if (error) throw error;
    await db.outbox.delete(op.seq!);
  }
}

async function finish(op: OutboxOp, server: Row) {
  await db.transaction('rw', [db.t(op.table), db.outbox], async () => {
    await db.outbox.delete(op.seq!);
    // عمليات لاحقة لنفس السجل بُنيت على تعديلنا: نرفع إصدارها الأساسي
    const later = await db.outbox.where('record_id').equals(op.record_id).filter((o) => o.table === op.table && o.op === 'update').toArray();
    for (const l of later) await db.outbox.update(l.seq!, { base_version: server.version });
    if (!later.length) await db.t(op.table).put(server);
  });
}

async function conflict(op: OutboxOp) {
  const { data: server } = await supabase().from(op.table).select().eq(pkCol(op.table), op.record_id).maybeSingle();
  await db.transaction('rw', db.outbox, db.conflicts, async () => {
    await db.outbox.update(op.seq!, { status: 'conflict', error: 'عُدّل السجل من جهاز آخر' });
    if (server) await db.conflicts.put({ id: `${op.table}:${op.record_id}`, table: op.table, record_id: op.record_id, seq: op.seq!, local: op.payload, server, created_at: nowISO() });
  });
}

async function push(): Promise<void> {
  const ops = await db.outbox.where('status').equals('pending').sortBy('seq');
  for (const op of ops) {
    inflight.add(op.seq!);
    try {
      await pushOne(op);
    } catch (e: any) {
      if (isNetworkError(e)) throw new NetworkError('لا يوجد اتصال');
      if (!e?.restored) await db.outbox.update(op.seq!, { status: 'failed', error: errorMessage(e), attempts: op.attempts + 1 });
      setState({ error: errorMessage(e) });
    } finally {
      inflight.delete(op.seq!);
    }
  }
}

// ---------------------------------------------------------------------
// السحب
// ---------------------------------------------------------------------
async function meta<T>(key: string, fallback: T): Promise<T> { return ((await db.meta.get(key))?.value as T) ?? fallback; }
async function setMeta(key: string, value: any) { await db.meta.put({ key, value }); }

async function pullTable(table: string, filter?: { column: string; value: string }) {
  const sb = supabase();
  const cursorKey = `pull:${table}`;
  const since: string | null = filter ? null : await meta<string | null>(cursorKey, null);
  const from = since ? new Date(new Date(since).getTime() - OVERLAP_MS).toISOString() : null;
  let maxSeen = since;
  const page = 1000;
  for (let offset = 0; ; offset += page) {
    let q = sb.from(table).select('*');
    if (filter) q = q.eq(filter.column, filter.value);
    if (from) q = q.gt('updated_at', from);
    const { data, error } = await q.order('updated_at').order(table === 'app_settings' ? 'key' : 'id').range(offset, offset + page - 1);
    if (error) throw error;
    for (const r of data ?? []) {
      await applyServerRow(table, r as Row);
      if (!maxSeen || r.updated_at > maxSeen) maxSeen = r.updated_at;
    }
    if (!data || data.length < page) break;
  }
  if (!filter && maxSeen) await setMeta(cursorKey, maxSeen);
}

async function pullFull(table: string) {
  const { data, error } = await supabase().from(table).select('*');
  if (error) throw error;
  await db.transaction('rw', db.t(table), async () => {
    await db.t(table).clear();
    await db.t(table).bulkPut((data ?? []) as Row[]);
  });
}

async function pullNotifications(userId: string) {
  const { data, error } = await supabase().from('notifications').select('*').eq('user_id', userId)
    .order('created_at', { ascending: false }).limit(300);
  if (error) throw error;
  await db.transaction('rw', db.t('notifications'), async () => {
    await db.t('notifications').clear();
    await db.t('notifications').bulkPut((data ?? []) as Row[]);
  });
}

async function pullResponses() {
  const since = await meta<string | null>('pull:external_responses', null);
  let q = supabase().from('external_responses').select('*').order('created_at');
  if (since) q = q.gt('created_at', since);
  const { data, error } = await q.limit(1000);
  if (error) throw error;
  for (const r of data ?? []) await db.t('external_responses').put(r as Row);
  if (data?.length) await setMeta('pull:external_responses', data[data.length - 1].created_at);
}

async function pullTombstones() {
  const last = await meta<number>('pull:tombstones', 0);
  const { data, error } = await supabase().from('sync_tombstones').select('*').gt('id', last).order('id').limit(2000);
  if (error) throw error;
  for (const t of data ?? []) {
    if ((DATA_TABLES as readonly string[]).includes(t.table_name) && !(await hasPending(t.table_name, t.record_id))) {
      await db.t(t.table_name).delete(t.record_id);
    }
  }
  if (data?.length) await setMeta('pull:tombstones', data[data.length - 1].id);
}

/** يحذف محلياً بيانات المشاريع التي فقد المستخدم صلاحيتها، ويملأ الجديدة كاملة */
async function reconcileAccess() {
  const { data, error } = await supabase().from('projects').select('id');
  if (error) throw error;
  const allowed = new Set((data ?? []).map((p) => p.id as string));
  const knownList = await meta<string[] | null>('projects:known', null);
  const known = new Set(knownList ?? allowed); // أول مزامنة: السحب الكامل حدث للتو
  // سحب كامل لمشروع أصبح متاحاً (سجلاته القديمة أقدم من مؤشر السحب)
  const fresh = [...allowed].filter((id) => !known.has(id));
  await Promise.all(fresh.flatMap((id) => PROJECT_TABLES.filter((t) => t !== 'external_responses').map((t) => pullTable(t, { column: 'project_id', value: id }))));
  for (const p of await db.t('projects').toArray()) if (!allowed.has(p.id) && !p._pending) await db.t('projects').delete(p.id);
  for (const t of PROJECT_TABLES) {
    const stale = await db.t(t).filter((r) => !allowed.has(r.project_id) && !r._pending).primaryKeys();
    if (stale.length) await db.t(t).bulkDelete(stale);
  }
  await setMeta('projects:known', [...allowed]);
}

async function pull(userId: string) {
  // الجداول مستقلة: تُسحب بالتوازي
  await Promise.all([...INCREMENTAL.map((t) => pullTable(t)), ...FULL_TABLES.map((t) => pullFull(t)), pullResponses()]);
  await pullTombstones();
  await reconcileAccess();
  await pullNotifications(userId);
}

// ---------------------------------------------------------------------
// التشغيل
// ---------------------------------------------------------------------
let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let userId: string | null = null;

export async function refreshCounts() {
  const [pending, failed, conflicts] = await Promise.all([
    db.outbox.where('status').equals('pending').count(),
    db.outbox.where('status').equals('failed').count(),
    db.conflicts.count(),
  ]);
  setState({ pending, failed, conflicts });
}

export function syncNow(): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => {
    do {
      again = false;
      if (!userId) break;
      setState({ syncing: true });
      try {
        await push();
        await pull(userId);
        setState({ lastSync: nowISO(), error: null, online: true });
      } catch (e: any) {
        if (e instanceof NetworkError || isNetworkError(e)) setState({ online: false });
        else setState({ error: errorMessage(e) });
      } finally {
        await refreshCounts();
        setState({ syncing: false });
      }
    } while (again);
  })().finally(() => { running = null; });
  return running;
}

/** يطلب مزامنة قريبة (تُجمع الكتابات المتتالية في دفعة واحدة) */
export function requestSync(delay = 400) {
  refreshCounts();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; syncNow(); }, delay);
}

let channel: RealtimeChannel | null = null;
let interval: ReturnType<typeof setInterval> | null = null;

/** يبدأ المزامنة لمستخدم مسجّل: فوراً، وعند عودة الاتصال، وكل 30 ثانية، ومع كل بث لحظي */
export function startSync(uid: string) {
  if (userId === uid) return;
  stopSync();
  userId = uid;
  const onOnline = () => { setState({ online: true }); syncNow(); };
  const onOffline = () => setState({ online: false });
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') requestSync(0); });
  interval = setInterval(() => { if (navigator.onLine) syncNow(); }, 30_000);

  const sb = supabase();
  channel = sb.channel('sawaed-db');
  for (const t of [...INCREMENTAL, 'notifications', 'sync_tombstones', 'external_responses']) {
    channel.on('postgres_changes' as any, { event: '*', schema: 'public', table: t }, async (p: any) => {
      if (t === 'sync_tombstones') { await pullTombstones(); return; }
      if (p.eventType === 'DELETE') { if (p.old?.id) await db.t(t).delete(pkOf(t, p.old)); return; }
      if (t === 'notifications' && p.new?.user_id !== userId) return;
      await applyServerRow(t, p.new as Row);
      // تغيّر في التكليفات قد يغيّر الصلاحيات: نعيد المطابقة
      if (t === 'assignments' || t === 'projects') requestSync(200);
    });
  }
  channel.subscribe();
  syncNow();
}

export function stopSync() {
  userId = null;
  if (interval) clearInterval(interval);
  interval = null;
  if (channel) supabase().removeChannel(channel);
  channel = null;
}

// ---------------------------------------------------------------------
// معالجة التعارض وإعادة المحاولة
// ---------------------------------------------------------------------
export async function resolveConflict(id: string, choice: 'mine' | 'theirs') {
  const c = await db.conflicts.get(id);
  if (!c) return;
  await db.transaction('rw', [db.conflicts, db.outbox, db.t(c.table)], async () => {
    if (choice === 'mine') {
      await db.outbox.update(c.seq, { status: 'pending', base_version: c.server.version, error: undefined });
      await db.t(c.table).put({ ...c.server, ...c.local, _pending: 1 });
    } else {
      await db.outbox.delete(c.seq);
      await db.t(c.table).put(c.server);
    }
    await db.conflicts.delete(id);
  });
  requestSync(0);
}

export async function retryFailed(seq: number) { await db.outbox.update(seq, { status: 'pending', error: undefined }); requestSync(0); }
export async function discardFailed(seq: number) {
  const op = await db.outbox.get(seq);
  await db.outbox.delete(seq);
  if (op && (op.op === 'insert' || op.op === 'update')) {
    // نستعيد نسخة الخادم (أو نحذف السجل الذي لم يصل)
    const { data } = await supabase().from(op.table).select().eq(pkCol(op.table), op.record_id).maybeSingle();
    if (data) await db.t(op.table).put(data); else await db.t(op.table).delete(op.record_id);
  }
  requestSync(0);
}

/** يمسح كل البيانات المحلية (عند تسجيل الخروج) */
export async function wipeLocal() {
  stopSync();
  await Promise.all(db.tables.map((t) => t.clear()));
}

/** للاختبارات والأدوات: مزامنة واحدة لمستخدم محدد دون مستمعي المتصفح */
export async function syncOnce(uid: string) { userId = uid; await syncNow(); }
