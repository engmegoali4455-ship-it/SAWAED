'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/shell';
import { Badge, Btn, Card, Empty, PageTitle, Row, Spinner, Tabs } from '@/components/ui';
import { db, type Row as DbRow } from '@/lib/db';
import { stageWeightsValid } from '@/lib/domain';
import { useSetting, useStages } from '@/lib/hooks';
import { createRecord, deleteRecord, updateRecord } from '@/lib/mutations';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { syncNow } from '@/lib/sync';

export default function AdminPage() {
  return <AppShell><Inner /></AppShell>;
}

function Inner() {
  const s = useSession();
  const [tab, setTab] = useState('users');
  if (!s.isGlobal) return <Empty title="الإدارة لمدير النظام ومدير القسم" />;
  const tabs = [{ key: 'users', label: 'المستخدمون' }, { key: 'external', label: 'المالك والمقاول' },
    ...(s.isAdmin ? [{ key: 'stages', label: 'المراحل والأوزان' }, { key: 'refs', label: 'المراجع' }, { key: 'branding', label: 'الهوية' }] : [])];
  return (
    <>
      <PageTitle title="الإدارة" />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'users' && <Users />}
        {tab === 'external' && <External />}
        {tab === 'stages' && <Stages />}
        {tab === 'refs' && <Refs />}
        {tab === 'branding' && <Branding />}
      </div>
    </>
  );
}

const rpcError = (e: any) => (e?.code === 'P0002' ? 'لا يوجد حساب بهذا البريد — أرسل دعوة أولاً' : e?.code === '42501' ? 'لا تملك الصلاحية' : e?.message ?? 'تعذّر التنفيذ (تحقق من الاتصال)');

function Users() {
  const s = useSession();
  const profiles = useLiveQuery(() => db.t('profiles').toArray(), []) ?? [];
  const engineers = useLiveQuery(() => db.t('engineers').toArray(), []) ?? [];
  const managers = useLiveQuery(() => db.t('dept_managers').toArray(), []) ?? [];
  const [email, setEmail] = useState('');
  const [target, setTarget] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [newDm, setNewDm] = useState('');

  async function invite() {
    setMsg(null);
    const { error } = await supabase().functions.invoke('invite-user', { body: { email: email.trim() } });
    setMsg(error ? { ok: false, t: 'تعذّر إرسال الدعوة' } : { ok: true, t: `أُرسلت دعوة إلى ${email}` });
    syncNow();
  }
  async function link() {
    setMsg(null);
    if (!email || !target) return setMsg({ ok: false, t: 'اكتب البريد واختر المهندس أو مدير القسم' });
    const [kind, id] = target.split(':');
    const { error } = await supabase().rpc('link_account_by_email', { p_email: email.trim(), p_engineer_id: kind === 'eng' ? id : null, p_dept_manager_id: kind === 'dm' ? id : null });
    setMsg(error ? { ok: false, t: rpcError(error) } : { ok: true, t: 'تم الربط — تتغير الصلاحيات فوراً' });
    await syncNow();
  }
  const roleOf = (p: DbRow) => [p.is_admin && 'مدير النظام', managers.find((m) => m.user_id === p.id) && 'مدير القسم', engineers.find((e) => e.user_id === p.id)?.name].filter(Boolean).join(' · ');

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="ربط حساب بمهندس أو مدير قسم">
        <div className="space-y-3">
          <input className="field" dir="ltr" type="email" placeholder="email@sawaed.sa" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select className="field" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="الربط">
            <option value="">— اختر —</option>
            <optgroup label="المهندسون">{engineers.map((e) => <option key={e.id} value={`eng:${e.id}`}>{e.name}{e.user_id ? ' (مربوط)' : ''}{e.email ? ` — ${e.email}` : ''}</option>)}</optgroup>
            {s.isAdmin && <optgroup label="مديرو القسم">{managers.map((m) => <option key={m.id} value={`dm:${m.id}`}>{m.name}{m.user_id ? ' (مربوط)' : ''}</option>)}</optgroup>}
          </select>
          <div className="flex flex-wrap gap-2">
            <Btn size="sm" onClick={link}>ربط</Btn>
            {s.isAdmin && <Btn size="sm" variant="ghost" onClick={invite} disabled={!email}>إرسال دعوة لإنشاء حساب</Btn>}
          </div>
          {msg && <p className={msg.ok ? 'text-sm text-green' : 'text-sm text-red'}>{msg.t}</p>}
          <p className="text-xs text-ink-soft">بريد المهندس في الملف يظهر بجانب اسمه لتسهيل المطابقة. الربط يدوي ويُسجَّل في سجل التدقيق.</p>
        </div>
      </Card>
      <Card title={`الحسابات (${profiles.length})`}>
        {profiles.map((p) => (
          <Row key={p.id}>
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold" dir="ltr">{p.email}</div><div className="text-xs text-ink-soft">{roleOf(p) || 'غير مربوط'}</div></div>
            {s.isAdmin && p.id !== s.userId && (
              <div className="flex shrink-0 gap-1">
                <Btn size="sm" variant="ghost" onClick={() => updateRecord('profiles', p.id, { is_admin: !p.is_admin })}>{p.is_admin ? 'إلغاء الإدارة' : 'مدير نظام'}</Btn>
                <Btn size="sm" variant={p.is_active ? 'danger' : 'ghost'} onClick={() => updateRecord('profiles', p.id, { is_active: !p.is_active })}>{p.is_active ? 'إيقاف' : 'تفعيل'}</Btn>
              </div>
            )}
          </Row>
        ))}
      </Card>
      {s.isAdmin && (
        <Card title="مديرو قسم الإشراف">
          {managers.map((m) => (
            <Row key={m.id}>
              <span className="flex-1 text-sm">{m.name} {m.user_id ? <Badge tone="green">مربوط</Badge> : <Badge tone="amber">بلا حساب</Badge>}</span>
              <Btn size="sm" variant="ghost" onClick={() => updateRecord('dept_managers', m.id, { is_active: !m.is_active })}>{m.is_active ? 'إيقاف' : 'تفعيل'}</Btn>
            </Row>
          ))}
          <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (newDm.trim()) { await createRecord('dept_managers', { name: newDm.trim() }); setNewDm(''); } }}>
            <input className="field" placeholder="اسم مدير قسم جديد" value={newDm} onChange={(e) => setNewDm(e.target.value)} />
            <Btn size="sm" type="submit">إضافة</Btn>
          </form>
        </Card>
      )}
    </div>
  );
}

