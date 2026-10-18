'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db, newId, nowISO, type Row } from '@/lib/db';
import { riskLevel } from '@/lib/domain';
import { coerce, defaultsFor, ENTITIES, PROJECT_MASTER_FIELDS, validate, type FieldDef } from '@/lib/forms';
import { useStages } from '@/lib/hooks';
import type { PreparedPhoto } from '@/lib/image';
import { ACTION_STATUS, RISK_LEVEL, suggestedCodes } from '@/lib/labels';
import { createRecord, deleteRecord, queueUpload, updateRecord } from '@/lib/mutations';
import { useSession } from '@/lib/session';
import { PhotoPicker, SavedPhotos, savePhotos } from './photos';
import { SignaturePad } from './signature';
import { Badge, Btn, cx, DualDate } from './ui';

interface Props { table: string; projectId?: string | null; id?: string | null; onDone: (id: string | null) => void }

export function EntityForm({ table, projectId, id, onDone }: Props) {
  const def = ENTITIES[table];
  const s = useSession();
  const stages = useStages();
  const existing = useLiveQuery(() => (id ? db.t(table).get(id) : undefined), [table, id]);
  const project = useLiveQuery(() => (projectId ? db.t('projects').get(projectId) : undefined), [projectId]);
  const refs = useLiveQuery(() => db.t('code_references').filter((r) => r.is_active !== false).sortBy('sort_order'), []) ?? [];
  const [values, setValues] = useState<Record<string, any> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [signature, setSignature] = useState<Blob | null>(null);
  const [actions, setActions] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const photoCount = useLiveQuery(() => (id && def.photos ? db.t('photos').where('[entity_type+entity_id]').equals([def.photos.entity_type, id]).count() : 0), [id]) ?? 0;
  const savedActions = useLiveQuery(() => (id && table === 'meetings' ? db.t('meeting_actions').where('meeting_id').equals(id).toArray() : []), [id, table]) ?? [];

  // القيم الأولية: من السجل المحفوظ أو الافتراضية
  useEffect(() => {
    if (values) return;
    if (id && !existing) return;
    const base: Record<string, any> = existing ? { ...existing } : { ...defaultsFor(def), ...(table === 'weekly_updates' && project ? { stage_id: project.current_stage_id, status: project.status } : {}) };
    if (table === 'meetings') base.attendees_text = (existing?.attendees ?? []).map((a: any) => a.name).join('\n');
    setValues(base);
  }, [existing, id, project, values, def, table]);
  useEffect(() => { if (table === 'meetings' && id) setActions(savedActions.map((a) => ({ ...a }))); }, [savedActions.length, id, table]); // eslint-disable-line

  const pid = (projectId ?? existing?.project_id) as string | undefined;
  const canDelete = table === 'projects' ? s.isGlobal : pid ? s.canDelete(pid) : false;
  const stageForRefs = stages.find((x) => x.id === (values?.stage_id ?? project?.current_stage_id));
  const suggestions = useMemo(() => suggestedCodes(stageForRefs?.name), [stageForRefs?.name]);

  if (!def) return <p>نوع غير معروف</p>;
  if (!values) return null;
  const set = (k: string, v: any) => setValues((o) => ({ ...o!, [k]: v }));

  async function save() {
    const errs = validate(def, values!);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true); setSaveError(null);
    try {
      const data = coerce(def, values!);
      let rid = id ?? null;
      if (table === 'projects' && id && !s.isGlobal) for (const k of PROJECT_MASTER_FIELDS) delete data[k];
      if (id) {
        const changed = Object.fromEntries(Object.entries(data).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(existing?.[k] ?? null)));
        if (Object.keys(changed).length) await updateRecord(table, id, changed);
      } else {
        rid = await createRecord(table, { ...data, ...(table !== 'projects' && table !== 'engineers' ? { project_id: pid } : {}) });
      }
      if (def.photos && photos.length && pid) await savePhotos(pid, def.photos.entity_type, rid!, photos);
      if (def.signature && signature && pid) {
        const sid = newId();
        const path = `${pid}/inspection/${rid}-${sid}.png`;
        await queueUpload('signatures', path, signature, sid);
        await updateRecord(table, rid!, { signature_path: path, signed_by: s.userId, signed_at: nowISO() });
      }
      if (table === 'meetings') await saveActions(rid!, pid!);
      onDone(rid);
    } catch (e: any) {
      setSaveError(e?.message ?? 'تعذّر الحفظ');
    } finally { setSaving(false); }
  }

  async function saveActions(meetingId: string, projectId: string) {
    for (const a of actions) {
      const clean = { item: a.item, owner: a.owner || null, due_date: a.due_date || null, status: a.status || 'open' };
      if (!a.item?.trim()) continue;
      const prev = savedActions.find((x) => x.id === a.id);
      if (!prev) await createRecord('meeting_actions', { id: a.id, ...clean, meeting_id: meetingId, project_id: projectId });
      else if (JSON.stringify(clean) !== JSON.stringify({ item: prev.item, owner: prev.owner, due_date: prev.due_date, status: prev.status })) await updateRecord('meeting_actions', a.id, clean);
    }
    if (canDelete) for (const prev of savedActions) if (!actions.some((a) => a.id === prev.id)) await deleteRecord('meeting_actions', prev.id);
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {def.fields.map((f) => (
          <FieldInput key={f.name} f={f} value={values[f.name]} error={errors[f.name]} onChange={(v) => set(f.name, v)}
            stages={stages} refs={refs} suggestions={suggestions}
            disabled={table === 'projects' && !!id && !s.isGlobal && PROJECT_MASTER_FIELDS.includes(f.name)}
            isGlobal={s.isGlobal} />
        ))}
      </div>

      {table === 'risks' && (
        <div className="flex items-center gap-2 text-sm">الدرجة:
          <span className="num font-semibold">{(Number(values.probability) || 0) * (Number(values.impact) || 0)}</span>
          <Badge code={riskLevel(Number(values.probability) || 0, Number(values.impact) || 0)}>{RISK_LEVEL[riskLevel(Number(values.probability) || 0, Number(values.impact) || 0)]}</Badge>
        </div>
      )}

      {table === 'meetings' && <ActionsEditor actions={actions} setActions={setActions} canDelete={canDelete || !id} />}

      {def.photos && pid && (
        <fieldset className="space-y-2 rounded-lg border border-line bg-card p-3">
          <legend className="px-1 text-sm font-semibold">الصور</legend>
          {id && <SavedPhotos entityType={def.photos.entity_type} entityId={id} canDelete={canDelete} />}
          <PhotoPicker value={photos} onChange={setPhotos} existing={photoCount} phases={def.photos.phases} />
        </fieldset>
      )}

      {def.signature && pid && (
        <fieldset className="space-y-2 rounded-lg border border-line bg-card p-3">
          <legend className="px-1 text-sm font-semibold">توقيع المهندس</legend>
          {existing?.signature_path && !signature
            ? <p className="text-sm text-green">✔ موقّع <DualDate d={existing.signed_at?.slice(0, 10)} compact /></p>
            : <SignaturePad onChange={setSignature} />}
        </fieldset>
      )}

      {saveError && <p role="alert" className="text-sm text-red">{saveError}</p>}
      <div className="flex flex-wrap gap-2">
        <Btn type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ'}</Btn>
        <Btn type="button" variant="ghost" onClick={() => onDone(null)}>إلغاء</Btn>
        {id && canDelete && (
          <Btn type="button" variant="danger" className="mr-auto" onClick={async () => {
            if (!confirm(`حذف ${def.title}؟ لا يمكن التراجع.`)) return;
            await deleteRecord(table, id); onDone(null);
          }}>حذف</Btn>
        )}
      </div>
      <p className="text-xs text-ink-soft">يُحفظ على الجهاز فوراً ويُرسل للخادم عند توفر الاتصال.</p>
    </form>
  );
}

