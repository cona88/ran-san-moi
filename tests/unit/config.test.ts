import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  DEFAULT_SESSION_DURATION_MS,
  configFor,
  getSessionTotalTicks,
} from '../../src/core/config';

describe('config', () => {
  it('normal matches the default 5x open-world ruleset and 5-minute session', () => {
    expect(configFor('normal')).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG.worldRadius).toBe(280);
    expect(DEFAULT_CONFIG.maxGrid).toBe(560);
    expect(DEFAULT_CONFIG.baseTick).toBe(50);
    expect(DEFAULT_CONFIG.minTick).toBe(50);
    expect(DEFAULT_CONFIG.initialLength).toBe(10);
    expect(DEFAULT_CONFIG.orbTargetCount).toBe(850);
    expect(DEFAULT_CONFIG.botCount).toBe(60);
    expect(DEFAULT_CONFIG.sessionDurationMs).toBe(DEFAULT_SESSION_DURATION_MS);
    expect(DEFAULT_SESSION_DURATION_MS).toBe(300_000);
    expect(getSessionTotalTicks(DEFAULT_CONFIG)).toBe(6000);
  });

  it('easy is slower with more starting hearts than hard', () => {
    const easy = configFor('easy');
    const hard = configFor('hard');
    expect(easy.baseSpeed).toBeLessThan(hard.baseSpeed);
    expect(easy.initialHearts).toBe(4);
    expect(hard.initialHearts).toBe(3);
    expect(easy.botCount).toBe(55);
    expect(easy.orbTargetCount).toBe(975);
    expect(hard.botCount).toBe(65);
    expect(easy.baseTick).toBe(50);
    expect(hard.baseTick).toBe(50);
  });

  it('applies mode presets for cozy (wrapWalls, gentler bots) and reflex (faster)', () => {
    const cozy = configFor('normal', 'cozy');
    const reflex = configFor('normal', 'reflex');
    expect(cozy.wrapWalls).toBe(true);
    expect(cozy.botCount).toBe(45);
    expect(cozy.orbTargetCount).toBe(925);
    expect(cozy.baseSpeed).toBeLessThan(DEFAULT_CONFIG.baseSpeed);
    expect(cozy.initialHearts).toBeGreaterThanOrEqual(4);

    expect(reflex.wrapWalls).toBe(false);
    expect(reflex.baseSpeed).toBeGreaterThan(DEFAULT_CONFIG.baseSpeed);
    expect(reflex.botCount).toBe(65);
    expect(reflex.orbTargetCount).toBe(850);
  });
});
