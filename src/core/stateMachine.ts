import type { GamePhase } from './types';

/**
 * Allowed phase transitions. `reduce` enforces these implicitly per action;
 * this table documents them explicitly and is used by tests to assert that no
 * illegal transition slips through.
 */
const TRANSITIONS: Record<GamePhase, readonly GamePhase[]> = {
  ready: ['playing'],
  playing: ['paused', 'gameover'],
  paused: ['playing', 'gameover'],
  gameover: ['ready', 'playing'],
};

/** Whether moving from one phase to another is legal. */
export function canTransition(from: GamePhase, to: GamePhase): boolean {
  return TRANSITIONS[from].includes(to);
}
