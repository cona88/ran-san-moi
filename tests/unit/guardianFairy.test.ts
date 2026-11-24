import { describe, expect, it, vi } from 'vitest';
import { Scene, Vector3 } from 'three';
import { Sfx } from '../../src/audio';
import {
  createInitialGuardianFairy,
  createInitialState,
  DEFAULT_SHELTERS,
  FAIRY_ARRIVE_TICKS,
  FAIRY_DEPART_TICKS,
  FAIRY_ESCORT_TICKS,
  FAIRY_FIRST_VISIT_TICKS,
  FAIRY_MIN_MOVE_DISTANCE,
  FAIRY_PROTECT_RADIUS,
  FAIRY_PULSE_INTERVAL_TICKS,
  FAIRY_VISIT_INTERVAL_MAX_TICKS,
  FAIRY_VISIT_INTERVAL_MIN_TICKS,
  GUARDIAN_FAIRY_KINDS,
  GUARDIAN_FAIRY_METADATA,
  reduce,
  spawnGuardianFairyNow,
  stepGuardianFairy,
  type BotSnake,
  type GameState,
  type RoamingMonster,
} from '../../src/core';
import { GuardianFairy3DView } from '../../src/rendering';

function startPlaying(opts?: Parameters<typeof createInitialState>[0]): GameState {
  return reduce(createInitialState(opts), { type: 'start' });
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

describe('Guardian Fairy Visitor System (Core)', () => {
  it('initializes in idle state with expected countdown and metadata', () => {
    const initial = createInitialGuardianFairy();
    expect(initial.phase).toBe('idle');
    expect(initial.ticksUntilNextVisit).toBe(FAIRY_FIRST_VISIT_TICKS);
    expect(initial.distanceTraveled).toBe(0);
    expect(initial.visitCount).toBe(0);

    for (const kind of GUARDIAN_FAIRY_KINDS) {
      const meta = GUARDIAN_FAIRY_METADATA[kind];
      expect(meta.nameVi).toBeTruthy();
      expect(meta.emoji).toBeTruthy();
      expect(meta.blessingVi).toBeTruthy();
      expect(meta.colorHex).toBeGreaterThan(0);
    }

    const s = startPlaying({ seed: 7 });
    expect(s.guardianFairy.phase).toBe('idle');
    expect(s.guardianFairy.ticksUntilNextVisit).toBe(FAIRY_FIRST_VISIT_TICKS);
    expect(s.shelterHealUsedId).toBeNull();
  });

  it('requires movement distance before spawning and is deterministic across seeds', () => {
    let s1 = startPlaying({ seed: 11 });
    s1 = {
      ...s1,
      bots: [],
      guardianFairy: { ...s1.guardianFairy, ticksUntilNextVisit: 1, distanceTraveled: 10 },
    };

    // Moving by 0 does not reach FAIRY_MIN_MOVE_DISTANCE
    const noMove = stepGuardianFairy(s1, 0);
    expect(noMove.guardianFairy.phase).toBe('idle');
    expect(noMove.guardianFairy.ticksUntilNextVisit).toBe(0);

    // Reaching FAIRY_MIN_MOVE_DISTANCE triggers arrival deterministically
    const triggeredA = stepGuardianFairy(noMove, FAIRY_MIN_MOVE_DISTANCE);
    const triggeredB = stepGuardianFairy(noMove, FAIRY_MIN_MOVE_DISTANCE);
    expect(triggeredA.guardianFairy.phase).toBe('arriving');
    expect(triggeredA.guardianFairy.kind).toBe(triggeredB.guardianFairy.kind);
    expect(triggeredA.guardianFairy.visitCount).toBe(1);
    expect(triggeredA.events.some((e) => e.kind === 'fairy_visit_start')).toBe(true);
  });

  it('hurries visit countdown when player has 1 heart or monster warning is active', () => {
    let s = startPlaying({ seed: 5 });
    s = {
      ...s,
      elapsedTicks: 130,
      hearts: 1,
      guardianFairy: {
        ...s.guardianFairy,
        ticksUntilNextVisit: 20,
        distanceTraveled: 10,
      },
    };
    const next = stepGuardianFairy(s, 0.5);
    expect(next.guardianFairy.ticksUntilNextVisit).toBe(18);
  });

  it('completes full lifecycle idle -> arriving -> escorting -> departing -> idle with blessing pulses', () => {
    let s = startPlaying({ seed: 3 });
    s = { ...s, bots: [], orbs: [] };
    s = spawnGuardianFairyNow(s, 'starlight');
    expect(s.guardianFairy.phase).toBe('arriving');
    expect(s.guardianFairy.ticksRemaining).toBe(FAIRY_ARRIVE_TICKS);

    // Step through arrival
    for (let i = 0; i < FAIRY_ARRIVE_TICKS; i++) {
      s = stepGuardianFairy({ ...s, elapsedTicks: s.elapsedTicks + 1 }, 0.42);
    }
    expect(s.guardianFairy.phase).toBe('escorting');
    expect(s.guardianFairy.ticksRemaining).toBe(FAIRY_ESCORT_TICKS);

    // Step through escort and count fairy_blessing pulses
    let blessingPulses = 0;
    for (let i = 0; i < FAIRY_ESCORT_TICKS; i++) {
      s = stepGuardianFairy({ ...s, elapsedTicks: s.elapsedTicks + 1, events: [] }, 0.42);
      if (s.events.some((e) => e.kind === 'fairy_blessing')) {
        blessingPulses++;
      }
    }
    expect(blessingPulses).toBe(Math.floor(FAIRY_ESCORT_TICKS / FAIRY_PULSE_INTERVAL_TICKS));
    expect(s.guardianFairy.phase).toBe('departing');
    expect(s.guardianFairy.ticksRemaining).toBe(FAIRY_DEPART_TICKS);
    expect(s.events.some((e) => e.kind === 'fairy_visit_end')).toBe(true);

    // Step through departure back to idle
    for (let i = 0; i < FAIRY_DEPART_TICKS; i++) {
      s = stepGuardianFairy({ ...s, elapsedTicks: s.elapsedTicks + 1, events: [] }, 0.42);
    }
    expect(s.guardianFairy.phase).toBe('idle');
    expect(s.guardianFairy.visitCount).toBe(1);
    expect(s.guardianFairy.distanceTraveled).toBe(0);
    expect(s.guardianFairy.ticksUntilNextVisit).toBeGreaterThanOrEqual(
      FAIRY_VISIT_INTERVAL_MIN_TICKS,
    );
    expect(s.guardianFairy.ticksUntilNextVisit).toBeLessThanOrEqual(FAIRY_VISIT_INTERVAL_MAX_TICKS);
  });

  it('applies distinct welcome blessings for blossom, starlight, crystal, and rainbow fairies', () => {
    const base = { ...startPlaying({ seed: 9 }), bots: [] };

    // 1. Blossom heals +1 heart when hurt and blooms 3 flowers
    const hurt = { ...base, hearts: 2, gardenFlowers: [] };
    const blossomRes = spawnGuardianFairyNow(hurt, 'blossom');
    expect(blossomRes.hearts).toBe(3);
    expect(blossomRes.shieldTicks).toBeGreaterThanOrEqual(90);
    expect(blossomRes.gardenFlowers).toHaveLength(3);
    expect(blossomRes.events.some((e) => e.kind === 'heart_gained')).toBe(true);

    // Blossom at full hearts grants +120 score instead
    const fullHearts = { ...base, hearts: base.maxHearts, score: 100 };
    expect(spawnGuardianFairyNow(fullHearts, 'blossom').score).toBe(220);

    // 2. Starlight fills butterflyCharge, extends magnet booster, and scatters 6 orbs
    const starRes = spawnGuardianFairyNow({ ...base, butterflyCharge: 10, orbs: [] }, 'starlight');
    expect(starRes.butterflyCharge).toBe(100);
    expect(starRes.boosters.magnet.activeTicks).toBeGreaterThanOrEqual(120);
    expect(starRes.orbs).toHaveLength(6);

    // 3. Crystal freezes nearby bots and roaming monsters within 18 units
    const nearBot = makeBot({ id: 501, head: { x: 8, z: 0 }, level: 9, frozenTicks: 0 });
    const nearMonster: RoamingMonster = {
      id: 91,
      kind: 'sea_beast',
      x: 0,
      z: 10,
      heading: 0,
      speed: 0.2,
      hp: 2,
      frozenTicks: 0,
    };
    const crystalRes = spawnGuardianFairyNow(
      { ...base, bots: [nearBot], roamingMonsters: [nearMonster] },
      'crystal',
    );
    expect(crystalRes.bots[0]!.frozenTicks).toBeGreaterThanOrEqual(80);
    expect(crystalRes.roamingMonsters[0]!.frozenTicks).toBeGreaterThanOrEqual(80);

    // 4. Rainbow refills dashEnergy, grants invulnerability, and repels stronger bots within 12 units
    const strongBot = makeBot({ id: 502, head: { x: 5, z: 0 }, level: base.level + 6 });
    const rainbowRes = spawnGuardianFairyNow(
      { ...base, dashEnergy: 20, bots: [strongBot] },
      'rainbow',
    );
    expect(rainbowRes.dashEnergy).toBe(100);
    expect(rainbowRes.invulnerableTicks).toBeGreaterThanOrEqual(70);
    expect(
      Math.hypot(rainbowRes.bots[0]!.head.x, rainbowRes.bots[0]!.head.z),
    ).toBeGreaterThanOrEqual(13.5);
  });

  it('actively protects the snake during escort by repelling stronger bots and chilling nearby monsters', () => {
    let s = startPlaying({ seed: 12 });
    const strongBot = makeBot({
      id: 701,
      head: { x: 4, z: 0 },
      level: s.level + 5,
    });
    const closeMonster: RoamingMonster = {
      id: 77,
      kind: 'candy_troll',
      x: 0,
      z: 5,
      heading: 0,
      speed: 0.2,
      hp: 2,
      frozenTicks: 0,
    };

    s = {
      ...s,
      bots: [strongBot],
      roamingMonsters: [closeMonster],
      shieldTicks: 0,
    };
    s = spawnGuardianFairyNow(s, 'blossom');
    // Fast-forward to escorting phase
    s = {
      ...s,
      guardianFairy: {
        ...s.guardianFairy,
        phase: 'escorting',
        ticksRemaining: 100,
      },
    };

    const next = stepGuardianFairy(s, 0.42);
    expect(next.shieldTicks).toBeGreaterThanOrEqual(20);
    expect(Math.hypot(next.bots[0]!.head.x, next.bots[0]!.head.z)).toBeGreaterThan(
      FAIRY_PROTECT_RADIUS,
    );
    expect(Math.hypot(next.roamingMonsters[0]!.x, next.roamingMonsters[0]!.z)).toBeGreaterThan(
      FAIRY_PROTECT_RADIUS,
    );
    expect(next.roamingMonsters[0]!.frozenTicks).toBeGreaterThanOrEqual(45);
  });

  it('heals +1 missing heart after resting 40 ticks inside a Royal Castle and resets on exit', () => {
    const castle = DEFAULT_SHELTERS[0]!;
    let s = startPlaying({ seed: 15 });
    s = {
      ...s,
      bots: [],
      orbs: [],
      hearts: 2,
      shelteredTicks: 39,
      inShelter: true,
      currentShelterId: castle.id,
      shelterHealUsedId: null,
      snake: [{ x: 0, z: 0 }],
      prevSnake: [{ x: 0, z: 0 }],
      heading: 0,
    };

    // Tick 40 inside castle heals +1 heart and marks shelterHealUsedId
    s = reduce(s, { type: 'tick' });
    expect(s.shelteredTicks).toBe(40);
    expect(s.hearts).toBe(3);
    expect(s.shelterHealUsedId).toBe(castle.id);
    expect(s.events.some((e) => e.kind === 'heart_gained')).toBe(true);

    // Exiting shelter resets shelterHealUsedId to null
    s = {
      ...s,
      snake: [{ x: 40, z: 40 }],
      prevSnake: [{ x: 40, z: 40 }],
    };
    s = reduce(s, { type: 'tick' });
    expect(s.inShelter).toBe(false);
    expect(s.shelterHealUsedId).toBeNull();
  });
});

describe('GuardianFairy3DView & Audio Integration', () => {
  it('renders and animates all 4 fairy phases and kinds cleanly and disposes without leaks', () => {
    const scene = new Scene();
    const view = new GuardianFairy3DView(scene);
    const headVec = new Vector3(5, 0, 5);
    const s = startPlaying({ seed: 21 });

    // Idle hides fairy & blessing ring
    view.sync(s);
    view.draw(0.1, 0.016, s, headVec);
    const internals = view as unknown as {
      fairyGroup: { visible: boolean };
      playerBlessingGroup: { visible: boolean };
    };
    expect(internals.fairyGroup.visible).toBe(false);
    expect(internals.playerBlessingGroup.visible).toBe(false);

    // Test all 4 kinds across arriving & escorting
    for (const kind of GUARDIAN_FAIRY_KINDS) {
      const arriving = spawnGuardianFairyNow(s, kind);
      view.sync(arriving);
      view.draw(0.5, 0.016, arriving, headVec);
      expect(internals.fairyGroup.visible).toBe(true);

      const escorting: GameState = {
        ...arriving,
        guardianFairy: {
          ...arriving.guardianFairy,
          phase: 'escorting',
          ticksRemaining: 120,
          altitude: 1.0,
        },
      };
      view.sync(escorting);
      view.draw(1.2, 0.016, escorting, headVec);
      expect(internals.fairyGroup.visible).toBe(true);
      expect(internals.playerBlessingGroup.visible).toBe(true);
    }

    expect(() => view.dispose()).not.toThrow();
  });

  it('plays fairy visitor audio cues cleanly in headless Sfx', () => {
    const sfx = new Sfx(true);
    const startSpy = vi.spyOn(sfx, 'playFairyVisitStart');
    const blessSpy = vi.spyOn(sfx, 'playFairyBlessing');
    const endSpy = vi.spyOn(sfx, 'playFairyVisitEnd');

    expect(() => sfx.playFairyVisitStart()).not.toThrow();
    expect(() => sfx.playFairyBlessing()).not.toThrow();
    expect(() => sfx.playFairyVisitEnd()).not.toThrow();
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(blessSpy).toHaveBeenCalledTimes(1);
    expect(endSpy).toHaveBeenCalledTimes(1);

    sfx.dispose();
  });
});
