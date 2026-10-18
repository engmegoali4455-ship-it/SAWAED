'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { db, newId, type Row } from '@/lib/db';
import { MAX_PHOTOS, photoUrl, preparePhotos, type PreparedPhoto } from '@/lib/image';
import { createRecord, deleteRecord, queueUpload, updateRecord } from '@/lib/mutations';
import { Btn, cx } from './ui';

export function PhotoThumb({ photo, onClick }: { photo: Row; onClick?: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let alive = true; photoUrl(photo.id, photo.storage_path).then((u) => alive && setSrc(u)); return () => { alive = false; }; }, [photo.id, photo.storage_path]);
  return (
    <button type="button" onClick={onClick} className="relative aspect-square w-full overflow-hidden rounded-md border border-line bg-line/40">
      {src ? <img src={src} alt={photo.caption ?? ''} className="h-full w-full object-cover" loading="lazy" /> : <span className="text-[11px] text-ink-soft">دون اتصال</span>}
      {photo.phase !== 'general' && <span className="absolute right-1 top-1 rounded bg-head/80 px-1 text-[10px] text-paper">{photo.phase === 'before' ? 'قبل' : 'بعد'}</span>}
      {photo.selected_for_report && <span className="absolute bottom-1 left-1 rounded bg-brand px-1 text-[10px] text-white">للتقرير</span>}
    </button>
  );
}

/** صور سجل محفوظ: عرض، وتحديد للتقرير، وحذف (لمدير المشروع) */
export function SavedPhotos({ entityType, entityId, canDelete }: { entityType: string; entityId: string; canDelete: boolean }) {
  const photos = useLiveQuery(() => db.t('photos').where('[entity_type+entity_id]').equals([entityType, entityId]).toArray(), [entityType, entityId]) ?? [];
  const [open, setOpen] = useState<Row | null>(null);
  if (!photos.length) return null;
  return (
    <div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {photos.map((p) => <PhotoThumb key={p.id} photo={p} onClick={() => setOpen(p)} />)}
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4" onClick={() => setOpen(null)}>
          <div className="flex-1 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <BigPhoto photo={open} />
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-3 text-xs text-white/80" onClick={(e) => e.stopPropagation()}>
            <span className="num">{open.taken_at ? new Date(open.taken_at).toLocaleString('ar-SA-u-nu-latn') : ''}</span>
            {open.lat != null && <a className="underline" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${open.lat},${open.lng}`}>الموقع على الخريطة</a>}
            <Btn size="sm" variant="ghost" onClick={async () => { await updateRecord('photos', open.id, { selected_for_report: !open.selected_for_report }); setOpen(null); }}>
              {open.selected_for_report ? 'إزالة من التقرير' : 'اختيار للتقرير'}
            </Btn>
            {canDelete && <Btn size="sm" variant="danger" onClick={async () => { await deleteRecord('photos', open.id); setOpen(null); }}>حذف</Btn>}
            <Btn size="sm" variant="dark" onClick={() => setOpen(null)}>إغلاق</Btn>
          </div>
        </div>
      )}
    </div>
  );
}
function BigPhoto({ photo }: { photo: Row }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { photoUrl(photo.id, photo.storage_path).then(setSrc); }, [photo]);
  return src ? <img src={src} alt="" className="mx-auto h-full max-h-full object-contain" /> : null;
}

/** اختيار صور جديدة قبل الحفظ (الكاميرا أو المعرض) */
export function PhotoPicker({ value, onChange, existing = 0, phases }: { value: PreparedPhoto[]; onChange: (p: PreparedPhoto[]) => void; existing?: number; phases?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<'general' | 'before' | 'after'>(phases ? 'before' : 'general');
  const [busy, setBusy] = useState(false);
  const room = MAX_PHOTOS - existing - value.length;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {phases && (['before', 'after'] as const).map((p) => (
          <button key={p} type="button" onClick={() => setPhase(p)}
            className={cx('rounded-full border px-3 py-1 text-xs', phase === p ? 'border-brand bg-brand/10 text-brand-text' : 'border-line')}>
            {p === 'before' ? 'صور قبل' : 'صور بعد'}
          </button>
        ))}
        <Btn type="button" size="sm" variant="ghost" disabled={room <= 0 || busy} onClick={() => input.current?.click()}>
          {busy ? 'جارٍ التجهيز…' : '📷 إضافة صور'}
        </Btn>
        <span className="text-xs text-ink-soft">متبقٍ {Math.max(0, room)} من {MAX_PHOTOS} · تُضغط وتُحفظ بالموقع والوقت</span>
      </div>
      <input ref={input} type="file" accept="image/*" capture="environment" multiple hidden
        onChange={async (e) => {
          if (!e.target.files?.length) return;
          setBusy(true);
          try {
            const add = await preparePhotos(Array.from(e.target.files).slice(0, room), phase);
            onChange([...value, ...add]);
          } finally { setBusy(false); e.target.value = ''; }
        }} />
      {!!value.length && (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {value.map((p) => (
            <div key={p.key} className="relative">
              <img src={p.preview} alt="" className="aspect-square w-full rounded-md object-cover" />
              {p.phase !== 'general' && <span className="absolute right-1 top-1 rounded bg-head/80 px-1 text-[10px] text-paper">{p.phase === 'before' ? 'قبل' : 'بعد'}</span>}
              <button type="button" aria-label="إزالة" onClick={() => onChange(value.filter((x) => x.key !== p.key))}
                className="absolute left-1 top-1 h-6 w-6 rounded-full bg-head/80 text-sm text-paper">×</button>
              {p.lat == null && <span className="absolute bottom-1 right-1 rounded bg-amber-bg px-1 text-[9px] text-amber">بلا موقع</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** يحفظ الصور الجديدة: رفع في الخلفية + سجل في جدول الصور */
export async function savePhotos(projectId: string, entityType: string, entityId: string, photos: PreparedPhoto[]) {
  for (const p of photos) {
    const id = newId();
    const path = `${projectId}/${entityType}/${entityId}/${id}.jpg`;
    await queueUpload('photos', path, p.blob, id);
    await createRecord('photos', { id, project_id: projectId, entity_type: entityType, entity_id: entityId, storage_path: path,
      taken_at: p.taken_at, lat: p.lat, lng: p.lng, phase: p.phase ?? 'general', selected_for_report: true });
  }
}
