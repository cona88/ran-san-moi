import { describe, expect, it } from 'vitest';
import {
  FORM_METADATA,
  PROJECTILE_STEP_DIST,
  SNAKE_FORMS,
  createInitialState,
  getMagnetRadius,
  reduce,
  type BotSnake,
  type GameState,
  type Hazard,
  type WorldOrb,
} from '../../src/core';

function startPlaying(opts?: Parameters<typeof createInitialState>[0]): GameState {
  return reduce(createInitialState(opts), { type: 'start' });
}

function makeHazard(overrides: Partial<Hazard> = {}): Hazard {
  return {
    id: 101,
    cell: { x: 2.3, z: 0 },
    prevCell: { x: 2.3, z: 0 },
    kind: 'slime',
    hp: 2,
    maxHp: 2,
    frozenTicks: 0,
    warningTicks: 0,
    ...overrides,
  };
}

function makeBot(overrides: Partial<BotSnake> = {}): BotSnake {
  return {
    id: 800,
    name: 'TestBot',
    skin: 'lime_viper',
    isBoss: false,
    level: 4,
    head: { x: 2.2, z: 0 },
    prevHead: { x: 2.2, z: 0 },
    heading: 0,
    spine: [
      { x: 2.2, z: 0 },
      { x: 1.7, z: 0 },
      { x: 1.2, z: 0 },
    ],
    prevSpine: [
      { x: 2.2, z: 0 },
      { x: 1.7, z: 0 },
      { x: 1.2, z: 0 },
    ],
    frozenTicks: 0,
    powerForm: 'spirit',
    ...overrides,
  };
}

describe('SnakeForm metadata and morphing', () => {
  it('exposes complete Vietnamese metadata and DualSense LED colors for all 4 forms', () => {
    expect(SNAKE_FORMS).toEqual(['dragon', 'phoenix', 'unicorn', 'spirit']);
    expect(FORM_METADATA.dragon.emoji).toBe('🌸');
    expect(FORM_METADATA.phoenix.emoji).toBe('🦋');
    expect(FORM_METADATA.unicorn.emoji).toBe('⚡');
    expect(FORM_METADATA.spirit.emoji).toBe('🍀');

    for (const form of SNAKE_FORMS) {
      const meta = FORM_METADATA[form];
      expect(meta.id).toBe(form);
      expect(meta.nameVi.length).toBeGreaterThan(3);
      expect(meta.weaponNameVi.length).toBeGreaterThan(3);
      expect(meta.perkVi.length).toBeGreaterThan(5);
      expect(meta.lightbarRgb).toHaveLength(3);
    }
  });

  it('morphs by explicit form and cyclic delta +1 / -1 and emits morph event', () => {
    let s = startPlaying({ seed: 1 });
    expect(s.form).toBe('dragon');

    s = reduce(s, { type: 'morph', delta: 1 });
    expect(s.form).toBe('phoenix');
    expect(s.events.some((e) => e.kind === 'morph' && e.form === 'phoenix')).toBe(true);

    s = reduce(s, { type: 'morph', delta: -1 });
    expect(s.form).toBe('dragon');

    s = reduce(s, { type: 'morph', delta: -1 });
    expect(s.form).toBe('spirit');

    s = reduce(s, { type: 'morph', form: 'unicorn' });
    expect(s.form).toBe('unicorn');
    expect(reduce(s, { type: 'morph', form: 'unicorn' })).toBe(s);
  });
});

