import type { Cell, GameConfig, Vec2 } from '../types';
import { wallBounds } from './arena';

/** Whether a point lies outside the world boundary `[lo, hi]`. */
export function hitsWall(cell: Cell, config: GameConfig, margin: number): boolean {
  const { lo, hi } = wallBounds(config, margin);
  return cell.x < lo || cell.x > hi || cell.z < lo || cell.z > hi;
}

/** Whether every point lies inside the world boundary at the given margin. */
export function allInsideWalls(
  cells: readonly Cell[],
  config: GameConfig,
  margin: number,
): boolean {
  return cells.every((cell) => !hitsWall(cell, config, margin));
}

/** Whether a point overlaps any segment in `body` within `radius` (default `0.45`). */
export function hitsBody(cell: Cell, body: readonly Cell[], radius = 0.45): boolean {
  const rSq = radius * radius;
  return body.some((s) => {
    const dx = s.x - cell.x;
    const dz = s.z - cell.z;
    return dx * dx + dz * dz < rSq;
  });
}

/** Minimum distance from `point` to any segment in `chain` (or `Infinity` if empty). */
export function minDistanceToChain(point: Vec2, chain: readonly Vec2[]): number {
  let minSq = Infinity;
  for (const seg of chain) {
    const dx = seg.x - point.x;
    const dz = seg.z - point.z;
    const dSq = dx * dx + dz * dz;
    if (dSq < minSq) minSq = dSq;
  }
  return Math.sqrt(minSq);
}

/** Distance from `point` to the finite line segment `[a, b]` (prevents projectile tunneling). */
export function distancePointToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lenSq = abx * abx + abz * abz;
  if (lenSq <= 1e-9) {
    return Math.hypot(point.x - a.x, point.z - a.z);
  }
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.z - a.z) * abz) / lenSq));
  const cx = a.x + abx * t;
  const cz = a.z + abz * t;
  return Math.hypot(point.x - cx, point.z - cz);
}
