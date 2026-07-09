import { describe, expect, it } from 'vitest';
import { cameraFitDistance, cameraTargetZ } from '../../src/rendering/cameraFit';

const BASE = 21.93;
const HALF = 11.3;
const FOV = 50;

// The rig's fixed viewing direction (0, 16, 15), normalized.
const DIR_LEN = Math.hypot(16, 15);
const DIR_Y = 16 / DIR_LEN;
const DIR_Z = 15 / DIR_LEN;

const fit = (aspect: number) => cameraFitDistance(aspect, BASE, HALF, FOV);

describe('cameraFitDistance', () => {
  it('keeps the base framing on wide/landscape viewports', () => {
    expect(fit(16 / 9)).toBe(BASE);
    expect(fit(4 / 3)).toBe(BASE);
    expect(fit(1.5)).toBe(BASE);
  });

  it('dollies back on narrow/portrait viewports', () => {
    expect(fit(0.75)).toBeGreaterThan(BASE); // iPad portrait
    expect(fit(375 / 812)).toBeGreaterThan(BASE); // iPhone portrait
  });

  it('the narrower the viewport, the further back the camera', () => {
    const wide = fit(1);
    const mid = fit(0.7);
    const narrow = fit(0.45);
    expect(narrow).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThanOrEqual(wide);
  });

  it('never returns less than the base distance', () => {
    for (const aspect of [0.3, 0.5, 1, 2, 3]) {
      expect(fit(aspect)).toBeGreaterThanOrEqual(BASE);
    }
  });

  it('is finite even for a degenerate aspect ratio', () => {
    expect(Number.isFinite(fit(0))).toBe(true);
  });

  it('never propagates NaN (0/0 viewport)', () => {
    const d = fit(Number.NaN);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThanOrEqual(BASE);
  });
});

/**
 * Signed angle (radians) between the view axis (camera -> lookAt target) and
 * the ray camera -> board-edge midpoint at world z = `edgeZ`. Everything
 * relevant lives in the y-z plane because the camera direction has x = 0.
 */
function edgeAngle(distance: number, targetZ: number, edgeZ: number): number {
  const py = DIR_Y * distance;
  const pz = DIR_Z * distance;
  const axis = { y: -py, z: targetZ - pz };
  const ray = { y: -py, z: edgeZ - pz };
  const cross = axis.y * ray.z - axis.z * ray.y;
  const dot = axis.y * ray.y + axis.z * ray.z;
  return Math.atan2(cross, dot);
}

describe('cameraTargetZ', () => {
  it('balances the near and far board edges around the view axis', () => {
    const targetZ = cameraTargetZ(BASE, HALF, DIR_Y, DIR_Z);
    const near = edgeAngle(BASE, targetZ, HALF);
    const far = edgeAngle(BASE, targetZ, -HALF);
    expect(Math.abs(near)).toBeCloseTo(Math.abs(far), 6);
  });

  it('keeps both edges inside the vertical FOV at every responsive aspect', () => {
    const vHalf = (FOV * Math.PI) / 360;
    for (const aspect of [16 / 9, 1.5, 1, 0.75, 375 / 812]) {
      const d = cameraFitDistance(aspect, BASE, HALF, FOV);
      const targetZ = cameraTargetZ(d, HALF, DIR_Y, DIR_Z);
      expect(Math.abs(edgeAngle(d, targetZ, HALF))).toBeLessThanOrEqual(vHalf);
      expect(Math.abs(edgeAngle(d, targetZ, -HALF))).toBeLessThanOrEqual(vHalf);
    }
  });

  it('tilts the view toward the near (bottom) edge', () => {
    expect(cameraTargetZ(BASE, HALF, DIR_Y, DIR_Z)).toBeGreaterThan(0);
  });

  it('returns 0 for degenerate or top-down inputs', () => {
    expect(cameraTargetZ(Number.NaN, HALF, DIR_Y, DIR_Z)).toBe(0);
    expect(cameraTargetZ(BASE, HALF, 1, 0)).toBe(0);
  });
});
