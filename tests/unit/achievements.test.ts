// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState, reduce } from '../../src/core';
import { AchievementTracker } from '../../src/app/achievementTracker';
import {
  ACHIEVEMENTS,
  evaluateLeaderboardAchievements,
  evaluateRunAchievements,
  evaluateStreakAchievements,
  loadUnlockedAchievements,
  unlockAchievements,
  type RunEvent,
} from '../../src/platform/achievements';

const base: RunEvent = {
  nextScore: 0,
  won: false,
  isGameOver: false,
  bestAtRunStart: 0,
  pendingShrinkSurvivals: 0,
  hour: 12,
  enemiesDefeated: 0,
  formsUsedCount: 1,
  questsSolved: 0,
  shieldBlocks: 0,
};
const none = new Set<string>();

afterEach(() => localStorage.clear());

describe('Vietnamese achievement definitions', () => {
  it('provides cute Vietnamese names and descriptions for all achievements', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(11);
    for (const def of ACHIEVEMENTS) {
      expect(def.name.length).toBeGreaterThan(3);
      expect(def.description.length).toBeGreaterThan(5);
    }
    expect(ACHIEVEMENTS.find((a) => a.id === 'first-bite')?.name).toBe('Khởi Đầu Phép Thuật');
    expect(ACHIEVEMENTS.find((a) => a.id === 'meteor-shooter')?.name).toBe('Xạ Thủ Sao Băng');
    expect(ACHIEVEMENTS.find((a) => a.id === 'shape-shifter')?.name).toBe('Bậc Thầy Biến Hình');
    expect(ACHIEVEMENTS.find((a) => a.id === 'bright-mind')?.name).toBe('Trí Tuệ Tỏa Sáng');
    expect(ACHIEVEMENTS.find((a) => a.id === 'bot-hunter')?.name).toBe('Thợ Săn Nhí');
    expect(ACHIEVEMENTS.find((a) => a.id === 'honeycomb-champion')?.name).toBe('Bá Chủ Tổ Ong');
    expect(ACHIEVEMENTS.find((a) => a.id === 'dragon-slayer')?.name).toBe('Dũng Sĩ Diệt Rồng');
    expect(ACHIEVEMENTS.find((a) => a.id === 'crown-queen')?.name).toBe('Nữ Hoàng Vương Miện');
  });
});

