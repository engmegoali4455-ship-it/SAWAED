// تحويل ملف تصدير المنصة الحالية إلى صفوف الجداول الجديدة.
// دالة نقية بلا اتصال بقاعدة البيانات: تُختبر وحدها، ويستخدمها import-export.ts.
// تتسامح مع اختلاف أسماء الحقول (camelCase / snake_case / تسميات عربية)
// وتحوّل القيم العربية (الحالات، الأدوار، الأنواع) إلى الرموز المعتمدة.

export type Row = Record<string, unknown>;
export interface Rejected { key: string; index: number; id?: string; reason: string }
export interface Mapped {
  tables: Record<string, Row[]>;  // اسم الجدول ← الصفوف بترتيب الإدراج
  rejected: Rejected[];
  warnings: string[];
  photos: { table: string; entity_type: string; entity_id: string; project_id: string; source: string; taken_at?: string | null; lat?: number | null; lng?: number | null }[];
}

export const EXPORT_KEYS = ['projects', 'updates', 'risks', 'inspections', 'permits', 'invoices', 'works',
  'meetings', 'violations', 'engineers', 'assignments', 'stages', 'deptManagers'] as const;

// ترتيب الإدراج يحترم العلاقات
export const TABLE_ORDER = ['stages', 'dept_managers', 'projects', 'engineers', 'assignments', 'weekly_updates',
  'works', 'inspections', 'meetings', 'meeting_actions', 'violations', 'risks', 'permits', 'invoices'] as const;

// ---------------------------------------------------------------------
// أدوات
// ---------------------------------------------------------------------
const norm = (k: string) => k.toLowerCase().replace(/[_\s-]/g, '');

/** أول قيمة غير فارغة من بين أسماء بديلة للحقل */
export function pick(o: Row, ...names: string[]): unknown {
  const keys = Object.keys(o);
  for (const n of names) {
    const k = keys.find((x) => norm(x) === norm(n));
    if (k !== undefined && o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  }
  return undefined;
}
const str = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v).trim() || null);
function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[%,٬\s]/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))));
  return Number.isFinite(n) ? n : null;
}
const int = (v: unknown) => { const n = num(v); return n === null ? null : Math.round(n); };
const clamp = (n: number | null, lo: number, hi: number) => (n === null ? null : Math.min(hi, Math.max(lo, n)));

/** يقبل ISO، أو dd/mm/yyyy، أو طابعاً زمنياً بالمللي ثانية، أو Firestore {seconds} */
export function date(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return new Date(v).toISOString().slice(0, 10);
  if (typeof v === 'object' && v && 'seconds' in v) return new Date(Number((v as { seconds: number }).seconds) * 1000).toISOString().slice(0, 10);
  const s = String(v).trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}
function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const x = new Date(Date.UTC(y, m - 1, d));
  return x.getUTCMonth() === m - 1 ? x.toISOString().slice(0, 10) : null;
}

/** يحوّل قيمة (رمز أو تسمية عربية) إلى رمز معتمد */
function enumOf<T extends string>(dict: Record<T, readonly string[]>, v: unknown): T | null {
  const s = str(v);
  if (!s) return null;
  const l = s.toLowerCase();
  for (const [code, labels] of Object.entries(dict) as [T, readonly string[]][]) {
    if (code === l || labels.some((x) => x.toLowerCase() === l)) return code;
  }
  for (const [code, labels] of Object.entries(dict) as [T, readonly string[]][]) {
    if (labels.some((x) => l.includes(x.toLowerCase()))) return code;
  }
  return null;
}

