# Architecture

Neon Snake 3D is structured around one rule: **the game simulation is pure and
knows nothing about the browser.** Everything else is an adapter around it.

## Layers and the dependency rule

```
┌───────────────────────────────────────────────────────────────┐
│ app/  (composition root + fixed-timestep loop)                 │
│   wires every layer together and owns the only mutable `state` │
└───────────────────────────────────────────────────────────────┘
        │ depends on ▼            ▼                 ▼
   ┌─────────┐   ┌───────────┐   ┌────────┐   ┌──────────┐
   │ input/  │   │ rendering/│   │ audio/ │   │ ui/      │
   │ kbd+touch│  │ three.js  │   │ sfx    │   │ DOM      │
   └─────────┘   └───────────┘   └────────┘   └──────────┘
        │             │              │             │
        └─────────────┴──────┬───────┴─────────────┘
                       depends on ▼
                  ┌──────────────────────┐     ┌────────────┐
                  │ core/  (PURE)        │◀────│ platform/  │
                  │ reduce(state,action) │     │ storage    │
                  └──────────────────────┘     └────────────┘
```

**Dependencies point inward only.** `core/` imports nothing from `rendering`,
`ui`, `input`, `audio`, `platform`, the DOM, or Three.js. That is what makes
it testable in a Node environment with no browser shims.

## Modules

| Module                   | Responsibility                                                    | Depends on             |
| ------------------------ | ----------------------------------------------------------------- | ---------------------- |
| `core/types`             | Immutable `GameState`, `GameAction`, `GameConfig`                 | —                      |
| `core/rng`               | Seedable mulberry32 PRNG (functional: state in, value + next out) | types                  |
| `core/direction`         | Direction → grid delta, opposite check                            | types                  |
| `core/movement`          | Input-buffer rules (anti-180°, repeat, cap 2)                     | types, direction       |
| `core/systems/arena`     | Active size, wall bounds, food inner-bounds                       | types                  |
| `core/systems/collision` | Wall and body hit tests                                           | types, arena           |
| `core/systems/food`      | Free-cell enumeration + uniform pick                              | types, rng, arena      |
| `core/stateMachine`      | Legal phase transitions (documentation + tests)                   | types                  |
| `core/game`              | `createInitialState` + the single `reduce` reducer                | all of core            |
| `rendering/*`            | Three.js scene, bloom, board, snake/food meshes, interpolation    | core (read-only)       |
| `input/*`                | Keyboard + touch → device-agnostic `ControlHandlers`              | core (types)           |
| `audio/sfx`              | Lazy Web Audio synthesis (eat / crash)                            | —                      |
| `ui/*`                   | HUD, multi-screen overlay, settings panel (DOM)                   | core (types), platform |
| `platform/storage`       | Safe `localStorage` for best score + settings                     | core (types)           |
| `app/main`               | Composition root + game loop                                      | everything             |

## Data flow

1. **Input** (key/tap) produces a semantic event — `turn`, `primary`,
   `togglePause`.
2. The **app** translates it into a `GameAction` and calls `dispatch`.
3. `dispatch` runs the pure `reduce(state, action)` and replaces its single
   `state` reference.
4. If the state changed, the app fans out **side effects**: play a sound,
   update the HUD, show/hide an overlay, persist the best score, and — only
   when the snake actually moved — re-sync the renderer.
5. Every animation frame, the **loop** advances simulation time in fixed
   `tickInterval` steps and draws the scene, interpolating snake motion by the
   fractional progress through the current tick.

```
key/tap ─▶ ControlHandlers ─▶ dispatch ─▶ reduce() ─▶ new state
                                             │
              ┌──────────────────────────────┴───────────────┐
            side effects                                  render loop
   (sfx · hud · overlay · storage · renderer.sync)   (interpolated draw)
```

## Key decisions

These are recorded as ADRs in [`adr/`](adr):

- [ADR 0001 — Pure, headless game core](adr/0001-pure-headless-core.md)
- [ADR 0002 — Seedable RNG in immutable state](adr/0002-seedable-rng.md)
- [ADR 0003 — Fixed-timestep loop with interpolation](adr/0003-fixed-timestep-loop.md)

## Testing strategy

- **Unit (Vitest)** covers the entire `core/` plus the storage adapter. Because
  the core is pure and the RNG is seedable, tests assert exact outcomes —
  including food positions — with no mocking. Coverage thresholds on `core/`
  are enforced in CI.
- **End-to-end (Playwright)** drives the production build in a real browser:
  boot, start, pause/resume, crash, restart, and best-score persistence.

## Coordinate model

The coordinate space is fixed at `maxGrid` (25). Cells map to world space
through a constant half-extent, so a cell's world position never changes when
the arena shrinks — only the walls move. `arenaMargin` is how many cells are
walled off per side; the active board is `maxGrid - 2 · margin`.
