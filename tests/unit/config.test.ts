import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, configFor } from '../../src/core/config';

describe('config', () => {
  it('normal matches the default ruleset', () => {
    expect(configFor('normal')).toEqual(DEFAULT_CONFIG);
  });

  it('easy is slower and shrinks less aggressively than hard', () => {
    const easy = configFor('easy');
    const hard = configFor('hard');
    expect(easy.baseTick).toBeGreaterThan(hard.baseTick);
    expect(easy.shrinkEvery).toBeGreaterThan(hard.shrinkEvery);
  });

  it('accelerates noticeably per food, scaling with difficulty', () => {
    expect(configFor('easy').tickStep).toBe(5);
    expect(configFor('normal').tickStep).toBe(7);
    expect(configFor('hard').tickStep).toBe(8);
  });
});
