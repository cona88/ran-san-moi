import { describe, expect, it } from 'vitest';
import type { GameAction } from '../../src/core/types';
import { createInitialState, reduce } from '../../src/core/game';
import { canTransition } from '../../src/core/stateMachine';

describe('stateMachine', () => {
  it('allows the expected transitions', () => {
    expect(canTransition('ready', 'playing')).toBe(true);
    expect(canTransition('playing', 'paused')).toBe(true);
    expect(canTransition('playing', 'gameover')).toBe(true);
    expect(canTransition('paused', 'playing')).toBe(true);
    expect(canTransition('gameover', 'ready')).toBe(true);
    expect(canTransition('gameover', 'playing')).toBe(true);
    // reset is a legal escape hatch back to ready
    expect(canTransition('playing', 'ready')).toBe(true);
    expect(canTransition('paused', 'ready')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(canTransition('ready', 'gameover')).toBe(false);
    expect(canTransition('ready', 'paused')).toBe(false);
    expect(canTransition('gameover', 'paused')).toBe(false);
    expect(canTransition('playing', 'playing')).toBe(false);
  });

  it('reduce only ever produces transitions the table permits', () => {
    let state = createInitialState({ seed: 1 });
    const script: GameAction[] = [
      { type: 'start' }, // ready -> playing
      { type: 'pause' }, // playing -> paused
      { type: 'resume' }, // paused -> playing
      { type: 'reset' }, // playing -> ready
      { type: 'start' }, // ready -> playing
      { type: 'pause' }, // playing -> paused
      { type: 'reset' }, // paused -> ready
    ];
    for (const action of script) {
      const before = state.phase;
      state = reduce(state, action);
      if (state.phase !== before) {
        expect(
          canTransition(before, state.phase),
          `${before} -> ${state.phase} via ${action.type}`,
        ).toBe(true);
      }
    }
  });
});
