import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  isSurvivalChallenge,
  MAGIC_HIT_RADIUS,
  MAGIC_WARNING_TICKS,
  MAX_HOSTILE_PROJECTILES,
  reduce,
  stepBotMagic,
  SURVIVAL_HEARTS,
  type BotSnake,
  type GameState,
  type HostileProjectile,
} from '../../src/core';

function bot(id: number, x: number, z: number, extra: Partial<BotSnake> = {}): BotSnake {
  const head = { x, z };
  return {
    id,
    name: `Bot-${id}`,
    skin: 'dragon',
    isBoss: false,
    level: 5,
    maxLevel: 5,
    head,
    prevHead: head,
    heading: 0,
    spine: [head],
    prevSpine: [head],
    frozenTicks: 0,
    powerForm: 'dragon',
    ...extra,
  };
}

function survivalState(): GameState {
  const s = reduce(createInitialState({ ageProfile: 'age9', difficulty: 'hard', seed: 7 }), {
    type: 'start',
  });
  return { ...s, bots: [], roamingMonsters: [], hazards: [], quest: null, shelters: [] };
}

function proj(x: number, z: number, extra: Partial<HostileProjectile> = {}): HostileProjectile {
  return {
    id: 1,
    x,
    z,
    prevX: x,
    prevZ: z,
    dx: 1,
    dz: 0,
    kind: 'bolt',
    ownerBotId: 1,
    ttl: 40,
    maxTtl: 50,
    ...extra,
  };
}

/** Projectile one step before the player's head, flying into it. */
function incoming(s: GameState, extra: Partial<HostileProjectile> = {}): HostileProjectile {
  const h = s.snake[0]!;
  return proj(h.x - 0.4, h.z, extra);
}

function run(s: GameState, n: number): GameState {
  let cur = s;
  for (let i = 0; i < n; i++) cur = stepBotMagic(cur);
  return cur;
}

describe('survival challenge gating', () => {
  it('is on only for age9 + hard', () => {
    expect(isSurvivalChallenge({ ageProfile: 'age9', difficulty: 'hard' })).toBe(true);
    expect(isSurvivalChallenge({ ageProfile: 'age9', difficulty: 'normal' })).toBe(false);
    expect(isSurvivalChallenge({ ageProfile: 'age9', difficulty: 'easy' })).toBe(false);
    expect(isSurvivalChallenge({ ageProfile: 'age6', difficulty: 'hard' })).toBe(false);
  });

  it('gives 10 hearts at start and on reset only in survival', () => {
    const s = createInitialState({ ageProfile: 'age9', difficulty: 'hard' });
    expect(s.hearts).toBe(SURVIVAL_HEARTS);
    expect(s.maxHearts).toBe(SURVIVAL_HEARTS);
    expect(s.config.maxHearts).toBe(SURVIVAL_HEARTS);
    const r = reduce(reduce(s, { type: 'start' }), { type: 'reset' });
    expect(r.hearts).toBe(10);
    const other = reduce(s, { type: 'reset', difficulty: 'normal' });
    expect(other.hearts).toBe(3);
    expect(other.maxHearts).toBe(5);
    expect(createInitialState({ ageProfile: 'age6', difficulty: 'hard' }).maxHearts).toBe(4);
    expect(createInitialState({ ageProfile: 'age9', difficulty: 'normal' }).hearts).toBe(3);
  });

  it('adapts hearts when the age profile changes on the ready screen', () => {
    const hard6 = createInitialState({ ageProfile: 'age6', difficulty: 'hard' });
    expect(hard6.hearts).toBe(3);
    const to9 = reduce(hard6, { type: 'set_age_profile', ageProfile: 'age9' });
    expect(to9.hearts).toBe(10);
    expect(to9.maxHearts).toBe(10);
    const back = reduce(to9, { type: 'set_age_profile', ageProfile: 'age6' });
    expect(back.hearts).toBe(3);
    expect(back.maxHearts).toBe(4);
  });

  it('does nothing outside the challenge', () => {
    const s0 = reduce(createInitialState({ ageProfile: 'age6', difficulty: 'hard' }), {
      type: 'start',
    });
    const s = { ...s0, bots: [bot(1, 10, 0, { magicCooldownTicks: 0 })] };
    const out = run(s, 60);
    expect(out.hostileProjectiles).toHaveLength(0);
    expect(out.bots[0]!.magicWarningTicks).toBeUndefined();
    expect(stepBotMagic(s)).toBe(s);
  });
});

