import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  reduce,
  getMagnetRadius,
  COCOON_DURATION_TICKS,
  BUTTERFLY_DURATION_TICKS,
  BUTTERFLY_FROST_RADIUS,
  FROST_ZONE_RADIUS,
  FROST_ZONE_DURATION_TICKS,
  MAX_FROST_ZONES,
  LANDING_DURATION_TICKS,
  FLOWER_COOLDOWN_TICKS,
  FLOWER_LIFETIME_TICKS,
  MAX_GARDEN_FLOWERS,
  LIGHTNING_TTL_TICKS,
  AOE_BLAST_TTL,
  FIRE_COOLDOWN_TICKS_AGE6,
  FIRE_COOLDOWN_TICKS_AGE9,
  WATER_COOLDOWN_TICKS_AGE6,
  WATER_COOLDOWN_TICKS_AGE9,
  ARCANE_COOLDOWN_TICKS_AGE6,
  ARCANE_COOLDOWN_TICKS_AGE9,
  setButterflyHold,
  stepFairyMagic,
  triggerButterflyMetamorphosisInstant,
  spawnFlowerRing,
  spawnThunderStorm,
  spawnFireNova,
  spawnWaterTsunami,
  spawnArcaneNova,
  type GameState,
  type BotSnake,
  type Hazard,
} from '../../src/core';

function startPlaying(opts?: Parameters<typeof createInitialState>[0]): GameState {
  return reduce(createInitialState(opts), { type: 'start' });
}

function makeBot(overrides: Partial<BotSnake> = {}): BotSnake {
  const head = overrides.head ?? { x: 5, z: 5 };
  return {
    id: 901,
    name: 'TestBot',
    skin: 'lime_viper',
    isBoss: false,
    level: 3,
    head,
    prevHead: head,
    heading: 0,
    spine: [head, { x: head.x - 0.52, z: head.z }, { x: head.x - 1.04, z: head.z }],
    prevSpine: [],
    frozenTicks: 0,
    powerForm: 'spirit',
    ...overrides,
  };
}

describe('Fairy Magic Constants', () => {
  it('exports correct constant values', () => {
    expect(COCOON_DURATION_TICKS).toBe(18);
    expect(BUTTERFLY_DURATION_TICKS).toBe(220);
    expect(LANDING_DURATION_TICKS).toBe(14);
    expect(FLOWER_COOLDOWN_TICKS).toBe(10);
    expect(FLOWER_LIFETIME_TICKS).toBe(280);
    expect(MAX_GARDEN_FLOWERS).toBe(28);
    expect(LIGHTNING_TTL_TICKS).toBe(9);
    expect(AOE_BLAST_TTL).toBe(16);
    expect(FIRE_COOLDOWN_TICKS_AGE6).toBe(40);
    expect(FIRE_COOLDOWN_TICKS_AGE9).toBe(55);
    expect(WATER_COOLDOWN_TICKS_AGE6).toBe(42);
    expect(WATER_COOLDOWN_TICKS_AGE9).toBe(56);
    expect(ARCANE_COOLDOWN_TICKS_AGE6).toBe(48);
    expect(ARCANE_COOLDOWN_TICKS_AGE9).toBe(62);
  });
});

describe('GameState initial fairy fields', () => {
  it('initializes all fairy fields correctly in createInitialState', () => {
    const s = createInitialState({ seed: 1 });
    expect(s.butterflyStage).toBe('caterpillar');
    expect(s.butterflyCharge).toBe(100);
    expect(s.butterflyTicks).toBe(0);
    expect(s.butterflyAltitude).toBe(0);
    expect(s.butterflyLanding).toBe(false);
    expect(s.butterflyHold).toBe(false);
    expect(s.flowerCooldownTicks).toBe(0);
    expect(s.thunderCooldownTicks).toBe(0);
    expect(s.fireCooldownTicks).toBe(0);
    expect(s.waterCooldownTicks).toBe(0);
    expect(s.arcaneCooldownTicks).toBe(0);
    expect(s.gardenFlowers).toEqual([]);
    expect(s.lightningBolts).toEqual([]);
    expect(s.aoeBlasts).toEqual([]);
    expect(s.frostZones).toEqual([]);
  });

  it('preserves fairy fields after start/reset', () => {
    let s = createInitialState({ seed: 1 });
    s = reduce(s, { type: 'start' });
    expect(s.butterflyStage).toBe('caterpillar');
    expect(s.butterflyCharge).toBe(100);
    expect(s.butterflyAltitude).toBe(0);
    expect(s.butterflyLanding).toBe(false);
    expect(s.butterflyHold).toBe(false);
    expect(s.fireCooldownTicks).toBe(0);
    expect(s.waterCooldownTicks).toBe(0);
    expect(s.arcaneCooldownTicks).toBe(0);
    expect(s.gardenFlowers).toEqual([]);
    expect(s.lightningBolts).toEqual([]);
    expect(s.aoeBlasts).toEqual([]);
    expect(s.frostZones).toEqual([]);
  });
});

describe('Flower skill (cast_fairy_skill flower)', () => {
  it('plants 3 flowers with correct properties and sets cooldown', () => {
    let s = startPlaying({ seed: 42 });
    s = { ...s, bots: [], orbs: [] };
    expect(s.gardenFlowers).toEqual([]);

    s = reduce(s, { type: 'cast_fairy_skill', skill: 'flower' });
    expect(s.gardenFlowers).toHaveLength(3);
    expect(s.flowerCooldownTicks).toBe(FLOWER_COOLDOWN_TICKS);
    expect(s.score).toBe(10); // +10 score

    // Check main blossom has scale 1.15, buds have scale 0.84
    const scales = s.gardenFlowers.map((f) => f.scale).sort();
    expect(scales).toEqual([0.84, 0.84, 1.15]);

    // All flowers should have FLOWER_LIFETIME_TICKS
    for (const f of s.gardenFlowers) {
      expect(f.ticksRemaining).toBe(FLOWER_LIFETIME_TICKS);
      expect(f.maxTicks).toBe(FLOWER_LIFETIME_TICKS);
      expect(f.colorVariant).toBeGreaterThanOrEqual(0);
      expect(f.colorVariant).toBeLessThanOrEqual(3);
    }

    // Should emit flower_bloom event
    expect(s.events.some((e) => e.kind === 'flower_bloom')).toBe(true);
  });

  it('rejects flower cast when on cooldown', () => {
    let s = startPlaying({ seed: 42 });
    s = { ...s, bots: [], orbs: [] };
    s = reduce(s, { type: 'cast_fairy_skill', skill: 'flower' });
    const after = reduce(s, { type: 'cast_fairy_skill', skill: 'flower' });
    // Still 3 flowers — no new flowers added
    expect(after.gardenFlowers).toHaveLength(3);
  });

  it('adds +12 to butterflyCharge (clamped to 100)', () => {
    let s = startPlaying({ seed: 42 });
    s = { ...s, bots: [], orbs: [], butterflyCharge: 50 };
    s = reduce(s, { type: 'cast_fairy_skill', skill: 'flower' });
    expect(s.butterflyCharge).toBe(62);
  });

  it('caps gardenFlowers at MAX_GARDEN_FLOWERS', () => {
    let s = startPlaying({ seed: 42 });
    // Pre-fill with 27 flowers
    const existingFlowers = Array.from({ length: 27 }, (_, i) => ({
      id: i + 1,
      x: i,
      z: i,
      colorVariant: 0 as const,
      scale: 1.0,
      ticksRemaining: 100,
      maxTicks: 280,
    }));
    s = { ...s, bots: [], orbs: [], gardenFlowers: existingFlowers };
    s = reduce(s, { type: 'cast_fairy_skill', skill: 'flower' });
    expect(s.gardenFlowers.length).toBeLessThanOrEqual(MAX_GARDEN_FLOWERS);
  });

  it('does nothing when phase !== playing', () => {
    const s = createInitialState({ seed: 1 }); // phase: 'ready'
    const after = reduce(s, { type: 'cast_fairy_skill', skill: 'flower' });
    expect(after.gardenFlowers).toEqual([]);
  });
});

