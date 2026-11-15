import { expect, test, type Page } from '@playwright/test';

const overlay = (page: Page) => page.locator('#overlay');
const cta = (page: Page) => page.locator('#cta');
const overlayTitle = (page: Page) => page.locator('#overlay .overlay-title');
const formCards = (page: Page) => page.locator('#magic-bar .magic-form-card');
const shieldPill = (page: Page) => page.locator('#hud-top .hud-shield-pill');
const controllerBadge = (page: Page) => page.locator('#hud-top .hud-controller-badge');

function attachErrorWatchers(page: Page): {
  errors: string[];
  apiRequests: string[];
  externalRequests: string[];
} {
  const errors: string[] = [];
  const apiRequests: string[] = [];
  const externalRequests: string[] = [];

  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const locUrl = msg.location().url;
      errors.push(`console.error: ${msg.text()} (${locUrl || 'unknown'})`);
    }
  });
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/')) {
      apiRequests.push(url);
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const { hostname } = new URL(url);
      if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
        externalRequests.push(url);
      }
    }
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      errors.push(`http ${res.status()}: ${res.url()}`);
    }
  });

  return { errors, apiRequests, externalRequests };
}

test('boots cleanly on honeycomb_arena with 3D WebGL canvas and zero offline/console errors', async ({
  page,
}) => {
  const { errors, apiRequests, externalRequests } = attachErrorWatchers(page);

  await page.goto('/');

  const canvas = page.locator('#app canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(200);
  expect(box!.height).toBeGreaterThan(200);

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'honeycomb_arena');
  await expect(page.locator('.magic-ui-shell')).toHaveAttribute('data-theme', 'honeycomb_arena');

  await expect(overlay(page)).not.toHaveClass(/hidden/);
  await expect(overlayTitle(page)).toContainText('Vương Quốc Rắn Phép Thuật 3D');
  await expect(cta(page)).toContainText('Bắt Đầu Phiêu Lưu');
  await expect(page.locator('#player-name-input')).toHaveValue('Bé Tiên');
  await expect(page.locator('#hud-top')).toBeVisible();
  await expect(page.locator('#magic-bar')).toBeVisible();

  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('displays BossBar, clock, bot counter, Leaderboard, 3 Boosters, Crown arrow, and BrainQuest during gameplay', async ({
  page,
}) => {
  const { errors, apiRequests, externalRequests } = attachErrorWatchers(page);

  await page.goto('/');

  // Customize player nickname and select Cozy + Easy for safe quest observation
  const nameInput = page.locator('#player-name-input');
  await nameInput.fill('Công Chúa Mây');
  await page.getByRole('button', { name: /Thư Giãn Xuyên Tường/ }).click();
  await page.getByRole('button', { name: /Dễ \(Làm quen\)/ }).click();

  await cta(page).click();
  await expect(overlay(page)).toHaveClass(/hidden/);

  // BossBar (Lv.)
  const bossBar = page.locator('#boss-bar');
  await expect(bossBar).toBeVisible();
  await expect(bossBar).toContainText('Lv.');
  await expect(bossBar).toContainText('Tiến Trình Boss');

  // Clock + Bot eaten pill + initial level
  await expect(page.locator('#hud-top .hud-timer-pill')).toBeVisible();
  await expect(page.locator('#hud-top .hud-timer-pill')).toHaveText(/⏱️ \d{2}:\d{2}/);
  await expect(page.locator('#hud-top .hud-bots-pill')).toHaveText('🐍 x0');
  await expect(page.locator('#hud-top .hud-level-pill')).toHaveText('Lv.5');

  // Live Leaderboard (1st.. & highlighted player row)
  const leaderboard = page.locator('#leaderboard-panel');
  await expect(leaderboard).toBeVisible();
  await expect(leaderboard).toContainText('1st');
  await expect(leaderboard.locator('.lb-row.is-player')).toContainText('Công Chúa Mây');

  // 3 right-edge Booster buttons (LEVEL, SPEED, MAGNET)
  const boosterButtons = page.locator('#booster-buttons .booster-btn');
  await expect(boosterButtons).toHaveCount(3);
  await expect(page.locator('#booster-buttons [data-booster="level"]')).toContainText('TĂNG CẤP');
  await expect(page.locator('#booster-buttons [data-booster="speed"]')).toContainText('TỐC ĐỘ');
  await expect(page.locator('#booster-buttons [data-booster="magnet"]')).toContainText('NAM CHÂM');

  // Crown radar arrow (👑)
  const crownRadar = page.locator('#crown-radar');
  await expect(crownRadar).toBeVisible();
  await expect(crownRadar).toContainText('👑');

  // BrainQuest banner spawns automatically while playing
  const questBanner = page.locator('#quest-banner');
  await expect(questBanner).toBeVisible({ timeout: 15_000 });
  await expect(questBanner).toContainText('+10 Cấp');

  // Verify nickname persisted cleanly to offline localStorage
  const stored = await page.evaluate(() => ({
    nickname: localStorage.getItem('neonSnakeNickname'),
    settings: JSON.parse(localStorage.getItem('neonSnakeSettings') ?? 'null'),
  }));
  expect(stored.nickname).toBe('Công Chúa Mây');
  expect(stored.settings).toMatchObject({
    mode: 'cozy',
    difficulty: 'easy',
    theme: 'honeycomb_arena',
    playerName: 'Công Chúa Mây',
  });

  // Reload and verify player nickname and default honeycomb_arena theme round-trip cleanly
  await page.reload();
  await expect(page.locator('#player-name-input')).toHaveValue('Công Chúa Mây');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'honeycomb_arena');

  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('activates boosters (+10 level, speed, magnet), shoots, morphs 4 forms, shields, steers 8-way W+D, and pauses', async ({
  page,
}) => {
  const { errors, apiRequests, externalRequests } = attachErrorWatchers(page);

  await page.goto('/');

  await page.getByRole('button', { name: /Phiêu Lưu Thông Minh/ }).click();
  await page.getByRole('button', { name: /Dễ \(Làm quen\)/ }).click();
  await page.getByRole('button', { name: /Đảo Kẹo Ngọt/ }).click();

  await expect(overlay(page)).toHaveAttribute('data-mode', 'adventure');
  await expect(overlay(page)).toHaveAttribute('data-difficulty', 'easy');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'candy_island');

  await page.keyboard.press('Enter');
  await expect(overlay(page)).toHaveClass(/hidden/);
  await expect(page.locator('#hud-top .hud-heart.filled')).toHaveCount(4);

  // Click Lv +10 booster -> immediate +10 levels (Lv.5 -> Lv.15)
  await expect(page.locator('#hud-top .hud-level-pill')).toHaveText('Lv.5');
  await page.locator('#booster-buttons [data-booster="level"]').click();
  await expect(page.locator('#hud-top .hud-level-pill')).toHaveText('Lv.15');
  await expect(page.locator('#booster-buttons [data-booster="level"] .booster-charges')).toHaveText(
    'x0',
  );

  // Activate Speed (KeyX) and Magnet (KeyC) boosters via keyboard hotkeys
  await page.keyboard.press('KeyX');
  await expect(page.locator('#booster-buttons [data-booster="speed"]')).toHaveClass(/active/);
  await page.keyboard.press('KeyC');
  await expect(page.locator('#booster-buttons [data-booster="magnet"]')).toHaveClass(/active/);

  // Shoot projectile
  await page.keyboard.press('Space');
  await page.waitForTimeout(120);

  // Morph through all 4 magical forms (1=Dragon, 2=Phoenix, 3=Unicorn, 4=Spirit)
  await expect(formCards(page).nth(0)).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('Digit2');
  await expect(formCards(page).nth(1)).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('Digit3');
  await expect(formCards(page).nth(2)).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('Digit4');
  await expect(formCards(page).nth(3)).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('KeyE');
  await expect(formCards(page).nth(0)).toHaveAttribute('aria-pressed', 'true');

  // Activate Bubble Shield (KeyF)
  await page.keyboard.press('KeyF');
  await expect(shieldPill(page)).toHaveClass(/active/);
  await expect(page.locator('#magic-bar .shield-meter')).toHaveClass(/active/);

  // Smooth 8-way diagonal steering (W + D held simultaneously)
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(280);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyD');

  // Pause & resume with P
  await page.keyboard.press('KeyP');
  await expect(overlay(page)).not.toHaveClass(/hidden/);
  await expect(overlayTitle(page)).toContainText('Tạm Dừng Phiêu Lưu');

  await page.keyboard.press('KeyP');
  await expect(overlay(page)).toHaveClass(/hidden/);

  const stored = await page.evaluate(() => ({
    settings: JSON.parse(localStorage.getItem('neonSnakeSettings') ?? 'null'),
    achievements: JSON.parse(localStorage.getItem('neonSnakeAchievements') ?? '[]'),
  }));
  expect(stored.settings).toMatchObject({
    mode: 'adventure',
    difficulty: 'easy',
    theme: 'candy_island',
  });
  expect(stored.achievements).toContain('shape-shifter');

  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('simulates DualSense 360° diagonal stick, R2, Triangle, Circle, L3 booster, and Options pause/resume', async ({
  page,
}) => {
  const { errors, apiRequests, externalRequests } = attachErrorWatchers(page);

  await page.addInitScript(() => {
    const buttons = Array.from({ length: 18 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    }));
    const mockPad = {
      id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons,
    };

    const win = window as unknown as {
      __dsSetButton: (idx: number, pressed: boolean, value?: number) => void;
      __dsSetAxes: (lx: number, ly: number, rx: number, ry: number) => void;
    };

    win.__dsSetButton = (idx, pressed, value = pressed ? 1 : 0) => {
      const btn = buttons[idx];
      if (btn) {
        btn.pressed = pressed;
        btn.touched = pressed;
        btn.value = value;
      }
      mockPad.timestamp = performance.now();
    };

    win.__dsSetAxes = (lx, ly, rx, ry) => {
      mockPad.axes[0] = lx;
      mockPad.axes[1] = ly;
      mockPad.axes[2] = rx;
      mockPad.axes[3] = ry;
      mockPad.timestamp = performance.now();
    };

    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [mockPad, null, null, null],
    });
  });

  await page.goto('/');

  // DualSense connected badge lights up
  await expect(controllerBadge(page)).toHaveClass(/connected/);
  await expect(controllerBadge(page)).toContainText('DualSense đã kết nối');

  // Press Cross (button 0) to start
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      0,
      true,
    );
  });
  await expect(overlay(page)).toHaveClass(/hidden/);
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      0,
      false,
    );
  });
  await page.waitForTimeout(50);

  // Tilt Left Stick 360° diagonally & Right Stick camera look -> HUD 🕹️ pill lights up
  await page.evaluate(() => {
    (
      window as unknown as {
        __dsSetAxes: (lx: number, ly: number, rx: number, ry: number) => void;
      }
    ).__dsSetAxes(0.7, -0.7, 0.75, -0.45);
  });
  await expect(page.locator('#hud-top .stick-pill')).toHaveClass(/lit/);
  await page.waitForTimeout(180);

  // Press R2 (button 7) to shoot -> HUD R2 pill lights up
  await page.evaluate(() => {
    (
      window as unknown as { __dsSetButton: (i: number, p: boolean, v?: number) => void }
    ).__dsSetButton(7, true, 1);
  });
  await expect(page.locator('#hud-top .controller-btn-pill', { hasText: 'R2' })).toHaveClass(/lit/);
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    (
      window as unknown as { __dsSetButton: (i: number, p: boolean, v?: number) => void }
    ).__dsSetButton(7, false, 0);
  });

  // Press Triangle (button 3) -> morph to Phoenix & light HUD △ pill
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      3,
      true,
    );
  });
  await expect(formCards(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#hud-top .controller-btn-pill', { hasText: '△' })).toHaveClass(/lit/);
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      3,
      false,
    );
  });

  // Press Circle (button 1) -> Bubble Shield & light HUD ○ pill
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      1,
      true,
    );
  });
  await expect(shieldPill(page)).toHaveClass(/active/);
  await expect(page.locator('#hud-top .controller-btn-pill', { hasText: '○' })).toHaveClass(/lit/);
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      1,
      false,
    );
  });

  // Press L3 (button 10) -> activate Lv +10 booster & light HUD L3 pill
  await expect(page.locator('#hud-top .hud-level-pill')).toHaveText('Lv.5');
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      10,
      true,
    );
  });
  await expect(page.locator('#hud-top .controller-btn-pill', { hasText: 'L3' })).toHaveClass(/lit/);
  await expect(page.locator('#hud-top .hud-level-pill')).toHaveText('Lv.15');
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      10,
      false,
    );
  });

  // Reset sticks & press Options (button 9) to pause, then press Options again to resume
  await page.evaluate(() => {
    const win = window as unknown as {
      __dsSetButton: (i: number, p: boolean, v?: number) => void;
      __dsSetAxes: (lx: number, ly: number, rx: number, ry: number) => void;
    };
    win.__dsSetAxes(0, 0, 0, 0);
    win.__dsSetButton(9, true, 1);
  });
  await expect(overlay(page)).not.toHaveClass(/hidden/);
  await expect(overlayTitle(page)).toContainText('Tạm Dừng Phiêu Lưu');

  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      9,
      false,
    );
  });
  await page.waitForTimeout(50);

  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      9,
      true,
    );
  });
  await expect(overlay(page)).toHaveClass(/hidden/);

  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});
