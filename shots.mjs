// Headless screenshot harness (dev tool, not part of the build).
// Boots dist/hairline.html in Chromium with SwiftShader WebGL2, places the camera at named
// viewpoints through the window.__hairline debug handle and writes PNGs.
//
// Usage: node tools/shots.mjs <outDir> <shots.json>
//   shots.json: [{ "name", "map", "pos":[x,y,z], "yaw", "pitch", "hud":false, "weapon":"halberd", "ads":0 }]
// Requires Playwright (dev only). Not imported by the game.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  ({ chromium } = require('/opt/npm-tools/node_modules/playwright'));
}

const [, , outDir = 'shots', specPath] = process.argv;
const shots = JSON.parse(readFileSync(specPath, 'utf8'));
mkdirSync(outDir, { recursive: true });
const file = 'file://' + resolve('dist/hairline.html') + '?manual';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: +(process.env.W || 1280), height: +(process.env.H || 720) } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
if (process.env.MAP) {
  // Boot a specific map: seed the saved profile before the page scripts run.
  await page.addInitScript((map) => {
    try {
      const k = 'hairline.v1';
      const p = JSON.parse(localStorage.getItem(k) || '{}');
      p.settings = { ...(p.settings || {}), map };
      localStorage.setItem(k, JSON.stringify(p));
    } catch (e) { /* storage blocked */ }
  }, process.env.MAP);
}
await page.goto(file);
try {
  await page.waitForFunction(() => window.__hairline && window.__hairline.ready, null, { timeout: +(process.env.BOOT_TIMEOUT || 240000), polling: 500 });
} catch (e) {
  const state = await page.evaluate(() => ({ load: document.getElementById('load-text')?.textContent, error: document.getElementById('error-text')?.textContent }));
  console.log('BOOT FAILED', JSON.stringify(state));
  console.log(logs.slice(-30).join('\n'));
  await page.screenshot({ path: `${outDir}/boot_failed.png` });
  await browser.close();
  process.exit(1);
}
const t0boot = Date.now();
console.log(logs.filter((l) => l.includes('[boot]')).join('\n'));
console.log('booted', JSON.stringify(await page.evaluate(() => ({ bake: window.__hairline.client.bakeMs, verts: window.__hairline.client.bakeVerts }))));

for (const s of shots) {
  const t0 = Date.now();
  const info = await page.evaluate(async (s) => window.__hairline.debugShot({ ...s, capture: !s.hud }), s);
  if (info.png) {
    writeFileSync(`${outDir}/${s.name}.png`, Buffer.from(info.png.split(',')[1], 'base64'));
    delete info.png;
  } else {
    await page.waitForTimeout(s.wait || 400);
    await page.screenshot({ path: `${outDir}/${s.name}.png`, timeout: 120000 });
  }
  console.log(`${s.name}: ${Date.now() - t0} ms ${info ? JSON.stringify(info) : ''}`);
}
const errs = logs.filter((l) => /error|warn/i.test(l));
if (errs.length) console.log(errs.slice(0, 20).join('\n'));
await browser.close();
