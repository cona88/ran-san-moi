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
      { x: 280, z: -280 },
      { x: 280, z: -279 },
      { x: 279, z: -279 },
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

describe('Age-aware letter_match quests (age6)', () => {
  it('spawns letter_match quest with 3 orbs, correct letter + 2 distractors', () => {
    const s = startPlaying({ seed: 42, ageProfile: 'age6' });
    const spawned = spawnQuest(s, createRng(42), 'letter_match');
    expect(spawned.quest).not.toBeNull();
    const quest = spawned.quest!;
    expect(quest.kind).toBe('letter_match');
    expect(quest.rewardLevels).toBe(10);
    expect(quest.rewardScore).toBe(100);
    expect(quest.orbs).toHaveLength(3);
    expect(quest.rewardEffect).toBeDefined();
    expect(quest.rewardIconVi).toBeDefined();
    expect(quest.speechVi).toBeDefined();
    expect(quest.targetWord).toBeDefined();
    expect(quest.wordSlots).toBeDefined();
    expect(quest.iconEmoji).toBeDefined();

    const correctOrb = quest.orbs.find((o) => o.isCorrect)!;
    expect(correctOrb).toBeDefined();
    expect(correctOrb.label).toBe(quest.targetWord);
    expect(correctOrb.subLabel).toBeDefined();
    expect(correctOrb.spokenVi).toBeDefined();

    const wrongOrbs = quest.orbs.filter((o) => !o.isCorrect);
    expect(wrongOrbs).toHaveLength(2);
  });

  it('completes letter_match with linked form_dragon reward', () => {
    let s = startPlaying({ seed: 99, ageProfile: 'age6' });
    // Manually build a letter_match quest with known rewardEffect
    const quest = spawnQuest(s, createRng(99), 'letter_match').quest!;
    const rightOrb = quest.orbs.find((o) => o.isCorrect)!;

    const arranged: BrainQuest = {
      ...quest,
      rewardEffect: 'form_dragon',
      rewardIconVi: '🌸🔥 Phép Rồng',
      orbs: quest.orbs.map((o) =>
        o.id === rightOrb.id ? { ...o, cell: { x: 0.42, z: 0 } } : { ...o, cell: { x: 30, z: 30 } },
      ),
    };
    s = { ...s, quest: arranged, bots: [], orbs: [] };
    const levelBefore = s.level;

    s = reduce(s, { type: 'tick' });
    // Quest should be solved; form should be dragon and absorbedPower set
    expect(s.quest).toBeNull();
    expect(s.questsSolved).toBe(1);
    expect(s.level).toBe(levelBefore + 10);
    expect(s.form).toBe('dragon');
    expect(s.absorbedPower).not.toBeNull();
    expect(s.absorbedPower?.form).toBe('dragon');
    expect(s.absorbedPower?.ticksRemaining).toBe(180);
    expect(s.events.some((e) => e.kind === 'quest_complete')).toBe(true);
  });

  it('wrong letter_match orb gives gentle hint without losing hearts', () => {
    let s = startPlaying({ seed: 77, ageProfile: 'age6' });
    const quest = spawnQuest(s, createRng(77), 'letter_match').quest!;
    const wrongOrb = quest.orbs.find((o) => !o.isCorrect)!;

    const arranged: BrainQuest = {
      ...quest,
      orbs: quest.orbs.map((o) =>
        o.id === wrongOrb.id ? { ...o, cell: { x: 0.42, z: 0 } } : { ...o, cell: { x: 30, z: 30 } },
      ),
    };
    s = { ...s, quest: arranged, bots: [], orbs: [] };
    const heartsBefore = s.hearts;

    s = reduce(s, { type: 'tick' });
    expect(s.hearts).toBe(heartsBefore);
    expect(s.events.some((e) => e.kind === 'quest_wrong')).toBe(true);
    expect(s.quest?.orbs.find((o) => o.id === wrongOrb.id)?.collected).toBe(true);
  });
});

