# Neon Snake 3D — Engagement Redesign

**Date:** 2026-07-08
**Goal:** Fix the settings-button/HUD collision introduced by the previous camera-framing
fix, and layer a real engagement system on top so the friend group playing this
(Matheus, Clei, Diego, and others) has a reason to keep coming back — not just a
one-off polish pass.

## Decisions (locked, from stakeholder Q&A)

- **Settings/HUD layout:** persistent solid toolbar at the top of the screen, not
  free-floating text over the 3D canvas.
- **Primary engagement lever:** real social competition between friends (a shared
  leaderboard), not solo progression or habit-forming alone.
- **Backend:** yes — a lightweight one (Upstash Redis via Vercel Marketplace), no
  user accounts/passwords.
- **Scope:** go deep in one round — leaderboard + achievements + daily challenge +
  streak, all together, not staged across sessions.

## Problem statement

1. **Regression:** the camera-framing fix (`cameraTargetZ`, prior session) tilted the
   view down to stop cropping the bottom row. That pushed the board's far (back) edge
   higher on screen, and it now visually collides with `#settings-btn`, which is
   fixed top-center independent of the 3D scene. `#score`/`#best` don't collide
   because the board's trapezoid is narrower at the top — only the dead-center
   button does.
2. **No reason to return:** today the game is single-player, single-device. `best`
   lives in `localStorage` per browser — nobody can see anyone else's score. The
   WhatsApp group already compares runs manually by texting each other; the product
   does nothing to support that.

## Non-goals

- No accounts/passwords — a client-generated `playerId` (UUID) plus an editable
  nickname is the entire identity model.
- No server-authoritative anti-cheat. Scores are client-reported; the server does
  basic sanity bounds + rate-limiting, not replay verification. Acceptable given
  this is a small trusted friend group, not a public leaderboard.
- No public/global leaderboard — only people with the link and the game installed.

## Architecture overview

```
┌─ toolbar (new) ──────────────────────────────────────────┐
│ SCORE            🏆 leaderboard   ⚙ settings       BEST  │
└────────────────────────────────────────────────────────────┘
┌─ #app (canvas, now starts BELOW the toolbar) ──────────────┐
│                                                              │
│                     3D board (unchanged core/rendering)     │
│                                                              │
└──────────────────────────────────────────────────────────┘

client                                  Vercel Functions        Upstash Redis
──────                                  ────────────────        ─────────────
platform/leaderboard.ts  ──POST /api/scores──▶  validate,        ZADD GT
  (fetch, fails soft)                            rate-limit  ──▶ leaderboard:alltime:<difficulty>
                                                                  leaderboard:daily:<date>
                         ──GET /api/leaderboard──▶ read top N ◀── players (nickname hash)
```

`src/core` is untouched — no simulation rules change. Daily challenge reuses
`createInitialState({ seed })`, which already accepts an arbitrary seed; only the
seed's *source* changes (date hash instead of `Date.now()`). Achievements and
streaks observe state transitions in `main.ts`'s existing `onStateChange` hook, the
same place the eat-popup trigger already lives — no new coupling into the reducer.

## 1. Toolbar (fixes the regression, becomes the foundation)

Replace `Hud` + the free-floating `#settings-btn` with one `Toolbar` component: a
solid ~56px bar (dark gradient + backdrop-blur, subtle neon bottom border), safe-area
aware, containing `SCORE | 🏆 | ⚙ | BEST`. The 3D canvas's container (`#app`) moves
to `top: var(--toolbar-h)` so the board render area starts *below* the bar instead of
being covered by it.

`SceneRig` currently sizes itself from `window.innerWidth/innerHeight`. It switches to
reading the `#app` container's `clientWidth/clientHeight` instead (stored as a field,
set once in the constructor). The pure camera math (`cameraFitDistance`,
`cameraTargetZ` in `cameraFit.ts`) is untouched — only the values fed into it change
source. This is the root-cause fix: any future top-anchored UI can never again overlap
the board, at any aspect ratio, because the board's own viewport no longer includes
that space.

`Toolbar` keeps the same public API `Hud` had (`setScore`, `setBest`) so `main.ts`'s
wiring barely changes; it gains `onLeaderboardClick`/`onSettingsClick` handlers wired
to the new `StatsPanel` and existing `SettingsPanel`.