export const DICT = {
  projectStatus: {
    ongoing: ['استمرار', 'مستمر', 'جاري', 'active', 'in progress'],
    ending_soon: ['قريباً ينتهي', 'قريبا ينتهي', 'ينتهي قريباً', 'ending soon'],
    in_process: ['تحت الإجراء', 'تحت الاجراء', 'قيد الإجراء', 'pending'],
    done: ['تم', 'منتهي', 'مكتمل', 'completed', 'finished'],
    stopped: ['متوقف', 'موقوف', 'stopped', 'on hold'],
  },
  department: { architecture: ['المعمارية', 'معماري', 'العمارة'], consulting: ['الاستشارات', 'استشارات', 'الاستشارية'] },
  mode: { full_staff: ['طاقم كامل', 'طاقم', 'full', 'resident'], visits: ['زيارات', 'زيارة', 'visit'] },
  role: {
    project_manager: ['مدير مشروع الإشراف', 'مدير المشروع', 'مدير مشروع', 'manager'],
    resident_engineer: ['مهندس مقيم', 'مقيم', 'resident'],
    visiting_engineer: ['مهندس زيارات', 'زيارات', 'visiting', 'visits'],
    site_engineer: ['مهندس إشراف', 'مهندس اشراف', 'إشراف', 'اشراف', 'supervisor', 'site'],
    specialist: ['مهندس تخصص', 'تخصص', 'specialist', 'كهرباء', 'ميكانيكا'],
  },
  engineerStatus: { active: ['نشط', 'على رأس العمل', 'فعال'], on_leave: ['إجازة', 'اجازة', 'leave'], inactive: ['غير نشط', 'منتهي', 'مستقيل', 'متوقف'] },
  inspectionKind: {
    inspection_request: ['طلب فحص', 'استلام مرحلة', 'فحص', 'inspection', 'request'],
    ncr: ['عدم مطابقة', 'ncr', 'تقرير عدم مطابقة'],
    site_instruction: ['تعليمات موقع', 'تعليمات', 'instruction'],
    contractor_notice: ['إشعار للمقاول', 'اشعار للمقاول', 'إشعار', 'اشعار', 'notice'],
  },
  inspectionStatus: {
    open: ['مفتوح', 'مفتوحة', 'قيد المراجعة', 'جديد', 'pending'],
    accepted_with_notes: ['مقبول بملاحظات', 'قبول بملاحظات'],
    accepted: ['مقبول', 'معتمد', 'قبول', 'approved'],
    rejected: ['مرفوض', 'رفض'],
    closed: ['مغلق', 'مغلقة', 'تم', 'closed'],
  },
  violationCategory: {
    safety: ['السلامة', 'سلامة'], quality: ['الجودة', 'جودة'], drawings: ['مخالفة المخططات', 'المخططات', 'مخططات'],
    code: ['مخالفة الكود', 'الكود', 'كود'], license_terms: ['مخالفة شروط الرخصة', 'شروط الرخصة', 'الرخصة'],
    environment: ['البيئة', 'بيئة'], road_occupancy: ['إشغال الطريق', 'اشغال الطريق', 'الطريق'],
  },
  severity: { minor: ['بسيطة', 'بسيط', 'low'], moderate: ['متوسطة', 'متوسط', 'medium'], major: ['جسيمة', 'جسيم', 'عالية', 'high', 'critical'] },
  violationStatus: {
    open: ['مفتوحة', 'مفتوح', 'جديدة'], correcting: ['قيد التصحيح', 'جاري التصحيح'], corrected: ['مصححة', 'تم التصحيح'],
    closed: ['مغلقة', 'مغلق'], escalated: ['مصعّدة للجهة المختصة', 'مصعدة', 'مصعّدة', 'تصعيد'],
  },
  riskStatus: { open: ['مفتوحة', 'مفتوح', 'قائمة'], mitigating: ['قيد المعالجة', 'معالجة'], closed: ['مغلقة', 'مغلق', 'منتهية'] },
  permitKind: {
    building_permit: ['رخصة بناء', 'رخصة البناء'], balady_service: ['طلب خدمة بلدي', 'بلدي'],
    civil_defense: ['موافقة الدفاع المدني', 'الدفاع المدني', 'دفاع مدني'], completion_certificate: ['شهادة إتمام البناء', 'إتمام البناء', 'اتمام'],
    occupancy_certificate: ['شهادة الإشغال', 'الإشغال', 'اشغال'], supervision_contract: ['عقد الإشراف', 'عقد الاشراف', 'عقد'],
    permit: ['تصريح', 'تصاريح'],
  },
  invoiceStatus: {
    preparing: ['قيد الإعداد', 'قيد الاعداد', 'إعداد'], submitted: ['مقدَّم', 'مقدم', 'مُقدم'], approved: ['معتمد'],
    paid: ['مدفوع', 'تم الدفع'], rejected: ['مرفوض'],
  },
  workStatus: {
    not_started: ['لم يبدأ', 'لم تبدأ'], in_progress: ['جاري', 'قيد التنفيذ', 'جارٍ'], completed: ['مكتمل', 'منتهي', 'تم'],
    on_hold: ['متوقف', 'معلق'],
  },
  actionStatus: { open: ['مفتوح', 'جديد'], in_progress: ['جاري', 'قيد التنفيذ'], done: ['تم', 'منجز', 'مغلق'], cancelled: ['ملغى', 'ملغي'] },
} as const;