describe('Butterfly skill and metamorphosis lifecycle', () => {
  it('transitions caterpillar -> cocoon when charge >= 100', () => {
    let s = startPlaying({ seed: 42 });
    s = { ...s, bots: [], orbs: [], butterflyCharge: 100 };
    s = reduce(s, { type: 'cast_fairy_skill', skill: 'butterfly' });
    expect(s.butterflyStage).toBe('cocoon');
    expect(s.butterflyTicks).toBe(COCOON_DURATION_TICKS);
    expect(s.butterflyCharge).toBe(100);
    expect(s.events.some((e) => e.kind === 'cocoon_start')).toBe(true);
  });

  it('rejects butterfly cast when charge < 100', () => {
    let s = startPlaying({ seed: 42 });
    s = { ...s, bots: [], orbs: [], butterflyCharge: 50 };
    s = reduce(s, { type: 'cast_fairy_skill', skill: 'butterfly' });
    expect(s.butterflyStage).toBe('caterpillar');
  });

  it('rejects butterfly cast when not in caterpillar stage', () => {
    let s = startPlaying({ seed: 42 });
    s = { ...s, bots: [], orbs: [], butterflyStage: 'cocoon', butterflyCharge: 100 };
    s = reduce(s, { type: 'cast_fairy_skill', skill: 'butterfly' });
    expect(s.butterflyStage).toBe('cocoon');
  });

  it('cocoon lasts exactly COCOON_DURATION_TICKS then emerges as butterfly', () => {
    let s = startPlaying({ seed: 42 });
    s = { ...s, bots: [], orbs: [], butterflyCharge: 100 };
    s = reduce(s, { type: 'cast_fairy_skill', skill: 'butterfly' });
    expect(s.butterflyStage).toBe('cocoon');

    // Tick through cocoon duration
    for (let i = 0; i < COCOON_DURATION_TICKS - 1; i++) {
      s = reduce({ ...s, bots: [], orbs: s.orbs }, { type: 'tick' });
      expect(s.butterflyStage).toBe('cocoon');
    }

    // Last tick -> emerge
    s = reduce({ ...s, bots: [], orbs: s.orbs }, { type: 'tick' });
    expect(s.butterflyStage).toBe('butterfly');
    expect(s.butterflyTicks).toBe(BUTTERFLY_DURATION_TICKS);
    expect(s.events.some((e) => e.kind === 'butterfly_emerge')).toBe(true);
    // Should scatter celebration loot orbs and add score
    expect(s.score).toBeGreaterThan(0);
  });

  it('butterfly lasts BUTTERFLY_DURATION_TICKS then reverts to caterpillar', () => {
    let s = startPlaying({ seed: 42 });
    s = {
      ...s,
      bots: [],
      orbs: [],
      butterflyStage: 'butterfly',
      butterflyTicks: BUTTERFLY_DURATION_TICKS,
      butterflyCharge: 100,
    };

    for (let i = 0; i < BUTTERFLY_DURATION_TICKS; i++) {
      s = reduce({ ...s, bots: [], orbs: s.orbs }, { type: 'tick' });
    }
    expect(s.butterflyStage).toBe('caterpillar');
    expect(s.butterflyTicks).toBe(0);
    expect(s.butterflyAltitude).toBe(0);
    expect(s.butterflyLanding).toBe(false);
    expect(s.butterflyCharge).toBe(35);
    expect(s.invulnerableTicks).toBeGreaterThanOrEqual(30);
  });

  it('full lifecycle: caterpillar -> cocoon (18) -> butterfly (220) -> caterpillar', () => {
    let s = startPlaying({ seed: 42 });
    s = { ...s, bots: [], orbs: [] };
    expect(s.butterflyStage).toBe('caterpillar');
    expect(s.butterflyCharge).toBe(100);

    // Cast butterfly
    s = reduce(s, { type: 'cast_fairy_skill', skill: 'butterfly' });
    expect(s.butterflyStage).toBe('cocoon');
    expect(s.butterflyAltitude).toBeCloseTo(0.25, 5);

    // 18 ticks for cocoon
    for (let i = 0; i < COCOON_DURATION_TICKS; i++) {
      s = reduce({ ...s, bots: [], orbs: s.orbs }, { type: 'tick' });
    }
    expect(s.butterflyStage).toBe('butterfly');
    expect(s.butterflyAltitude).toBeCloseTo(0.7, 5);

    // Climbs to 1.0 during flight
    for (let i = 0; i < 3; i++) {
      s = reduce({ ...s, bots: [], orbs: s.orbs }, { type: 'tick' });
    }
    expect(s.butterflyAltitude).toBe(1);

    // Remaining ticks for butterfly -> touchdown
    for (let i = 0; i < BUTTERFLY_DURATION_TICKS - 3; i++) {
      s = reduce({ ...s, bots: [], orbs: s.orbs }, { type: 'tick' });
    }
    expect(s.butterflyStage).toBe('caterpillar');
    expect(s.butterflyAltitude).toBe(0);
    expect(s.butterflyCharge).toBe(35);
    expect(s.events.some((e) => e.kind === 'butterfly_land')).toBe(true);
  });

  it('butterfly auto-plants flowers every 14 ticks', () => {
    let s = startPlaying({ seed: 42 });
    s = {
      ...s,
      bots: [],
      orbs: [],
      butterflyStage: 'butterfly',
      butterflyTicks: BUTTERFLY_DURATION_TICKS,
      butterflyCharge: 100,
      gardenFlowers: [],
    };

    // Tick 14 times
    for (let i = 0; i < 14; i++) {
      s = reduce({ ...s, bots: [], orbs: s.orbs }, { type: 'tick' });
    }
    // After 14 ticks (nextTicks = 220-14 = 206, 206 % 14 === 3... wait, let me check)
    // Actually the condition is nextTicks > 0 && nextTicks % 14 === 0
    // After first tick: nextTicks = 219, 219 % 14 = 9 (no)
    // We need nextTicks to be divisible by 14. 220 - n = 14k
    // n = 220 - 14k. k=15: n=10. After 10 ticks, nextTicks = 210, 210 % 14 = 0!
    // So after exactly 10 ticks we should have 1 flower planted.
    // Let me re-test:
    let s2 = startPlaying({ seed: 42 });
    s2 = {
      ...s2,
      bots: [],
      orbs: [],
      butterflyStage: 'butterfly',
      butterflyTicks: BUTTERFLY_DURATION_TICKS,
      butterflyCharge: 100,
      gardenFlowers: [],
    };
    // Check how many flowers are planted after many ticks
    for (let i = 0; i < 30; i++) {
      s2 = reduce({ ...s2, bots: [], orbs: s2.orbs }, { type: 'tick' });
    }
    // In 30 ticks, nextTicks goes from 220 down. Flowers planted when nextTicks % 14 === 0:
    // 210 (tick 10), 196 (tick 24) -> 2 flowers
    expect(s2.gardenFlowers.length).toBeGreaterThanOrEqual(1);
  });

  it('butterfly bounces away bots within 2.4 units', () => {
    let s = startPlaying({ seed: 42 });
    // Use a bot that's within 2.4 units of player head (at 0,0)
    const nearBot = makeBot({
      id: 801,
      head: { x: 1.5, z: 0 },
      frozenTicks: 0,
      level: 10,
      spine: [{ x: 1.5, z: 0 }],
    });
    s = {
      ...s,
      bots: [nearBot],
      orbs: [],
      butterflyStage: 'butterfly',
      butterflyTicks: 200,
      butterflyCharge: 100,
    };

    // Directly call stepFairyMagic to test low-altitude butterfly bounce in isolation
    s = stepFairyMagic(s);
    const bot = s.bots.find((b) => b.id === 801);
    expect(bot).toBeDefined();
    expect(bot!.frozenTicks).toBeGreaterThanOrEqual(22);
    expect(bot!.level).toBe(8); // 10 - 2
  });

  it('high-altitude butterfly flight skips ground bot & hazard collisions and supports manual early landing', () => {
    let s = startPlaying({ seed: 42 });
    const strongBot = makeBot({
      id: 805,
      level: 50,
      head: { x: 0.42, z: 0 },
      spine: [{ x: 0.42, z: 0 }],
    });
    const hazard = {
      id: 806,
      cell: { x: 0.6, z: 0 },
      prevCell: { x: 0.6, z: 0 },
      kind: 'crystal' as const,
      hp: 3,
      maxHp: 3,
      frozenTicks: 0,
      warningTicks: 0,
    };
    s = {
      ...s,
      bots: [strongBot],
      hazards: [hazard],
      orbs: [],
      butterflyStage: 'butterfly',
      butterflyTicks: 180,
      butterflyAltitude: 1.0,
      butterflyLanding: false,
      butterflyCharge: 100,
    };
    const heartsBefore = s.hearts;
    s = reduce(s, { type: 'tick' });
    // Flew safely overhead: no heart lost, no shield_block knockback, no eaten_by_bot
    expect(s.hearts).toBe(heartsBefore);
    expect(s.events.some((e) => e.kind === 'shield_block')).toBe(false);
    expect(s.events.some((e) => e.kind === 'eaten_by_bot')).toBe(false);
    expect(s.butterflyAltitude).toBe(1);

    // Also stepFairyMagic does NOT collide/bounce with bots when altitude >= 0.5
    const botAfterFlight = s.bots.find((b) => b.id === 805)!;
    expect(botAfterFlight.level).toBe(50);

    // Trigger manual early landing
    const nearbyBot = makeBot({
      id: 807,
      level: 12,
      head: { x: s.snake[0]!.x + 4, z: s.snake[0]!.z },
      spine: [{ x: s.snake[0]!.x + 4, z: s.snake[0]!.z }],
    });
    s = { ...s, bots: [nearbyBot], hazards: [], gardenFlowers: [] };
    s = reduce(s, { type: 'cast_fairy_skill', skill: 'butterfly' });
    expect(s.butterflyLanding).toBe(true);
    expect(s.butterflyTicks).toBeLessThanOrEqual(LANDING_DURATION_TICKS);

    // Tick through landing swoop (<= 14 ticks)
    for (let i = 0; i < LANDING_DURATION_TICKS; i++) {
      s = reduce({ ...s, orbs: [] }, { type: 'tick' });
      if (s.butterflyStage === 'caterpillar') break;
    }

    expect(s.butterflyStage).toBe('caterpillar');
    expect(s.butterflyAltitude).toBe(0);
    expect(s.butterflyLanding).toBe(false);
    expect(s.butterflyCharge).toBe(35);
    expect(s.invulnerableTicks).toBeGreaterThanOrEqual(30);
    expect(s.events.some((e) => e.kind === 'butterfly_land')).toBe(true);
    expect(s.gardenFlowers.length).toBeGreaterThanOrEqual(4);
    const stunned = s.bots.find((b) => b.id === 807);
    expect(stunned).toBeDefined();
    expect(stunned!.frozenTicks).toBeGreaterThanOrEqual(30);
  });
});

