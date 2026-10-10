// Renders design boards to PNG: node preview/board.mjs AdmReceipts AdmReceiptsPhone …  → preview/shots/board-<Name>.png
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? '/opt/node-tools/node_modules/playwright/index.mjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const canvas = path.resolve(here, '../../docs/canvas');
const out = path.join(here, 'shots'); fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const n of process.argv.slice(2)) {
  const file = path.join(canvas, `${n}.dc.html`);
  if (!fs.existsSync(file)) { console.log(`missing ${n}`); continue; }
  const m = fs.readFileSync(file, 'utf8').match(/"\$preview":\{"width":(\d+),"height":(\d+)\}/);
  await page.setViewportSize({ width: +m[1], height: +m[2] });
  await page.goto(`file://${file}`, { waitUntil: 'load', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
  const png = path.join(out, `board-${n}.png`);
  await page.screenshot({ path: png, fullPage: true });
  console.log(png, `${m[1]}x${m[2]}`);
}
await browser.close();
