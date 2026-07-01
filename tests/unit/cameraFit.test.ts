import { describe, expect, it } from 'vitest';
import { cameraFitDistance } from '../../src/rendering/cameraFit';

const BASE = 21.93;
const HALF = 11.3;
const FOV = 50;

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
