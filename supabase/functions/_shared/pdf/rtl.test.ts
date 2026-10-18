import { describe, expect, it } from 'vitest';
import { visualRuns } from './rtl.ts';

describe('RTL runs for PDF', () => {
  it('keeps Latin codes and numbers left-to-right inside Arabic text', () => {
    const r = visualRuns('فحص حسب SBC 304 اليوم');
    expect(r.map((x) => x.text)).toEqual([' اليوم', 'SBC 304', 'فحص حسب ']);
    expect(r.map((x) => x.rtl)).toEqual([true, false, true]);
  });
  it('pre-mirrors brackets in Arabic runs (fontkit reverses but does not mirror)', () => {
    const r = visualRuns('الأسبوع 12 (من السبت)');
    expect(r[0]).toEqual({ text: ' )من السبت(', rtl: true });
    expect(r[1]).toEqual({ text: '12', rtl: false });
  });
  it('slash dates stay one run', () => {
    expect(visualRuns('التاريخ 18/10/2026').map((x) => x.text)).toContain('18/10/2026');
  });
  it('pure Latin stays a single LTR run', () => {
    expect(visualRuns('SW-2026-014')).toEqual([{ text: 'SW-2026-014', rtl: false }]);
  });
});