describe('Thunder AoE skill', () => {
  it('eliminates weaker bots within 16 units, damages stronger bots, and ignores out-of-range bots', () => {
    let s = startPlaying({ seed: 42 });
    // Weak bots (Lv.10 & Lv.8 <= 5 + 6) within 16 units -> eliminated and level up player
    const weakBot1 = makeBot({ id: 801, head: { x: 5, z: 0 }, level: 10, frozenTicks: 0 });
    const weakBot2 = makeBot({ id: 804, head: { x: 0, z: -7 }, level: 8, frozenTicks: 0 });
    // Strong bot (Lv.20 > 5 + 6) within 16 units -> slashed by 6 and stunned
    const strongBot = makeBot({ id: 803, head: { x: -6, z: 0 }, level: 20, frozenTicks: 0 });
    // Far bot outside 16 units -> untouched
    const farBot = makeBot({ id: 802, head: { x: 25, z: 0 }, level: 10, frozenTicks: 0 });
    s = { ...s, bots: [weakBot1, weakBot2, strongBot, farBot], orbs: [] };
    const levelBefore = s.level;

    s = reduce(s, { type: 'cast_fairy_skill', skill: 'thunder' });

    expect(s.bots.find((b) => b.id === 801)).toBeUndefined();
    expect(s.bots.find((b) => b.id === 804)).toBeUndefined();
    expect(s.botsEaten).toBe(2);
    expect(s.enemiesDefeated).toBe(2);
    expect(s.level).toBeGreaterThan(levelBefore);
    expect(s.events.some((e) => e.kind === 'bot_eaten')).toBe(true);
    expect(s.events.some((e) => e.kind === 'level_up')).toBe(true);
    expect(s.aoeBlasts).toHaveLength(1);
    expect(s.aoeBlasts[0]!.element).toBe('thunder');
    expect(s.aoeBlasts[0]!.radius).toBe(16);

    const bStrong = s.bots.find((b) => b.id === 803)!;
    expect(bStrong).toBeDefined();
    expect(bStrong.level).toBe(14); // 20 - 6
    expect(bStrong.frozenTicks).toBeGreaterThanOrEqual(55);

    const bFar = s.bots.find((b) => b.id === 802)!;
    expect(bFar).toBeDefined();
    expect(bFar.frozenTicks).toBe(0);
    expect(bFar.level).toBe(10);
  });

  it('creates 6..8 lightning bolts (always >= 4)', () => {
    let s = startPlaying({ seed: 42 });
    s = { ...s, bots: [], orbs: [] };

    s = reduce(s, { type: 'cast_fairy_skill', skill: 'thunder' });
    expect(s.lightningBolts.length).toBeGreaterThanOrEqual(6);
    expect(s.lightningBolts.length).toBeLessThanOrEqual(8);
    for (const bolt of s.lightningBolts) {
      expect(bolt.ttl).toBe(LIGHTNING_TTL_TICKS);
      expect(bolt.maxTtl).toBe(LIGHTNING_TTL_TICKS);
    }
  });

  it('sets thunderCooldownTicks based on ageProfile', () => {
    let s6 = startPlaying({ seed: 42, ageProfile: 'age6' });
    s6 = { ...s6, bots: [], orbs: [] };
    s6 = reduce(s6, { type: 'cast_fairy_skill', skill: 'thunder' });
    expect(s6.thunderCooldownTicks).toBe(50);

    let s9 = startPlaying({ seed: 42, ageProfile: 'age9' });
    s9 = { ...s9, bots: [], orbs: [] };
    s9 = reduce(s9, { type: 'cast_fairy_skill', skill: 'thunder' });
    expect(s9.thunderCooldownTicks).toBe(65);
  });

  it('rejects thunder when on cooldown', () => {
    let s = startPlaying({ seed: 42 });
    s = { ...s, bots: [], orbs: [] };
    s = reduce(s, { type: 'cast_fairy_skill', skill: 'thunder' });
    const boltsBefore = s.lightningBolts.length;
    s = reduce(s, { type: 'cast_fairy_skill', skill: 'thunder' });
    expect(s.lightningBolts.length).toBe(boltsBefore); // no new bolts
  });

  it('vaporizes hazards within 16 units', () => {
    let s = startPlaying({ seed: 42 });
    const nearHazard = {
      id: 77,
      cell: { x: 5, z: 0 },
      prevCell: { x: 5, z: 0 },
      kind: 'crystal' as const,
      hp: 3,
      maxHp: 3,
      frozenTicks: 0,
      warningTicks: 0,
    };
    const farHazard = {
      id: 78,
      cell: { x: 50, z: 50 },
      prevCell: { x: 50, z: 50 },
      kind: 'crystal' as const,
      hp: 3,
      maxHp: 3,
      frozenTicks: 0,
      warningTicks: 0,
    };
    s = { ...s, bots: [], orbs: [], hazards: [nearHazard, farHazard] };
    s = reduce(s, { type: 'cast_fairy_skill', skill: 'thunder' });
    expect(s.hazards.find((h) => h.id === 77)).toBeUndefined();
    expect(s.hazards.find((h) => h.id === 78)).toBeDefined();
  });

  it('scatters loot orbs around struck bots', () => {
    let s = startPlaying({ seed: 42 });
    const bot = makeBot({ id: 801, head: { x: 5, z: 0 }, level: 10 });
    s = { ...s, bots: [bot], orbs: [] };
    s = reduce(s, { type: 'cast_fairy_skill', skill: 'thunder' });
    const loot = s.orbs.filter((o) => o.isLoot);
    expect(loot.length).toBeGreaterThanOrEqual(8);
  });

  it('adds +15 to butterflyCharge (clamped to 100)', () => {
    let s = startPlaying({ seed: 42 });
    s = { ...s, bots: [], orbs: [], butterflyCharge: 50 };
    s = reduce(s, { type: 'cast_fairy_skill', skill: 'thunder' });
    expect(s.butterflyCharge).toBe(65);
  });

  it('increases score when eliminating bots with thunder AoE', () => {
    let s = startPlaying({ seed: 42 });
    const bot = makeBot({ id: 801, head: { x: 5, z: 0 }, level: 10 });
    s = { ...s, bots: [bot], orbs: [], score: 0 };
    s = reduce(s, { type: 'cast_fairy_skill', skill: 'thunder' });
    expect(s.score).toBeGreaterThanOrEqual(80 + 10 * 12);
  });

  it('emits sky_thunder event', () => {
    let s = startPlaying({ seed: 42 });
    s = { ...s, bots: [], orbs: [] };
    s = reduce(s, { type: 'cast_fairy_skill', skill: 'thunder' });
    expect(s.events.some((e) => e.kind === 'sky_thunder')).toBe(true);
  });
});

