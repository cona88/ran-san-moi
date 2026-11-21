import { describe, expect, it } from 'vitest';
import { createInitialBoosters, createInitialState, reduce } from '../../src/core';
import { configFor, difficultyTuningFor } from '../../src/core/config';
import type { FairySkillKind, GameState } from '../../src/core/types';

function startPlaying(options?: Parameters<typeof createInitialState>[0]): GameState {
  return reduce(createInitialState(options), { type: 'start' });
}

describe('starter all-effects setup & easy preset tuning', () => {
  it('preserves level 5 and level booster charge=1 while giving speed=2 and magnet=2', () => {
    const boosters = createInitialBoosters();
    expect(boosters.level.charges).toBe(1);
    expect(boosters.speed.charges).toBe(2);
    expect(boosters.magnet.charges).toBe(2);

    const ready = createInitialState({ difficulty: 'easy', seed: 10 });
    expect(ready.level).toBe(5);
    expect(ready.boosters.level.charges).toBe(1);
    expect(ready.boosters.speed.charges).toBe(2);
    expect(ready.boosters.magnet.charges).toBe(2);

    // Using level booster once still jumps Lv.5 -> Lv.15 and empties charges to 0
    const playing = reduce(ready, { type: 'start' });
    const leveled = reduce(playing, { type: 'activate_booster', booster: 'level' });
    expect(leveled.level).toBe(15);
    expect(leveled.boosters.level.charges).toBe(0);
    expect(leveled.boosters.speed.charges).toBe(2);
    expect(leveled.boosters.magnet.charges).toBe(2);
  });

  it('starts with full butterflyCharge=100, dashEnergy=100, and all 6 fairy skills at 0 cooldown', () => {
    const ready = createInitialState({ difficulty: 'easy', seed: 3 });
    const playing = startPlaying({ difficulty: 'easy', seed: 3 });

    for (const s of [ready, playing]) {
      expect(s.butterflyStage).toBe('caterpillar');
      expect(s.butterflyCharge).toBe(100);
      expect(s.dashEnergy).toBe(100);
      expect(s.flowerCooldownTicks).toBe(0);
      expect(s.thunderCooldownTicks).toBe(0);
      expect(s.fireCooldownTicks).toBe(0);
      expect(s.waterCooldownTicks).toBe(0);
      expect(s.arcaneCooldownTicks).toBe(0);
      expect(s.shieldCooldownTicks).toBe(0);
    }

    // All 6 fairy skills are immediately castable on tick 0
    const skills: readonly FairySkillKind[] = [
      'flower',
      'butterfly',
      'thunder',
      'fire',
      'water',
      'arcane',
    ];
    for (const skill of skills) {
      const cast = reduce(playing, { type: 'cast_fairy_skill', skill });
      expect(cast).not.toBe(playing);
      expect(cast.events.length).toBeGreaterThan(0);
    }
  });

  it('spawns an immediate letter/word BrainQuest on tick 0 for adventure, easy, and normal', () => {
    for (const opts of [
      { difficulty: 'easy', mode: 'adventure', ageProfile: 'age6', seed: 5 },
      { difficulty: 'easy', mode: 'cozy', ageProfile: 'age6', seed: 5 },
      { difficulty: 'normal', mode: 'adventure', ageProfile: 'age9', seed: 7 },
      { difficulty: 'normal', mode: 'reflex', ageProfile: 'age6', seed: 9 },
      { difficulty: 'hard', mode: 'adventure', ageProfile: 'age9', seed: 11 },
    ] as const) {
      const ready = createInitialState(opts);
      const playing = startPlaying(opts);

      for (const s of [ready, playing]) {
        expect(s.quest).not.toBeNull();
        expect(['letter_match', 'word_spell']).toContain(s.quest!.kind);
        expect(s.quest!.orbs.length).toBeGreaterThanOrEqual(
          s.quest!.kind === 'letter_match' ? 3 : 2,
        );
        for (const orb of s.quest!.orbs) {
          const dist = Math.hypot(orb.cell.x, orb.cell.z);
          expect(dist).toBeGreaterThanOrEqual(13.0);
          expect(dist).toBeLessThanOrEqual(s.config.worldRadius);
        }
      }
    }

    // hard + reflex keeps null quest at tick 0 (until maybeSpawnQuest triggers)
    const hardReflex = startPlaying({ difficulty: 'hard', mode: 'reflex', seed: 12 });
    expect(hardReflex.quest).toBeNull();
  });

  it('spawns beginner-friendly Lv.1..4 bots at safe medium distance on easy and normal', () => {
    const easy = startPlaying({ difficulty: 'easy', seed: 15 });
    const easyHead = easy.snake[0]!;
    const nearLowEasy = easy.bots.filter((b) => {
      const d = Math.hypot(b.head.x - easyHead.x, b.head.z - easyHead.z);
      return b.level >= 1 && b.level <= 4 && d >= 9 && d <= 18;
    });
    expect(nearLowEasy.length).toBeGreaterThanOrEqual(10);

    // Ensure safe clearance around player spawn at (0,0) for every bot
    for (const bot of easy.bots) {
      const headDist = Math.hypot(bot.head.x - easyHead.x, bot.head.z - easyHead.z);
      expect(headDist).toBeGreaterThanOrEqual(9.0);
    }
  });

  it('gives easy mode gentler bot speeds, shorter fairy cooldowns, faster cooldown recovery, and faster butterfly recharge', () => {
    const easyCfg = configFor('easy');
    const normalCfg = configFor('normal');
    expect(easyCfg.orbTargetCount).toBeGreaterThan(normalCfg.orbTargetCount);
    expect(easyCfg.baseSpeed).toBeLessThan(normalCfg.baseSpeed);

    const easyTune = difficultyTuningFor('easy');
    const normalTune = difficultyTuningFor('normal');
    expect(easyTune.botSpeedScale).toBeLessThan(normalTune.botSpeedScale);
    expect(easyTune.fairyCooldownScale).toBeLessThan(normalTune.fairyCooldownScale);
    expect(easyTune.fairyCooldownBonusRecovery).toBeGreaterThan(0);
    expect(easyTune.butterflyChargeBonusRegen).toBeGreaterThan(0);

    // Shorter cooldown on cast + faster per-tick recovery on easy vs normal
    const easyStart = startPlaying({ difficulty: 'easy', seed: 20 });
    const normalStart = startPlaying({ difficulty: 'normal', seed: 20 });

    const easyThunder = reduce(easyStart, { type: 'cast_fairy_skill', skill: 'thunder' });
    const normalThunder = reduce(normalStart, { type: 'cast_fairy_skill', skill: 'thunder' });
    expect(easyThunder.thunderCooldownTicks).toBeLessThan(normalThunder.thunderCooldownTicks);

    const easyAfterTick = reduce(easyThunder, { type: 'tick' });
    const normalAfterTick = reduce(normalThunder, { type: 'tick' });
    const easyDelta = easyThunder.thunderCooldownTicks - easyAfterTick.thunderCooldownTicks;
    const normalDelta = normalThunder.thunderCooldownTicks - normalAfterTick.thunderCooldownTicks;
    expect(easyDelta).toBeGreaterThan(normalDelta);

    // Faster butterflyCharge recharge while caterpillar on easy
    const easyRecharging = reduce(
      { ...easyStart, butterflyCharge: 10, bots: [] },
      { type: 'tick' },
    );
    const normalRecharging = reduce(
      { ...normalStart, butterflyCharge: 10, bots: [] },
      { type: 'tick' },
    );
    expect(easyRecharging.butterflyCharge).toBeGreaterThan(normalRecharging.butterflyCharge);

    // Gentler bot step distance on easy vs normal
    const easyBotMoved = reduce(easyStart, { type: 'tick' });
    const normalBotMoved = reduce(normalStart, { type: 'tick' });
    const easyMoveDist = Math.hypot(
      easyBotMoved.bots[0]!.head.x - easyStart.bots[0]!.head.x,
      easyBotMoved.bots[0]!.head.z - easyStart.bots[0]!.head.z,
    );
    const normalMoveDist = Math.hypot(
      normalBotMoved.bots[0]!.head.x - normalStart.bots[0]!.head.x,
      normalBotMoved.bots[0]!.head.z - normalStart.bots[0]!.head.z,
    );
    expect(easyMoveDist).toBeLessThan(normalMoveDist);
  });
});
