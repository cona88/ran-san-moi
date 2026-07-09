import type { GameState } from '../core/types';
import {
  ACHIEVEMENTS,
  evaluateRunAchievements,
  loadUnlockedAchievements,
  unlockAchievements,
  type AchievementDef,
} from '../platform/achievements';

/**
 * Observes GameState transitions and unlocks run-scoped achievements. Owns the
 * small amount of cross-tick state those rules need (pending-shrink survivals,
 * the score at the start of the current run) — everything else stays pure in
 * `platform/achievements.ts`.
 */
export class AchievementTracker {
  private pendingShrinkSurvivals = 0;
  private bestAtRunStart = 0;

  constructor(private readonly onUnlock: (defs: AchievementDef[]) => void) {}

  onStateChange(prev: GameState, next: GameState): void {
    if (next.phase === 'playing' && (prev.phase === 'ready' || prev.phase === 'gameover')) {
      this.bestAtRunStart = prev.best;
      this.pendingShrinkSurvivals = 0;
    }
    if (prev.pendingShrink && !next.pendingShrink && next.arenaMargin > prev.arenaMargin) {
      this.pendingShrinkSurvivals++;
    }

    const unlocked = loadUnlockedAchievements();
    const newlyUnlockedIds = evaluateRunAchievements(
      {
        nextScore: next.score,
        won: next.phase === 'gameover' && next.won,
        isGameOver: next.phase === 'gameover' && prev.phase !== 'gameover',
        bestAtRunStart: this.bestAtRunStart,
        pendingShrinkSurvivals: this.pendingShrinkSurvivals,
        hour: new Date().getHours(),
      },
      unlocked,
    );

    this.applyUnlocks(newlyUnlockedIds);
  }

  /**
   * Resets cross-run state for a fresh run that starts outside `dispatch`
   * (currently only the daily challenge, which bypasses the reducer to keep
   * date-seeding out of `src/core` — see `main.ts`'s daily-challenge callback).
   * `onStateChange` can't observe that transition itself, so the caller must
   * invoke this explicitly right before such a run begins.
   */
  resetForNewRun(bestAtRunStart: number): void {
    this.bestAtRunStart = bestAtRunStart;
    this.pendingShrinkSurvivals = 0;
  }

  /** Also used by Task 19 for streak/leaderboard-rank unlocks, which fire outside onStateChange. */
  applyUnlocks(ids: readonly string[]): void {
    if (ids.length === 0) return;
    unlockAchievements(ids);
    const defs = ACHIEVEMENTS.filter((def) => ids.includes(def.id));
    this.onUnlock(defs);
  }
}
