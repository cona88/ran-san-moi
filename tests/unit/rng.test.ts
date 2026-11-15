import { describe, expect, it } from 'vitest';
import { createRng, nextFloat, nextInt, nextRandom } from '../../src/core/rng';

describe('rng', () => {
  it('is deterministic: same state yields the same value', () => {
    const state = createRng(123);
    expect(nextRandom(state).value).toBe(nextRandom(state).value);
  });

  it('advances: drawing from the next state yields a different value', () => {
    const a = nextRandom(createRng(123));
    const b = nextRandom(a.next);
    expect(b.value).not.toBe(a.value);
  });

  it('produces floats in [0, 1)', () => {
    let state = createRng(7);
    for (let i = 0; i < 100; i++) {
      const draw = nextRandom(state);
      expect(draw.value).toBeGreaterThanOrEqual(0);
      expect(draw.value).toBeLessThan(1);
      state = draw.next;
    }
  });

  it('nextInt stays within [0, maxExclusive)', () => {
    let state = createRng(99);
    for (let i = 0; i < 100; i++) {
      const draw = nextInt(state, 5);
      expect(draw.value).toBeGreaterThanOrEqual(0);
      expect(draw.value).toBeLessThan(5);
      expect(Number.isInteger(draw.value)).toBe(true);
      state = draw.next;
    }
  });

  it('different seeds diverge and handles non-positive nextInt', () => {
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 8; seed++) {
      firsts.add(nextInt(createRng(seed), 1000).value);
    }
    expect(firsts.size).toBeGreaterThan(1);
    const rng = createRng(5);
    expect(nextFloat(rng)).toEqual(nextRandom(rng));
    expect(nextInt(rng, 0)).toEqual({ value: 0, next: rng });
  });
});
