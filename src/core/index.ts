/** Public API of the pure game core. */
export type {
  Cell,
  Direction,
  Difficulty,
  GameAction,
  GameConfig,
  GamePhase,
  GameState,
  RngState,
} from './types';

export { createInitialState, reduce, type NewGameOptions } from './game';
export { configFor, DEFAULT_CONFIG } from './config';
export { delta, isOpposite } from './direction';
export { activeSize, wallBounds, innerBounds } from './systems/arena';
export { freeCells, pickFood } from './systems/food';
export { canTransition } from './stateMachine';
export { createRng, nextRandom, nextInt } from './rng';
