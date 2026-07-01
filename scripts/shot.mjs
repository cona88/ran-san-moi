// Parametrized screenshot helper for multi-viewport QA (not part of the build).
// Usage: CONFIG='{"viewport":{"width":..,"height":..},"isMobile":true,"hasTouch":true,"deviceScaleFactor":2}' OUT=/path/base.png node scripts/shot.mjs
import { chromium } from '@playwright/test';

const config = JSON.parse(process.env.CONFIG ?? '{"viewport":{"width":1280,"height":720}}');
const out = process.env.OUT ?? 'shot.png';
const url = process.env.URL ?? 'http://localhost:4173/';

const browser = await chromium.launch();
const context = await browser.newContext(config);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(url);
await page.waitForSelector('#app canvas');
await page.waitForTimeout(600);
await page.screenshot({ path: out.replace(/\.png$/, '-ready.png') });

await page.keyboard.press('Space').catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ path: out.replace(/\.png$/, '-play.png') });

await browser.close();
console.log(JSON.stringify({ out, errors }));
