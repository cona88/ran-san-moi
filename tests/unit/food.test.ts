import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/core/config';
import { createRng } from '../../src/core/rng';
import { freeCells, pickFood } from '../../src/core/systems/food';
import { innerBounds } from '../../src/core/systems/arena';

describe('food', () => {
  const config = DEFAULT_CONFIG;

  it('enumerates the full inner area when the snake is empty', () => {
    const { lo, hi } = innerBounds(config, 2); // [3, 21] -> 19x19
    const side = hi - lo + 1;
    expect(freeCells(config, 2, [])).toHaveLength(side * side);
  });

  it('excludes occupied cells', () => {
    const snake = [
      { x: 3, z: 3 },
      { x: 4, z: 3 },
    ];
    const cells = freeCells(config, 2, snake);
    expect(cells).not.toContainEqual({ x: 3, z: 3 });
    expect(cells).not.toContainEqual({ x: 4, z: 3 });
  });

  it('ignores snake cells outside the inner region', () => {
    const full = freeCells(config, 2, []).length;
    // a wall-line cell is never spawnable, so removing it changes nothing
    expect(freeCells(config, 2, [{ x: 2, z: 2 }])).toHaveLength(full);
  });

  it('pickFood returns a free cell and advances the rng', () => {
    const cells = freeCells(config, 2, []);
    const { food, rng } = pickFood(cells, createRng(1));
    expect(cells).toContainEqual(food);
    expect(rng.seed).not.toBe(createRng(1).seed);
  });

  it('pickFood throws when there are no free cells', () => {
    expect(() => pickFood([], createRng(1))).toThrow();
  });
});
