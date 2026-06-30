# ADR 0003 — Fixed-timestep loop with render interpolation

- **Status:** Accepted
- **Date:** 2026-06-23

## Context

Snake advances on a discrete grid, but displays should be smooth at any refresh
rate. Stepping the simulation once per animation frame would couple game speed
to frame rate (faster monitors ⇒ faster snake) and make ticks non-deterministic.

## Decision

Separate **simulation** from **rendering**:

- The loop accumulates real elapsed time and runs `reduce(state, 'tick')` in
  fixed `tickInterval` steps (a `while` loop catches up if a frame was long).
  Large gaps — e.g. a backgrounded tab — are clamped to avoid a tick storm.
- Each frame renders with an interpolation factor `alpha = acc / tickInterval`.
  The renderer lerps every snake segment from its previous cell to its current
  cell, so motion is smooth between logic ticks.

The interpolation rule is "each segment follows its own previous target": on a
tick, a segment's old destination becomes its new origin. Because segment _i_
inherits the cell the segment ahead just vacated, trailing motion is correct
with no special-casing for the head. Resets and arena rebuilds teleport (snap)
rather than slide.

## Consequences

- Game speed is independent of frame rate and fully deterministic; speed is
  governed only by `tickInterval`, which decreases as the score rises.
- Smooth visuals decoupled from the fixed logic rate.
- The renderer keeps a tiny amount of view state (each segment's from/to), and
  the app must re-sync the renderer only when the snake actually moved — never
  on a mere queued turn, which would otherwise freeze interpolation mid-tick.
