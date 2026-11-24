import { describe, expect, it, vi } from 'vitest';
import { Scene, Vector3 } from 'three';
import { Sfx } from '../../src/audio';
import {
  canTransformToPrincess,
  createInitialState,
  DEFAULT_SHELTERS,
  findTourShelter,
  isPrincessActive,
  princessOrbitRadius,
  princessTourHeading,
  PRINCESS_COOLDOWN_TICKS,
  PRINCESS_RETURN_TICKS,
  PRINCESS_TOUR_LAP_SCORE,
  PRINCESS_TRANSFORM_TICKS,
  reduce,
  stepPrincess,
  type BotSnake,
  type GameEventKind,
  type GameState,
  type MonsterEventState,
} from '../../src/core';
import {
  PrincessFairy3DView,
  princessHeadHeight,
  princessMorphFactor,
  princessStageProgress,
} from '../../src/rendering';

function startPlaying(opts?: Parameters<typeof createInitialState>[0]): GameState {
  const s = reduce(createInitialState(opts), { type: 'start' });
  return { ...s, bots: [], roamingMonsters: [], hazards: [], quest: null };
}

function makeBot(
  partial: Partial<BotSnake> & { id: number; head: { x: number; z: number } },
): BotSnake {
  return {
    id: partial.id,
    name: partial.name ?? `Bot-${partial.id}`,
    skin: partial.skin ?? 'dragon',
    isBoss: partial.isBoss ?? false,
    level: partial.level ?? 5,
    maxLevel: partial.maxLevel ?? partial.level ?? 5,
    head: partial.head,
    prevHead: partial.prevHead ?? partial.head,
    heading: partial.heading ?? 0,
    spine: partial.spine ?? [partial.head],
    prevSpine: partial.prevSpine ?? [partial.head],
    frozenTicks: partial.frozenTicks ?? 0,
    powerForm: partial.powerForm ?? 'dragon',
  };
}

function asPrincess(s: GameState): GameState {
  return {
    ...s,
    princessStage: 'princess',
    princessTicks: 0,
    princessMaxTicks: PRINCESS_TRANSFORM_TICKS,
    princessAltitude: 1,
  };
}

function tickN(s: GameState, n: number, seen?: Set<GameEventKind>): GameState {
  let cur = s;
  for (let i = 0; i < n; i++) {
    cur = reduce(cur, { type: 'tick' });
    if (seen) for (const e of cur.events) seen.add(e.kind);
  }
  return cur;
}

const WARNING_EVENT: MonsterEventState = {
  phase: 'warning',
  ticksRemaining: 150,
  maxTicks: 160,
  countdownSec: 8,
  progress: 0.05,
  monsterPos: { x: 200, z: 200 },
  monsterHeading: 0,
  monsterSpeed: 0.55,
  distanceToPlayer: 200,
  isChasing: true,
  isBlockedByShelter: false,
  targetShelterId: null,
};

