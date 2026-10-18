'use client';
import { useLiveQuery } from 'dexie-react-hooks';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { db } from '@/lib/db';
import { useSetting, useSyncState } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { syncNow } from '@/lib/sync';
import { cx, Spinner } from './ui';

/** الشعار: المرفوع من الإعدادات (يُحفظ محلياً للعمل دون اتصال) أو الشعار الافتراضي */
export function useLogo(): string {
  const branding = useSetting<{ logo_path?: string | null }>('branding');
  const cached = useLiveQuery(() => db.blobs.get('logo'), []);
  const [url, setUrl] = useState('/logo.svg');
  useEffect(() => {
    const path = branding?.logo_path;
    if (!path) { setUrl('/logo.svg'); return; }
    if (cached && cached.path === path) { const u = URL.createObjectURL(cached.blob); setUrl(u); return () => URL.revokeObjectURL(u); }
    supabase().storage.from('branding').download(path).then(({ data }) => {
      if (data) db.blobs.put({ id: 'logo', bucket: 'branding', path, blob: data, uploaded: 1 });
    });
  }, [branding?.logo_path, cached]);
  return url;
}

function SyncBadge() {
  const s = useSyncState();
  const label = !s.online ? 'دون اتصال' : s.syncing ? 'مزامنة…' : s.conflicts ? `تعارض ${s.conflicts}` : s.failed ? `فشل ${s.failed}` : s.pending ? `بانتظار ${s.pending}` : 'محدّث';
  const tone = !s.online ? 'bg-amber-bg text-amber' : s.conflicts || s.failed ? 'bg-red-bg text-red' : s.pending || s.syncing ? 'bg-white/15 text-paper' : 'bg-green-bg text-green';
  return (
    <Link href="/sync/" className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', tone)} title="حالة المزامنة">
      <span className={cx('h-1.5 w-1.5 rounded-full bg-current', s.syncing && 'animate-pulse')} />
      {label}
    </Link>
  );
}

interface NavItem { href: string; label: string; icon: string; show: boolean; badge?: number }

export function AppShell({ children }: { children: ReactNode }) {
  const s = useSession();
  const router = useRouter();
  const path = usePathname();
  const logo = useLogo();
  const unread = useLiveQuery(() => (s.userId ? db.t('notifications').filter((n) => !n.read_at).count() : 0), [s.userId]) ?? 0;

  useEffect(() => { if (s.ready && !s.session) router.replace('/login/'); }, [s.ready, s.session, router]);
  if (!s.ready || !s.session) return <Spinner />;

  const field = !s.isGlobal;
  const nav: NavItem[] = [
    { href: '/', label: s.isGlobal ? 'لوحة القيادة' : 'مشاريعي', icon: '◧', show: true },
    { href: '/projects/', label: 'المشاريع', icon: '▤', show: s.isGlobal },
    { href: '/staffing/', label: 'التسكين', icon: '◎', show: s.isGlobal },
    { href: '/reports/', label: 'التقارير', icon: '▦', show: true },
    { href: '/alerts/', label: 'التنبيهات', icon: '◉', show: !s.isExternal, badge: unread },
    { href: '/admin/', label: 'الإدارة', icon: '⚙', show: s.isGlobal },
  ].filter((n) => n.show);
  const active = (h: string) => (h === '/' ? path === '/' : path.startsWith(h));

  return (
    <div className="min-h-screen lg:flex">
      {/* الشريط الجانبي (اللابتوب) */}
      <aside className="no-print hidden w-60 shrink-0 border-l border-line bg-head text-paper lg:block">
        <div className="sticky top-0 flex h-screen flex-col">
          <div className="flex items-center gap-3 border-b-[3px] border-brand px-4 py-4">
            <img src={logo} alt="سواعد" className="h-10 w-10 rounded bg-white object-contain p-0.5" />
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold">سواعد للإشراف الهندسي</div>
              <div className="truncate text-xs text-paper/60">{s.profile?.full_name ?? s.email}</div>
            </div>
          </div>
          <nav className="flex-1 space-y-0.5 p-2">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={cx('flex items-center gap-3 rounded-md px-3 py-2 text-sm',
                active(n.href) ? 'bg-brand text-white' : 'text-paper/80 hover:bg-white/10')}>
                <span aria-hidden className="w-4 text-center">{n.icon}</span>{n.label}
                {!!n.badge && <span className="num mr-auto rounded-full bg-brand px-1.5 text-[11px] text-white">{n.badge}</span>}
              </Link>
            ))}
          </nav>
          <div className="space-y-2 border-t border-white/10 p-3">
            <SyncBadge />
            <button onClick={s.signOut} className="block text-xs text-paper/60 hover:text-paper">تسجيل الخروج</button>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* الرأس (الجوال) */}
        <header className="no-print sticky top-0 z-30 border-b-[3px] border-brand bg-head text-paper lg:hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <img src={logo} alt="سواعد" className="h-9 w-9 rounded bg-white object-contain p-0.5" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold">سواعد للإشراف الهندسي</div>
              <div className="truncate text-[11px] text-paper/60">{field ? 'التطبيق الميداني' : 'لوحة الإدارة'}</div>
            </div>
            <SyncBadge />
          </div>
        </header>

        <main className="safe-bottom mx-auto w-full max-w-6xl px-4 pt-4">{children}</main>

        {/* الشريط السفلي (الجوال) */}
        <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
          <div className="mx-auto flex max-w-xl">
            {nav.slice(0, 5).map((n) => (
              <Link key={n.href} href={n.href} className={cx('relative flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[11px]',
                active(n.href) ? 'text-brand-text' : 'text-ink-soft')}>
                <span aria-hidden className="text-lg leading-none">{n.icon}</span>
                <span className="truncate">{n.label}</span>
                {!!n.badge && <span className="num absolute right-1/2 top-1 translate-x-4 rounded-full bg-brand px-1.5 text-[10px] text-white">{n.badge}</span>}
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}

export function RefreshButton() {
  const st = useSyncState();
  return <button onClick={() => syncNow()} disabled={st.syncing} className="text-xs text-ink-soft underline">{st.syncing ? 'جارٍ…' : 'تحديث الآن'}</button>;
}
