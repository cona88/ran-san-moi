import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, configFor } from '../../src/core/config';

describe('config', () => {
  it('normal matches the default open-world ruleset', () => {
    expect(configFor('normal')).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG.worldRadius).toBe(56);
    expect(DEFAULT_CONFIG.maxGrid).toBe(112);
    expect(DEFAULT_CONFIG.baseTick).toBe(50);
    expect(DEFAULT_CONFIG.minTick).toBe(50);
    expect(DEFAULT_CONFIG.initialLength).toBe(10);
    expect(DEFAULT_CONFIG.orbTargetCount).toBe(170);
    expect(DEFAULT_CONFIG.botCount).toBe(15);
  });

  it('easy is slower with more starting hearts than hard', () => {
    const easy = configFor('easy');
    const hard = configFor('hard');
    expect(easy.baseSpeed).toBeLessThan(hard.baseSpeed);
    expect(easy.initialHearts).toBe(4);
    expect(hard.initialHearts).toBe(3);
    expect(easy.baseTick).toBe(50);
    expect(hard.baseTick).toBe(50);
  });

  it('applies mode presets for cozy (wrapWalls, gentler bots) and reflex (faster)', () => {
    const cozy = configFor('normal', 'cozy');
    const reflex = configFor('normal', 'reflex');
    expect(cozy.wrapWalls).toBe(true);
    expect(cozy.botCount).toBe(10);
    expect(cozy.baseSpeed).toBeLessThan(DEFAULT_CONFIG.baseSpeed);
    expect(cozy.initialHearts).toBeGreaterThanOrEqual(4);

    expect(reflex.wrapWalls).toBe(false);
    expect(reflex.baseSpeed).toBeGreaterThan(DEFAULT_CONFIG.baseSpeed);
    expect(reflex.botCount).toBe(16);
  });
});