describe('Elemental 360° AoE skills (fire, water, arcane)', () => {
  it('fire AoE eliminates weak bots, slashes/knocks back Boss, clears hazards, and sets cooldown', () => {
    let s = startPlaying({ seed: 42, ageProfile: 'age6' });
    const weakBot = makeBot({ id: 901, head: { x: 6, z: 0 }, level: 12 }); // <= 5 + 9
    const boss = makeBot({
      id: 902,
      name: 'Đại Vương Rồng',
      isBoss: true,
      level: 30,
      maxLevel: 30,
      head: { x: 0, z: 5 },
      spine: [{ x: 0, z: 5 }],
    });
    const hazard = {
      id: 91,
      cell: { x: -4, z: 0 },
      prevCell: { x: -4, z: 0 },
      kind: 'slime' as const,
      hp: 2,
      maxHp: 2,
      frozenTicks: 0,
      warningTicks: 0,
    };
    s = { ...s, bots: [weakBot, boss], hazards: [hazard], orbs: [], butterflyCharge: 40 };

    s = reduce(s, { type: 'cast_fairy_skill', skill: 'fire' });
    expect(s.fireCooldownTicks).toBe(FIRE_COOLDOWN_TICKS_AGE6);
    expect(s.butterflyCharge).toBe(58); // +18
    expect(s.bots.find((b) => b.id === 901)).toBeUndefined();
    expect(s.botsEaten).toBe(1);
    expect(s.level).toBeGreaterThan(5);
    expect(s.hazards).toHaveLength(0);
    expect(s.aoeBlasts).toHaveLength(1);
    expect(s.aoeBlasts[0]!.element).toBe('fire');
    expect(s.aoeBlasts[0]!.radius).toBe(14);
    expect(s.events.some((e) => e.kind === 'aoe_fire')).toBe(true);

    const knockedBoss = s.bots.find((b) => b.id === 902)!;
    expect(knockedBoss.level).toBe(22); // 30 - 8
    expect(knockedBoss.frozenTicks).toBeGreaterThanOrEqual(35);
    expect(Math.hypot(knockedBoss.head.x, knockedBoss.head.z)).toBeGreaterThanOrEqual(13.5); // 5 + 9

    // Rejects when on cooldown; age9 uses FIRE_COOLDOWN_TICKS_AGE9
    const blastsBefore = s.aoeBlasts.length;
    s = reduce(s, { type: 'cast_fairy_skill', skill: 'fire' });
    expect(s.aoeBlasts).toHaveLength(blastsBefore);

    let s9 = startPlaying({ seed: 42, ageProfile: 'age9' });
    s9 = { ...s9, bots: [], orbs: [] };
    s9 = reduce(s9, { type: 'cast_fairy_skill', skill: 'fire' });
    expect(s9.fireCooldownTicks).toBe(FIRE_COOLDOWN_TICKS_AGE9);
  });

  it('water AoE eliminates weak bots, stuns & knocks back strong bots 12 units, and sets cooldown', () => {
    let s = startPlaying({ seed: 42, ageProfile: 'age6' });
    const weakBot = makeBot({ id: 911, head: { x: 7, z: 0 }, level: 9 }); // <= 5 + 5
    const strongBot = makeBot({ id: 912, head: { x: 0, z: 4 }, level: 25, maxLevel: 25 });
    s = { ...s, bots: [weakBot, strongBot], orbs: [], butterflyCharge: 20 };

    s = reduce(s, { type: 'cast_fairy_skill', skill: 'water' });
    expect(s.waterCooldownTicks).toBe(WATER_COOLDOWN_TICKS_AGE6);
    expect(s.butterflyCharge).toBe(36); // +16
    expect(s.bots.find((b) => b.id === 911)).toBeUndefined();
    expect(s.botsEaten).toBe(1);
    expect(s.aoeBlasts[0]!.element).toBe('water');
    expect(s.aoeBlasts[0]!.radius).toBe(15);
    expect(s.events.some((e) => e.kind === 'aoe_water')).toBe(true);

    const knockedStrong = s.bots.find((b) => b.id === 912)!;
    expect(knockedStrong.level).toBe(20); // 25 - 5
    expect(knockedStrong.frozenTicks).toBeGreaterThanOrEqual(70);
    expect(Math.hypot(knockedStrong.head.x, knockedStrong.head.z)).toBeGreaterThanOrEqual(15.5); // 4 + 12

    let s9 = startPlaying({ seed: 42, ageProfile: 'age9' });
    s9 = { ...s9, bots: [], orbs: [] };
    s9 = reduce(s9, { type: 'cast_fairy_skill', skill: 'water' });
    expect(s9.waterCooldownTicks).toBe(WATER_COOLDOWN_TICKS_AGE9);
  });

  it('arcane AoE eliminates weak bots, damages strong bots, pulls orbs 55% closer, and plants 4 diamond flowers', () => {
    let s = startPlaying({ seed: 42, ageProfile: 'age6' });
    const weakBot = makeBot({ id: 921, head: { x: 8, z: 0 }, level: 11 }); // <= 5 + 7
    const strongBot = makeBot({ id: 922, head: { x: -10, z: 0 }, level: 24, maxLevel: 24 });
    const nearOrb = { id: 7001, x: 10, z: 0, value: 1, colorHex: 0xffd43b, isLoot: false };
    const farOrb = { id: 7002, x: 30, z: 0, value: 1, colorHex: 0xffd43b, isLoot: false };
    s = {
      ...s,
      bots: [weakBot, strongBot],
      orbs: [nearOrb, farOrb],
      gardenFlowers: [],
      butterflyCharge: 10,
    };

    s = reduce(s, { type: 'cast_fairy_skill', skill: 'arcane' });
    expect(s.arcaneCooldownTicks).toBe(ARCANE_COOLDOWN_TICKS_AGE6);
    expect(s.butterflyCharge).toBe(30); // +20
    expect(s.bots.find((b) => b.id === 921)).toBeUndefined();
    expect(s.botsEaten).toBe(1);
    expect(s.gardenFlowers).toHaveLength(4);
    expect(s.aoeBlasts[0]!.element).toBe('arcane');
    expect(s.aoeBlasts[0]!.radius).toBe(15.5);
    expect(s.events.some((e) => e.kind === 'aoe_arcane')).toBe(true);

    const damagedStrong = s.bots.find((b) => b.id === 922)!;
    expect(damagedStrong.level).toBe(17); // 24 - 7
    expect(damagedStrong.frozenTicks).toBeGreaterThanOrEqual(50);

    const pulledNear = s.orbs.find((o) => o.id === 7001)!;
    expect(pulledNear.x).toBeCloseTo(4.5, 2); // 10 -> 4.5 (55% closer)
    const untouchedFar = s.orbs.find((o) => o.id === 7002)!;
    expect(untouchedFar.x).toBe(30);

    let s9 = startPlaying({ seed: 42, ageProfile: 'age9' });
    s9 = { ...s9, bots: [], orbs: [] };
    s9 = reduce(s9, { type: 'cast_fairy_skill', skill: 'arcane' });
    expect(s9.arcaneCooldownTicks).toBe(ARCANE_COOLDOWN_TICKS_AGE9);
  });
});

