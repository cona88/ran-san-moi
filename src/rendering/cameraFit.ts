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