function FieldInput({ f, value, error, onChange, stages, refs, suggestions, disabled, isGlobal }: {
  f: FieldDef; value: any; error?: string; onChange: (v: any) => void; stages: Row[]; refs: Row[]; suggestions: string[]; disabled?: boolean; isGlobal: boolean;
}) {
  const id = `f-${f.name}`;
  const v = value ?? '';
  let input: React.ReactNode;
  switch (f.type) {
    case 'textarea':
      input = <textarea id={id} className="field min-h-24" value={v} onChange={(e) => onChange(e.target.value)} disabled={disabled} />; break;
    case 'select':
      input = (
        <select id={id} className="field" value={v} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          <option value="">—</option>
          {Object.entries(f.options!).filter(([k]) => isGlobal || !f.globalOnly?.includes(k) || k === v).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      ); break;
    case 'stage':
      input = (
        <select id={id} className="field" value={v} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          <option value="">—</option>
          {stages.map((st) => <option key={st.id} value={st.id}>{st.sort_order}. {st.name}</option>)}
        </select>
      ); break;
    case 'score':
      input = (
        <div className="flex gap-1" role="radiogroup" aria-labelledby={`${id}-l`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={Number(v) === n} onClick={() => onChange(n)}
              className={cx('num h-10 flex-1 rounded-md border text-sm font-semibold', Number(v) === n ? 'border-brand bg-brand text-white' : 'border-line bg-white')}>{n}</button>
          ))}
        </div>
      ); break;
    case 'reference':
      input = (
        <div className="space-y-1.5">
          <input id={id} className="field" list={`${id}-list`} value={v} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="مثل: SBC 304" />
          <datalist id={`${id}-list`}>{refs.map((r) => <option key={r.id} value={r.code}>{r.title}</option>)}</datalist>
          {!!suggestions.length && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-ink-soft">مقترح لهذه المرحلة:</span>
              {suggestions.map((c) => (
                <button key={c} type="button" onClick={() => onChange(v ? (String(v).includes(c) ? v : `${v}، ${c}`) : c)}
                  className="rounded-full border border-brand/40 bg-brand/5 px-2 py-0.5 text-brand-text">{c}</button>
              ))}
            </div>
          )}
        </div>
      ); break;
    default: {
      const type = f.type === 'date' ? 'date' : ['int', 'number', 'percent', 'money'].includes(f.type) ? 'number' : 'text';
      input = (
        <input id={id} className={cx('field', type !== 'text' && 'num text-right')} type={type} value={v} disabled={disabled}
          inputMode={f.type === 'int' ? 'numeric' : ['percent', 'money', 'number'].includes(f.type) ? 'decimal' : undefined}
          step={f.type === 'money' ? '0.01' : f.type === 'int' ? '1' : 'any'} min={type === 'number' ? 0 : undefined} max={f.type === 'percent' ? 100 : undefined}
          onChange={(e) => onChange(e.target.value)} />
      );
    }
  }
  return (
    <div className={cx('min-w-0', f.half ? 'col-span-2 sm:col-span-1' : 'col-span-2')}>
      <label id={`${id}-l`} htmlFor={id} className="mb-1 block text-sm font-medium">
        {f.label}{f.required && <span className="text-brand"> *</span>}
      </label>
      {input}
      {f.type === 'date' && v && <div className="mt-0.5 text-[11px] text-ink-soft"><DualDate d={v} /></div>}
      {f.hint && !error && <div className="mt-0.5 text-[11px] text-ink-soft">{f.hint}</div>}
      {error && <div className="mt-0.5 text-xs text-red">{error}</div>}
    </div>
  );
}