describe('evaluateRunAchievements', () => {
  it('unlocks first-bite on the first crystal/food', () => {
    expect(evaluateRunAchievements({ ...base, nextScore: 1 }, none)).toContain('first-bite');
  });

  it('does not re-unlock an already-unlocked id', () => {
    const unlocked = new Set(['first-bite']);
    expect(evaluateRunAchievements({ ...base, nextScore: 1 }, unlocked)).not.toContain(
      'first-bite',
    );
  });

  it('unlocks halfway-there at score 100 and speed-demon at score 300', () => {
    expect(evaluateRunAchievements({ ...base, nextScore: 99 }, none)).not.toContain(
      'halfway-there',
    );
    expect(evaluateRunAchievements({ ...base, nextScore: 100 }, none)).toContain('halfway-there');
    expect(evaluateRunAchievements({ ...base, nextScore: 300 }, none)).toContain('speed-demon');
  });

  it('unlocks meteor-shooter, shape-shifter, bright-mind, and shield-guardian', () => {
    expect(evaluateRunAchievements({ ...base, enemiesDefeated: 5 }, none)).toContain(
      'meteor-shooter',
    );
    expect(evaluateRunAchievements({ ...base, formsUsedCount: 4 }, none)).toContain(
      'shape-shifter',
    );
    expect(evaluateRunAchievements({ ...base, questsSolved: 5 }, none)).toContain('bright-mind');
    expect(evaluateRunAchievements({ ...base, shieldBlocks: 2 }, none)).toContain(
      'shield-guardian',
    );
  });

  it('unlocks bot-hunter, honeycomb-champion, dragon-slayer, and crown-queen', () => {
    expect(evaluateRunAchievements({ ...base, botsEaten: 1 }, none)).toContain('bot-hunter');
    expect(evaluateRunAchievements({ ...base, botsEaten: 1 }, none)).not.toContain(
      'honeycomb-champion',
    );
    expect(evaluateRunAchievements({ ...base, botsEaten: 5 }, none)).toEqual(
      expect.arrayContaining(['bot-hunter', 'honeycomb-champion']),
    );
    expect(evaluateRunAchievements({ ...base, bossesDefeated: 1 }, none)).toContain(
      'dragon-slayer',
    );
    expect(evaluateRunAchievements({ ...base, playerRank: 1 }, none)).toContain('crown-queen');
    expect(evaluateRunAchievements({ ...base, playerRank: 2 }, none)).not.toContain('crown-queen');
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

  it('unlocks comeback-kid only on game-over, beating the run-start best by 50+', () => {
    const event: RunEvent = { ...base, isGameOver: true, bestAtRunStart: 100, nextScore: 150 };
    expect(evaluateRunAchievements(event, none)).toContain('comeback-kid');
    expect(evaluateRunAchievements({ ...event, nextScore: 149 }, none)).not.toContain(
      'comeback-kid',
    );
  });

  it("never unlocks comeback-kid on a player's very first run (no prior best)", () => {
    const event: RunEvent = { ...base, isGameOver: true, bestAtRunStart: 0, nextScore: 200 };
    expect(evaluateRunAchievements(event, none)).not.toContain('comeback-kid');
  });

  it('can unlock several achievements in one event', () => {
    const event: RunEvent = { ...base, nextScore: 320, hour: 1, formsUsedCount: 4 };
    const unlocked = evaluateRunAchievements(event, none);
    expect(unlocked).toEqual(
      expect.arrayContaining([
        'first-bite',
        'halfway-there',
        'speed-demon',
        'shape-shifter',
        'night-crawler',
      ]),
    );
  });
});

describe('evaluateStreakAchievements', () => {
  it('unlocks three-day-streak at 3, not before', () => {
    expect(evaluateStreakAchievements(3, none)).toContain('three-day-streak');
    expect(evaluateStreakAchievements(2, none)).not.toContain('three-day-streak');
  });

  it('unlocks week-streak at 7 and neon-regular at 30', () => {
    expect(evaluateStreakAchievements(7, none)).toContain('week-streak');
    expect(evaluateStreakAchievements(30, none)).toContain('neon-regular');
  });

  it('a big streak unlocks every threshold crossed at once', () => {
    const unlocked = evaluateStreakAchievements(30, none);
    expect(unlocked).toEqual(
      expect.arrayContaining(['three-day-streak', 'week-streak', 'neon-regular']),
    );
  });
});

describe('evaluateLeaderboardAchievements', () => {
  it('unlocks top-three for rank 1-3', () => {
    expect(evaluateLeaderboardAchievements(1, none)).toContain('top-three');
    expect(evaluateLeaderboardAchievements(3, none)).toContain('top-three');
  });

  it('does not unlock for rank 4 or worse, or a null rank', () => {
    expect(evaluateLeaderboardAchievements(4, none)).not.toContain('top-three');
    expect(evaluateLeaderboardAchievements(null, none)).not.toContain('top-three');
  });
});

describe('unlocked-achievements persistence & AchievementTracker', () => {
  it('starts empty and round-trips unlocked ids', () => {
    expect(loadUnlockedAchievements().size).toBe(0);
    unlockAchievements(['first-bite', 'halfway-there']);
    const loaded = loadUnlockedAchievements();
    expect(loaded.has('first-bite')).toBe(true);
    expect(loaded.has('halfway-there')).toBe(true);
    expect(loaded.size).toBe(2);
  });

  it('merges across multiple calls without duplicates', () => {
    unlockAchievements(['first-bite']);
    unlockAchievements(['first-bite', 'speed-demon']);
    expect(loadUnlockedAchievements().size).toBe(2);
  });

  it('falls back to empty on corrupt JSON', () => {
    localStorage.setItem('neonSnakeAchievements', '{ not json');
    expect(loadUnlockedAchievements().size).toBe(0);
  });

  it('unlocks Bậc Thầy Biến Hình via AchievementTracker when cycling all 4 forms', () => {
    const unlockedDefs: string[] = [];
    const tracker = new AchievementTracker((defs) => {
      for (const def of defs) unlockedDefs.push(def.id);
    });

    const ready = createInitialState({ seed: 1 });
    let s = reduce(ready, { type: 'start' });
    tracker.onStateChange(ready, s);

    for (const form of ['phoenix', 'unicorn', 'spirit'] as const) {
      const prev = s;
      s = reduce(s, { type: 'morph', form });
      tracker.onStateChange(prev, s);
    }

    expect(unlockedDefs).toContain('shape-shifter');
  });

  it('unlocks Bot/Boss/Crown achievements via AchievementTracker during gameplay', () => {
    const unlockedDefs: string[] = [];
    const tracker = new AchievementTracker((defs) => {
      for (const def of defs) unlockedDefs.push(def.id);
    });

    const ready = createInitialState({ seed: 1 });
    let s = reduce(ready, { type: 'start' });
    tracker.onStateChange(ready, s);

    const prev1 = s;
    s = { ...s, botsEaten: 1 };
    tracker.onStateChange(prev1, s);
    expect(unlockedDefs).toContain('bot-hunter');

    const prev2 = s;
    s = { ...s, botsEaten: 5 };
    tracker.onStateChange(prev2, s);
    expect(unlockedDefs).toContain('honeycomb-champion');

    const prev3 = s;
    s = {
      ...s,
      eventSeq: s.eventSeq + 1,
      events: [{ id: s.eventSeq + 1, kind: 'boss_defeated', points: 500 }],
    };
    tracker.onStateChange(prev3, s);
    expect(unlockedDefs).toContain('dragon-slayer');

    const prev4 = s;
    s = { ...s, playerRank: 1 };
    tracker.onStateChange(prev4, s);
    expect(unlockedDefs).toContain('crown-queen');
  });
});
