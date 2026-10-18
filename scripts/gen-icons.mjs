// يولّد أيقونات PWA/التطبيق من public/logo.svg عبر Chromium
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const svg = readFileSync('public/logo.svg', 'utf8');
const exe = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
const out = [['icons/icon-192.png', 192, 192, 0, 'transparent'], ['icons/icon-512.png', 512, 512, 0, 'transparent'],
  ['icons/maskable-512.png', 512, 360, 0, '#221f1d'], ['icons/apple-touch-icon.png', 180, 180, 0, '#221f1d'], ['icons/icon-1024.png', 1024, 1024, 0, 'transparent']];
for (const [file, size, inner, , bg] of out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${bg};display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px">${svg.replace('<svg', `<svg width="${inner}" height="${inner}"`)}</body></html>`);
  await page.screenshot({ path: `public/${file}`, omitBackground: bg === 'transparent' });
}
await browser.close();
console.log('icons ok');
