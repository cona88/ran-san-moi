import type { GameState, SnakeForm } from '../core/types';
import {
  ACHIEVEMENTS,
  evaluateRunAchievements,
  loadUnlockedAchievements,
  unlockAchievements,
  type AchievementDef,
} from '../platform/achievements';

/**
 * Observes GameState transitions and unlocks run-scoped achievements. Owns the
 * cross-tick run counters those rules need (pending-shrink survivals, best at
 * run start, distinct forms used, shield blocks) while keeping rules pure in
 * `platform/achievements.ts`.
 */
export class AchievementTracker {
  private pendingShrinkSurvivals = 0;
  private bestAtRunStart = 0;
  private readonly formsUsed = new Set<SnakeForm>();
  private shieldBlocks = 0;
  private bossesDefeated = 0;
  private lastEventId = 0;

  constructor(private readonly onUnlock: (defs: AchievementDef[]) => void) {}

  onStateChange(prev: GameState, next: GameState): void {
    if (next.eventSeq < this.lastEventId) {
      this.lastEventId = 0;
    }

    if (next.phase === 'playing' && (prev.phase === 'ready' || prev.phase === 'gameover')) {
      this.resetForNewRun(prev.best, next.form);
    }

    if (next.phase === 'playing') {
      this.formsUsed.add(next.form);
    }

    if (prev.pendingShrink && !next.pendingShrink && next.arenaMargin > prev.arenaMargin) {
      this.pendingShrinkSurvivals++;
    }

    for (const ev of next.events) {
      if (ev.id <= this.lastEventId) continue;
      this.lastEventId = ev.id;
      if (ev.kind === 'shield_block') {
        this.shieldBlocks++;
      } else if (ev.kind === 'boss_defeated') {
        this.bossesDefeated++;
      }
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
        enemiesDefeated: next.enemiesDefeated,
        formsUsedCount: this.formsUsed.size,
        questsSolved: next.questsSolved,
        shieldBlocks: this.shieldBlocks,
        botsEaten: next.botsEaten,
        bossesDefeated: this.bossesDefeated,
        playerRank:
          next.phase === 'playing' || next.phase === 'gameover' ? next.playerRank : undefined,
      },
      unlocked,
    );

    this.applyUnlocks(newlyUnlockedIds);
  }

  /** Resets cross-run state when a fresh run starts outside normal transitions. */
  resetForNewRun(bestAtRunStart: number, initialForm: SnakeForm = 'dragon'): void {
    this.bestAtRunStart = bestAtRunStart;
    this.pendingShrinkSurvivals = 0;
    this.formsUsed.clear();
    this.formsUsed.add(initialForm);
    this.shieldBlocks = 0;
    this.bossesDefeated = 0;
  }

  /** Unlocks achievement ids, persists them, and notifies listeners for toasts. */
  applyUnlocks(ids: readonly string[]): void {
    if (ids.length === 0) return;
    unlockAchievements(ids);
    const defs = ACHIEVEMENTS.filter((def) => ids.includes(def.id));
    this.onUnlock(defs);
  }
}
