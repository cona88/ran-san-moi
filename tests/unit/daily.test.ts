// @vitest-environment jsdom
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

import { afterEach } from 'vitest';
import { currentStreak, recordDailyPlay } from '../../src/platform/daily';

afterEach(() => localStorage.clear());

describe('daily streak', () => {
  it('starts a streak of 1 on first play', () => {
    const s = recordDailyPlay(new Date('2026-07-08T12:00:00Z'));
    expect(s.count).toBe(1);
    expect(s.lastPlayedDate).toBe('2026-07-08');
  });

  it('increments on consecutive days', () => {
    recordDailyPlay(new Date('2026-07-08T12:00:00Z'));
    const s = recordDailyPlay(new Date('2026-07-09T08:00:00Z'));
    expect(s.count).toBe(2);
  });

  it('resets to 1 if a day is skipped', () => {
    recordDailyPlay(new Date('2026-07-08T12:00:00Z'));
    const s = recordDailyPlay(new Date('2026-07-10T12:00:00Z'));
    expect(s.count).toBe(1);
  });

  it('is idempotent within the same day', () => {
    recordDailyPlay(new Date('2026-07-08T09:00:00Z'));
    const s = recordDailyPlay(new Date('2026-07-08T20:00:00Z'));
    expect(s.count).toBe(1);
  });

  it('currentStreak reflects an unbroken streak', () => {
    recordDailyPlay(new Date('2026-07-08T12:00:00Z'));
    expect(currentStreak(new Date('2026-07-09T06:00:00Z'))).toBe(1); // due today, not broken yet
  });

  it('currentStreak drops to 0 once more than a day has passed', () => {
    recordDailyPlay(new Date('2026-07-08T12:00:00Z'));
    expect(currentStreak(new Date('2026-07-10T06:00:00Z'))).toBe(0);
  });
});
