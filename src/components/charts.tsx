'use client';
// الرسوم: أعمدة أفقية بقيم ظاهرة (بدل الدوائر)، ومنحنيات بمحور واحد، وجدول بديل لكل رسم.
// الألوان: سلسلة واحدة = برتقالي سواعد؛ عدة سلاسل = ترتيب ثابت (تم التحقق منه بـ validate_palette)؛
// الحالات = لوحة الحالة المحجوزة مع التسمية دائماً.
import { useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from './ui';

export const SERIES = ['#2a78d6', '#e85e30', '#1baf7a', '#eda100', '#6250d6'];
export const STATUS_COLOR = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b', neutral: '#a39d95' };
const BRAND = '#e85e30';
const AXIS = { fontSize: 11, fill: '#726a62' };
const tooltipStyle = { fontFamily: 'inherit', fontSize: 12, borderRadius: 6, border: '1px solid #e0dad2', direction: 'rtl' as const };

export interface Datum { label: string; value: number; color?: string }

function ChartCard({ title, children, table, empty }: { title: string; children: ReactNode; table: ReactNode; empty?: boolean }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card title={title} action={!empty && <button className="text-xs text-ink-soft underline" onClick={() => setAsTable(!asTable)}>{asTable ? 'رسم' : 'جدول'}</button>}>
      {empty ? <p className="py-6 text-center text-sm text-ink-soft">لا توجد بيانات بعد</p> : asTable ? table : children}
    </Card>
  );
}

function DataTable({ rows, unit }: { rows: Datum[]; unit?: string }) {
  return (
    <table className="w-full text-sm">
      <tbody>{rows.map((r) => <tr key={r.label} className="border-b border-line last:border-0"><td className="py-1.5">{r.label}</td><td className="num py-1.5 text-left">{r.value}{unit}</td></tr>)}</tbody>
    </table>
  );
}

/** أعمدة أفقية: الفئات بالعربية على اليمين، والقيمة مكتوبة عند نهاية كل عمود */
export function HBars({ title, data, unit = '', max }: { title: string; data: Datum[]; unit?: string; max?: number }) {
  const h = Math.max(120, data.length * 34 + 20);
  return (
    <ChartCard title={title} empty={!data.length || data.every((d) => !d.value)} table={<DataTable rows={data} unit={unit} />}>
      <div style={{ height: h }} className="ltr">
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 4, bottom: 4, left: 56 }} barCategoryGap={6}>
            <XAxis type="number" hide domain={[0, max ?? 'auto']} reversed />
            <YAxis type="category" dataKey="label" orientation="right" width={130} tick={{ ...AXIS, fill: '#231f1c' }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} contentStyle={tooltipStyle} formatter={(v: any) => [`${v}${unit}`, '']} separator="" />
            <Bar dataKey="value" radius={[4, 0, 0, 4]} maxBarSize={18} isAnimationActive={false}>
              {data.map((d) => <Cell key={d.label} fill={d.color ?? BRAND} />)}
              <LabelList dataKey="value" position="left" formatter={(v: any) => `${Number(v).toLocaleString('en-US')}${unit}`} style={{ fontSize: 11, fill: '#231f1c', fontFamily: 'var(--font-mono)' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/** أعمدة رأسية لسلسلة زمنية (أشهر/أسابيع) */
export function VBars({ title, data, unit = '' }: { title: string; data: Datum[]; unit?: string }) {
  return (
    <ChartCard title={title} empty={!data.length || data.every((d) => !d.value)} table={<DataTable rows={data} unit={unit} />}>
      <div className="ltr h-48">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#ece7e0" />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} reversed />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={34} orientation="right" allowDecimals={false} />
            <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} contentStyle={tooltipStyle} formatter={(v: any) => [`${v}${unit}`, '']} separator="" />
            <Bar dataKey="value" fill={BRAND} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false}>
              <LabelList dataKey="value" position="top" style={{ fontSize: 10, fill: '#726a62' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/** منحنى (سلسلة أو أكثر) بمحور واحد */
export function Trend({ title, data, series, unit = '', domain }: {
  title: string; data: Record<string, any>[]; series: { key: string; label: string }[]; unit?: string; domain?: [number, number];
}) {
  const rows: Datum[] = data.map((d) => ({ label: d.label, value: d[series[0].key] }));
  return (
    <ChartCard title={title} empty={!data.length} table={
      <table className="w-full text-sm"><thead><tr><th className="text-right font-medium text-ink-soft">الفترة</th>{series.map((s) => <th key={s.key} className="text-left font-medium text-ink-soft">{s.label}</th>)}</tr></thead>
        <tbody>{data.map((d) => <tr key={d.label} className="border-b border-line last:border-0"><td className="py-1">{d.label}</td>{series.map((s) => <td key={s.key} className="num py-1 text-left">{d[s.key] ?? '—'}{unit}</td>)}</tr>)}</tbody></table>
    }>
      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-3 text-xs">{series.map((s, i) => <span key={s.key} className="inline-flex items-center gap-1"><span className="h-0.5 w-4" style={{ background: SERIES[i] }} />{s.label}</span>)}</div>
      )}
      <div className="ltr h-52">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#ece7e0" />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} reversed interval="preserveStartEnd" />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={34} orientation="right" domain={domain ?? ['auto', 'auto']} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: any, n: any) => [`${v}${unit}`, series.find((s) => s.key === n)?.label ?? n]} />
            {series.map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} stroke={series.length === 1 ? BRAND : SERIES[i]} strokeWidth={2}
                dot={{ r: 3, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

/** سلّم المراحل: كل مرحلة بوزنها، المنجز ملوّن والحالية مميزة */
export function StageLadder({ stages, currentId }: { stages: { id: string; name: string; weight: number; sort_order: number }[]; currentId?: string | null }) {
  const cur = stages.find((s) => s.id === currentId)?.sort_order ?? 0;
  return (
    <ol className="space-y-1.5">
      {stages.map((s) => {
        const state = s.sort_order < cur ? 'done' : s.sort_order === cur ? 'current' : 'todo';
        return (
          <li key={s.id} className="flex items-center gap-2 text-sm">
            <span className={`num flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${state === 'done' ? 'bg-green text-white' : state === 'current' ? 'bg-brand text-white' : 'bg-line text-ink-soft'}`}>
              {state === 'done' ? '✓' : s.sort_order}
            </span>
            <span className={`min-w-0 flex-1 truncate ${state === 'current' ? 'font-semibold text-brand-text' : state === 'todo' ? 'text-ink-soft' : ''}`}>
              {s.name}{state === 'current' && ' ← المرحلة الحالية'}
            </span>
            <span className="num text-xs text-ink-soft">{Number(s.weight)}%</span>
          </li>
        );
      })}
    </ol>
  );
}
