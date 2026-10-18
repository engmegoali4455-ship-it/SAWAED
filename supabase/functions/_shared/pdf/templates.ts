// قوالب المستندات: التقرير الأسبوعي ومحضر الاجتماع
import * as L from '../labels.ts';
import { ArabicPdf, C, type DocOptions, type Img } from './doc.ts';

const d = (v?: string | null) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : '—');
const hijri = (v?: string | null) => {
  if (!v) return '';
  try { return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${v.slice(0, 10)}T00:00:00Z`)); } catch { return ''; }
};
const dual = (v?: string | null) => (v ? `${d(v)} (${hijri(v)})` : '—');
const pct = (v: any) => (v == null ? '—' : `${Number(v)}%`);
const lvl = (p: number, i: number) => (p * i >= 15 ? 'high' : p * i >= 8 ? 'medium' : 'low');
const isLate = (w: any, today: string) => !!w.planned_end && w.planned_end < today && Number(w.actual_progress ?? 0) < 100 && w.status !== 'completed';

export interface WeeklyInput {
  snapshot: any; status: string; notes?: string | null; approvedBy?: string | null; approvedAt?: string | null;
  photos: Img[]; today: string;
}

export async function weeklyReportPdf(base: Omit<DocOptions, 'title' | 'subtitle'>, r: WeeklyInput): Promise<Uint8Array> {
  const s = r.snapshot ?? {};
  const p = s.project ?? {};
  const pdf = await ArabicPdf.create({ ...base, title: `التقرير الأسبوعي — ${p.name ?? ''}`, subtitle: `من ${d(s.week?.start)} إلى ${d(s.week?.end)}` });

  pdf.kv([
    ['المشروع', p.name], ['المالك', p.owner_name], ['رقم المشروع', p.project_no], ['رقم الرخصة', p.license_no],
    ['المرحلة الحالية', p.current_stage_name], ['نسبة الإنجاز', pct(p.progress)], ['الحالة', L.PROJECT_STATUS[p.status]], ['وضع الإشراف', L.SUPERVISION_MODE[p.supervision_mode]],
    ['من (السبت)', dual(s.week?.start)], ['إلى (الجمعة)', dual(s.week?.end)], ['حالة التقرير', L.REPORT_STATUS[r.status]], ['آخر تحديث', d(p.last_update_date)],
  ]);
  if (r.status === 'draft') pdf.paragraph('مسودة — لم يُعتمد بعد', { bold: true, color: C.red });

  const ups = s.updates ?? [];
  const u = ups[ups.length - 1];
  pdf.heading('التحديث الأسبوعي');
  if (!u) pdf.paragraph('لم يُسجَّل تحديث أسبوعي في هذا الأسبوع', { color: C.red });
  else {
    pdf.paragraph(u.done_text, { label: 'المنجز' });
    pdf.paragraph(u.next_week_plan, { label: 'خطة الأسبوع القادم' });
    pdf.paragraph(u.obstacles || 'لا توجد', { label: 'المعوقات' });
    pdf.kv([['العمالة', String(u.labor_count ?? '—')], ['الزيارات', String(ups.reduce((a: number, x: any) => a + (x.visits_count ?? 0), 0))], ['تاريخ التحديث', dual(u.update_date)], ['عدد التحديثات', String(ups.length)]]);
  }
  if (r.notes) { pdf.heading('ملاحظات مدير المشروع'); pdf.paragraph(r.notes); }

  pdf.heading('الأعمال والأنشطة الجارية');
  pdf.table(['البند', 'التخصص', 'الموقع', 'النهاية المخططة', 'الإنجاز', 'الحالة'],
    (s.works ?? []).map((w: any) => [w.item, w.discipline, w.location, d(w.planned_end), pct(w.actual_progress), isLate(w, r.today) ? 'متأخر' : L.WORK_STATUS[w.status]]), [3, 1.3, 1.3, 1.5, 0.9, 1.2]);

  pdf.heading('طلبات الفحص وعدم المطابقة');
  pdf.table(['النوع', 'الوصف', 'المرجع', 'الجهة', 'الحالة', 'الإغلاق'],
    (s.inspections ?? []).map((i: any) => [L.INSPECTION_KIND[i.kind], i.description, i.reference, i.addressed_to, L.INSPECTION_STATUS[i.status], d(i.closed_at)]), [1.6, 2.8, 1.2, 1.2, 1.2, 1.3]);

  pdf.heading('المخالفات');
  pdf.table(['الفئة', 'الخطورة', 'الطرف', 'الوصف', 'الإجراء التصحيحي', 'المهلة', 'الحالة'],
    (s.violations ?? []).map((v: any) => [L.VIOLATION_CATEGORY[v.category], L.SEVERITY[v.severity], v.violator, v.description, v.corrective_action, d(v.deadline), L.VIOLATION_STATUS[v.status]]), [1.2, 0.9, 1, 2.4, 1.9, 1.3, 1.1]);

  pdf.heading('الاجتماعات');
  if (!(s.meetings ?? []).length) pdf.paragraph('لا توجد اجتماعات هذا الأسبوع', { color: C.soft });
  for (const m of s.meetings ?? []) {
    pdf.paragraph(`${m.kind ?? 'اجتماع'}${m.meeting_no ? ` رقم ${m.meeting_no}` : ''} — ${dual(m.meeting_date)}${m.location ? ` — ${m.location}` : ''}`, { bold: true });
    if (m.decisions) pdf.paragraph(m.decisions, { label: 'القرارات' });
    if ((m.actions ?? []).length) pdf.table(['بند المتابعة', 'المسؤول', 'الموعد', 'الحالة'], m.actions.map((a: any) => [a.item, a.owner, d(a.due_date), L.ACTION_STATUS[a.status]]), [3, 1.4, 1.1, 1]);
  }

  pdf.heading('المخاطر المفتوحة');
  pdf.table(['المخاطرة', 'الفئة', 'الدرجة', 'المستوى', 'المسؤول', 'المعالجة'],
    (s.risks ?? []).map((k: any) => [k.title, k.category, `${k.probability}×${k.impact}=${k.probability * k.impact}`, L.RISK_LEVEL[lvl(k.probability, k.impact)], k.owner, k.treatment]), [2.4, 1, 1, 0.9, 1.1, 2.4]);

  pdf.heading('فريق الإشراف');
  pdf.table(['الاسم', 'الدور', 'التخصص', 'التفرغ'], (s.team ?? []).map((t: any) => [t.name, L.ASSIGNMENT_ROLE[t.role], t.discipline, pct(t.allocation_pct)]), [2, 2, 1.4, 0.8]);

  if (r.photos.length) { pdf.heading('صور مختارة من الموقع'); await pdf.photos(r.photos); }

  pdf.heading('الاعتماد');
  pdf.kv([['اعتمده', r.approvedBy ?? (r.status === 'draft' ? 'بانتظار الاعتماد' : '—')], ['تاريخ الاعتماد', r.approvedAt ? d(r.approvedAt.slice(0, 10)) : '—'], ['', ''], ['', '']]);
  return pdf.finish();
}

export interface MeetingInput { meeting: any; actions: any[]; project: any; photos: Img[] }

export async function meetingPdf(base: Omit<DocOptions, 'title' | 'subtitle'>, r: MeetingInput): Promise<Uint8Array> {
  const m = r.meeting;
  const pdf = await ArabicPdf.create({ ...base, title: `محضر اجتماع${m.meeting_no ? ` رقم ${m.meeting_no}` : ''}`, subtitle: r.project?.name });
  pdf.kv([['المشروع', r.project?.name], ['النوع', m.kind], ['التاريخ', dual(m.meeting_date)], ['المكان', m.location]]);
  pdf.heading('الحضور');
  pdf.table(['الاسم', 'الجهة', 'الصفة'], (m.attendees ?? []).map((a: any) => [a.name, a.party, a.role]), [2, 1.5, 1.5]);
  pdf.heading('جدول الأعمال'); pdf.paragraph(m.agenda);
  pdf.heading('القرارات'); pdf.paragraph(m.decisions);
  pdf.heading('بنود المتابعة');
  pdf.table(['#', 'البند', 'المسؤول', 'الموعد', 'الحالة'], r.actions.map((a, i) => [String(i + 1), a.item, a.owner, d(a.due_date), L.ACTION_STATUS[a.status]]), [0.4, 3.4, 1.4, 1.1, 1]);
  if (r.photos.length) { pdf.heading('الصور'); await pdf.photos(r.photos); }
  pdf.heading('التوقيعات');
  pdf.kv([['مهندس الإشراف', '................'], ['المقاول', '................'], ['المالك', '................'], ['', '']]);
  return pdf.finish();
}
