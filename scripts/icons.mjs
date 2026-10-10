// Render the app icon (SVG) to PNGs with Chrome. Usage: node scripts/icons.mjs
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const svg = (size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#0f1113"/>
  <g transform="translate(${pad} ${pad}) scale(${(100 - 2 * pad) / 100})">
    <rect x="22" y="24" width="56" height="54" rx="9" fill="none" stroke="#eceef0" stroke-width="5.5"/>
    <line x1="22" y1="38" x2="78" y2="38" stroke="#eceef0" stroke-width="5.5"/>
    <line x1="36" y1="17" x2="36" y2="29" stroke="#eceef0" stroke-width="5.5" stroke-linecap="round"/>
    <line x1="64" y1="17" x2="64" y2="29" stroke="#eceef0" stroke-width="5.5" stroke-linecap="round"/>
    <path d="M38 57 l8 8 l16 -16" fill="none" stroke="#66bf91" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
writeFileSync('public/icons/icon.svg', svg(100, 0));
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage();
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['maskable-512.png', 512, 12], ['apple-touch-icon.png', 180, 6]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg(size, pad)}</body></html>`);
  await page.screenshot({ path: `public/icons/${name}`, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log('icons written');
