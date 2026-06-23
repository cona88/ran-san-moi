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
});
