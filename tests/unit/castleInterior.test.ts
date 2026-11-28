import { describe, expect, it } from 'vitest';
import {
  CASTLE_FIRST_VISIT_SCORE,
  CASTLE_FIRST_VISIT_XP,
  CASTLE_ROYAL_SETS,
  createInitialState,
  DEFAULT_SHELTERS,
  detectInteriorZone,
  INTERIOR_BOUNDS,
  INTERIOR_DASH_SPEED,
  INTERIOR_SPOTS,
  INTERIOR_WALK_SPEED,
  reduce,
  type GameState,
  type ShelterKind,
} from '../../src/core';

function startPlaying(opts?: Parameters<typeof createInitialState>[0]): GameState {
  const s = reduce(createInitialState({ seed: 19, ...opts }), { type: 'start' });
  // Advance 1 tick at (0, 0) so inShelter / currentShelterId ('shelter-castle-center') are latched
  return reduce(
    {
      ...s,
      bots: [],
      orbs: [],
      roamingMonsters: [],
      hazards: [],
      quest: null,
    },
    { type: 'tick' },
  );
}

describe('Interactive Castle Interior World & Royal Wardrobe (src/core/castleInterior.ts)', () => {
  it('defines all 7 luxury CastleRoyalSets, unique SignatureWeapons, and valid INTERIOR_SPOTS', () => {
    const kinds: readonly ShelterKind[] = [
      'castle',
      'mermaid',
      'candy',
      'blossom',
      'crystal',
      'starlight',
      'mushroom',
    ];
    const weaponKinds = new Set<string>();
    for (const k of kinds) {
      const set = CASTLE_ROYAL_SETS[k];
      expect(set.kind).toBe(k);
      expect(set.themeTitleVi.length).toBeGreaterThan(4);
      expect(set.interiorSubtitleVi.length).toBeGreaterThan(8);
      expect(set.outfitNameVi.length).toBeGreaterThan(4);
      expect(set.makeupNameVi.length).toBeGreaterThan(4);
      expect(set.weaponNameVi.length).toBeGreaterThan(4);
      weaponKinds.add(set.weaponKind);
    }
    expect(weaponKinds.size).toBe(7);

    for (const spot of Object.values(INTERIOR_SPOTS)) {
      expect(Math.abs(spot.x)).toBeLessThanOrEqual(INTERIOR_BOUNDS.halfW);
      expect(Math.abs(spot.z)).toBeLessThanOrEqual(INTERIOR_BOUNDS.halfD);
    }
  });

  it('initializes castleInterior as null and empty wardrobe, and resets cleanly', () => {
    const ready = createInitialState();
    expect(ready.castleInterior).toBeNull();
    expect(ready.wardrobe).toEqual({
      equippedOutfit: null,
      equippedMakeup: null,
      equippedWeapon: null,
      unlockedKinds: [],
      visitedInteriorIds: [],
    });

    let s = startPlaying();
    s = reduce(s, { type: 'enter_castle' });
    expect(s.castleInterior).not.toBeNull();
    s = reduce(s, { type: 'equip_castle_item', slot: 'outfit', kind: 'castle' });
    expect(s.wardrobe.equippedOutfit).toBe('castle');

    const reset = reduce(s, { type: 'reset' });
    expect(reset.castleInterior).toBeNull();
    expect(reset.wardrobe.equippedOutfit).toBeNull();
    expect(reset.wardrobe.unlockedKinds).toEqual([]);
  });

  it('blocks enter_castle outside playing phase or far from any shelter without shelterId', () => {
    const ready = createInitialState();
    expect(reduce(ready, { type: 'enter_castle' }).castleInterior).toBeNull();

    const farOut: GameState = {
      ...startPlaying(),
      inShelter: false,
      currentShelterId: null,
      snake: [{ x: 95, z: 95 }],
    };
    expect(reduce(farOut, { type: 'enter_castle' }).castleInterior).toBeNull();
  });

  it('enters nearest shelter within radius + 3 even when just outside dome boundary', () => {
    const east = DEFAULT_SHELTERS.find((sh) => sh.id === 'shelter-crystal-east')!;
    const nearDoor: GameState = {
      ...startPlaying(),
      inShelter: false,
      currentShelterId: null,
      snake: [{ x: east.x + east.radius + 2.2, z: east.z }],
    };
    const entered = reduce(nearDoor, { type: 'enter_castle' });
    expect(entered.castleInterior).not.toBeNull();
    expect(entered.castleInterior!.shelterId).toBe(east.id);
    expect(entered.castleInterior!.shelterKind).toBe('crystal');
  });

  it('awards first-visit bonus per distinct shelter ID while deduplicating unlockedKinds', () => {
    let s = startPlaying();
    const s0 = s.score;
    s = reduce(s, { type: 'enter_castle', shelterId: 'shelter-mushroom-north' });
    expect(s.score).toBe(s0 + CASTLE_FIRST_VISIT_SCORE);
    expect(s.wardrobe.unlockedKinds).toEqual(['mushroom']);

    s = reduce(s, { type: 'exit_castle' });
    const s1 = s.score;
    s = reduce(s, { type: 'enter_castle', shelterId: 'shelter-mushroom-south' });
    expect(s.score).toBe(s1 + CASTLE_FIRST_VISIT_SCORE);
    expect(s.wardrobe.visitedInteriorIds).toEqual([
      'shelter-mushroom-north',
      'shelter-mushroom-south',
    ]);
    expect(s.wardrobe.unlockedKinds).toEqual(['mushroom']);
  });

  it('grants first-visit +150 score & +10 XP, unlocks wardrobe set without touching RNG, and avoids duplicate bonus on revisit', () => {
    const base = startPlaying();
    const rngBefore = base.rng;
    const scoreBefore = base.score;

    const entered = reduce(base, { type: 'enter_castle', shelterId: 'shelter-mermaid-sw' });
    expect(entered.castleInterior).not.toBeNull();
    expect(entered.castleInterior!.shelterId).toBe('shelter-mermaid-sw');
    expect(entered.castleInterior!.shelterKind).toBe('mermaid');
    expect(entered.castleInterior!.pos).toEqual({ x: 0, z: 16 });
    expect(entered.castleInterior!.prevPos).toEqual({ x: 0, z: 16 });
    expect(entered.castleInterior!.heading).toBeCloseTo(-Math.PI / 2, 5);
    expect(entered.wardrobe.visitedInteriorIds).toEqual(['shelter-mermaid-sw']);
    expect(entered.wardrobe.unlockedKinds).toEqual(['mermaid']);
    expect(entered.score).toBe(scoreBefore + CASTLE_FIRST_VISIT_SCORE);
    expect(entered.rng).toEqual(rngBefore);
    expect(entered.events.some((e) => e.kind === 'castle_enter_interior')).toBe(true);

    // Exit and re-enter the same palace -> no duplicate +150 score
    const exited = reduce(entered, { type: 'exit_castle' });
    const scoreAfterExit = exited.score;
    const revisited = reduce(exited, { type: 'enter_castle', shelterId: 'shelter-mermaid-sw' });
    expect(revisited.score).toBe(scoreAfterExit);
    expect(revisited.wardrobe.visitedInteriorIds).toEqual(['shelter-mermaid-sw']);
    expect(revisited.wardrobe.unlockedKinds).toEqual(['mermaid']);
  });

  it('levels up and refreshes leaderboard when first-visit XP crosses level threshold', () => {
    const base: GameState = {
      ...startPlaying(),
      level: 5,
      xp: 8, // threshold at level 5 is 15; +10 XP -> 18 >= 15 -> level 6
    };
    const entered = reduce(base, { type: 'enter_castle', shelterId: 'shelter-candy-ne' });
    expect(entered.level).toBe(6);
    expect(entered.xp).toBe(8 + CASTLE_FIRST_VISIT_XP - 15);
    expect(entered.events.some((e) => e.kind === 'level_up')).toBe(true);
    expect(entered.leaderboard.find((e) => e.isPlayer)?.level).toBe(6);
  });

  it('freezes outer elapsedTicks, monsterEvent, hostileProjectiles, and combat actions while inside a castle', () => {
    let s = reduce(startPlaying(), { type: 'enter_castle' });
    const outerElapsed = s.elapsedTicks;
    const monsterTicks = s.monsterEvent.ticksRemaining;
    const rngBefore = s.rng;

    for (let i = 0; i < 12; i++) {
      s = reduce(s, { type: 'tick' });
      s = reduce(s, { type: 'projectile_step', dtMs: 50 });
    }
    expect(s.castleInterior!.ticksInside).toBe(12);
    expect(s.elapsedTicks).toBe(outerElapsed);
    expect(s.monsterEvent.ticksRemaining).toBe(monsterTicks);
    expect(s.rng).toEqual(rngBefore);

    // Combat actions are safe no-ops inside the palace
    expect(reduce(s, { type: 'shoot' }).projectiles).toHaveLength(0);
    expect(reduce(s, { type: 'shield' }).shieldTicks).toBe(0);
    expect(reduce(s, { type: 'morph', form: 'phoenix' }).form).toBe(s.form);
    expect(reduce(s, { type: 'toggle_princess' }).princessStage).toBe('snake');
  });

  it('stands still when targetHeading is null, steers/dashes smoothly, clamps to INTERIOR_BOUNDS, and supports discrete turn impulse', () => {
    let s = reduce(startPlaying(), { type: 'enter_castle' });
    // Idle tick -> stops cleanly in place so player can admire vanity/pedestals
    s = reduce(s, { type: 'tick' });
    expect(s.castleInterior!.pos).toEqual({ x: 0, z: 16 });
    expect(s.castleInterior!.prevPos).toEqual({ x: 0, z: 16 });

    // Steer north (-PI / 2, aligned with initial heading) at walk speed
    s = reduce(s, { type: 'steer', angle: -Math.PI / 2 });
    s = reduce(s, { type: 'tick' });
    expect(s.castleInterior!.pos.z).toBeCloseTo(16 - INTERIOR_WALK_SPEED, 5);

    // Enable dash -> moves faster at INTERIOR_DASH_SPEED
    const zBeforeDash = s.castleInterior!.pos.z;
    s = reduce(s, { type: 'dash', active: true });
    s = reduce(s, { type: 'tick' });
    expect(s.castleInterior!.pos.z).toBeCloseTo(zBeforeDash - INTERIOR_DASH_SPEED, 5);

    // Clamps cleanly at palace walls
    s = {
      ...s,
      castleInterior: {
        ...s.castleInterior!,
        pos: { x: -19.9, z: -22.9 },
        heading: Math.PI,
        targetHeading: Math.PI,
      },
    };
    s = reduce(s, { type: 'tick' });
    expect(s.castleInterior!.pos.x).toBeGreaterThanOrEqual(-INTERIOR_BOUNDS.halfW);
    expect(s.castleInterior!.pos.z).toBeGreaterThanOrEqual(-INTERIOR_BOUNDS.halfD);

    // Discrete turn nudges for 8 ticks then stops automatically
    s = reduce(s, { type: 'steer', angle: null });
    s = reduce(s, { type: 'turn', direction: 'right' });
    for (let i = 0; i < 8; i++) {
      s = reduce(s, { type: 'tick' });
    }
    expect(s.castleInterior!.targetHeading).toBeNull();
  });

  it('regenerates +1 heart every 20 ticksInside up to maxHearts without toast spam', () => {
    let s: GameState = {
      ...startPlaying(),
      hearts: 2,
    };
    s = reduce(s, { type: 'enter_castle' });
    for (let i = 0; i < 20; i++) {
      s = reduce(s, { type: 'tick' });
    }
    expect(s.hearts).toBe(3);
    const healEv = s.events.find((e) => e.kind === 'heart_gained');
    expect(healEv).toBeDefined();
    expect(healEv!.messageVi).toBeUndefined();
  });

  it('detects all 7 palace zones and auto-equips outfit, makeup, and weapon pedestals on step-in', () => {
    expect(detectInteriorZone(INTERIOR_SPOTS.outfitPedestal)).toBe('outfit');
    expect(detectInteriorZone(INTERIOR_SPOTS.makeupPedestal)).toBe('makeup');
    expect(detectInteriorZone(INTERIOR_SPOTS.weaponPedestal)).toBe('weapon');
    expect(detectInteriorZone(INTERIOR_SPOTS.throne)).toBe('throne');
    expect(detectInteriorZone(INTERIOR_SPOTS.vanity)).toBe('vanity');
    expect(detectInteriorZone(INTERIOR_SPOTS.banquet)).toBe('banquet');
    expect(detectInteriorZone(INTERIOR_SPOTS.exitGate)).toBe('exit');
    expect(detectInteriorZone({ x: 0, z: 5 })).toBeNull();

    let s = reduce(startPlaying(), { type: 'enter_castle', shelterId: 'shelter-starlight-se' });

    // Step onto outfit pedestal -> auto-equips starlight outfit once
    s = {
      ...s,
      castleInterior: {
        ...s.castleInterior!,
        pos: { x: INTERIOR_SPOTS.outfitPedestal.x, z: INTERIOR_SPOTS.outfitPedestal.z },
        nearZone: null,
      },
    };
    s = reduce(s, { type: 'tick' });
    expect(s.wardrobe.equippedOutfit).toBe('starlight');
    expect(
      s.events.some((e) => e.kind === 'castle_item_equipped' && e.cosmeticSlot === 'outfit'),
    ).toBe(true);

    // Standing on the same pedestal next tick does not re-emit
    s = reduce(s, { type: 'tick' });
    expect(s.events.some((e) => e.kind === 'castle_item_equipped')).toBe(false);

    // Step onto makeup & weapon pedestals
    s = {
      ...s,
      castleInterior: {
        ...s.castleInterior!,
        pos: { x: INTERIOR_SPOTS.makeupPedestal.x, z: INTERIOR_SPOTS.makeupPedestal.z },
      },
    };
    s = reduce(s, { type: 'tick' });
    expect(s.wardrobe.equippedMakeup).toBe('starlight');

    s = {
      ...s,
      castleInterior: {
        ...s.castleInterior!,
        pos: { x: INTERIOR_SPOTS.weaponPedestal.x, z: INTERIOR_SPOTS.weaponPedestal.z },
      },
    };
    s = reduce(s, { type: 'tick' });
    expect(s.wardrobe.equippedWeapon).toBe('starlight');
  });

  it('supports manual equip_castle_item for unlocked sets, unequip to null, and blocks locked sets', () => {
    let s = reduce(startPlaying(), { type: 'enter_castle', shelterId: 'shelter-castle-center' });
    // 'castle' is unlocked; 'mermaid' is still locked
    const blocked = reduce(s, { type: 'equip_castle_item', slot: 'weapon', kind: 'mermaid' });
    expect(blocked.wardrobe.equippedWeapon).toBeNull();

    s = reduce(s, { type: 'equip_castle_item', slot: 'weapon', kind: 'castle' });
    expect(s.wardrobe.equippedWeapon).toBe('castle');
    expect(s.events.some((e) => e.kind === 'castle_item_equipped')).toBe(true);

    // Unequip back to default
    s = reduce(s, { type: 'equip_castle_item', slot: 'weapon', kind: null });
    expect(s.wardrobe.equippedWeapon).toBeNull();
  });

  it('exits cleanly via exit_castle and via walking onto exitGate after 20 ticks, preserving wardrobe', () => {
    const mermaid = DEFAULT_SHELTERS.find((sh) => sh.id === 'shelter-mermaid-sw')!;
    let s = reduce(startPlaying(), { type: 'enter_castle', shelterId: mermaid.id });
    s = reduce(s, { type: 'equip_castle_item', slot: 'outfit', kind: 'mermaid' });
    s = reduce(s, { type: 'equip_castle_item', slot: 'makeup', kind: 'mermaid' });
    s = reduce(s, { type: 'equip_castle_item', slot: 'weapon', kind: 'mermaid' });

    // Walking onto exitGate before 20 ticks does NOT prematurely exit
    const earlyExit = reduce(
      {
        ...s,
        castleInterior: {
          ...s.castleInterior!,
          pos: { x: 0, z: 20.8 },
          heading: Math.PI / 2,
          targetHeading: Math.PI / 2,
          ticksInside: 5,
        },
      },
      { type: 'tick' },
    );
    expect(earlyExit.castleInterior).not.toBeNull();

    // Walking onto exitGate at ticksInside >= 20 moving +Z auto-exits into outer shelter dome
    const autoExited = reduce(
      {
        ...s,
        castleInterior: {
          ...s.castleInterior!,
          pos: { x: 0, z: 20.8 },
          heading: Math.PI / 2,
          targetHeading: Math.PI / 2,
          ticksInside: 22,
        },
      },
      { type: 'tick' },
    );
    expect(autoExited.castleInterior).toBeNull();
    expect(autoExited.inShelter).toBe(true);
    expect(autoExited.currentShelterId).toBe(mermaid.id);
    expect(autoExited.snake[0]!.x).toBeCloseTo(mermaid.x, 5);
    expect(autoExited.snake[0]!.z).toBeCloseTo(mermaid.z + mermaid.radius * 0.4, 5);
    expect(autoExited.prevSnake).toEqual(autoExited.snake);
    expect(autoExited.invulnerableTicks).toBeGreaterThanOrEqual(30);
    expect(autoExited.wardrobe.equippedOutfit).toBe('mermaid');
    expect(autoExited.wardrobe.equippedMakeup).toBe('mermaid');
    expect(autoExited.wardrobe.equippedWeapon).toBe('mermaid');
    expect(autoExited.events.some((e) => e.kind === 'castle_exit_interior')).toBe(true);
  });
});
