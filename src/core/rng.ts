import type { RngState } from './types';

/**
 * Seedable pseudo-random number generator (mulberry32).
 *
 * Modelled functionally: each draw returns the value *and* the next state,
 * never mutating in place. This keeps {@link GameState} fully immutable and
 * makes all spawns reproducible in tests.
 */

/** Create an RNG state from a seed. */
export function createRng(seed: number): RngState {
  return { seed: seed >>> 0 };
}

/** Draw a float in [0, 1) and return the advanced state. */
export function nextFloat(state: RngState): { value: number; next: RngState } {
  const a = (state.seed + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, next: { seed: a } };
}

/** Alias for {@link nextFloat} retained for backwards compatibility. */
export const nextRandom = nextFloat;

/** Draw an integer in [0, maxExclusive) and return the advanced state. */
export function nextInt(state: RngState, maxExclusive: number): { value: number; next: RngState } {
  if (maxExclusive <= 0) {
    return { value: 0, next: state };
  }
  const { value, next } = nextFloat(state);
  return { value: Math.floor(value * maxExclusive), next };
}
