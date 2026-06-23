import type { Cell, GameConfig, RngState } from '../types';
import { nextInt } from '../rng';
import { innerBounds } from './arena';

/**
 * Every spawnable cell not currently occupied by the snake.
 *
 * Enumerating free cells (rather than rejection-sampling random points)
 * guarantees termination even on a nearly full board and makes "board full"
 * detectable as an empty result — the win condition.
 */
export function freeCells(config: GameConfig, margin: number, snake: readonly Cell[]): Cell[] {
  const { lo, hi } = innerBounds(config, margin);
  const occupied = new Set(snake.map((s) => `${s.x},${s.z}`));
  const cells: Cell[] = [];
  for (let x = lo; x <= hi; x++) {
    for (let z = lo; z <= hi; z++) {
      if (!occupied.has(`${x},${z}`)) {
        cells.push({ x, z });
      }
    }
  }
  return cells;
}

/** Pick a uniformly random free cell, returning it with the advanced RNG. */
export function pickFood(cells: readonly Cell[], rng: RngState): { food: Cell; rng: RngState } {
  const { value, next } = nextInt(rng, cells.length);
  const food = cells[value];
  if (food === undefined) {
    throw new Error('pickFood called with no free cells');
  }
  return { food, rng: next };
}