## 2. Leaderboard

**Identity.** First launch generates `crypto.randomUUID()` as `playerId`, stored in
`localStorage` forever. A nickname (max 16 chars, editable anytime from Settings) is
just the display label attached to it — changing it never loses history or rank.

**Data model (Redis, via `@upstash/redis`):**
- `leaderboard:alltime:<difficulty>` — sorted set, member `playerId`, score = that
  player's best on that difficulty. Write with `ZADD ... GT` so a submission only
  updates the entry if it's actually higher.
- `leaderboard:daily:<date>` — sorted set, same shape, `EXPIRE` set on first write
  (~4 days TTL) so old daily boards don't accumulate forever.
- `players` — one hash, `playerId → nickname`, so reading a leaderboard resolves
  display names with a single `HMGET` instead of N round-trips.
- `ratelimit:<playerId>` — `SET ... NX EX 3` guard before accepting a submission.

**API (Vercel Functions, framework-agnostic — this project deploys as a static Vite
build, and `/api/*.ts` at the repo root works alongside that with zero extra config):**
- `POST /api/scores` — body `{ playerId, nickname, score, difficulty, mode }` where
  `mode` is `'alltime' | 'daily'`. `difficulty` is required for `'alltime'`
  (`easy | normal | hard`, selects which sorted set to update); for `'daily'` the
  server ignores whatever the client sends and always writes to
  `leaderboard:daily:<date>` — the daily challenge is only ever normal difficulty,
  and trusting a client-sent difficulty there would let a submission skip the fixed
  board entirely. Validates `score` is an integer in `[0, 500]` (well above any real
  achievable score — see the config table in `core/config.ts`), rate-limits, then
  `ZADD GT` into the right sorted set(s) and updates `players`.
- `GET /api/leaderboard?mode=alltime&difficulty=normal` or `?mode=daily` — reads top
  10 via `ZREVRANGE ... WITHSCORES`, resolves nicknames, returns
  `{ rank, playerId, nickname, score }[]`.
- If Redis env vars are absent (not yet provisioned), both routes return a clear
  `503` with a machine-readable reason; the client shows "Leaderboard offline" and
  the rest of the game is unaffected. This means everything below can be built and
  shipped before the manual provisioning step happens.

**Client (`src/platform/leaderboard.ts`):** thin fetch wrapper, every call wrapped so
a network failure or 503 never throws into game code — it resolves to `null`/`[]` and
callers treat that as "unavailable," matching the existing `safeGet`/`safeSet`
pattern in `platform/storage.ts`.

**UI:** the 🏆 toolbar icon opens `StatsPanel`, a modal reusing `SettingsPanel`'s
visual language, with three tabs: **Today**, **All-Time** (with the existing
easy/normal/hard segmented control, reused from Settings, since the three
difficulties have very different max-achievable-score ceilings and aren't
comparable), and **Achievements**. The current player's row is highlighted in both
leaderboard tabs.

On game over, once the async submission resolves, if the run improved the player's
rank, `Overlay.showGameOver` gets an extra best-effort line ("New rank: #2 of 6 on
Normal!"). Never delays or blocks the existing game-over UI.

## 3. Achievements

Fully client-side — no backend dependency. `src/platform/achievements.ts` exports a
catalogue (id, name, description, a pure `check(events) → boolean`) and
persists unlocked IDs + timestamps in `localStorage`, following the same
`safeGet`/`safeSet` pattern as `storage.ts`. `check` is a pure function over a log of
state transitions, so it's unit-testable the same way `core` is, without needing a
live game loop.

Starting catalogue (trimmable, ~10):

| id | unlocks when |
|---|---|
| `first-bite` | first food ever eaten |
| `halfway-there` | reach score 10 (survive the first shrink) |
| `iron-wall` | survive 3 pending-shrink warnings without dying in the closing band |
| `speed-demon` | reach score 20 on normal or hard |
| `perfectionist` | win by filling the board |
| `comeback-kid` | beat your previous best by 5+ in one run |
| `night-crawler` | play between 00:00–04:00 local time |
| `three-day-streak` / `week-streak` / `neon-regular` | 3 / 7 / 30 daily-challenge day streak |
| `top-three` | reach top 3 on an all-time leaderboard |

Unlocking fires `src/ui/achievementToast.ts`, a banner variant of the existing `+1`
popup pattern (`src/ui/popups.ts`) — slides in from the top, auto-dismisses.

`main.ts`'s `onStateChange` feeds each transition to an `AchievementTracker` (new,
thin — holds the small amount of cross-tick state achievements need, like the
pending-shrink survival counter) exactly where the eat-popup and sfx triggers already
live.