describe('Fairy Princess transformation (core)', () => {
  it('initializes in snake form and allows transforming while playing', () => {
    const ready = createInitialState({ seed: 3 });
    expect(ready.princessStage).toBe('snake');
    expect(ready.princessAltitude).toBe(0);
    expect(ready.princessCooldownTicks).toBe(0);
    expect(canTransformToPrincess(ready)).toBe(false);
    expect(reduce(ready, { type: 'toggle_princess' })).toBe(ready);

    const s = startPlaying({ seed: 3 });
    expect(canTransformToPrincess(s)).toBe(true);
    expect(isPrincessActive(s)).toBe(false);
  });

  it('plays the full transform → princess → return → snake lifecycle with events and altitude', () => {
    let s = startPlaying({ seed: 4 });
    s = reduce(s, { type: 'toggle_princess' });
    expect(s.princessStage).toBe('transforming');
    expect(s.princessTicks).toBe(PRINCESS_TRANSFORM_TICKS);
    expect(s.events.some((e) => e.kind === 'princess_transform')).toBe(true);
    expect(isPrincessActive(s)).toBe(true);

    const seen = new Set<GameEventKind>();
    s = tickN(s, PRINCESS_TRANSFORM_TICKS / 2, seen);
    expect(s.princessStage).toBe('transforming');
    expect(s.princessAltitude).toBeGreaterThan(0.3);
    expect(s.princessAltitude).toBeLessThan(0.7);

    s = tickN(s, PRINCESS_TRANSFORM_TICKS / 2, seen);
    expect(s.princessStage).toBe('princess');
    expect(s.princessAltitude).toBe(1);
    expect(seen.has('princess_reveal')).toBe(true);

    s = reduce(s, { type: 'toggle_princess' });
    expect(s.princessStage).toBe('returning');
    expect(s.events.some((e) => e.kind === 'princess_return')).toBe(true);

    s = tickN(s, PRINCESS_RETURN_TICKS);
    expect(s.princessStage).toBe('snake');
    expect(s.princessAltitude).toBe(0);
    expect(s.princessCooldownTicks).toBe(PRINCESS_COOLDOWN_TICKS);

    // Cooldown blocks an immediate re-transform
    expect(reduce(s, { type: 'toggle_princess' }).princessStage).toBe('snake');
    s = tickN(s, PRINCESS_COOLDOWN_TICKS);
    expect(s.princessCooldownTicks).toBe(0);
    expect(reduce(s, { type: 'toggle_princess' }).princessStage).toBe('transforming');
  });

  it('cannot transform during a monster warning or while in butterfly form', () => {
    const base = startPlaying({ seed: 5 });
    const warning = { ...base, monsterEvent: WARNING_EVENT };
    expect(canTransformToPrincess(warning)).toBe(false);
    expect(reduce(warning, { type: 'toggle_princess' }).princessStage).toBe('snake');

    const flying = { ...base, butterflyStage: 'butterfly' as const, butterflyAltitude: 1 };
    expect(reduce(flying, { type: 'toggle_princess' }).princessStage).toBe('snake');
  });

  it('auto-returns to snake form when a monster warning begins', () => {
    const s = asPrincess(startPlaying({ seed: 6 }));
    const head = s.snake[0]!;
    const next = stepPrincess({ ...s, monsterEvent: WARNING_EVENT }, head);
    expect(next.princessStage).toBe('returning');
    expect(next.events.some((e) => e.kind === 'princess_return')).toBe(true);

    // Interrupting mid-transform resumes smoothly from the current altitude
    const mid = {
      ...s,
      princessStage: 'transforming' as const,
      princessTicks: 16,
      princessAltitude: 0.5,
      monsterEvent: WARNING_EVENT,
    };
    const midNext = stepPrincess(mid, head);
    expect(midNext.princessStage).toBe('returning');
    expect(midNext.princessTicks).toBe(Math.round(PRINCESS_RETURN_TICKS * 0.5));
  });

  it('flies safely above strong bots without losing hearts and never chomps weak bots', () => {
    let s = asPrincess(startPlaying({ seed: 7 }));
    const head = s.snake[0]!;
    const strong = makeBot({ id: 901, head: { x: head.x + 0.5, z: head.z }, level: 40 });
    const weak = makeBot({ id: 902, head: { x: head.x + 0.4, z: head.z + 0.2 }, level: 1 });
    s = { ...s, bots: [strong, weak], shieldTicks: 0, invulnerableTicks: 0 };
    const heartsBefore = s.hearts;
    const next = reduce(s, { type: 'tick' });
    expect(next.phase).toBe('playing');
    expect(next.hearts).toBe(heartsBefore);
    expect(next.botsEaten).toBe(s.botsEaten);
    expect(next.events.some((e) => e.kind === 'bot_chomp' || e.kind === 'eaten_by_bot')).toBe(
      false,
    );
  });

  it('ignores shooting, morphing and fairy skills while transformed', () => {
    const s = asPrincess(startPlaying({ seed: 8 }));
    expect(reduce(s, { type: 'shoot' })).toBe(s);
    expect(reduce(s, { type: 'morph', form: 'phoenix' })).toBe(s);
    expect(reduce(s, { type: 'cast_fairy_skill', skill: 'fire' })).toBe(s);
    expect(reduce(s, { type: 'set_butterfly_hold', active: true })).toBe(s);
  });

  it('auto-orbits a castle when not steering, emits tour start and rewards completed laps', () => {
    const castle = DEFAULT_SHELTERS[0]!;
    const orbitR = princessOrbitRadius(castle);
    let s = asPrincess(startPlaying({ seed: 9 }));
    s = {
      ...s,
      snake: [{ x: castle.x + orbitR, z: castle.z }],
      prevSnake: [{ x: castle.x + orbitR, z: castle.z }],
      heading: Math.PI / 2,
      targetHeading: null,
      guardianFairy: { ...s.guardianFairy, ticksUntilNextVisit: 99999 },
    };
    expect(findTourShelter(s, s.snake[0]!)?.id).toBe(castle.id);
    expect(princessTourHeading(s, s.snake[0]!)).not.toBeNull();

    const scoreBefore = s.score;
    const seen = new Set<GameEventKind>();
    s = tickN(s, 260, seen);
    expect(seen.has('princess_tour_start')).toBe(true);
    expect(seen.has('princess_tour_lap')).toBe(true);
    expect(s.princessTourShelterId).toBe(castle.id);
    expect(s.princessTourLaps).toBeGreaterThanOrEqual(1);
    expect(s.score).toBeGreaterThanOrEqual(scoreBefore + PRINCESS_TOUR_LAP_SCORE);

    const head = s.snake[0]!;
    const dist = Math.hypot(head.x - castle.x, head.z - castle.z);
    expect(dist).toBeGreaterThan(orbitR - 3);
    expect(dist).toBeLessThan(orbitR + 3);
  });

  it('lets player steering override the automatic castle tour', () => {
    const castle = DEFAULT_SHELTERS[0]!;
    const s = {
      ...asPrincess(startPlaying({ seed: 10 })),
      snake: [{ x: castle.x + 10, z: castle.z }],
      targetHeading: 0,
    };
    expect(princessTourHeading(s, s.snake[0]!)).toBeNull();
    const far = { ...s, targetHeading: null, snake: [{ x: 90, z: 90 }] };
    expect(findTourShelter(far, far.snake[0]!)).toBeNull();
  });
});