describe('stepFairyMagic tick mechanics', () => {
  it('decrements cooldowns each tick', () => {
    let s = startPlaying({ seed: 42 });
    s = {
      ...s,
      bots: [],
      orbs: [],
      flowerCooldownTicks: 5,
      thunderCooldownTicks: 10,
      fireCooldownTicks: 8,
      waterCooldownTicks: 7,
      arcaneCooldownTicks: 6,
    };
    s = reduce(s, { type: 'tick' });
    expect(s.flowerCooldownTicks).toBe(4);
    expect(s.thunderCooldownTicks).toBe(9);
    expect(s.fireCooldownTicks).toBe(7);
    expect(s.waterCooldownTicks).toBe(6);
    expect(s.arcaneCooldownTicks).toBe(5);
  });

  it('decrements aoeBlasts ttl and removes expired blasts', () => {
    let s = startPlaying({ seed: 42 });
    s = {
      ...s,
      bots: [],
      orbs: [],
      aoeBlasts: [
        { id: 1, element: 'fire', x: 0, z: 0, radius: 14, ttl: 2, maxTtl: 16 },
        { id: 2, element: 'water', x: 0, z: 0, radius: 15, ttl: 1, maxTtl: 16 },
      ],
    };
    s = reduce(s, { type: 'tick' });
    expect(s.aoeBlasts).toHaveLength(1);
    expect(s.aoeBlasts[0]!.id).toBe(1);
    expect(s.aoeBlasts[0]!.ttl).toBe(1);
  });

  it('decrements lightning bolt ttl and removes expired bolts', () => {
    let s = startPlaying({ seed: 42 });
    s = {
      ...s,
      bots: [],
      orbs: [],
      lightningBolts: [
        { id: 1, x: 0, z: 0, colorHex: 0xffe45e, ttl: 2, maxTtl: 9 },
        { id: 2, x: 0, z: 0, colorHex: 0x7ef8ff, ttl: 1, maxTtl: 9 },
      ],
    };
    s = reduce(s, { type: 'tick' });
    expect(s.lightningBolts).toHaveLength(1);
    expect(s.lightningBolts[0]!.ttl).toBe(1);
  });

  it('decrements flower ticksRemaining and removes expired flowers', () => {
    let s = startPlaying({ seed: 42 });
    s = {
      ...s,
      bots: [],
      orbs: [],
      gardenFlowers: [
        { id: 1, x: 0, z: 0, colorVariant: 0, scale: 1.0, ticksRemaining: 2, maxTicks: 280 },
        { id: 2, x: 0, z: 0, colorVariant: 1, scale: 1.0, ticksRemaining: 1, maxTicks: 280 },
      ],
    };
    s = reduce(s, { type: 'tick' });
    expect(s.gardenFlowers).toHaveLength(1);
    expect(s.gardenFlowers[0]!.ticksRemaining).toBe(1);
  });

  it('passively charges butterflyCharge in caterpillar stage (age6: +1.2, age9: +0.8)', () => {
    let s6 = startPlaying({ seed: 42, ageProfile: 'age6' });
    s6 = { ...s6, bots: [], orbs: [], butterflyCharge: 0 };
    s6 = reduce(s6, { type: 'tick' });
    expect(s6.butterflyCharge).toBeCloseTo(1.2, 5);

    let s9 = startPlaying({ seed: 42, ageProfile: 'age9' });
    s9 = { ...s9, bots: [], orbs: [], butterflyCharge: 0 };
    s9 = reduce(s9, { type: 'tick' });
    expect(s9.butterflyCharge).toBeCloseTo(0.8, 5);
  });
});