function External() {
  const projects = useLiveQuery(() => db.t('projects').toArray(), []) ?? [];
  const members = useLiveQuery(() => db.t('project_external_members').toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.t('profiles').toArray(), []) ?? [];
  const [v, setV] = useState({ project: '', email: '', party: 'owner' });
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card title="وصول المالك والمقاول (قراءة التقارير المعتمدة والرد)">
      <form className="mb-4 grid gap-2 sm:grid-cols-4" onSubmit={async (e) => {
        e.preventDefault(); setMsg(null);
        const { error } = await supabase().rpc('add_external_member', { p_project_id: v.project, p_email: v.email.trim(), p_party: v.party });
        setMsg(error ? rpcError(error) : 'تمت الإضافة'); await syncNow();
      }}>
        <select className="field" value={v.project} onChange={(e) => setV({ ...v, project: e.target.value })} aria-label="المشروع" required><option value="">المشروع</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <input className="field" dir="ltr" type="email" placeholder="البريد" required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        <select className="field" value={v.party} onChange={(e) => setV({ ...v, party: e.target.value })} aria-label="الصفة"><option value="owner">مالك</option><option value="contractor">مقاول</option></select>
        <Btn type="submit">إضافة</Btn>
      </form>
      {msg && <p className="mb-2 text-sm text-ink-soft">{msg}</p>}
      {members.map((m) => (
        <Row key={`${m.project_id}-${m.user_id}`}>
          <span className="flex-1 text-sm">{projects.find((p) => p.id === m.project_id)?.name} — <span dir="ltr">{profiles.find((p) => p.id === m.user_id)?.email ?? m.user_id}</span></span>
          <Badge>{m.party === 'owner' ? 'مالك' : 'مقاول'}</Badge>
          <button className="text-xs text-red" onClick={async () => { await supabase().from('project_external_members').delete().match({ project_id: m.project_id, user_id: m.user_id }); syncNow(); }}>إزالة</button>
        </Row>
      ))}
    </Card>
  );
}