// مراحل تنتهي بفحص "قبل الصب"
const POUR_GATE = /(أساس|قواعد|ميد|رقاب|هيكل|خرسان|سقف|أسقف|صب|بلاطة)/;

// ---------------------------------------------------------------------
// التحويل
// ---------------------------------------------------------------------
export function mapExport(data: Record<string, unknown>): Mapped {
  const tables: Record<string, Row[]> = Object.fromEntries(TABLE_ORDER.map((t) => [t, []]));
  const rejected: Rejected[] = [];
  const warnings: string[] = [];
  const photos: Mapped['photos'] = [];
  const list = (k: string): Row[] => {
    const v = data[k];
    if (v === undefined) { warnings.push(`المفتاح "${k}" غير موجود في الملف`); return []; }
    if (Array.isArray(v)) return v as Row[];
    if (v && typeof v === 'object') return Object.entries(v as Record<string, Row>).map(([id, r]) => ({ id, ...r }));
    warnings.push(`المفتاح "${k}" ليس قائمة`); return [];
  };
  const reject = (key: string, index: number, r: Row, reason: string) =>
    rejected.push({ key, index, id: str(pick(r, 'id')) ?? undefined, reason });
  const seen = new Map<string, Set<string>>();
  const unique = (table: string, id: string) => {
    const s = seen.get(table) ?? new Set<string>(); seen.set(table, s);
    if (s.has(id)) return false; s.add(id); return true;
  };
  let autoId = 0;
  const idOf = (r: Row, prefix: string) => str(pick(r, 'id', '_id', 'uid', 'key')) ?? `imp-${prefix}-${++autoId}`;

  // --- المراحل ---
  const stageRows = list('stages');
  const stages: Row[] = [];
  stageRows.forEach((r, i) => {
    const name = str(pick(r, 'name', 'title', 'stage', 'label'));
    const weight = num(pick(r, 'weight', 'percent', 'pct', 'ratio', 'الوزن'));
    if (!name) return reject('stages', i, r, 'اسم المرحلة مفقود');
    if (weight === null || weight < 0 || weight > 100) return reject('stages', i, r, 'الوزن مفقود أو خارج 0–100');
    const id = idOf(r, 'stage');
    if (!unique('stages', id)) return reject('stages', i, r, 'معرّف مكرر');
    const explicitGate = pick(r, 'isPourGate', 'pourGate', 'beforePour');
    stages.push({ id, name, weight, sort_order: int(pick(r, 'order', 'sort', 'sortOrder', 'index', 'seq')) ?? i + 1,
      is_pour_gate: explicitGate !== undefined ? Boolean(explicitGate) : POUR_GATE.test(name) });
  });
  stages.sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  stages.forEach((s, i) => { s.sort_order = i + 1; });   // ترتيب متصل بلا تكرار
  const total = stages.reduce((a, s) => a + Number(s.weight), 0);
  if (stages.length && Math.abs(total - 100) > 0.001) {
    warnings.push(`مجموع أوزان المراحل ${total} وليس 100 — رُفض استيراد المراحل؛ صحّح الملف أو شغّل بالخيار --normalize-weights`);
  }
  tables.stages = stages;
  const stageRef = (v: unknown): string | null => {
    const s = str(v); if (!s) return null;
    const byId = stages.find((x) => x.id === s); if (byId) return byId.id as string;
    const byName = stages.find((x) => x.name === s); if (byName) return byName.id as string;
    const n = int(s); const byOrder = n !== null ? stages.find((x) => x.sort_order === n) : undefined;
    return (byOrder?.id as string) ?? null;
  };

  // --- مديرو القسم ---
  list('deptManagers').forEach((r, i) => {
    const name = str(pick(r, 'name', 'fullName'));
    if (!name) return reject('deptManagers', i, r, 'الاسم مفقود');
    const id = idOf(r, 'dm');
    if (!unique('dept_managers', id)) return reject('deptManagers', i, r, 'معرّف مكرر');
    tables.dept_managers.push({ id, name, email: str(pick(r, 'email', 'mail')),
      department: enumOf(DICT.department, pick(r, 'department', 'dept', 'section')) });
  });

  // --- المشاريع ---
  const projectIds = new Set<string>();
  list('projects').forEach((r, i) => {
    const name = str(pick(r, 'name', 'projectName', 'title'));
    if (!name) return reject('projects', i, r, 'اسم المشروع مفقود');
    const id = idOf(r, 'project');
    if (!unique('projects', id)) return reject('projects', i, r, 'معرّف مكرر');
    const rawStatus = pick(r, 'status', 'state');
    const status = enumOf(DICT.projectStatus, rawStatus) ?? 'ongoing';
    if (rawStatus !== undefined && !enumOf(DICT.projectStatus, rawStatus)) warnings.push(`مشروع ${id}: حالة غير معروفة "${rawStatus}" → استمرار`);
    const rawStage = pick(r, 'stageId', 'currentStage', 'stage', 'phase');
    const stageId = stageRef(rawStage);
    if (rawStage !== undefined && !stageId) warnings.push(`مشروع ${id}: مرحلة غير معروفة "${rawStage}"`);
    projectIds.add(id);
    tables.projects.push({
      id, name,
      owner_name: str(pick(r, 'owner', 'ownerName', 'client')),
      project_no: str(pick(r, 'projectNo', 'number', 'no', 'code', 'projectNumber')),
      department: enumOf(DICT.department, pick(r, 'department', 'dept', 'section')),
      license_no: str(pick(r, 'licenseNo', 'license', 'permitNo', 'licence')),
      request_no: str(pick(r, 'requestNo', 'request', 'orderNo')),
      service_no: str(pick(r, 'serviceNo', 'service')),
      status, current_stage_id: stageId,
      stage_detail: str(pick(r, 'stageDetail', 'stageDetails', 'phaseDetail', 'detail')),
      supervision_mode: enumOf(DICT.mode, pick(r, 'supervisionMode', 'mode', 'supervision', 'type')) ?? 'full_staff',
      invoice_type: str(pick(r, 'invoiceType', 'billingType', 'claimType')),
      manual_progress: clamp(num(pick(r, 'manualProgress', 'progressOverride', 'manualPct')), 0, 100),
      last_update_date: date(pick(r, 'lastUpdate', 'lastUpdateDate', 'updatedAt')),
    });
  });
  const needProject = (key: string, i: number, r: Row): string | null => {
    const p = str(pick(r, 'projectId', 'project', 'project_id', 'pid'));
    if (!p) { reject(key, i, r, 'لا يرتبط بمشروع'); return null; }
    if (!projectIds.has(p)) { reject(key, i, r, `المشروع ${p} غير موجود`); return null; }
    return p;
  };
  const collectPhotos = (r: Row, entity_type: string, entity_id: string, project_id: string, table: string) => {
    const ph = pick(r, 'photos', 'images', 'pics', 'attachments');
    const arr = Array.isArray(ph) ? ph : ph ? [ph] : [];
    for (const p of arr.slice(0, 20)) {
      const src = typeof p === 'string' ? p : str(pick(p as Row, 'url', 'src', 'data', 'dataUrl'));
      if (!src) continue;
      const o = typeof p === 'object' ? (p as Row) : {};
      photos.push({ table, entity_type, entity_id, project_id, source: src,
        taken_at: str(pick(o, 'takenAt', 'time', 'date')), lat: num(pick(o, 'lat', 'latitude')), lng: num(pick(o, 'lng', 'lon', 'longitude')) });
    }
    if (arr.length > 20) warnings.push(`${entity_type} ${entity_id}: ${arr.length} صورة، استُورد أول 20 فقط`);
  };

  // --- المهندسون ---
  const engineerIds = new Set<string>();
  list('engineers').forEach((r, i) => {
    const name = str(pick(r, 'name', 'fullName'));
    if (!name) return reject('engineers', i, r, 'الاسم مفقود');
    const id = idOf(r, 'eng');
    if (!unique('engineers', id)) return reject('engineers', i, r, 'معرّف مكرر');
    engineerIds.add(id);
    tables.engineers.push({ id, name,
      discipline: str(pick(r, 'discipline', 'specialty', 'speciality', 'major')),
      grade: str(pick(r, 'grade', 'classification', 'level', 'rank')),
      sce_no: str(pick(r, 'sceNo', 'membershipNo', 'membership', 'sce')),
      sce_expiry: date(pick(r, 'sceExpiry', 'membershipExpiry', 'expiry')),
      mobile: str(pick(r, 'mobile', 'phone', 'tel')),
      status: enumOf(DICT.engineerStatus, pick(r, 'status')) ?? 'active',
      _email: str(pick(r, 'email', 'mail')) });
  });

  // --- التكليفات ---
  list('assignments').forEach((r, i) => {
    const project_id = needProject('assignments', i, r); if (!project_id) return;
    const engineer_id = str(pick(r, 'engineerId', 'engineer', 'eid'));
    if (!engineer_id || !engineerIds.has(engineer_id)) return reject('assignments', i, r, `المهندس ${engineer_id ?? '؟'} غير موجود`);
    const id = idOf(r, 'asg');
    if (!unique('assignments', id)) return reject('assignments', i, r, 'معرّف مكرر');
    const from = date(pick(r, 'from', 'fromDate', 'start', 'startDate'));
    let to = date(pick(r, 'to', 'toDate', 'end', 'endDate'));
    if (from && to && to < from) { warnings.push(`تكليف ${id}: تاريخ النهاية قبل البداية → أُزيلت النهاية`); to = null; }
    tables.assignments.push({ id, project_id, engineer_id,
      role: enumOf(DICT.role, pick(r, 'role', 'position', 'title')) ?? 'site_engineer',
      allocation_pct: clamp(num(pick(r, 'allocation', 'allocationPct', 'percent', 'pct', 'load')) ?? 100, 1, 100),
      from_date: from, to_date: to });
  });

  // --- التحديثات الأسبوعية ---
  list('updates').forEach((r, i) => {
    const project_id = needProject('updates', i, r); if (!project_id) return;
    const d = date(pick(r, 'date', 'updateDate', 'createdAt'));
    if (!d) return reject('updates', i, r, 'تاريخ التحديث مفقود أو غير صالح');
    const id = idOf(r, 'upd');
    if (!unique('weekly_updates', id)) return reject('updates', i, r, 'معرّف مكرر');
    tables.weekly_updates.push({ id, project_id, update_date: d,
      stage_id: stageRef(pick(r, 'stageId', 'stage', 'phase')),
      status: enumOf(DICT.projectStatus, pick(r, 'status')),
      progress: clamp(num(pick(r, 'progress', 'percent', 'pct')), 0, 100),
      done_text: str(pick(r, 'done', 'achieved', 'accomplished', 'completed', 'work')),
      next_week_plan: str(pick(r, 'plan', 'nextPlan', 'nextWeek', 'nextWeekPlan')),
      obstacles: str(pick(r, 'obstacles', 'issues', 'blockers', 'problems')),
      labor_count: int(pick(r, 'labor', 'labour', 'workers', 'manpower', 'laborCount')),
      visits_count: int(pick(r, 'visits', 'visitsCount', 'visitCount')) });
    collectPhotos(r, 'weekly_update', id, project_id, 'weekly_updates');
  });

  // --- الأعمال ---
  list('works').forEach((r, i) => {
    const project_id = needProject('works', i, r); if (!project_id) return;
    const item = str(pick(r, 'item', 'name', 'title', 'activity', 'description'));
    if (!item) return reject('works', i, r, 'البند مفقود');
    const id = idOf(r, 'work');
    if (!unique('works', id)) return reject('works', i, r, 'معرّف مكرر');
    const ps = date(pick(r, 'plannedStart', 'start', 'startDate'));
    let pe = date(pick(r, 'plannedEnd', 'end', 'endDate', 'finish'));
    if (ps && pe && pe < ps) { warnings.push(`بند ${id}: النهاية قبل البداية → أُزيلت النهاية`); pe = null; }
    const progress = clamp(num(pick(r, 'progress', 'actualProgress', 'percent', 'pct')), 0, 100) ?? 0;
    tables.works.push({ id, project_id, item,
      discipline: str(pick(r, 'discipline', 'specialty', 'trade')),
      location: str(pick(r, 'location', 'floor', 'zone', 'level')),
      planned_start: ps, planned_end: pe, actual_progress: progress,
      status: enumOf(DICT.workStatus, pick(r, 'status')) ?? (progress >= 100 ? 'completed' : progress > 0 ? 'in_progress' : 'not_started'),
      executor: str(pick(r, 'executor', 'contractor', 'subcontractor', 'by')) });
  });

  // --- طلبات الفحص ---
  list('inspections').forEach((r, i) => {
    const project_id = needProject('inspections', i, r); if (!project_id) return;
    const description = str(pick(r, 'description', 'desc', 'details', 'title', 'subject'));
    if (!description) return reject('inspections', i, r, 'الوصف مفقود');
    const id = idOf(r, 'insp');
    if (!unique('inspections', id)) return reject('inspections', i, r, 'معرّف مكرر');
    const status = enumOf(DICT.inspectionStatus, pick(r, 'status')) ?? 'open';
    tables.inspections.push({ id, project_id,
      kind: enumOf(DICT.inspectionKind, pick(r, 'kind', 'type', 'category')) ?? 'inspection_request',
      ref_no: str(pick(r, 'refNo', 'number', 'no', 'serial')),
      stage_id: stageRef(pick(r, 'stageId', 'stage', 'phase')), description,
      reference: str(pick(r, 'reference', 'ref', 'code', 'codeRef')),
      addressed_to: str(pick(r, 'addressedTo', 'to', 'party', 'recipient')),
      status, closed_at: date(pick(r, 'closedAt', 'closeDate', 'closed', 'closingDate')) });
    collectPhotos(r, 'inspection', id, project_id, 'inspections');
  });

  // --- المحاضر وبنود المتابعة ---
  list('meetings').forEach((r, i) => {
    const project_id = needProject('meetings', i, r); if (!project_id) return;
    const d = date(pick(r, 'date', 'meetingDate'));
    if (!d) return reject('meetings', i, r, 'تاريخ الاجتماع مفقود');
    const id = idOf(r, 'mtg');
    if (!unique('meetings', id)) return reject('meetings', i, r, 'معرّف مكرر');
    const att = pick(r, 'attendees', 'attendance', 'participants');
    const attendees = Array.isArray(att) ? att.map((a) => (typeof a === 'string' ? { name: a } : a))
      : typeof att === 'string' ? att.split(/[،,\n]/).map((s) => s.trim()).filter(Boolean).map((name) => ({ name })) : [];
    tables.meetings.push({ id, project_id, kind: str(pick(r, 'kind', 'type')), meeting_date: d,
      meeting_no: str(pick(r, 'number', 'no', 'meetingNo')), location: str(pick(r, 'location', 'place')),
      attendees, agenda: str(pick(r, 'agenda')), decisions: str(pick(r, 'decisions', 'outcomes', 'minutes')) });
    const actions = pick(r, 'actions', 'followUps', 'followups', 'items', 'tasks');
    (Array.isArray(actions) ? (actions as Row[]) : []).forEach((a, j) => {
      const item = str(pick(a, 'item', 'title', 'task', 'description'));
      if (!item) return reject('meetings.actions', j, a, `بند متابعة بلا نص في الاجتماع ${id}`);
      const aid = str(pick(a, 'id')) ?? `${id}-a${j + 1}`;
      if (!unique('meeting_actions', aid)) return reject('meetings.actions', j, a, 'معرّف مكرر');
      tables.meeting_actions.push({ id: aid, meeting_id: id, project_id, item,
        owner: str(pick(a, 'owner', 'responsible', 'assignee', 'by')),
        due_date: date(pick(a, 'due', 'dueDate', 'date', 'deadline')),
        status: enumOf(DICT.actionStatus, pick(a, 'status')) ?? 'open' });
    });
  });

  // --- المخالفات ---
  list('violations').forEach((r, i) => {
    const project_id = needProject('violations', i, r); if (!project_id) return;
    const description = str(pick(r, 'description', 'desc', 'details', 'title'));
    if (!description) return reject('violations', i, r, 'الوصف مفقود');
    const category = enumOf(DICT.violationCategory, pick(r, 'category', 'type', 'kind'));
    if (!category) return reject('violations', i, r, `فئة غير معروفة "${pick(r, 'category', 'type', 'kind') ?? ''}"`);
    const id = idOf(r, 'vio');
    if (!unique('violations', id)) return reject('violations', i, r, 'معرّف مكرر');
    tables.violations.push({ id, project_id, category,
      severity: enumOf(DICT.severity, pick(r, 'severity', 'level', 'grade')) ?? 'moderate',
      violator: str(pick(r, 'violator', 'party', 'offender', 'responsible')), description,
      reference: str(pick(r, 'reference', 'ref', 'code')),
      corrective_action: str(pick(r, 'correctiveAction', 'action', 'correction', 'remedy')),
      deadline: date(pick(r, 'deadline', 'dueDate', 'due', 'correctionDeadline')),
      status: enumOf(DICT.violationStatus, pick(r, 'status')) ?? 'open' });
    collectPhotos(r, 'violation', id, project_id, 'violations');
  });

  // --- المخاطر ---
  list('risks').forEach((r, i) => {
    const project_id = needProject('risks', i, r); if (!project_id) return;
    const title = str(pick(r, 'title', 'risk', 'name', 'description'));
    if (!title) return reject('risks', i, r, 'وصف المخاطرة مفقود');
    const p = int(pick(r, 'probability', 'likelihood', 'prob', 'p'));
    const im = int(pick(r, 'impact', 'severity', 'i'));
    if (!p || !im || p < 1 || p > 5 || im < 1 || im > 5) return reject('risks', i, r, 'الاحتمال أو الأثر خارج 1–5');
    const id = idOf(r, 'risk');
    if (!unique('risks', id)) return reject('risks', i, r, 'معرّف مكرر');
    tables.risks.push({ id, project_id, title, probability: p, impact: im,
      category: str(pick(r, 'category', 'type')), reference: str(pick(r, 'reference', 'ref')),
      owner: str(pick(r, 'owner', 'responsible')), treatment: str(pick(r, 'treatment', 'mitigation', 'response')),
      due_date: date(pick(r, 'dueDate', 'due', 'date', 'deadline')),
      status: enumOf(DICT.riskStatus, pick(r, 'status')) ?? 'open' });
  });

  // --- التراخيص ---
  list('permits').forEach((r, i) => {
    const project_id = needProject('permits', i, r); if (!project_id) return;
    const kind = enumOf(DICT.permitKind, pick(r, 'kind', 'type', 'name', 'title'));
    if (!kind) return reject('permits', i, r, `نوع ترخيص غير معروف "${pick(r, 'kind', 'type', 'name') ?? ''}"`);
    const id = idOf(r, 'permit');
    if (!unique('permits', id)) return reject('permits', i, r, 'معرّف مكرر');
    const issue = date(pick(r, 'issueDate', 'issued', 'issue', 'from'));
    let expiry = date(pick(r, 'expiryDate', 'expiry', 'expires', 'to', 'end'));
    if (issue && expiry && expiry < issue) { warnings.push(`ترخيص ${id}: الانتهاء قبل الإصدار → أُزيل الانتهاء`); expiry = null; }
    tables.permits.push({ id, project_id, kind, number: str(pick(r, 'number', 'no', 'permitNo')),
      issue_date: issue, expiry_date: expiry, notes: str(pick(r, 'notes', 'note', 'remarks')) });
  });

  // --- المستخلصات ---
  list('invoices').forEach((r, i) => {
    const project_id = needProject('invoices', i, r); if (!project_id) return;
    const id = idOf(r, 'inv');
    if (!unique('invoices', id)) return reject('invoices', i, r, 'معرّف مكرر');
    const amount = num(pick(r, 'amount', 'value', 'total', 'amountSar'));
    if (amount !== null && amount < 0) return reject('invoices', i, r, 'قيمة سالبة');
    const period = str(pick(r, 'period'));
    const [pf, pt] = (period?.match(/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.]\d{1,2}[/.]\d{4}/g) ?? []).map(date);
    tables.invoices.push({ id, project_id, number: str(pick(r, 'number', 'no', 'invoiceNo')),
      kind: str(pick(r, 'kind', 'type')),
      period_from: date(pick(r, 'periodFrom', 'from')) ?? pf ?? null, period_to: date(pick(r, 'periodTo', 'to')) ?? pt ?? null,
      amount_sar: amount, submitted_at: date(pick(r, 'submittedAt', 'submitDate', 'date')),
      status: enumOf(DICT.invoiceStatus, pick(r, 'status')) ?? 'preparing' });
  });

  return { tables, rejected, warnings, photos };
}

/** يعيد توزيع الأوزان نسبياً لتصبح 100 بالضبط (للخيار --normalize-weights) */
export function normalizeWeights(stages: Row[]): void {
  const total = stages.reduce((a, s) => a + Number(s.weight), 0);
  if (!total) return;
  let acc = 0;
  stages.forEach((s, i) => {
    const w = i === stages.length - 1 ? Math.round((100 - acc) * 100) / 100 : Math.round((Number(s.weight) / total) * 10000) / 100;
    s.weight = w; acc += w;
  });
}
