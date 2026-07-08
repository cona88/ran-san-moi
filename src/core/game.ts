import type { Cell, GameAction, GameConfig, GamePhase, GameState } from './types';
import { DEFAULT_CONFIG } from './config';
import { createRng } from './rng';
import { delta } from './direction';
import { enqueueTurn } from './movement';
import { allInsideWalls, hitsBody, hitsWall } from './systems/collision';
import { freeCells, pickFood } from './systems/food';

/** Build the starting snake: centred, length `initialLength`, facing right. */
function initialSnake(config: GameConfig): Cell[] {
  const start = Math.floor(config.maxGrid / 2);
  const snake: Cell[] = [];
  for (let i = 0; i < config.initialLength; i++) {
    snake.push({ x: start - i, z: start });
  }
  return snake;
}

/** Reset board, score, speed and arena while preserving `best`, `config` and RNG. */
function freshBoard(state: GameState, phase: GamePhase): GameState {
  const { config } = state;
  const snake = initialSnake(config);
  const { food, rng } = pickFood(freeCells(config, config.startMargin, snake), state.rng);
  return {
    ...state,
    phase,
    snake,
    direction: 'right',
    queue: [],
    food,
    score: 0,
    arenaMargin: config.startMargin,
    pendingShrink: false,
    tickInterval: config.baseTick,
    won: false,
    rng,
  };
}

export interface NewGameOptions {
  readonly config?: GameConfig;
  readonly seed?: number;
  readonly best?: number;
}

/** Create the very first state for a fresh game, in the `ready` phase. */
export function createInitialState(options: NewGameOptions = {}): GameState {
  const config = options.config ?? DEFAULT_CONFIG;
  const seed = options.seed ?? 1;
  const snake = initialSnake(config);
  const { food, rng } = pickFood(freeCells(config, config.startMargin, snake), createRng(seed));
  return {
    phase: 'ready',
    snake,
    direction: 'right',
    queue: [],
    food,
    score: 0,
    best: options.best ?? 0,
    arenaMargin: config.startMargin,
    pendingShrink: false,
    tickInterval: config.baseTick,
    won: false,
    rng,
    config,
  };
}

/** Advance the simulation by one tick. Assumes the caller is in `playing`. */
function step(state: GameState): GameState {
  const { config } = state;
  const direction = state.queue[0] ?? state.direction;
  const queue = state.queue.slice(1);
  const head = state.snake[0];
  if (head === undefined) {
    return { ...state, phase: 'gameover' };
  }

  const d = delta(direction);
  const next: Cell = { x: head.x + d.x, z: head.z + d.z };

  if (hitsWall(next, config, state.arenaMargin)) {
    return { ...state, phase: 'gameover', direction, queue };
  }

  const willGrow = next.x === state.food.x && next.z === state.food.z;
  // The tail moves out of the way unless we are growing into it.
  const body = willGrow ? state.snake : state.snake.slice(0, -1);
  if (hitsBody(next, body)) {
    return { ...state, phase: 'gameover', direction, queue };
  }

  const grown: Cell[] = [next, ...body];

  // Commit a pending shrink once the whole snake fits inside the tighter
  // walls; until then the old margin stays live so a shrink can never kill.
  let arenaMargin = state.arenaMargin;
  let pendingShrink = state.pendingShrink;
  if (pendingShrink && allInsideWalls(grown, config, arenaMargin + 1)) {
    arenaMargin += 1;
    pendingShrink = false;
  }

  if (!willGrow) {
    return { ...state, snake: grown, direction, queue, arenaMargin, pendingShrink };
  }

  const score = state.score + 1;
  const best = Math.max(state.best, score);
  // Arm (never immediately apply) the next shrink so the renderer can warn
  // first; a threshold reached while one is pending is absorbed by the flag.
  if (score % config.shrinkEvery === 0 && arenaMargin < config.maxMargin && !pendingShrink) {
    pendingShrink = true;
  }
  const tickInterval = Math.max(config.minTick, config.baseTick - score * config.tickStep);

  // While pending, spawn inside the future bounds so food never lands in the
  // soon-to-close band and the player is pulled inward.
  const spawnMargin = pendingShrink ? arenaMargin + 1 : arenaMargin;
  const free = freeCells(config, spawnMargin, grown);
  if (free.length === 0) {
    // Board full — the player has won.
    return {
      ...state,
      snake: grown,
      direction,
      queue,
      score,
      best,
      arenaMargin,
      pendingShrink,
      tickInterval,
      phase: 'gameover',
      won: true,
    };
  }

  const { food, rng } = pickFood(free, state.rng);
  return {
    ...state,
    snake: grown,
    direction,
    queue,
    score,
    best,
    arenaMargin,
    pendingShrink,
    tickInterval,
    food,
    rng,
  };
}

/**
 * The single pure reducer. Every state change flows through here; each branch
 * is a no-op outside the phase where it applies, so callers never have to
 * guard before dispatching.
 */
export function reduce(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'start':
      return state.phase === 'ready' || state.phase === 'gameover'
        ? freshBoard(state, 'playing')
        : state;
    case 'tick':
      return state.phase === 'playing' ? step(state) : state;
    case 'turn':
      return state.phase === 'playing'
        ? { ...state, queue: enqueueTurn(state, action.direction) }
        : state;
    case 'pause':
      return state.phase === 'playing' ? { ...state, phase: 'paused' } : state;
    case 'resume':
      return state.phase === 'paused' ? { ...state, phase: 'playing' } : state;
    case 'reset':
      return freshBoard(state, 'ready');
  }
}