describe('bot casting', () => {
  it('telegraphs first, then casts at the player', () => {
    let s = survivalState();
    s = { ...s, bots: [bot(1, 15, 0, { magicCooldownTicks: 1 })] };
    s = stepBotMagic(s);
    expect(s.bots[0]!.magicWarningTicks).toBe(MAGIC_WARNING_TICKS);
    expect(s.hostileProjectiles).toHaveLength(0);
    const kinds: string[] = [];
    for (let i = 0; i < MAGIC_WARNING_TICKS; i++) {
      s = stepBotMagic(s);
      kinds.push(...s.events.map((e) => e.kind));
    }
    expect(s.hostileProjectiles.length).toBeGreaterThan(0);
    expect(kinds.some((k) => k === 'bot_shoot' || k === 'bot_spell_cast')).toBe(true);
    const p = s.hostileProjectiles[0]!;
    expect(p.dx).toBeLessThan(0); // flies toward the player at the origin
    expect(s.bots[0]!.magicWarningTicks).toBe(0);
    expect(s.bots[0]!.magicCooldownTicks).toBeGreaterThan(30);
  });

  it('is deterministic for the same seed', () => {
    const base = { ...survivalState(), bots: [bot(1, 15, 3, { magicCooldownTicks: 1 })] };
    expect(run(base, 40)).toEqual(run(base, 40));
  });

  it('skips far, frozen and sheltered bots, and a sheltered player', () => {
    const far = { ...survivalState(), bots: [bot(1, 40, 0, { magicCooldownTicks: 0 })] };
    expect(run(far, 30).bots[0]!.magicWarningTicks ?? 0).toBe(0);
    const frozen = {
      ...survivalState(),
      bots: [bot(1, 12, 0, { magicCooldownTicks: 0, frozenTicks: 20 })],
    };
    expect(run(frozen, 5).bots[0]!.magicWarningTicks ?? 0).toBe(0);
    const dome = {
      ...survivalState(),
      shelters: [
        { id: 's', kind: 'castle' as const, x: 12, z: 0, radius: 6, nameVi: 'x', colorHex: 0 },
      ],
      bots: [bot(1, 12, 0, { magicCooldownTicks: 0 })],
    };
    expect(run(dome, 5).bots[0]!.magicWarningTicks ?? 0).toBe(0);
    const playerSafe = {
      ...survivalState(),
      inShelter: true,
      bots: [bot(1, 12, 0, { magicCooldownTicks: 0 })],
    };
    expect(run(playerSafe, 5).bots[0]!.magicWarningTicks ?? 0).toBe(0);
  });

  it('cancels a telegraph when the player takes shelter', () => {
    let s: GameState = { ...survivalState(), bots: [bot(1, 12, 0, { magicCooldownTicks: 0 })] };
    s = stepBotMagic(s);
    expect(s.bots[0]!.magicWarningTicks).toBeGreaterThan(0);
    s = run({ ...s, inShelter: true }, 3);
    expect(s.bots[0]!.magicWarningTicks).toBe(0);
    expect(s.hostileProjectiles).toHaveLength(0);
  });

  it('boss casts the stronger spells', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed < 40; seed++) {
      let s: GameState = {
        ...survivalState(),
        rng: { seed },
        bots: [bot(1, 12, 0, { isBoss: true, level: 30, magicCooldownTicks: 0 })],
      };
      s = stepBotMagic(s);
      if (s.bots[0]!.magicSpell) kinds.add(s.bots[0]!.magicSpell);
    }
    expect(kinds.has('fire_spread')).toBe(true);
    expect(kinds.has('arcane_homing')).toBe(true);
  });

  it('caps simultaneous projectiles and concurrent telegraphs', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      bot(i + 1, 10 + i, (i % 3) - 1, { magicCooldownTicks: 0 }),
    );
    let s: GameState = { ...survivalState(), bots: many };
    s = stepBotMagic(s);
    expect(s.bots.filter((b) => (b.magicWarningTicks ?? 0) > 0).length).toBeLessThanOrEqual(4);
    const full = Array.from({ length: 40 }, (_, i) => proj(30 + i, 20, { id: i, ttl: 40 }));
    s = stepBotMagic({ ...s, hostileProjectiles: full.slice(0, MAX_HOSTILE_PROJECTILES) });
    expect(s.hostileProjectiles.length).toBeLessThanOrEqual(MAX_HOSTILE_PROJECTILES);
    for (let i = 0; i < 300; i++) {
      s = stepBotMagic(s);
      expect(s.hostileProjectiles.length).toBeLessThanOrEqual(MAX_HOSTILE_PROJECTILES);
    }
  });
});

