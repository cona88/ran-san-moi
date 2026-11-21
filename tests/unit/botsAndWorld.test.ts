import { describe, expect, it } from 'vitest';
import {
  BOT_SPEED_SCALE,
  SEGMENT_SPACING,
  chompBotByPlayer,
  createInitialState,
  effectiveBotSpineLength,
  getMagnetRadius,
  reduce,
  shootCooldownForForm,
  shrinkOrEliminateHelper,
  stepBots,
  targetBotSpineLength,
  xpThresholdForLevel,
  type BotSnake,
  type GameState,
  type WorldOrb,
} from '../../src/core';

function startPlaying(opts?: Parameters<typeof createInitialState>[0]): GameState {
  return reduce(createInitialState(opts), { type: 'start' });
}

function makeBot(overrides: Partial<BotSnake> = {}): BotSnake {
  const head = overrides.head ?? { x: 0.42, z: 0 };
  return {
    id: 901,
    name: 'Soyster',
    skin: 'lime_viper',
    isBoss: false,
    level: 3,
    head,
    prevHead: head,
    heading: 0,
    spine: [
      head,
      { x: head.x - 0.52, z: head.z },
      { x: head.x - 1.04, z: head.z },
      { x: head.x - 1.56, z: head.z },
      { x: head.x - 2.08, z: head.z },
      { x: head.x - 2.6, z: head.z },
      { x: head.x - 3.12, z: head.z },
      { x: head.x - 3.64, z: head.z },
      { x: head.x - 4.16, z: head.z },
      { x: head.x - 4.68, z: head.z },
      { x: head.x - 5.2, z: head.z },
      { x: head.x - 5.72, z: head.z },
      { x: head.x - 6.24, z: head.z },
    ],
    prevSpine: [],
    frozenTicks: 0,
    powerForm: 'spirit',
    ...overrides,
  };
}

describe('Open-world orbs, XP leveling & Magnet radius tiers', () => {
  it('levels up when XP reaches 8 + Math.floor(level * 1.4) and grows snake length', () => {
    let s = startPlaying({ seed: 1 });
    const needed = xpThresholdForLevel(5); // 8 + 7 = 15
    expect(needed).toBe(15);

    const orb: WorldOrb = {
      id: 88888,
      x: 0.42,
      z: 0,
      value: 15,
      colorHex: 0xffd43b,
      isLoot: true,
    };
    const lenBefore = s.snake.length;
    s = reduce({ ...s, orbs: [orb], bots: [] }, { type: 'tick' });
    expect(s.level).toBe(6);
    expect(s.xp).toBe(0);
    expect(s.snake.length).toBeGreaterThan(lenBefore);
    expect(s.events.some((e) => e.kind === 'level_up')).toBe(true);
  });

  it('scales magnetRadius across age6, age9 default, unicorn form, absorbed unicorn, and magnet booster', () => {
    const age6State = startPlaying({ seed: 1, ageProfile: 'age6' });
    expect(getMagnetRadius(age6State)).toBe(2.05);

    let s = startPlaying({ seed: 1, ageProfile: 'age9' });
    expect(getMagnetRadius(s)).toBe(1.45);

    s = reduce(s, { type: 'morph', form: 'unicorn' });
    expect(getMagnetRadius(s)).toBe(3.2);

    s = {
      ...s,
      absorbedPower: {
        form: 'unicorn',
        titleVi: 'Hấp thụ: Siêu Nam Châm ⚡',
        ticksRemaining: 100,
        maxTicks: 160,
      },
    };
    expect(getMagnetRadius(s)).toBe(7.5);

    s = reduce(s, { type: 'activate_booster', booster: 'magnet' });
    expect(getMagnetRadius(s)).toBe(10.5);
  });
});

