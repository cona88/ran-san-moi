import { Vector3 } from 'three';

/**
 * Open-world coordinate mapping.
 *
 * In the open-world simulation (`[-worldRadius, +worldRadius]`), coordinates are
 * already centered at `(0, 0)` on the X/Z plane, so `cellToWorld` and
 * `lerpGridToWorld` map directly to `(x, 0, z)` without subtracting `half`.
 */

/** Half-extent helper kept for compatibility with board sizing signatures. */
export function halfOf(maxGrid: number): number {
  return (maxGrid - 1) / 2;
}

/** Map continuous world coordinate (x, z) into 3D world space `(x, 0, z)`. */
export function cellToWorld(x: number, z: number, _half = 0, target = new Vector3()): Vector3 {
  return target.set(x, 0, z);
}

/** Linearly interpolate between two continuous open-world positions into 3D space. */
export function lerpGridToWorld(
  prevX: number,
  prevZ: number,
  x: number,
  z: number,
  alpha: number,
  _half = 0,
  target = new Vector3(),
): Vector3 {
  const gx = prevX + (x - prevX) * alpha;
  const gz = prevZ + (z - prevZ) * alpha;
  return target.set(gx, 0, gz);
}
