// تعريف حقول كل وحدة. نموذج واحد عام (EntityForm) يرسمها، فتبقى الشاشات متسقة.
import * as L from './labels';

export type FieldType = 'text' | 'textarea' | 'int' | 'number' | 'percent' | 'money' | 'date' | 'select' | 'stage' | 'reference' | 'score';
export interface FieldDef {
  name: string; label: string; type: FieldType;
  options?: Record<string, string>; required?: boolean; half?: boolean; hint?: string; default?: any;
  /** يُخفى الحقل إن لم يكن للمستخدم صلاحية (مثل التصعيد) */
  globalOnly?: string[];
}
export interface EntityDef {
  table: string; title: string; plural: string;
  photos?: { entity_type: string; phases?: boolean };
  signature?: boolean;
  fields: FieldDef[];
  /** عنوان السطر في القوائم */
  summary: (r: Record<string, any>) => string;
  dateField?: string;
  statusField?: string;
  statusLabels?: Record<string, string>;
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());

export const ENTITIES: Record<string, EntityDef> = {
  weekly_updates: {
    table: 'weekly_updates', title: 'تحديث أسبوعي', plural: 'التحديثات الأسبوعية',
    photos: { entity_type: 'weekly_update' }, dateField: 'update_date', statusField: 'status', statusLabels: L.PROJECT_STATUS,
    summary: (r) => r.done_text || 'تحديث أسبوعي',
    fields: [
      { name: 'update_date', label: 'التاريخ', type: 'date', required: true, half: true, default: today },
      { name: 'stage_id', label: 'المرحلة', type: 'stage', half: true },
      { name: 'status', label: 'حالة المشروع', type: 'select', options: L.PROJECT_STATUS, half: true },
      { name: 'progress', label: 'نسبة الإنجاز اليدوية', type: 'percent', half: true, hint: 'اتركها فارغة لتُحسب من أوزان المراحل' },
      { name: 'done_text', label: 'المنجز هذا الأسبوع', type: 'textarea', required: true },
      { name: 'next_week_plan', label: 'خطة الأسبوع القادم', type: 'textarea' },
      { name: 'obstacles', label: 'المعوقات', type: 'textarea' },
      { name: 'labor_count', label: 'العمالة', type: 'int', half: true },
      { name: 'visits_count', label: 'عدد الزيارات', type: 'int', half: true },
    ],
  },
  works: {
    table: 'works', title: 'بند عمل', plural: 'الأعمال والأنشطة', photos: { entity_type: 'work' },
    statusField: 'status', statusLabels: L.WORK_STATUS, dateField: 'planned_end', summary: (r) => r.item,
    fields: [
      { name: 'item', label: 'البند', type: 'text', required: true },
      { name: 'discipline', label: 'التخصص', type: 'text', half: true },
      { name: 'location', label: 'الموقع / الدور', type: 'text', half: true },
      { name: 'planned_start', label: 'البداية المخططة', type: 'date', half: true },
      { name: 'planned_end', label: 'النهاية المخططة', type: 'date', half: true },
      { name: 'actual_progress', label: 'نسبة الإنجاز الفعلية', type: 'percent', half: true, default: 0 },
      { name: 'status', label: 'الحالة', type: 'select', options: L.WORK_STATUS, half: true, default: 'not_started' },
      { name: 'executor', label: 'المنفذ', type: 'text' },
    ],
  },
  inspections: {
    table: 'inspections', title: 'طلب فحص / عدم مطابقة', plural: 'الفحوصات وعدم المطابقة',
    photos: { entity_type: 'inspection' }, signature: true, statusField: 'status', statusLabels: L.INSPECTION_STATUS,
    dateField: 'closed_at', summary: (r) => r.description,
    fields: [
      { name: 'kind', label: 'النوع', type: 'select', options: L.INSPECTION_KIND, required: true, default: 'inspection_request' },
      { name: 'ref_no', label: 'الرقم', type: 'text', half: true },
      { name: 'stage_id', label: 'المرحلة', type: 'stage', half: true },
      { name: 'description', label: 'الوصف', type: 'textarea', required: true },
      { name: 'reference', label: 'المرجع', type: 'reference' },
      { name: 'addressed_to', label: 'الجهة المطلوب منها', type: 'text', half: true },
      { name: 'status', label: 'الحالة', type: 'select', options: L.INSPECTION_STATUS, half: true, default: 'open' },
      { name: 'closed_at', label: 'تاريخ الإغلاق', type: 'date', half: true },
    ],
  },
  violations: {
    table: 'violations', title: 'مخالفة', plural: 'المخالفات', photos: { entity_type: 'violation', phases: true },
    statusField: 'status', statusLabels: L.VIOLATION_STATUS, dateField: 'deadline', summary: (r) => r.description,
    fields: [
      { name: 'category', label: 'الفئة', type: 'select', options: L.VIOLATION_CATEGORY, required: true, half: true },
      { name: 'severity', label: 'الخطورة', type: 'select', options: L.SEVERITY, required: true, half: true, default: 'moderate' },
      { name: 'violator', label: 'الطرف المخالف', type: 'text' },
      { name: 'description', label: 'الوصف', type: 'textarea', required: true },
      { name: 'reference', label: 'المرجع', type: 'reference' },
      { name: 'corrective_action', label: 'الإجراء التصحيحي', type: 'textarea' },
      { name: 'deadline', label: 'مهلة التصحيح', type: 'date', half: true },
      { name: 'status', label: 'الحالة', type: 'select', options: L.VIOLATION_STATUS, half: true, default: 'open', globalOnly: ['escalated'] },
    ],
  },
  meetings: {
    table: 'meetings', title: 'محضر اجتماع', plural: 'محاضر الاجتماعات', photos: { entity_type: 'meeting' },
    dateField: 'meeting_date', summary: (r) => `${r.kind ?? 'اجتماع'}${r.meeting_no ? ` رقم ${r.meeting_no}` : ''}`,
    fields: [
      { name: 'kind', label: 'النوع', type: 'text', half: true, hint: 'أسبوعي، تنسيقي، مع المالك…' },
      { name: 'meeting_no', label: 'الرقم', type: 'text', half: true },
      { name: 'meeting_date', label: 'التاريخ', type: 'date', required: true, half: true, default: today },
      { name: 'location', label: 'المكان', type: 'text', half: true },
      { name: 'attendees_text', label: 'الحضور', type: 'textarea', hint: 'اسم في كل سطر' },
      { name: 'agenda', label: 'جدول الأعمال', type: 'textarea' },
      { name: 'decisions', label: 'القرارات', type: 'textarea' },
    ],
  },
  risks: {
    table: 'risks', title: 'مخاطرة', plural: 'سجل المخاطر', statusField: 'status', statusLabels: L.RISK_STATUS,
    dateField: 'due_date', summary: (r) => r.title,
    fields: [
      { name: 'title', label: 'المخاطرة', type: 'text', required: true },
      { name: 'category', label: 'الفئة', type: 'text', half: true },
      { name: 'reference', label: 'المرجع', type: 'reference', half: true },
      { name: 'probability', label: 'الاحتمال (1–5)', type: 'score', required: true, half: true, default: 3 },
      { name: 'impact', label: 'الأثر (1–5)', type: 'score', required: true, half: true, default: 3 },
      { name: 'owner', label: 'المسؤول', type: 'text', half: true },
      { name: 'due_date', label: 'الموعد', type: 'date', half: true },
      { name: 'treatment', label: 'المعالجة', type: 'textarea' },
      { name: 'status', label: 'الحالة', type: 'select', options: L.RISK_STATUS, default: 'open' },
    ],
  },
  permits: {
    table: 'permits', title: 'ترخيص', plural: 'التراخيص', dateField: 'expiry_date',
    summary: (r) => `${L.PERMIT_KIND[r.kind] ?? r.kind}${r.number ? ` — ${r.number}` : ''}`,
    fields: [
      { name: 'kind', label: 'النوع', type: 'select', options: L.PERMIT_KIND, required: true },
      { name: 'number', label: 'الرقم', type: 'text' },
      { name: 'issue_date', label: 'تاريخ الإصدار', type: 'date', half: true },
      { name: 'expiry_date', label: 'تاريخ الانتهاء', type: 'date', half: true },
      { name: 'notes', label: 'ملاحظات', type: 'textarea' },
    ],
  },
  invoices: {
    table: 'invoices', title: 'مستخلص', plural: 'المستخلصات', statusField: 'status', statusLabels: L.INVOICE_STATUS,
    dateField: 'submitted_at', summary: (r) => `مستخلص ${r.number ?? ''} ${r.kind ? `(${r.kind})` : ''}`,
    fields: [
      { name: 'number', label: 'الرقم', type: 'text', half: true },
      { name: 'kind', label: 'النوع', type: 'text', half: true },
      { name: 'period_from', label: 'الفترة من', type: 'date', half: true },
      { name: 'period_to', label: 'إلى', type: 'date', half: true },
      { name: 'amount_sar', label: 'القيمة (ريال)', type: 'money', half: true },
      { name: 'submitted_at', label: 'تاريخ التقديم', type: 'date', half: true },
      { name: 'status', label: 'الحالة', type: 'select', options: L.INVOICE_STATUS, default: 'preparing' },
    ],
  },
  projects: {
    table: 'projects', title: 'مشروع', plural: 'المشاريع', statusField: 'status', statusLabels: L.PROJECT_STATUS,
    summary: (r) => r.name,
    fields: [
      { name: 'name', label: 'اسم المشروع', type: 'text', required: true },
      { name: 'owner_name', label: 'المالك', type: 'text', half: true },
      { name: 'project_no', label: 'رقم المشروع', type: 'text', half: true },
      { name: 'department', label: 'القسم', type: 'select', options: L.DEPARTMENT, half: true },
      { name: 'supervision_mode', label: 'وضع الإشراف', type: 'select', options: L.SUPERVISION_MODE, half: true, default: 'full_staff' },
      { name: 'license_no', label: 'رقم الرخصة', type: 'text', half: true },
      { name: 'request_no', label: 'رقم الطلب', type: 'text', half: true },
      { name: 'service_no', label: 'رقم الخدمة', type: 'text', half: true },
      { name: 'invoice_type', label: 'نوع المستخلص', type: 'text', half: true },
      { name: 'status', label: 'الحالة', type: 'select', options: L.PROJECT_STATUS, half: true, default: 'ongoing' },
      { name: 'current_stage_id', label: 'المرحلة الحالية', type: 'stage', half: true },
      { name: 'stage_detail', label: 'تفصيل المرحلة', type: 'text' },
      { name: 'manual_progress', label: 'نسبة يدوية', type: 'percent', hint: 'فارغة = من أوزان المراحل' },
    ],
  },
  engineers: {
    table: 'engineers', title: 'مهندس', plural: 'المهندسون', statusField: 'status', statusLabels: L.ENGINEER_STATUS,
    summary: (r) => r.name,
    fields: [
      { name: 'name', label: 'الاسم', type: 'text', required: true },
      { name: 'discipline', label: 'التخصص', type: 'text', half: true },
      { name: 'grade', label: 'التصنيف المهني', type: 'text', half: true },
      { name: 'sce_no', label: 'رقم عضوية الهيئة', type: 'text', half: true },
      { name: 'sce_expiry', label: 'انتهاء العضوية', type: 'date', half: true },
      { name: 'mobile', label: 'الجوال', type: 'text', half: true },
      { name: 'email', label: 'البريد', type: 'text', half: true },
      { name: 'status', label: 'الحالة', type: 'select', options: L.ENGINEER_STATUS, default: 'active' },
    ],
  },
};