describe('Fairy Princess rendering & audio', () => {
  it('computes smooth morph factors across stages', () => {
    const s = startPlaying({ seed: 11 });
    expect(princessMorphFactor(s)).toBe(0);
    const transforming = {
      ...s,
      princessStage: 'transforming' as const,
      princessTicks: 16,
      princessMaxTicks: 32,
    };
    expect(princessMorphFactor(transforming, 0)).toBeCloseTo(0.5, 5);
    expect(princessStageProgress(transforming, 0)).toBeCloseTo(0.5, 5);
    expect(princessMorphFactor(asPrincess(s))).toBe(1);
    const returning = {
      ...s,
      princessStage: 'returning' as const,
      princessTicks: 6,
      princessMaxTicks: 24,
    };
    expect(princessMorphFactor(returning, 0)).toBeCloseTo(0.25, 5);
    expect(princessHeadHeight(1)).toBeGreaterThan(princessHeadHeight(0));
  });

  it('renders the princess and transformation effects through every stage and disposes cleanly', () => {
    const scene = new Scene();
    const view = new PrincessFairy3DView(scene);
    const head = new Vector3(3, 0, 4);
    const base = startPlaying({ seed: 12 });

    view.draw(0, 0.016, base, head, 1);
    expect(view.isVisible()).toBe(false);

    for (let t = 32; t >= 1; t -= 4) {
      const transforming = {
        ...base,
        princessStage: 'transforming' as const,
        princessTicks: t,
        princessMaxTicks: 32,
      };
      expect(() => view.draw(1 + t * 0.05, 0.016, transforming, head, 0.5)).not.toThrow();
    }

    const princess = asPrincess(base);
    for (let i = 0; i < 20; i++) {
      view.draw(3 + i * 0.05, 0.05, princess, head, 0.5);
    }
    expect(view.isVisible()).toBe(true);
    const pos = view.getPrincessWorldPosition(new Vector3());
    expect(pos.x).toBeCloseTo(3, 5);
    expect(pos.y).toBeGreaterThan(2);

    const returning = {
      ...base,
      princessStage: 'returning' as const,
      princessTicks: 4,
      princessMaxTicks: 24,
    };
    expect(() => view.draw(5, 0.016, returning, head, 0.5)).not.toThrow();
    expect(() => view.dispose()).not.toThrow();
  });

  it('plays princess audio cues cleanly in headless Sfx', () => {
    const sfx = new Sfx(true);
    const spy = vi.spyOn(sfx, 'playPrincessReveal');
    expect(() => sfx.playPrincessTransform()).not.toThrow();
    expect(() => sfx.playPrincessReveal()).not.toThrow();
    expect(() => sfx.playPrincessReturn()).not.toThrow();
    expect(() => sfx.playPrincessTourLap()).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    sfx.dispose();
  });
});
