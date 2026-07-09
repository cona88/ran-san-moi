import { describe, expect, it } from 'vitest';
import { dailySeed } from '../../src/platform/daily';

describe('dailySeed', () => {
  it('is deterministic for the same UTC day', () => {
    const a = dailySeed(new Date('2026-07-08T00:00:00Z'));
    const b = dailySeed(new Date('2026-07-08T23:59:59Z'));
    expect(a).toBe(b);
  });

  it('differs across days', () => {
    const day1 = dailySeed(new Date('2026-07-08T12:00:00Z'));
    const day2 = dailySeed(new Date('2026-07-09T12:00:00Z'));
    expect(day1).not.toBe(day2);
  });

  it('is a non-negative 32-bit integer', () => {
    const seed = dailySeed(new Date('2026-07-08T12:00:00Z'));
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });
});
