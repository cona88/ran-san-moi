import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  createHazard,
  createInitialState,
  createRng,
  pickSafeDirection,
  reduce,
  spawnQuest,
  stepHazards,
  tickQuest,
  type BrainQuest,
  type GameState,
  type Hazard,
} from '../../src/core';

function startPlaying(opts?: Parameters<typeof createInitialState>[0]): GameState {
  return reduce(createInitialState(opts), { type: 'start' });
}

describe('BrainQuest system (math, sequence, element_match)', () => {
  it('spawns 3 quest orbs in radius 9..16 around head with rewardLevels = 10', () => {
    const s = startPlaying({ seed: 10 });
    const head = s.snake[0]!;
    const spawned = spawnQuest(s, createRng(10), 'math');
    expect(spawned.quest).not.toBeNull();
    const quest = spawned.quest!;
    expect(quest.rewardLevels).toBe(10);
    expect(quest.orbs).toHaveLength(3);
    for (const orb of quest.orbs) {
      const dist = Math.hypot(orb.cell.x - head.x, orb.cell.z - head.z);
      expect(dist).toBeGreaterThanOrEqual(8.9);
      expect(dist).toBeLessThanOrEqual(16.1);
    }
  });

  it('solves math quest via touch, awards +10 levels & booster charge, and never subtracts hearts on wrong orb', () => {
    let s = startPlaying({ seed: 10 });
    const quest = spawnQuest(s, createRng(10), 'math').quest!;
    const wrongOrb = quest.orbs.find((o) => !o.isCorrect)!;
    const rightOrb = quest.orbs.find((o) => o.isCorrect)!;

    // Place wrong orb at (0.42, 0) and right orb well separated at (2.5, 0) ahead of snake
    const arranged: BrainQuest = {
      ...quest,
      orbs: quest.orbs.map((o) =>
        o.id === wrongOrb.id
          ? { ...o, cell: { x: 0.42, z: 0 } }
          : o.id === rightOrb.id
            ? { ...o, cell: { x: 2.5, z: 0 } }
            : { ...o, cell: { x: 30, z: 30 } },
      ),
    };
    s = { ...s, quest: arranged, bots: [], orbs: [] };

    const heartsBefore = s.hearts;
    s = reduce(s, { type: 'tick' });
    expect(s.hearts).toBe(heartsBefore);
    expect(s.events.some((e) => e.kind === 'quest_wrong' && Boolean(e.messageVi))).toBe(true);
    expect(s.quest?.orbs.find((o) => o.id === wrongOrb.id)?.collected).toBe(true);

    const levelBefore = s.level;
    const scoreBefore = s.score;
    const totalChargesBefore =
      s.boosters.level.charges + s.boosters.speed.charges + s.boosters.magnet.charges;
    // Advance until head reaches (2.5, 0)
    for (let i = 0; i < 4 && s.quest !== null; i++) {
      s = reduce(s, { type: 'tick' });
    }
    expect(s.quest).toBeNull();
    expect(s.questsSolved).toBe(1);
    expect(s.level).toBe(levelBefore + 10);
    expect(s.score).toBe(scoreBefore + quest.rewardScore);
    const totalChargesAfter =
      s.boosters.level.charges + s.boosters.speed.charges + s.boosters.magnet.charges;
    expect(totalChargesAfter).toBe(totalChargesBefore + 1);
    expect(s.events.some((e) => e.kind === 'quest_complete')).toBe(true);
  });

  it('solves sequence quest 1 -> 2 -> 3 in order and protects out-of-order orbs', () => {
    let s = startPlaying({ seed: 20 });
    const quest = spawnQuest(s, createRng(20), 'sequence').quest!;
    const orb1 = quest.orbs.find((o) => o.sequenceOrder === 1)!;
    const orb2 = quest.orbs.find((o) => o.sequenceOrder === 2)!;
    const orb3 = quest.orbs.find((o) => o.sequenceOrder === 3)!;

    const arranged: BrainQuest = {
      ...quest,
      orbs: [
        { ...orb2, cell: { x: 2.8, z: 0 } },
        { ...orb1, cell: { x: 4.5, z: 0 } },
        { ...orb3, cell: { x: 6.2, z: 0 } },
      ],
    };
    s = { ...s, quest: arranged, bots: [], orbs: [] };

    // Shoot #2 out of order
    s = reduce(s, { type: 'shoot' });
    s = reduce(s, { type: 'projectile_step' }); // 1.15
    s = reduce(s, { type: 'projectile_step' }); // 2.30 -> hits 2.8
    expect(s.events.some((e) => e.kind === 'quest_wrong')).toBe(true);
    expect(s.quest?.nextSequenceIndex).toBe(1);

    // Arrange in order ahead along +X and shoot 1 -> 2 -> 3
    s = {
      ...s,
      shootCooldownMs: 0,
      quest: {
        ...s.quest!,
        orbs: [
          { ...orb1, cell: { x: 2.8, z: 0 } },
          { ...orb2, cell: { x: 4.5, z: 0 } },
          { ...orb3, cell: { x: 6.2, z: 0 } },
        ],
      },
    };

    s = reduce(s, { type: 'shoot' });
    s = reduce(s, { type: 'projectile_step' });
    s = reduce(s, { type: 'projectile_step' });
    expect(s.quest?.nextSequenceIndex).toBe(2);

    s = { ...s, shootCooldownMs: 0 };
    s = reduce(s, { type: 'shoot' });
    for (let i = 0; i < 4; i++) s = reduce(s, { type: 'projectile_step' });
    expect(s.quest?.nextSequenceIndex).toBe(3);

    s = { ...s, shootCooldownMs: 0 };
    s = reduce(s, { type: 'shoot' });
    for (let i = 0; i < 5; i++) s = reduce(s, { type: 'projectile_step' });
    expect(s.quest).toBeNull();
    expect(s.questsSolved).toBe(1);
    expect(s.events.some((e) => e.kind === 'quest_complete')).toBe(true);
  });

  it('requires morphing to targetForm for element_match and grants +1 heart every 3 solved quests', () => {
    let s = startPlaying({ seed: 30 });
    const quest = spawnQuest(s, createRng(30), 'element_match').quest!;
    const rightOrb = quest.orbs.find((o) => o.isCorrect)!;
    const wrongOrb = quest.orbs.find((o) => !o.isCorrect)!;

    s = {
      ...s,
      hearts: 2,
      questsSolved: 2,
      bots: [],
      orbs: [],
      quest: {
        ...quest,
        orbs: quest.orbs.map((o) =>
          o.id === rightOrb.id
            ? { ...o, cell: { x: 3.2, z: 0 } }
            : o.id === wrongOrb.id
              ? { ...o, cell: { x: 0.42, z: 0 } }
              : { ...o, cell: { x: 30, z: 30 } },
        ),
      },
    };

    // Touch wrong color orb -> no heart lost
    s = reduce(s, { type: 'tick' });
    expect(s.hearts).toBe(2);
    expect(s.events.some((e) => e.kind === 'quest_wrong')).toBe(true);

    // Shoot right orb while still dragon -> prompts to morph (x goes 0.42 -> 1.57 -> 2.72 -> hits 3.2)
    s = reduce(s, { type: 'shoot' });
    s = reduce(s, { type: 'projectile_step' });
    s = reduce(s, { type: 'projectile_step' });
    expect(s.events.some((e) => e.kind === 'quest_wrong')).toBe(true);
    expect(s.quest).not.toBeNull();

    // Morph to targetForm and shoot again -> completes + grants heart #3!
    s = reduce(s, { type: 'morph', form: quest.targetForm });
    s = { ...s, shootCooldownMs: 0 };
    s = reduce(s, { type: 'shoot' });
    s = reduce(s, { type: 'projectile_step' });
    s = reduce(s, { type: 'projectile_step' });
    expect(s.quest).toBeNull();
    expect(s.questsSolved).toBe(3);
    expect(s.hearts).toBe(3);
    expect(s.events.some((e) => e.kind === 'heart_gained')).toBe(true);
  });

  it('expires an active quest quietly when ticksRemaining reaches 0', () => {
    const s = startPlaying({ seed: 11 });
    const q = spawnQuest(s, createRng(11), 'math').quest!;
    expect(tickQuest({ ...q, ticksRemaining: 1 })).toBeNull();
    expect(tickQuest(q)?.ticksRemaining).toBe(q.ticksRemaining - 1);
  });
});

