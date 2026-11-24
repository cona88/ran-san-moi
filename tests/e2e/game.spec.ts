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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [null, null, null, null],
    });
  });
});

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
  await expect(page.locator('#hud-top .hud-level-pill')).toHaveText('Lv.5');
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
  const levelBefore = await page.evaluate(() => {
    type Bridge = { getState: () => { level: number } };
    return (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState().level ?? 0;
  });
  expect(levelBefore).toBeGreaterThanOrEqual(5);
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      10,
      true,
    );
  });
  await expect(page.locator('#hud-top .controller-btn-pill', { hasText: 'L3' })).toHaveClass(/lit/);
  await expect(page.locator('#booster-buttons [data-booster="level"] .booster-charges')).toHaveText(
    'x0',
  );
  await expect
    .poll(async () => {
      const txt = await page.locator('#hud-top .hud-level-pill').textContent();
      return Number(txt?.replace(/\D+/g, '') ?? 0);
    })
    .toBeGreaterThanOrEqual(levelBefore + 10);
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
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

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

test('🧚 Fairy Magic: plants flowers via UI/keyboard/DualSense, butterfly metamorphosis, and sky thunder', async ({
  page,
}) => {
  const { errors, apiRequests, externalRequests } = attachErrorWatchers(page);

  // Set up DualSense mock (same pattern as existing test)
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

  // Start game via DualSense Cross (button 0)
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
  await page.waitForTimeout(100);

  // Verify fairy-skills dock is visible during playing (compact 2x3 = 6 orbs)
  await expect(page.locator('#fairy-skills')).not.toHaveClass(/hidden/);
  await expect(page.locator('#fairy-skills .fairy-skill-btn')).toHaveCount(6);

  // 1. Plant flower via UI click
  await page.locator('#fairy-skills [data-skill="flower"]').click();
  await page.waitForTimeout(200);
  const flowersAfterClick = await page.evaluate(() => {
    type Bridge = { getState: () => { gardenFlowers: unknown[] } };
    return (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState().gardenFlowers
      .length;
  });
  expect(flowersAfterClick).toBeGreaterThan(0);

  // 2. Plant flower via keyboard (KeyV)
  await page.waitForTimeout(600); // wait for cooldown
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(200);
  const flowersAfterKey = await page.evaluate(() => {
    type Bridge = { getState: () => { gardenFlowers: unknown[] } };
    return (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState().gardenFlowers
      .length;
  });
  expect(flowersAfterKey).toBeGreaterThanOrEqual(flowersAfterClick ?? 0);

  // 3. Plant flower via DualSense Square (button 2)
  await page.waitForTimeout(600); // wait for cooldown
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      2,
      true,
    );
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      2,
      false,
    );
  });

  // 4. Butterfly metamorphosis via Hold-to-Butterfly UI button (hold -> pink butterfly, release -> caterpillar)
  const butterflyBtn6 = page.locator('#fairy-skills [data-skill="butterfly"]');
  await expect(butterflyBtn6).toContainText('🦋');
  await expect(butterflyBtn6).toContainText('GIỮ');
  const bBtnBox6 = await butterflyBtn6.boundingBox();
  expect(bBtnBox6).not.toBeNull();
  await page.mouse.move(bBtnBox6!.x + bBtnBox6!.width / 2, bBtnBox6!.y + bBtnBox6!.height / 2);
  await page.mouse.down();
  await expect(butterflyBtn6).toHaveClass(/is-flying/);
  await expect(butterflyBtn6).toHaveClass(/is-holding/);
  await expect(butterflyBtn6).toContainText('BAY');
  const butterflyState1 = await page.evaluate(() => {
    type Bridge = {
      getState: () => {
        butterflyStage: string;
        butterflyHold: boolean;
        butterflyAltitude: number;
      };
    };
    return (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState() ?? null;
  });
  expect(butterflyState1?.butterflyStage).toBe('butterfly');
  expect(butterflyState1?.butterflyHold).toBe(true);
  expect(butterflyState1?.butterflyAltitude ?? 0).toBeGreaterThan(0.5);

  await page.mouse.up();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          type Bridge = {
            getState: () => {
              butterflyStage: string;
              butterflyHold: boolean;
              butterflyAltitude: number;
            };
          };
          const s = (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState();
          return s
            ? { stage: s.butterflyStage, hold: s.butterflyHold, alt: s.butterflyAltitude }
            : null;
        }),
      { timeout: 2500 },
    )
    .toEqual({ stage: 'caterpillar', hold: false, alt: 0 });

  // 5. Sky Thunder via keyboard (KeyN)
  await page.keyboard.press('KeyN');
  await page.waitForTimeout(200);
  const thunderState = await page.evaluate(() => {
    type Bridge = {
      getState: () => { thunderCooldownTicks: number; lightningBolts: unknown[] };
    };
    const s = (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState();
    return {
      cooldown: s?.thunderCooldownTicks,
      bolts: s?.lightningBolts?.length,
    };
  });
  // Thunder should have triggered — cooldown should be > 0 or bolts > 0
  expect((thunderState.cooldown ?? 0) + (thunderState.bolts ?? 0)).toBeGreaterThan(0);

  // 6. Sky Thunder via DualSense L1 (button 4)
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      4,
      true,
    );
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      4,
      false,
    );
  });

  // 7. Butterfly via DualSense R1 hold (button 5)
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      5,
      true,
    );
  });
  await expect(butterflyBtn6).toHaveClass(/is-flying/, { timeout: 2000 });
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      5,
      false,
    );
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          type Bridge = { getState: () => { butterflyStage: string } };
          return (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState()
            .butterflyStage;
        }),
      { timeout: 2500 },
    )
    .toBe('caterpillar');

  // 8. Cast Fire, Water, and Arcane 360° AoEs via UI skill dock buttons
  await page.locator('#fairy-skills [data-skill="fire"]').click();
  await page.locator('#fairy-skills [data-skill="water"]').click();
  await page.locator('#fairy-skills [data-skill="arcane"]').click();
  await page.waitForTimeout(120);

  const aoeUiState = await page.evaluate(() => {
    type Bridge = {
      getState: () => {
        fireCooldownTicks: number;
        waterCooldownTicks: number;
        arcaneCooldownTicks: number;
        aoeBlasts: ReadonlyArray<{ element: string }>;
      };
    };
    const s = (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState();
    return s
      ? {
          fireCd: s.fireCooldownTicks,
          waterCd: s.waterCooldownTicks,
          arcaneCd: s.arcaneCooldownTicks,
          elements: s.aoeBlasts.map((b) => b.element),
        }
      : null;
  });
  expect(aoeUiState).not.toBeNull();
  expect(aoeUiState?.fireCd ?? 0).toBeGreaterThan(0);
  expect(aoeUiState?.waterCd ?? 0).toBeGreaterThan(0);
  expect(aoeUiState?.arcaneCd ?? 0).toBeGreaterThan(0);
  expect(aoeUiState?.elements).toEqual(expect.arrayContaining(['fire', 'water', 'arcane']));
  await expect(page.locator('#fairy-skills [data-skill="fire"]')).toHaveClass(/is-cooldown/);
  await expect(page.locator('#fairy-skills [data-skill="water"]')).toHaveClass(/is-cooldown/);
  await expect(page.locator('#fairy-skills [data-skill="arcane"]')).toHaveClass(/is-cooldown/);

  // Verify no errors throughout
  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('🐣🚀 age profile selection, letter_match & word_spell quests, HUD age pill, and 1280×800 layout', async ({
  page,
}) => {
  const { errors, apiRequests, externalRequests } = attachErrorWatchers(page);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  // --- Default age profile is age6 ---
  await expect(overlay(page)).toHaveAttribute('data-age-profile', 'age6');
  const overlayFit = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('#overlay .overlay-card');
    const ctaBtn = document.querySelector<HTMLElement>('#cta');
    if (!card || !ctaBtn) return null;
    const cardRect = card.getBoundingClientRect();
    const ctaRect = ctaBtn.getBoundingClientRect();
    return {
      fitsVertically: card.scrollHeight <= card.clientHeight + 2,
      cardTop: cardRect.top,
      cardBottom: cardRect.bottom,
      ctaBottom: ctaRect.bottom,
    };
  });
  expect(overlayFit).not.toBeNull();
  expect(overlayFit!.fitsVertically).toBe(true);
  expect(overlayFit!.ctaBottom).toBeLessThanOrEqual(800);

  const age6Card = page.locator('button.age-profile-card[data-age-profile="age6"]');
  const age9Card = page.locator('button.age-profile-card[data-age-profile="age9"]');
  await expect(age6Card).toBeVisible();
  await expect(age9Card).toBeVisible();
  await expect(age6Card).toHaveClass(/active/);

  // --- Switch to age9 via overlay card click ---
  await age9Card.click();
  await expect(overlay(page)).toHaveAttribute('data-age-profile', 'age9');
  await expect(age9Card).toHaveClass(/active/);
  await expect(age6Card).not.toHaveClass(/active/);

  // Verify persistence to localStorage
  const stored1 = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('neonSnakeSettings') ?? 'null'),
  );
  expect(stored1).toMatchObject({ ageProfile: 'age9' });

  // --- Switch back to age6 ---
  await age6Card.click();
  await expect(overlay(page)).toHaveAttribute('data-age-profile', 'age6');

  // --- Start game with age6 and verify HUD age pill ---
  await cta(page).click();
  await expect(overlay(page)).toHaveClass(/hidden/);

  const agePill = page.locator('#hud-top .hud-age-pill');
  await expect(agePill).toBeVisible();
  await expect(agePill).toContainText('6T');

  // --- Spawn letter_match quest (age6) ---
  const letterQuest = await page.evaluate(() => {
    type Bridge = {
      spawnQuestForTest: (
        kind?: string,
      ) => { kind: string; wordSlots?: readonly string[]; rewardLevels: number } | null;
    };
    const hook = (window as unknown as { __snakeGame?: Bridge }).__snakeGame;
    if (!hook) throw new Error('Missing test hook');
    return hook.spawnQuestForTest('letter_match');
  });

  expect(letterQuest).not.toBeNull();
  expect(letterQuest!.kind).toBe('letter_match');
  expect(letterQuest!.wordSlots).toBeDefined();
  expect(letterQuest!.wordSlots!.length).toBeGreaterThanOrEqual(1);

  // Verify quest banner shows letter slots
  const questBanner = page.locator('#quest-banner');
  await expect(questBanner).toBeVisible();
  await expect(questBanner).toContainText('+10 Cấp');
  const letterSlots = questBanner.locator('.quest-letter-slot');
  await expect(letterSlots.first()).toBeVisible();
  await expect(letterSlots.first()).toHaveClass(/active/);

  // Verify speak button exists
  await expect(questBanner.locator('button.quest-speak-btn')).toBeVisible();

  // --- Toggle HUD age pill to age9 ---
  await agePill.click();
  await expect(agePill).toContainText('9T');

  // Verify age persisted
  const stored2 = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('neonSnakeSettings') ?? 'null'),
  );
  expect(stored2).toMatchObject({ ageProfile: 'age9' });

  // --- Spawn word_spell quest (age9) ---
  const wordQuest = await page.evaluate(() => {
    type Bridge = {
      spawnQuestForTest: (kind?: string) => {
        kind: string;
        wordSlots?: readonly string[];
        nextSequenceIndex: number;
        rewardLevels: number;
      } | null;
    };
    const hook = (window as unknown as { __snakeGame?: Bridge }).__snakeGame;
    if (!hook) throw new Error('Missing test hook');
    return hook.spawnQuestForTest('word_spell');
  });

  expect(wordQuest).not.toBeNull();
  expect(wordQuest!.kind).toBe('word_spell');
  expect(wordQuest!.wordSlots).toBeDefined();
  expect(wordQuest!.wordSlots!.length).toBeGreaterThanOrEqual(3);

  // Verify quest banner shows multiple letter tiles
  const wordSlots = questBanner.locator('.quest-letter-slot');
  const slotCount = await wordSlots.count();
  expect(slotCount).toBeGreaterThanOrEqual(3);

  // First slot should be active (nextSequenceIndex=1 initially), rest waiting
  await expect(wordSlots.first()).toHaveClass(/active/);

  // --- 1280×800 layout check: 0 overlaps, 0 out-of-bounds ---
  const layout = await page.evaluate(() => {
    type Box = { name: string; left: number; top: number; right: number; bottom: number };
    const readBox = (selector: string): Box | null => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el || el.classList.contains('hidden')) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { name: selector, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const overlap = (a: Box, b: Box): boolean =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;

    const primaryBoxes = [
      '#hud-top .hud-left-col',
      '#hud-top .hud-right-col',
      '#top-hud-stack',
      '#booster-buttons',
      '#crown-radar',
      '#magic-bar',
      '#fairy-skills',
    ]
      .map(readBox)
      .filter((b): b is Box => b !== null);

    const overlaps: string[] = [];
    for (let i = 0; i < primaryBoxes.length; i++) {
      for (let j = i + 1; j < primaryBoxes.length; j++) {
        const a = primaryBoxes[i]!;
        const b = primaryBoxes[j]!;
        if (overlap(a, b)) overlaps.push(`${a.name} <-> ${b.name}`);
      }
    }

    const outOfBounds = primaryBoxes
      .filter((b) => b.left < 0 || b.top < 0 || b.right > 1280.5 || b.bottom > 800.5)
      .map((b) => b.name);

    return { overlaps, outOfBounds };
  });

  expect(layout.overlaps).toEqual([]);
  expect(layout.outOfBounds).toEqual([]);

  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('chomps a weaker bot segment-by-segment in Chrome WebGL with Vietnamese chomp popups and final absorption HUD', async ({
  page,
}) => {
  const { errors, apiRequests, externalRequests } = attachErrorWatchers(page);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'honeycomb_arena');
  await expect(page.locator('.magic-ui-shell')).toHaveAttribute('data-theme', 'honeycomb_arena');

  await cta(page).click();
  await expect(overlay(page)).toHaveClass(/hidden/);

  const setup = await page.evaluate(() => {
    type Bridge = {
      getState: () => {
        phase: string;
        bots: readonly { id: number; level: number; spine: readonly unknown[] }[];
      };
      placeEdibleBotAheadForTest: () => number;
    };
    const hook = (window as unknown as { __snakeGame?: Bridge }).__snakeGame;
    if (!hook) {
      throw new Error('Missing window.__snakeGame test hook');
    }
    const initialSpineLength = hook.placeEdibleBotAheadForTest();
    const state = hook.getState();
    const targetBot = state.bots[0];
    if (!targetBot) {
      throw new Error('Expected test bot to be placed ahead of player');
    }
    return {
      phase: state.phase,
      initialSpineLength,
      targetBotId: targetBot.id,
      targetBotLevel: targetBot.level,
    };
  });

  expect(setup.phase).toBe('playing');
  expect(setup.initialSpineLength).toBe(12);
  expect(setup.targetBotLevel).toBe(3);

  const runResult = await page.evaluate(
    ({ targetBotId }: { targetBotId: number }) =>
      new Promise<{
        snapshots: { spineLength: number; chompStreak: number; botsEaten: number }[];
        chompPopupTexts: string[];
        timedOut: boolean;
      }>((resolve) => {
        type Bridge = {
          getState: () => {
            chompStreak: number;
            botsEaten: number;
            bots: readonly { id: number; spine: readonly unknown[] }[];
          };
        };
        const hook = (window as unknown as { __snakeGame?: Bridge }).__snakeGame;
        const popupsLayer = document.querySelector('#popups');
        const snapshots: { spineLength: number; chompStreak: number; botsEaten: number }[] = [];
        const chompPopupSet = new Set<string>();

        const collectChompPopups = (): void => {
          for (const node of document.querySelectorAll('#popups .chomp-popup')) {
            const text = node.textContent?.trim();
            if (text) chompPopupSet.add(text);
          }
        };

        const observer = popupsLayer
          ? new MutationObserver(() => {
              collectChompPopups();
            })
          : null;
        if (observer && popupsLayer) {
          observer.observe(popupsLayer, { childList: true, subtree: true });
        }

        const startMs = performance.now();
        let finished = false;
        let rafHandle = 0;

        const finish = (timedOut: boolean): void => {
          if (finished) return;
          finished = true;
          cancelAnimationFrame(rafHandle);
          clearInterval(pollTimer);
          observer?.disconnect();
          collectChompPopups();
          resolve({
            snapshots,
            chompPopupTexts: [...chompPopupSet],
            timedOut,
          });
        };

        const sample = (): void => {
          collectChompPopups();
          if (!hook) return;
          const s = hook.getState();
          const bot = s.bots.find((b) => b.id === targetBotId);
          snapshots.push({
            spineLength: bot ? bot.spine.length : 0,
            chompStreak: s.chompStreak,
            botsEaten: s.botsEaten,
          });
          if (s.botsEaten >= 1 && !bot) {
            finish(false);
            return;
          }
          if (performance.now() - startMs >= 2500) {
            finish(true);
          }
        };

        const onFrame = (): void => {
          sample();
          if (!finished) {
            rafHandle = requestAnimationFrame(onFrame);
          }
        };
        const pollTimer = setInterval(sample, 25);
        rafHandle = requestAnimationFrame(onFrame);
      }),
    { targetBotId: setup.targetBotId },
  );

  expect(runResult.timedOut).toBe(false);

  const partialSnapshots = runResult.snapshots.filter(
    (s) => s.spineLength > 0 && s.spineLength < setup.initialSpineLength,
  );
  expect(partialSnapshots.length).toBeGreaterThanOrEqual(2);
  expect(new Set(partialSnapshots.map((s) => s.spineLength)).size).toBeGreaterThanOrEqual(2);
  expect(partialSnapshots.some((s) => s.chompStreak >= 2)).toBe(true);

  expect(runResult.chompPopupTexts.length).toBeGreaterThanOrEqual(1);
  expect(
    runResult.chompPopupTexts.some((txt) => /Ngoạm!|Măm măm!|Rốp rốp!|ĐẠI TIỆC/.test(txt)),
  ).toBe(true);

  await expect(page.locator('#hud-top .hud-bots-pill')).toHaveText('🐍 x1');
  const absorbedBanner = page.locator('#absorbed-power-banner');
  await expect(absorbedBanner).toBeVisible();
  await expect(absorbedBanner).not.toHaveClass(/hidden/);

  const hudLayout = await page.evaluate(() => {
    type Box = {
      name: string;
      left: number;
      top: number;
      right: number;
      bottom: number;
    };
    const readBox = (selector: string): Box | null => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el || el.classList.contains('hidden')) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { name: selector, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const overlap = (a: Box, b: Box): boolean =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;

    const primaryBoxes = [
      '#hud-top .hud-left-col',
      '#hud-top .hud-right-col',
      '#top-hud-stack',
      '#booster-buttons',
      '#crown-radar',
      '#magic-bar',
      '#fairy-skills',
    ]
      .map(readBox)
      .filter((b): b is Box => b !== null);

    const stackBoxes = ['#boss-bar', '#absorbed-power-banner', '#quest-banner']
      .map(readBox)
      .filter((b): b is Box => b !== null);

    const rightBoxes = ['#hud-top .hud-actions-group', '#leaderboard-panel']
      .map(readBox)
      .filter((b): b is Box => b !== null);

    const overlaps: string[] = [];
    const checkPairs = (group: Box[]): void => {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i]!;
          const b = group[j]!;
          if (overlap(a, b)) overlaps.push(`${a.name} <-> ${b.name}`);
        }
      }
    };
    checkPairs(primaryBoxes);
    checkPairs(stackBoxes);
    checkPairs(rightBoxes);

    const outOfBounds = [...primaryBoxes, ...stackBoxes, ...rightBoxes]
      .filter((b) => b.left < 0 || b.top < 0 || b.right > 1280.5 || b.bottom > 800.5)
      .map((b) => b.name);

    return {
      primaryCount: primaryBoxes.length,
      overlaps,
      outOfBounds,
    };
  });

  expect(hudLayout.primaryCount).toBe(7);
  expect(hudLayout.overlaps).toEqual([]);
  expect(hudLayout.outOfBounds).toEqual([]);

  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('🧚 fairy skills: flowers via □/KeyV, hold-to-pink-butterfly & falling ice via UI/KeyB/R1, and sky thunder via L1/KeyN', async ({
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

    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [mockPad, null, null, null],
    });
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  // Start the game via Cross button
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
  await page.waitForTimeout(100);

  // --- Fairy skill buttons should be visible during playing (2x3 grid = 6 skills) ---
  const fairyDock = page.locator('#fairy-skills');
  await expect(fairyDock).toBeVisible();
  const fairyBtns = fairyDock.locator('.fairy-skill-btn');
  await expect(fairyBtns).toHaveCount(6);
  const skillNames = await fairyBtns.evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset['skill']),
  );
  expect(skillNames).toEqual(['flower', 'butterfly', 'thunder', 'fire', 'water', 'arcane']);

  // --- 1. Flower skill via UI button click ---
  await fairyBtns.nth(0).click();
  await page.waitForTimeout(120);

  const flowerResult1 = await page.evaluate(() => {
    type Bridge = {
      getState: () => {
        gardenFlowers: readonly unknown[];
        flowerCooldownTicks: number;
      };
    };
    const hook = (window as unknown as { __snakeGame?: Bridge }).__snakeGame;
    if (!hook) return null;
    const s = hook.getState();
    return {
      gardenFlowerCount: s.gardenFlowers.length,
      flowerCooldownTicks: s.flowerCooldownTicks,
    };
  });
  expect(flowerResult1).not.toBeNull();
  // After casting flower, either we get flowers or cooldown ticks should be set
  expect(
    (flowerResult1?.gardenFlowerCount ?? 0) > 0 || (flowerResult1?.flowerCooldownTicks ?? 0) > 0,
  ).toBe(true);

  // --- 2. Flower via KeyV keyboard ---
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(120);

  // --- 3. Flower via DualSense □ (button 2) ---
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      2,
      true,
    );
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      2,
      false,
    );
  });
  await page.waitForTimeout(100);

  // --- 4. Hold-to-Pink-Butterfly & Falling Ice Freeze (UI Hold + KeyB Hold + DualSense R1 Hold) ---
  const butterflyBtn = fairyDock.locator('[data-skill="butterfly"]');
  await expect(butterflyBtn).toContainText('🦋');
  await expect(butterflyBtn).toContainText('GIỮ');

  const frostTargets = await page.evaluate(() => {
    type Bridge = {
      placeFrostTargetsAheadForTest?: () => { botId: number; hazardId: number } | null;
    };
    return (
      (
        window as unknown as { __snakeGame?: Bridge }
      ).__snakeGame?.placeFrostTargetsAheadForTest?.() ?? null
    );
  });
  expect(frostTargets).not.toBeNull();

  // 4a. Hold UI button -> immediate Pink Butterfly, frostZones, and freezes nearby bot & hazard
  const butterflyBox = await butterflyBtn.boundingBox();
  expect(butterflyBox).not.toBeNull();
  await page.mouse.move(
    butterflyBox!.x + butterflyBox!.width / 2,
    butterflyBox!.y + butterflyBox!.height / 2,
  );
  await page.mouse.down();

  await expect(butterflyBtn).toHaveClass(/is-flying/);
  await expect(butterflyBtn).toHaveClass(/is-holding/);
  await expect(butterflyBtn).toContainText('BAY');
  await expect(page.locator('#magic-bar')).toHaveClass(/butterfly-flying/);
  await expect(page.locator('#hud-top')).toHaveClass(/butterfly-flying/);
  await expect(fairyDock).toHaveClass(/butterfly-flying/);

  await expect
    .poll(
      () =>
        page.evaluate(
          ({ botId, hazardId }) => {
            type Bridge = {
              getState: () => {
                butterflyStage: string;
                butterflyHold: boolean;
                butterflyAltitude: number;
                frostZones: readonly unknown[];
                bots: ReadonlyArray<{ id: number; frozenTicks: number }>;
                hazards: ReadonlyArray<{ id: number; frozenTicks: number }>;
              };
            };
            const s = (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState();
            if (!s) return null;
            const bot = s.bots.find((b) => b.id === botId);
            const hazard = s.hazards.find((h) => h.id === hazardId);
            return {
              stage: s.butterflyStage,
              hold: s.butterflyHold,
              altitudeHigh: s.butterflyAltitude > 0.5,
              hasFrostZones: s.frostZones.length > 0,
              botFrozen: (bot?.frozenTicks ?? 0) > 0,
              hazardFrozen: (hazard?.frozenTicks ?? 0) > 0,
            };
          },
          { botId: frostTargets!.botId, hazardId: frostTargets!.hazardId },
        ),
      { timeout: 2500 },
    )
    .toEqual({
      stage: 'butterfly',
      hold: true,
      altitudeHigh: true,
      hasFrostZones: true,
      botFrozen: true,
      hazardFrozen: true,
    });

  // Release UI button -> cleanly reverts back to caterpillar
  await page.mouse.up();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          type Bridge = {
            getState: () => {
              butterflyStage: string;
              butterflyAltitude: number;
              butterflyHold: boolean;
            };
          };
          const s = (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState();
          return s
            ? { stage: s.butterflyStage, altitude: s.butterflyAltitude, hold: s.butterflyHold }
            : null;
        }),
      { timeout: 2500 },
    )
    .toEqual({ stage: 'caterpillar', altitude: 0, hold: false });
  await expect(butterflyBtn).toContainText('GIỮ');
  await expect(butterflyBtn).not.toHaveClass(/is-flying/);

  // 4b. Hold Keyboard KeyB -> immediate Pink Butterfly; release KeyB -> reverts to caterpillar
  await page.keyboard.down('KeyB');
  await expect(butterflyBtn).toHaveClass(/is-flying/);
  await expect(page.locator('#magic-bar')).toHaveClass(/butterfly-flying/);
  const keybHoldState = await page.evaluate(() => {
    type Bridge = {
      getState: () => {
        butterflyStage: string;
        butterflyHold: boolean;
        butterflyAltitude: number;
      };
    };
    return (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState() ?? null;
  });
  expect(keybHoldState?.butterflyStage).toBe('butterfly');
  expect(keybHoldState?.butterflyHold).toBe(true);
  expect(keybHoldState?.butterflyAltitude ?? 0).toBeGreaterThan(0.5);

  await page.keyboard.up('KeyB');
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          type Bridge = {
            getState: () => {
              butterflyStage: string;
              butterflyAltitude: number;
              butterflyHold: boolean;
            };
          };
          const s = (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState();
          return s
            ? { stage: s.butterflyStage, altitude: s.butterflyAltitude, hold: s.butterflyHold }
            : null;
        }),
      { timeout: 2500 },
    )
    .toEqual({ stage: 'caterpillar', altitude: 0, hold: false });

  // 4c. Hold DualSense R1 (button 5) -> immediate Pink Butterfly + frostZones; release R1 -> reverts
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      5,
      true,
    );
  });
  await expect(butterflyBtn).toHaveClass(/is-flying/, { timeout: 2000 });
  await expect(page.locator('#hud-top')).toHaveClass(/butterfly-flying/);
  await expect(page.locator('#magic-bar')).toHaveClass(/butterfly-flying/);

  const r1HoldState = await page.evaluate(() => {
    type Bridge = {
      getState: () => {
        butterflyStage: string;
        butterflyHold: boolean;
        butterflyAltitude: number;
        frostZones: readonly unknown[];
      };
    };
    const s = (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState();
    return s
      ? {
          stage: s.butterflyStage,
          hold: s.butterflyHold,
          altitude: s.butterflyAltitude,
          frostCount: s.frostZones.length,
        }
      : null;
  });
  expect(r1HoldState?.stage).toBe('butterfly');
  expect(r1HoldState?.hold).toBe(true);
  expect(r1HoldState?.altitude ?? 0).toBeGreaterThan(0.5);
  expect(r1HoldState?.frostCount ?? 0).toBeGreaterThan(0);

  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      5,
      false,
    );
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          type Bridge = {
            getState: () => {
              butterflyStage: string;
              butterflyAltitude: number;
              butterflyHold: boolean;
            };
          };
          const s = (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState();
          return s
            ? { stage: s.butterflyStage, altitude: s.butterflyAltitude, hold: s.butterflyHold }
            : null;
        }),
      { timeout: 2500 },
    )
    .toEqual({ stage: 'caterpillar', altitude: 0, hold: false });

  // --- 5. Thunder via L1 (button 4) ---
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      4,
      true,
    );
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    (window as unknown as { __dsSetButton: (i: number, p: boolean) => void }).__dsSetButton(
      4,
      false,
    );
  });
  await page.waitForTimeout(120);

  const thunderResult = await page.evaluate(() => {
    type Bridge = {
      getState: () => {
        thunderCooldownTicks: number;
        lightningBolts: readonly unknown[];
        score: number;
      };
    };
    const hook = (window as unknown as { __snakeGame?: Bridge }).__snakeGame;
    if (!hook) return null;
    const s = hook.getState();
    return {
      thunderCooldownTicks: s.thunderCooldownTicks,
      lightningBoltCount: s.lightningBolts.length,
      score: s.score,
    };
  });
  expect(thunderResult).not.toBeNull();
  // Thunder should set cooldown or spawn lightning
  expect(
    (thunderResult?.thunderCooldownTicks ?? 0) > 0 || (thunderResult?.lightningBoltCount ?? 0) > 0,
  ).toBe(true);

  // --- 6. Thunder via KeyN ---
  await page.keyboard.press('KeyN');
  await page.waitForTimeout(120);

  // --- Verify zero console/page errors ---
  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('🔥🌊🔮⚡ Keyboard AoE (G/H/J/N without KeyJ shoot), DualSense L2 combos & Touchpad smart-cast at 1280×800', async ({
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

    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [mockPad, null, null, null],
    });
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  // Start run 1: test Keyboard AoE bindings & KeyJ isolation from projectile shoot
  await cta(page).click();
  await expect(overlay(page)).toHaveClass(/hidden/);
  await page.waitForTimeout(100);

  // Verify compact 2x3 dock fits neatly without overlapping any HUD region at 1280x800
  const dockGeometry = await page.evaluate(() => {
    const dock = document.querySelector<HTMLElement>('#fairy-skills');
    if (!dock) return null;
    const dRect = dock.getBoundingClientRect();
    const others = [
      '#hud-top .hud-left-col',
      '#hud-top .hud-right-col',
      '#top-hud-stack',
      '#booster-buttons',
      '#crown-radar',
      '#magic-bar',
    ];
    const overlaps: string[] = [];
    for (const sel of others) {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el || el.classList.contains('hidden')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const ix = Math.max(0, Math.min(dRect.right, r.right) - Math.max(dRect.left, r.left));
      const iy = Math.max(0, Math.min(dRect.bottom, r.bottom) - Math.max(dRect.top, r.top));
      if (ix > 0 && iy > 0) overlaps.push(sel);
    }
    return { width: dRect.width, height: dRect.height, overlaps };
  });
  expect(dockGeometry).not.toBeNull();
  expect(dockGeometry?.width ?? 999).toBeLessThanOrEqual(120);
  expect(dockGeometry?.height ?? 999).toBeLessThanOrEqual(180);
  expect(dockGeometry?.overlaps).toEqual([]);

  await page.keyboard.press('KeyG');
  await page.keyboard.press('KeyH');
  await page.keyboard.press('KeyJ');
  await page.keyboard.press('KeyN');
  await page.waitForTimeout(120);

  const kbState = await page.evaluate(() => {
    type Bridge = {
      getState: () => {
        config: { botCount: number };
        fireCooldownTicks: number;
        waterCooldownTicks: number;
        arcaneCooldownTicks: number;
        thunderCooldownTicks: number;
        projectiles: readonly unknown[];
        aoeBlasts: ReadonlyArray<{ element: string }>;
      };
    };
    const s = (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState();
    return s
      ? {
          botCount: s.config.botCount,
          fireCd: s.fireCooldownTicks,
          waterCd: s.waterCooldownTicks,
          arcaneCd: s.arcaneCooldownTicks,
          thunderCd: s.thunderCooldownTicks,
          projectilesCount: s.projectiles.length,
          elements: s.aoeBlasts.map((b) => b.element),
        }
      : null;
  });
  expect(kbState?.botCount).toBe(60);
  expect(kbState?.fireCd ?? 0).toBeGreaterThan(0);
  expect(kbState?.waterCd ?? 0).toBeGreaterThan(0);
  expect(kbState?.arcaneCd ?? 0).toBeGreaterThan(0);
  expect(kbState?.thunderCd ?? 0).toBeGreaterThan(0);
  expect(kbState?.projectilesCount).toBe(0);
  expect(kbState?.elements).toEqual(expect.arrayContaining(['fire', 'water', 'arcane', 'thunder']));

  // Run 2: DualSense Touchpad smart-cast priority (fire -> water -> arcane -> thunder)
  await page.goto('/');
  await cta(page).click();
  await expect(overlay(page)).toHaveClass(/hidden/);
  await page.waitForTimeout(80);

  const waitFrames = async (count = 2) => {
    await page.evaluate(
      (n) =>
        new Promise<void>((resolve) => {
          let left = n;
          const tick = () => {
            left -= 1;
            if (left <= 0) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      count,
    );
  };

  const tapGamepadButton = async (idx: number, value = 1) => {
    await page.evaluate(
      ({ buttonIdx, val }) => {
        (
          window as unknown as { __dsSetButton: (i: number, p: boolean, v?: number) => void }
        ).__dsSetButton(buttonIdx, true, val);
      },
      { buttonIdx: idx, val: value },
    );
    await waitFrames(2);
    await page.evaluate((buttonIdx) => {
      (
        window as unknown as { __dsSetButton: (i: number, p: boolean, v?: number) => void }
      ).__dsSetButton(buttonIdx, false, 0);
    }, idx);
    await waitFrames(2);
  };

  const getAoeCooldowns = () =>
    page.evaluate(() => {
      type Bridge = {
        getState: () => {
          fireCooldownTicks: number;
          waterCooldownTicks: number;
          arcaneCooldownTicks: number;
          thunderCooldownTicks: number;
          flowerCooldownTicks: number;
          gardenFlowers: readonly unknown[];
          shieldTicks: number;
          form: string;
        };
      };
      const s = (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState();
      return s
        ? {
            fire: s.fireCooldownTicks,
            water: s.waterCooldownTicks,
            arcane: s.arcaneCooldownTicks,
            thunder: s.thunderCooldownTicks,
            flowerCd: s.flowerCooldownTicks,
            flowers: s.gardenFlowers.length,
            shield: s.shieldTicks,
            form: s.form,
          }
        : null;
    });

  await tapGamepadButton(17);
  const pad1 = await getAoeCooldowns();
  expect(pad1?.fire ?? 0).toBeGreaterThan(0);
  expect(pad1?.water).toBe(0);

  await tapGamepadButton(17);
  const pad2 = await getAoeCooldowns();
  expect(pad2?.water ?? 0).toBeGreaterThan(0);
  expect(pad2?.arcane).toBe(0);

  await tapGamepadButton(17);
  const pad3 = await getAoeCooldowns();
  expect(pad3?.arcane ?? 0).toBeGreaterThan(0);
  expect(pad3?.thunder).toBe(0);

  await tapGamepadButton(17);
  const pad4 = await getAoeCooldowns();
  expect(pad4?.thunder ?? 0).toBeGreaterThan(0);

  // Run 3: DualSense L2 + face button combos (suppressing normal □/○/△)
  await page.goto('/');
  await cta(page).click();
  await expect(overlay(page)).toHaveClass(/hidden/);
  await page.waitForTimeout(80);

  // Hold L2 (button 6)
  await page.evaluate(() => {
    (
      window as unknown as { __dsSetButton: (i: number, p: boolean, v?: number) => void }
    ).__dsSetButton(6, true, 1);
  });
  await waitFrames(2);

  // L2 + □ -> Fire AoE (suppresses normal flower skill)
  await tapGamepadButton(2);
  const afterL2Square = await getAoeCooldowns();
  expect(afterL2Square?.fire ?? 0).toBeGreaterThan(0);
  expect(afterL2Square?.flowerCd).toBe(0);
  expect(afterL2Square?.flowers).toBe(0);

  // L2 + ○ -> Water AoE (suppresses normal shield)
  await tapGamepadButton(1);
  // L2 + △ -> Arcane AoE (suppresses normal morphNext; arcane itself blooms 4 diamond flowers)
  await tapGamepadButton(3);
  // L2 + ✕ -> Thunder AoE
  await tapGamepadButton(0);

  // Release L2
  await page.evaluate(() => {
    (
      window as unknown as { __dsSetButton: (i: number, p: boolean, v?: number) => void }
    ).__dsSetButton(6, false, 0);
  });
  await page.waitForTimeout(80);

  const l2State = await getAoeCooldowns();
  expect(l2State?.fire ?? 0).toBeGreaterThan(0);
  expect(l2State?.water ?? 0).toBeGreaterThan(0);
  expect(l2State?.arcane ?? 0).toBeGreaterThan(0);
  expect(l2State?.thunder ?? 0).toBeGreaterThan(0);
  expect(l2State?.flowerCd).toBe(0);
  expect(l2State?.shield).toBe(0);
  expect(l2State?.form).toBe('dragon');

  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('🔥❄️🌊🕸️ Elemental Breath/Spray: #magic-bar labels, Space hold-to-spray, 4 sprayKinds + silkWebs, and DualSense R2 at 1280×800', async ({
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

    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [mockPad, null, null, null],
    });
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await cta(page).click();
  await expect(overlay(page)).toHaveClass(/hidden/);
  await page.waitForTimeout(100);

  // 1) #magic-bar renders all 4 Vietnamese spray weapon labels cleanly with 0 HUD overlaps
  await expect(formCards(page)).toHaveCount(4);
  await expect(formCards(page).nth(0)).toContainText('🔥 Phun Lửa');
  await expect(formCards(page).nth(1)).toContainText('❄️ Phun Băng');
  await expect(formCards(page).nth(2)).toContainText('🌊 Phun Nước');
  await expect(formCards(page).nth(3)).toContainText('🕸️ Phun Tơ');

  const layout = await page.evaluate(() => {
    type Box = { name: string; left: number; top: number; right: number; bottom: number };
    const readBox = (selector: string): Box | null => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el || el.classList.contains('hidden')) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { name: selector, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const overlap = (a: Box, b: Box): boolean =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;

    const primaryBoxes = [
      '#hud-top .hud-left-col',
      '#hud-top .hud-right-col',
      '#top-hud-stack',
      '#booster-buttons',
      '#crown-radar',
      '#magic-bar',
      '#fairy-skills',
    ]
      .map(readBox)
      .filter((b): b is Box => b !== null);

    const overlaps: string[] = [];
    for (let i = 0; i < primaryBoxes.length; i++) {
      for (let j = i + 1; j < primaryBoxes.length; j++) {
        const a = primaryBoxes[i]!;
        const b = primaryBoxes[j]!;
        if (overlap(a, b)) overlaps.push(`${a.name} <-> ${b.name}`);
      }
    }

    const outOfBounds = primaryBoxes
      .filter((b) => b.left < 0 || b.top < 0 || b.right > 1280.5 || b.bottom > 800.5)
      .map((b) => b.name);

    const magicBar = document.querySelector<HTMLElement>('#magic-bar');
    const barFits = magicBar ? magicBar.scrollWidth <= magicBar.clientWidth + 1 : false;
    const cardsFit = Array.from(
      document.querySelectorAll<HTMLElement>('#magic-bar .magic-form-card'),
    ).every((card) => card.scrollWidth <= card.clientWidth + 1);

    return { overlaps, outOfBounds, barFits, cardsFit };
  });

  expect(layout.overlaps).toEqual([]);
  expect(layout.outOfBounds).toEqual([]);
  expect(layout.barFits).toBe(true);
  expect(layout.cardsFit).toBe(true);

  // Install rAF state observer so brief spray projectiles/ticks are never missed between polls
  await page.evaluate(() => {
    type ObsBridge = {
      getState: () => {
        form: string;
        sprayActiveTicks: number;
        shootCooldownMs: number;
        projectiles: ReadonlyArray<{ id: number; sprayKind: string; piercing: boolean }>;
        silkWebs: readonly unknown[];
      };
    };
    type Tracker = {
      maxSprayTicks: number;
      fireIds: Set<number>;
      iceIds: Set<number>;
      waterPiercingIds: Set<number>;
      silkIds: Set<number>;
      maxSilkWebs: number;
      reset: () => void;
      stop: () => void;
      snapshot: () => {
        form: string;
        sprayActiveTicks: number;
        shootCooldownMs: number;
        maxSprayTicks: number;
        fireCount: number;
        iceCount: number;
        waterPiercingCount: number;
        silkCount: number;
        maxSilkWebs: number;
      };
    };
    const state = {
      running: true,
      maxSprayTicks: 0,
      fireIds: new Set<number>(),
      iceIds: new Set<number>(),
      waterPiercingIds: new Set<number>(),
      silkIds: new Set<number>(),
      maxSilkWebs: 0,
    };

    const tick = () => {
      const s = (window as unknown as { __snakeGame?: ObsBridge }).__snakeGame?.getState();
      if (s) {
        if (s.sprayActiveTicks > state.maxSprayTicks) {
          state.maxSprayTicks = s.sprayActiveTicks;
        }
        if (s.silkWebs.length > state.maxSilkWebs) {
          state.maxSilkWebs = s.silkWebs.length;
        }
        for (const p of s.projectiles) {
          if (p.sprayKind === 'fire') state.fireIds.add(p.id);
          if (p.sprayKind === 'ice') state.iceIds.add(p.id);
          if (p.sprayKind === 'water' && p.piercing === true) state.waterPiercingIds.add(p.id);
          if (p.sprayKind === 'silk') state.silkIds.add(p.id);
        }
      }
      if (state.running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    const tracker: Tracker = {
      ...state,
      reset() {
        state.maxSprayTicks = 0;
        state.fireIds.clear();
        state.iceIds.clear();
        state.waterPiercingIds.clear();
        state.silkIds.clear();
        state.maxSilkWebs = 0;
      },
      stop() {
        state.running = false;
      },
      snapshot() {
        const s = (window as unknown as { __snakeGame?: ObsBridge }).__snakeGame?.getState();
        return {
          form: s?.form ?? '',
          sprayActiveTicks: s?.sprayActiveTicks ?? 0,
          shootCooldownMs: s?.shootCooldownMs ?? 0,
          maxSprayTicks: state.maxSprayTicks,
          fireCount: state.fireIds.size,
          iceCount: state.iceIds.size,
          waterPiercingCount: state.waterPiercingIds.size,
          silkCount: state.silkIds.size,
          maxSilkWebs: state.maxSilkWebs,
        };
      },
    };
    (window as unknown as { __sprayObs?: Tracker }).__sprayObs = tracker;
  });

  const readSprayObs = () =>
    page.evaluate(() => {
      type Snap = {
        form: string;
        sprayActiveTicks: number;
        shootCooldownMs: number;
        maxSprayTicks: number;
        fireCount: number;
        iceCount: number;
        waterPiercingCount: number;
        silkCount: number;
        maxSilkWebs: number;
      };
      return (
        window as unknown as { __sprayObs?: { snapshot: () => Snap } }
      ).__sprayObs?.snapshot();
    });

  // 2) Hold Space -> continuous Fire breath stream
  await page.keyboard.down('Space');
  await expect.poll(async () => (await readSprayObs())?.maxSprayTicks ?? 0).toBeGreaterThan(0);
  await expect
    .poll(async () => (await readSprayObs())?.fireCount ?? 0, { timeout: 2500 })
    .toBeGreaterThanOrEqual(2);
  await page.keyboard.up('Space');

  // Wait until fire breath finishes decaying and cooldown clears
  await expect
    .poll(
      async () => {
        const snap = await readSprayObs();
        return snap ? snap.sprayActiveTicks === 0 && snap.shootCooldownMs === 0 : false;
      },
      { timeout: 3000 },
    )
    .toBe(true);

  // 3) Morph via Digit2 (ice), Digit3 (water, piercing === true), Digit4 (silk -> silkWebs)
  await page.keyboard.press('Digit2');
  await expect.poll(async () => (await readSprayObs())?.form).toBe('phoenix');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await readSprayObs())?.iceCount ?? 0).toBeGreaterThan(0);
  await expect.poll(async () => (await readSprayObs())?.shootCooldownMs ?? 1).toBe(0);

  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await readSprayObs())?.form).toBe('unicorn');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await readSprayObs())?.waterPiercingCount ?? 0).toBeGreaterThan(0);
  await expect.poll(async () => (await readSprayObs())?.shootCooldownMs ?? 1).toBe(0);

  await page.keyboard.press('Digit4');
  await expect.poll(async () => (await readSprayObs())?.form).toBe('spirit');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await readSprayObs())?.silkCount ?? 0).toBeGreaterThan(0);
  await expect
    .poll(async () => (await readSprayObs())?.maxSilkWebs ?? 0, { timeout: 3000 })
    .toBeGreaterThan(0);

  // 4) Switch back to dragon & test DualSense R2 (button 7) continuous spray synced with 2 rAF frames
  await page.keyboard.press('Digit1');
  await expect.poll(async () => (await readSprayObs())?.form).toBe('dragon');
  await expect.poll(async () => (await readSprayObs())?.shootCooldownMs ?? 1).toBe(0);

  await page.evaluate(() => {
    const win = window as unknown as {
      __sprayObs?: { reset: () => void };
      __dsSetButton: (idx: number, pressed: boolean, value?: number) => void;
    };
    win.__sprayObs?.reset();
    win.__dsSetButton(7, true, 1);
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });

  await expect(page.locator('#hud-top .controller-btn-pill', { hasText: 'R2' })).toHaveClass(/lit/);
  await expect.poll(async () => (await readSprayObs())?.maxSprayTicks ?? 0).toBeGreaterThan(0);
  await expect
    .poll(async () => (await readSprayObs())?.fireCount ?? 0, { timeout: 2500 })
    .toBeGreaterThanOrEqual(2);

  await page.evaluate(() => {
    const win = window as unknown as {
      __sprayObs?: { stop: () => void };
      __dsSetButton: (idx: number, pressed: boolean, value?: number) => void;
    };
    win.__dsSetButton(7, false, 0);
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          win.__sprayObs?.stop();
          resolve();
        });
      });
    });
  });

  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('🦋🌈🎮 Milestone 9 Easy start: all 6 fairy skills ready, 100% butterfly charge, spray/skills highlight & 0 overlaps at 1280×800', async ({
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

    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [mockPad, null, null, null],
    });
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await page.getByRole('button', { name: /Phiêu Lưu Thông Minh/ }).click();
  await page.getByRole('button', { name: /Dễ \(Làm quen\)/ }).click();
  await cta(page).click();
  await expect(overlay(page)).toHaveClass(/hidden/);
  await page.waitForTimeout(80);

  // 1) Immediately on easy start: all 6 fairy skills ready (no cooldown) & 100% butterfly charge
  const fairyBtns = page.locator('#fairy-skills .fairy-skill-btn');
  await expect(fairyBtns).toHaveCount(6);
  for (let i = 0; i < 6; i += 1) {
    const btn = fairyBtns.nth(i);
    await expect(btn).toBeVisible();
    await expect(btn).not.toHaveClass(/is-cooldown|on-cooldown/);
  }
  const butterflyBtn = page.locator('#fairy-skills [data-skill="butterfly"]');
  await expect(butterflyBtn).toHaveClass(/is-butterfly-ready/);
  await expect(butterflyBtn).toContainText('🦋');

  const startState = await page.evaluate(() => {
    type Bridge = {
      getState: () => {
        difficulty: string;
        butterflyCharge: number;
        dashEnergy: number;
        flowerCooldownTicks: number;
        thunderCooldownTicks: number;
        fireCooldownTicks: number;
        waterCooldownTicks: number;
        arcaneCooldownTicks: number;
      };
    };
    return (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState() ?? null;
  });
  expect(startState?.difficulty).toBe('easy');
  expect(startState?.butterflyCharge).toBe(100);
  expect(startState?.dashEnergy).toBe(100);
  expect(startState?.flowerCooldownTicks).toBe(0);
  expect(startState?.thunderCooldownTicks).toBe(0);
  expect(startState?.fireCooldownTicks).toBe(0);
  expect(startState?.waterCooldownTicks).toBe(0);
  expect(startState?.arcaneCooldownTicks).toBe(0);

  // 2) Elemental spray via Space activates vibrant HUD/card spray classes
  await page.keyboard.down('Space');
  await expect(page.locator('#magic-bar')).toHaveClass(/spraying/);
  await expect(page.locator('#magic-bar .magic-form-card.active')).toHaveClass(/spraying/);
  await expect(page.locator('#hud-top')).toHaveClass(/spraying/);
  await page.keyboard.up('Space');

  // Wait for sprayActiveTicks to decay cleanly before testing DualSense R2
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          type Bridge = { getState: () => { sprayActiveTicks: number } };
          return (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState()
            .sprayActiveTicks;
        }),
      { timeout: 2500 },
    )
    .toBe(0);

  // 3) DualSense R2 button practice pill lights up & triggers elemental spray
  await page.evaluate(() => {
    (
      window as unknown as { __dsSetButton: (i: number, p: boolean, v?: number) => void }
    ).__dsSetButton(7, true, 1);
  });
  await expect(page.locator('#hud-top .controller-btn-pill', { hasText: 'R2' })).toHaveClass(/lit/);
  await expect(page.locator('#magic-bar')).toHaveClass(/spraying/);
  await page.evaluate(() => {
    (
      window as unknown as { __dsSetButton: (i: number, p: boolean, v?: number) => void }
    ).__dsSetButton(7, false, 0);
  });

  // 4) Trigger all 5 castable fairy skills cleanly + DualSense R1 Butterfly transformation
  await page.keyboard.press('KeyV');
  await page.keyboard.press('KeyG');
  await page.keyboard.press('KeyH');
  await page.keyboard.press('KeyJ');
  await page.keyboard.press('KeyN');

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          type Bridge = {
            getState: () => {
              flowerCooldownTicks: number;
              fireCooldownTicks: number;
              waterCooldownTicks: number;
              arcaneCooldownTicks: number;
              thunderCooldownTicks: number;
              gardenFlowers: readonly unknown[];
              aoeBlasts: ReadonlyArray<{ element: string }>;
            };
          };
          const s = (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState();
          return s
            ? {
                flowerActive: s.gardenFlowers.length > 0,
                hasFire: s.aoeBlasts.some((b) => b.element === 'fire'),
                hasWater: s.aoeBlasts.some((b) => b.element === 'water'),
                hasArcane: s.aoeBlasts.some((b) => b.element === 'arcane'),
                thunderFired:
                  s.thunderCooldownTicks > 0 || s.aoeBlasts.some((b) => b.element === 'thunder'),
              }
            : null;
        }),
      { timeout: 2500 },
    )
    .toMatchObject({
      flowerActive: true,
      hasFire: true,
      hasWater: true,
      hasArcane: true,
      thunderFired: true,
    });

  // Hold R1 to transform immediately into Pink Frost Butterfly while checking HUD & zero overlap
  await page.evaluate(() => {
    (
      window as unknown as { __dsSetButton: (i: number, p: boolean, v?: number) => void }
    ).__dsSetButton(5, true, 1);
  });
  await expect(page.locator('#hud-top .controller-btn-pill', { hasText: 'R1' })).toHaveClass(/lit/);
  await expect(page.locator('#magic-bar')).toHaveClass(/butterfly-flying/, { timeout: 2500 });
  await expect(page.locator('#hud-top')).toHaveClass(/butterfly-flying/, { timeout: 2500 });
  await expect(butterflyBtn).toHaveClass(/is-flying/, { timeout: 2500 });
  await expect(butterflyBtn).toHaveClass(/is-holding/, { timeout: 2500 });
  await expect(butterflyBtn).toContainText('BAY');

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          type Bridge = {
            getState: () => {
              butterflyStage: string;
              butterflyHold: boolean;
              butterflyAltitude: number;
              frostZones: readonly unknown[];
            };
          };
          const s = (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState();
          return s
            ? {
                stage: s.butterflyStage,
                hold: s.butterflyHold,
                altitudeHigh: s.butterflyAltitude > 0.5,
                hasFrost: s.frostZones.length > 0,
              }
            : null;
        }),
      { timeout: 2500 },
    )
    .toEqual({ stage: 'butterfly', hold: true, altitudeHigh: true, hasFrost: true });

  // 5) Check zero HUD overlap / overflow at 1280×800 while holding Pink Butterfly & active skills
  const layout = await page.evaluate(() => {
    type Box = { name: string; left: number; top: number; right: number; bottom: number };
    const readBox = (selector: string): Box | null => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el || el.classList.contains('hidden')) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { name: selector, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const overlap = (a: Box, b: Box): boolean =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;

    const primaryBoxes = [
      '#hud-top .hud-left-col',
      '#hud-top .hud-right-col',
      '#top-hud-stack',
      '#booster-buttons',
      '#crown-radar',
      '#magic-bar',
      '#fairy-skills',
    ]
      .map(readBox)
      .filter((b): b is Box => b !== null);

    const overlaps: string[] = [];
    for (let i = 0; i < primaryBoxes.length; i += 1) {
      for (let j = i + 1; j < primaryBoxes.length; j += 1) {
        const a = primaryBoxes[i]!;
        const b = primaryBoxes[j]!;
        if (overlap(a, b)) overlaps.push(`${a.name} <-> ${b.name}`);
      }
    }

    const outOfBounds = primaryBoxes
      .filter((b) => b.left < 0 || b.top < 0 || b.right > 1280.5 || b.bottom > 800.5)
      .map((b) => b.name);

    const magicBar = document.querySelector<HTMLElement>('#magic-bar');
    const barFits = magicBar ? magicBar.scrollWidth <= magicBar.clientWidth + 1 : false;
    const cardsFit = Array.from(
      document.querySelectorAll<HTMLElement>('#magic-bar .magic-form-card'),
    ).every((card) => card.scrollWidth <= card.clientWidth + 1);

    const dock = document.querySelector<HTMLElement>('#fairy-skills');
    const dockRect = dock?.getBoundingClientRect();

    return {
      overlaps,
      outOfBounds,
      barFits,
      cardsFit,
      dockWidth: dockRect?.width ?? 999,
      dockHeight: dockRect?.height ?? 999,
    };
  });

  expect(layout.overlaps).toEqual([]);
  expect(layout.outOfBounds).toEqual([]);
  expect(layout.barFits).toBe(true);
  expect(layout.cardsFit).toBe(true);
  expect(layout.dockWidth).toBeLessThanOrEqual(120);
  expect(layout.dockHeight).toBeLessThanOrEqual(180);

  // Release R1 -> transforms cleanly back to caterpillar
  await page.evaluate(() => {
    (
      window as unknown as { __dsSetButton: (i: number, p: boolean, v?: number) => void }
    ).__dsSetButton(5, false, 0);
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          type Bridge = {
            getState: () => {
              butterflyStage: string;
              butterflyAltitude: number;
              butterflyHold: boolean;
            };
          };
          const s = (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState();
          return s
            ? { stage: s.butterflyStage, altitude: s.butterflyAltitude, hold: s.butterflyHold }
            : null;
        }),
      { timeout: 2500 },
    )
    .toEqual({ stage: 'caterpillar', altitude: 0, hold: false });
  await expect(butterflyBtn).toContainText('GIỮ');

  // Verify 5-minute countdown timer and 5x open world (560x560, worldRadius=280, >=850 orbs)
  await expect(page.locator('#hud-top .hud-timer-pill')).toHaveText(/^⏱️ 0(5:00|4:\d{2})$/);
  const worldCheck = await page.evaluate(() => {
    type Bridge = {
      getState: () => {
        config: { worldRadius: number; maxGrid: number; sessionDurationMs?: number };
        orbs: unknown[];
        bots: unknown[];
      };
    };
    const s = (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState();
    return s
      ? {
          worldRadius: s.config.worldRadius,
          maxGrid: s.config.maxGrid,
          sessionDurationMs: s.config.sessionDurationMs,
          orbCount: s.orbs.length,
          botCount: s.bots.length,
        }
      : null;
  });
  expect(worldCheck).not.toBeNull();
  expect(worldCheck!.worldRadius).toBe(280);
  expect(worldCheck!.maxGrid).toBe(560);
  expect(worldCheck!.sessionDurationMs).toBe(300_000);
  expect(worldCheck!.orbCount).toBeGreaterThanOrEqual(850);
  expect(worldCheck!.botCount).toBeGreaterThanOrEqual(45);

  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('🏡⚡ Snake Shelters & Sky Monster Calamity: renders shelter houses, alert banner countdown, safe indicator, and 0 overlaps at 1280×800', async ({
  page,
}) => {
  const { errors, apiRequests, externalRequests } = attachErrorWatchers(page);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  await page.getByRole('button', { name: /Phiêu Lưu Thông Minh/ }).click();
  await page.getByRole('button', { name: /Dễ \(Làm quen\)/ }).click();
  await cta(page).click();
  await expect(overlay(page)).toHaveClass(/hidden/);
  await page.waitForTimeout(80);

  // 1) Verify game state initializes with 11 shelters across 560x560 arena
  // and player snake head starts at (0, 0) inside central castle
  const startState = await page.evaluate(() => {
    type Bridge = {
      getState: () => {
        shelters: Array<{
          id: string;
          name: string;
          kind: string;
          x: number;
          z: number;
          radius: number;
        }>;
        inShelter?: boolean;
        currentShelterId?: string | null;
        snake: Array<{ x: number; z: number }>;
      };
    };
    const s = (window as unknown as { __snakeGame?: Bridge }).__snakeGame?.getState();
    return s
      ? {
          shelterCount: s.shelters?.length ?? 0,
          inShelter: s.inShelter,
          currentShelterId: s.currentShelterId,
          headX: s.snake[0]?.x,
          headZ: s.snake[0]?.z,
          hasMermaid: s.shelters?.some((sh) => sh.kind === 'mermaid'),
          hasCandy: s.shelters?.some((sh) => sh.kind === 'candy'),
          hasBlossom: s.shelters?.some((sh) => sh.kind === 'blossom'),
          hasStarlight: s.shelters?.some((sh) => sh.kind === 'starlight'),
        }
      : null;
  });

  expect(startState).not.toBeNull();
  expect(startState!.shelterCount).toBe(11);
  expect(startState!.hasMermaid).toBe(true);
  expect(startState!.hasCandy).toBe(true);
  expect(startState!.hasBlossom).toBe(true);
  expect(startState!.hasStarlight).toBe(true);
  expect(Math.abs(startState!.headX ?? 999)).toBeLessThanOrEqual(5);
  expect(Math.abs(startState!.headZ ?? 999)).toBeLessThanOrEqual(5);
  expect(startState!.inShelter).toBe(true);
  expect(startState!.currentShelterId).toBe('shelter-castle-center');

  // 2) Verify Safe Shelter Indicator and Shelter Radar display safe status inside castle
  const safeIndicator = page.locator('#shelter-safe-indicator');
  await expect(safeIndicator).toBeVisible();
  await expect(safeIndicator).toContainText('🏰 ĐÃ TRÚ ẨN AN TOÀN TRONG LÂU ĐÀI ✨');

  const shelterRadar = page.locator('#shelter-radar');
  await expect(shelterRadar).toBeVisible();
  await expect(shelterRadar).toHaveClass(/safe/);
  await expect(page.locator('#shelter-radar .shelter-radar-text')).toContainText(
    '✨ Đã Trú Ẩn An Toàn!',
  );

  const setTestOverride = async (override: Record<string, unknown> | null) => {
    await page.evaluate((ov) => {
      type Bridge = { getState: () => Record<string, unknown> };
      type Hud = {
        setTestStateOverride: (state: Record<string, unknown> | null) => void;
        syncState: (state: Record<string, unknown>) => void;
      };
      const game = (window as unknown as { __snakeGame?: Bridge }).__snakeGame;
      const hud = (window as unknown as { __hudForTest?: Hud }).__hudForTest;
      if (!hud) return;
      hud.setTestStateOverride(ov);
      if (game) {
        hud.syncState(game.getState());
      }
    }, override);
  };

  // 3) Deterministically test HUD warning & outside shelter states via window.__hudForTest
  await setTestOverride({
    snake: [
      { x: 100, z: 100 },
      { x: 99, z: 100 },
      { x: 98, z: 100 },
    ],
    inShelter: false,
    currentShelterId: null,
    monsterEvent: {
      phase: 'warning',
      countdownSec: 8,
      ticksRemaining: 160,
      maxTicks: 160,
      progress: 0,
    },
  });

  // Verify Monster Alert Banner appears with 8s countdown
  const alertBanner = page.locator('#monster-alert-banner');
  await expect(alertBanner).toBeVisible();
  await expect(alertBanner).toHaveClass(/warning/);
  await expect(alertBanner).toContainText('⚠️ QUÁI VẬT BÃO TÁP ĐANG ĐẾN! VÀO NHÀ MAU! (08s)');

  // Safe indicator should now be hidden
  await expect(safeIndicator).toBeHidden();

  // Shelter Radar should be urgent, not safe, and showing directional arrow + distance to nearest shelter
  await expect(shelterRadar).toHaveClass(/urgent/);
  await expect(shelterRadar).not.toHaveClass(/safe/);
  await expect(page.locator('#shelter-radar .shelter-radar-arrow')).toBeVisible();
  await expect(page.locator('#shelter-radar .shelter-radar-text')).toContainText('•');

  // 4) Update countdown to (03s)
  await setTestOverride({
    snake: [
      { x: 100, z: 100 },
      { x: 99, z: 100 },
    ],
    inShelter: false,
    currentShelterId: null,
    monsterEvent: {
      phase: 'warning',
      countdownSec: 3,
      ticksRemaining: 60,
      maxTicks: 160,
      progress: 0.625,
    },
  });
  await expect(alertBanner).toContainText('(03s)');

  // 4b) Active monster chase with live distance feedback (e.g. 18m, 06s)
  await setTestOverride({
    snake: [
      { x: 100, z: 100 },
      { x: 99, z: 100 },
    ],
    inShelter: false,
    currentShelterId: null,
    monsterEvent: {
      phase: 'warning',
      countdownSec: 6,
      ticksRemaining: 120,
      maxTicks: 160,
      progress: 0.25,
      monsterPos: { x: 118, z: 100 },
      distanceToPlayer: 18,
      isChasing: true,
      isBlockedByShelter: false,
      targetShelterId: null,
    },
  });
  await expect(alertBanner).toBeVisible();
  await expect(alertBanner).toHaveClass(/warning/);
  await expect(alertBanner).toContainText(
    '⚠️ QUÁI VẬT ĐANG ĐUỔI BẮT! Cách: 18m • VÀO NHÀ MAU! (06s) 🐲⚡',
  );

  // 5) Simulate entering mushroom shelter
  await setTestOverride({
    snake: [
      { x: 0, z: 120 },
      { x: 0, z: 119 },
    ],
    inShelter: true,
    currentShelterId: 'shelter-mushroom-north',
    monsterEvent: {
      phase: 'warning',
      countdownSec: 2,
      ticksRemaining: 40,
      maxTicks: 160,
      progress: 0.75,
    },
  });
  await expect(safeIndicator).toBeVisible();
  await expect(safeIndicator).toContainText('🏡 ĐÃ TRÚ ẨN AN TOÀN TRONG NHÀ NẤM ✨');
  await expect(shelterRadar).toHaveClass(/safe/);
  await expect(shelterRadar).not.toHaveClass(/urgent/);

  // 5b) Monster reaches shelter perimeter and is blocked by the protective forcefield dome
  await setTestOverride({
    snake: [
      { x: 0, z: 160 },
      { x: 0, z: 159 },
    ],
    inShelter: true,
    currentShelterId: 'shelter-mushroom-south',
    monsterEvent: {
      phase: 'warning',
      countdownSec: 4,
      ticksRemaining: 80,
      maxTicks: 160,
      progress: 0.5,
      monsterPos: { x: 0, z: 144 },
      distanceToPlayer: 16,
      isChasing: true,
      isBlockedByShelter: true,
      targetShelterId: 'shelter-mushroom-south',
    },
  });
  await expect(alertBanner).toBeVisible();
  await expect(alertBanner).toHaveClass(/blocked/);
  await expect(alertBanner).toContainText(
    '🛡️ QUÁI VẬT BỊ CHẶN BỞI KHIÊN BẢO HỘ! BÉ ĐÃ AN TOÀN! ✨',
  );
  await expect(safeIndicator).toBeVisible();
  await expect(safeIndicator).toContainText('🏡 ĐÃ TRÚ ẨN AN TOÀN TRONG NHÀ NẤM ✨');
  await expect(shelterRadar).toHaveClass(/safe/);

  // 5c) Test entering Mermaid Palace ('🧜‍♀️ ĐÃ TRÚ ẨN AN TOÀN TRONG CUNG ĐIỆN TIÊN CÁ ✨')
  await setTestOverride({
    snake: [
      { x: -180, z: 120 },
      { x: -180, z: 119 },
    ],
    inShelter: true,
    currentShelterId: 'shelter-mermaid-sw',
  });
  await expect(safeIndicator).toBeVisible();
  await expect(safeIndicator).toContainText('🧜‍♀️ ĐÃ TRÚ ẨN AN TOÀN TRONG CUNG ĐIỆN TIÊN CÁ ✨');
  await expect(shelterRadar).toHaveClass(/safe/);
  await expect(page.locator('#shelter-radar .shelter-radar-progress')).toContainText(
    '11 Lâu Đài Đã Khám Phá',
  );

  // 5d) Test entering Candy Castle, Blossom Sanctuary, Starlight Palace
  await setTestOverride({
    snake: [
      { x: 180, z: -120 },
      { x: 180, z: -119 },
    ],
    inShelter: true,
    currentShelterId: 'shelter-candy-ne',
  });
  await expect(safeIndicator).toContainText('🍭 ĐÃ TRÚ ẨN AN TOÀN TRONG LÂU ĐÀI KẸO NGỌT ✨');

  await setTestOverride({
    snake: [
      { x: -120, z: -180 },
      { x: -120, z: -179 },
    ],
    inShelter: true,
    currentShelterId: 'shelter-blossom-nw',
  });
  await expect(safeIndicator).toContainText('🌸 ĐÃ TRÚ ẨN AN TOÀN TRONG LÂU ĐÀI HOA TIÊN ✨');

  await setTestOverride({
    snake: [
      { x: 120, z: 180 },
      { x: 120, z: 179 },
    ],
    inShelter: true,
    currentShelterId: 'shelter-starlight-se',
  });
  await expect(safeIndicator).toContainText('⭐ ĐÃ TRÚ ẨN AN TOÀN TRONG CUNG ĐIỆN ÁNH SAO ✨');

  // 5e) Test compass radar pointing to Mermaid Palace when nearby outside
  await setTestOverride({
    snake: [
      { x: -170, z: 120 },
      { x: -169, z: 120 },
    ],
    inShelter: false,
    currentShelterId: null,
  });
  await expect(safeIndicator).toBeHidden();
  await expect(page.locator('#shelter-radar .shelter-radar-icon')).toContainText('🧜‍♀️');
  await expect(page.locator('#shelter-radar .shelter-radar-text')).toContainText(
    'Cung Điện Tiên Cá',
  );

  // 5f) Test Castle Discovery Toast banner popup
  await page.evaluate(() => {
    type Hud = { showDiscoveryToast: (text: string) => void };
    const hud = (window as unknown as { __hudForTest?: Hud }).__hudForTest;
    hud?.showDiscoveryToast('✨ KHÁM PHÁ CUNG ĐIỆN MỚI! 🧜‍♀️ Cung Điện Nàng Tiên Cá! (+150đ) ✨');
  });
  const discoveryToast = page.locator('#castle-discovery-toast');
  await expect(discoveryToast).toBeVisible();
  await expect(discoveryToast).toContainText(
    '✨ KHÁM PHÁ CUNG ĐIỆN MỚI! 🧜‍♀️ Cung Điện Nàng Tiên Cá! (+150đ) ✨',
  );

  // 6) Simulate monster strike phase
  await setTestOverride({
    snake: [
      { x: 0, z: 120 },
      { x: 0, z: 119 },
    ],
    inShelter: true,
    currentShelterId: 'shelter-mushroom-north',
    monsterEvent: {
      phase: 'strike',
      countdownSec: 0,
      ticksRemaining: 40,
      maxTicks: 40,
      progress: 0,
    },
  });
  await expect(alertBanner).toHaveClass(/strike/);
  await expect(alertBanner).toContainText('⚡ BÃO TÁP QUÁI VẬT ĐANG HOÀNH HÀNH! ⚡');

  // 7) Monster calamity ends -> returns to idle
  await setTestOverride({
    snake: [
      { x: 0, z: 120 },
      { x: 0, z: 119 },
    ],
    inShelter: true,
    currentShelterId: 'shelter-mushroom-north',
    monsterEvent: {
      phase: 'idle',
      countdownSec: 0,
      ticksRemaining: 0,
      maxTicks: 0,
      progress: 0,
    },
  });
  await expect(alertBanner).toBeHidden();

  // 8) Comprehensive zero HUD overlap check at 1280x800 with discovery toast, alerts, and radars active
  await setTestOverride({
    snake: [
      { x: 0, z: 160 },
      { x: 0, z: 159 },
    ],
    inShelter: true,
    currentShelterId: 'shelter-mushroom-south',
    monsterEvent: {
      phase: 'warning',
      countdownSec: 5,
      ticksRemaining: 100,
      maxTicks: 160,
      progress: 0.375,
      monsterPos: { x: 0, z: 144 },
      distanceToPlayer: 16,
      isChasing: true,
      isBlockedByShelter: true,
      targetShelterId: 'shelter-mushroom-south',
    },
  });
  await page.evaluate(() => {
    type Hud = { showDiscoveryToast: (text: string) => void };
    const hud = (window as unknown as { __hudForTest?: Hud }).__hudForTest;
    hud?.showDiscoveryToast('✨ KHÁM PHÁ CUNG ĐIỆN MỚI! 🧜‍♀️ Cung Điện Nàng Tiên Cá! (+150đ) ✨');
  });
  await expect(discoveryToast).toBeVisible();

  const layout = await page.evaluate(() => {
    type Box = { name: string; left: number; top: number; right: number; bottom: number };
    const readBox = (selector: string): Box | null => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el || el.classList.contains('hidden')) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { name: selector, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const overlap = (a: Box, b: Box): boolean =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;

    const primaryBoxes = [
      '#hud-top .hud-left-col',
      '#hud-top .hud-right-col',
      '#shelter-alerts-container',
      '#top-hud-stack',
      '#booster-buttons',
      '#crown-radar',
      '#shelter-radar',
      '#magic-bar',
      '#fairy-skills',
    ]
      .map(readBox)
      .filter((b): b is Box => b !== null);

    const overlaps: string[] = [];
    for (let i = 0; i < primaryBoxes.length; i += 1) {
      for (let j = i + 1; j < primaryBoxes.length; j += 1) {
        const a = primaryBoxes[i]!;
        const b = primaryBoxes[j]!;
        if (overlap(a, b)) overlaps.push(`${a.name} <-> ${b.name}`);
      }
    }

    const outOfBounds = primaryBoxes
      .filter((b) => b.left < 0 || b.top < 0 || b.right > 1280.5 || b.bottom > 800.5)
      .map((b) => b.name);

    return {
      overlaps,
      outOfBounds,
    };
  });

  expect(layout.overlaps).toEqual([]);
  expect(layout.outOfBounds).toEqual([]);

  await setTestOverride(null);

  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Guardian Fairy visitor banner, princess preset chips, and zero HUD overlap at 1280x800', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { errors, apiRequests, externalRequests } = attachErrorWatchers(page);

  await page.goto('/');

  // Princess nickname preset chip updates player name input
  const princessChip = page.getByRole('button', { name: /Công Chúa/ });
  const fairyChip = page.getByRole('button', { name: /Tiên Nhỏ/ });
  await expect(princessChip).toBeVisible();
  await expect(fairyChip).toBeVisible();
  await princessChip.click();
  await expect(page.locator('#player-name-input')).toHaveValue('Công Chúa');

  await page.getByRole('button', { name: /Thư Giãn Xuyên Tường/ }).click();
  await page.getByRole('button', { name: /Dễ \(Làm quen\)/ }).click();
  await cta(page).click();
  await expect(overlay(page)).toHaveClass(/hidden/);

  // Spawn Guardian Fairy via debug hook and verify banner + zero HUD overlaps
  const fairyBanner = page.locator('#fairy-visitor-banner');
  await expect(fairyBanner).toBeHidden();

  const spawned = await page.evaluate(() => {
    const hook = window.__snakeGame as
      | { spawnGuardianFairyForTest?: (kind?: string) => { kind: string; nameVi: string } | null }
      | undefined;
    return hook?.spawnGuardianFairyForTest?.('blossom') ?? null;
  });
  expect(spawned).not.toBeNull();
  expect(spawned!.kind).toBe('blossom');

  await expect(fairyBanner).toBeVisible();
  await expect(fairyBanner).toContainText('Tiên Hoa Hồng');

  const layout = await page.evaluate(() => {
    type Box = { name: string; left: number; top: number; right: number; bottom: number };
    const readBox = (selector: string): Box | null => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el || el.classList.contains('hidden')) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { name: selector, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const overlap = (a: Box, b: Box): boolean =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;

    const boxes = [
      '#hud-top .hud-left-col',
      '#hud-top .hud-right-col',
      '#shelter-alerts-container',
      '#top-hud-stack',
      '#booster-buttons',
      '#crown-radar',
      '#shelter-radar',
      '#magic-bar',
      '#fairy-skills',
    ]
      .map(readBox)
      .filter((b): b is Box => b !== null);

    const overlaps: string[] = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (overlap(a, b)) overlaps.push(`${a.name} <-> ${b.name}`);
      }
    }
    return { overlaps };
  });

  expect(layout.overlaps).toEqual([]);
  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});