function ActionsEditor({ actions, setActions, canDelete }: { actions: Row[]; setActions: (a: Row[]) => void; canDelete: boolean }) {
  const upd = (i: number, k: string, v: any) => setActions(actions.map((a, j) => (j === i ? { ...a, [k]: v } : a)));
  return (
    <fieldset className="space-y-2 rounded-lg border border-line bg-card p-3">
      <legend className="px-1 text-sm font-semibold">بنود المتابعة</legend>
      {actions.map((a, i) => (
        <div key={a.id} className="grid grid-cols-2 gap-2 border-b border-line pb-2 last:border-0 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
          <input className="field col-span-2 sm:col-span-1" placeholder="البند" value={a.item ?? ''} onChange={(e) => upd(i, 'item', e.target.value)} />
          <input className="field" placeholder="المسؤول" value={a.owner ?? ''} onChange={(e) => upd(i, 'owner', e.target.value)} />
          <input className="field num" type="date" aria-label="الموعد" value={a.due_date ?? ''} onChange={(e) => upd(i, 'due_date', e.target.value)} />
          <select className="field" aria-label="الحالة" value={a.status ?? 'open'} onChange={(e) => upd(i, 'status', e.target.value)}>
            {Object.entries(ACTION_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {canDelete && <button type="button" className="text-sm text-red" onClick={() => setActions(actions.filter((_, j) => j !== i))}>حذف</button>}
        </div>
      ))}
      <Btn type="button" size="sm" variant="ghost" onClick={() => setActions([...actions, { id: newId(), item: '', status: 'open' }])}>+ بند متابعة</Btn>
    </fieldset>
  );
}
