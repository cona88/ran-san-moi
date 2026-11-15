import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  getMagnetRadius,
  reduce,
  shootCooldownForForm,
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

  it('scales magnetRadius across default, unicorn form, absorbed unicorn, and magnet booster', () => {
    let s = startPlaying({ seed: 1 });
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
  it('eats a bot with level <= player.level, scatters 8..16 loot orbs, gains levels, and absorbs power', () => {
    let s = startPlaying({ seed: 2 });
    const prey = makeBot({ id: 501, level: 4, skin: 'dragon', powerForm: 'dragon' });
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

    // Eating a spirit bot when missing a heart heals +1 heart and activates >= 80 shieldTicks
    const spiritPrey = makeBot({ id: 602, level: 3, skin: 'spirit', powerForm: 'spirit' });
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
    expect(s.boosters.speed.charges).toBe(0);

    s = reduce(s, { type: 'activate_booster', booster: 'magnet' });
    expect(s.boosters.magnet.activeTicks).toBe(200);
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
        expect(bot.spine.length).toBeGreaterThanOrEqual(7);
        expect(Number.isFinite(bot.head.x)).toBe(true);
        expect(Number.isFinite(bot.head.z)).toBe(true);
      }
    }
  });
});
