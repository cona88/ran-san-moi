import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/core/config';
import { createRng } from '../../src/core/rng';
import {
  freeCells,
  pickFood,
  pickOptionalCell,
  replenishWorldOrbs,
  scatterLootOrbs,
} from '../../src/core/systems/food';
import { innerBounds } from '../../src/core/systems/arena';

describe('food and world orbs', () => {
  const smallConfig = { ...DEFAULT_CONFIG, worldRadius: 12, maxGrid: 24 };

  it('enumerates the full inner area when occupied is empty', () => {
    const { lo, hi } = innerBounds(smallConfig, 2); // [-9, 9] -> 19x19
    const side = Math.floor(hi) - Math.ceil(lo) + 1;
    expect(freeCells(smallConfig, 2, [])).toHaveLength(side * side);
  });

  it('excludes occupied cells', () => {
    const snake = [
      { x: 3, z: 3 },
      { x: 4, z: 3 },
    ];
    const cells = freeCells(smallConfig, 2, snake);
    expect(cells).not.toContainEqual({ x: 3, z: 3 });
    expect(cells).not.toContainEqual({ x: 4, z: 3 });
  });

  it('pickFood returns a free cell and advances the rng', () => {
    const cells = freeCells(smallConfig, 2, []);
    const { food, rng } = pickFood(cells, createRng(1));
    expect(cells).toContainEqual(food);
    expect(rng.seed).not.toBe(createRng(1).seed);
    expect(() => pickFood([], createRng(1))).toThrow();
    expect(pickOptionalCell([], createRng(1)).cell).toBeNull();
  });

  it('replenishes world orbs up to orbTargetCount and scatters loot orbs along bot spine', () => {
    const res = replenishWorldOrbs({
      orbs: [],
      config: DEFAULT_CONFIG,
      playerHead: { x: 0, z: 0 },
      rng: createRng(5),
    });
    expect(res.orbs).toHaveLength(DEFAULT_CONFIG.orbTargetCount);
    expect(res.orbs.every((o) => o.value === 1 && !o.isLoot)).toBe(true);

    const loot = scatterLootOrbs({
      orbs: res.orbs,
      spine: [
        { x: 4, z: 4 },
        { x: 3.5, z: 4 },
        { x: 3, z: 4 },
      ],
      count: 8,
      value: 3,
      config: DEFAULT_CONFIG,
      rng: res.rng,
    });
    expect(loot.orbs).toHaveLength(DEFAULT_CONFIG.orbTargetCount + 8);
    expect(loot.orbs.filter((o) => o.isLoot && o.value === 3)).toHaveLength(8);
  });
});
