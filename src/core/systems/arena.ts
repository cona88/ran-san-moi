import type { GameConfig } from '../types';

/**
 * Arena geometry. The coordinate space is fixed at `maxGrid`; the playable
 * area shrinks as `margin` grows, always centred. Walls and food both read
 * the live margin so the board stays consistent as it closes in.
 */

/** Side length of the playable area for a given margin. */
export function activeSize(config: GameConfig, margin: number): number {
  return config.maxGrid - 2 * margin;
}

/** Inclusive wall bounds — the snake dies if its head leaves [lo, hi]. */
export function wallBounds(config: GameConfig, margin: number): { lo: number; hi: number } {
  return { lo: margin, hi: config.maxGrid - 1 - margin };
}

/**
 * Inclusive region where food may spawn — one cell inside the walls so a
 * closing arena never traps the head against a freshly placed orb.
 */
export function innerBounds(config: GameConfig, margin: number): { lo: number; hi: number } {
  return { lo: margin + 1, hi: config.maxGrid - 2 - margin };
}
