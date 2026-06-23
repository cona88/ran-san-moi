import { describe, expect, it } from 'vitest';
import { delta, isOpposite } from '../../src/core/direction';

describe('direction', () => {
  it('maps directions to unit grid steps (up = -z)', () => {
    expect(delta('up')).toEqual({ x: 0, z: -1 });
    expect(delta('down')).toEqual({ x: 0, z: 1 });
    expect(delta('left')).toEqual({ x: -1, z: 0 });
    expect(delta('right')).toEqual({ x: 1, z: 0 });
  });

  it('detects opposite pairs', () => {
    expect(isOpposite('up', 'down')).toBe(true);
    expect(isOpposite('down', 'up')).toBe(true);
    expect(isOpposite('left', 'right')).toBe(true);
    expect(isOpposite('right', 'left')).toBe(true);
  });

  it('rejects non-opposite pairs', () => {
    expect(isOpposite('up', 'left')).toBe(false);
    expect(isOpposite('up', 'up')).toBe(false);
    expect(isOpposite('right', 'down')).toBe(false);
  });
});
