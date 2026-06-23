# Neon Snake 3D — Senior Software Rewrite

**Date:** 2026-06-23
**Goal:** Transform the single-file game into a senior-level software project (portfolio piece for senior full-stack roles).

## Decisions (locked)

- **Scope:** Full senior rewrite — TypeScript + Vite + modular architecture + Vitest + Playwright + ESLint/Prettier + CI/CD + docs + deploy.
- **Objective:** Portfolio piece — strong README, live demo, clean commit history, badges.
- **Gameplay:** Keep the existing feel, plus new features (audio, settings, difficulty, pause).

## Core architectural principle

Separate the **pure game simulation** from rendering and I/O. The core is a deterministic, headless module — no Three.js, no DOM, no `window`. This makes the entire game logic unit-testable in milliseconds and is the primary senior signal.

```
intent (input) ──▶ core.step(state, intent) ──▶ new state ──▶ renderer draws (Three.js)
                        (pure, deterministic)
```

A seedable PRNG (mulberry32) drives food placement so spawns are reproducible in tests.

## Folder structure

```
src/
  core/                  # PURE domain — zero browser/three deps
    types.ts             # GameState, Direction, Cell, Intent, GameConfig
    rng.ts               # seedable PRNG
    game.ts              # createGame(), step() — pure reducer
    systems/
      movement.ts        # head advance + input buffer (anti-180°)
      collision.ts       # wall + body
      food.ts            # deterministic placeFood
      arena.ts           # progressive shrink + bounds
    stateMachine.ts      # ready→playing→paused→gameover (typed)
  rendering/             # Three.js adapter
    Scene.ts · bloom.ts · SnakeRenderer.ts · FoodRenderer.ts
  input/                 # keyboard + touch → Intent
    keyboard.ts · touch.ts
  audio/sfx.ts           # Web Audio API synthesized effects, toggle
  ui/                    # DOM — hud, overlays, settings
    hud.ts · overlay.ts · settings.ts
  platform/storage.ts    # localStorage adapter (highscore + settings) w/ fallback
  app/main.ts            # composition root — wire + game loop
  styles/style.css
tests/
  unit/                  # Vitest — all of core/
  e2e/                   # Playwright — full-flow smoke
docs/
  ARCHITECTURE.md
  adr/                   # Architecture Decision Records
.github/workflows/ci.yml
index.html · vite.config.ts · tsconfig.json
eslint.config.js · .prettierrc · .editorconfig · .nvmrc
README.md · LICENSE (MIT)
```

## Tech stack

| Concern | Choice |
|---|---|
| Language | TypeScript (strict) |
| Build | Vite |
| Rendering | Three.js |
| Unit tests | Vitest (+ coverage) |
| E2E | Playwright |
| Lint/format | ESLint (typescript-eslint) + Prettier |
| Git hooks | Husky + lint-staged |
| CI/CD | GitHub Actions → GitHub Pages |

## New features

1. **Audio** — synthesized SFX via Web Audio API (eat, crash, UI), toggleable. No external assets.
2. **Settings screen** — sound on/off, difficulty (Easy/Normal/Hard tunes BASE_TICK and shrink cadence), persisted in localStorage.
3. **Pause** — `P`/`Esc` + overlay.
4. **English UI** — currently pt-BR; English for international portfolio reach.

## Testing strategy

- **Unit (Vitest):** entire core — movement, anti-180° reversal, wall/body collision, growth, deterministic food spawn (seeded RNG), scoring, arena shrink, state machine transitions. Target: >90% coverage on `core/`.
- **E2E (Playwright):** load → start → move → score increments → game over → restart → pause.

## CI/CD pipeline

`push`/`PR` → install → lint → typecheck → unit test (coverage) → build → e2e → (on `main`) deploy to GitHub Pages.

## Docs

- **README.md:** hero GIF, live demo link, badges (CI/license), features, stack, architecture summary, run/test instructions.
- **docs/ARCHITECTURE.md:** layered architecture diagram + data flow.
- **docs/adr/:** 3 short ADRs (pure core, seedable RNG, fixed-timestep loop).
- **LICENSE** MIT, `.editorconfig`, `.nvmrc`, conventional commits.

## Implementation phases

1. **Scaffold** — package.json, Vite, TS, ESLint, Prettier, configs, index.html shell.
2. **Pure core** — types, rng, systems, game.ts, stateMachine + full unit tests (TDD).
3. **Rendering** — Three.js adapters ported from the original.
4. **Input + audio + UI** — keyboard/touch, SFX, HUD, overlays, settings.
5. **Composition** — main.ts wires everything, game loop with interpolation.
6. **E2E** — Playwright smoke tests.
7. **CI/CD** — GitHub Actions, GitHub Pages deploy.
8. **Docs** — README, ARCHITECTURE, ADRs, LICENSE.

## Success criteria

- `pnpm test` green, >90% coverage on core.
- `pnpm build` produces a working bundle; `pnpm e2e` passes.
- CI green on push; live demo deployed.
- README + architecture docs complete; clean conventional commit history.
- Gameplay preserved + new features working.
