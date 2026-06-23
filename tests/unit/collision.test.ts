import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/core/config';
import { hitsBody, hitsWall } from '../../src/core/systems/collision';

describe('collision', () => {
  const config = DEFAULT_CONFIG;

  it('flags cells outside the walls', () => {
    // margin 2 -> bounds [2, 22]
    expect(hitsWall({ x: 1, z: 10 }, config, 2)).toBe(true);
    expect(hitsWall({ x: 23, z: 10 }, config, 2)).toBe(true);
    expect(hitsWall({ x: 10, z: 1 }, config, 2)).toBe(true);
    expect(hitsWall({ x: 10, z: 23 }, config, 2)).toBe(true);
  });

  it('allows cells on and inside the walls', () => {
    expect(hitsWall({ x: 2, z: 2 }, config, 2)).toBe(false);
    expect(hitsWall({ x: 22, z: 22 }, config, 2)).toBe(false);
    expect(hitsWall({ x: 12, z: 12 }, config, 2)).toBe(false);
  });

  it('detects body overlap', () => {
    const body = [
      { x: 5, z: 5 },
      { x: 5, z: 6 },
    ];
    expect(hitsBody({ x: 5, z: 6 }, body)).toBe(true);
    expect(hitsBody({ x: 6, z: 6 }, body)).toBe(false);
    expect(hitsBody({ x: 0, z: 0 }, [])).toBe(false);
  });
});
