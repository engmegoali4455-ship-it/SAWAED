'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import Link from 'next/link';
import { useState } from 'react';
import { FollowUpList } from '@/components/follow-ups';
import { AppShell } from '@/components/shell';
import { Btn, Card, Empty, PageTitle, Spinner, Tabs, cx } from '@/components/ui';
import { followUps } from '@/lib/analytics';
import { db } from '@/lib/db';
import { useAllData } from '@/lib/hooks';
import { updateRecord } from '@/lib/mutations';
import { enablePush } from '@/lib/push';
import { useSession } from '@/lib/session';

export default function AlertsPage() {
  return <AppShell><Inner /></AppShell>;
}

const KIND_HREF = (n: any) => {
  if (n.entity_type === 'violation') return `/entry/?t=violations&p=${n.project_id}&id=${n.entity_id}`;
  if (n.entity_type === 'weekly_report') return `/report/?id=${n.entity_id}`;
  if (n.project_id) return `/project/?id=${n.project_id}`;
  return null;
};

function Inner() {
  const s = useSession();
  const d = useAllData();
  const [tab, setTab] = useState('now');
  const [msg, setMsg] = useState<string | null>(null);
  const notes = useLiveQuery(() => db.t('notifications').orderBy('created_at').reverse().toArray(), []) ?? [];
  if (!d) return <Spinner />;
  const scope = s.isGlobal ? d.projects : d.projects.filter((p: any) => s.activeAssignments.some((a) => a.project_id === p.id));
  const f = followUps({ ...d, projects: scope }, undefined, { staffing: s.isGlobal });
  const unread = notes.filter((n) => !n.read_at);
  const markRead = async (n: any) => { if (!n.read_at) await updateRecord('notifications', n.id, { read_at: new Date().toISOString() }); };

  return (
    <>
      <PageTitle title="التنبيهات" actions={<Btn size="sm" variant="ghost" onClick={() => enablePush().then(setMsg, (e) => setMsg(e.message))}>🔔 تفعيل الإشعارات على هذا الجهاز</Btn>} />
      {msg && <p className="mb-3 text-sm text-ink-soft">{msg}</p>}
      <Tabs tabs={[{ key: 'now', label: 'يحتاج متابعة الآن', count: f.length }, { key: 'inbox', label: 'الإشعارات', count: unread.length }]} active={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'now' && <Card><FollowUpList items={f} /></Card>}
        {tab === 'inbox' && (!notes.length ? <Empty title="لا توجد إشعارات" /> : (
          <Card action={unread.length > 0 && <button className="text-xs underline" onClick={() => unread.forEach(markRead)}>تعليم الكل كمقروء</button>} title={`${unread.length} غير مقروء`}>
            <ul className="divide-y divide-line">
              {notes.map((n) => {
                const href = KIND_HREF(n);
                const body = (
                  <div className={cx('py-2.5', !n.read_at && 'font-semibold')}>
                    <div className="flex items-center gap-2 text-sm">{!n.read_at && <span className="h-2 w-2 rounded-full bg-brand" />}{n.title}</div>
                    {n.body && <div className="text-xs font-normal text-ink-soft">{n.body}</div>}
                    {n.kind === 'daily_digest' && Array.isArray(n.payload) && (
                      <ul className="mt-1 list-disc pr-5 text-xs font-normal text-ink-soft">{n.payload.slice(0, 12).map((x: any, i: number) => <li key={i}>{d.projects.find((p: any) => p.id === x.project_id)?.name}: {x.text}</li>)}</ul>
                    )}
                    <div className="num mt-0.5 text-[11px] font-normal text-ink-soft">{new Date(n.created_at).toLocaleString('ar-SA-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                  </div>
                );
                return <li key={n.id} onClick={() => markRead(n)}>{href ? <Link href={href}>{body}</Link> : body}</li>;
              })}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
