// Drives a long random session in headless Chromium, then counts system backs until the app is left.
// Usage: NODE_PATH=$(npm root -g) node tests/e2e/back-nav.mjs [baseUrl], with the repo root served
// (e.g. python3 -m http.server 8765). require, unlike import, honors NODE_PATH.
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.argv[2] ?? 'http://localhost:8765/';
const STEPS = Number(process.env.STEPS ?? 120);

let s = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 7);
const rand = (n) => ((s = (s * 1103515245 + 12345) % 2 ** 31), s % n);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.goto('about:blank');
await page.goto(BASE);
await page.waitForSelector('.view');
// --legacy: entries piled up by a build whose links each pushed one survive an update's reload.
if (process.argv.includes('--legacy')) {
  for (let i = 0; i < 15; i++) await page.evaluate((h) => (location.hash = h), i % 2 ? '#/' : '#/reports');
  await page.reload();
  await page.waitForSelector('.view');
}

const sheetOpen = () => page.locator('.es').count().then((n) => n > 0);
const tap = async (sel) => {
  const el = page.locator(sel).first();
  if (await el.isVisible().catch(() => false)) await el.click({ timeout: 2000 }).catch(() => {});
};

const actions = [
  () => tap('.nav a[href="#/reports"]'),
  () => tap('.nav a[href="#/"]'),
  () => tap('a[href="#/settings"]'),
  () => tap('a[href="#/search"]'),
  () => tap('a[href="#/categories"]'),
  () => tap('header.bar a.ib[aria-label="Back"]'),
  () => page.locator('header.bar a.ib[aria-label="Back"]').first().dblclick({ timeout: 1000 }).catch(() => {}),
  () => page.locator('.nav a[href="#/"]').dblclick({ timeout: 1000 }).catch(() => {}),
  () => tap('.nav .p'),
  () => tap('.es [data-act="cats"]'),
  () => tap('.es [data-act="close"]'),
  () => page.keyboard.press('Escape'),
  async () => {
    const home = await page.evaluate(() => (location.hash || '#/') === '#/' && !history.state);
    if (!home || (await sheetOpen())) await page.goBack({ timeout: 1000 }).catch(() => {});
  },
];

for (let i = 0; i < STEPS; i++) {
  if (!page.url().startsWith(BASE)) break;
  await actions[rand(actions.length)]();
  await page.waitForTimeout(40);
}
if (!page.url().startsWith(BASE)) {
  console.log('left the app mid-session (a back on home): rerun with another seed');
  process.exit(2);
}
while (await sheetOpen()) await page.keyboard.press('Escape'), await page.waitForTimeout(250);
await page.waitForTimeout(300);

const hash = await page.evaluate(() => location.hash || '#/');
const len = await page.evaluate(() => history.length);
let backs = 0;
while (page.url().startsWith(BASE) && backs < 200) {
  await page.goBack({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(60);
  backs++;
}
const expected = hash === '#/' ? 1 : 2;
console.log(`end page ${hash}, history.length ${len}, backs to leave ${backs}, expected ${expected}`);
await browser.close();
process.exit(backs === expected ? 0 : 1);
