// التسميات العربية لكل الرموز المخزّنة في قاعدة البيانات

export const PROJECT_STATUS: Record<string, string> = {
  ongoing: 'استمرار', ending_soon: 'قريباً ينتهي', in_process: 'تحت الإجراء', done: 'تم', stopped: 'متوقف',
};
export const DEPARTMENT: Record<string, string> = { architecture: 'المعمارية', consulting: 'الاستشارات' };
export const SUPERVISION_MODE: Record<string, string> = { full_staff: 'طاقم كامل', visits: 'زيارات' };
export const ASSIGNMENT_ROLE: Record<string, string> = {
  project_manager: 'مدير مشروع الإشراف', resident_engineer: 'مهندس مقيم', site_engineer: 'مهندس إشراف',
  visiting_engineer: 'مهندس زيارات', specialist: 'مهندس تخصص',
};
export const ENGINEER_STATUS: Record<string, string> = { active: 'على رأس العمل', on_leave: 'إجازة', inactive: 'غير نشط' };
export const WORK_STATUS: Record<string, string> = {
  not_started: 'لم يبدأ', in_progress: 'قيد التنفيذ', completed: 'مكتمل', on_hold: 'متوقف',
};
export const INSPECTION_KIND: Record<string, string> = {
  inspection_request: 'طلب فحص / استلام مرحلة', ncr: 'تقرير عدم مطابقة (NCR)',
  site_instruction: 'تعليمات موقع', contractor_notice: 'إشعار للمقاول',
};
export const INSPECTION_STATUS: Record<string, string> = {
  open: 'مفتوح', accepted: 'مقبول', accepted_with_notes: 'مقبول بملاحظات', rejected: 'مرفوض', closed: 'مغلق',
};
export const VIOLATION_CATEGORY: Record<string, string> = {
  safety: 'السلامة', quality: 'الجودة', drawings: 'مخالفة المخططات', code: 'مخالفة الكود',
  license_terms: 'مخالفة شروط الرخصة', environment: 'البيئة', road_occupancy: 'إشغال الطريق',
};
export const SEVERITY: Record<string, string> = { minor: 'بسيطة', moderate: 'متوسطة', major: 'جسيمة' };
export const VIOLATION_STATUS: Record<string, string> = {
  open: 'مفتوحة', correcting: 'قيد التصحيح', corrected: 'مصححة', closed: 'مغلقة', escalated: 'مصعّدة للجهة المختصة',
};
export const RISK_LEVEL: Record<string, string> = { high: 'مرتفعة', medium: 'متوسطة', low: 'منخفضة' };
export const RISK_STATUS: Record<string, string> = { open: 'مفتوحة', mitigating: 'قيد المعالجة', closed: 'مغلقة' };
export const PERMIT_KIND: Record<string, string> = {
  building_permit: 'رخصة بناء', balady_service: 'طلب خدمة بلدي', civil_defense: 'موافقة الدفاع المدني',
  completion_certificate: 'شهادة إتمام البناء', occupancy_certificate: 'شهادة الإشغال', permit: 'تصريح',
  supervision_contract: 'عقد الإشراف',
};
export const INVOICE_STATUS: Record<string, string> = {
  preparing: 'قيد الإعداد', submitted: 'مقدَّم', approved: 'معتمد', paid: 'مدفوع', rejected: 'مرفوض',
};
export const ACTION_STATUS: Record<string, string> = { open: 'مفتوح', in_progress: 'قيد التنفيذ', done: 'منجز', cancelled: 'ملغى' };
export const REPORT_STATUS: Record<string, string> = { draft: 'مسودة', approved: 'معتمد', sent: 'مُرسل' };

export const TONE: Record<string, 'red' | 'amber' | 'green' | 'gray' | 'brand'> = {
  // حالات المشروع
  ongoing: 'green', ending_soon: 'amber', in_process: 'brand', done: 'gray', stopped: 'red',
  // عام
  open: 'amber', closed: 'gray', accepted: 'green', accepted_with_notes: 'green', rejected: 'red',
  correcting: 'amber', corrected: 'green', escalated: 'red', mitigating: 'amber',
  major: 'red', moderate: 'amber', minor: 'gray', high: 'red', medium: 'amber', low: 'green',
  preparing: 'gray', submitted: 'amber', approved: 'green', paid: 'green',
  not_started: 'gray', in_progress: 'amber', completed: 'green', on_hold: 'red',
  draft: 'amber', sent: 'green', cancelled: 'gray',
};

// مراجع الكود المقترحة حسب نوع المرحلة (تُطابَق مع اسم المرحلة)؛ القائمة نفسها في جدول code_references
export const STAGE_REFERENCE_HINTS: { match: RegExp; codes: string[] }[] = [
  { match: /(حفر|تجهيز|إحلال|ردم|تربة)/, codes: ['SBC 303', 'SBC 201'] },
  { match: /(أساس|قواعد|رقاب|ميد)/, codes: ['SBC 303', 'SBC 304'] },
  { match: /(هيكل|خرسان|سقف|أسقف|أعمدة|بلاطة)/, codes: ['SBC 304', 'SBC 301', 'SBC 306'] },
  { match: /(مباني|بلك|طوب)/, codes: ['SBC 305', 'SBC 201'] },
  { match: /(تمديد|كهرباء|سباكة|ميكانيك|تكييف)/, codes: ['SBC 401', 'SBC 501', 'SBC 701', 'SBC 702'] },
  { match: /(لياسة|عزل|واجه)/, codes: ['SBC 601/602', 'SBC 201'] },
  { match: /(تشطيب)/, codes: ['SBC 201', 'SBC 801'] },
  { match: /(تسليم|إشغال|اتمام|إتمام)/, codes: ['SBC 801', 'الدفاع المدني', 'بلدي'] },
];
export function suggestedCodes(stageName: string | null | undefined): string[] {
  if (!stageName) return [];
  return [...new Set(STAGE_REFERENCE_HINTS.filter((h) => h.match.test(stageName)).flatMap((h) => h.codes))];
}