describe('Eating weaker Bots, AbsorbedBotPower, and 3-Bot booster bonus', () => {
  it('finishes a 1-segment remaining bot in one tick, scatters 8..16 loot orbs, gains levels, and absorbs power', () => {
    let s = startPlaying({ seed: 2 });
    const prey = makeBot({
      id: 501,
      level: 4,
      maxLevel: 4,
      bittenSegments: 12,
      skin: 'dragon',
      powerForm: 'dragon',
      spine: [{ x: 0.42, z: 0 }],
      prevSpine: [{ x: 0.42, z: 0 }],
    });
    s = { ...s, bots: [prey], orbs: [], botsEaten: 2 }; // next eat is #3 -> bonus booster charge!

    const chargesBefore =
      s.boosters.level.charges + s.boosters.speed.charges + s.boosters.magnet.charges;
    s = reduce(s, { type: 'tick' });

    expect(s.bots.find((b) => b.id === 501)).toBeUndefined();
    expect(s.botsEaten).toBe(3);
    expect(s.enemiesDefeated).toBe(1);
    expect(s.level).toBe(5 + Math.ceil(4 * 0.35)); // 5 + 2 = 7
    expect(s.bossProgress).toBe(16);
    expect(s.absorbedPower?.form).toBe('dragon');
    expect(s.absorbedPower?.ticksRemaining).toBe(160);
    expect(s.events.some((e) => e.kind === 'bot_eaten')).toBe(true);

    const lootOrbs = s.orbs.filter((o) => o.isLoot && o.value === 3);
    expect(lootOrbs.length).toBeGreaterThanOrEqual(8);
    expect(lootOrbs.length).toBeLessThanOrEqual(16);

    const chargesAfter =
      s.boosters.level.charges + s.boosters.speed.charges + s.boosters.magnet.charges;
    expect(chargesAfter).toBe(chargesBefore + 1);

    // Absorbed dragon power halves shoot cooldown!
    s = reduce(s, { type: 'shoot' });
    expect(s.shootCooldownMs).toBe(Math.round(shootCooldownForForm('dragon') * 0.5));
  });

  it('chomps a 13-segment Lv.4 bot progressively from tail to head without regrowing segments', () => {
    let s = startPlaying({ seed: 2 });
    // Bot moving +X ahead of player: tail at x=0.42, head at x=0.42 + 12 * SEGMENT_SPACING
    const tailX = 0.42;
    const spine = Array.from({ length: 13 }, (_, idx) => ({
      x: tailX + (12 - idx) * SEGMENT_SPACING,
      z: 0,
    }));
    const prey = makeBot({
      id: 502,
      level: 4,
      maxLevel: 4,
      chompedTicks: 0,
      bittenSegments: 0,
      skin: 'dragon',
      powerForm: 'dragon',
      head: spine[0]!,
      prevHead: spine[0]!,
      heading: 0,
      spine,
      prevSpine: spine,
    });
    s = { ...s, bots: [prey], orbs: [], botsEaten: 2 };

    // Tick 1: bites 1..3 tail segments, NEVER eats all 13 in one go
    const xpBefore = s.xp;
    const scoreBefore = s.score;
    s = reduce(s, { type: 'tick' });

    const afterBite1 = s.bots.find((b) => b.id === 502)!;
    expect(afterBite1).toBeDefined();
    expect(afterBite1.spine.length).toBeGreaterThanOrEqual(10);
    expect(afterBite1.spine.length).toBeLessThanOrEqual(12);
    expect(afterBite1.bittenSegments).toBe(13 - afterBite1.spine.length);
    expect(afterBite1.chompedTicks).toBe(14);
    expect(afterBite1.maxLevel).toBe(4);
    expect(effectiveBotSpineLength(afterBite1)).toBe(afterBite1.spine.length);
    expect(s.botsEaten).toBe(2); // not finished yet
    expect(s.chompStreak).toBe(13 - afterBite1.spine.length);
    expect(s.chompStreakTicks).toBe(16);
    expect(s.score).toBeGreaterThan(scoreBefore);
    expect(s.xp).toBeGreaterThan(xpBefore);

    const chompEvent = s.events.find((e) => e.kind === 'bot_chomp');
    expect(chompEvent).toBeDefined();
    expect(chompEvent?.chompStreak).toBe(s.chompStreak);
    expect(s.events.some((e) => e.kind === 'bot_eaten')).toBe(false);
    expect(s.orbs.some((o) => o.isLoot && o.value === 3)).toBe(true);

    // Next tick with player out of bite range: stunned bot slows down and does NOT regrow segments
    const lenBeforeIdle = afterBite1.spine.length;
    const prevBotHead = afterBite1.head;
    const idleStep = stepBots({
      bots: [afterBite1],
      orbs: [],
      playerSnake: [{ x: -30, z: -30 }],
      playerLevel: s.level,
      playerProtected: false,
      playerPhoenixAura: false,
      config: s.config,
      rng: s.rng,
    });
    const afterIdle = idleStep.bots.find((b) => b.id === 502)!;
    expect(afterIdle).toBeDefined();
    expect(afterIdle.spine.length).toBe(lenBeforeIdle);
    expect(afterIdle.chompedTicks).toBe(13);
    expect(
      Math.hypot(afterIdle.head.x - prevBotHead.x, afterIdle.head.z - prevBotHead.z),
    ).toBeLessThan(s.config.baseSpeed * 0.3);

    // Chase back toward the surviving bot until completely eaten
    let prevStreak = s.chompStreak;
    let sawIncreasingStreak = false;
    for (let t = 0; t < 30 && s.bots.some((b) => b.id === 502); t++) {
      const target = s.bots.find((b) => b.id === 502)!;
      const head = s.snake[0]!;
      const seg = target.spine[target.spine.length - 1] ?? target.head;
      const angle = Math.atan2(seg.z - head.z, seg.x - head.x);
      s = reduce(s, { type: 'steer', angle });
      s = reduce({ ...s, orbs: [] }, { type: 'tick' });
      if (s.chompStreak > prevStreak) {
        sawIncreasingStreak = true;
      }
      prevStreak = s.chompStreak;
    }

    expect(sawIncreasingStreak).toBe(true);
    expect(s.bots.find((b) => b.id === 502)).toBeUndefined();
    expect(s.botsEaten).toBe(3);
    expect(s.absorbedPower?.form).toBe('dragon');
    expect(s.absorbedPower?.ticksRemaining).toBe(160);
    expect(s.events.some((e) => e.kind === 'bot_eaten')).toBe(true);
  });

  it('chomps a 13-segment Lv.4 bot progressively from head to tail with smooth spine shift', () => {
    let s = startPlaying({ seed: 12 });
    // Bot facing -X at x=0.42 extending rightwards along +X
    const spine = Array.from({ length: 13 }, (_, idx) => ({
      x: 0.42 + idx * SEGMENT_SPACING,
      z: 0,
    }));
    const prey = makeBot({
      id: 503,
      level: 4,
      maxLevel: 4,
      chompedTicks: 0,
      bittenSegments: 0,
      head: spine[0]!,
      prevHead: spine[0]!,
      heading: Math.PI,
      spine,
      prevSpine: spine,
    });
    s = { ...s, bots: [prey], orbs: [] };

    const bitCounts: number[] = [];
    let finished = false;
    for (let t = 0; t < 20; t++) {
      const before = s.bots.find((b) => b.id === 503);
      if (!before) break;
      const lenBefore = before.spine.length;
      const target = before.spine[0]!;
      const pHead = s.snake[0]!;
      s = reduce(s, { type: 'steer', angle: Math.atan2(target.z - pHead.z, target.x - pHead.x) });
      s = reduce({ ...s, orbs: [] }, { type: 'tick' });

      const after = s.bots.find((b) => b.id === 503);
      if (!after) {
        bitCounts.push(lenBefore);
        finished = true;
        break;
      }
      const bittenThisTick = lenBefore - after.spine.length;
      if (bittenThisTick > 0) {
        bitCounts.push(bittenThisTick);
        expect(bittenThisTick).toBeLessThanOrEqual(3);
      }
      expect(after.prevSpine.length).toBe(after.spine.length);
      expect(after.head).toEqual(after.spine[0]);
      for (let i = 1; i < after.spine.length; i++) {
        const d = Math.hypot(
          after.spine[i]!.x - after.spine[i - 1]!.x,
          after.spine[i]!.z - after.spine[i - 1]!.z,
        );
        expect(d).toBeLessThanOrEqual(SEGMENT_SPACING + 0.02);
      }
    }

    expect(finished).toBe(true);
    expect(bitCounts.length).toBeGreaterThanOrEqual(4);
    expect(s.events.some((e) => e.kind === 'bot_eaten')).toBe(true);
  });

  it('cuts across the middle of a 13-segment bot and smoothly rejoins the remaining spine', () => {
    let s = startPlaying({ seed: 15 });
    // Vertical bot at x=0.42 centered around z=0 so player traveling +X slices the middle
    const spine = Array.from({ length: 13 }, (_, idx) => ({
      x: 0.42,
      z: (idx - 6) * SEGMENT_SPACING,
    }));
    const prey = makeBot({
      id: 504,
      level: 4,
      maxLevel: 4,
      head: spine[0]!,
      prevHead: spine[0]!,
      heading: -Math.PI / 2,
      spine,
      prevSpine: spine,
    });
    s = { ...s, bots: [prey], orbs: [] };
    s = reduce(s, { type: 'tick' });

    const cutBot = s.bots.find((b) => b.id === 504)!;
    expect(cutBot).toBeDefined();
    expect(cutBot.spine.length).toBeGreaterThanOrEqual(10);
    expect(cutBot.spine.length).toBeLessThanOrEqual(12);
    expect(cutBot.prevSpine.length).toBe(cutBot.spine.length);
    expect(cutBot.chompedTicks).toBe(14);
    expect(s.events.some((e) => e.kind === 'bot_chomp')).toBe(true);

    for (let i = 1; i < cutBot.spine.length; i++) {
      const d = Math.hypot(
        cutBot.spine[i]!.x - cutBot.spine[i - 1]!.x,
        cutBot.spine[i]!.z - cutBot.spine[i - 1]!.z,
      );
      expect(d).toBeLessThanOrEqual(SEGMENT_SPACING + 1e-3);
    }
  });

  it('caps bites at 2 normally, 3 when fast, and decays chompStreak after 16 quiet ticks', () => {
    let s = startPlaying({ seed: 18 });
    const spine = Array.from({ length: 13 }, (_, idx) => ({
      x: 0.42 + idx * 0.25,
      z: 0,
    }));
    const prey = makeBot({
      id: 505,
      level: 4,
      maxLevel: 4,
      head: spine[0]!,
      prevHead: spine[0]!,
      spine,
      prevSpine: spine,
    });
    s = { ...s, bots: [prey], orbs: [] };

    const afterNormal = chompBotByPlayer(s, prey, { x: 0, z: 0 }, { x: 0.5, z: 0 }, false);
    const preyNormal = afterNormal.bots.find((b) => b.id === 505)!;
    expect(13 - preyNormal.spine.length).toBe(2);
    expect(afterNormal.chompStreak).toBe(2);
    expect(afterNormal.chompStreakTicks).toBe(16);

    const afterFast = chompBotByPlayer(s, prey, { x: 0, z: 0 }, { x: 0.5, z: 0 }, true);
    const preyFast = afterFast.bots.find((b) => b.id === 505)!;
    expect(13 - preyFast.spine.length).toBe(3);
    expect(afterFast.chompStreak).toBe(3);
    expect(afterFast.chompStreakTicks).toBe(16);

    // Advance 16 quiet ticks -> chompStreak resets to 0
    let cooled: GameState = { ...afterFast, bots: [], orbs: [] };
    for (let i = 0; i < 16; i++) {
      cooled = reduce({ ...cooled, bots: [], orbs: [] }, { type: 'tick' });
    }
    expect(cooled.chompStreakTicks).toBe(0);
    expect(cooled.chompStreak).toBe(0);
  });

  it('applies bot-vs-bot progressive chomping (max 2 segments/tick) and prevents orb regrowth snap', () => {
    const base = startPlaying({ seed: 21 });
    const weakSpine = Array.from({ length: 13 }, (_, idx) => ({
      x: 10 + idx * SEGMENT_SPACING,
      z: 10,
    }));
    const weakBot = makeBot({
      id: 510,
      level: 4,
      maxLevel: 4,
      head: weakSpine[0]!,
      prevHead: weakSpine[0]!,
      heading: Math.PI,
      spine: weakSpine,
      prevSpine: weakSpine,
    });
    const strongSpine = Array.from({ length: 18 }, (_, idx) => ({
      x: 9.8 - idx * SEGMENT_SPACING,
      z: 10,
    }));
    const strongBot = makeBot({
      id: 511,
      level: 15,
      maxLevel: 15,
      head: strongSpine[0]!,
      prevHead: strongSpine[0]!,
      heading: 0,
      spine: strongSpine,
      prevSpine: strongSpine,
    });

    const res = stepBots({
      bots: [weakBot, strongBot],
      orbs: [],
      playerSnake: [{ x: -30, z: -30 }],
      playerLevel: base.level,
      playerProtected: false,
      playerPhoenixAura: false,
      config: base.config,
      rng: base.rng,
    });

    const survivedWeak = res.bots.find((b) => b.id === 510)!;
    expect(survivedWeak).toBeDefined();
    expect(survivedWeak.spine.length).toBeGreaterThanOrEqual(11);
    expect(survivedWeak.spine.length).toBeLessThanOrEqual(12);
    expect(survivedWeak.chompedTicks).toBe(10);
    expect(survivedWeak.bittenSegments).toBe(13 - survivedWeak.spine.length);
    const droppedLoot = res.orbs.filter((o) => o.isLoot && o.value === 3);
    expect(droppedLoot.length).toBe(survivedWeak.bittenSegments);

    // Eating a level-up orb on a partially bitten bot only grows by at most +1 segment
    const bittenBot = {
      ...survivedWeak,
      level: 5,
      maxLevel: 5,
      bittenSegments: 6,
      spine: survivedWeak.spine.slice(0, 8),
      prevSpine: survivedWeak.spine.slice(0, 8),
    };
    const lootOrb: WorldOrb = {
      id: 9001,
      x: bittenBot.head.x,
      z: bittenBot.head.z,
      value: 3,
      colorHex: 0xff6be0,
      isLoot: true,
    };
    const orbRes = stepBots({
      bots: [bittenBot],
      orbs: [lootOrb],
      playerSnake: [{ x: -30, z: -30 }],
      playerLevel: base.level,
      playerProtected: false,
      playerPhoenixAura: false,
      config: base.config,
      rng: base.rng,
    });
    const grown = orbRes.bots.find((b) => b.id === 510)!;
    expect(grown.spine.length).toBe(9);
    expect(grown.bittenSegments).toBeLessThan(6);
    expect(effectiveBotSpineLength(grown)).toBe(grown.spine.length);
  });

  it('applies absorbed phoenix freeze aura and absorbed spirit shield/heal perk', () => {
    let s = startPlaying({ seed: 3 });
    // Absorbed phoenix freezes nearby bot within radius 4.0
    const nearbyBot = makeBot({
      id: 601,
      level: 12,
      head: { x: 2.5, z: 2.0 },
      spine: [{ x: 2.5, z: 2.0 }],
    });
    s = {
      ...s,
      bots: [nearbyBot],
      orbs: [],
      absorbedPower: {
        form: 'phoenix',
        titleVi: 'Băng',
        ticksRemaining: 50,
        maxTicks: 160,
      },
    };
    s = reduce(s, { type: 'tick' });
    expect(s.bots.find((b) => b.id === 601)!.frozenTicks).toBeGreaterThan(0);

    // Eating a final-segment spirit bot when missing a heart heals +1 heart and activates >= 80 shieldTicks
    const spiritPrey = makeBot({
      id: 602,
      level: 3,
      maxLevel: 3,
      skin: 'spirit',
      powerForm: 'spirit',
      spine: [{ x: 0.42, z: 0 }],
      prevSpine: [{ x: 0.42, z: 0 }],
    });
    s = { ...s, hearts: 2, shieldTicks: 0, bots: [spiritPrey], orbs: [] };
    s = reduce(s, { type: 'tick' });
    expect(s.hearts).toBe(3);
    expect(s.shieldTicks).toBeGreaterThanOrEqual(80);
    expect(s.events.some((e) => e.kind === 'heart_gained')).toBe(true);
  });
});