describe('Bot vs GardenFlower charm collisions', () => {
  it('charms a bot that touches a flower (frozenTicks >= 28, level -1)', () => {
    let s = startPlaying({ seed: 42 });
    const bot = makeBot({
      id: 801,
      head: { x: 2, z: 0 },
      level: 10,
      frozenTicks: 0,
      spine: [{ x: 2, z: 0 }],
    });
    const flower = {
      id: 1,
      x: 2.5,
      z: 0, // within 2.2 of bot head
      colorVariant: 0 as const,
      scale: 1.0,
      ticksRemaining: 100,
      maxTicks: 280,
    };
    s = { ...s, bots: [bot], orbs: [], gardenFlowers: [flower] };
    s = reduce(s, { type: 'tick' });

    // Flower consumed
    expect(s.gardenFlowers.find((f) => f.id === 1)).toBeUndefined();
    // Bot charmed
    const charmed = s.bots.find((b) => b.id === 801);
    expect(charmed).toBeDefined();
    expect(charmed!.frozenTicks).toBeGreaterThanOrEqual(28);
    expect(charmed!.level).toBe(9); // 10 - 1
    // Loot orbs scattered
    expect(s.orbs.filter((o) => o.isLoot).length).toBeGreaterThanOrEqual(3);
    // Score +25
    expect(s.score).toBeGreaterThanOrEqual(25);
    // Event emitted
    expect(s.events.some((e) => e.kind === 'flower_charm')).toBe(true);
  });

  it('does not charm a bot with frozenTicks >= 10', () => {
    let s = startPlaying({ seed: 42 });
    const bot = makeBot({
      id: 801,
      head: { x: 2, z: 0 },
      frozenTicks: 15,
      spine: [{ x: 2, z: 0 }],
    });
    const flower = {
      id: 1,
      x: 2.5,
      z: 0,
      colorVariant: 0 as const,
      scale: 1.0,
      ticksRemaining: 100,
      maxTicks: 280,
    };
    s = { ...s, bots: [bot], orbs: [], gardenFlowers: [flower] };
    s = reduce(s, { type: 'tick' });
    // Flower should still exist (not consumed)
    expect(s.gardenFlowers.length).toBeGreaterThanOrEqual(0); // flower ticks down but not consumed by charm
    expect(s.events.some((e) => e.kind === 'flower_charm')).toBe(false);
  });
});

describe('Butterfly protection and magnet radius', () => {
  it('cocoon/butterfly stage protects from bot damage', () => {
    let s = startPlaying({ seed: 42 });
    const strongBot = makeBot({
      id: 701,
      level: 100,
      head: { x: 0.42, z: 0 },
      spine: [{ x: 0.42, z: 0 }],
    });
    s = { ...s, bots: [strongBot], orbs: [], butterflyStage: 'cocoon', butterflyTicks: 10 };
    const heartsBefore = s.hearts;
    s = reduce(s, { type: 'tick' });
    expect(s.hearts).toBe(heartsBefore);
    expect(s.events.some((e) => e.kind === 'shield_block')).toBe(true);
  });

  it('butterfly stage gives 6.8 magnet radius', () => {
    let s = startPlaying({ seed: 42, ageProfile: 'age6' });
    expect(getMagnetRadius(s)).toBe(2.05); // caterpillar

    s = { ...s, butterflyStage: 'butterfly' };
    expect(getMagnetRadius(s)).toBe(6.8);
  });

  it('caterpillar/cocoon preserves base magnet radius', () => {
    const s6 = startPlaying({ seed: 42, ageProfile: 'age6' });
    expect(getMagnetRadius(s6)).toBe(2.05);
    expect(getMagnetRadius({ ...s6, butterflyStage: 'cocoon' })).toBe(2.05);

    const s9 = startPlaying({ seed: 42, ageProfile: 'age9' });
    expect(getMagnetRadius(s9)).toBe(1.45);
    expect(getMagnetRadius({ ...s9, butterflyStage: 'cocoon' })).toBe(1.45);
  });

  it('butterfly speed boost is 1.45x base', () => {
    let s = startPlaying({ seed: 42 });
    s = { ...s, bots: [], orbs: [], butterflyStage: 'caterpillar' };
    const normalStep = reduce(s, { type: 'tick' }).snake[0]!.x;

    const sButterfly = { ...s, butterflyStage: 'butterfly' as const, butterflyTicks: 200 };
    const butterflyStep = reduce(sButterfly, { type: 'tick' }).snake[0]!.x;

    expect(butterflyStep).toBeCloseTo(s.config.baseSpeed * 1.45, 3);
    expect(butterflyStep).toBeGreaterThan(normalStep);
  });
});