describe('4 magical continuous weapons and projectile_step', () => {
  it('dragon shoots 1 continuous Meteor Shot advancing 1.15 units/step and destroys hazards & reduces bot level', () => {
    let s = startPlaying({ seed: 1 });
    const hazard = makeHazard({ cell: { x: 2.2, z: 0 }, hp: 2 });
    s = { ...s, hazards: [hazard], bots: [] };

    s = reduce(s, { type: 'shoot' });
    expect(s.projectiles).toHaveLength(1);
    expect(s.projectiles[0]!.dx).toBeCloseTo(1, 5);
    expect(s.projectiles[0]!.dz).toBeCloseTo(0, 5);
    expect(s.shootCooldownMs).toBe(220);

    // Cooldown blocks repeat shot
    expect(reduce(s, { type: 'shoot' }).projectiles).toHaveLength(1);

    s = reduce(s, { type: 'projectile_step' }); // x: 0 -> 1.15
    expect(s.shootCooldownMs).toBe(165);
    expect(s.projectiles[0]!.prevX).toBe(0);
    expect(s.projectiles[0]!.x).toBeCloseTo(PROJECTILE_STEP_DIST, 5);

    s = reduce(s, { type: 'projectile_step' }); // hits hazard at 2.2
    expect(s.hazards).toHaveLength(0);
    expect(s.projectiles).toHaveLength(0);
    expect(s.enemiesDefeated).toBe(1);
    expect(s.events.some((e) => e.kind === 'hazard_destroyed')).toBe(true);
  });

  it('tick does NOT advance projectiles (handled solely by projectile_step)', () => {
    let s = startPlaying({ seed: 1 });
    s = { ...s, bots: [], hazards: [] };
    s = reduce(s, { type: 'shoot' });
    const pBefore = s.projectiles[0]!;
    s = reduce(s, { type: 'tick' });
    expect(s.projectiles[0]!.x).toBe(pBefore.x);
    expect(s.projectiles[0]!.z).toBe(pBefore.z);
  });

  it('phoenix shoots 3 fan rays (-0.28, 0, +0.28 rad) and freezes hit bots & hazards', () => {
    let s = startPlaying({ seed: 1 });
    s = reduce(s, { type: 'morph', form: 'phoenix' });
    const bot = makeBot({ id: 55, level: 8, head: { x: 3.4, z: 0 }, spine: [{ x: 3.4, z: 0 }] });
    const sideHazard = makeHazard({ id: 56, cell: { x: 3.4, z: 1.0 }, hp: 2 });
    s = { ...s, bots: [bot], hazards: [sideHazard] };

    s = reduce(s, { type: 'shoot' });
    expect(s.projectiles).toHaveLength(3);
    const angles = s.projectiles.map((p) => Math.atan2(p.dz, p.dx)).sort((a, b) => a - b);
    expect(angles[0]).toBeCloseTo(-0.28, 4);
    expect(angles[1]).toBeCloseTo(0, 4);
    expect(angles[2]).toBeCloseTo(0.28, 4);

    s = reduce(s, { type: 'projectile_step' }); // 1.15
    s = reduce(s, { type: 'projectile_step' }); // 2.30
    s = reduce(s, { type: 'projectile_step' }); // 3.45 -> center hits bot, side hits hazard!
    const updatedBot = s.bots.find((b) => b.id === 55)!;
    expect(updatedBot.level).toBe(6); // -2 levels
    expect(updatedBot.frozenTicks).toBeGreaterThan(0);
    expect(s.hazards.find((h) => h.id === 56)!.frozenTicks).toBeGreaterThan(0);
    expect(s.events.some((e) => e.kind === 'bot_hit')).toBe(true);
  });

  it('unicorn shoots homing piercing bolts and expands orb magnet radius to 3.2', () => {
    let s = startPlaying({ seed: 1 });
    s = reduce(s, { type: 'morph', form: 'unicorn' });
    expect(getMagnetRadius(s)).toBe(3.2);

    // Offset bot slightly above heading axis so homing bends upward toward it
    const bot = makeBot({
      id: 66,
      level: 6,
      head: { x: 3.4, z: -0.9 },
      spine: [{ x: 3.4, z: -0.9 }],
    });
    s = { ...s, bots: [bot], hazards: [] };

    s = reduce(s, { type: 'shoot' });
    expect(s.projectiles[0]!.piercing).toBe(true);

    for (let i = 0; i < 4; i++) {
      s = reduce(s, { type: 'projectile_step' });
    }
    const updatedBot = s.bots.find((b) => b.id === 66)!;
    expect(updatedBot.level).toBeLessThan(6);
    expect(s.projectiles).toHaveLength(1); // piercing bolt survives after hitting!

    // Magnet test: orb at distance 2.5 (< 3.2) pulls toward head on tick
    const farOrb: WorldOrb = {
      id: 77777,
      x: s.snake[0]!.x + 2.5,
      z: s.snake[0]!.z,
      value: 1,
      colorHex: 0xffd43b,
      isLoot: false,
    };
    s = { ...s, orbs: [farOrb], bots: [] };
    s = reduce(s, { type: 'tick' });
    const movedOrb = s.orbs.find((o) => o.id === 77777);
    if (movedOrb) {
      expect(Math.hypot(movedOrb.x - s.snake[0]!.x, movedOrb.z - s.snake[0]!.z)).toBeLessThan(2.5);
    }
  });

  it('spirit detonates in a 4.2-unit radius blasting multiple hazards and bots', () => {
    let s = startPlaying({ seed: 7 });
    s = reduce(s, { type: 'morph', form: 'spirit' });
    const h1 = makeHazard({ id: 21, cell: { x: 2.3, z: 0 }, hp: 2 });
    const h2 = makeHazard({ id: 22, cell: { x: 4.5, z: 2.0 }, hp: 2 }); // within 4.2 of (2.3, 0)
    const hFar = makeHazard({ id: 23, cell: { x: 12, z: 0 }, hp: 2 }); // outside 4.2
    const botNear = makeBot({
      id: 24,
      level: 3,
      head: { x: 3.5, z: 2.5 },
      spine: [{ x: 3.5, z: 2.5 }],
    });
    s = { ...s, hazards: [h1, h2, hFar], bots: [botNear], bonusFood: null };

    s = reduce(s, { type: 'shoot' });
    s = reduce(s, { type: 'projectile_step' });
    s = reduce(s, { type: 'projectile_step' });

    expect(s.hazards.map((h) => h.id)).toEqual([23]);
    expect(s.bots.find((b) => b.id === 24)).toBeUndefined(); // 3-3=0 -> defeated by Spirit blast!
    expect(s.enemiesDefeated).toBe(3);
  });

  it('breaks element_gate immediately with matching form and hints on mismatch', () => {
    let s = startPlaying({ seed: 1 });
    const gate = makeHazard({
      id: 50,
      kind: 'element_gate',
      cell: { x: 2.6, z: 0 },
      hp: 3,
      maxHp: 3,
      requiredForm: 'phoenix',
    });
    s = { ...s, hazards: [gate], bots: [] };

    s = reduce(s, { type: 'shoot' });
    s = reduce(s, { type: 'projectile_step' }); // 1.15
    s = reduce(s, { type: 'projectile_step' }); // 2.30 -> hits 2.6
    expect(s.hazards).toHaveLength(1);
    expect(s.hazards[0]!.hp).toBe(2);
    expect(
      s.events.some(
        (e) => e.kind === 'hazard_hit' && (e.messageVi?.includes('Phượng Hoàng') ?? false),
      ),
    ).toBe(true);

    s = reduce(s, { type: 'morph', form: 'phoenix' });
    const scoreBefore = s.score;
    s = { ...s, shootCooldownMs: 0 };
    s = reduce(s, { type: 'shoot' });
    s = reduce(s, { type: 'projectile_step' });
    s = reduce(s, { type: 'projectile_step' });
    expect(s.hazards).toHaveLength(0);
    expect(s.score).toBe(scoreBefore + 50);
  });
});