/** الحقول التي تُعدّل في نموذج المشروع من قبل مدير القسم فقط */
export const PROJECT_MASTER_FIELDS = ['name', 'owner_name', 'project_no', 'department', 'license_no', 'request_no', 'service_no', 'supervision_mode', 'invoice_type'];

export function defaultsFor(def: EntityDef): Record<string, any> {
  const o: Record<string, any> = {};
  for (const f of def.fields) if (f.default !== undefined) o[f.name] = typeof f.default === 'function' ? f.default() : f.default;
  return o;
}

/** يحوّل قيم النموذج (نصوص) إلى أنواع قاعدة البيانات */
export function coerce(def: EntityDef, values: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of def.fields) {
    if (!(f.name in values)) continue;
    const v = values[f.name];
    if (f.name === 'attendees_text') {
      out.attendees = String(v ?? '').split('\n').map((s) => s.trim()).filter(Boolean).map((name) => ({ name }));
      continue;
    }
    if (v === '' || v === undefined) { out[f.name] = null; continue; }
    if (['int', 'score'].includes(f.type)) out[f.name] = Math.round(Number(v));
    else if (['number', 'percent', 'money'].includes(f.type)) out[f.name] = Number(v);
    else out[f.name] = v;
  }
  return out;
}

export function validate(def: EntityDef, values: Record<string, any>): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const f of def.fields) {
    const v = values[f.name];
    if (f.required && (v === undefined || v === null || String(v).trim() === '')) errs[f.name] = 'مطلوب';
    if (v !== '' && v != null) {
      if (f.type === 'percent' && (Number(v) < 0 || Number(v) > 100)) errs[f.name] = 'بين 0 و100';
      if (f.type === 'score' && (Number(v) < 1 || Number(v) > 5)) errs[f.name] = 'من 1 إلى 5';
      if (['int', 'money'].includes(f.type) && Number(v) < 0) errs[f.name] = 'لا يقبل قيمة سالبة';
    }
  }
  const pairs: [string, string][] = [['planned_start', 'planned_end'], ['issue_date', 'expiry_date'], ['period_from', 'period_to']];
  for (const [a, b] of pairs) if (values[a] && values[b] && values[b] < values[a]) errs[b] = 'قبل تاريخ البداية';
  return errs;
}
