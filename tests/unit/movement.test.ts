import { describe, expect, it } from 'vitest';
import type { Direction, GameState } from '../../src/core/types';
import { createInitialState } from '../../src/core/game';
import { enqueueTurn } from '../../src/core/movement';

function withQueue(queue: Direction[]): GameState {
  // base game faces 'right' with an empty queue
  return { ...createInitialState({ seed: 1 }), queue };
}

describe('enqueueTurn', () => {
  it('accepts a perpendicular turn', () => {
    expect(enqueueTurn(withQueue([]), 'up')).toEqual(['up']);
  });

  it('blocks a 180° reversal of the current direction', () => {
    expect(enqueueTurn(withQueue([]), 'left')).toEqual([]);
  });

  it('ignores a repeat of the current direction', () => {
    expect(enqueueTurn(withQueue([]), 'right')).toEqual([]);
  });

  it('validates against the last queued turn, not the live direction', () => {
    expect(enqueueTurn(withQueue(['up']), 'down')).toEqual(['up']); // opposite of queued
    expect(enqueueTurn(withQueue(['up']), 'up')).toEqual(['up']); // repeat of queued
    expect(enqueueTurn(withQueue(['up']), 'left')).toEqual(['up', 'left']); // perpendicular
  });

  it('caps the buffer at two turns', () => {
    expect(enqueueTurn(withQueue(['up', 'left']), 'down')).toEqual(['up', 'left']);
  });
});
