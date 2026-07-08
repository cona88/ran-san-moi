import type { Cell, GameConfig } from '../types';
import { wallBounds } from './arena';

/** Whether a cell lies outside the current walls. */
export function hitsWall(cell: Cell, config: GameConfig, margin: number): boolean {
  const { lo, hi } = wallBounds(config, margin);
  return cell.x < lo || cell.x > hi || cell.z < lo || cell.z > hi;
}

/** Whether every cell lies inside the walls at the given margin. */
export function allInsideWalls(
  cells: readonly Cell[],
  config: GameConfig,
  margin: number,
): boolean {
  return cells.every((cell) => !hitsWall(cell, config, margin));
}

/** Whether a cell overlaps any segment in the given body. */
export function hitsBody(cell: Cell, body: readonly Cell[]): boolean {
  return body.some((s) => s.x === cell.x && s.z === cell.z);
}
