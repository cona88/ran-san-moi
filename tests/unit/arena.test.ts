import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/core/config';
import {
  activeSize,
  angleDiff,
  angleToDirection,
  chebyshevDistance,
  directionToAngle,
  euclideanDistance,
  innerBounds,
  manhattanDistance,
  normalizeAngle,
  wallBounds,
  wrapCell,
} from '../../src/core/systems/arena';

describe('arena', () => {
  const config = DEFAULT_CONFIG; // worldRadius 280, maxGrid 560

  it('computes active size from worldRadius and margin', () => {
    expect(activeSize(config, 0)).toBe(560);
    expect(activeSize(config, 4)).toBe(552);
  });

  it('computes symmetric world bounds centered at (0, 0)', () => {
    expect(wallBounds(config, 0)).toEqual({ lo: -280, hi: 280 });
    expect(innerBounds(config, 0)).toEqual({ lo: -279, hi: 279 });
    expect(wallBounds(config, 2)).toEqual({ lo: -278, hi: 278 });
    expect(innerBounds(config, 2)).toEqual({ lo: -277, hi: 277 });
  });

  it('wraps points cyclically and measures Euclidean/Chebyshev/Manhattan distances', () => {
    const wrapped = wrapCell({ x: 281, z: -281 }, config, 0);
    expect(wrapped.x).toBeCloseTo(-279, 6);
    expect(wrapped.z).toBeCloseTo(279, 6);
    expect(euclideanDistance({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe(5);
    expect(chebyshevDistance({ x: 5, z: 5 }, { x: 6, z: 4 })).toBe(1);
    expect(manhattanDistance({ x: 5, z: 5 }, { x: 6, z: 4 })).toBe(2);
  });

  it('converts angles and cardinal directions consistently', () => {
    expect(directionToAngle('right')).toBe(0);
    expect(directionToAngle('down')).toBeCloseTo(Math.PI / 2, 6);
    expect(directionToAngle('left')).toBeCloseTo(Math.PI, 6);
    expect(directionToAngle('up')).toBeCloseTo(-Math.PI / 2, 6);

    expect(angleToDirection(0.1)).toBe('right');
    expect(angleToDirection(Math.PI / 2 - 0.1)).toBe('down');
    expect(angleToDirection(Math.PI - 0.1)).toBe('left');
    expect(angleToDirection(-Math.PI / 2 + 0.1)).toBe('up');

    expect(normalizeAngle(Math.PI * 2.5)).toBeCloseTo(Math.PI / 2, 6);
    expect(angleDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 6);
  });
});
