// كل كتابة من الواجهة تمر من هنا: تُطبَّق محلياً فوراً (تظهر في كل الشاشات)،
// وتُضاف لطابور المزامنة بالترتيب. لا تنتظر الشبكة أبداً.
import { db, newId, nowISO, type OutboxOp, type Row } from './db';
import { inflight, requestSync } from './sync';

let currentUserId: string | null = null;
export function setMutationUser(id: string | null) { currentUserId = id; }

async function enqueue(op: Omit<OutboxOp, 'status' | 'attempts' | 'created_at'>) {
  await db.outbox.add({ ...op, status: 'pending', attempts: 0, created_at: nowISO() });
}

/** آخر عملية معلّقة لم تُرسل بعد لنفس السجل */
async function pendingFor(table: string, id: string) {
  const ops = await db.outbox.where('record_id').equals(id).filter((o) => o.table === table && o.status === 'pending' && !inflight.has(o.seq!)).toArray();
  return ops;
}

export async function createRecord<T extends Record<string, any>>(table: string, values: T): Promise<string> {
  const id = (values.id as string) ?? newId();
  const payload = { ...values, id };
  await db.transaction('rw', [db.t(table), db.outbox], async () => {
    await db.t(table).put({ ...payload, version: 1, created_at: nowISO(), updated_at: nowISO(), created_by: currentUserId, _pending: 1 });
    await enqueue({ op: 'insert', table, record_id: id, payload });
  });
  requestSync();
  return id;
}

export async function updateRecord(table: string, id: string, changes: Record<string, any>): Promise<void> {
  await db.transaction('rw', [db.t(table), db.outbox], async () => {
    const row = await db.t(table).get(id);
    if (!row) throw new Error('السجل غير موجود محلياً');
    await db.t(table).put({ ...row, ...changes, updated_at: nowISO(), _pending: 1 });
    const pend = await pendingFor(table, id);
    const ins = pend.find((o) => o.op === 'insert');
    const upd = pend.find((o) => o.op === 'update');
    // ندمج في العملية المعلّقة بدل إضافة عمليات متتالية لنفس السجل
    if (ins) await db.outbox.update(ins.seq!, { payload: { ...ins.payload, ...changes } });
    else if (upd) await db.outbox.update(upd.seq!, { payload: { ...upd.payload, ...changes } });
    else await enqueue({ op: 'update', table, record_id: id, payload: changes, base_version: row.version });
  });
  requestSync();
}

export async function deleteRecord(table: string, id: string): Promise<void> {
  await db.transaction('rw', [db.t(table), db.outbox], async () => {
    const pend = await pendingFor(table, id);
    const ins = pend.find((o) => o.op === 'insert');
    if (ins) {
      // لم يصل الخادم أصلاً: نلغي كل عملياته محلياً
      await db.outbox.bulkDelete(pend.map((o) => o.seq!));
    } else {
      if (pend.length) await db.outbox.bulkDelete(pend.map((o) => o.seq!));
      await enqueue({ op: 'delete', table, record_id: id, payload: {} });
    }
    await db.t(table).delete(id);
  });
  requestSync();
}

export async function queueUpload(bucket: string, path: string, blob: Blob, id: string) {
  await db.transaction('rw', [db.blobs, db.outbox], async () => {
    await db.blobs.put({ id, bucket, path, blob, uploaded: 0 });
    await enqueue({ op: 'upload', table: bucket, record_id: id, payload: { path, content_type: blob.type || 'image/jpeg' } });
  });
  requestSync();
}

export async function queueRpc(fn: string, args: Record<string, any>, localApply?: () => Promise<void>) {
  await db.transaction('rw', db.tables, async () => {
    if (localApply) await localApply();
    await enqueue({ op: 'rpc', table: fn, record_id: String(args.p_id ?? newId()), payload: args });
  });
  requestSync();
}

export async function putLocal(table: string, row: Row) { await db.t(table).put(row); }
