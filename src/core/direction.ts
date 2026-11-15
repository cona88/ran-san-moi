import type { Cell, Direction } from './types';

/** Unit step on the X/Z grid for each direction (up = -Z, matching the camera). */
const DELTA: Record<Direction, Cell> = {
  up: { x: 0, z: -1 },
  down: { x: 0, z: 1 },
  left: { x: -1, z: 0 },
  right: { x: 1, z: 0 },
};

const PERPENDICULARS: Record<Direction, readonly [Direction, Direction]> = {
  up: ['left', 'right'],
  down: ['right', 'left'],
  left: ['up', 'down'],
  right: ['down', 'up'],
};

/** The grid step for a direction. */
export function delta(direction: Direction): Cell {
  return DELTA[direction];
}

/** Whether two directions are exact opposites (a forbidden 180° reversal). */
export function isOpposite(a: Direction, b: Direction): boolean {
  const da = DELTA[a];
  const db = DELTA[b];
  return da.x === -db.x && da.z === -db.z;
}

/** The two directions perpendicular to `direction`. */
export function perpendicularDirections(direction: Direction): readonly [Direction, Direction] {
  return PERPENDICULARS[direction];
}
