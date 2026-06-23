import type { Difficulty, GameConfig } from './types';

/** Normal difficulty — the original game's tuning. */
const BASE: GameConfig = {
  maxGrid: 25,
  startMargin: 2,
  maxMargin: 8,
  shrinkEvery: 10,
  baseTick: 300,
  minTick: 80,
  tickStep: 4,
  initialLength: 4,
};

const PRESETS: Record<Difficulty, GameConfig> = {
  easy: { ...BASE, baseTick: 360, tickStep: 3, shrinkEvery: 14, maxMargin: 6 },
  normal: { ...BASE },
  hard: { ...BASE, baseTick: 220, minTick: 70, tickStep: 5, shrinkEvery: 7 },
};

/** The default ruleset (normal difficulty). */
export const DEFAULT_CONFIG: GameConfig = PRESETS.normal;

/** Resolve the ruleset for a difficulty preset. */
export function configFor(difficulty: Difficulty): GameConfig {
  return PRESETS[difficulty];
}