describe('projectile hits', () => {
  it('costs one heart and grants grace so a volley cannot drain everything', () => {
    const s0 = survivalState();
    let s: GameState = {
      ...s0,
      hostileProjectiles: [incoming(s0), incoming(s0, { id: 2 }), incoming(s0, { id: 3 })],
    };
    s = stepBotMagic(s);
    expect(s.hearts).toBe(9);
    expect(s.invulnerableTicks).toBeGreaterThan(0);
    expect(s.events.map((e) => e.kind)).toContain('heart_lost');
    expect(s.events.map((e) => e.kind)).toContain('player_hit_by_magic');
    expect(s.hostileProjectiles.length).toBe(2); // passes through during grace
    s = stepBotMagic(s);
    expect(s.hearts).toBe(9);
  });

  it('is blocked by the shield', () => {
    const s0 = { ...survivalState(), shieldTicks: 10 };
    const s = stepBotMagic({ ...s0, hostileProjectiles: [incoming(s0)] });
    expect(s.hearts).toBe(10);
    expect(s.events.map((e) => e.kind)).toContain('shield_block');
    expect(s.hostileProjectiles).toHaveLength(0);
  });

  it('cannot hit an airborne butterfly or princess', () => {
    const s0 = survivalState();
    const fly = { ...s0, butterflyStage: 'butterfly' as const };
    expect(stepBotMagic({ ...fly, hostileProjectiles: [incoming(s0)] }).hearts).toBe(10);
    const pr = { ...s0, princessStage: 'princess' as const };
    expect(stepBotMagic({ ...pr, hostileProjectiles: [incoming(s0)] }).hearts).toBe(10);
  });

  it('ignores projectiles that miss', () => {
    const s0 = survivalState();
    const h = s0.snake[0]!;
    const s = stepBotMagic({
      ...s0,
      hostileProjectiles: [proj(h.x - 0.4, h.z + MAGIC_HIT_RADIUS + 2)],
    });
    expect(s.hearts).toBe(10);
    expect(s.hostileProjectiles).toHaveLength(1);
  });

  it('frost orb slows the player, then it wears off', () => {
    const s0 = survivalState();
    let s = stepBotMagic({ ...s0, hostileProjectiles: [incoming(s0, { kind: 'frost_orb' })] });
    expect(s.playerSlowTicks).toBeGreaterThan(20);
    const before = s.snake[0]!.x;
    s = reduce({ ...s, bots: [], hostileProjectiles: [] }, { type: 'tick' });
    const slowDist = Math.abs(s.snake[0]!.x - before);
    const fresh = reduce({ ...survivalState(), playerSlowTicks: 0 }, { type: 'tick' });
    expect(slowDist).toBeLessThan(Math.abs(fresh.snake[0]!.x - 0));
    s = run({ ...s, playerSlowTicks: 3 }, 5);
    expect(s.playerSlowTicks).toBe(0);
  });

  it('projectiles despawn on shelter dome entry and by ttl', () => {
    const s0 = {
      ...survivalState(),
      shelters: [
        { id: 's', kind: 'castle' as const, x: 20, z: 20, radius: 5, nameVi: 'x', colorHex: 0 },
      ],
    };
    const into = proj(14.8, 20, { ttl: 40 });
    expect(stepBotMagic({ ...s0, hostileProjectiles: [into] }).hostileProjectiles).toHaveLength(0);
    const old = proj(-30, -30, { ttl: 1 });
    expect(stepBotMagic({ ...s0, hostileProjectiles: [old] }).hostileProjectiles).toHaveLength(0);
  });

  it('arcane homing bends toward the player but slower than a dash', () => {
    const s0 = survivalState();
    const p = proj(-10, 8, { kind: 'arcane_homing', dx: 1, dz: 0, ttl: 80 });
    const s = stepBotMagic({ ...s0, hostileProjectiles: [p] });
    const q = s.hostileProjectiles[0]!;
    expect(q.dz).toBeLessThan(0);
    expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeLessThan(s0.config.baseSpeed * 1.65);
  });

  it('game over at the last heart clears projectiles', () => {
    const s0 = { ...survivalState(), hearts: 1 };
    const s = reduce({ ...s0, hostileProjectiles: [incoming(s0)] }, { type: 'tick' });
    expect(s.phase).toBe('gameover');
    expect(s.hearts).toBe(0);
    expect(s.hostileProjectiles).toHaveLength(0);
  });

  it('pause freezes projectiles and reset clears them', () => {
    const s0 = survivalState();
    const live = { ...s0, hostileProjectiles: [proj(20, 20)] };
    const paused = reduce(reduce(live, { type: 'pause' }), { type: 'tick' });
    expect(paused.hostileProjectiles[0]!.x).toBe(20);
    expect(reduce(live, { type: 'reset' }).hostileProjectiles).toHaveLength(0);
  });
});
