// One-off screenshot capture for the README. Not part of the build.
import { chromium } from '@playwright/test';

const URL = process.env.URL ?? 'http://localhost:4173/';
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 2,
});

await page.goto(URL);
await page.waitForSelector('#app canvas');

// Ready-screen hero (title + neon board).
await page.waitForTimeout(600);
await page.screenshot({ path: 'docs/media/ready.png' });

// In-game shot: start, make a couple of safe central turns, then capture.
await page.keyboard.press('Space');
await page.waitForTimeout(600);
await page.keyboard.press('ArrowUp');
await page.waitForTimeout(320);
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(320);
await page.screenshot({ path: 'docs/media/gameplay.png' });

await browser.close();
console.log('captured docs/media/ready.png and docs/media/gameplay.png');