## 4. Daily challenge + streak

`src/platform/daily.ts` exports a pure `dailySeed(date: Date): number` (deterministic
hash of the UTC date string) — unit-testable like `core/rng.ts`. The ready screen
gains a secondary CTA, "🔥 Today's Challenge," alongside the existing "Press Space to
start." Selecting it starts a run with `createInitialState({ seed: dailySeed(now),
config: configFor('normal') })` — always normal difficulty, so every player's board is
identical and comparable. Its game-over submission goes to `mode: 'daily'` instead of
`'alltime'`.

Streak (consecutive calendar days the daily challenge was played) is tracked in
`localStorage` (`lastPlayedDate`, `streakCount`), incremented on daily-challenge
completion, reset if a day is skipped. Shown on the ready screen next to the CTA
("🔥 3-day streak").

## New files

```
api/
  scores.ts           # POST — validate, rate-limit, ZADD
  leaderboard.ts       # GET  — ZREVRANGE + nickname resolution
src/platform/
  leaderboard.ts        # client fetch wrapper, fails soft
  achievements.ts        # catalogue + pure check() + localStorage persistence
  daily.ts                # dailySeed() + streak read/write
src/ui/
  toolbar.ts              # replaces Hud; owns score/best + 🏆/⚙ triggers
  statsPanel.ts             # modal: Today | All-Time | Achievements tabs
  achievementToast.ts        # unlock banner
tests/unit/
  achievements.test.ts        # pure check() cases
  daily.test.ts                 # dailySeed determinism + streak logic
  leaderboard.test.ts            # client wrapper fail-soft behavior (mocked fetch)
```

`src/ui/hud.ts` is deleted (folded into `toolbar.ts`). `src/rendering/scene.ts` and
`GameRenderer.ts` change how they source viewport dimensions (see §1) but their public
APIs are unchanged.

## Testing strategy

- `core/` is untouched — existing 90/85/90/90 coverage gate and all current tests
  stay green with no modification.
- New pure logic (`achievements.ts` check functions, `dailySeed`, streak transitions)
  gets unit tests the same way `core` does — deterministic inputs, no DOM.
- `platform/leaderboard.ts` unit-tested with a mocked `fetch`, asserting it never
  throws and degrades to `null`/`[]` on network failure, non-200, or malformed JSON.
- `api/*.ts` are not unit-testable in the Vitest jsdom setup (they're Node serverless
  functions) — verified by running `vercel dev` locally against a real (or Upstash's
  local-dev-friendly) Redis instance and hitting the routes directly, plus manual
  end-to-end verification once deployed.
- Rendering/UI changes (toolbar, modal, toasts) verified the same way the previous
  round was: headless Playwright driving the real built app, screenshots as evidence,
  no new unit tests for pure presentation.

## Manual, blocking step

Provisioning **Upstash Redis via the Vercel Marketplace** on the `snake-3d` project
requires the user's explicit action in the Vercel dashboard (cost-bearing third-party
integration, even on free tier) — not something to do silently. Exact steps will be
handed over when implementation reaches that point. Everything else in this spec ships
and is testable without it; the leaderboard simply reports "offline" until then.

## Rollout order (single session, sequenced for lowest risk first)

1. Toolbar + viewport-inset plumbing (fixes the regression, foundation for the rest)
2. `platform/daily.ts` + `platform/achievements.ts` (pure, testable, no UI yet)
3. `api/scores.ts` + `api/leaderboard.ts` + `platform/leaderboard.ts` (backend +
   client, works in "offline" mode without Redis provisioned)
4. `StatsPanel` UI (leaderboard tabs + achievements tab)
5. `achievementToast.ts` wiring + daily-challenge CTA + streak display
6. Hand off the Upstash provisioning steps; verify end-to-end once live
