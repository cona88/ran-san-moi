# Engagement Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the settings-button/board collision regression with a proper toolbar,
then add a friend-group leaderboard, achievements, and a daily challenge with a
streak, per `docs/superpowers/specs/2026-07-08-engagement-redesign-design.md`.

**Architecture:** `src/core` stays pure and untouched. The toolbar fix changes only
*where* `SceneRig` reads its viewport dimensions from (the `#app` container instead
of `window`), not the already-tested camera math. Engagement features are additive:
pure evaluator functions in `src/platform/` (unit-tested like `core`), thin
`localStorage`-backed persistence (same pattern as `storage.ts`), a small
`AchievementTracker` glue class in `src/app/`, new UI modules mirroring
`SettingsPanel`/`popups.ts`, and two Vercel Functions (`api/scores.ts`,
`api/leaderboard.ts`) backed by Upstash Redis sorted sets.

**Tech Stack:** TypeScript strict, Vite, Three.js, Vitest, `@upstash/redis`, Vercel
Functions (Web-standard `Request`/`Response` handlers).

## Global Constraints

- `src/core` stays pure — no DOM/Three/`fetch` imports. Nothing in this plan changes
  simulation rules; the daily challenge only changes the RNG seed's *source*.
- TDD for every new pure function: `dailySeed`, streak transitions, the three
  achievement evaluators, and the leaderboard client wrapper.
- `coverage.include` in `vite.config.ts` is `['src/core/**']` — the 90/85/90/90 gate
  is unaffected by this work; new modules still get real tests, just not gated.
- New runtime dependencies (`@upstash/redis`) go in `package.json` `"dependencies"`,
  not `"devDependencies"` — it runs in production inside the deployed function.
