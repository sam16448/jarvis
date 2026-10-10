// Screenshot every screen at iPhone size. Usage: node scripts/shots.mjs [baseUrl] [now]
import { chromium, devices } from '@playwright/test';
const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const now = process.argv[3] ?? '2026-10-12T18:00';
const only = process.argv[4];
const iphone = { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } };
delete iphone.defaultBrowserType;
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const ctx = await browser.newContext({ ...iphone, colorScheme: 'dark' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${base}?now=${now}#/today`);
await page.waitForSelector('.top');
const routes = (only ? only.split(',') : ['/today', '/calendar?v=week', '/calendar?v=day', '/calendar?v=month', '/deadlines', '/exams', '/more']);
for (const r of routes) {
  await page.goto(`${base}#${r}`);
  await page.waitForTimeout(300);
  const name = r.replace(/[\/?=&]+/g, '_').replace(/^_/, '');
  await page.screenshot({ path: `shots/${name}.png` });
  await page.screenshot({ path: `shots/${name}-full.png`, fullPage: true });
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