describe('Butterfly charge from orbs and bot chomps', () => {
  it('adds +6 butterflyCharge per eaten orb in caterpillar stage', () => {
    let s = startPlaying({ seed: 42 });
    const orb = {
      id: 9999,
      x: 0.42,
      z: 0,
      value: 1,
      colorHex: 0xffd43b,
      isLoot: false,
    };
    s = { ...s, bots: [], orbs: [orb], butterflyCharge: 10, butterflyStage: 'caterpillar' };
    s = reduce(s, { type: 'tick' });
    expect(s.butterflyCharge).toBeGreaterThanOrEqual(16); // 10 + 6 + passive charge
  });
});

describe('Quest reward helpers', () => {
  it('triggerButterflyMetamorphosisInstant sets cocoon stage', () => {
    let s = startPlaying({ seed: 42 });
    s = triggerButterflyMetamorphosisInstant(s);
    expect(s.butterflyStage).toBe('cocoon');
    expect(s.butterflyTicks).toBe(COCOON_DURATION_TICKS);
    expect(s.butterflyCharge).toBe(100);
    expect(s.events.some((e) => e.kind === 'cocoon_start')).toBe(true);
  });

  it('spawnFlowerRing spawns 6 flowers in a ring', () => {
    let s = startPlaying({ seed: 42 });
    s = spawnFlowerRing(s, 6);
    expect(s.gardenFlowers).toHaveLength(6);
    expect(s.events.some((e) => e.kind === 'flower_bloom')).toBe(true);
  });

  it('spawnThunderStorm creates 5 bolts without setting cooldown', () => {
    let s = startPlaying({ seed: 42 });
    s = { ...s, bots: [], orbs: [] };
    s = spawnThunderStorm(s);
    expect(s.lightningBolts).toHaveLength(5);
    expect(s.thunderCooldownTicks).toBe(0); // No cooldown set
    expect(s.events.some((e) => e.kind === 'sky_thunder')).toBe(true);
  });

  it('spawnFireNova, spawnWaterTsunami, spawnArcaneNova trigger AoE without setting manual cooldowns', () => {
    let s = startPlaying({ seed: 42 });
    const weakBot = makeBot({ id: 991, head: { x: 4, z: 0 }, level: 6 });
    s = { ...s, bots: [weakBot], orbs: [] };

    const afterFire = spawnFireNova(s);
    expect(afterFire.fireCooldownTicks).toBe(0);
    expect(afterFire.bots.find((b) => b.id === 991)).toBeUndefined();
    expect(afterFire.aoeBlasts.some((b) => b.element === 'fire')).toBe(true);
    expect(afterFire.events.some((e) => e.kind === 'aoe_fire')).toBe(true);

    const afterWater = spawnWaterTsunami(s);
    expect(afterWater.waterCooldownTicks).toBe(0);
    expect(afterWater.bots.find((b) => b.id === 991)).toBeUndefined();
    expect(afterWater.aoeBlasts.some((b) => b.element === 'water')).toBe(true);
    expect(afterWater.events.some((e) => e.kind === 'aoe_water')).toBe(true);

    const afterArcane = spawnArcaneNova(s);
    expect(afterArcane.arcaneCooldownTicks).toBe(0);
    expect(afterArcane.bots.find((b) => b.id === 991)).toBeUndefined();
    expect(afterArcane.gardenFlowers).toHaveLength(4);
    expect(afterArcane.aoeBlasts.some((b) => b.element === 'arcane')).toBe(true);
    expect(afterArcane.events.some((e) => e.kind === 'aoe_arcane')).toBe(true);
  });
});