describe('Stronger Bot collisions: shield_block, heart loss, and gameover', () => {
  it('blocks stronger bot with shield/speed booster, repels bot >= 3.5 units, and subtracts 2 bot levels', () => {
    let s = startPlaying({ seed: 4 });
    const bossy = makeBot({
      id: 701,
      name: 'Rồng Hoàng Kim',
      level: 15,
      head: { x: 0.42, z: 0 },
      spine: [{ x: 0.42, z: 0 }],
    });
    s = reduce(s, { type: 'activate_booster', booster: 'speed' });
    s = { ...s, bots: [bossy], orbs: [] };

    const heartsBefore = s.hearts;
    s = reduce(s, { type: 'tick' });
    expect(s.hearts).toBe(heartsBefore);
    expect(s.events.some((e) => e.kind === 'shield_block')).toBe(true);
    const repelled = s.bots.find((b) => b.id === 701)!;
    expect(repelled.level).toBe(13);
    expect(
      Math.hypot(repelled.head.x - s.snake[0]!.x, repelled.head.z - s.snake[0]!.z),
    ).toBeGreaterThanOrEqual(3.4);
  });

  it('loses 1 heart and knocks player back 4.0 units with invulnerableTicks = 45 on unprotected hit', () => {
    let s = startPlaying({ seed: 4 });
    const strong = makeBot({
      id: 702,
      name: 'GaoBay',
      level: 14,
      head: { x: 0.42, z: 0 },
      spine: [{ x: 0.42, z: 0 }],
    });
    s = { ...s, hearts: 3, bots: [strong], orbs: [] };
    s = reduce(s, { type: 'tick' });

    expect(s.phase).toBe('playing');
    expect(s.hearts).toBe(2);
    expect(s.invulnerableTicks).toBe(45);
    expect(s.events.some((e) => e.kind === 'eaten_by_bot')).toBe(true);
    expect(s.events.some((e) => e.kind === 'heart_lost')).toBe(true);
    const pushedBot = s.bots.find((b) => b.id === 702)!;
    expect(
      Math.hypot(s.snake[0]!.x - pushedBot.head.x, s.snake[0]!.z - pushedBot.head.z),
    ).toBeGreaterThanOrEqual(3.5);
  });

  it('triggers gameover with eatenByBotName when hitting stronger bot on last heart', () => {
    let s = startPlaying({ seed: 4 });
    const strong = makeBot({
      id: 703,
      name: 'VemPraKOD',
      level: 20,
      head: { x: 0.42, z: 0 },
      spine: [{ x: 0.42, z: 0 }],
    });
    s = { ...s, hearts: 1, bots: [strong], orbs: [] };
    s = reduce(s, { type: 'tick' });

    expect(s.phase).toBe('gameover');
    expect(s.hearts).toBe(0);
    expect(s.eatenByBotName).toBe('VemPraKOD (Lv.20)');
    expect(s.events.some((e) => e.kind === 'eaten_by_bot')).toBe(true);
    expect(s.events.some((e) => e.kind === 'gameover')).toBe(true);
  });
});

