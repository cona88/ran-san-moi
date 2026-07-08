/**
 * Pure domain types for the game core.
 *
 * Nothing in `src/core` may import from the browser, the DOM or Three.js —
 * the entire simulation is a deterministic, headless module so it can be
 * unit-tested in milliseconds.
 */

/** A discrete grid coordinate. The board lives on the X/Z plane. */
export interface Cell {
  readonly x: number;
  readonly z: number;
}

/** The four cardinal directions the snake can travel. */
export type Direction = 'up' | 'down' | 'left' | 'right';

/** Lifecycle phases, controlled by the {@link GamePhase} state machine. */
export type GamePhase = 'ready' | 'playing' | 'paused' | 'gameover';

/** Difficulty presets the player can choose in the settings screen. */
export type Difficulty = 'easy' | 'normal' | 'hard';

/** State of the seedable pseudo-random number generator. */
export interface RngState {
  readonly seed: number;
}

/**
 * Tunable rules for a game. Derived from a {@link Difficulty} via
 * `configFor`, but exposed as a plain object so tests can build tiny boards.
 */
export interface GameConfig {
  /** Fixed coordinate space / maximum board extent (N×N). */
  readonly maxGrid: number;
  /** Cells walled off on each side at the start. */
  readonly startMargin: number;
  /** Tightest the arena can close to. */
  readonly maxMargin: number;
  /** Foods eaten between each wall closing in by one cell per side. */
  readonly shrinkEvery: number;
  /** Starting tick length in milliseconds (lower = faster). */
  readonly baseTick: number;
  /** Fastest tick length the snake can reach. */
  readonly minTick: number;
  /** Milliseconds shaved off the tick per food eaten. */
  readonly tickStep: number;
  /** Number of segments the snake starts with. */
  readonly initialLength: number;
}

/**
 * The complete, immutable game state. Every field is `readonly`; transitions
 * are produced by {@link reduce}, which always returns a fresh object.
 */
export interface GameState {
  readonly phase: GamePhase;
  /** Snake body; index 0 is the head. */
  readonly snake: readonly Cell[];
  /** Current travel direction. */
  readonly direction: Direction;
  /** Buffered turns (max 2) so quick inputs are not dropped. */
  readonly queue: readonly Direction[];
  /** Current food position. */
  readonly food: Cell;
  readonly score: number;
  readonly best: number;
  /** Cells currently walled off on each side. */
  readonly arenaMargin: number;
  /**
   * True while a wall shrink is armed but waiting for the whole snake to fit
   * inside the tighter bounds. The live walls stay at `arenaMargin` until then.
   */
  readonly pendingShrink: boolean;
  /** Current tick length in milliseconds. */
  readonly tickInterval: number;
  /** True when the snake filled the board — a win, not a crash. */
  readonly won: boolean;
  readonly rng: RngState;
  readonly config: GameConfig;
}

/** Actions accepted by {@link reduce}. The only way to change state. */
export type GameAction =
  | { readonly type: 'start' }
  | { readonly type: 'turn'; readonly direction: Direction }
  | { readonly type: 'tick' }
  | { readonly type: 'pause' }
  | { readonly type: 'resume' }
  | { readonly type: 'reset' };
