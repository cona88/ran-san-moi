import { expect, test, type Page } from '@playwright/test';

const overlay = (page: Page) => page.locator('#overlay');
const cta = (page: Page) => page.locator('#cta');
const title = (page: Page) => page.locator('#overlay .title');

test('boots, renders a canvas and shows the ready screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/');

  await expect(page.locator('#app canvas')).toBeVisible();
  await expect(overlay(page)).not.toHaveClass(/hidden/);
  await expect(cta(page)).toHaveText(/start/i);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('SPACE starts the game and hides the overlay', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Space');
  await expect(overlay(page)).toHaveClass(/hidden/);
});

test('P pauses and resumes', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Space');
  await expect(overlay(page)).toHaveClass(/hidden/);

  await page.keyboard.press('p');
  await expect(overlay(page)).not.toHaveClass(/hidden/);
  await expect(title(page)).toHaveText('PAUSED');

  await page.keyboard.press('p');
  await expect(overlay(page)).toHaveClass(/hidden/);
});

test('crashes into the wall, then restarts', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Space');

  // The snake auto-travels right; doing nothing drives it into the wall.
  await expect(cta(page)).toHaveText(/play again/i, { timeout: 12_000 });
  await expect(title(page)).toHaveText(/game over|you win/i);

  // best score is persisted on game over
  const best = await page.evaluate(() => localStorage.getItem('neonSnakeBest'));
  expect(best).not.toBeNull();
  expect(Number(best)).toBeGreaterThanOrEqual(0);

  await page.keyboard.press('Space');
  await expect(overlay(page)).toHaveClass(/hidden/);
});
