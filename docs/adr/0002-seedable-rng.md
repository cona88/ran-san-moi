# ADR 0002 — Seedable RNG in immutable state

- **Status:** Accepted
- **Date:** 2026-06-23

## Context

Food placement is the only source of randomness in the game. Using
`Math.random()` directly would make the simulation non-deterministic and food
spawning impossible to assert in tests — exactly the behaviour most worth
testing (e.g. "the next food never lands on the snake").

## Decision

Use a small seedable PRNG (mulberry32), modelled **functionally**: drawing a
number takes an RNG state and returns the value together with the next state,
never mutating in place.

```ts
nextRandom(state: RngState): { value: number; next: RngState }
```

The RNG state lives inside `GameState`, so `reduce` stays pure and the whole
game is reproducible from `(seed, actions)`. The app seeds from `Date.now()`
for session variety; tests pass a fixed seed.

## Consequences

- Tests assert exact spawn positions and that identical seeds replay
  identically; no mocking of globals.
- Food spawning enumerates free cells and picks uniformly, which also makes a
  full board detectable (empty free list ⇒ win) and guarantees termination.
- Slightly more plumbing than calling `Math.random()`: the new RNG state must
  be threaded back into `GameState` on every draw. Encapsulated in the food
  system, so callers don't deal with it.
