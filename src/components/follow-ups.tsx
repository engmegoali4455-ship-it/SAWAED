'use client';
import Link from 'next/link';
import type { FollowUp } from '@/lib/analytics';
import { cx } from './ui';

const P = { 1: { label: 'عاجل', cls: 'bg-red text-white' }, 2: { label: 'مهم', cls: 'bg-amber-bg text-amber' }, 3: { label: 'متابعة', cls: 'bg-line text-ink-soft' } };

export function FollowUpList({ items, limit }: { items: FollowUp[]; limit?: number }) {
  const shown = limit ? items.slice(0, limit) : items;
  if (!items.length) return <p className="py-4 text-center text-sm text-green">✔ لا يوجد ما يحتاج متابعة الآن</p>;
  return (
    <ul className="divide-y divide-line">
      {shown.map((f, i) => (
        <li key={i}>
          <Link href={f.href} className="flex items-start gap-3 py-2.5 hover:bg-paper/60">
            <span className={cx('mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold', P[f.priority].cls)}>{P[f.priority].label}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{f.title}</span>
              <span className="block truncate text-xs text-ink-soft">{f.detail}</span>
            </span>
          </Link>
        </li>
      ))}
      {limit && items.length > limit && <li className="pt-2 text-center"><Link href="/alerts/" className="text-xs text-brand-text underline">عرض الكل ({items.length})</Link></li>}
    </ul>
  );
}
