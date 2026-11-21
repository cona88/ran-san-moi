import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/core/config';
import {
  allInsideWalls,
  distancePointToSegment,
  hitsBody,
  hitsWall,
  minDistanceToChain,
} from '../../src/core/systems/collision';

describe('collision', () => {
  const config = DEFAULT_CONFIG; // [-280, 280] at margin 0

  it('flags coordinates outside the world bounds', () => {
    expect(hitsWall({ x: -281, z: 0 }, config, 0)).toBe(true);
    expect(hitsWall({ x: 281, z: 0 }, config, 0)).toBe(true);
    expect(hitsWall({ x: 0, z: -281 }, config, 0)).toBe(true);
    expect(hitsWall({ x: 0, z: 281 }, config, 0)).toBe(true);
  });

  it('allows points on and inside the bounds', () => {
    expect(hitsWall({ x: -280, z: -280 }, config, 0)).toBe(false);
    expect(hitsWall({ x: 280, z: 280 }, config, 0)).toBe(false);
    expect(hitsWall({ x: 0, z: 0 }, config, 0)).toBe(false);
  });

  it('checks whole chains against world bounds', () => {
    const inside = [
      { x: 5, z: 5 },
      { x: -12.5, z: 8.2 },
    ];
    expect(allInsideWalls(inside, config, 0)).toBe(true);
    expect(allInsideWalls([...inside, { x: 290, z: 5 }], config, 0)).toBe(false);
    expect(allInsideWalls([], config, 0)).toBe(true);
  });

  it('detects continuous body proximity and segment distances', () => {
    const body = [
      { x: 5, z: 5 },
      { x: 5, z: 6 },
    ];
    expect(hitsBody({ x: 5.1, z: 6.1 }, body)).toBe(true);
    expect(hitsBody({ x: 6, z: 6 }, body)).toBe(false);
    expect(hitsBody({ x: 0, z: 0 }, [])).toBe(false);
    expect(minDistanceToChain({ x: 5, z: 8 }, body)).toBe(2);
    expect(distancePointToSegment({ x: 5, z: 1 }, { x: 0, z: 0 }, { x: 10, z: 0 })).toBe(1);
  });
});
