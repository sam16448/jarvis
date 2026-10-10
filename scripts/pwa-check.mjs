// Check the production build: manifest, service worker, offline reload.
import { chromium } from '@playwright/test';
const url = process.argv[2] ?? 'http://127.0.0.1:4174/';
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(url);
const manifest = await page.evaluate(async () => { const l = document.querySelector('link[rel="manifest"]'); return l ? (await fetch(l.href)).json() : null; });
console.log('manifest:', manifest?.name, manifest?.display, manifest?.icons?.length, 'icons');
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.waitForFunction(() => !!navigator.serviceWorker.controller);
console.log('service worker controlling page:', await page.evaluate(() => !!navigator.serviceWorker.controller));
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector('.top .brand');
console.log('offline reload ok:', await page.textContent('.top .brand'));
await browser.close();
