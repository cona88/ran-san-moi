# ADR 0001 — Pure, headless game core

- **Status:** Accepted
- **Date:** 2026-06-23

## Context

The original game was a single `index.html` where game logic, Three.js
rendering, DOM and input were interleaved in one script. Nothing could be
tested without a browser and a rendering context, so collision, growth and the
shrinking-arena rules were only ever verified by playing.

## Decision

Extract all game rules into `src/core` as a **pure, headless module** with a
single entry point:

```ts
reduce(state: GameState, action: GameAction): GameState
```

`core` may not import the DOM, `window`, Three.js, or any adapter. `GameState`
is fully `readonly`; every transition returns a new object. Rendering, input,
audio, UI and storage are adapters that depend on `core`, never the reverse.

## Consequences

- The whole simulation is unit-testable in a Node environment in milliseconds;
  we reach ~99% coverage on `core/` and enforce thresholds in CI.
- The reducer is a single, auditable source of truth for game behaviour; each
  action is a no-op outside the phase where it applies, so callers never guard.
- Rendering becomes a pure projection of state — easy to swap or restyle
  without touching rules.
- Cost: more files and a small amount of wiring in the composition root. Worth
  it for the testability and clarity.