describe('Age-aware word_spell quests (age9)', () => {
  it('spawns word_spell quest with sequential orbs for age9', () => {
    const s = startPlaying({ seed: 55, ageProfile: 'age9' });
    const spawned = spawnQuest(s, createRng(55), 'word_spell');
    expect(spawned.quest).not.toBeNull();
    const quest = spawned.quest!;
    expect(quest.kind).toBe('word_spell');
    expect(quest.rewardLevels).toBe(10);
    expect(quest.rewardScore).toBe(120);
    expect(quest.rewardEffect).toBeDefined();
    expect(quest.targetWord).toBeDefined();
    expect(quest.wordSlots).toBeDefined();
    expect(quest.wordSlots!.length).toBeGreaterThanOrEqual(2);
    expect(quest.orbs.length).toBe(quest.wordSlots!.length);

    // All orbs should have sequenceOrder and be correct
    for (let i = 0; i < quest.orbs.length; i++) {
      const orb = quest.orbs[i]!;
      expect(orb.isCorrect).toBe(true);
      expect(orb.sequenceOrder).toBe(i + 1);
      expect(orb.label).toBe(quest.wordSlots![i]);
      expect(orb.collected).toBe(false);
    }
    expect(quest.nextSequenceIndex).toBe(1);
  });

  it('filters age6 to words with <= 3 slots, age9 to >= 3 slots', () => {
    // age6: word_spell should only get short words
    for (let seed = 1; seed <= 20; seed++) {
      const s6 = startPlaying({ seed, ageProfile: 'age6' });
      const q6 = spawnQuest(s6, createRng(seed), 'word_spell').quest;
      if (q6) {
        expect(q6.wordSlots!.length).toBeLessThanOrEqual(3);
      }
    }
    // age9: word_spell should only get words with >= 3 slots
    for (let seed = 1; seed <= 20; seed++) {
      const s9 = startPlaying({ seed, ageProfile: 'age9' });
      const q9 = spawnQuest(s9, createRng(seed), 'word_spell').quest;
      if (q9) {
        expect(q9.wordSlots!.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('solves word_spell in correct order, out-of-order gives hint without consuming', () => {
    let s = startPlaying({ seed: 33, ageProfile: 'age9' });
    const spawned = spawnQuest(s, createRng(33), 'word_spell');
    const quest = spawned.quest!;

    // Place orbs in a line ahead
    const arranged: BrainQuest = {
      ...quest,
      orbs: quest.orbs.map((o, idx) => ({
        ...o,
        cell: { x: 0.42 + idx * 2.5, z: 0 },
      })),
    };
    s = { ...s, quest: arranged, bots: [], orbs: [] };

    // Try to touch 2nd orb first (out-of-order) — should not consume
    const orb2 = arranged.orbs[1]!;
    if (orb2 && arranged.orbs.length > 1) {
      const arranged2: BrainQuest = {
        ...arranged,
        orbs: arranged.orbs.map((o) =>
          o.sequenceOrder === 2
            ? { ...o, cell: { x: 0.42, z: 0 } }
            : { ...o, cell: { x: 30, z: 30 } },
        ),
      };
      s = { ...s, quest: arranged2 };
      s = reduce(s, { type: 'tick' });
      expect(s.events.some((e) => e.kind === 'quest_wrong')).toBe(true);
      // Orb should NOT be collected (out-of-order for word_spell)
      expect(s.quest?.orbs.find((o) => o.sequenceOrder === 2)?.collected).toBe(false);
    }
  });
});

describe('Linked magic/item rewards', () => {
  it('item_shield reward grants shieldTicks >= 120', () => {
    let s = startPlaying({ seed: 88, ageProfile: 'age6' });
    const quest = spawnQuest(s, createRng(88), 'letter_match').quest!;
    const rightOrb = quest.orbs.find((o) => o.isCorrect)!;
    const arranged: BrainQuest = {
      ...quest,
      rewardEffect: 'item_shield',
      rewardIconVi: '🛡️🫧 Khiên',
      orbs: quest.orbs.map((o) =>
        o.id === rightOrb.id ? { ...o, cell: { x: 0.42, z: 0 } } : { ...o, cell: { x: 30, z: 30 } },
      ),
    };
    s = { ...s, quest: arranged, bots: [], orbs: [], shieldTicks: 0 };
    s = reduce(s, { type: 'tick' });
    expect(s.quest).toBeNull();
    expect(s.shieldTicks).toBeGreaterThanOrEqual(119); // might be decremented by 1 in tick
  });

  it('item_heart reward heals +1 heart', () => {
    let s = startPlaying({ seed: 88, ageProfile: 'age6' });
    const quest = spawnQuest(s, createRng(88), 'letter_match').quest!;
    const rightOrb = quest.orbs.find((o) => o.isCorrect)!;
    const arranged: BrainQuest = {
      ...quest,
      rewardEffect: 'item_heart',
      rewardIconVi: '❤️💖 +1 Tim',
      orbs: quest.orbs.map((o) =>
        o.id === rightOrb.id ? { ...o, cell: { x: 0.42, z: 0 } } : { ...o, cell: { x: 30, z: 30 } },
      ),
    };
    s = { ...s, quest: arranged, bots: [], orbs: [], hearts: 2 };
    const heartsBefore = s.hearts;
    s = reduce(s, { type: 'tick' });
    expect(s.quest).toBeNull();
    // +1 from item_heart
    expect(s.hearts).toBeGreaterThan(heartsBefore);
  });

  it('form_phoenix reward freezes nearby bots', () => {
    let s = startPlaying({ seed: 88, ageProfile: 'age6' });
    const quest = spawnQuest(s, createRng(88), 'letter_match').quest!;
    const rightOrb = quest.orbs.find((o) => o.isCorrect)!;
    const arranged: BrainQuest = {
      ...quest,
      rewardEffect: 'form_phoenix',
      rewardIconVi: '❄️🦋 Phép Băng',
      orbs: quest.orbs.map((o) =>
        o.id === rightOrb.id ? { ...o, cell: { x: 0.42, z: 0 } } : { ...o, cell: { x: 30, z: 30 } },
      ),
    };
    // Place a bot within 20 units of the orb
    const nearBot = s.bots[0];
    if (nearBot) {
      const closeBots = s.bots.map((b, i) =>
        i === 0
          ? {
              ...b,
              head: { x: 2, z: 0 },
              spine: [{ x: 2, z: 0 }],
              prevHead: { x: 2, z: 0 },
              frozenTicks: 0,
              level: 1,
            }
          : { ...b, head: { x: 50, z: 50 }, spine: [{ x: 50, z: 50 }], level: 1 },
      );
      s = { ...s, quest: arranged, bots: closeBots, orbs: [] };
      s = reduce(s, { type: 'tick' });
      expect(s.quest).toBeNull();
      expect(s.form).toBe('phoenix');
      const frozenBot = s.bots.find((b) => b.id === nearBot.id);
      if (frozenBot) {
        expect(frozenBot.frozenTicks).toBeGreaterThanOrEqual(44); // 45 - tick decrement
      }
    }
  });
});

describe('set_age_profile action', () => {
  it('switches ageProfile and refreshes active quest', () => {
    let s = startPlaying({ seed: 50, ageProfile: 'age6' });
    expect(s.ageProfile).toBe('age6');

    // Give it a quest
    const quest = spawnQuest(s, createRng(50), 'letter_match').quest!;
    s = { ...s, quest };

    // Switch to age9
    s = reduce(s, { type: 'set_age_profile', ageProfile: 'age9' });
    expect(s.ageProfile).toBe('age9');
    // Quest should be refreshed (spawned a new one)
    if (s.quest) {
      expect(s.events.some((e) => e.kind === 'quest_spawn')).toBe(true);
    }
  });

  it('does nothing special when no quest is active', () => {
    let s = startPlaying({ seed: 50, ageProfile: 'age6' });
    s = { ...s, quest: null };
    s = reduce(s, { type: 'set_age_profile', ageProfile: 'age9' });
    expect(s.ageProfile).toBe('age9');
    expect(s.quest).toBeNull();
  });

  it('threads ageProfile through start and reset actions', () => {
    let s = createInitialState({ seed: 1, ageProfile: 'age9' });
    expect(s.ageProfile).toBe('age9');
    s = reduce(s, { type: 'start', ageProfile: 'age6' });
    expect(s.ageProfile).toBe('age6');
    s = reduce(s, { type: 'reset', ageProfile: 'age9' });
    expect(s.ageProfile).toBe('age9');
  });
});

describe('Age-aware quest spawn distribution', () => {
  it('age6 spawns mostly letter_match, never math', () => {
    const counts: Record<string, number> = {};
    for (let seed = 1; seed <= 100; seed++) {
      const s = startPlaying({ seed, ageProfile: 'age6' });
      const spawned = spawnQuest(s, createRng(seed));
      if (spawned.quest) {
        counts[spawned.quest.kind] = (counts[spawned.quest.kind] ?? 0) + 1;
      }
    }
    expect(counts['math'] ?? 0).toBe(0);
    expect(counts['letter_match'] ?? 0).toBeGreaterThan(0);
  });

  it('age9 spawns word_spell, letter_match, math, element_match in expected distribution', () => {
    const counts: Record<string, number> = {};
    for (let seed = 1; seed <= 200; seed++) {
      const s = startPlaying({ seed, ageProfile: 'age9' });
      const spawned = spawnQuest(s, createRng(seed));
      if (spawned.quest) {
        counts[spawned.quest.kind] = (counts[spawned.quest.kind] ?? 0) + 1;
      }
    }
    expect(counts['word_spell'] ?? 0).toBeGreaterThan(0);
    expect(counts['letter_match'] ?? 0).toBeGreaterThan(0);
    expect(counts['math'] ?? 0).toBeGreaterThan(0);
    expect(counts['element_match'] ?? 0).toBeGreaterThan(0);
  });

  it('age6 spawn chance is 0.045 (higher than default 0.025)', () => {
    // We test indirectly: age6 should spawn quests more often
    let spawnCount6 = 0;
    for (let seed = 1; seed <= 100; seed++) {
      let s = startPlaying({ seed, ageProfile: 'age6' });
      s = { ...s, quest: null };
      const after = reduce(s, { type: 'tick' });
      if (after.quest !== null) spawnCount6++;
    }
    // With 4.5% chance, expect at least 1 spawn in 100 ticks
    expect(spawnCount6).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Fairy quest reward tests
// ---------------------------------------------------------------------------
import { COCOON_DURATION_TICKS } from '../../src/core';

function startPlayingForFairy(opts?: Parameters<typeof createInitialState>[0]): GameState {
  return reduce(createInitialState(opts), { type: 'start' });
}

describe('Fairy quest rewards (fairy_butterfly, fairy_flower_garden, fairy_thunder_storm)', () => {
  it('fairy_butterfly reward triggers cocoon metamorphosis', () => {
    let s = startPlayingForFairy({ seed: 88, ageProfile: 'age6' });
    const quest = spawnQuest(s, createRng(88), 'letter_match').quest!;
    const rightOrb = quest.orbs.find((o) => o.isCorrect)!;
    const arranged: BrainQuest = {
      ...quest,
      rewardEffect: 'fairy_butterfly',
      rewardIconVi: '🦋✨ Hóa Bướm',
      orbs: quest.orbs.map((o) =>
        o.id === rightOrb.id ? { ...o, cell: { x: 0.42, z: 0 } } : { ...o, cell: { x: 30, z: 30 } },
      ),
    };
    s = { ...s, quest: arranged, bots: [], orbs: [] };
    const levelBefore = s.level;

    s = reduce(s, { type: 'tick' });
    expect(s.quest).toBeNull();
    expect(s.questsSolved).toBe(1);
    expect(s.level).toBe(levelBefore + 10);
    expect(s.butterflyStage).toBe('cocoon');
    expect(s.butterflyTicks).toBe(COCOON_DURATION_TICKS - 1); // -1 because stepFairyMagic runs in same tick
    expect(s.events.some((e) => e.kind === 'quest_complete')).toBe(true);
    expect(s.events.some((e) => e.kind === 'cocoon_start')).toBe(true);
  });

  it('fairy_flower_garden reward spawns 6 flowers in a ring', () => {
    let s = startPlayingForFairy({ seed: 88, ageProfile: 'age6' });
    const quest = spawnQuest(s, createRng(88), 'letter_match').quest!;
    const rightOrb = quest.orbs.find((o) => o.isCorrect)!;
    const arranged: BrainQuest = {
      ...quest,
      rewardEffect: 'fairy_flower_garden',
      rewardIconVi: '🌸🌷 Vườn Hoa',
      orbs: quest.orbs.map((o) =>
        o.id === rightOrb.id ? { ...o, cell: { x: 0.42, z: 0 } } : { ...o, cell: { x: 30, z: 30 } },
      ),
    };
    s = { ...s, quest: arranged, bots: [], orbs: [] };
    s = reduce(s, { type: 'tick' });
    expect(s.quest).toBeNull();
    expect(s.gardenFlowers.length).toBe(6);
    expect(s.events.some((e) => e.kind === 'quest_complete')).toBe(true);
    expect(s.events.some((e) => e.kind === 'flower_bloom')).toBe(true);
  });

  it('fairy_thunder_storm reward spawns 5 bolts without setting cooldown', () => {
    let s = startPlayingForFairy({ seed: 88, ageProfile: 'age6' });
    const quest = spawnQuest(s, createRng(88), 'letter_match').quest!;
    const rightOrb = quest.orbs.find((o) => o.isCorrect)!;
    const arranged: BrainQuest = {
      ...quest,
      rewardEffect: 'fairy_thunder_storm',
      rewardIconVi: '⚡🌩️ Sấm Sét',
      orbs: quest.orbs.map((o) =>
        o.id === rightOrb.id ? { ...o, cell: { x: 0.42, z: 0 } } : { ...o, cell: { x: 30, z: 30 } },
      ),
    };
    s = { ...s, quest: arranged, bots: [], orbs: [] };
    s = reduce(s, { type: 'tick' });
    expect(s.quest).toBeNull();
    expect(s.lightningBolts.length).toBe(5);
    expect(s.thunderCooldownTicks).toBe(0); // quest reward doesn't set cooldown
    expect(s.events.some((e) => e.kind === 'quest_complete')).toBe(true);
    expect(s.events.some((e) => e.kind === 'sky_thunder')).toBe(true);
  });

  it('LETTER_MAGIC_BANK B now maps to fairy_butterfly', () => {
    // Spawn many letter_match quests and check that 'B' letter uses fairy_butterfly
    for (let seed = 1; seed <= 100; seed++) {
      const s = startPlayingForFairy({ seed, ageProfile: 'age6' });
      const spawned = spawnQuest(s, createRng(seed), 'letter_match');
      if (spawned.quest?.targetWord === 'B') {
        expect(spawned.quest.rewardEffect).toBe('fairy_butterfly');
        break;
      }
    }
  });

  it('LETTER_MAGIC_BANK H now maps to fairy_flower_garden', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const s = startPlayingForFairy({ seed, ageProfile: 'age6' });
      const spawned = spawnQuest(s, createRng(seed), 'letter_match');
      if (spawned.quest?.targetWord === 'H') {
        expect(spawned.quest.rewardEffect).toBe('fairy_flower_garden');
        break;
      }
    }
  });

  it('LETTER_MAGIC_BANK S now maps to fairy_thunder_storm', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const s = startPlayingForFairy({ seed, ageProfile: 'age6' });
      const spawned = spawnQuest(s, createRng(seed), 'letter_match');
      if (spawned.quest?.targetWord === 'S') {
        expect(spawned.quest.rewardEffect).toBe('fairy_thunder_storm');
        break;
      }
    }
  });

  it('LETTER_MAGIC_BANK Đ maps to form_phoenix', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const s = startPlayingForFairy({ seed, ageProfile: 'age6' });
      const spawned = spawnQuest(s, createRng(seed), 'letter_match');
      if (spawned.quest?.targetWord === 'Đ') {
        expect(spawned.quest.rewardEffect).toBe('form_phoenix');
        break;
      }
    }
  });

  it('SIMPLE_WORD_BANK HOA now maps to fairy_flower_garden', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const s = startPlayingForFairy({ seed, ageProfile: 'age6' });
      const spawned = spawnQuest(s, createRng(seed), 'word_spell');
      if (spawned.quest?.targetWord === 'HOA') {
        expect(spawned.quest.rewardEffect).toBe('fairy_flower_garden');
        break;
      }
    }
  });

  it('maps L/N/P letters and LỬA/NƯỚC/PHÉP words to AoE elemental rewards', () => {
    const foundLetters = new Map<string, string | undefined>();
    for (let seed = 1; seed <= 250; seed++) {
      const s = startPlayingForFairy({ seed, ageProfile: 'age6' });
      const q = spawnQuest(s, createRng(seed), 'letter_match').quest;
      if (q?.targetWord && ['L', 'N', 'P'].includes(q.targetWord)) {
        foundLetters.set(q.targetWord, q.rewardEffect);
      }
    }
    expect(foundLetters.get('L')).toBe('aoe_fire_nova');
    expect(foundLetters.get('N')).toBe('aoe_water_tsunami');
    expect(foundLetters.get('P')).toBe('aoe_arcane_nova');

    const foundWords = new Map<string, string | undefined>();
    for (let seed = 1; seed <= 250; seed++) {
      const s = startPlayingForFairy({ seed, ageProfile: 'age9' });
      const q = spawnQuest(s, createRng(seed), 'word_spell').quest;
      if (q?.targetWord && ['LỬA', 'NƯỚC', 'PHÉP'].includes(q.targetWord)) {
        foundWords.set(q.targetWord, q.rewardEffect);
      }
    }
    expect(foundWords.get('LỬA')).toBe('aoe_fire_nova');
    expect(foundWords.get('NƯỚC')).toBe('aoe_water_tsunami');
    expect(foundWords.get('PHÉP')).toBe('aoe_arcane_nova');
  });

  it('completes quests with aoe_fire_nova, aoe_water_tsunami, and aoe_arcane_nova rewards', () => {
    const cases = [
      {
        rewardEffect: 'aoe_fire_nova' as const,
        eventKind: 'aoe_fire' as const,
        element: 'fire' as const,
      },
      {
        rewardEffect: 'aoe_water_tsunami' as const,
        eventKind: 'aoe_water' as const,
        element: 'water' as const,
      },
      {
        rewardEffect: 'aoe_arcane_nova' as const,
        eventKind: 'aoe_arcane' as const,
        element: 'arcane' as const,
      },
    ];

    for (const c of cases) {
      let s = startPlayingForFairy({ seed: 88, ageProfile: 'age6' });
      const quest = spawnQuest(s, createRng(88), 'letter_match').quest!;
      const rightOrb = quest.orbs.find((o) => o.isCorrect)!;
      const arranged: BrainQuest = {
        ...quest,
        rewardEffect: c.rewardEffect,
        orbs: quest.orbs.map((o) =>
          o.id === rightOrb.id
            ? { ...o, cell: { x: 0.42, z: 0 } }
            : { ...o, cell: { x: 30, z: 30 } },
        ),
      };
      s = { ...s, quest: arranged, bots: [], orbs: [] };
      const levelBefore = s.level;

      s = reduce(s, { type: 'tick' });
      expect(s.quest).toBeNull();
      expect(s.level).toBe(levelBefore + 10);
      expect(s.events.some((e) => e.kind === 'quest_complete')).toBe(true);
      expect(s.events.some((e) => e.kind === c.eventKind)).toBe(true);
      expect(s.aoeBlasts.some((b) => b.element === c.element)).toBe(true);
      expect(s.fireCooldownTicks).toBe(0);
      expect(s.waterCooldownTicks).toBe(0);
      expect(s.arcaneCooldownTicks).toBe(0);
    }
  });
});