- `api/*.ts` are Vercel Functions, not part of the Vite bundle. They **may** import
  from `src/core` (it's pure — safe in a Node serverless context) and **must** be
  added to `tsconfig.json`'s `include` and given Node globals in `eslint.config.js`
  so `pnpm build`/`pnpm lint` actually cover them.
- Nickname max 16 chars. Score validation server-side uses the real per-difficulty
  max achievable score computed from `core/config.ts` (tightest board size minus
  initial length), not a guessed constant.
- Before writing `api/scores.ts` / `api/leaderboard.ts` or the Upstash client code,
  invoke the `vercel:vercel-functions` and `vercel:vercel-storage` (or
  `vercel:marketplace`) skills to confirm current handler signature and env var
  names — the code below is a complete, correct starting point but Vercel/Upstash
  APIs can move; treat those skill calls as verification, not optional.
- Rendering/DOM-heavy tasks (toolbar, modals, toasts) follow existing project
  precedent: no unit tests (none exist for `SettingsPanel`/`Overlay`/`Hud` either),
  verified by building and driving the real app (reuse/extend
  `.claude/skills/verify/verify-oracle.js`).

---

## Phase A — Toolbar (fixes the settings-button regression)

### Task 1: `SceneRig` sources its viewport from the `#app` container, not `window`

**Files:**
- Modify: `src/rendering/scene.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no public API change — `SceneRig`'s constructor signature
  `(container: HTMLElement, fitHalfExtent: number)` is unchanged; only its internal
  dimension source changes. `cameraFitDistance`/`cameraTargetZ` (already tested in
  `tests/unit/cameraFit.test.ts`) are untouched.

- [ ] **Step 1: Store the container and read dimensions from it**

In `src/rendering/scene.ts`, change the constructor signature and its first lines:

```ts
constructor(
  private readonly container: HTMLElement,
  private readonly fitHalfExtent: number,
) {
  const w = container.clientWidth;
  const h = container.clientHeight;

  this.baseDistance = this.cameraDir.length();
  this.cameraDir.normalize();
```

Then update `resize()`:

```ts
resize(): void {
  const w = this.container.clientWidth;
  const h = this.container.clientHeight;
  if (w <= 0 || h <= 0) return; // minimized / hidden tab — keep last good frame
  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  this.renderer.setSize(w, h);
  this.composer.setSize(w, h);
  this.fitCamera();
}
```

And `fitCamera()`:

```ts
private fitCamera(): void {
  const w = this.container.clientWidth;
  const h = this.container.clientHeight;
  if (w <= 0 || h <= 0) return; // degenerate viewport — don't poison the camera
  const distance = cameraFitDistance(w / h, this.baseDistance, this.fitHalfExtent, FOV);
  if (!Number.isFinite(distance)) return;
  // ...unchanged from here (aspect, lookAt, fog scale)
```

Everything else in the file (lights, composer, bloom pass, `dispose()`) is unchanged.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. `container` is still referenced as a plain identifier inside the
constructor body (TS parameter properties allow this), so no other line needs
touching.

- [ ] **Step 3: Commit**

```bash
git add src/rendering/scene.ts
git commit -m "refactor(rendering): size the camera rig from the app container, not window"
```

---

### Task 2: Toolbar CSS — reserve a fixed strip at the top, shrink `#app` below it

**Files:**
- Modify: `src/styles/style.css`

**Interfaces:**
- Produces: a `--toolbar-h` CSS custom property and a `#toolbar` class contract that
  Task 3's `Toolbar` component builds into.

- [ ] **Step 1: Add the custom property and resize `#app`**

In `src/styles/style.css`, add to `:root` (after `--bg`):

```css
  --toolbar-h: 56px;
```

Replace the existing `#app` rule:

```css
#app {
  position: fixed;
  inset: 0;
}
```

with:

```css
#app {
  position: fixed;
  top: var(--toolbar-h);
  left: 0;
  right: 0;
  bottom: 0;
}
```

- [ ] **Step 2: Replace `#hud` and `#settings-btn` with `#toolbar`**

Delete the entire `#hud { ... }` block (lines 47-59) and the entire
`#settings-btn { ... }` + `#settings-btn:hover { ... }` blocks (lines 219-240). In
their place, add:

```css
/* ---------- Toolbar ---------- */
#toolbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: calc(var(--toolbar-h) + env(safe-area-inset-top));
  padding-top: env(safe-area-inset-top);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: max(20px, env(safe-area-inset-left));
  padding-right: max(20px, env(safe-area-inset-right));
  background: linear-gradient(to bottom, rgba(8, 2, 15, 0.96), rgba(8, 2, 15, 0.88));
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(25, 246, 255, 0.25);
  box-shadow: 0 2px 20px rgba(25, 246, 255, 0.08);
  z-index: 25;
}

.toolbar-icons {
  display: flex;
  gap: 10px;
}

.icon-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(157, 75, 255, 0.4);
  border-radius: 10px;
  background: rgba(157, 75, 255, 0.1);
  color: var(--purple);
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 0 14px rgba(157, 75, 255, 0.15) inset;
}

.icon-btn:hover {
  background: rgba(157, 75, 255, 0.22);
}
```

Keep `.stat`, `.value`, `#score .value`, `#best`, `#best .value` as-is (Task 3's
`Toolbar` reuses these class names verbatim, so `#score`/`#best` inside the new
`#toolbar` render identically to how they looked inside the old `#hud`).

- [ ] **Step 3: Update the responsive overrides**

In the `@media (max-width: 640px)` block, replace:

```css
  #hud {
    padding-left: max(16px, env(safe-area-inset-left));
    padding-right: max(16px, env(safe-area-inset-right));
  }
```

with:

```css
  #toolbar {
    padding-left: max(16px, env(safe-area-inset-left));
    padding-right: max(16px, env(safe-area-inset-right));
  }
```

and delete the `#settings-btn { font-size: 12px; padding: 7px 12px; }` rule in that
same block (the button is icon-only now, no text to shrink).

In the `@media (orientation: landscape) and (max-height: 480px)` block, replace:

```css
  #hud {
    padding-top: max(10px, env(safe-area-inset-top));
  }
```

with:

```css
  #toolbar {
    height: calc(44px + env(safe-area-inset-top));
    padding-top: env(safe-area-inset-top);
  }
```

(shrinks the bar on short landscape phones instead of just its padding, since
`#app`'s `top` is driven by the `--toolbar-h` constant — landscape needs an inline
override since custom properties aren't targeted by these rules; `--toolbar-h`
itself stays 56px, only this media query's actual rendered height changes, which is
fine since `#app`'s `top: var(--toolbar-h)` would then leave a small gap — to avoid
that, override the variable instead:)

```css
  :root {
    --toolbar-h: 44px;
  }
```

Use this variable override (inside the same landscape media query, as its own rule)
rather than a fixed `height` on `#toolbar`, so `#app`'s `top` stays in sync
automatically.

- [ ] **Step 4: Commit**

```bash
git add src/styles/style.css
git commit -m "style: replace floating HUD/settings-btn with a solid top toolbar"
```

---

### Task 3: `Toolbar` component replaces `Hud`

**Files:**
- Create: `src/ui/toolbar.ts`
- Delete: `src/ui/hud.ts`

**Interfaces:**
- Consumes: `el` from `./dom` (existing).
- Produces: `class Toolbar { constructor(root: HTMLElement, handlers: ToolbarHandlers); setScore(score: number): void; setBest(best: number): void; }` where
  `interface ToolbarHandlers { onLeaderboardClick(): void; onSettingsClick(): void; }`
  — Task 4 wires this into `main.ts`, and later Task 16 uses `onLeaderboardClick`.

- [ ] **Step 1: Write `src/ui/toolbar.ts`**

```ts
import { el } from './dom';

export interface ToolbarHandlers {
  onLeaderboardClick(): void;
  onSettingsClick(): void;
}

/** Persistent top bar: score / best read-outs plus leaderboard + settings triggers. */
export class Toolbar {
  private readonly scoreValue: HTMLElement;
  private readonly bestValue: HTMLElement;

  constructor(root: HTMLElement, handlers: ToolbarHandlers) {
    this.scoreValue = el('div', { className: 'value', text: '0' });
    this.bestValue = el('div', { className: 'value', text: '0' });

    const score = el(
      'div',
      { id: 'score' },
      el('div', { className: 'stat', text: 'Score' }),
      this.scoreValue,
    );
    const best = el(
      'div',
      { id: 'best' },
      el('div', { className: 'stat', text: 'Best' }),
      this.bestValue,
    );

    const leaderboardBtn = el('button', { className: 'icon-btn', text: '🏆' });
    leaderboardBtn.setAttribute('aria-label', 'Leaderboard');
    leaderboardBtn.addEventListener('click', () => handlers.onLeaderboardClick());

    const settingsBtn = el('button', { className: 'icon-btn', text: '⚙' });
    settingsBtn.setAttribute('aria-label', 'Settings');
    settingsBtn.addEventListener('click', () => handlers.onSettingsClick());

    const icons = el('div', { className: 'toolbar-icons' }, leaderboardBtn, settingsBtn);

    root.appendChild(el('div', { id: 'toolbar' }, score, icons, best));
  }

  setScore(score: number): void {
    this.scoreValue.textContent = String(score);
  }

  setBest(best: number): void {
    this.bestValue.textContent = String(best);
  }
}
```

- [ ] **Step 2: Delete the old HUD module**

```bash
git rm src/ui/hud.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/toolbar.ts
git commit -m "feat(ui): add Toolbar (replaces Hud, adds leaderboard trigger)"
```

---

### Task 4: `SettingsPanel` stops owning its trigger button; wire everything in `main.ts`

**Files:**
- Modify: `src/ui/settings.ts`
- Modify: `src/app/main.ts`

**Interfaces:**
- Consumes: `Toolbar` from Task 3.
- Produces: `SettingsPanel` gains a public `open(): void` (it already has `close()`);
  its constructor no longer creates a trigger element, so callers must invoke
  `settingsPanel.open()` themselves from wherever they want a trigger.

- [ ] **Step 1: Remove the gear button from `SettingsPanel`**

In `src/ui/settings.ts`, delete these two lines from the constructor:

```ts
    const gear = el('button', { id: 'settings-btn', text: '⚙ Settings' });
    gear.addEventListener('click', () => this.open());
```

and change:

```ts
    parent.append(gear, this.panel);
```

to:

```ts
    parent.appendChild(this.panel);
```

`open()` is already `public` (no `private` modifier) — no other change needed in
this file.

- [ ] **Step 2: Wire `Toolbar` + `SettingsPanel` in `main.ts`**

In `src/app/main.ts`, replace:

```ts
import { Hud } from '../ui/hud';
```

with:

```ts
import { Toolbar } from '../ui/toolbar';
```

Replace:

```ts
  const sfx = new Sfx(settings.sound);
  const hud = new Hud(uiRoot);
  const popups = new ScorePopups(uiRoot);
```

with:

```ts
  const sfx = new Sfx(settings.sound);
  const popups = new ScorePopups(uiRoot);
```

(the `Toolbar` construction moves below, after `SettingsPanel`, so its
`onSettingsClick` handler can close over `settingsPanel`.)

Find the existing `SettingsPanel` construction:

```ts
  new SettingsPanel(uiRoot, settings, {
    onChange(next: Settings) {
      saveSettings(next);
      sfx.setEnabled(next.sound);
      if (next.difficulty !== activeDifficulty) {
        activeDifficulty = next.difficulty;
        startFreshGame(next);
      }
    },
    onVisibilityChange(open) {
      if (open && state.phase === 'playing') dispatch({ type: 'pause' });
    },
  });
```

Change `new SettingsPanel(...)` to `const settingsPanel = new SettingsPanel(...)` (add
the `const settingsPanel = ` binding, keep the rest identical), then immediately
after it add:

```ts
  const toolbar = new Toolbar(uiRoot, {
    onLeaderboardClick: () => {
      /* wired in Task 16 */
    },
    onSettingsClick: () => settingsPanel.open(),
  });
```

Every remaining `hud.setScore(...)` / `hud.setBest(...)` call in the file (there are
three: in `onStateChange`, in `startFreshGame`, and in the initial-paint block) becomes
`toolbar.setScore(...)` / `toolbar.setBest(...)`.

- [ ] **Step 3: Typecheck and build**

Run: `pnpm typecheck && pnpm build`
Expected: no errors.

- [ ] **Step 4: Verify visually**

Run: `pnpm preview --port 4321` in the background, then drive it with the existing
oracle-verification pattern from `.claude/skills/verify/SKILL.md` (or a quick manual
`pnpm dev` + browser check): confirm the toolbar renders as a solid bar, the board
starts below it with no overlap at any point, and clicking the ⚙ icon opens Settings.
Capture a screenshot as evidence.

- [ ] **Step 5: Commit**

```bash
git add src/ui/settings.ts src/app/main.ts
git commit -m "feat(ui): wire Toolbar into the app, settings trigger moves off the board"
```

---

## Phase B — Pure engagement logic (no backend, no UI yet)

### Task 5: `dailySeed` — deterministic per-UTC-day seed

**Files:**
- Create: `src/platform/daily.ts`
- Test: `tests/unit/daily.test.ts`

**Interfaces:**
- Produces: `function dailySeed(date: Date): number` — a 32-bit unsigned integer,
  usable directly as `createInitialState({ seed })`'s `seed` option (it already
  accepts a plain `number`, see `src/core/game.ts`'s `NewGameOptions`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/daily.test.ts
import { describe, expect, it } from 'vitest';
import { dailySeed } from '../../src/platform/daily';

describe('dailySeed', () => {
  it('is deterministic for the same UTC day', () => {
    const a = dailySeed(new Date('2026-07-08T00:00:00Z'));
    const b = dailySeed(new Date('2026-07-08T23:59:59Z'));
    expect(a).toBe(b);
  });

  it('differs across days', () => {
    const day1 = dailySeed(new Date('2026-07-08T12:00:00Z'));
    const day2 = dailySeed(new Date('2026-07-09T12:00:00Z'));
    expect(day1).not.toBe(day2);
  });

  it('is a non-negative 32-bit integer', () => {
    const seed = dailySeed(new Date('2026-07-08T12:00:00Z'));
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/daily.test.ts`
Expected: FAIL — `Cannot find module '../../src/platform/daily'`.

- [ ] **Step 3: Implement `dailySeed`**

```ts
// src/platform/daily.ts
/** Deterministic 32-bit seed for a UTC calendar day (FNV-1a over "YYYY-MM-DD"). */
export function dailySeed(date: Date): number {
  const key = date.toISOString().slice(0, 10);
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/daily.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/platform/daily.ts tests/unit/daily.test.ts
git commit -m "feat(platform): add deterministic daily-challenge seed"
```

---

### Task 6: Daily-challenge streak tracking

**Files:**
- Modify: `src/platform/daily.ts`
- Modify: `tests/unit/daily.test.ts`

**Interfaces:**
- Consumes: `safeGet`/`safeSet` pattern (inlined here, matching `storage.ts` — see
  Step 3; not imported, since `storage.ts`'s helpers are private to that module).
- Produces:
  `interface StreakState { readonly count: number; readonly lastPlayedDate: string | null }`,
  `function currentStreak(today?: Date): number`,
  `function recordDailyPlay(today?: Date): StreakState`.
  Task 19 calls `recordDailyPlay` when a daily-challenge run ends, and reads
  `currentStreak()` for the ready-screen display.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/daily.test.ts`:

```ts
// @vitest-environment jsdom
```

Add this line as the **very first line of the file** (before the existing imports —
Vitest environment pragmas must be the first line), then append:

```ts
import { afterEach } from 'vitest';
import { currentStreak, recordDailyPlay } from '../../src/platform/daily';

afterEach(() => localStorage.clear());

describe('daily streak', () => {
  it('starts a streak of 1 on first play', () => {
    const s = recordDailyPlay(new Date('2026-07-08T12:00:00Z'));
    expect(s.count).toBe(1);
    expect(s.lastPlayedDate).toBe('2026-07-08');
  });

  it('increments on consecutive days', () => {
    recordDailyPlay(new Date('2026-07-08T12:00:00Z'));
    const s = recordDailyPlay(new Date('2026-07-09T08:00:00Z'));
    expect(s.count).toBe(2);
  });

  it('resets to 1 if a day is skipped', () => {
    recordDailyPlay(new Date('2026-07-08T12:00:00Z'));
    const s = recordDailyPlay(new Date('2026-07-10T12:00:00Z'));
    expect(s.count).toBe(1);
  });

  it('is idempotent within the same day', () => {
    recordDailyPlay(new Date('2026-07-08T09:00:00Z'));
    const s = recordDailyPlay(new Date('2026-07-08T20:00:00Z'));
    expect(s.count).toBe(1);
  });

  it('currentStreak reflects an unbroken streak', () => {
    recordDailyPlay(new Date('2026-07-08T12:00:00Z'));
    expect(currentStreak(new Date('2026-07-09T06:00:00Z'))).toBe(1); // due today, not broken yet
  });

  it('currentStreak drops to 0 once more than a day has passed', () => {
    recordDailyPlay(new Date('2026-07-08T12:00:00Z'));
    expect(currentStreak(new Date('2026-07-10T06:00:00Z'))).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/daily.test.ts`
Expected: FAIL — `currentStreak`/`recordDailyPlay` not exported.

- [ ] **Step 3: Implement streak tracking**

Append to `src/platform/daily.ts`:

```ts
const STREAK_KEY = 'neonSnakeStreak';

export interface StreakState {
  readonly count: number;
  readonly lastPlayedDate: string | null;
}

const EMPTY_STREAK: StreakState = { count: 0, lastPlayedDate: null };

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — best-effort only */
  }
}

function loadStreak(): StreakState {
  const raw = safeGet(STREAK_KEY);
  if (!raw) return EMPTY_STREAK;
  try {
    const parsed = JSON.parse(raw) as Partial<StreakState>;
    return typeof parsed.count === 'number' && typeof parsed.lastPlayedDate === 'string'
      ? { count: parsed.count, lastPlayedDate: parsed.lastPlayedDate }
      : EMPTY_STREAK;
  } catch {
    return EMPTY_STREAK;
  }
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isYesterday(lastPlayedDate: string, today: Date): boolean {
  const yesterday = new Date(today.getTime() - 86_400_000);
  return lastPlayedDate === dayKey(yesterday);
}

/** Streak as of now — 0 if the last daily play wasn't today or yesterday. */
export function currentStreak(today: Date = new Date()): number {
  const s = loadStreak();
  if (!s.lastPlayedDate) return 0;
  const key = dayKey(today);
  if (s.lastPlayedDate === key || isYesterday(s.lastPlayedDate, today)) return s.count;
  return 0;
}

/** Record a completed daily-challenge run; increments, resets or no-ops the streak. */
export function recordDailyPlay(today: Date = new Date()): StreakState {
  const key = dayKey(today);
  const prev = loadStreak();
  if (prev.lastPlayedDate === key) return prev; // already recorded today
  const count = prev.lastPlayedDate && isYesterday(prev.lastPlayedDate, today) ? prev.count + 1 : 1;
  const next: StreakState = { count, lastPlayedDate: key };
  safeSet(STREAK_KEY, JSON.stringify(next));
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/daily.test.ts`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/platform/daily.ts tests/unit/daily.test.ts
git commit -m "feat(platform): track daily-challenge streaks"
```

---

### Task 7: Achievement catalogue + pure run-scoped evaluator

**Files:**
- Create: `src/platform/achievements.ts`
- Test: `tests/unit/achievements.test.ts`

**Interfaces:**
- Produces:
  `interface AchievementDef { readonly id: string; readonly name: string; readonly description: string }`,
  `const ACHIEVEMENTS: readonly AchievementDef[]`,
  `interface RunEvent { readonly nextScore: number; readonly won: boolean; readonly isGameOver: boolean; readonly bestAtRunStart: number; readonly pendingShrinkSurvivals: number; readonly hour: number }`,
  `function evaluateRunAchievements(event: RunEvent, unlocked: ReadonlySet<string>): string[]`.
  Task 18's `AchievementTracker` is the only consumer of `evaluateRunAchievements`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/achievements.test.ts
import { describe, expect, it } from 'vitest';
import { evaluateRunAchievements, type RunEvent } from '../../src/platform/achievements';

const base: RunEvent = {
  nextScore: 0,
  won: false,
  isGameOver: false,
  bestAtRunStart: 0,
  pendingShrinkSurvivals: 0,
  hour: 12,
};
const none = new Set<string>();

describe('evaluateRunAchievements', () => {
  it('unlocks first-bite on the first food', () => {
    expect(evaluateRunAchievements({ ...base, nextScore: 1 }, none)).toContain('first-bite');
  });

  it('does not re-unlock an already-unlocked id', () => {
    const unlocked = new Set(['first-bite']);
    expect(evaluateRunAchievements({ ...base, nextScore: 1 }, unlocked)).not.toContain('first-bite');
  });

  it('unlocks halfway-there at score 10', () => {
    expect(evaluateRunAchievements({ ...base, nextScore: 10 }, none)).toContain('halfway-there');
  });

  it('unlocks speed-demon at score 20', () => {
    expect(evaluateRunAchievements({ ...base, nextScore: 20 }, none)).toContain('speed-demon');
  });

  it('unlocks iron-wall after 3 pending-shrink survivals', () => {
    expect(
      evaluateRunAchievements({ ...base, pendingShrinkSurvivals: 3 }, none),
    ).toContain('iron-wall');
    expect(
      evaluateRunAchievements({ ...base, pendingShrinkSurvivals: 2 }, none),
    ).not.toContain('iron-wall');
  });

  it('unlocks night-crawler between midnight and 4am', () => {
    expect(evaluateRunAchievements({ ...base, hour: 2 }, none)).toContain('night-crawler');
    expect(evaluateRunAchievements({ ...base, hour: 4 }, none)).not.toContain('night-crawler');
  });

  it('unlocks perfectionist only on a winning game-over', () => {
    expect(
      evaluateRunAchievements({ ...base, isGameOver: true, won: true }, none),
    ).toContain('perfectionist');
    expect(
      evaluateRunAchievements({ ...base, isGameOver: false, won: true }, none),
    ).not.toContain('perfectionist');
  });

  it('unlocks comeback-kid only on game-over, beating the run-start best by 5+', () => {
    const event: RunEvent = { ...base, isGameOver: true, bestAtRunStart: 10, nextScore: 15 };
    expect(evaluateRunAchievements(event, none)).toContain('comeback-kid');
    expect(
      evaluateRunAchievements({ ...event, nextScore: 14 }, none),
    ).not.toContain('comeback-kid');
  });

  it('never unlocks comeback-kid on a player\'s very first run (no prior best)', () => {
    const event: RunEvent = { ...base, isGameOver: true, bestAtRunStart: 0, nextScore: 20 };
    expect(evaluateRunAchievements(event, none)).not.toContain('comeback-kid');
  });

  it('can unlock several achievements in one event', () => {
    const event: RunEvent = { ...base, nextScore: 20, hour: 1 };
    const unlocked = evaluateRunAchievements(event, none);
    expect(unlocked).toEqual(
      expect.arrayContaining(['first-bite', 'halfway-there', 'speed-demon', 'night-crawler']),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/achievements.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the catalogue and evaluator**

```ts
// src/platform/achievements.ts
export interface AchievementDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first-bite', name: 'First Bite', description: 'Eat your first food.' },
  { id: 'halfway-there', name: 'Halfway There', description: 'Reach a score of 10.' },
  { id: 'iron-wall', name: 'Iron Wall', description: 'Survive 3 wall shrinks in one run.' },
  { id: 'speed-demon', name: 'Speed Demon', description: 'Reach a score of 20.' },
  { id: 'perfectionist', name: 'Perfectionist', description: 'Win by filling the board.' },
  { id: 'comeback-kid', name: 'Comeback Kid', description: 'Beat your best by 5 or more.' },
  { id: 'night-crawler', name: 'Night Crawler', description: 'Play between midnight and 4am.' },
  { id: 'three-day-streak', name: 'Getting Started', description: '3-day daily-challenge streak.' },
  { id: 'week-streak', name: 'Committed', description: '7-day daily-challenge streak.' },
  { id: 'neon-regular', name: 'Neon Regular', description: '30-day daily-challenge streak.' },
  { id: 'top-three', name: 'Podium', description: 'Reach top 3 on a leaderboard.' },
];

export interface RunEvent {
  readonly nextScore: number;
  readonly won: boolean;
  readonly isGameOver: boolean;
  readonly bestAtRunStart: number;
  readonly pendingShrinkSurvivals: number;
  readonly hour: number;
}

/** Pure: given one run's state and the already-unlocked set, return newly-unlocked ids. */
export function evaluateRunAchievements(event: RunEvent, unlocked: ReadonlySet<string>): string[] {
  const newly: string[] = [];
  const maybeUnlock = (id: string, condition: boolean): void => {
    if (condition && !unlocked.has(id)) newly.push(id);
  };

  maybeUnlock('first-bite', event.nextScore >= 1);
  maybeUnlock('halfway-there', event.nextScore >= 10);
  maybeUnlock('speed-demon', event.nextScore >= 20);
  maybeUnlock('iron-wall', event.pendingShrinkSurvivals >= 3);
  maybeUnlock('night-crawler', event.hour >= 0 && event.hour < 4);

  if (event.isGameOver) {
    maybeUnlock('perfectionist', event.won);
    maybeUnlock(
      'comeback-kid',
      event.bestAtRunStart > 0 && event.nextScore - event.bestAtRunStart >= 5,
    );
  }

  return newly;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/achievements.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/platform/achievements.ts tests/unit/achievements.test.ts
git commit -m "feat(platform): add achievement catalogue and pure run evaluator"
```

---

### Task 8: Streak and leaderboard-rank achievement evaluators

**Files:**
- Modify: `src/platform/achievements.ts`
- Modify: `tests/unit/achievements.test.ts`

**Interfaces:**
- Produces:
  `function evaluateStreakAchievements(streakCount: number, unlocked: ReadonlySet<string>): string[]`,
  `function evaluateLeaderboardAchievements(rank: number | null, unlocked: ReadonlySet<string>): string[]`.
  Task 18 calls the first after `recordDailyPlay`; Task 19 calls the second after a
  score submission resolves with a rank.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/achievements.test.ts`:

```ts
import { evaluateLeaderboardAchievements, evaluateStreakAchievements } from '../../src/platform/achievements';

describe('evaluateStreakAchievements', () => {
  it('unlocks three-day-streak at 3, not before', () => {
    expect(evaluateStreakAchievements(3, none)).toContain('three-day-streak');
    expect(evaluateStreakAchievements(2, none)).not.toContain('three-day-streak');
  });

  it('unlocks week-streak at 7 and neon-regular at 30', () => {
    expect(evaluateStreakAchievements(7, none)).toContain('week-streak');
    expect(evaluateStreakAchievements(30, none)).toContain('neon-regular');
  });

  it('a big streak unlocks every threshold crossed at once', () => {
    const unlocked = evaluateStreakAchievements(30, none);
    expect(unlocked).toEqual(
      expect.arrayContaining(['three-day-streak', 'week-streak', 'neon-regular']),
    );
  });
});

describe('evaluateLeaderboardAchievements', () => {
  it('unlocks top-three for rank 1-3', () => {
    expect(evaluateLeaderboardAchievements(1, none)).toContain('top-three');
    expect(evaluateLeaderboardAchievements(3, none)).toContain('top-three');
  });

  it('does not unlock for rank 4 or worse, or a null rank', () => {
    expect(evaluateLeaderboardAchievements(4, none)).not.toContain('top-three');
    expect(evaluateLeaderboardAchievements(null, none)).not.toContain('top-three');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/achievements.test.ts`
Expected: FAIL — new functions not exported.

- [ ] **Step 3: Implement**

Append to `src/platform/achievements.ts`:

```ts
/** Pure: given the current daily streak length, return newly-crossed streak ids. */
export function evaluateStreakAchievements(
  streakCount: number,
  unlocked: ReadonlySet<string>,
): string[] {
  const newly: string[] = [];
  const maybeUnlock = (id: string, threshold: number): void => {
    if (streakCount >= threshold && !unlocked.has(id)) newly.push(id);
  };
  maybeUnlock('three-day-streak', 3);
  maybeUnlock('week-streak', 7);
  maybeUnlock('neon-regular', 30);
  return newly;
}

/** Pure: given a leaderboard rank (1-based, null if unranked), return newly-unlocked ids. */
export function evaluateLeaderboardAchievements(
  rank: number | null,
  unlocked: ReadonlySet<string>,
): string[] {
  if (rank !== null && rank <= 3 && !unlocked.has('top-three')) return ['top-three'];
  return [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/achievements.test.ts`
Expected: PASS (15 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/platform/achievements.ts tests/unit/achievements.test.ts
git commit -m "feat(platform): add streak and leaderboard-rank achievement evaluators"
```

---

### Task 9: Unlocked-achievements persistence (`localStorage`)

**Files:**
- Modify: `src/platform/achievements.ts`
- Modify: `tests/unit/achievements.test.ts`

**Interfaces:**
- Produces: `function loadUnlockedAchievements(): Set<string>`,
  `function unlockAchievements(ids: readonly string[]): void`. Task 18's
  `AchievementTracker` is the consumer.

- [ ] **Step 1: Write the failing tests**

Add `// @vitest-environment jsdom` as the first line of `tests/unit/achievements.test.ts`
(must precede all imports), then append:

```ts
import { afterEach } from 'vitest';
import { loadUnlockedAchievements, unlockAchievements } from '../../src/platform/achievements';

afterEach(() => localStorage.clear());

describe('unlocked-achievements persistence', () => {
  it('starts empty', () => {
    expect(loadUnlockedAchievements().size).toBe(0);
  });

  it('round-trips unlocked ids', () => {
    unlockAchievements(['first-bite', 'halfway-there']);
    const loaded = loadUnlockedAchievements();
    expect(loaded.has('first-bite')).toBe(true);
    expect(loaded.has('halfway-there')).toBe(true);
    expect(loaded.size).toBe(2);
  });

  it('merges across multiple calls without duplicates', () => {
    unlockAchievements(['first-bite']);
    unlockAchievements(['first-bite', 'speed-demon']);
    expect(loadUnlockedAchievements().size).toBe(2);
  });

  it('falls back to empty on corrupt JSON', () => {
    localStorage.setItem('neonSnakeAchievements', '{ not json');
    expect(loadUnlockedAchievements().size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/achievements.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

Append to `src/platform/achievements.ts`:

```ts
const UNLOCKED_KEY = 'neonSnakeAchievements';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — best-effort only */
  }
}

export function loadUnlockedAchievements(): Set<string> {
  const raw = safeGet(UNLOCKED_KEY);
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((id) => typeof id === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

export function unlockAchievements(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const merged = loadUnlockedAchievements();
  for (const id of ids) merged.add(id);
  safeSet(UNLOCKED_KEY, JSON.stringify([...merged]));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/achievements.test.ts`
Expected: PASS (19 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/platform/achievements.ts tests/unit/achievements.test.ts
git commit -m "feat(platform): persist unlocked achievements to localStorage"
```

---

### Task 10: Player identity — `playerId` + nickname

**Files:**
- Modify: `src/platform/storage.ts`
- Modify: `tests/unit/storage.test.ts`

**Interfaces:**
- Produces: `function loadPlayerId(): string` (generates + persists a UUID on first
  call), `function loadNickname(): string | null`,
  `function saveNickname(nickname: string): void`,
  `function loadOrCreateNickname(): string` (returns the saved nickname, or
  generates+saves a default like `Snake-7f3a` derived from the player id if none
  exists yet — so score submission is never blocked on an unset nickname). Consumed
  by Task 13 (submission) and the Settings-panel nickname field (Task 19 folds it
  in).

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/storage.test.ts`:

```ts
import { loadNickname, loadOrCreateNickname, loadPlayerId, saveNickname } from '../../src/platform/storage';

describe('storage: player identity', () => {
  it('generates and persists a playerId on first call', () => {
    const id = loadPlayerId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(loadPlayerId()).toBe(id); // stable across calls
  });

  it('nickname defaults to null until set', () => {
    expect(loadNickname()).toBeNull();
  });

  it('round-trips a nickname, capped at 16 chars', () => {
    saveNickname('A Very Long Nickname Indeed');
    expect(loadNickname()).toBe('A Very Long Nick'.slice(0, 16));
  });

  it('loadOrCreateNickname persists a generated default when none is set', () => {
    const first = loadOrCreateNickname();
    expect(first.length).toBeGreaterThan(0);
    expect(loadNickname()).toBe(first); // was persisted
    expect(loadOrCreateNickname()).toBe(first); // stable across calls
  });

  it('loadOrCreateNickname returns the saved nickname if one exists', () => {
    saveNickname('Matheus');
    expect(loadOrCreateNickname()).toBe('Matheus');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/storage.test.ts`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Implement**

Append to `src/platform/storage.ts`:

```ts
const PLAYER_ID_KEY = 'neonSnakePlayerId';
const NICKNAME_KEY = 'neonSnakeNickname';
const NICKNAME_MAX = 16;

export function loadPlayerId(): string {
  const existing = safeGet(PLAYER_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  safeSet(PLAYER_ID_KEY, id);
  return id;
}

export function loadNickname(): string | null {
  return safeGet(NICKNAME_KEY);
}

export function saveNickname(nickname: string): void {
  safeSet(NICKNAME_KEY, nickname.slice(0, NICKNAME_MAX));
}

/** The player's nickname, generating and persisting a default if none is set. */
export function loadOrCreateNickname(): string {
  const existing = loadNickname();
  if (existing) return existing;
  const suffix = loadPlayerId().slice(0, 4);
  const generated = `Snake-${suffix}`;
  saveNickname(generated);
  return generated;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/storage.test.ts`
Expected: PASS (13 tests total). Note: `crypto.randomUUID` must exist in the jsdom
test environment (jsdom ^25 provides it); if this step fails with
`crypto.randomUUID is not a function`, check the installed jsdom version before
changing the implementation.

- [ ] **Step 5: Commit**

```bash
git add src/platform/storage.ts tests/unit/storage.test.ts
git commit -m "feat(platform): add player identity (UUID + nickname) to storage"
```

---

## Phase C — Backend + client leaderboard

### Task 11: Add `@upstash/redis`, extend `tsconfig`/`eslint` to cover `api/`

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `eslint.config.js`

**Interfaces:** none (infra-only task).

- [ ] **Step 1: Add the dependency**

```bash
pnpm add @upstash/redis
```

Expected: `package.json`'s `"dependencies"` gains `"@upstash/redis": "^<version>"`
alongside `"three"`.

- [ ] **Step 2: Include `api/` in typecheck**

In `tsconfig.json`, change:

```json
  "include": ["src", "tests", "vite.config.ts", "playwright.config.ts", "eslint.config.js"]
```

to:

```json
  "include": ["src", "tests", "api", "vite.config.ts", "playwright.config.ts", "eslint.config.js"]
```

- [ ] **Step 3: Give `api/**` Node globals in ESLint**

In `eslint.config.js`, add a new block after the existing `files: ['*.config.ts', ...]`
block:

```js
  {
    files: ['api/**'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
```

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json eslint.config.js
git commit -m "chore: add @upstash/redis, cover api/ in typecheck and lint"
```

---

### Task 12: `GET /api/leaderboard`

**Files:**
- Create: `api/leaderboard.ts`

**Interfaces:**
- Consumes: `configFor` from `src/core` (only used in Task 13 for score bounds, not
  here).
- Produces: HTTP contract — `GET /api/leaderboard?mode=alltime&difficulty=normal` or
  `?mode=daily` → `200` with `LeaderboardEntry[]` JSON
  (`{ rank: number; playerId: string; nickname: string; score: number }[]`), or `503`
  `{ error: string }` if Redis isn't configured, or `400` `{ error: string }` on a
  bad `mode`/`difficulty`. Task 14's client wrapper is the consumer.

- [ ] **Step 1: Invoke the verification skill**

Before writing the handler, invoke the `vercel:vercel-functions` skill to confirm
the current recommended handler export signature (Web-standard
`Request`/`Response` vs. `@vercel/node`'s `VercelRequest`/`VercelResponse`) and
whether an explicit `export const config = { runtime: ... }` is still needed under
Fluid Compute. Also invoke `vercel:vercel-storage` (or `vercel:marketplace`) to
confirm `@upstash/redis`'s `Redis.fromEnv()` still reads the Marketplace-injected
env var names by default. Adjust Step 2 below if either skill's current guidance
differs from what's written here.

- [ ] **Step 2: Write the handler**

```ts
// api/leaderboard.ts
import { Redis } from '@upstash/redis';

const DIFFICULTIES = new Set(['easy', 'normal', 'hard']);

interface LeaderboardEntry {
  rank: number;
  playerId: string;
  nickname: string;
  score: number;
}

function redisOrNull(): Redis | null {
  try {
    return Redis.fromEnv();
  } catch {
    return null;
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode');
  const difficulty = url.searchParams.get('difficulty') ?? 'normal';

  if (mode !== 'alltime' && mode !== 'daily') {
    return Response.json({ error: 'invalid mode' }, { status: 400 });
  }
  if (mode === 'alltime' && !DIFFICULTIES.has(difficulty)) {
    return Response.json({ error: 'invalid difficulty' }, { status: 400 });
  }

  const redis = redisOrNull();
  if (!redis) {
    return Response.json({ error: 'leaderboard offline' }, { status: 503 });
  }

  const key = mode === 'alltime' ? `leaderboard:alltime:${difficulty}` : `leaderboard:daily:${todayKey()}`;

  const raw = await redis.zrange<(string | number)[]>(key, 0, 9, { rev: true, withScores: true });
  const playerIds: string[] = [];
  const scores: number[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    playerIds.push(String(raw[i]));
    scores.push(Number(raw[i + 1]));
  }

  const nicknames =
    playerIds.length > 0 ? await redis.hmget<Record<string, string>>('players', ...playerIds) : {};

  const entries: LeaderboardEntry[] = playerIds.map((playerId, i) => ({
    rank: i + 1,
    playerId,
    nickname: nicknames?.[playerId] ?? 'anon',
    score: scores[i] ?? 0,
  }));

  return Response.json(entries);
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors (given Task 11's `tsconfig.json`/`eslint.config.js` changes are
already in place).

- [ ] **Step 4: Commit**

```bash
git add api/leaderboard.ts
git commit -m "feat(api): add GET /api/leaderboard"
```

---

### Task 13: `POST /api/scores`

**Files:**
- Create: `api/scores.ts`

**Interfaces:**
- Consumes: `configFor` from `src/core` (for the real per-difficulty score cap).
- Produces: HTTP contract — `POST /api/scores` body
  `{ playerId: string; nickname: string; score: number; difficulty: 'easy'|'normal'|'hard'; mode: 'alltime'|'daily' }`
  → `200` `{ rank: number | null }` on success, `400` on invalid body, `429` if
  rate-limited, `503` if Redis isn't configured. Task 14's client wrapper is the
  consumer.

- [ ] **Step 1: Write the handler**

(Reuses the same verification-skill guidance from Task 12, Step 1 — do not repeat
the skill calls if already done this session.)

```ts
// api/scores.ts
import { Redis } from '@upstash/redis';
import { configFor, type Difficulty } from '../src/core';

const NICKNAME_MAX = 16;
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

interface ScoreSubmission {
  playerId: string;
  nickname: string;
  score: number;
  difficulty: Difficulty;
  mode: 'alltime' | 'daily';
}

function maxAchievableScore(difficulty: Difficulty): number {
  const config = configFor(difficulty);
  const tightest = config.maxGrid - 2 * config.maxMargin;
  return tightest * tightest - config.initialLength;
}

function isValidSubmission(body: unknown): body is ScoreSubmission {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.playerId !== 'string' || b.playerId.length === 0 || b.playerId.length > 64) return false;
  if (typeof b.nickname !== 'string' || b.nickname.length === 0) return false;
  if (typeof b.score !== 'number' || !Number.isInteger(b.score) || b.score < 0) return false;
  if (typeof b.difficulty !== 'string' || !DIFFICULTIES.includes(b.difficulty as Difficulty)) return false;
  if (b.mode !== 'alltime' && b.mode !== 'daily') return false;
  return b.score <= maxAchievableScore(b.difficulty as Difficulty);
}

function redisOrNull(): Redis | null {
  try {
    return Redis.fromEnv();
  } catch {
    return null;
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!isValidSubmission(body)) {
    return Response.json({ error: 'invalid submission' }, { status: 400 });
  }

  const redis = redisOrNull();
  if (!redis) {
    return Response.json({ error: 'leaderboard offline' }, { status: 503 });
  }

  const limited = await redis.set(`ratelimit:${body.playerId}`, 1, { nx: true, ex: 3 });
  if (limited === null) {
    return Response.json({ error: 'rate limited' }, { status: 429 });
  }

  const nickname = body.nickname.slice(0, NICKNAME_MAX);
  await redis.hset('players', { [body.playerId]: nickname });

  // Daily mode always targets today's board regardless of the client-sent
  // difficulty: the daily challenge is fixed to 'normal', and trusting a
  // client-sent difficulty here would let a submission dodge the shared board.
  const key = body.mode === 'daily' ? `leaderboard:daily:${todayKey()}` : `leaderboard:alltime:${body.difficulty}`;

  await redis.zadd(key, { gt: true }, { score: body.score, member: body.playerId });
  if (body.mode === 'daily') {
    await redis.expire(key, 60 * 60 * 24 * 4);
  }

  const rank = await redis.zrevrank(key, body.playerId);
  return Response.json({ rank: rank === null ? null : rank + 1 });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add api/scores.ts
git commit -m "feat(api): add POST /api/scores with validation and rate-limiting"
```

---

### Task 14: `platform/leaderboard.ts` — client wrapper, fails soft

**Files:**
- Create: `src/platform/leaderboard.ts`
- Test: `tests/unit/leaderboard.test.ts`

**Interfaces:**
- Consumes: global `fetch` (Node 22 provides it natively — no jsdom pragma needed).
- Produces:
  `interface LeaderboardEntry { readonly rank: number; readonly playerId: string; readonly nickname: string; readonly score: number }`,
  `type LeaderboardMode = 'alltime' | 'daily'`,
  `function fetchLeaderboard(mode: LeaderboardMode, difficulty: Difficulty): Promise<LeaderboardEntry[] | null>`,
  `function submitScore(mode: LeaderboardMode, difficulty: Difficulty, score: number, player: { id: string; nickname: string }): Promise<{ rank: number | null }>`.
  Task 15 (`StatsPanel`) consumes `fetchLeaderboard`; Task 19 consumes `submitScore`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/leaderboard.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLeaderboard, submitScore } from '../../src/platform/leaderboard';

afterEach(() => vi.unstubAllGlobals());

describe('fetchLeaderboard', () => {
  it('returns the parsed array on success', async () => {
    const entries = [{ rank: 1, playerId: 'a', nickname: 'A', score: 42 }];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(entries) }),
    );
    expect(await fetchLeaderboard('alltime', 'normal')).toEqual(entries);
  });

  it('returns null on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await fetchLeaderboard('alltime', 'normal')).toBeNull();
  });

  it('returns null when fetch throws (offline)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchLeaderboard('daily', 'normal')).toBeNull();
  });

  it('returns null on malformed JSON (not an array)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ oops: true }) }),
    );
    expect(await fetchLeaderboard('alltime', 'hard')).toBeNull();
  });
});

describe('submitScore', () => {
  it('posts the right payload and returns the rank', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ rank: 2 }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitScore('alltime', 'hard', 30, { id: 'p1', nickname: 'Foo' });

    expect(result).toEqual({ rank: 2 });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/scores',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: 'p1',
          nickname: 'Foo',
          score: 30,
          difficulty: 'hard',
          mode: 'alltime',
        }),
      }),
    );
  });

  it('returns a null rank on failure or network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
    expect(await submitScore('daily', 'normal', 5, { id: 'p1', nickname: 'Foo' })).toEqual({ rank: null });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    expect(await submitScore('daily', 'normal', 5, { id: 'p1', nickname: 'Foo' })).toEqual({ rank: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/leaderboard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/platform/leaderboard.ts
import type { Difficulty } from '../core/types';

export type LeaderboardMode = 'alltime' | 'daily';

export interface LeaderboardEntry {
  readonly rank: number;
  readonly playerId: string;
  readonly nickname: string;
  readonly score: number;
}

export async function fetchLeaderboard(
  mode: LeaderboardMode,
  difficulty: Difficulty,
): Promise<LeaderboardEntry[] | null> {
  try {
    const params = new URLSearchParams({ mode, difficulty });
    const res = await fetch(`/api/leaderboard?${params.toString()}`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return Array.isArray(data) ? (data as LeaderboardEntry[]) : null;
  } catch {
    return null;
  }
}

export interface SubmitResult {
  readonly rank: number | null;
}

export async function submitScore(
  mode: LeaderboardMode,
  difficulty: Difficulty,
  score: number,
  player: { id: string; nickname: string },
): Promise<SubmitResult> {
  try {
    const res = await fetch('/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: player.id,
        nickname: player.nickname,
        score,
        difficulty,
        mode,
      }),
    });
    if (!res.ok) return { rank: null };
    const data: unknown = await res.json();
    const rank = data && typeof (data as { rank?: unknown }).rank === 'number' ? (data as { rank: number }).rank : null;
    return { rank };
  } catch {
    return { rank: null };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/leaderboard.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/platform/leaderboard.ts tests/unit/leaderboard.test.ts
git commit -m "feat(platform): add fail-soft leaderboard client"
```

---

## Phase D — StatsPanel UI

### Task 15: `StatsPanel` modal — Today / All-Time / Achievements tabs

**Files:**
- Create: `src/ui/statsPanel.ts`
- Modify: `src/styles/style.css`

**Interfaces:**
- Consumes: `fetchLeaderboard` (Task 14), `ACHIEVEMENTS` + `loadUnlockedAchievements`
  (Tasks 7, 9), `el` from `./dom`.
- Produces:
  `interface StatsPanelHandlers { onVisibilityChange(open: boolean): void }`,
  `class StatsPanel { constructor(parent: HTMLElement, initialDifficulty: Difficulty, handlers: StatsPanelHandlers); open(playerId: string): void; close(): void }`.
  Task 16 wires `Toolbar.onLeaderboardClick` to `statsPanel.open(playerId)`.

- [ ] **Step 1: Write `src/ui/statsPanel.ts`**

```ts
import type { Difficulty } from '../core/types';
import { ACHIEVEMENTS, loadUnlockedAchievements } from '../platform/achievements';
import { fetchLeaderboard, type LeaderboardEntry, type LeaderboardMode } from '../platform/leaderboard';
import { el } from './dom';

export interface StatsPanelHandlers {
  onVisibilityChange(open: boolean): void;
}

type Tab = LeaderboardMode | 'achievements';
const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'daily', label: 'Today' },
  { id: 'alltime', label: 'All-Time' },
  { id: 'achievements', label: 'Achievements' },
];
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** Modal: leaderboard (today + all-time) and achievements, tabbed. */
export class StatsPanel {
  private readonly panel: HTMLElement;
  private readonly body: HTMLElement;
  private readonly difficultySeg: HTMLElement;
  private readonly tabButtons = new Map<Tab, HTMLButtonElement>();
  private readonly difficultyButtons = new Map<Difficulty, HTMLButtonElement>();
  private activeTab: Tab = 'daily';
  private playerId = '';

  constructor(
    parent: HTMLElement,
    private activeDifficulty: Difficulty,
    private readonly handlers: StatsPanelHandlers,
  ) {
    const tabRow = el('div', { className: 'seg' });
    for (const tab of TABS) {
      const button = el('button', { text: tab.label }) as HTMLButtonElement;
      button.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.render();
      });
      this.tabButtons.set(tab.id, button);
      tabRow.appendChild(button);
    }

    this.difficultySeg = el('div', { className: 'seg' });
    for (const difficulty of DIFFICULTIES) {
      const button = el('button', { text: difficulty }) as HTMLButtonElement;
      button.addEventListener('click', () => {
        this.activeDifficulty = difficulty;
        this.render();
      });
      this.difficultyButtons.set(difficulty, button);
      this.difficultySeg.appendChild(button);
    }

    this.body = el('div', { id: 'stats-body' });
    const close = el('button', { className: 'close-btn', text: 'Close' });
    close.addEventListener('click', () => this.close());

    this.panel = el(
      'div',
      { id: 'stats-panel', className: 'hidden' },
      el('h2', { text: 'Stats' }),
      tabRow,
      this.difficultySeg,
      this.body,
      close,
    );
    parent.appendChild(this.panel);
  }

  open(playerId: string): void {
    this.playerId = playerId;
    this.panel.classList.remove('hidden');
    this.handlers.onVisibilityChange(true);
    this.render();
  }

  close(): void {
    this.panel.classList.add('hidden');
    this.handlers.onVisibilityChange(false);
  }

  private render(): void {
    for (const [id, button] of this.tabButtons) button.classList.toggle('active', id === this.activeTab);
    for (const [id, button] of this.difficultyButtons) {
      button.classList.toggle('active', id === this.activeDifficulty);
    }
    this.difficultySeg.style.display = this.activeTab === 'alltime' ? 'flex' : 'none';

    if (this.activeTab === 'achievements') {
      this.renderAchievements();
      return;
    }
    this.body.textContent = 'Loading…';
    void fetchLeaderboard(this.activeTab, this.activeDifficulty).then((entries) => {
      this.renderLeaderboard(entries);
    });
  }

  private renderLeaderboard(entries: LeaderboardEntry[] | null): void {
    this.body.textContent = '';
    if (!entries) {
      this.body.appendChild(el('div', { className: 'stats-empty', text: 'Leaderboard offline — play on!' }));
      return;
    }
    if (entries.length === 0) {
      this.body.appendChild(el('div', { className: 'stats-empty', text: 'No scores yet — be the first!' }));
      return;
    }
    for (const entry of entries) {
      const row = el(
        'div',
        { className: 'stats-row' },
        el('span', { className: 'stats-rank', text: `#${String(entry.rank)}` }),
        el('span', { className: 'stats-name', text: entry.nickname }),
        el('span', { className: 'stats-score', text: String(entry.score) }),
      );
      if (entry.playerId === this.playerId) row.classList.add('me');
      this.body.appendChild(row);
    }
  }

  private renderAchievements(): void {
    this.body.textContent = '';
    const unlocked = loadUnlockedAchievements();
    for (const def of ACHIEVEMENTS) {
      const isUnlocked = unlocked.has(def.id);
      const row = el(
        'div',
        { className: `achievement-row${isUnlocked ? ' unlocked' : ''}` },
        el('span', { className: 'achievement-name', text: def.name }),
        el('span', { className: 'achievement-desc', text: def.description }),
      );
      this.body.appendChild(row);
    }
  }
}
```

- [ ] **Step 2: Add CSS**

In `src/styles/style.css`, after the existing `.close-btn { ... }` block, add:

```css
/* ---------- Stats panel ---------- */
#stats-panel {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 16px;
  background: rgba(4, 1, 8, 0.92);
  z-index: 30;
  transition: opacity 0.25s ease;
  padding: 20px;
}

#stats-panel.hidden {
  opacity: 0;
  pointer-events: none;
}

#stats-body {
  width: min(360px, 90vw);
  max-height: 46vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stats-row {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid rgba(25, 246, 255, 0.2);
  border-radius: 8px;
  font-size: 14px;
}

.stats-row.me {
  border-color: var(--cyan);
  box-shadow: 0 0 12px rgba(25, 246, 255, 0.25);
}

.stats-rank {
  opacity: 0.7;
}

.stats-score {
  color: var(--magenta);
  font-weight: 700;
}

.stats-empty {
  opacity: 0.7;
  font-size: 14px;
  text-align: center;
  padding: 20px 0;
}

.achievement-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid rgba(157, 75, 255, 0.25);
  border-radius: 8px;
  opacity: 0.45;
}

.achievement-row.unlocked {
  opacity: 1;
  border-color: var(--purple);
  box-shadow: 0 0 12px rgba(157, 75, 255, 0.25);
}

.achievement-name {
  font-weight: 700;
  letter-spacing: 1px;
}

.achievement-desc {
  font-size: 12px;
  opacity: 0.8;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/ui/statsPanel.ts src/styles/style.css
git commit -m "feat(ui): add StatsPanel (leaderboard + achievements modal)"
```

---

### Task 16: Wire the 🏆 toolbar icon to `StatsPanel`

**Files:**
- Modify: `src/app/main.ts`

**Interfaces:**
- Consumes: `StatsPanel` (Task 15), `Toolbar` (Task 3/4), `loadPlayerId` (Task 10).

- [ ] **Step 1: Construct `StatsPanel` and wire the handler**

In `src/app/main.ts`, add the import:

```ts
import { StatsPanel } from '../ui/statsPanel';
import { loadPlayerId } from '../platform/storage';
```

Right after the `settingsPanel` construction from Task 4 and before the `toolbar`
construction, add:

```ts
  const playerId = loadPlayerId();
  const statsPanel = new StatsPanel(uiRoot, activeDifficulty, {
    onVisibilityChange(open) {
      if (open && state.phase === 'playing') dispatch({ type: 'pause' });
    },
  });
```

Then change the `toolbar` construction's `onLeaderboardClick` from the Task 4
placeholder to:

```ts
  const toolbar = new Toolbar(uiRoot, {
    onLeaderboardClick: () => statsPanel.open(playerId),
    onSettingsClick: () => settingsPanel.open(),
  });
```

- [ ] **Step 2: Typecheck and build**

Run: `pnpm typecheck && pnpm build`
Expected: no errors.

- [ ] **Step 3: Verify visually**

`pnpm preview --port 4321`, click 🏆 in the toolbar: the modal opens showing "Today"
(likely "Leaderboard offline" until Phase F's Upstash provisioning), switch to
"All-Time" (difficulty selector appears), switch to "Achievements" (11 dim rows,
none unlocked yet). Screenshot as evidence.

- [ ] **Step 4: Commit**

```bash
git add src/app/main.ts
git commit -m "feat(app): wire the leaderboard toolbar icon to StatsPanel"
```

---

## Phase E — Achievement toasts, daily challenge, streak

### Task 17: `AchievementToast` — unlock banner

**Files:**
- Create: `src/ui/achievementToast.ts`
- Modify: `src/styles/style.css`

**Interfaces:**
- Produces: `class AchievementToast { constructor(root: HTMLElement); show(def: AchievementDef): void }`.
  Task 18's `AchievementTracker` is the consumer.

- [ ] **Step 1: Write `src/ui/achievementToast.ts`**

```ts
import type { AchievementDef } from '../platform/achievements';
import { el } from './dom';

const REMOVE_MS = 3700;

/** Slide-in banner announcing a newly unlocked achievement. */
export class AchievementToast {
  private readonly layer: HTMLElement;

  constructor(root: HTMLElement) {
    this.layer = el('div', { id: 'achievement-toasts' });
    root.appendChild(this.layer);
  }

  show(def: AchievementDef): void {
    const node = el(
      'div',
      { className: 'achievement-toast' },
      el('div', { className: 'achievement-toast-title', text: 'Achievement unlocked' }),
      el('div', { className: 'achievement-toast-name', text: def.name }),
    );
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), REMOVE_MS);
    this.layer.appendChild(node);
  }
}
```

- [ ] **Step 2: Add CSS**

In `src/styles/style.css`, after the `#popups`/`.score-popup` block, add:

```css
/* ---------- Achievement toasts ---------- */
#achievement-toasts {
  position: fixed;
  top: calc(var(--toolbar-h) + env(safe-area-inset-top) + 14px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  z-index: 22;
}

.achievement-toast {
  padding: 10px 20px;
  border: 1px solid rgba(157, 75, 255, 0.5);
  border-radius: 10px;
  background: rgba(8, 2, 15, 0.92);
  box-shadow: 0 0 20px rgba(157, 75, 255, 0.3);
  text-align: center;
  animation: toast-lifecycle 3.4s ease-in-out forwards;
}

.achievement-toast-title {
  font-size: 11px;
  letter-spacing: 2px;
  text-transform: uppercase;
  opacity: 0.75;
}

.achievement-toast-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--purple);
  text-shadow: 0 0 10px rgba(157, 75, 255, 0.6);
}

@keyframes toast-lifecycle {
  0% {
    opacity: 0;
    transform: translateY(-14px);
  }
  10%,
  85% {
    opacity: 1;
    transform: translateY(0);
  }
  100% {
    opacity: 0;
    transform: translateY(-14px);
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/ui/achievementToast.ts src/styles/style.css
git commit -m "feat(ui): add achievement-unlock toast"
```

---

### Task 18: `AchievementTracker` — glue pure evaluators to live gameplay

**Files:**
- Create: `src/app/achievementTracker.ts`

**Interfaces:**
- Consumes: `GameState` (from `../core/types`), `evaluateRunAchievements`,
  `loadUnlockedAchievements`, `unlockAchievements`, `ACHIEVEMENTS` (Tasks 7-9).
- Produces:
  `class AchievementTracker { constructor(onUnlock: (defs: AchievementDef[]) => void); onStateChange(prev: GameState, next: GameState): void }`.
  Task 19 constructs one in `main.ts` and calls `onStateChange` from the existing
  `onStateChange` hook.

- [ ] **Step 1: Write `src/app/achievementTracker.ts`**

```ts
import type { GameState } from '../core/types';
import {
  ACHIEVEMENTS,
  evaluateRunAchievements,
  loadUnlockedAchievements,
  unlockAchievements,
  type AchievementDef,
} from '../platform/achievements';

/**
 * Observes GameState transitions and unlocks run-scoped achievements. Owns the
 * small amount of cross-tick state those rules need (pending-shrink survivals,
 * the score at the start of the current run) — everything else stays pure in
 * `platform/achievements.ts`.
 */
export class AchievementTracker {
  private pendingShrinkSurvivals = 0;
  private bestAtRunStart = 0;

  constructor(private readonly onUnlock: (defs: AchievementDef[]) => void) {}

  onStateChange(prev: GameState, next: GameState): void {
    if (next.phase === 'playing' && (prev.phase === 'ready' || prev.phase === 'gameover')) {
      this.bestAtRunStart = prev.best;
      this.pendingShrinkSurvivals = 0;
    }
    if (prev.pendingShrink && !next.pendingShrink && next.arenaMargin > prev.arenaMargin) {
      this.pendingShrinkSurvivals++;
    }

    const unlocked = loadUnlockedAchievements();
    const newlyUnlockedIds = evaluateRunAchievements(
      {
        nextScore: next.score,
        won: next.phase === 'gameover' && next.won,
        isGameOver: next.phase === 'gameover' && prev.phase !== 'gameover',
        bestAtRunStart: this.bestAtRunStart,
        pendingShrinkSurvivals: this.pendingShrinkSurvivals,
        hour: new Date().getHours(),
      },
      unlocked,
    );

    this.applyUnlocks(newlyUnlockedIds);
  }

  /** Also used by Task 19 for streak/leaderboard-rank unlocks, which fire outside onStateChange. */
  applyUnlocks(ids: readonly string[]): void {
    if (ids.length === 0) return;
    unlockAchievements(ids);
    const defs = ACHIEVEMENTS.filter((def) => ids.includes(def.id));
    this.onUnlock(defs);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/achievementTracker.ts
git commit -m "feat(app): add AchievementTracker gluing pure evaluators to gameplay"
```

---

### Task 19: Daily-challenge CTA, streak display, score submission, achievement wiring

**Files:**
- Modify: `src/app/main.ts`
- Modify: `src/ui/overlay.ts`
- Modify: `src/ui/settings.ts`
- Modify: `src/core/index.ts` (re-export check only, see Step 1)

**Interfaces:**
- Consumes: `dailySeed`, `currentStreak`, `recordDailyPlay` (Task 5-6),
  `submitScore` (Task 14), `AchievementTracker` (Task 18),
  `evaluateStreakAchievements`, `evaluateLeaderboardAchievements` (Task 8),
  `AchievementToast` (Task 17), `loadOrCreateNickname`/`saveNickname` (Task 10).
- Produces: `Overlay.showReady(streak: number): void` (signature change — see Step
  2), and a `Overlay.setDailyChallengeHandler(fn: () => void): void` used once at
  construction; `SettingsPanel` gains a nickname field wired through its existing
  `onChange` handler shape (see Step 4).

- [ ] **Step 1: Confirm `createInitialState` accepts a plain seed**

No code change — this step is a verification read. Open `src/core/game.ts` and
confirm `NewGameOptions` has `readonly seed?: number` and `createInitialState` passes
it straight to `createRng(seed)`. This is already true (see `src/core/game.ts:41,48`)
— daily mode will call
`createInitialState({ seed: dailySeed(new Date()), config: configFor('normal'), best: state.best })`
with no core changes needed.

- [ ] **Step 2: `Overlay` gains a daily-challenge CTA and streak line**

In `src/ui/overlay.ts`, add a new field and a new constructor parameter:

```ts
export class Overlay {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly subtitleEl: HTMLElement;
  private readonly instructionsEl: HTMLElement;
  private readonly finalScoreEl: HTMLElement;
  private readonly ctaEl: HTMLElement;
  private readonly dailyCtaEl: HTMLElement;

  constructor(
    parent: HTMLElement,
    onPrimary: () => void,
    private readonly onDailyChallenge: () => void,
  ) {
```

After the existing `this.ctaEl = el(...)` line, add:

```ts
    this.dailyCtaEl = el('div', { id: 'daily-cta', className: 'daily-cta' });
    this.dailyCtaEl.addEventListener('click', (event) => {
      event.stopPropagation(); // don't also trigger onPrimary via the root's click listener
      this.onDailyChallenge();
    });
```

Add `this.dailyCtaEl` to the `el('div', { id: 'overlay' }, ...)` children list, right
after `this.ctaEl`.

Change `showReady()`'s signature and body:

```ts
  showReady(streak: number): void {
    this.setScreen({ title: 'NEON SNAKE', subtitle: true, instructions: true });
    this.finalScoreEl.style.display = 'none';
    this.ctaEl.textContent = 'Press SPACE to start';
    this.dailyCtaEl.textContent =
      streak > 0 ? `🔥 Today's Challenge (${String(streak)}-day streak)` : "🔥 Today's Challenge";
    this.dailyCtaEl.style.display = '';
    this.reveal();
  }
```

Hide it on every other screen — in `showPaused()` and `showGameOver()`, add
`this.dailyCtaEl.style.display = 'none';` right after each's `this.finalScoreEl...`
line.

- [ ] **Step 3: CSS for the daily CTA**

In `src/styles/style.css`, after the `.cta { ... }` / `@keyframes pulse { ... }`
blocks, add:

```css
.daily-cta {
  margin-top: 14px;
  font-size: 14px;
  letter-spacing: 1px;
  padding: 8px 16px;
  border: 1px solid rgba(255, 226, 75, 0.4);
  border-radius: 10px;
  background: rgba(255, 226, 75, 0.08);
  color: #ffe24b;
  cursor: pointer;
  pointer-events: auto;
}

.daily-cta:hover {
  background: rgba(255, 226, 75, 0.18);
}
```

- [ ] **Step 4: `SettingsPanel` gains a nickname field**

In `src/ui/settings.ts`, add the import and a new field/row. Change the imports line:

```ts
import { loadOrCreateNickname, saveNickname } from '../platform/storage';
```

Add a `nicknameInput` field and build it in the constructor, right before the
`close` button is built:

```ts
    const nicknameInput = el('input', { className: 'nickname-input' }) as HTMLInputElement;
    nicknameInput.type = 'text';
    nicknameInput.maxLength = 16;
    nicknameInput.value = loadOrCreateNickname();
    nicknameInput.addEventListener('change', () => {
      const trimmed = nicknameInput.value.trim() || loadOrCreateNickname();
      nicknameInput.value = trimmed;
      saveNickname(trimmed);
    });
```

Add a new row to the panel's children, right after the existing `setting-row` for
Difficulty:

```ts
      el('div', { className: 'setting-row' }, el('label', { text: 'Nickname' }), nicknameInput),
```

Add matching CSS in `src/styles/style.css`, near `.setting-row label`:

```css
.nickname-input {
  border: 1px solid rgba(25, 246, 255, 0.4);
  border-radius: 8px;
  background: rgba(25, 246, 255, 0.06);
  color: var(--cyan);
  font: inherit;
  font-size: 13px;
  padding: 8px 10px;
  width: 140px;
}
```

- [ ] **Step 5: Wire everything in `main.ts`**

Add imports:

```ts
import { AchievementTracker } from './achievementTracker';
import { AchievementToast } from '../ui/achievementToast';
import { dailySeed, currentStreak, recordDailyPlay } from '../platform/daily';
import { submitScore, type LeaderboardMode } from '../platform/leaderboard';
import {
  evaluateLeaderboardAchievements,
  evaluateStreakAchievements,
  loadUnlockedAchievements,
} from '../platform/achievements';
import { loadOrCreateNickname } from '../platform/storage';
```

Add a `let isDailyRun = false;` near the top of `bootstrap()`, alongside the existing
`let activeDifficulty = ...` and `let acc = 0;` declarations.

Construct the toast and tracker right after `const popups = new ScorePopups(uiRoot);`:

```ts
  const achievementToast = new AchievementToast(uiRoot);
  const achievementTracker = new AchievementTracker((defs) => {
    for (const def of defs) achievementToast.show(def);
  });
```

In `onStateChange`, right after the existing `if (next.score > prev.score) { ... }`
block, add:

```ts
    achievementTracker.onStateChange(prev, next);
```

Still in `onStateChange`, find the `else if (next.phase === 'gameover')` branch:

```ts
      else if (next.phase === 'gameover') {
        overlay.showGameOver(next.score, next.score >= next.best && next.score > 0, next.won);
      }
```

Replace it with a version that submits the score and shows rank achievements once
the submission resolves — without ever blocking the synchronous overlay update:

```ts
      else if (next.phase === 'gameover') {
        overlay.showGameOver(next.score, next.score >= next.best && next.score > 0, next.won);
        const mode: LeaderboardMode = isDailyRun ? 'daily' : 'alltime';
        const nickname = loadOrCreateNickname();
        void submitScore(mode, activeDifficulty, next.score, { id: playerId, nickname }).then(
          ({ rank }) => {
            const unlocked = loadUnlockedAchievements();
            achievementTracker.applyUnlocks(evaluateLeaderboardAchievements(rank, unlocked));
          },
        );
        if (isDailyRun) {
          const streak = recordDailyPlay();
          const unlocked = loadUnlockedAchievements();
          achievementTracker.applyUnlocks(evaluateStreakAchievements(streak.count, unlocked));
        }
      }
```

`loadUnlockedAchievements` used above is already in the import block added at the
start of this step.

Update every `overlay.showReady()` call (there are two: in `onStateChange`'s
`next.phase === 'ready'` branch, and in `startFreshGame`) to
`overlay.showReady(currentStreak())`.

Update the `Overlay` construction to pass the new third constructor argument:

```ts
  const overlay = new Overlay(uiRoot, controls.primary, () => {
    isDailyRun = true;
    state = { ...createInitialState({ seed: dailySeed(new Date()), config: configFor('normal'), best: state.best }), phase: 'playing' };
    acc = 0;
    onDailyStart();
  });
```

This inline state assignment bypasses `dispatch`/`reduce` deliberately (starting a
daily run is a seed/config swap, not a `GameAction` — the existing action union in
`src/core/types.ts` has no "start with a specific seed" action, and adding one would
put date-hashing inside `core`, violating its purity). Because it bypasses
`dispatch`, it must manually do what `onStateChange` would have done for a normal
`start`: resync the renderer and reset the HUD. Add a small local helper right above
the `overlay` construction:

```ts
  function onDailyStart(): void {
    overlay.hide();
    renderer.sync(state);
    toolbar.setScore(state.score);
    toolbar.setBest(state.best);
  }
```

Finally, every regular (non-daily) run must reset `isDailyRun`. In `controls.primary`,
change:

```ts
    primary() {
      sfx.resume();
      if (state.phase === 'paused') dispatch({ type: 'resume' });
      else if (state.phase !== 'playing') dispatch({ type: 'start' });
    },
```

to:

```ts
    primary() {
      sfx.resume();
      if (state.phase === 'paused') dispatch({ type: 'resume' });
      else if (state.phase !== 'playing') {
        isDailyRun = false;
        dispatch({ type: 'start' });
      }
    },
```

and in `startFreshGame` (difficulty change), add `isDailyRun = false;` as its first
line.

- [ ] **Step 6: Typecheck and build**

Run: `pnpm typecheck && pnpm build`
Expected: no errors. This is the largest wiring task in the plan — if the compiler
flags an unused import or a stale `hud`/`toolbar` reference, fix it before moving on;
do not suppress with `// eslint-disable`.

- [ ] **Step 7: Run the full unit suite**

Run: `pnpm test`
Expected: all suites pass, including every test added in Tasks 5-14.

- [ ] **Step 8: Verify visually**

`pnpm preview --port 4321`: on the ready screen, confirm the "🔥 Today's Challenge"
CTA appears below the normal start prompt; click it and confirm the game starts
immediately (no need to press Space); play a normal run to game-over and confirm no
console errors even with the leaderboard offline (Phase F not done yet — `submitScore`
must fail soft and the game-over overlay must still show normally). Screenshot both
states as evidence.

- [ ] **Step 9: Commit**

```bash
git add src/app/main.ts src/ui/overlay.ts src/ui/settings.ts src/styles/style.css
git commit -m "feat(app): wire daily challenge, streak, score submission and achievement unlocks"
```

---

## Phase F — Manual handoff and end-to-end verification

### Task 20: Upstash Redis provisioning handoff (manual, not code)

**Files:** none — this task produces instructions, not a commit.

- [ ] **Step 1: Hand the user exact steps**

When implementation reaches this task, stop and give the user this checklist (do not
attempt any of it programmatically — it's a cost-bearing third-party integration
requiring their Vercel dashboard login):

1. Open the `snake-3d` project in the Vercel dashboard → **Storage** tab → **Create
   Database** → choose **Upstash** → **Redis** (or **Marketplace** →
   search "Upstash").
2. Pick the free tier, region closest to the friend group, confirm.
3. Vercel auto-injects the Redis REST env vars into the project (exact names
   confirmed by the `vercel:vercel-storage` skill invocation back in Task 12 —
   typically `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, which is what
   `Redis.fromEnv()` reads by default).
4. Redeploy (`vercel --prod` or push to `main` — the project's Git integration
   auto-deploys) so the new Functions pick up the env vars.
5. Confirm: open the deployed app, click 🏆 → Today/All-Time should show "No scores
   yet — be the first!" instead of "Leaderboard offline".

- [ ] **Step 2: Wait for confirmation before Task 21**

Do not proceed to end-to-end leaderboard verification until the user confirms step 5
above, or explicitly says to verify the offline-fallback path only.

---

### Task 21: End-to-end verification

**Files:** none (verification only) — may extend
`.claude/skills/verify/verify-oracle.js`.

- [ ] **Step 1: Full local gate**

Run in sequence:

```bash
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm lint
pnpm build
pnpm e2e
```

Expected: all green. `test:coverage`'s 90/85/90/90 gate only covers `src/core/**`,
untouched by this plan, so it should be unaffected.

- [ ] **Step 2: Extend the deterministic oracle bot**

Adapt `.claude/skills/verify/verify-oracle.js` (built in the previous session for the
shrink/popup verification) to also: click the 🏆 icon and screenshot each of the
three tabs; click "Today's Challenge" from the ready screen and confirm the run
starts instantly; play to game-over and check the DOM for an achievement-toast
element having appeared at least once (e.g. trigger `first-bite` by eating one food);
re-open Settings and confirm the nickname field is pre-filled and editable.

- [ ] **Step 3: Verify against the live deployment**

Once Task 20 is confirmed done and a deploy has gone out, repeat the leaderboard
portion of Step 2 against the production URL instead of a local preview: submit a
real score, reload, confirm it appears in "All-Time" for the right difficulty, and
that opening the game on a second (incognito) session lets you pick a different
nickname and see both entries.

- [ ] **Step 4: Report**

Summarize pass/fail per the project's `verify` skill report format (Verdict, Method,
Steps with ✅/🔍, Findings) — this closes out the plan.
