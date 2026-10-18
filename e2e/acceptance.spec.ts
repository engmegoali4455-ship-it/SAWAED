// سيناريو القبول الكامل:
// مهندس يسجّل من الموقع دون إنترنت تحديثاً أسبوعياً بصور، وطلب فحص، ومخالفة جسيمة.
// بعد عودة الاتصال يظهر كل ذلك في لوحة مدير القسم خلال ثوانٍ، ويصل الإشعار، ويتضمنه التقرير الأسبوعي.
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SB_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const service = () => createClient(SB_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PASSWORD = 'Sawaed#2026';
const STAMP = Date.now().toString(36);
const VIOLATION = `سقالة بلا حماية جانبية ${STAMP}`;
const UPDATE = `صب الميدات وفك الشدة ${STAMP}`;
const INSPECTION = `فحص حديد الميدات قبل الصب ${STAMP}`;

const badge = (p: Page) => p.locator('a[title="حالة المزامنة"]:visible');

async function login(browser: Browser, email: string, width: number) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, geolocation: { latitude: 24.7136, longitude: 46.6753 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  await page.goto('/login/');
  await page.getByLabel('البريد الإلكتروني').fill(email);
  await page.getByLabel('كلمة المرور').fill(PASSWORD);
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL('**/');
  await expect(badge(page)).toHaveText('محدّث', { timeout: 30_000 });
  return { ctx, page };
}

async function noHorizontalScroll(page: Page) {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw, `horizontal scroll on ${page.url()}`).toBeLessThanOrEqual(cw);
}