function Stages() {
  const stages = useStages();
  const [rows, setRows] = useState<DbRow[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  useEffect(() => { if (!rows && stages.length) setRows(stages.map((x) => ({ ...x }))); }, [stages, rows]);
  if (!rows) return <Spinner />;
  const total = rows.reduce((a, r) => a + Number(r.weight || 0), 0);
  const upd = (i: number, k: string, v: any) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const move = (i: number, d: number) => { const r = [...rows]; [r[i], r[i + d]] = [r[i + d], r[i]]; setRows(r); };
  return (
    <Card title="مراحل الرقابة المركزية" action={<span className={`num text-sm font-semibold ${Math.abs(total - 100) < 0.001 ? 'text-green' : 'text-red'}`}>المجموع {total}%</span>}>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.id} className="grid grid-cols-[auto_1fr_5rem] items-center gap-2 sm:grid-cols-[auto_1fr_6rem_auto_auto]">
            <span className="num w-6 text-center text-sm text-ink-soft">{i + 1}</span>
            <input className="field" value={r.name} onChange={(e) => upd(i, 'name', e.target.value)} aria-label="اسم المرحلة" />
            <input className="field num" type="number" step="0.5" min={0} max={100} value={r.weight} onChange={(e) => upd(i, 'weight', e.target.value)} aria-label="الوزن" />
            <label className="col-span-2 flex items-center gap-1 text-xs sm:col-span-1"><input type="checkbox" checked={!!r.is_pour_gate} onChange={(e) => upd(i, 'is_pour_gate', e.target.checked)} /> قبل الصب</label>
            <div className="flex gap-1"><button type="button" disabled={!i} onClick={() => move(i, -1)} aria-label="أعلى">▲</button><button type="button" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="أسفل">▼</button></div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Btn size="sm" variant="ghost" onClick={() => setRows([...rows, { id: crypto.randomUUID(), name: 'مرحلة جديدة', weight: 0, is_pour_gate: false } as DbRow])}>+ مرحلة</Btn>
        <Btn size="sm" disabled={!stageWeightsValid(rows.map((r, i) => ({ id: r.id, sort_order: i + 1, weight: Number(r.weight) })))} onClick={async () => {
          setMsg(null);
          const { error } = await supabase().rpc('save_stages', { p_stages: rows.map((r, i) => ({ id: r.id, name: r.name, sort_order: i + 1, weight: Number(r.weight), is_pour_gate: !!r.is_pour_gate })) });
          if (error) return setMsg({ ok: false, t: error.code === '23503' ? 'لا يمكن حذف مرحلة فيها مشاريع حالياً' : rpcError(error) });
          setMsg({ ok: true, t: 'حُفظت المراحل — أُعيد حساب نسب كل المشاريع' });
          await db.t('stages').clear(); await db.meta.delete('pull:stages'); await syncNow(); setRows(null);
        }}>حفظ (يتطلب اتصالاً)</Btn>
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-green' : 'text-red'}`}>{msg.t}</p>}
      <p className="mt-2 text-xs text-ink-soft">نسبة إنجاز المشروع = مجموع أوزان المراحل حتى مرحلته الحالية. «قبل الصب» يجعل قبول طلب الفحص يقترح المرحلة التالية.</p>
    </Card>
  );
}

function Refs() {
  const refs = useLiveQuery(() => db.t('code_references').orderBy('id').toArray().then((r) => r.sort((a, b) => a.sort_order - b.sort_order)), []) ?? [];
  const [n, setN] = useState({ code: '', title: '', authority: 'sbc' });
  return (
    <Card title="مراجع الكود والاشتراطات (عناوين فقط)">
      {refs.map((r) => (
        <Row key={r.id}>
          <span className="num w-28 shrink-0 text-sm font-semibold">{r.code}</span>
          <span className="flex-1 text-sm">{r.title}</span>
          <button className="text-xs underline" onClick={() => updateRecord('code_references', r.id, { is_active: !r.is_active })}>{r.is_active ? 'إخفاء' : 'إظهار'}</button>
          <button className="text-xs text-red" onClick={() => confirm('حذف المرجع؟') && deleteRecord('code_references', r.id)}>حذف</button>
        </Row>
      ))}
      <form className="mt-3 grid gap-2 sm:grid-cols-[8rem_1fr_9rem_auto]" onSubmit={async (e) => { e.preventDefault(); if (!n.code || !n.title) return; await createRecord('code_references', { ...n, sort_order: refs.length * 10 + 10, is_active: true }); setN({ code: '', title: '', authority: 'sbc' }); }}>
        <input className="field" placeholder="SBC 3xx" value={n.code} onChange={(e) => setN({ ...n, code: e.target.value })} />
        <input className="field" placeholder="العنوان" value={n.title} onChange={(e) => setN({ ...n, title: e.target.value })} />
        <select className="field" value={n.authority} onChange={(e) => setN({ ...n, authority: e.target.value })} aria-label="الجهة"><option value="sbc">كود البناء</option><option value="civil_defense">الدفاع المدني</option><option value="balady">بلدي</option><option value="other">أخرى</option></select>
        <Btn type="submit" size="sm">إضافة</Btn>
      </form>
    </Card>
  );
}

function Branding() {
  const company = useSetting<any>('company');
  const branding = useSetting<any>('branding');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card title="الشعار والترويسة">
      <div className="space-y-3">
        <label className="block text-sm">اسم الشركة (يظهر في ترويسة التقارير)
          <input className="field mt-1" defaultValue={company?.name ?? ''} onBlur={(e) => company && e.target.value !== company.name && updateRecord('app_settings', 'company', { value: { ...company, name: e.target.value } })} />
        </label>
        <label className="block text-sm">الشعار (PNG أو JPG، يظهر في التطبيق وملفات PDF)
          <input className="mt-1 block text-sm" type="file" accept="image/png,image/jpeg" onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            const path = `logo-${Date.now()}.${f.type === 'image/png' ? 'png' : 'jpg'}`;
            const { error } = await supabase().storage.from('branding').upload(path, f, { contentType: f.type, upsert: true });
            if (error) return setMsg('تعذّر الرفع (يتطلب اتصالاً)');
            await updateRecord('app_settings', 'branding', { value: { ...(branding ?? {}), logo_path: path } });
            setMsg('حُدّث الشعار');
          }} />
        </label>
        {msg && <p className="text-sm text-ink-soft">{msg}</p>}
      </div>
    </Card>
  );
}
