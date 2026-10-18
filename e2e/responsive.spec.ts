// كل الشاشات تعمل على عرض 360px دون تمرير أفقي، لكل دور، ودون أخطاء في الواجهة.
import { expect, test } from '@playwright/test';

const PAGES: Record<string, string[]> = {
  'dept@sawaed.test': ['/', '/projects/', '/project/?id=p1', '/project/?id=p1&tab=works', '/project/?id=p1&tab=team', '/project/?id=p1&tab=audit',
    '/staffing/', '/reports/', '/alerts/', '/admin/', '/sync/', '/entry/?t=meetings&p=p1', '/entry/?t=risks&p=p1', '/entry/?t=projects&id=p1', '/account/'],
  'reem@sawaed.test': ['/', '/project/?id=p1', '/project/?id=p1&tab=violations', '/entry/?t=weekly_updates&p=p1', '/entry/?t=inspections&p=p1',
    '/entry/?t=works&p=p1', '/entry/?t=permits&p=p1', '/entry/?t=invoices&p=p1', '/reports/', '/alerts/', '/sync/'],
  'owner@sawaed.test': ['/', '/project/?id=p1', '/project/?id=p1&tab=violations', '/reports/'],
};

for (const [email, pages] of Object.entries(PAGES)) {
  test(`360px without horizontal scroll — ${email}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/login/');
    await page.getByLabel('البريد الإلكتروني').fill(email);
    await page.getByLabel('كلمة المرور').fill('Sawaed#2026');
    await page.getByRole('button', { name: 'دخول' }).click();
    await page.waitForURL('**/');
    await expect(page.locator('a[title="حالة المزامنة"]:visible')).toHaveText('محدّث', { timeout: 30_000 });
    for (const p of pages) {
      await page.goto(p);
      await page.waitForTimeout(700);
      const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(sw, `horizontal scroll on ${p}`).toBeLessThanOrEqual(cw);
      const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width) return false;
        let a: Element | null = el.parentElement;   // داخل حاوية تمرير مقصودة (جداول/تبويبات) مقبول
        while (a && a !== document.body) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return false; a = a.parentElement; }
        return r.right > innerWidth + 1 || r.left < -1;
      }).length);
      expect(wide, `elements overflowing viewport on ${p}`).toBe(0);
    }
    expect(errors).toEqual([]);
    await ctx.close();
  });
}
