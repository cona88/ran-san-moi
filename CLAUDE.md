# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A neon synthwave 3D Snake game built as a senior-level software project:
TypeScript (strict) + Vite + Three.js, with a pure, fully-tested game core
separated from rendering and I/O. Engineered as a portfolio piece.

> Earlier history: the game began as a single `index.html` with a CDN
> importmap. It was rewritten into the layered project described below; that
> snapshot is preserved in git history (commit "Snapshot single-file game
> before senior rewrite").

## Running

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm dev              # Vite dev server at http://localhost:5173
pnpm build            # typecheck + production build to dist/
pnpm preview          # serve the build
pnpm test             # Vitest unit tests
pnpm test:coverage    # unit tests with coverage gates (core/)
pnpm e2e              # Playwright E2E against the production build
pnpm lint / format    # ESLint / Prettier
```

## Architecture

The governing rule: **`src/core` is pure and headless** — no DOM, no `window`,
no Three.js. Every other layer depends on `core`, never the reverse. Full
detail in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); rationale in
[`docs/adr/`](docs/adr).

```
src/
  core/        pure simulation: types, rng, direction, movement,
               systems/{arena,collision,food}, stateMachine, game (reduce)
  rendering/   Three.js adapter: scene (bloom), board, snake, food, GameRenderer
  input/       keyboard + touch -> ControlHandlers (semantic events)
  audio/       Web Audio synthesized SFX
  ui/          HUD, overlay (ready/paused/gameover/win), settings
  platform/    localStorage adapter (best score + settings)
  app/         main.ts — composition root + fixed-timestep loop
tests/
  unit/        Vitest — whole core/ + storage (~99% on core)
  e2e/         Playwright — full play-flow smoke
```

### Core model

- **State + reducer:** the only way state changes is
  `reduce(state: GameState, action: GameAction): GameState`. `GameState` is
  fully `readonly`; actions are `start | turn | tick | pause | resume | reset`.
  Each action is a no-op outside the phase where it applies.
- **Phases:** `ready → playing → paused → gameover` (with a `won` flag when the
  board is filled). Legal transitions are documented in `core/stateMachine`.
- **Determinism:** a seedable mulberry32 RNG (`core/rng`) is threaded through
  `GameState`, so food spawns are reproducible and asserted in tests.
- **Coordinate space:** fixed at `MAX_GRID` (25); cells map to world space via a
  constant half-extent. `arenaMargin` walls off cells per side; active board is
  `MAX_GRID - 2·margin`. Walls close in every `shrinkEvery` foods.
- **Difficulty:** `configFor(difficulty)` in `core/config` tunes `baseTick`,
  `tickStep`, `shrinkEvery`, `maxMargin`. `normal` matches the original tuning.

### Rendering & loop

- `GameRenderer.sync(state)` is called once per logic tick; `draw(alpha, …)`
  every animation frame. The app re-syncs the renderer **only when the snake
  moved** (a moved snake is a new array reference) — syncing on a queued turn
  would freeze interpolation mid-tick.
- The loop accumulates real time and steps the sim in fixed `tickInterval`
  increments, interpolating snake motion by `alpha = acc / tickInterval`.

## Conventions

- Strict TypeScript (`noUncheckedIndexedAccess` on) — guard array access.
- A Husky pre-commit hook runs `lint-staged` + `typecheck`; CI (GitHub Actions)
  runs lint, typecheck, coverage, build and E2E as the quality gate. Deployment
  is on Vercel — live at https://snake-3d-lyart.vercel.app (`vercel --prod`, or
  automatic once the repo is connected to Vercel's Git integration).
- Keep `core/` free of browser/Three.js imports — that boundary is the point.
