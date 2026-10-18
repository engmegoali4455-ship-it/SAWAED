'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppShell } from '@/components/shell';
import { Badge, Btn, Card, Empty, PageTitle } from '@/components/ui';
import { db } from '@/lib/db';
import { ENTITIES } from '@/lib/forms';
import { useSyncState } from '@/lib/hooks';
import { discardFailed, resolveConflict, retryFailed, syncNow } from '@/lib/sync';

export default function SyncPage() {
  return <AppShell><Inner /></AppShell>;
}

const OP = { insert: 'إضافة', update: 'تعديل', delete: 'حذف', upload: 'رفع صورة', rpc: 'إجراء' } as const;
const tableName = (t: string) => ENTITIES[t]?.title ?? ({ photos: 'صورة', meeting_actions: 'بند متابعة', assignments: 'تكليف', notifications: 'إشعار', weekly_reports: 'تقرير', photos_bucket: 'صورة', signatures: 'توقيع', decide_stage_suggestion: 'نقل مرحلة', external_responses: 'رد' } as any)[t] ?? t;

function show(v: any) { if (v == null || v === '') return '—'; if (typeof v === 'object') return JSON.stringify(v); return String(v); }

function Inner() {
  const st = useSyncState();
  const ops = useLiveQuery(() => db.outbox.orderBy('seq').toArray(), []) ?? [];
  const conflicts = useLiveQuery(() => db.conflicts.toArray(), []) ?? [];
  const pending = ops.filter((o) => o.status === 'pending');
  const failed = ops.filter((o) => o.status === 'failed');
  return (
    <>
      <PageTitle title="المزامنة" sub={`${st.online ? 'متصل' : 'دون اتصال'} · آخر مزامنة ${st.lastSync ? new Date(st.lastSync).toLocaleTimeString('ar-SA-u-nu-latn') : '—'}`}
        actions={<Btn size="sm" onClick={() => syncNow()} disabled={st.syncing}>{st.syncing ? 'جارٍ…' : 'مزامنة الآن'}</Btn>} />
      {st.error && <p className="mb-3 text-sm text-red">{st.error}</p>}

      {conflicts.map((c) => {
        const keys = Object.keys(c.local).filter((k) => show(c.local[k]) !== show(c.server[k]));
        return (
          <Card key={c.id} className="mb-4 border-red/40" title={<span className="text-red">تعارض: {tableName(c.table)} عُدّل من جهاز آخر</span>}>
            <p className="mb-2 text-sm text-ink-soft">اختر النسخة التي تُعتمد. لن يُكتب فوق أي تعديل دون قرارك.</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead><tr className="bg-paper text-right"><th className="p-2">الحقل</th><th className="p-2">تعديلك</th><th className="p-2">النسخة في الخادم</th></tr></thead>
                <tbody>{keys.map((k) => {
                  const label = ENTITIES[c.table]?.fields.find((f) => f.name === k)?.label ?? k;
                  return <tr key={k} className="border-b border-line"><td className="p-2 text-ink-soft">{label}</td><td className="p-2 font-semibold text-brand-text">{show(c.local[k])}</td><td className="p-2">{show(c.server[k])}</td></tr>;
                })}</tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn size="sm" onClick={() => resolveConflict(c.id, 'mine')}>اعتماد تعديلي</Btn>
              <Btn size="sm" variant="ghost" onClick={() => resolveConflict(c.id, 'theirs')}>اعتماد نسخة الخادم</Btn>
            </div>
          </Card>
        );
      })}

      {!!failed.length && (
        <Card className="mb-4" title={`عمليات لم تُقبل (${failed.length})`}>
          {failed.map((o) => (
            <div key={o.seq} className="flex flex-wrap items-center gap-2 border-b border-line py-2 last:border-0">
              <span className="flex-1 text-sm">{OP[o.op]} {tableName(o.table)}<span className="block text-xs text-red">{o.error}</span></span>
              <Btn size="sm" variant="ghost" onClick={() => retryFailed(o.seq!)}>إعادة المحاولة</Btn>
              <Btn size="sm" variant="danger" onClick={() => discardFailed(o.seq!)}>تجاهل</Btn>
            </div>
          ))}
        </Card>
      )}

      <Card title={`بانتظار الإرسال (${pending.length})`}>
        {!pending.length ? <Empty title="كل التعديلات وصلت للخادم" /> : pending.map((o) => (
          <div key={o.seq} className="flex items-center gap-2 border-b border-line py-2 text-sm last:border-0">
            <Badge tone="brand">{OP[o.op]}</Badge>{tableName(o.table)}
            <span className="num mr-auto text-xs text-ink-soft">{new Date(o.created_at).toLocaleTimeString('ar-SA-u-nu-latn')}</span>
          </div>
        ))}
      </Card>
      <p className="mt-3 text-xs text-ink-soft">تُرسل التعديلات بالترتيب فور توفر الاتصال، وتُرفع الصور في الخلفية.</p>
    </>
  );
}
