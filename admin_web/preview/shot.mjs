// Screenshots of the preview: node preview/shot.mjs <name> <path> [widths=1440,834,390] [--full] [--as=platform] [--state=empty] [--click=<selector>]
// Writes preview/shots/<name>-<width>.png (git-ignored). Needs the preview server on :5190.
// In <path>, ":c" stands for the sample company's id.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? '/opt/node-tools/node_modules/playwright/index.mjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const [name, route = '/', widths = '1440,834,390'] = args.filter((a) => !a.startsWith('--'));
const out = path.join(here, 'shots'); fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const w of String(widths).split(',')) {
  const page = await browser.newPage({ viewport: { width: +w, height: +w < 640 ? 844 : 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.text().includes('[preview]')) errors.push(m.text()); });
  const q = new URLSearchParams({ as: flags.as ?? 'company', state: flags.state ?? '' });
  await page.goto(`http://localhost:5190/?${q}`, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const target = route.replace(':c', '11111111-1111-4111-8111-111111111111');
  await page.goto(`http://localhost:5190${target}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(+(flags.wait ?? 1200));
  if (flags.click) { await page.locator(flags.click).first().click().catch((e) => errors.push('click: ' + e.message)); await page.waitForTimeout(800); }
  const file = path.join(out, `${name}-${w}.png`);
  await page.screenshot({ path: file, fullPage: !!flags.full });
  console.log(file, errors.length ? `\n  ERRORS: ${[...new Set(errors)].slice(0, 6).join('\n  ')}` : '');
  await page.close();
}
await browser.close();
