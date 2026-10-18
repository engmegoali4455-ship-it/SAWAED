'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Btn } from '@/components/ui';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const s = useSession();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { if (s.ready && s.session) router.replace('/'); }, [s.ready, s.session, router]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setMsg({ ok: false, text: error.message.includes('Invalid') ? 'البريد أو كلمة المرور غير صحيحة' : 'تعذّر الدخول — تحقق من الاتصال' });
  }
  async function reset() {
    if (!email) { setMsg({ ok: false, text: 'اكتب بريدك أولاً' }); return; }
    const { error } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/account/` });
    setMsg(error ? { ok: false, text: 'تعذّر الإرسال' } : { ok: true, text: 'أُرسل رابط تعيين كلمة المرور إلى بريدك' });
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 rounded-t-lg border-b-[3px] border-brand bg-head px-5 py-6 text-center text-paper">
          <img src="/logo.svg" alt="" className="mx-auto mb-3 h-14 w-14 rounded bg-white p-1" />
          <h1 className="text-lg font-semibold">سواعد للإشراف الهندسي</h1>
          <p className="mt-1 text-xs text-paper/60">سواعد للاستشارات الهندسية</p>
        </div>
        <form onSubmit={login} className="space-y-3 rounded-lg border border-line bg-card p-5">
          <label className="block text-sm">البريد الإلكتروني
            <input className="field mt-1" type="email" autoComplete="username" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block text-sm">كلمة المرور
            <input className="field mt-1" type="password" autoComplete="current-password" dir="ltr" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {msg && <p role="alert" className={msg.ok ? 'text-sm text-green' : 'text-sm text-red'}>{msg.text}</p>}
          <Btn type="submit" className="w-full" disabled={busy}>{busy ? 'جارٍ الدخول…' : 'دخول'}</Btn>
          <button type="button" onClick={reset} className="w-full text-center text-xs text-ink-soft underline">نسيت كلمة المرور؟</button>
        </form>
        <p className="mt-4 text-center text-xs text-ink-soft">الحسابات يُنشئها مدير النظام. بعد الدخول الأول يعمل التطبيق دون إنترنت.</p>
      </div>
    </main>
  );
}
