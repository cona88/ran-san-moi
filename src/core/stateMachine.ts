import type { GamePhase } from './types';

/**
 * Allowed phase transitions, including `reset`, which is an explicit escape
 * hatch back to `ready` from any active phase. `reduce` only ever produces
 * transitions listed here; the state-machine test drives every action through
 * `reduce` and asserts each resulting phase change is permitted.
 */
const TRANSITIONS: Record<GamePhase, readonly GamePhase[]> = {
  ready: ['playing'],
  playing: ['paused', 'gameover', 'ready'],
  paused: ['playing', 'gameover', 'ready'],
  gameover: ['ready', 'playing'],
};

/** Whether moving from one phase to another is legal. */
export function canTransition(from: GamePhase, to: GamePhase): boolean {
  return TRANSITIONS[from].includes(to);
}
