import { Vector3 } from 'three';

/**
 * Cell-to-world mapping. The coordinate space is fixed, so cells are centred
 * on the origin using a constant half-extent — board cells never need
 * remapping when the arena shrinks.
 */

/** Half-extent of the fixed coordinate space. */
export function halfOf(maxGrid: number): number {
  return (maxGrid - 1) / 2;
}

/** Centre of grid cell (x, z) in world space, written into `target` if given. */
export function cellToWorld(x: number, z: number, half: number, target = new Vector3()): Vector3 {
  return target.set(x - half, 0, z - half);
}