test('offline field entry reaches the department manager, notifications and the weekly report', async ({ browser }) => {
  // ---- المهندس (جوال 360px) ----
  const eng = await login(browser, 'reem@sawaed.test', 360);
  // تثبيت Service Worker ليعمل التنقل دون اتصال
  await eng.page.evaluate(() => navigator.serviceWorker.ready);
  await eng.page.reload();
  await expect(badge(eng.page)).toHaveText('محدّث', { timeout: 30_000 });
  await expect.poll(() => eng.page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // ---- مدير القسم (لابتوب) على لوحة القيادة ----
  const dept = await login(browser, 'dept@sawaed.test', 1280);
  await expect(dept.page.getByText(VIOLATION)).toHaveCount(0);

  // ---- انقطاع الاتصال ----
  await eng.ctx.setOffline(true);
  await expect(badge(eng.page)).toHaveText('دون اتصال');

  // 1) تحديث أسبوعي بصورتين
  await eng.page.getByRole('link', { name: 'تحديث أسبوعي' }).first().click();
  await expect(eng.page.getByRole('heading', { name: 'إضافة تحديث أسبوعي' })).toBeVisible();
  await eng.page.getByLabel('المنجز هذا الأسبوع').fill(UPDATE);
  await eng.page.getByLabel('خطة الأسبوع القادم').fill('بدء أعمدة الدور الأرضي');
  await eng.page.getByLabel('العمالة').fill('26');
  await eng.page.locator('input[type=file]').setInputFiles([path.join(__dirname, 'fixtures/site1.jpg'), path.join(__dirname, 'fixtures/site2.jpg')]);
  await expect(eng.page.locator('img[src^="blob:"]')).toHaveCount(2);
  await noHorizontalScroll(eng.page);
  await eng.page.getByRole('button', { name: 'حفظ' }).click();
  await expect(eng.page.getByText(UPDATE)).toBeVisible();
  await expect(eng.page.getByText('بانتظار المزامنة').first()).toBeVisible();

  // 2) طلب فحص
  await eng.page.goto('/entry/?t=inspections&p=p1');
  await eng.page.getByLabel('الوصف').fill(INSPECTION);
  await eng.page.getByRole('button', { name: 'SBC 304' }).click();
  await expect(eng.page.getByLabel('المرجع')).toHaveValue('SBC 304');
  await eng.page.getByRole('button', { name: 'حفظ' }).click();
  await expect(eng.page.getByText(INSPECTION)).toBeVisible();

  // 3) مخالفة جسيمة
  await eng.page.goto('/entry/?t=violations&p=p1');
  await eng.page.getByLabel('الفئة').selectOption('safety');
  await eng.page.getByLabel('الخطورة').selectOption('major');
  await eng.page.getByLabel('الوصف').fill(VIOLATION);
  await eng.page.getByRole('button', { name: 'حفظ' }).click();
  await expect(eng.page.getByText(VIOLATION)).toBeVisible();

  // كل شيء محفوظ محلياً، ولم يصل الخادم بعد
  const pending = await eng.page.evaluate(async () => new Promise<number>((res) => {
    const r = indexedDB.open('sawaed'); r.onsuccess = () => { const q = r.result.transaction('outbox').objectStore('outbox').count(); q.onsuccess = () => res(q.result); };
  }));
  expect(pending).toBeGreaterThanOrEqual(7); // تحديث + 2×(رفع+صورة) + فحص + مخالفة
  const { data: before } = await service().from('violations').select('id').eq('description', VIOLATION);
  expect(before).toHaveLength(0);

  // ---- عودة الاتصال ----
  const back = Date.now();
  await eng.ctx.setOffline(false);
  await eng.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(badge(eng.page)).toHaveText('محدّث', { timeout: 30_000 });

  // يظهر في لوحة مدير القسم خلال ثوانٍ (بث لحظي، دون إعادة تحميل)
  await expect(dept.page.getByText(VIOLATION, { exact: false })).toBeVisible({ timeout: 15_000 });
  const seconds = (Date.now() - back) / 1000;
  console.log(`ظهرت المخالفة في لوحة مدير القسم بعد ${seconds.toFixed(1)} ثانية من عودة الاتصال`);
  expect(seconds).toBeLessThan(15);

  // الخادم: السجلات، الصور مرفوعة ومضغوطة ومعها GPS، والتحديث المتسلسل
  const sb = service();
  const { data: v } = await sb.from('violations').select('id, created_by').eq('description', VIOLATION).single();
  const { data: u } = await sb.from('weekly_updates').select('id, labor_count').eq('done_text', UPDATE).single();
  expect(u!.labor_count).toBe(26);
  const { data: ph } = await sb.from('photos').select('storage_path, lat, lng').eq('entity_id', u!.id);
  expect(ph).toHaveLength(2);
  expect(ph!.every((p) => Math.abs(p.lat - 24.7136) < 0.01)).toBe(true);
  const blob = (await sb.storage.from('photos').download(ph![0].storage_path)).data!;
  expect(blob.size).toBeLessThan(1_000_000);
  const { data: proj } = await sb.from('projects').select('last_update_date').eq('id', 'p1').single();
  expect(proj!.last_update_date).toBe(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date()));

  // الإشعار الفوري لمدير المشروع ومدير القسم
  const { data: notes } = await sb.from('notifications').select('user_id, kind').eq('entity_id', v!.id);
  expect(notes!.filter((n) => n.kind === 'major_violation')).toHaveLength(2);
  await dept.page.goto('/alerts/');
  await dept.page.getByRole('tab', { name: /الإشعارات/ }).click();
  await expect(dept.page.getByText(/مخالفة جسيمة — فيلا الياسمين/).first()).toBeVisible();

  // التقرير الأسبوعي يتضمن ما سُجّل (يولّده مدير المشروع)
  const pm = createClient(SB_URL, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await pm.auth.signInWithPassword({ email: 'fahad@sawaed.sa', password: PASSWORD });
  const { data: reportId, error } = await pm.rpc('generate_weekly_report', { p_project_id: 'p1' });
  expect(error).toBeNull();
  const { data: rep } = await sb.from('weekly_reports').select('snapshot').eq('id', reportId).single();
  const snap = rep!.snapshot as any;
  expect(snap.violations.some((x: any) => x.description === VIOLATION)).toBe(true);
  expect(snap.inspections.some((x: any) => x.description === INSPECTION)).toBe(true);
  expect(snap.updates.some((x: any) => x.done_text === UPDATE)).toBe(true);
  expect(snap.photos.length).toBeGreaterThanOrEqual(2);

  // ملف PDF من الخادم (إن كانت دالة render-pdf تعمل محلياً)
  const fnUrl = process.env.RENDER_PDF_URL;
  if (fnUrl) {
    const token = (await pm.auth.getSession()).data.session!.access_token;
    const res = await fetch(fnUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'weekly_report', id: reportId }) });
    expect(res.ok).toBe(true);
    const { url } = await res.json();
    const pdf = new Uint8Array(await (await fetch(url)).arrayBuffer());
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
    const imageCount = (new TextDecoder('latin1').decode(pdf).match(/\/Subtype\s*\/Image/g) ?? []).length;
    expect(imageCount).toBeGreaterThanOrEqual(3); // الشعار + صورتا الموقع
    mkdirSync('test-results', { recursive: true }); writeFileSync('test-results/acceptance-weekly-report.pdf', pdf);
  }
  await eng.ctx.close(); await dept.ctx.close();
});
