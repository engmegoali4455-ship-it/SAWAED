'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { EntityForm } from '@/components/entity-form';
import { AppShell } from '@/components/shell';
import { Btn, Empty, PageTitle, Spinner } from '@/components/ui';
import { db } from '@/lib/db';
import { ENTITIES } from '@/lib/forms';
import { useSession } from '@/lib/session';
import { openPdf } from '@/lib/pdf';

export default function EntryPage() {
  return <AppShell><Suspense fallback={<Spinner />}><Inner /></Suspense></AppShell>;
}

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const s = useSession();
  const t = sp.get('t') ?? '';
  const pid = sp.get('p');
  const id = sp.get('id');
  const def = ENTITIES[t];
  const project = useLiveQuery(() => (pid ? db.t('projects').get(pid) : undefined), [pid]);
  if (!def) return <Empty title="نوع غير معروف" />;
  const allowed = t === 'projects' || t === 'engineers' ? s.isGlobal || (t === 'projects' && !!id && s.canManageProject(id)) : !!pid && s.canWrite(pid);
  if (!allowed) return <Empty title="للاطلاع فقط" hint="لا تملك صلاحية الإضافة أو التعديل في هذا المشروع." />;
  const back = () => (pid ? router.push(`/project/?id=${pid}&tab=${t}`) : router.back());
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title={`${id ? 'تعديل' : 'إضافة'} ${def.title}`} sub={project?.name}
        actions={t === 'meetings' && id ? <Btn size="sm" variant="dark" onClick={() => openPdf('meeting', id).then((u) => window.open(u, '_blank', 'noopener'), (e) => alert(e.message))}>تصدير المحضر PDF</Btn> : undefined} />
      <EntityForm table={t} projectId={pid} id={id} onDone={back} />
    </div>
  );
}
