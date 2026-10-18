'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db, type Row as DbRow } from '@/lib/db';
import { formatSAR, isWorkLate, permitAlert, riskLevel } from '@/lib/domain';
import { ENTITIES } from '@/lib/forms';
import * as L from '@/lib/labels';
import { createRecord } from '@/lib/mutations';
import { useSession } from '@/lib/session';
import { Badge, Btn, Card, DualDate, Empty, LinkBtn, Progress, Row } from './ui';

export function EntityList({ table, projectId, readOnly }: { table: string; projectId: string; readOnly?: boolean }) {
  const def = ENTITIES[table];
  const s = useSession();
  const [filter, setFilter] = useState('open');
  const rows = useLiveQuery(() => db.t(table).where('project_id').equals(projectId).toArray(), [table, projectId]) ?? [];
  const photoCounts = useLiveQuery(async () => {
    const m: Record<string, number> = {};
    if (!def.photos) return m;
    for (const p of await db.t('photos').where('project_id').equals(projectId).toArray()) if (p.entity_type === def.photos.entity_type) m[p.entity_id] = (m[p.entity_id] ?? 0) + 1;
    return m;
  }, [projectId, table]) ?? {};
  const closedStates = ['closed', 'completed', 'paid', 'rejected', 'corrected', 'done', 'cancelled'];
  const hasFilter = !!def.statusField;
  const shown = rows
    .filter((r) => !hasFilter || filter === 'all' || !closedStates.includes(r[def.statusField!]))
    .sort((a, b) => String(b[def.dateField ?? 'created_at'] ?? b.created_at ?? '').localeCompare(String(a[def.dateField ?? 'created_at'] ?? a.created_at ?? '')));
  const canWrite = !readOnly && s.canWrite(projectId);

  return (
    <Card title={def.plural} action={
      <div className="flex items-center gap-2">
        {hasFilter && (
          <select className="rounded border border-line bg-white px-2 py-1 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="تصفية">
            <option value="open">المفتوحة</option><option value="all">الكل ({rows.length})</option>
          </select>
        )}
        {canWrite && <LinkBtn href={`/entry/?t=${table}&p=${projectId}`} variant="primary">+ إضافة</LinkBtn>}
      </div>
    }>
      {!shown.length ? <Empty title="لا توجد سجلات" hint={rows.length ? 'غيّر التصفية لعرض المغلقة' : undefined} /> : shown.map((r) => (
        <Row key={r.id} href={canWrite ? `/entry/?t=${table}&p=${projectId}&id=${r.id}` : undefined}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="line-clamp-2 text-sm font-semibold">{def.summary(r)}</span>
              {extraBadges(table, r)}
              {r._pending ? <Badge tone="brand">بانتظار المزامنة</Badge> : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
              {meta(table, r)}
              {photoCounts[r.id] ? <span>📷 {photoCounts[r.id]}</span> : null}
            </div>
            {table === 'works' && <div className="mt-1.5 flex items-center gap-2"><Progress value={Number(r.actual_progress)} tone={isWorkLate(r.planned_end, Number(r.actual_progress), r.status) ? 'red' : 'brand'} /><span className="num text-xs">{Number(r.actual_progress)}%</span></div>}
            {readOnly && (table === 'violations' || table === 'inspections') && <Responses entityType={table === 'violations' ? 'violation' : 'inspection'} entityId={r.id} projectId={projectId} canReply={s.isExternal} />}
          </div>
          {def.statusField && <Badge code={r[def.statusField]}>{def.statusLabels?.[r[def.statusField]] ?? r[def.statusField]}</Badge>}
        </Row>
      ))}
    </Card>
  );
}

function extraBadges(table: string, r: DbRow) {
  if (table === 'violations') return <><Badge code={r.severity}>{L.SEVERITY[r.severity]}</Badge><Badge>{L.VIOLATION_CATEGORY[r.category]}</Badge></>;
  if (table === 'inspections') return <Badge tone="brand">{L.INSPECTION_KIND[r.kind]}</Badge>;
  if (table === 'risks') { const l = riskLevel(r.probability, r.impact); return <Badge code={l}>{L.RISK_LEVEL[l]} · {r.probability * r.impact}</Badge>; }
  if (table === 'works' && isWorkLate(r.planned_end, Number(r.actual_progress), r.status)) return <Badge tone="red">متأخر</Badge>;
  if (table === 'permits') { const a = permitAlert(r.expiry_date); return a ? <Badge tone={a === 'd30' ? 'amber' : 'red'}>{a === 'expired' ? 'منتهٍ' : 'يقارب الانتهاء'}</Badge> : null; }
  return null;
}

function meta(table: string, r: DbRow) {
  const parts: React.ReactNode[] = [];
  const d = (label: string, v: string | null | undefined) => v && parts.push(<span key={label} className="inline-flex items-center gap-1">{label} <DualDate d={v} compact /></span>);
  switch (table) {
    case 'weekly_updates': d('', r.update_date); if (r.labor_count != null) parts.push(<span key="l">عمالة {r.labor_count}</span>); if (r.obstacles) parts.push(<span key="o" className="text-red">معوقات</span>); break;
    case 'works': if (r.location) parts.push(<span key="loc">{r.location}</span>); d('النهاية', r.planned_end); if (r.executor) parts.push(<span key="e">{r.executor}</span>); break;
    case 'inspections': if (r.ref_no) parts.push(<span key="n" className="num">#{r.ref_no}</span>); if (r.reference) parts.push(<span key="r">{r.reference}</span>); if (r.addressed_to) parts.push(<span key="a">إلى {r.addressed_to}</span>); d('أُغلق', r.closed_at); if (r.signature_path) parts.push(<span key="s" className="text-green">✔ موقّع</span>); break;
    case 'violations': if (r.violator) parts.push(<span key="v">{r.violator}</span>); d('المهلة', r.deadline); break;
    case 'meetings': d('', r.meeting_date); if (r.location) parts.push(<span key="l">{r.location}</span>); parts.push(<span key="a">{(r.attendees ?? []).length} حضور</span>); break;
    case 'risks': if (r.owner) parts.push(<span key="o">{r.owner}</span>); d('الموعد', r.due_date); break;
    case 'permits': d('الإصدار', r.issue_date); d('الانتهاء', r.expiry_date); break;
    case 'invoices': parts.push(<span key="a" className="num">{formatSAR(r.amount_sar)}</span>); d('التقديم', r.submitted_at); break;
  }
  return parts;
}

function Responses({ entityType, entityId, projectId, canReply }: { entityType: string; entityId: string; projectId: string; canReply: boolean }) {
  const rows = useLiveQuery(() => db.t('external_responses').filter((r) => r.entity_id === entityId).sortBy('created_at'), [entityId]) ?? [];
  const [text, setText] = useState('');
  return (
    <div className="mt-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
      {rows.map((r) => <p key={r.id} className="rounded bg-paper px-2 py-1 text-xs">↩ {r.body}</p>)}
      {canReply && (
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!text.trim()) return; await createRecord('external_responses', { project_id: projectId, entity_type: entityType, entity_id: entityId, body: text.trim() }); setText(''); }}>
          <input className="field py-1.5 text-sm" placeholder="ردّك" value={text} onChange={(e) => setText(e.target.value)} />
          <Btn size="sm" type="submit">إرسال</Btn>
        </form>
      )}
    </div>
  );
}
