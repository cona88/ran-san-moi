/**
 * Distance the camera must sit from the board so the whole arena stays
 * visible at a given viewport aspect ratio.
 *
 * The camera keeps its fixed isometric direction; only its distance changes.
 * On wide/landscape viewports the board already fits, so we clamp to
 * `baseDistance` (preserving the tuned desktop framing). On narrow/portrait
 * viewports the horizontal field of view shrinks, so we dolly back just enough
 * for the board's half-width to fit horizontally.
 *
 * Pure math (no Three.js) so it is unit-tested directly.
 */
export function cameraFitDistance(
  aspect: number,
  baseDistance: number,
  halfExtent: number,
  verticalFovDeg: number,
): number {
  const vHalf = (verticalFovDeg * Math.PI) / 180 / 2;
  // Guard against NaN (0/0 viewport) and non-positive aspects so a degenerate
  // viewport can never poison the camera transform.
  const safeAspect = Number.isFinite(aspect) ? Math.max(aspect, 0.0001) : 1;
  // Horizontal half-FOV derived from the vertical FOV and the aspect ratio.
  const hHalf = Math.atan(Math.tan(vHalf) * safeAspect);
  const horizontalFit = halfExtent / Math.tan(hHalf);
  return Math.max(baseDistance, horizontalFit);
}

/**
 * Z-offset for the camera's lookAt target that vertically centres the board.
 *
 * The camera sits at `direction · distance` with a fixed tilt, so looking at
 * the origin leaves the near (+Z) board edge much lower in the frame than the
 * far edge sits high — low enough to crop the bottom row. Aiming instead at
 * the point where the bisector of the camera→near-edge and camera→far-edge
 * rays crosses the board plane puts both edges at equal angular distance from
 * the view axis, so neither can be cropped while the other has slack.
 *
 * `dirY`/`dirZ` are the normalized camera direction components (the direction
 * has x = 0, so the whole problem lives in the y-z plane). Pure math (no
 * Three.js) so it is unit-tested directly. Returns 0 for degenerate inputs.
 */
export function cameraTargetZ(
  distance: number,
  halfExtent: number,
  dirY: number,
  dirZ: number,
): number {
  const py = dirY * distance;
  const pz = dirZ * distance;
  const near = normalize2(-py, halfExtent - pz);
  const far = normalize2(-py, -halfExtent - pz);
  // Bisector of the two edge rays; where it crosses y = 0 is the target.
  const by = near.y + far.y;
  const bz = near.z + far.z;
  if (!Number.isFinite(by) || Math.abs(by) < 1e-9) return 0;
  const t = -py / by;
  const z = pz + t * bz;
  return Number.isFinite(z) ? z : 0;
}

function normalize2(y: number, z: number): { y: number; z: number } {
  const len = Math.hypot(y, z);
  return len > 0 ? { y: y / len, z: z / len } : { y: 0, z: 0 };
}
