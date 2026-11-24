import { describe, expect, it } from 'vitest';
import {
  createInitialState,
  DEFAULT_SHELTERS,
  reduce,
  SHELTER_HEAL_FIRST_TICK,
  SHELTER_HEAL_INTERVAL_TICKS,
  type GameState,
} from '../../src/core';

function sheltered(opts: Parameters<typeof createInitialState>[0], hearts: number): GameState {
  const castle = DEFAULT_SHELTERS[0]!;
  const s = reduce(createInitialState(opts), { type: 'start' });
  return {
    ...s,
    bots: [],
    orbs: [],
    roamingMonsters: [],
    hazards: [],
    quest: null,
    hearts,
    snake: [{ x: castle.x, z: castle.z }],
    prevSnake: [{ x: castle.x, z: castle.z }],
    heading: 0,
    targetHeading: null,
  };
}

function heartsOverTime(s0: GameState, ticks: number): { hearts: number; toasts: number[] }[] {
  const c = DEFAULT_SHELTERS[0]!;
  let s = s0;
  const out: { hearts: number; toasts: number[] }[] = [];
  const toasts: number[] = [];
  for (let i = 0; i < ticks; i++) {
    s = reduce(s, { type: 'tick' });
    if (s.inShelter) {
      // Stay parked at the shelter centre so the whole rest period is spent inside.
      s = { ...s, snake: [{ x: c.x, z: c.z }], prevSnake: [{ x: c.x, z: c.z }] };
    }
    for (const e of s.events) if (e.kind === 'heart_gained') toasts.push(e.messageVi ? 1 : 0);
    out.push({ hearts: s.hearts, toasts: [...toasts] });
  }
  return out;
}

describe('shelter heart regeneration', () => {
  it('heals first at tick 15 then every 20 ticks until max (normal mode)', () => {
    const tl = heartsOverTime(sheltered({ seed: 3 }, 1), 120);
    const first = tl.findIndex((x) => x.hearts > 1) + 1;
    expect(first).toBeGreaterThanOrEqual(SHELTER_HEAL_FIRST_TICK - 1);
    expect(first).toBeLessThanOrEqual(SHELTER_HEAL_FIRST_TICK + 1);
    expect(tl[first - 1]!.hearts).toBe(2);
    const second = tl.findIndex((x) => x.hearts > 2) + 1;
    expect(second - first).toBe(SHELTER_HEAL_INTERVAL_TICKS);
    expect(tl[tl.length - 1]!.hearts).toBe(5); // capped at maxHearts
  });

  it('only the first heal of a visit carries a toast message', () => {
    const tl = heartsOverTime(sheltered({ seed: 3 }, 1), 100);
    const t = tl[tl.length - 1]!.toasts;
    expect(t.length).toBeGreaterThan(2);
    expect(t[0]).toBe(1);
    expect(t.slice(1).every((x) => x === 0)).toBe(true);
  });

  it('refills a survival-challenge boy to 10 hearts in a few seconds', () => {
    const s = sheltered({ ageProfile: 'age9', difficulty: 'hard', seed: 3 }, 2);
    expect(s.maxHearts).toBe(10);
    const tl = heartsOverTime(s, 15 + 20 * 8 + 2);
    expect(tl[tl.length - 1]!.hearts).toBe(10);
    expect(tl[40]!.hearts).toBeLessThan(10); // not instant
  });

  it('does not heal outside a shelter', () => {
    const s = { ...sheltered({ seed: 3 }, 2), snake: [{ x: 200, z: 200 }] };
    const tl = heartsOverTime(s, 80);
    expect(tl[tl.length - 1]!.hearts).toBe(2);
  });
});
