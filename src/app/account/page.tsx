'use client';
import { useState } from 'react';
import { AppShell } from '@/components/shell';
import { Btn, Card, PageTitle } from '@/components/ui';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function AccountPage() {
  return <AppShell><Inner /></AppShell>;
}

function Inner() {
  const s = useSession();
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  return (
    <div className="mx-auto max-w-md">
      <PageTitle title="حسابي" sub={s.email} />
      <Card title="تعيين كلمة المرور">
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          if (pw.length < 8) return setMsg({ ok: false, t: 'ثمانية أحرف على الأقل' });
          const { error } = await supabase().auth.updateUser({ password: pw });
          setMsg(error ? { ok: false, t: 'تعذّر الحفظ' } : { ok: true, t: 'حُفظت كلمة المرور' });
          setPw('');
        }}>
          <input className="field" type="password" dir="ltr" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="كلمة المرور الجديدة" />
          <Btn type="submit">حفظ</Btn>
          {msg && <p className={msg.ok ? 'text-sm text-green' : 'text-sm text-red'}>{msg.t}</p>}
        </form>
      </Card>
      <Btn variant="ghost" className="mt-4 w-full" onClick={s.signOut}>تسجيل الخروج (يمسح البيانات المحلية)</Btn>
    </div>
  );
}