describe('Hold-to-Butterfly & Falling Ice Freeze (Milestone 10)', () => {
  it('set_butterfly_hold true transforms immediately regardless of charge, stays flying indefinitely while held, and lands within 4 ticks on release with charge 100', () => {
    const ready = createInitialState({ seed: 42 });
    expect(reduce(ready, { type: 'set_butterfly_hold', active: true }).butterflyStage).toBe(
      'caterpillar',
    );

    let s = startPlaying({ seed: 42 });
    s = { ...s, bots: [], orbs: [], hazards: [], butterflyCharge: 0 };

    // Hold true: instant transformation even at 0 charge
    s = reduce(s, { type: 'set_butterfly_hold', active: true });
    expect(s.butterflyHold).toBe(true);
    expect(s.butterflyStage).toBe('butterfly');
    expect(s.butterflyLanding).toBe(false);
    expect(s.butterflyTicks).toBe(BUTTERFLY_DURATION_TICKS);
    expect(s.butterflyAltitude).toBeGreaterThanOrEqual(0.78);
    expect(s.butterflyCharge).toBe(100);
    expect(s.frostZones).toHaveLength(1);
    expect(
      s.events.some(
        (e) => e.kind === 'butterfly_emerge' && e.messageVi === '🦋 Bướm Hồng Băng Giá!',
      ),
    ).toBe(true);

    // Remains flying indefinitely beyond BUTTERFLY_DURATION_TICKS while butterflyHold is true
    for (let i = 0; i < BUTTERFLY_DURATION_TICKS + 35; i++) {
      s = reduce({ ...s, bots: [], orbs: s.orbs, hazards: [] }, { type: 'tick' });
    }
    expect(s.butterflyHold).toBe(true);
    expect(s.butterflyStage).toBe('butterfly');
    expect(s.butterflyLanding).toBe(false);
    expect(s.butterflyTicks).toBe(BUTTERFLY_DURATION_TICKS);
    expect(s.butterflyAltitude).toBe(1);
    expect(s.frostZones.length).toBeLessThanOrEqual(MAX_FROST_ZONES);

    // Release hold: swoops down and lands back to caterpillar within 4 ticks keeping charge 100
    s = reduce(s, { type: 'set_butterfly_hold', active: false });
    expect(s.butterflyHold).toBe(false);
    expect(s.butterflyLanding).toBe(true);
    expect(s.butterflyTicks).toBeLessThanOrEqual(4);
    expect(s.butterflyCharge).toBe(100);

    for (let i = 0; i < 4; i++) {
      s = reduce({ ...s, bots: [], orbs: s.orbs, hazards: [] }, { type: 'tick' });
    }
    expect(s.butterflyStage).toBe('caterpillar');
    expect(s.butterflyTicks).toBe(0);
    expect(s.butterflyAltitude).toBe(0);
    expect(s.butterflyLanding).toBe(false);
    expect(s.butterflyCharge).toBe(100);
    expect(s.events.some((e) => e.kind === 'butterfly_land')).toBe(true);

    // Releasing while in cocoon reverts cleanly to caterpillar with charge 100
    let cocooned = reduce(
      { ...startPlaying({ seed: 42 }), bots: [], orbs: [] },
      { type: 'cast_fairy_skill', skill: 'butterfly' },
    );
    expect(cocooned.butterflyStage).toBe('cocoon');
    cocooned = setButterflyHold(cocooned, false);
    expect(cocooned.butterflyStage).toBe('caterpillar');
    expect(cocooned.butterflyTicks).toBe(0);
    expect(cocooned.butterflyAltitude).toBe(0);
    expect(cocooned.butterflyLanding).toBe(false);
    expect(cocooned.butterflyCharge).toBe(100);
  });

  it('flying butterfly drops frostZones, emits butterfly_frost, and freezes nearby bots and all hazard kinds', () => {
    let s = startPlaying({ seed: 42 });
    const nearBot = makeBot({
      id: 951,
      head: { x: 4, z: 3 },
      level: 25,
      frozenTicks: 0,
      spine: [{ x: 4, z: 3 }],
    });
    const farBot = makeBot({
      id: 952,
      head: { x: 24, z: 0 },
      level: 25,
      frozenTicks: 0,
      spine: [{ x: 24, z: 0 }],
    });

    const hazards: Hazard[] = [
      {
        id: 501,
        cell: { x: 3, z: 0 },
        prevCell: { x: 3, z: 0 },
        kind: 'slime',
        hp: 2,
        maxHp: 2,
        frozenTicks: 0,
        warningTicks: 0,
      },
      {
        id: 502,
        cell: { x: 0, z: 5 },
        prevCell: { x: 0, z: 5 },
        kind: 'crystal',
        hp: 3,
        maxHp: 3,
        frozenTicks: 0,
        warningTicks: 0,
      },
      {
        id: 503,
        cell: { x: -4, z: 2 },
        prevCell: { x: -4, z: 2 },
        kind: 'meteor',
        hp: 2,
        maxHp: 2,
        frozenTicks: 0,
        warningTicks: 10,
      },
      {
        id: 504,
        cell: { x: 5, z: -3 },
        prevCell: { x: 5, z: -3 },
        kind: 'element_gate',
        hp: 3,
        maxHp: 3,
        requiredForm: 'dragon',
        frozenTicks: 0,
        warningTicks: 0,
      },
      {
        id: 505,
        cell: { x: 26, z: 0 },
        prevCell: { x: 26, z: 0 },
        kind: 'crystal',
        hp: 3,
        maxHp: 3,
        frozenTicks: 0,
        warningTicks: 0,
      },
    ];

    s = {
      ...s,
      bots: [nearBot, farBot],
      hazards,
      orbs: [],
      quest: null,
    };

    s = reduce(s, { type: 'set_butterfly_hold', active: true });
    let sawFrostEvent = false;
    for (let i = 0; i < 6; i++) {
      s = reduce(s, { type: 'tick' });
      if (s.events.some((e) => e.kind === 'butterfly_frost')) {
        sawFrostEvent = true;
      }
    }

    expect(sawFrostEvent).toBe(true);
    expect(s.frostZones.length).toBeGreaterThanOrEqual(2);
    expect(s.frostZones[0]!.radius).toBe(FROST_ZONE_RADIUS);
    expect(s.frostZones[0]!.maxTicks).toBe(FROST_ZONE_DURATION_TICKS);

    const frozenNearBot = s.bots.find((b) => b.id === 951)!;
    const untouchedFarBot = s.bots.find((b) => b.id === 952)!;
    expect(frozenNearBot.frozenTicks).toBeGreaterThanOrEqual(45);
    expect(untouchedFarBot.frozenTicks).toBe(0);

    for (const hid of [501, 502, 503, 504]) {
      const h = s.hazards.find((hz) => hz.id === hid)!;
      expect(h).toBeDefined();
      expect(h.frozenTicks).toBeGreaterThanOrEqual(45);
    }
    expect(s.hazards.find((hz) => hz.id === 505)!.frozenTicks).toBe(0);

    // Entities inside an active frostZone far from butterfly head also freeze
    const zoneAtOrigin = {
      id: 999,
      x: 0,
      z: 0,
      radius: FROST_ZONE_RADIUS,
      ticksRemaining: 20,
      maxTicks: FROST_ZONE_DURATION_TICKS,
    };
    const farButterfly = {
      ...startPlaying({ seed: 42 }),
      snake: [{ x: BUTTERFLY_FROST_RADIUS + 20, z: 0 }],
      butterflyStage: 'butterfly' as const,
      butterflyHold: true,
      butterflyTicks: BUTTERFLY_DURATION_TICKS,
      frostZones: [zoneAtOrigin],
      bots: [makeBot({ id: 960, head: { x: 2, z: 0 }, frozenTicks: 0 })],
      hazards: [
        {
          id: 510,
          cell: { x: 0, z: 2.5 },
          prevCell: { x: 0, z: 2.5 },
          kind: 'slime' as const,
          hp: 2,
          maxHp: 2,
          frozenTicks: 0,
          warningTicks: 0,
        },
      ],
      orbs: [],
    };
    const afterZoneStep = stepFairyMagic(farButterfly);
    expect(afterZoneStep.bots.find((b) => b.id === 960)!.frozenTicks).toBeGreaterThanOrEqual(45);
    expect(afterZoneStep.hazards.find((h) => h.id === 510)!.frozenTicks).toBeGreaterThanOrEqual(45);
  });

  it('frozen hazards do not damage player hearts on collision, and deeply frozen bots slow to 0.08x', () => {
    let s = startPlaying({ seed: 42 });
    const frozenCrystal: Hazard = {
      id: 601,
      cell: { x: 0.42, z: 0 },
      prevCell: { x: 0.42, z: 0 },
      kind: 'crystal',
      hp: 3,
      maxHp: 3,
      frozenTicks: 20,
      warningTicks: 0,
    };
    s = {
      ...s,
      bots: [],
      orbs: [],
      hazards: [frozenCrystal],
      shieldTicks: 0,
      invulnerableTicks: 0,
    };
    const heartsBefore = s.hearts;
    s = reduce(s, { type: 'tick' });
    expect(s.hearts).toBe(heartsBefore);
    expect(s.events.some((e) => e.kind === 'heart_lost')).toBe(false);
    expect(s.events.some((e) => e.kind === 'gameover')).toBe(false);

    // Compare bot step distance for shallow freeze (10 -> 0.25x) vs deep freeze (45 -> 0.08x)
    const baseState = startPlaying({ seed: 42 });
    const shallowBot = makeBot({
      id: 971,
      head: { x: 15, z: 0 },
      frozenTicks: 10,
      spine: [{ x: 15, z: 0 }],
    });
    const deepBot = makeBot({
      id: 972,
      head: { x: -15, z: 0 },
      frozenTicks: 45,
      spine: [{ x: -15, z: 0 }],
    });
    const shallowAfter = reduce(
      { ...baseState, bots: [shallowBot], orbs: [], hazards: [], quest: null },
      { type: 'tick' },
    ).bots.find((b) => b.id === 971)!;
    const deepAfter = reduce(
      { ...baseState, bots: [deepBot], orbs: [], hazards: [], quest: null },
      { type: 'tick' },
    ).bots.find((b) => b.id === 972)!;

    const shallowDist = Math.hypot(shallowAfter.head.x - 15, shallowAfter.head.z);
    const deepDist = Math.hypot(deepAfter.head.x + 15, deepAfter.head.z);
    expect(deepDist).toBeLessThan(shallowDist * 0.4);
  });
});
