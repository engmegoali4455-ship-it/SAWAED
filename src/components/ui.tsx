'use client';
import Link from 'next/link';
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { formatGregorian, formatHijri } from '@/lib/domain';
import { TONE } from '@/lib/labels';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'dark'; size?: 'sm' | 'md' };
export function Btn({ variant = 'primary', size = 'md', className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2.5 text-[15px]',
        variant === 'primary' && 'bg-brand text-white hover:bg-brand-text',
        variant === 'dark' && 'bg-head text-paper hover:bg-ink',
        variant === 'ghost' && 'border border-line bg-white text-ink hover:border-brand hover:text-brand-text',
        variant === 'danger' && 'border border-red/30 bg-red-bg text-red hover:bg-red hover:text-white',
        className,
      )}
    />
  );
}

export function LinkBtn({ href, children, variant = 'ghost', className }: { href: string; children: ReactNode; variant?: 'primary' | 'ghost'; className?: string }) {
  return (
    <Link href={href} className={cx('inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold',
      variant === 'primary' ? 'bg-brand text-white' : 'border border-line bg-white text-ink hover:border-brand', className)}>
      {children}
    </Link>
  );
}

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx('min-w-0 rounded-lg border border-line bg-card', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="truncate text-[15px] font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const toneCls = {
  red: 'bg-red-bg text-red', amber: 'bg-amber-bg text-amber', green: 'bg-green-bg text-green',
  gray: 'bg-line/60 text-ink-soft', brand: 'bg-brand/10 text-brand-text',
};
export function Badge({ children, tone, code }: { children: ReactNode; tone?: keyof typeof toneCls; code?: string }) {
  const t = tone ?? (code ? TONE[code] : undefined) ?? 'gray';
  return <span className={cx('inline-flex shrink-0 items-center rounded px-2 py-0.5 text-xs font-semibold', toneCls[t])}>{children}</span>;
}

export function Progress({ value, tone = 'brand' }: { value: number; tone?: 'brand' | 'green' | 'red' }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full', tone === 'brand' ? 'bg-brand' : tone === 'green' ? 'bg-green' : 'bg-red')} style={{ width: `${v}%` }} />
    </div>
  );
}

export function DualDate({ d, compact }: { d: string | null | undefined; compact?: boolean }) {
  if (!d) return <span className="text-ink-soft">—</span>;
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="num text-[13px]">{formatGregorian(d)}</span>
      {!compact && <span className="text-[11px] text-ink-soft">{formatHijri(d)}</span>}
    </span>
  );
}

export function Stat({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: 'red' | 'amber' | 'green'; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-card px-3 py-3">
      <div className="truncate text-xs text-ink-soft">{label}</div>
      <div className={cx('num mt-1 text-2xl font-semibold text-right', tone === 'red' && 'text-red', tone === 'amber' && 'text-amber', tone === 'green' && 'text-green')}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-ink-soft">{hint}</div>}
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-card/60 px-6 py-10 text-center">
      <div className="font-semibold">{title}</div>
      {hint && <div className="mt-1 text-sm text-ink-soft">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className={cx('max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-paper sm:rounded-xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
        onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-paper px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="إغلاق" className="rounded px-2 text-xl leading-none text-ink-soft hover:text-ink">×</button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string; count?: number }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="no-print -mx-4 overflow-x-auto px-4" role="tablist">
      <div className="flex w-max gap-1 border-b border-line">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={active === t.key} onClick={() => onChange(t.key)}
            className={cx('whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold',
              active === t.key ? 'border-brand text-brand-text' : 'border-transparent text-ink-soft hover:text-ink')}>
            {t.label}{t.count ? <span className="num mr-1 text-xs text-ink-soft">{t.count}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PageTitle({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold">{title}</h1>
        {sub && <div className="mt-0.5 text-sm text-ink-soft">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Row({ children, href, onClick }: { children: ReactNode; href?: string; onClick?: () => void }) {
  const cls = 'flex w-full min-w-0 items-start gap-3 border-b border-line px-1 py-3 text-right last:border-0 hover:bg-paper/60';
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  if (onClick) return <button onClick={onClick} className={cls}>{children}</button>;
  return <div className={cls}>{children}</div>;
}

export function Spinner() {
  return <div className="mx-auto my-10 h-6 w-6 animate-spin rounded-full border-2 border-line border-t-brand" aria-label="جارٍ التحميل" />;
}