describe('Boss spawn/defeat, 3 Boosters, Leaderboard & CrownTarget', () => {
  it('spawns Boss Đại Vương Rồng when bossProgress reaches 100 and rewards boss defeat', () => {
    let s = startPlaying({ seed: 5 });
    s = { ...s, bossProgress: 100, activeBossId: null, orbs: [] };
    s = reduce(s, { type: 'tick' });

    expect(s.activeBossId).not.toBeNull();
    const boss = s.bots.find((b) => b.id === s.activeBossId)!;
    expect(boss.isBoss).toBe(true);
    expect(boss.skin).toBe('gold_armor');
    expect(boss.name).toBe('Đại Vương Rồng');
    expect(s.crownTarget).toEqual(boss.head);
    expect(s.events.some((e) => e.kind === 'boss_spawn')).toBe(true);

    // Level up above Boss and eat Boss
    const leveled = {
      ...s,
      hearts: 2,
      level: boss.level + 5,
      bots: [
        {
          ...boss,
          head: { x: s.snake[0]!.x + 0.42, z: s.snake[0]!.z },
          spine: [{ x: s.snake[0]!.x + 0.42, z: s.snake[0]!.z }],
        },
      ],
    };
    const afterBoss = reduce(leveled, { type: 'tick' });
    expect(afterBoss.activeBossId).toBeNull();
    expect(afterBoss.bossProgress).toBe(0);
    expect(afterBoss.level).toBe(leveled.level + 15);
    expect(afterBoss.hearts).toBe(3);
    expect(afterBoss.bossTargetLevel).toBe(Math.round(leveled.bossTargetLevel * 1.6));
    expect(afterBoss.events.some((e) => e.kind === 'boss_defeated')).toBe(true);
  });

  it('chomps a multi-segment Boss progressively before triggering boss_defeated on the last segment', () => {
    let s = startPlaying({ seed: 25 });
    const bossSpine = Array.from({ length: 6 }, (_, idx) => ({
      x: 0.42 + idx * SEGMENT_SPACING,
      z: 0,
    }));
    const boss = makeBot({
      id: 950,
      name: 'Đại Vương Rồng',
      skin: 'gold_armor',
      isBoss: true,
      level: 25,
      maxLevel: 25,
      head: bossSpine[0]!,
      prevHead: bossSpine[0]!,
      heading: Math.PI,
      spine: bossSpine,
      prevSpine: bossSpine,
      powerForm: 'dragon',
    });
    s = {
      ...s,
      level: 30,
      bossProgress: 0,
      activeBossId: boss.id,
      bots: [boss],
      orbs: [],
    };

    const scoreBefore = s.score;
    const xpBefore = s.xp;
    s = reduce(s, { type: 'tick' });

    const remainingBoss = s.bots.find((b) => b.id === boss.id)!;
    expect(remainingBoss).toBeDefined();
    expect(remainingBoss.spine.length).toBeGreaterThanOrEqual(3);
    expect(remainingBoss.spine.length).toBeLessThanOrEqual(5);
    expect(s.activeBossId).toBe(boss.id);
    expect(s.bossProgress).toBe(0);
    expect(s.events.some((e) => e.kind === 'bot_chomp')).toBe(true);
    expect(s.events.some((e) => e.kind === 'boss_defeated')).toBe(false);
    expect(s.score).toBeGreaterThan(scoreBefore);
    expect(s.xp).toBeGreaterThan(xpBefore);
  });

  it('activates all 3 boosters (level +10, speed 160 ticks, magnet 200 ticks)', () => {
    let s = startPlaying({ seed: 6 });
    const levelBefore = s.level;
    const lenBefore = s.snake.length;

    s = reduce(s, { type: 'activate_booster', booster: 'level' });
    expect(s.level).toBe(levelBefore + 10);
    expect(s.snake.length).toBeGreaterThan(lenBefore);
    expect(s.boosters.level.charges).toBe(0);
    expect(s.events.some((e) => e.kind === 'booster_activate')).toBe(true);
    expect(reduce(s, { type: 'activate_booster', booster: 'level' })).toBe(s); // 0 charges -> no-op

    s = reduce(s, { type: 'activate_booster', booster: 'speed' });
    expect(s.boosters.speed.activeTicks).toBe(160);
    expect(s.boosters.speed.charges).toBe(1);
    s = reduce(s, { type: 'activate_booster', booster: 'speed' });
    expect(s.boosters.speed.charges).toBe(0);

    s = reduce(s, { type: 'activate_booster', booster: 'magnet' });
    expect(s.boosters.magnet.activeTicks).toBe(200);
    expect(s.boosters.magnet.charges).toBe(1);
    s = reduce(s, { type: 'activate_booster', booster: 'magnet' });
    expect(s.boosters.magnet.charges).toBe(0);
  });

  it('tracks leaderboard, playerRank, and crownTarget accurately', () => {
    let s = startPlaying({ seed: 7 });
    const b1 = makeBot({ id: 1, name: 'BotTop', level: 30, head: { x: 12, z: 8 } });
    const b2 = makeBot({ id: 2, name: 'BotMid', level: 12, head: { x: -10, z: 5 } });
    const b3 = makeBot({ id: 3, name: 'BotLow', level: 2, head: { x: 15, z: -15 } });
    s = {
      ...s,
      config: { ...s.config, botCount: 3 },
      bots: [b1, b2, b3],
      orbs: [],
    };
    s = reduce(s, { type: 'tick' });

    expect(s.playerRank).toBe(3);
    expect(s.leaderboard.some((e) => e.isPlayer && e.rank === 3)).toBe(true);
    expect(s.crownTarget).not.toBeNull();

    // Boost player to #1 -> crownTarget becomes null when no Boss is active
    s = {
      ...s,
      config: { ...s.config, botCount: 2 },
      level: 99,
      bots: [b2, b3],
      activeBossId: null,
    };
    s = reduce(s, { type: 'tick' });
    expect(s.playerRank).toBe(1);
    expect(s.leaderboard[0]!.isPlayer).toBe(true);
    expect(s.crownTarget).toBeNull();
  });

  it('reduces bot level on projectile_step and kills bot at <= 0', () => {
    let s = startPlaying({ seed: 8 });
    const bot = makeBot({
      id: 810,
      level: 4,
      head: { x: 2.8, z: 0 },
      spine: [
        { x: 2.8, z: 0 },
        { x: 2.3, z: 0 },
      ],
    });
    s = { ...s, bots: [bot], orbs: [] };
    s = reduce(s, { type: 'shoot' }); // dragon deals 4 level dmg
    s = reduce(s, { type: 'projectile_step' }); // 1.15
    s = reduce(s, { type: 'projectile_step' }); // 2.30 -> hits spine at 2.3

    expect(s.bots.find((b) => b.id === 810)).toBeUndefined();
    expect(s.orbs.some((o) => o.isLoot)).toBe(true);
    expect(s.events.some((e) => e.kind === 'bot_eaten')).toBe(true);
  });

  it('eats weaker bot when its head touches player tail and replenishes bots > 22 units away', () => {
    let s = startPlaying({ seed: 9 });
    const tailSeg = s.snake[s.snake.length - 1]!;
    const tailCollider = makeBot({
      id: 820,
      level: 2,
      head: { x: tailSeg.x, z: tailSeg.z },
      spine: [{ x: tailSeg.x, z: tailSeg.z }],
    });
    s = { ...s, bots: [tailCollider], orbs: [] };
    s = reduce(s, { type: 'tick' });

    expect(s.bots.find((b) => b.id === 820)).toBeUndefined();
    expect(s.botsEaten).toBe(1);
    const nonBossBots = s.bots.filter((b) => !b.isBoss);
    expect(nonBossBots).toHaveLength(s.config.botCount);
    for (const spawned of nonBossBots) {
      const dist = Math.hypot(spawned.head.x - s.snake[0]!.x, spawned.head.z - s.snake[0]!.z);
      expect(dist).toBeGreaterThan(20);
    }
  });

  it('maintains valid finite invariants across 200 continuous open-world simulation ticks', () => {
    let s = startPlaying({ seed: 42, mode: 'adventure', difficulty: 'normal' });
    for (let t = 0; t < 200; t++) {
      if (s.phase !== 'playing') break;
      if (t % 15 === 0) s = reduce(s, { type: 'steer', angle: Math.sin(t * 0.1) * 2.5 });
      if (t % 20 === 0) s = reduce(s, { type: 'shoot' });
      s = reduce(s, { type: 'projectile_step', dtMs: 50 });
      s = reduce(s, { type: 'tick' });

      expect(s.snake.length).toBe(s.prevSnake.length);
      for (const seg of s.snake) {
        expect(Number.isFinite(seg.x)).toBe(true);
        expect(Number.isFinite(seg.z)).toBe(true);
      }
      expect(s.orbs.length).toBeGreaterThanOrEqual(s.config.orbTargetCount);
      for (const bot of s.bots) {
        expect(bot.spine.length).toBeGreaterThanOrEqual(1);
        expect(bot.spine.length).toBe(bot.prevSpine.length);
        if ((bot.bittenSegments ?? 0) === 0) {
          expect(bot.spine.length).toBeGreaterThanOrEqual(7);
        }
        expect(Number.isFinite(bot.head.x)).toBe(true);
        expect(Number.isFinite(bot.head.z)).toBe(true);
      }
    }
  });

  it('spawns 60 initial bots, applies BOT_SPEED_SCALE = 0.8, and keeps spine consistent on slash', () => {
    expect(BOT_SPEED_SCALE).toBe(0.8);
    const s = startPlaying({ seed: 11 });
    expect(s.bots).toHaveLength(60);
    const nearLow = s.bots.filter(
      (b) => b.level >= 1 && b.level <= 4 && Math.hypot(b.head.x, b.head.z) <= 20.5,
    );
    expect(nearLow.length).toBeGreaterThanOrEqual(8);

    // Normal bot moves at baseSpeed * 0.88 * 0.8
    const normalBot = makeBot({
      id: 951,
      level: 10,
      maxLevel: 10,
      head: { x: 0, z: 0 },
      prevHead: { x: 0, z: 0 },
      heading: 0,
      spine: Array.from({ length: targetBotSpineLength(10, false) }, (_, idx) => ({
        x: -idx * SEGMENT_SPACING,
        z: 0,
      })),
    });
    const stepped = stepBots({
      bots: [normalBot],
      orbs: [],
      playerSnake: [{ x: -40, z: -40 }],
      playerLevel: 5,
      playerProtected: true,
      playerPhoenixAura: false,
      config: s.config,
      rng: s.rng,
    });
    const moved = stepped.bots[0]!;
    const distMoved = Math.hypot(moved.head.x - normalBot.head.x, moved.head.z - normalBot.head.z);
    expect(distMoved).toBeCloseTo(s.config.baseSpeed * 0.88 * BOT_SPEED_SCALE, 3);

    // Boss moves at baseSpeed * 0.92 * 0.8
    const bossBot = makeBot({
      id: 952,
      isBoss: true,
      level: 30,
      maxLevel: 30,
      head: { x: 0, z: 0 },
      prevHead: { x: 0, z: 0 },
      heading: 0,
      spine: Array.from({ length: targetBotSpineLength(30, true) }, (_, idx) => ({
        x: -idx * SEGMENT_SPACING,
        z: 0,
      })),
    });
    const bossStepped = stepBots({
      bots: [bossBot],
      orbs: [],
      playerSnake: [{ x: -40, z: -40 }],
      playerLevel: 5,
      playerProtected: true,
      playerPhoenixAura: false,
      config: s.config,
      rng: s.rng,
    });
    const movedBoss = bossStepped.bots[0]!;
    const bossDist = Math.hypot(
      movedBoss.head.x - bossBot.head.x,
      movedBoss.head.z - bossBot.head.z,
    );
    expect(bossDist).toBeCloseTo(s.config.baseSpeed * 0.92 * BOT_SPEED_SCALE, 3);

    // shrinkOrEliminateHelper keeps effectiveBotSpineLength consistent with spine.length when slashed
    const highBot = makeBot({
      id: 953,
      level: 25,
      maxLevel: 25,
      head: { x: 5, z: 0 },
      spine: Array.from({ length: targetBotSpineLength(25, false) }, (_, idx) => ({
        x: 5 - idx * SEGMENT_SPACING,
        z: 0,
      })),
      prevSpine: Array.from({ length: targetBotSpineLength(25, false) }, (_, idx) => ({
        x: 5 - idx * SEGMENT_SPACING,
        z: 0,
      })),
    });
    const slashed = shrinkOrEliminateHelper(highBot, {
      playerLevel: 5,
      killMargin: 6,
      levelDamage: 7,
      stunTicks: 40,
      center: { x: 0, z: 0 },
      knockbackDist: 8,
      worldRadius: s.config.worldRadius,
    });
    expect(slashed.eliminated).toBe(false);
    expect(slashed.bot.level).toBe(18);
    expect(slashed.bot.maxLevel).toBe(18);
    expect(slashed.bot.spine.length).toBe(effectiveBotSpineLength(slashed.bot));
    expect(slashed.bot.prevSpine.length).toBe(slashed.bot.spine.length);
  });
});
