import { describe, expect, it } from 'vitest';
import {
  FORM_METADATA,
  MAX_SILK_WEBS,
  PROJECTILE_STEP_DIST,
  SILK_WEB_DURATION_TICKS,
  SNAKE_FORMS,
  SPIRIT_EXPLOSION_RADIUS,
  SPRAY_ACTIVE_TICKS,
  absorbedPowerTitle,
  createInitialState,
  getMagnetRadius,
  reduce,
  sprayKindForForm,
  stepSilkWebs,
  type BotSnake,
  type GameState,
  type Hazard,
  type WorldOrb,
} from '../../src/core';
import { pushBotAlongSpray } from '../../src/core/projectiles';

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

describe('Elemental spray powers, knockback, and SilkWebZone', () => {
  it('maps sprayKindForForm, FORM_METADATA elemental spray copy, and absorbedPowerTitle', () => {
    expect(sprayKindForForm('dragon')).toBe('fire');
    expect(sprayKindForForm('phoenix')).toBe('ice');
    expect(sprayKindForForm('unicorn')).toBe('water');
    expect(sprayKindForForm('spirit')).toBe('silk');

    for (const form of SNAKE_FORMS) {
      expect(FORM_METADATA[form].sprayKind).toBe(sprayKindForForm(form));
    }

    expect(FORM_METADATA.dragon.nameVi).toBe('🌸 Rồng Tinh Tú');
    expect(FORM_METADATA.dragon.weaponNameVi).toBe('🔥 Phun Lửa Rồng');
    expect(FORM_METADATA.phoenix.nameVi).toBe('🦋 Phượng Hoàng Băng');
    expect(FORM_METADATA.phoenix.weaponNameVi).toBe('❄️ Phun Băng Giá');
    expect(FORM_METADATA.unicorn.nameVi).toBe('⚡ Kỳ Lân Ánh Sáng');
    expect(FORM_METADATA.unicorn.weaponNameVi).toBe('🌊 Phun Nước Xoáy');
    expect(FORM_METADATA.spirit.nameVi).toBe('🍀 Tinh Linh Rừng Xanh');
    expect(FORM_METADATA.spirit.weaponNameVi).toBe('🕸️ Phun Tơ Phép');

    expect(absorbedPowerTitle('dragon')).toBe('Hấp thụ: Phun Lửa Siêu Tốc x2 🌸');
    expect(absorbedPowerTitle('unicorn')).toBe('Hấp thụ: Siêu Nam Châm ⚡');
  });

  it('activates sprayActiveTicks on shoot, sets maxTtl/sprayKind, and decays on tick', () => {
    let s = startPlaying({ seed: 1 });
    expect(s.sprayActiveTicks).toBe(0);
    expect(s.silkWebs).toEqual([]);

    s = { ...s, bots: [], hazards: [] };
    s = reduce(s, { type: 'shoot' });
    expect(s.sprayActiveTicks).toBe(SPRAY_ACTIVE_TICKS);
    expect(s.projectiles[0]!.sprayKind).toBe('fire');
    expect(s.projectiles[0]!.maxTtl).toBe(24);
    expect(s.projectiles[0]!.hitBotIds).toBeUndefined();

    for (let i = 0; i < SPRAY_ACTIVE_TICKS - 1; i++) {
      s = reduce(s, { type: 'tick' });
    }
    expect(s.sprayActiveTicks).toBe(1);

    s = reduce(s, { type: 'tick' });
    expect(s.sprayActiveTicks).toBe(0);
    s = reduce(s, { type: 'tick' });
    expect(s.sprayActiveTicks).toBe(0);

    // Check phoenix / unicorn / spirit projectile metadata
    s = reduce(s, { type: 'morph', form: 'phoenix' });
    s = { ...s, shootCooldownMs: 0 };
    s = reduce(s, { type: 'shoot' });
    const iceRays = s.projectiles.filter((p) => p.form === 'phoenix');
    expect(iceRays).toHaveLength(3);
    for (const ray of iceRays) {
      expect(ray.sprayKind).toBe('ice');
      expect(ray.maxTtl).toBe(18);
      expect(ray.hitBotIds).toBeUndefined();
    }

    s = reduce(s, { type: 'morph', form: 'unicorn' });
    s = { ...s, shootCooldownMs: 0, projectiles: [] };
    s = reduce(s, { type: 'shoot' });
    expect(s.projectiles[0]!.sprayKind).toBe('water');
    expect(s.projectiles[0]!.maxTtl).toBe(24);
    expect(s.projectiles[0]!.hitBotIds).toEqual([]);

    s = reduce(s, { type: 'morph', form: 'spirit' });
    s = { ...s, shootCooldownMs: 0, projectiles: [] };
    s = reduce(s, { type: 'shoot' });
    expect(s.projectiles[0]!.sprayKind).toBe('silk');
    expect(s.projectiles[0]!.maxTtl).toBe(10);
    expect(s.projectiles[0]!.hitBotIds).toBeUndefined();
  });

  it('pushes and slows surviving bots on Dragon fire hit and clamps within arena bounds', () => {
    let s = startPlaying({ seed: 1 });
    const bot = makeBot({
      id: 901,
      name: 'FireTarget',
      level: 10,
      head: { x: 3.3, z: 0 },
      spine: [
        { x: 3.3, z: 0 },
        { x: 2.8, z: 0 },
        { x: 2.3, z: 0 },
      ],
    });
    s = { ...s, bots: [bot], hazards: [] };

    s = reduce(s, { type: 'shoot' });
    s = reduce(s, { type: 'projectile_step' }); // 1.15
    s = reduce(s, { type: 'projectile_step' }); // 2.30 -> hits bot

    const hitBot = s.bots.find((b) => b.id === 901)!;
    expect(hitBot.level).toBe(6); // 10 - 4
    expect(hitBot.chompedTicks).toBeGreaterThanOrEqual(12);
    expect(hitBot.head.x).toBeCloseTo(3.3 + 0.85, 4);
    expect(hitBot.spine[1]!.x).toBeCloseTo(2.8 + 0.85, 4);
    expect(hitBot.spine[2]!.x).toBeCloseTo(2.3 + 0.85, 4);
    expect(hitBot.prevHead).toEqual(bot.head);
    expect(hitBot.prevSpine).toHaveLength(hitBot.spine.length);
    expect(
      s.events.some((e) => e.kind === 'bot_hit' && e.messageVi === '🔥 Thiêu FireTarget! Còn Lv.6'),
    ).toBe(true);

    // Boundary clamping check for pushBotAlongSpray
    const edgeBot = makeBot({
      id: 902,
      head: { x: 54.5, z: 0 },
      spine: [{ x: 54.5, z: 0 }],
    });
    const pushed = pushBotAlongSpray(edgeBot, 1, 0, 1.5, 56);
    expect(pushed.head.x).toBeCloseTo(54.8, 5);
    expect(pushed.spine[0]!.x).toBeCloseTo(54.8, 5);
  });

  it('deep-freezes bots and hazards (frozenTicks >= 24) on Phoenix ice 3-stream hit', () => {
    let s = startPlaying({ seed: 1 });
    s = reduce(s, { type: 'morph', form: 'phoenix' });
    const bot = makeBot({
      id: 910,
      name: 'IceTarget',
      level: 8,
      head: { x: 3.4, z: 0 },
      spine: [{ x: 3.4, z: 0 }],
    });
    const hazard = makeHazard({ id: 911, cell: { x: 3.4, z: 1.0 }, hp: 3 });
    s = { ...s, bots: [bot], hazards: [hazard] };

    s = reduce(s, { type: 'shoot' });
    s = reduce(s, { type: 'projectile_step' }); // 1.15
    s = reduce(s, { type: 'projectile_step' }); // 2.30
    s = reduce(s, { type: 'projectile_step' }); // 3.45 -> center hits bot, side hits hazard

    const frozenBot = s.bots.find((b) => b.id === 910)!;
    expect(frozenBot.level).toBe(6);
    expect(frozenBot.frozenTicks).toBeGreaterThanOrEqual(24);
    expect(s.hazards.find((h) => h.id === 911)!.frozenTicks).toBeGreaterThanOrEqual(24);
    expect(
      s.events.some(
        (e) => e.kind === 'bot_hit' && e.messageVi === '❄️ Đóng băng IceTarget! Còn Lv.6',
      ),
    ).toBe(true);
  });

  it('pushes on Unicorn water piercing stream and prevents double-hits via hitBotIds', () => {
    let s = startPlaying({ seed: 1 });
    s = reduce(s, { type: 'morph', form: 'unicorn' });

    // Bot1 directly ahead; after 1.15 push it lands right in front of the piercing stream's next step.
    const bot1 = makeBot({
      id: 920,
      name: 'WaterBot1',
      level: 8,
      head: { x: 2.0, z: 0 },
      spine: [{ x: 2.0, z: 0 }],
    });
    const bot2 = makeBot({
      id: 921,
      name: 'WaterBot2',
      level: 7,
      head: { x: 5.5, z: 0 },
      spine: [{ x: 5.5, z: 0 }],
    });
    s = { ...s, bots: [bot1, bot2], hazards: [] };

    s = reduce(s, { type: 'shoot' });
    for (let i = 0; i < 6; i++) {
      s = reduce(s, { type: 'projectile_step' });
    }

    const after1 = s.bots.find((b) => b.id === 920)!;
    const after2 = s.bots.find((b) => b.id === 921)!;
    // Each bot hit exactly ONCE (-3 levels each), never double-tapped after knockback!
    expect(after1.level).toBe(5);
    expect(after1.chompedTicks).toBeGreaterThanOrEqual(14);
    expect(after1.head.x).toBeCloseTo(2.0 + 1.15, 4);

    expect(after2.level).toBe(4);
    expect(after2.head.x).toBeCloseTo(5.5 + 1.15, 4);
    expect(s.projectiles[0]!.hitBotIds).toEqual([920, 921]);
  });

  it('creates SilkWebZone on Spirit detonation, slows bots inside, caps at MAX_SILK_WEBS, and expires after SILK_WEB_DURATION_TICKS', () => {
    let s = startPlaying({ seed: 7 });
    s = reduce(s, { type: 'morph', form: 'spirit' });

    const botInside = makeBot({
      id: 930,
      name: 'SilkBot',
      level: 8,
      head: { x: 3.0, z: 0 },
      spine: [{ x: 3.0, z: 0 }],
    });
    const botOutside = makeBot({
      id: 931,
      name: 'FarBot',
      level: 8,
      head: { x: 25, z: 25 },
      spine: [{ x: 25, z: 25 }],
    });
    const survivingHazard = makeHazard({ id: 932, cell: { x: 3.2, z: 1.0 }, hp: 5 });
    s = { ...s, bots: [botInside, botOutside], hazards: [survivingHazard], bonusFood: null };

    s = reduce(s, { type: 'shoot' });
    s = reduce(s, { type: 'projectile_step' }); // 1.15
    s = reduce(s, { type: 'projectile_step' }); // 2.30 -> hits botInside (radius check) & detonates

    expect(s.silkWebs).toHaveLength(1);
    const web = s.silkWebs[0]!;
    expect(web.radius).toBe(SPIRIT_EXPLOSION_RADIUS);
    expect(web.ticksRemaining).toBe(SILK_WEB_DURATION_TICKS);
    expect(web.maxTicks).toBe(SILK_WEB_DURATION_TICKS);

    // Surviving hazard & bot in blast get entangled
    expect(s.hazards.find((h) => h.id === 932)!.frozenTicks).toBeGreaterThanOrEqual(24);
    const tangledBot = s.bots.find((b) => b.id === 930)!;
    expect(tangledBot.level).toBe(5);
    expect(tangledBot.frozenTicks).toBeGreaterThanOrEqual(26);
    expect(tangledBot.chompedTicks).toBeGreaterThanOrEqual(16);

    // Clear chompedTicks on bots, then verify stepSilkWebs applies sticky slow (>= 8) inside web only
    s = {
      ...s,
      bots: s.bots.map((b) => ({ ...b, chompedTicks: 0 })),
    };
    s = stepSilkWebs(s);
    expect(s.silkWebs[0]!.ticksRemaining).toBe(SILK_WEB_DURATION_TICKS - 1);
    expect(s.bots.find((b) => b.id === 930)!.chompedTicks).toBeGreaterThanOrEqual(8);
    expect(s.bots.find((b) => b.id === 931)!.chompedTicks).toBe(0);

    // Advance remaining SILK_WEB_DURATION_TICKS - 1 ticks via game ticks -> web expires cleanly
    for (let i = 0; i < SILK_WEB_DURATION_TICKS - 2; i++) {
      s = reduce(s, { type: 'tick' });
    }
    expect(s.silkWebs).toHaveLength(1);
    expect(s.silkWebs[0]!.ticksRemaining).toBe(1);

    s = reduce(s, { type: 'tick' });
    expect(s.silkWebs).toHaveLength(0);

    // Cap at MAX_SILK_WEBS (10) newest zones
    let capped = startPlaying({ seed: 7 });
    capped = reduce(capped, { type: 'morph', form: 'spirit' });
    capped = { ...capped, bots: [], hazards: [] };
    for (let i = 0; i < MAX_SILK_WEBS + 3; i++) {
      capped = { ...capped, shootCooldownMs: 0 };
      capped = reduce(capped, { type: 'shoot' });
      for (let stepIdx = 0; stepIdx < 10; stepIdx++) {
        capped = reduce(capped, { type: 'projectile_step' });
      }
    }
    expect(capped.silkWebs).toHaveLength(MAX_SILK_WEBS);
    expect(capped.silkWebs[0]!.id).toBe(4);
    expect(capped.silkWebs[MAX_SILK_WEBS - 1]!.id).toBe(MAX_SILK_WEBS + 3);
  });
});
