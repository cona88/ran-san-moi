import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/core/config';
import { activeSize, innerBounds, wallBounds } from '../../src/core/systems/arena';

describe('arena', () => {
  const config = DEFAULT_CONFIG; // maxGrid 25

  it('computes active size from margin', () => {
    expect(activeSize(config, 2)).toBe(21);
    expect(activeSize(config, 8)).toBe(9);
  });

  it('computes inclusive wall bounds', () => {
    expect(wallBounds(config, 2)).toEqual({ lo: 2, hi: 22 });
    expect(wallBounds(config, 8)).toEqual({ lo: 8, hi: 16 });
  });

  it('keeps food one cell inside the walls', () => {
    expect(innerBounds(config, 2)).toEqual({ lo: 3, hi: 21 });
    expect(innerBounds(config, 8)).toEqual({ lo: 9, hi: 15 });
  });
});
