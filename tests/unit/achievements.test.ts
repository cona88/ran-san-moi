import { describe, expect, it } from 'vitest';
import { evaluateRunAchievements, type RunEvent } from '../../src/platform/achievements';

const base: RunEvent = {
  nextScore: 0,
  won: false,
  isGameOver: false,
  bestAtRunStart: 0,
  pendingShrinkSurvivals: 0,
  hour: 12,
};
const none = new Set<string>();

describe('evaluateRunAchievements', () => {
  it('unlocks first-bite on the first food', () => {
    expect(evaluateRunAchievements({ ...base, nextScore: 1 }, none)).toContain('first-bite');
  });

  it('does not re-unlock an already-unlocked id', () => {
    const unlocked = new Set(['first-bite']);
    expect(evaluateRunAchievements({ ...base, nextScore: 1 }, unlocked)).not.toContain(
      'first-bite',
    );
  });

  it('unlocks halfway-there at score 10', () => {
    expect(evaluateRunAchievements({ ...base, nextScore: 10 }, none)).toContain('halfway-there');
  });

  it('unlocks speed-demon at score 20', () => {
    expect(evaluateRunAchievements({ ...base, nextScore: 20 }, none)).toContain('speed-demon');
  });

  it('unlocks iron-wall after 3 pending-shrink survivals', () => {
    expect(evaluateRunAchievements({ ...base, pendingShrinkSurvivals: 3 }, none)).toContain(
      'iron-wall',
    );
    expect(evaluateRunAchievements({ ...base, pendingShrinkSurvivals: 2 }, none)).not.toContain(
      'iron-wall',
    );
  });

  it('unlocks night-crawler between midnight and 4am', () => {
    expect(evaluateRunAchievements({ ...base, hour: 2 }, none)).toContain('night-crawler');
    expect(evaluateRunAchievements({ ...base, hour: 4 }, none)).not.toContain('night-crawler');
  });

  it('unlocks perfectionist only on a winning game-over', () => {
    expect(evaluateRunAchievements({ ...base, isGameOver: true, won: true }, none)).toContain(
      'perfectionist',
    );
    expect(evaluateRunAchievements({ ...base, isGameOver: false, won: true }, none)).not.toContain(
      'perfectionist',
    );
  });

  it('unlocks comeback-kid only on game-over, beating the run-start best by 5+', () => {
    const event: RunEvent = { ...base, isGameOver: true, bestAtRunStart: 10, nextScore: 15 };
    expect(evaluateRunAchievements(event, none)).toContain('comeback-kid');
    expect(evaluateRunAchievements({ ...event, nextScore: 14 }, none)).not.toContain(
      'comeback-kid',
    );
  });

  it("never unlocks comeback-kid on a player's very first run (no prior best)", () => {
    const event: RunEvent = { ...base, isGameOver: true, bestAtRunStart: 0, nextScore: 20 };
    expect(evaluateRunAchievements(event, none)).not.toContain('comeback-kid');
  });

  it('can unlock several achievements in one event', () => {
    const event: RunEvent = { ...base, nextScore: 20, hour: 1 };
    const unlocked = evaluateRunAchievements(event, none);
    expect(unlocked).toEqual(
      expect.arrayContaining(['first-bite', 'halfway-there', 'speed-demon', 'night-crawler']),
    );
  });
});
