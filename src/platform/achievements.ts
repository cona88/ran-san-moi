export interface AchievementDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first-bite', name: 'First Bite', description: 'Eat your first food.' },
  { id: 'halfway-there', name: 'Halfway There', description: 'Reach a score of 10.' },
  { id: 'iron-wall', name: 'Iron Wall', description: 'Survive 3 wall shrinks in one run.' },
  { id: 'speed-demon', name: 'Speed Demon', description: 'Reach a score of 20.' },
  { id: 'perfectionist', name: 'Perfectionist', description: 'Win by filling the board.' },
  { id: 'comeback-kid', name: 'Comeback Kid', description: 'Beat your best by 5 or more.' },
  { id: 'night-crawler', name: 'Night Crawler', description: 'Play between midnight and 4am.' },
  { id: 'three-day-streak', name: 'Getting Started', description: '3-day daily-challenge streak.' },
  { id: 'week-streak', name: 'Committed', description: '7-day daily-challenge streak.' },
  { id: 'neon-regular', name: 'Neon Regular', description: '30-day daily-challenge streak.' },
  { id: 'top-three', name: 'Podium', description: 'Reach top 3 on a leaderboard.' },
];

export interface RunEvent {
  readonly nextScore: number;
  readonly won: boolean;
  readonly isGameOver: boolean;
  readonly bestAtRunStart: number;
  readonly pendingShrinkSurvivals: number;
  readonly hour: number;
}

/** Pure: given one run's state and the already-unlocked set, return newly-unlocked ids. */
export function evaluateRunAchievements(event: RunEvent, unlocked: ReadonlySet<string>): string[] {
  const newly: string[] = [];
  const maybeUnlock = (id: string, condition: boolean): void => {
    if (condition && !unlocked.has(id)) newly.push(id);
  };

  maybeUnlock('first-bite', event.nextScore >= 1);
  maybeUnlock('halfway-there', event.nextScore >= 10);
  maybeUnlock('speed-demon', event.nextScore >= 20);
  maybeUnlock('iron-wall', event.pendingShrinkSurvivals >= 3);
  maybeUnlock('night-crawler', event.hour >= 0 && event.hour < 4);

  if (event.isGameOver) {
    maybeUnlock('perfectionist', event.won);
    maybeUnlock(
      'comeback-kid',
      event.bestAtRunStart > 0 && event.nextScore - event.bestAtRunStart >= 5,
    );
  }

  return newly;
}

/** Pure: given the current daily streak length, return newly-crossed streak ids. */
export function evaluateStreakAchievements(
  streakCount: number,
  unlocked: ReadonlySet<string>,
): string[] {
  const newly: string[] = [];
  const maybeUnlock = (id: string, threshold: number): void => {
    if (streakCount >= threshold && !unlocked.has(id)) newly.push(id);
  };
  maybeUnlock('three-day-streak', 3);
  maybeUnlock('week-streak', 7);
  maybeUnlock('neon-regular', 30);
  return newly;
}

/** Pure: given a leaderboard rank (1-based, null if unranked), return newly-unlocked ids. */
export function evaluateLeaderboardAchievements(
  rank: number | null,
  unlocked: ReadonlySet<string>,
): string[] {
  if (rank !== null && rank <= 3 && !unlocked.has('top-three')) return ['top-three'];
  return [];
}
