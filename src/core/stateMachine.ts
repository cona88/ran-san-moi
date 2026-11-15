import type { GamePhase } from './types';

/**
 * Allowed phase transitions, including `reset`, which is an explicit escape
 * hatch back to `ready` from any active phase.
 */
const TRANSITIONS: Record<GamePhase, readonly GamePhase[]> = {
  ready: ['playing'],
  playing: ['paused', 'gameover', 'ready'],
  paused: ['playing', 'gameover', 'ready'],
  gameover: ['ready', 'playing'],
};

/** Whether moving from one phase to another is legal. */
export function isValidTransition(from: GamePhase, to: GamePhase): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Alias for {@link isValidTransition}. */
export const canTransition = isValidTransition;
