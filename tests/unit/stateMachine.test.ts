import { describe, expect, it } from 'vitest';
import { canTransition } from '../../src/core/stateMachine';

describe('stateMachine', () => {
  it('allows the expected transitions', () => {
    expect(canTransition('ready', 'playing')).toBe(true);
    expect(canTransition('playing', 'paused')).toBe(true);
    expect(canTransition('playing', 'gameover')).toBe(true);
    expect(canTransition('paused', 'playing')).toBe(true);
    expect(canTransition('gameover', 'ready')).toBe(true);
    expect(canTransition('gameover', 'playing')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(canTransition('ready', 'gameover')).toBe(false);
    expect(canTransition('ready', 'paused')).toBe(false);
    expect(canTransition('gameover', 'paused')).toBe(false);
    expect(canTransition('paused', 'ready')).toBe(false);
  });
});