describe('Shield, Dash, and Hazards in open world', () => {
  it('activates shield with cooldown and blocks hazard damage safely', () => {
    let s = startPlaying({ seed: 1 });
    s = reduce(s, { type: 'shield' });
    expect(s.shieldTicks).toBe(30);
    expect(s.shieldCooldownTicks).toBe(60);
    expect(s.events.some((e) => e.kind === 'shield_activate')).toBe(true);
    expect(reduce(s, { type: 'shield' })).toBe(s);

    const hazard: Hazard = {
      id: 77,
      cell: { x: 0.42, z: 0 },
      prevCell: { x: 0.42, z: 0 },
      kind: 'crystal',
      hp: 3,
      maxHp: 3,
      frozenTicks: 0,
      warningTicks: 0,
    };
    s = { ...s, hazards: [hazard], bots: [], orbs: [] };
    const heartsBefore = s.hearts;
    s = reduce(s, { type: 'tick' });
    expect(s.hearts).toBe(heartsBefore);
    expect(s.events.some((e) => e.kind === 'shield_block')).toBe(true);
  });

  it('consumes dashEnergy while dashing (moving 1.65x faster), auto-stops at 0, and recharges', () => {
    let s = startPlaying({ seed: 1 });
    s = { ...s, bots: [], orbs: [] };
    const normalStep = reduce(s, { type: 'tick' }).snake[0]!.x;
    expect(normalStep).toBeCloseTo(s.config.baseSpeed, 5);

    s = reduce(s, { type: 'dash', active: true });
    expect(s.isDashing).toBe(true);
    const dashAfter = reduce(s, { type: 'tick' });
    expect(dashAfter.snake[0]!.x).toBeCloseTo(s.config.baseSpeed * 1.65, 4);
    expect(dashAfter.dashEnergy).toBe(95);

    const drained = reduce({ ...dashAfter, dashEnergy: 3 }, { type: 'tick' });
    expect(drained.dashEnergy).toBe(0);
    expect(drained.isDashing).toBe(false);
    expect(reduce(drained, { type: 'dash', active: true }).isDashing).toBe(false);

    const recharged = reduce(drained, { type: 'tick' });
    expect(recharged.dashEnergy).toBe(3);
  });

  it('moves patrolling slimes, respects meteor warningTicks, and keeps frozen slimes immobile', () => {
    const s = startPlaying({ seed: 1 });
    const slime = createHazard('slime', { x: 10, z: 10 }, createRng(1), 'reflex').hazard;
    let moved = false;
    let hazards: readonly Hazard[] = [slime];
    let rng = createRng(9);
    for (let i = 0; i < 15; i++) {
      const res = stepHazards({
        hazards,
        config: s.config,
        margin: s.arenaMargin,
        snake: s.snake,
        food: s.food,
        bonusFood: null,
        quest: null,
        mode: 'reflex',
        rng,
      });
      hazards = res.hazards;
      rng = res.rng;
      if (hazards[0]!.cell.x !== 10 || hazards[0]!.cell.z !== 10) moved = true;
    }
    expect(moved).toBe(true);

    const warningMeteor: Hazard = {
      id: 77,
      cell: { x: 0.42, z: 0 },
      prevCell: { x: 0.42, z: 0 },
      kind: 'meteor',
      hp: 2,
      maxHp: 2,
      frozenTicks: 0,
      warningTicks: 2,
    };
    const frozenSlime: Hazard = {
      id: 78,
      cell: { x: 18, z: 18 },
      prevCell: { x: 18, z: 18 },
      kind: 'slime',
      hp: 2,
      maxHp: 2,
      frozenTicks: 3,
      warningTicks: 0,
    };
    const next = reduce(
      { ...s, hazards: [warningMeteor, frozenSlime], bots: [], orbs: [] },
      { type: 'tick' },
    );
    expect(next.hearts).toBe(s.hearts);
    expect(next.hazards.find((h) => h.id === 77)!.warningTicks).toBe(1);
    expect(next.hazards.find((h) => h.id === 78)!.cell).toEqual({ x: 18, z: 18 });
    expect(next.hazards.find((h) => h.id === 78)!.frozenTicks).toBe(2);

    const cornerSnake = [
      { x: 56, z: -56 },
      { x: 56, z: -55 },
      { x: 55, z: -55 },
    ];
    const dir = pickSafeDirection(cornerSnake, 'right', DEFAULT_CONFIG, 0, []);
    expect(['down', 'left']).toContain(dir);
  });

  it('emits monotonic event IDs and clears events across separate actions', () => {
    let s = startPlaying({ seed: 5 });
    s = reduce(s, { type: 'morph', form: 'phoenix' });
    expect(s.events).toHaveLength(1);
    const firstId = s.events[0]!.id;

    s = reduce(s, { type: 'shoot' });
    expect(s.events).toHaveLength(1);
    expect(s.events[0]!.id).toBeGreaterThan(firstId);
  });
});
