import type { Cell, Direction, GameConfig, Vec2 } from '../types';

/**
 * Open-world arena geometry (`[-worldRadius, +worldRadius]` on the X/Z plane).
 */

/** Clamp `value` into `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Side length of the playable world for a given margin. */
export function activeSize(config: GameConfig, margin: number): number {
  return Math.max(1, config.worldRadius * 2 - 2 * margin);
}

/** Inclusive world boundary coordinates centered at `(0, 0)`. */
export function wallBounds(config: GameConfig, margin: number): { lo: number; hi: number } {
  const radius = Math.max(1, config.worldRadius - margin);
  return { lo: -radius, hi: radius };
}

/** Inclusive inner spawn bounds — padded inward from the world edge. */
export function innerBounds(config: GameConfig, margin: number): { lo: number; hi: number } {
  const radius = Math.max(1, config.worldRadius - margin - 1);
  return { lo: -radius, hi: radius };
}

/** Wrap a position cyclically within `[lo, hi]` for Cozy mode. */
export function wrapCell(cell: Cell, config: GameConfig, margin: number): Cell {
  const { lo, hi } = wallBounds(config, margin);
  const span = Math.max(1, hi - lo);
  const wrapAxis = (v: number): number => {
    if (v >= lo && v <= hi) return v;
    return lo + ((((v - lo) % span) + span) % span);
  };
  return { x: wrapAxis(cell.x), z: wrapAxis(cell.z) };
}

/** Squared Euclidean distance between two 2D world points. */
export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/** Euclidean distance between two 2D world points. */
export function euclideanDistance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Chebyshev (max-axis) distance between two positions. */
export function chebyshevDistance(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

/** Manhattan distance between two positions. */
export function manhattanDistance(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}

/** Normalize an angle in radians to `(-Math.PI, Math.PI]`. */
export function normalizeAngle(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a <= -Math.PI) a += Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  return a;
}

/** Shortest signed angular delta `to - from` in `(-Math.PI, Math.PI]`. */
export function angleDiff(from: number, to: number): number {
  return normalizeAngle(to - from);
}

/** Convert a cardinal {@link Direction} to world radians (`Math.atan2(dz, dx)`). */
export function directionToAngle(dir: Direction): number {
  switch (dir) {
    case 'right':
      return 0;
    case 'down':
      return Math.PI / 2;
    case 'left':
      return Math.PI;
    case 'up':
      return -Math.PI / 2;
  }
}

/** Round an arbitrary radian angle to the nearest cardinal {@link Direction}. */
export function angleToDirection(angle: number): Direction {
  const a = normalizeAngle(angle);
  if (a >= -Math.PI / 4 && a < Math.PI / 4) return 'right';
  if (a >= Math.PI / 4 && a < (3 * Math.PI) / 4) return 'down';
  if (a >= (-3 * Math.PI) / 4 && a < -Math.PI / 4) return 'up';
  return 'left';
}
