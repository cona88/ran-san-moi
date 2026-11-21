import { describe, expect, it, vi } from 'vitest';
import { Sfx } from '../../src/audio';
import {
  applyBotShelterFlee,
  createInitialMonsterEvent,
  createInitialShelters,
  createInitialState,
  DEFAULT_MONSTER_INTERVAL_TICKS,
  DEFAULT_MONSTER_SPEED,
  DEFAULT_MONSTER_STRIKE_TICKS,
  DEFAULT_MONSTER_WARNING_TICKS,
  DEFAULT_SHELTERS,
  findCurrentShelter,
  findNearestShelter,
  isInsideShelter,
  MONSTER_SHIELD_BARRIER_MARGIN,
  moveRoamingMonster,
  reduce,
  resolveMonsterCalamityStrike,
  ROAMING_MONSTER_COUNT_MAX,
  ROAMING_MONSTER_COUNT_MIN,
  ROAMING_MONSTER_SHIELD_MARGIN,
  ROAMING_MONSTER_SPEED_MAX,
  ROAMING_MONSTER_SPEED_MIN,
  roamingMonsterNameVi,
  SHELTER_DISCOVERY_SCORE,
  SHELTER_SURVIVAL_SCORE,
  SHELTER_SURVIVAL_XP,
  stepMonsterEvent,
  stepRoamingMonsters,
  type BotSnake,
  type GameState,
  type MonsterEventState,
  type RoamingMonster,
  type ShelterKind,
} from '../../src/core';

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

describe('Shelter Houses & Monster Calamity Core Logic', () => {
  describe('Shelter geometry and detection', () => {
    it('initializes 11 sanctuary exploration palaces and fairy houses with 1 central castle + 6 regional sanctuaries + 4 wonder palaces', () => {
      const shelters = createInitialShelters(280);
      expect(shelters).toHaveLength(11);

      const central = shelters.find((s) => s.kind === 'castle');
      expect(central).toBeDefined();
      expect(central!.id).toBe('shelter-castle-center');
      expect(central!.x).toBe(0);
      expect(central!.z).toBe(0);
      expect(central!.radius).toBeGreaterThanOrEqual(14);

      const mushrooms = shelters.filter((s) => s.kind === 'mushroom');
      expect(mushrooms.length).toBe(3); // north, south, nw

      const crystals = shelters.filter((s) => s.kind === 'crystal');
      expect(crystals.length).toBe(3); // east, west, se

      // 4 Wonder Exploration Palaces for girls
      const mermaid = shelters.find((s) => s.kind === 'mermaid');
      expect(mermaid).toBeDefined();
      expect(mermaid!.id).toBe('shelter-mermaid-sw');
      expect(mermaid!.nameVi).toContain('Nàng Tiên Cá');
      expect(mermaid!.colorHex).toBe(0x00e5ff);
      expect(mermaid!.x).toBe(-180);
      expect(mermaid!.z).toBe(120);
      expect(mermaid!.radius).toBe(15);

      const candy = shelters.find((s) => s.kind === 'candy');
      expect(candy).toBeDefined();
      expect(candy!.id).toBe('shelter-candy-ne');
      expect(candy!.nameVi).toContain('Kẹo Ngọt');
      expect(candy!.colorHex).toBe(0xff69b4);
      expect(candy!.x).toBe(180);
      expect(candy!.z).toBe(-120);
      expect(candy!.radius).toBe(15);

      const blossom = shelters.find((s) => s.kind === 'blossom');
      expect(blossom).toBeDefined();
      expect(blossom!.id).toBe('shelter-blossom-nw');
      expect(blossom!.nameVi).toContain('Hoa Tiên');
      expect(blossom!.colorHex).toBe(0xff85c0);
      expect(blossom!.x).toBe(-120);
      expect(blossom!.z).toBe(-180);
      expect(blossom!.radius).toBe(14);

      const starlight = shelters.find((s) => s.kind === 'starlight');
      expect(starlight).toBeDefined();
      expect(starlight!.id).toBe('shelter-starlight-se');
      expect(starlight!.nameVi).toContain('Ánh Sao');
      expect(starlight!.colorHex).toBe(0xb388ff);
      expect(starlight!.x).toBe(120);
      expect(starlight!.z).toBe(180);
      expect(starlight!.radius).toBe(14);

      // Verify all 7 ShelterKinds exist in the 11 shelters
      const kinds = new Set(shelters.map((s) => s.kind));
      const expectedKinds: ShelterKind[] = [
        'castle',
        'mushroom',
        'crystal',
        'mermaid',
        'candy',
        'blossom',
        'starlight',
      ];
      for (const k of expectedKinds) {
        expect(kinds.has(k)).toBe(true);
      }

      // Check all shelters have friendly Vietnamese names and valid colors
      for (const s of shelters) {
        expect(s.nameVi).toBeTruthy();
        expect(s.colorHex).toBeGreaterThan(0);
        expect(s.radius).toBeGreaterThan(0);
      }
    });

    it('detects when an entity is inside or outside a shelter radius', () => {
      const castle = DEFAULT_SHELTERS[0]!; // Center (0, 0), radius 16
      expect(isInsideShelter({ x: 0, z: 0 }, castle)).toBe(true);
      expect(isInsideShelter({ x: 10, z: 10 }, castle)).toBe(true); // hypot ≈ 14.14 <= 16
      expect(isInsideShelter({ x: 20, z: 0 }, castle)).toBe(false); // 20 > 16

      // With margin
      expect(isInsideShelter({ x: 18, z: 0 }, castle, 3)).toBe(true); // 18 <= 16 + 3
    });

    it('finds current shelter and nearest shelter correctly', () => {
      const shelters = createInitialShelters(280);

      // Pos at (0, -160) is inside north mushroom
      const north = findCurrentShelter({ x: 0, z: -160 }, shelters);
      expect(north).toBeDefined();
      expect(north!.id).toBe('shelter-mushroom-north');

      // Pos at (50, 50) is not inside any shelter
      const none = findCurrentShelter({ x: 50, z: 50 }, shelters);
      expect(none).toBeNull();

      // Nearest shelter to (50, 50) is castle center at (0, 0)
      const nearest = findNearestShelter({ x: 50, z: 50 }, shelters);
      expect(nearest).not.toBeNull();
      expect(nearest!.shelter.id).toBe('shelter-castle-center');
      expect(nearest!.distance).toBeCloseTo(Math.hypot(50, 50), 2);
    });
  });

  describe('Monster Calamity state machine & transitions', () => {
    it('starts in idle phase and counts down ticks and seconds', () => {
      expect(DEFAULT_MONSTER_INTERVAL_TICKS).toBeGreaterThan(0);
      expect(DEFAULT_MONSTER_WARNING_TICKS).toBe(160);
      expect(DEFAULT_MONSTER_STRIKE_TICKS).toBe(20);
      expect(SHELTER_SURVIVAL_XP).toBe(15);

      const config = { ...startPlaying().config, monsterEventIntervalTicks: 100 };
      const monster = createInitialMonsterEvent(config);
      expect(monster.phase).toBe('idle');
      expect(monster.ticksRemaining).toBe(100);
      expect(monster.countdownSec).toBe(5);
      expect(monster.monsterPos).toEqual({ x: 0, z: -100 });
      expect(monster.monsterHeading).toBe(0);
      expect(monster.monsterSpeed).toBe(0);
      expect(monster.distanceToPlayer).toBe(999);
      expect(monster.isChasing).toBe(false);
      expect(monster.isBlockedByShelter).toBe(false);
      expect(monster.targetShelterId).toBeNull();

      const step1 = stepMonsterEvent(monster, config);
      expect(step1.nextEvent.phase).toBe('idle');
      expect(step1.nextEvent.ticksRemaining).toBe(99);
      expect(step1.strikeTriggered).toBe(false);
      expect(step1.eventDrafts).toHaveLength(0);
      expect(step1.nextEvent.isChasing).toBe(false);
    });

    it('transitions idle -> warning phase with 8s countdown and emits monster_warning event', () => {
      const config = {
        ...startPlaying().config,
        monsterEventIntervalTicks: 100,
        monsterWarningTicks: 160,
      };
      const monster: MonsterEventState = {
        phase: 'idle' as const,
        ticksRemaining: 1, // Final tick before warning
        maxTicks: 100,
        countdownSec: 1,
        progress: 0.99,
        monsterPos: { x: 0, z: -100 },
        monsterHeading: 0,
        monsterSpeed: 0,
        distanceToPlayer: 999,
        isChasing: false,
        isBlockedByShelter: false,
        targetShelterId: null,
      };

      const res = stepMonsterEvent(monster, config, { x: 50, z: 50 });
      expect(res.nextEvent.phase).toBe('warning');
      expect(res.nextEvent.ticksRemaining).toBe(160);
      expect(res.nextEvent.countdownSec).toBe(8);
      expect(res.strikeTriggered).toBe(false);
      expect(res.eventDrafts.some((e) => e.kind === 'monster_warning')).toBe(true);
      expect(res.nextEvent.isChasing).toBe(true);
      expect(res.nextEvent.monsterPos.x).toBe(30);
      expect(res.nextEvent.monsterPos.z).toBe(35);
      expect(res.nextEvent.distanceToPlayer).toBe(25);
    });

    it('transitions warning -> strike phase and triggers calamity strike', () => {
      const config = {
        ...startPlaying().config,
        monsterWarningTicks: 160,
        monsterStrikeTicks: 20,
      };
      const monster: MonsterEventState = {
        phase: 'warning' as const,
        ticksRemaining: 1, // Final warning tick
        maxTicks: 160,
        countdownSec: 1,
        progress: 0.99,
        monsterPos: { x: 10, z: 10 },
        monsterHeading: 0,
        monsterSpeed: 0.55,
        distanceToPlayer: 14.14,
        isChasing: true,
        isBlockedByShelter: false,
        targetShelterId: null,
      };

      const res = stepMonsterEvent(monster, config, { x: 0, z: 0 });
      expect(res.nextEvent.phase).toBe('strike');
      expect(res.nextEvent.ticksRemaining).toBe(20);
      expect(res.strikeTriggered).toBe(true);
      expect(res.eventDrafts.some((e) => e.kind === 'monster_strike')).toBe(true);
      expect(res.nextEvent.isChasing).toBe(true);
    });

    it('transitions strike -> idle phase after strike finishes', () => {
      const config = {
        ...startPlaying().config,
        monsterEventIntervalTicks: 1100,
        monsterStrikeTicks: 20,
      };
      const monster: MonsterEventState = {
        phase: 'strike' as const,
        ticksRemaining: 1, // Final strike tick
        maxTicks: 20,
        countdownSec: 1,
        progress: 0.95,
        monsterPos: { x: 0, z: 0 },
        monsterHeading: 0,
        monsterSpeed: 0.55,
        distanceToPlayer: 0,
        isChasing: true,
        isBlockedByShelter: false,
        targetShelterId: null,
      };

      const res = stepMonsterEvent(monster, config);
      expect(res.nextEvent.phase).toBe('idle');
      expect(res.nextEvent.ticksRemaining).toBe(1100);
      expect(res.strikeTriggered).toBe(false);
      expect(res.nextEvent.isChasing).toBe(false);
      expect(res.nextEvent.distanceToPlayer).toBe(999);
      expect(res.nextEvent.monsterPos).toEqual({ x: 0, z: -100 });
    });
  });

  describe('Active monster pursuit and shelter barrier blocking', () => {
    it('monster closes in on player during warning phase when player is outside shelter', () => {
      const config = startPlaying().config;
      const playerHead = { x: 0, z: 0 };
      // Spawn monster ~25 units away
      let monsterEvent = stepMonsterEvent(
        {
          phase: 'idle',
          ticksRemaining: 1,
          maxTicks: 100,
          countdownSec: 1,
          progress: 0.99,
          monsterPos: { x: 0, z: -100 },
          monsterHeading: 0,
          monsterSpeed: 0,
          distanceToPlayer: 999,
          isChasing: false,
          isBlockedByShelter: false,
          targetShelterId: null,
        },
        config,
        playerHead,
        DEFAULT_SHELTERS,
        false,
      ).nextEvent;

      expect(monsterEvent.phase).toBe('warning');
      expect(monsterEvent.isChasing).toBe(true);
      expect(monsterEvent.distanceToPlayer).toBe(25);

      // Step 1 tick of pursuit
      monsterEvent = stepMonsterEvent(
        monsterEvent,
        config,
        playerHead,
        DEFAULT_SHELTERS,
        false,
      ).nextEvent;

      expect(monsterEvent.distanceToPlayer).toBeLessThan(25);
      expect(monsterEvent.distanceToPlayer).toBeCloseTo(25 - DEFAULT_MONSTER_SPEED, 1);
      expect(monsterEvent.isBlockedByShelter).toBe(false);

      // Step 20 ticks of pursuit
      for (let i = 0; i < 20; i++) {
        monsterEvent = stepMonsterEvent(
          monsterEvent,
          config,
          playerHead,
          DEFAULT_SHELTERS,
          false,
        ).nextEvent;
      }
      expect(monsterEvent.distanceToPlayer).toBeLessThan(15);
      expect(monsterEvent.isBlockedByShelter).toBe(false);
    });

    it('blocks monster at shelter perimeter when player is safely sheltered inside', () => {
      const config = startPlaying().config;
      const castle = DEFAULT_SHELTERS.find((s) => s.kind === 'castle')!;
      const playerHead = { x: castle.x, z: castle.z }; // (0, 0)
      const barrierRadius = castle.radius + MONSTER_SHIELD_BARRIER_MARGIN; // 16 + 1.8 = 17.8

      // Place monster just outside barrier at (18.5, 0)
      const warningEvent: MonsterEventState = {
        phase: 'warning',
        ticksRemaining: 100,
        maxTicks: 160,
        countdownSec: 5,
        progress: 0.375,
        monsterPos: { x: 18.5, z: 0 },
        monsterHeading: Math.PI,
        monsterSpeed: DEFAULT_MONSTER_SPEED,
        distanceToPlayer: 18.5,
        isChasing: true,
        isBlockedByShelter: false,
        targetShelterId: null,
      };

      // Step 5 ticks toward shelter center while player is inside shelter
      let current = warningEvent;
      for (let i = 0; i < 5; i++) {
        current = stepMonsterEvent(current, config, playerHead, [castle], true).nextEvent;
      }

      // Monster MUST be blocked at shelter barrier perimeter!
      expect(current.isBlockedByShelter).toBe(true);
      expect(current.targetShelterId).toBe(castle.id);

      // Distance to shelter center should be clamped to barrierRadius (17.8)
      const distToShelterCenter = Math.hypot(
        current.monsterPos.x - castle.x,
        current.monsterPos.z - castle.z,
      );
      expect(distToShelterCenter).toBeCloseTo(barrierRadius, 2);
    });

    it('monster continues chase when player leaves shelter', () => {
      const config = startPlaying().config;
      const castle = DEFAULT_SHELTERS.find((s) => s.kind === 'castle')!;
      const barrierRadius = castle.radius + MONSTER_SHIELD_BARRIER_MARGIN;

      // Start blocked
      const blockedEvent: MonsterEventState = {
        phase: 'warning',
        ticksRemaining: 80,
        maxTicks: 160,
        countdownSec: 4,
        progress: 0.5,
        monsterPos: { x: barrierRadius, z: 0 },
        monsterHeading: 0,
        monsterSpeed: DEFAULT_MONSTER_SPEED,
        distanceToPlayer: barrierRadius,
        isChasing: true,
        isBlockedByShelter: true,
        targetShelterId: castle.id,
      };

      // Player stepped outside shelter (inShelter: false) at (30, 0)
      const res = stepMonsterEvent(blockedEvent, config, { x: 30, z: 0 }, [castle], false);

      expect(res.nextEvent.isBlockedByShelter).toBe(false);
      expect(res.nextEvent.targetShelterId).toBeNull();
      expect(res.nextEvent.monsterPos.x).toBeGreaterThan(barrierRadius);
    });
  });

  describe('Shelter enter / exit events for player', () => {
    it('emits shelter_enter when entering sanctuary and shelter_exit when leaving', () => {
      let s = startPlaying();
      // Place player just outside East Crystal (160, 0, radius 14) at (145.8, 0)
      // Moving east at baseSpeed ~0.42 will place head at ~146.22, inside radius <= 160 - 14 = 146
      s = {
        ...s,
        snake: [{ x: 145.8, z: 0 }],
        heading: 0, // heading East toward crystal
        inShelter: false,
        currentShelterId: null,
      };

      // Tick 1: move east into shelter
      s = reduce(s, { type: 'tick' });
      expect(s.inShelter).toBe(true);
      expect(s.currentShelterId).toBe('shelter-crystal-east');
      expect(s.shelteredTicks).toBe(1);
      expect(s.events.some((e) => e.kind === 'shelter_enter')).toBe(true);

      // Tick 2: stay inside shelter -> increments shelteredTicks
      s = reduce(s, { type: 'tick' });
      expect(s.inShelter).toBe(true);
      expect(s.shelteredTicks).toBe(2);

      // Now teleport player outside and turn away
      s = {
        ...s,
        snake: [{ x: 180, z: 0 }],
        heading: 0,
      };
      // Next tick: exiting shelter
      s = reduce(s, { type: 'tick' });
      expect(s.inShelter).toBe(false);
      expect(s.currentShelterId).toBeNull();
      expect(s.shelteredTicks).toBe(0);
      expect(s.events.some((e) => e.kind === 'shelter_exit')).toBe(true);
    });
  });

  describe('Castle Discovery Mechanic', () => {
    it('initializes discoveredShelterIds with starting central castle', () => {
      const s = startPlaying();
      expect(s.discoveredShelterIds).toBeDefined();
      expect(s.discoveredShelterIds).toContain('shelter-castle-center');
      expect(s.discoveredShelterIds.length).toBe(1);
    });

    it('discovers new palace upon entry, emits shelter_discovered event, and awards +150 score', () => {
      let s = startPlaying();
      const scoreBefore = s.score;
      expect(s.discoveredShelterIds.includes('shelter-mermaid-sw')).toBe(false);

      // Place player just outside Mermaid Palace (-180, 120, radius 15)
      // Moving east (heading 0) into Mermaid Palace
      s = {
        ...s,
        snake: [{ x: -181, z: 120 }],
        heading: 0,
        inShelter: false,
        currentShelterId: null,
      };

      s = reduce(s, { type: 'tick' });
      expect(s.inShelter).toBe(true);
      expect(s.currentShelterId).toBe('shelter-mermaid-sw');
      expect(s.discoveredShelterIds).toContain('shelter-mermaid-sw');
      expect(s.discoveredShelterIds.length).toBe(2);

      // Verify shelter_discovered event
      const discoveryEv = s.events.find((e) => e.kind === 'shelter_discovered');
      expect(discoveryEv).toBeDefined();
      expect(discoveryEv!.points).toBe(SHELTER_DISCOVERY_SCORE);
      expect(discoveryEv!.shelterId).toBe('shelter-mermaid-sw');
      expect(discoveryEv!.messageVi).toContain('Nàng Tiên Cá');

      // Score increases by +150
      expect(s.score).toBe(scoreBefore + SHELTER_DISCOVERY_SCORE);
      expect(s.best).toBe(s.score);
    });

    it('does not re-trigger discovery or duplicate bonus when entering an already discovered shelter', () => {
      let s = startPlaying();
      // Pre-add candy castle to discoveredShelterIds
      s = {
        ...s,
        discoveredShelterIds: ['shelter-castle-center', 'shelter-candy-ne'],
        snake: [{ x: 179, z: -120 }], // inside Candy Castle
        heading: 0,
        inShelter: false,
        currentShelterId: null,
      };

      const scoreBefore = s.score;
      s = reduce(s, { type: 'tick' });
      expect(s.inShelter).toBe(true);
      expect(s.currentShelterId).toBe('shelter-candy-ne');

      // shelter_enter emitted, but NOT shelter_discovered
      expect(s.events.some((e) => e.kind === 'shelter_enter')).toBe(true);
      expect(s.events.some((e) => e.kind === 'shelter_discovered')).toBe(false);
      expect(s.score).toBe(scoreBefore);
      expect(s.discoveredShelterIds.length).toBe(2);
    });
  });

  describe('Frequent Slow-Moving Roaming Monsters', () => {
    it('initializes and maintains 4-6 roaming monsters in GameState', () => {
      const s = startPlaying();
      expect(s.roamingMonsters).toBeDefined();
      expect(s.roamingMonsters.length).toBeGreaterThanOrEqual(ROAMING_MONSTER_COUNT_MIN);
      expect(s.roamingMonsters.length).toBeLessThanOrEqual(ROAMING_MONSTER_COUNT_MAX);

      const kinds = new Set(s.roamingMonsters.map((m) => m.kind));
      expect(kinds.has('sea_beast') || kinds.has('forest_golem') || kinds.has('candy_troll')).toBe(
        true,
      );

      for (const m of s.roamingMonsters) {
        expect(m.id).toBeGreaterThan(0);
        expect(m.speed).toBeGreaterThanOrEqual(ROAMING_MONSTER_SPEED_MIN);
        expect(m.speed).toBeLessThanOrEqual(ROAMING_MONSTER_SPEED_MAX);
        expect(m.hp).toBeGreaterThan(0);
        expect(m.frozenTicks).toBe(0);
        expect(roamingMonsterNameVi(m.kind)).toBeTruthy();
      }
    });

    it('moves peacefully at slow speed when player is far away (> 22 units)', () => {
      const monster: RoamingMonster = {
        id: 10,
        kind: 'forest_golem',
        x: 100,
        z: 100,
        heading: 0,
        speed: 0.2,
        hp: 3,
        frozenTicks: 0,
      };

      const playerHead = { x: -50, z: -50 }; // distance >> 22
      const moved = moveRoamingMonster({
        monster,
        playerHead,
        playerInShelter: false,
        shelters: DEFAULT_SHELTERS,
        worldRadius: 280,
        elapsedTicks: 10,
      });

      // Monster moves along its heading with its slow speed ~0.20
      const distMoved = Math.hypot(moved.x - monster.x, moved.z - monster.z);
      expect(distMoved).toBeCloseTo(0.2, 2);
    });

    it('steers toward player when player is within 22 units outside shelter', () => {
      const monster: RoamingMonster = {
        id: 11,
        kind: 'sea_beast',
        x: 10,
        z: 10,
        heading: 0, // facing East
        speed: 0.22,
        hp: 2,
        frozenTicks: 0,
      };

      // Player is at (10, 20) — directly South, distance = 10 units <= 22
      const playerHead = { x: 10, z: 20 };
      const moved = moveRoamingMonster({
        monster,
        playerHead,
        playerInShelter: false,
        shelters: DEFAULT_SHELTERS,
        worldRadius: 280,
        elapsedTicks: 1,
      });

      // Heading should adjust toward south (+Math.PI / 2)
      expect(moved.heading).toBeGreaterThan(0);
      expect(moved.z).toBeGreaterThan(monster.z);
    });

    it('cannot enter shelters and is blocked outside the forcefield boundary', () => {
      const castle = DEFAULT_SHELTERS.find((s) => s.id === 'shelter-castle-center')!;
      // Place monster heading straight into castle center (radius 16)
      const monster: RoamingMonster = {
        id: 12,
        kind: 'candy_troll',
        x: 17.6, // just outside radius 16 + margin 1.5 = 17.5
        z: 0,
        heading: Math.PI, // heading West into castle
        speed: 0.22,
        hp: 2,
        frozenTicks: 0,
      };

      const playerHead = { x: 0, z: 0 }; // inside castle
      const moved = moveRoamingMonster({
        monster,
        playerHead,
        playerInShelter: true,
        shelters: DEFAULT_SHELTERS,
        worldRadius: 280,
        elapsedTicks: 5,
      });

      // Must be kept outside the shield perimeter (radius + margin = 17.5)
      const distFromCastle = Math.hypot(moved.x - castle.x, moved.z - castle.z);
      expect(distFromCastle).toBeGreaterThanOrEqual(
        castle.radius + ROAMING_MONSTER_SHIELD_MARGIN - 0.01,
      );
    });

    it('inflicts 1 heart damage and brief invulnerability when touching player outside shelter without protection', () => {
      let s = startPlaying();
      s = {
        ...s,
        hearts: 3,
        invulnerableTicks: 0,
        shieldTicks: 0,
        isDashing: false,
        sprayActiveTicks: 0,
        inShelter: false,
        currentShelterId: null,
        snake: [{ x: 50, z: 50 }],
        roamingMonsters: [
          {
            id: 21,
            kind: 'forest_golem',
            x: 50.8,
            z: 50, // touch distance = 0.8 <= 2.2
            heading: 0,
            speed: 0.2,
            hp: 3,
            frozenTicks: 0,
          },
        ],
      };

      s = stepRoamingMonsters(s);

      expect(s.hearts).toBe(2);
      expect(s.invulnerableTicks).toBe(30);
      expect(s.events.some((e) => e.kind === 'heart_lost')).toBe(true);
    });

    it('player is safe when inside shelter even if monster touches outer boundary', () => {
      let s = startPlaying();
      s = {
        ...s,
        hearts: 3,
        inShelter: true,
        currentShelterId: 'shelter-castle-center',
        snake: [{ x: 15, z: 0 }],
        roamingMonsters: [
          {
            id: 22,
            kind: 'sea_beast',
            x: 16.5,
            z: 0,
            heading: 0,
            speed: 0.2,
            hp: 2,
            frozenTicks: 0,
          },
        ],
      };

      s = stepRoamingMonsters(s);
      // No damage taken because player is safely in shelter
      expect(s.hearts).toBe(3);
      expect(s.events.some((e) => e.kind === 'heart_lost')).toBe(false);
    });

    it('defeats roaming monster when player touches it while dashing or spraying', () => {
      let s = startPlaying();
      s = {
        ...s,
        hearts: 3,
        score: 100,
        isDashing: true,
        inShelter: false,
        currentShelterId: null,
        snake: [{ x: 70, z: 70 }],
        roamingMonsters: [
          {
            id: 23,
            kind: 'candy_troll',
            x: 71,
            z: 70, // touch distance 1.0 <= 2.2
            heading: 0,
            speed: 0.22,
            hp: 2,
            frozenTicks: 0,
          },
        ],
      };

      s = stepRoamingMonsters(s);

      // Monster defeated, player keeps all hearts, earns +50 score and defeated count
      expect(s.hearts).toBe(3);
      expect(s.score).toBe(150);
      expect(s.enemiesDefeated).toBe(1);
      expect(s.events.some((e) => e.kind === 'hazard_destroyed')).toBe(true);
    });

    it('blocks damage and pushes monster back when player has active shield', () => {
      let s = startPlaying();
      s = {
        ...s,
        hearts: 3,
        shieldTicks: 40,
        isDashing: false,
        inShelter: false,
        currentShelterId: null,
        snake: [{ x: 40, z: 40 }],
        roamingMonsters: [
          {
            id: 24,
            kind: 'sea_beast',
            x: 41,
            z: 40, // distance 1.0
            heading: 0,
            speed: 0.2,
            hp: 2,
            frozenTicks: 0,
          },
        ],
      };

      s = stepRoamingMonsters(s);

      expect(s.hearts).toBe(3);
      expect(s.events.some((e) => e.kind === 'shield_block')).toBe(true);
      expect(s.events.some((e) => e.kind === 'heart_lost')).toBe(false);
    });

    it('fairy butterfly form flies safely above roaming monsters with 0 damage', () => {
      let s = startPlaying();
      s = {
        ...s,
        hearts: 3,
        butterflyStage: 'butterfly',
        inShelter: false,
        currentShelterId: null,
        snake: [{ x: 30, z: 30 }],
        roamingMonsters: [
          {
            id: 25,
            kind: 'forest_golem',
            x: 30.5,
            z: 30,
            heading: 0,
            speed: 0.18,
            hp: 3,
            frozenTicks: 0,
          },
        ],
      };

      s = stepRoamingMonsters(s);
      expect(s.hearts).toBe(3);
      expect(s.events.some((e) => e.kind === 'heart_lost')).toBe(false);
    });

    it('frozen roaming monster stays in place and decrements frozenTicks', () => {
      const monster: RoamingMonster = {
        id: 26,
        kind: 'sea_beast',
        x: 50,
        z: 50,
        heading: 0,
        speed: 0.2,
        hp: 2,
        frozenTicks: 15,
      };

      const moved = moveRoamingMonster({
        monster,
        playerHead: { x: 52, z: 50 },
        playerInShelter: false,
        shelters: DEFAULT_SHELTERS,
        worldRadius: 280,
        elapsedTicks: 2,
      });

      expect(moved.x).toBe(50);
      expect(moved.z).toBe(50);
      expect(moved.frozenTicks).toBe(14);
    });
  });

  describe('Lethal Calamity Strike vs Shelter Survival', () => {
    it('kills player outside shelter on monster strike -> gameover with 0 hearts', () => {
      let s = startPlaying();
      // Player is far outside at (80, 80)
      s = {
        ...s,
        snake: [{ x: 80, z: 80 }],
        hearts: 3,
        inShelter: false,
      };

      const struck = resolveMonsterCalamityStrike({ state: s, config: s.config });
      expect(struck.phase).toBe('gameover');
      expect(struck.hearts).toBe(0);
      expect(struck.events.some((e) => e.kind === 'monster_strike')).toBe(true);
      expect(struck.events.some((e) => e.kind === 'gameover')).toBe(true);
    });

    it('safely shields player inside shelter on monster strike and awards survival points', () => {
      let s = startPlaying();
      const scoreBefore = s.score;
      const heartsBefore = s.hearts;

      // Player is safe at center castle (0, 0)
      s = {
        ...s,
        snake: [{ x: 0, z: 0 }],
        inShelter: true,
        currentShelterId: 'shelter-castle-center',
      };

      const survived = resolveMonsterCalamityStrike({ state: s, config: s.config });
      expect(survived.phase).toBe('playing');
      expect(survived.hearts).toBe(heartsBefore);
      expect(survived.score).toBe(scoreBefore + SHELTER_SURVIVAL_SCORE);
      // Gaining 15 XP at initial level 5 hits the 15 XP threshold, advancing level to 6!
      expect(survived.level).toBe(s.level + 1);
      expect(survived.xp).toBe(0);
      expect(survived.events.some((e) => e.kind === 'monster_strike')).toBe(true);
      expect(survived.events.some((e) => e.kind === 'shelter_enter')).toBe(true);
    });

    it('eliminates unsheltered bots during strike while sheltered bots survive', () => {
      let s = startPlaying();
      const shelteredBot = makeBot({
        id: 901,
        name: 'SafeBot',
        head: { x: 0, z: 0 }, // Inside Castle
      });
      const outsideBot = makeBot({
        id: 902,
        name: 'DoomedBot',
        head: { x: 90, z: 90 }, // Outside all shelters
        level: 8,
      });

      s = {
        ...s,
        snake: [{ x: 0, z: 0 }], // Player sheltered
        inShelter: true,
        bots: [shelteredBot, outsideBot],
        enemiesDefeated: 0,
      };

      const res = resolveMonsterCalamityStrike({ state: s, config: s.config });
      expect(res.bots.some((b) => b.id === 901)).toBe(true);
      expect(res.bots.some((b) => b.id === 902)).toBe(false);
      expect(res.enemiesDefeated).toBe(1);
      // Defeated bot should have dropped loot orbs
      expect(res.orbs.length).toBeGreaterThan(s.orbs.length);
    });
  });

  describe('Bot flee behavior during monster warning', () => {
    it('steers outside bots toward their nearest shelter during warning phase', () => {
      const shelters = createInitialShelters(280);
      // Bot at (50, 0), facing toward shelter (heading = Math.PI, toward castle at (0, 0))
      const bot = makeBot({
        id: 501,
        head: { x: 50, z: 0 },
        heading: Math.PI,
      });

      const fled = applyBotShelterFlee([bot], shelters, 280, true);
      expect(fled).toHaveLength(1);
      const after = fled[0]!;

      // Heading should point west toward center castle
      expect(after.heading).toBeCloseTo(Math.PI, 1);
      // Head X should move closer to center (less than 50)
      expect(after.head.x).toBeLessThan(50);
      expect(after.head.x).toBeCloseTo(50 - 0.55, 2);
    });

    it('steers bots not currently facing the shelter toward the shelter heading', () => {
      const shelters = createInitialShelters(280);
      // Bot at (50, 0) facing East (0)
      const bot = makeBot({
        id: 503,
        head: { x: 50, z: 0 },
        heading: 0,
      });

      const fled = applyBotShelterFlee([bot], shelters, 280, true);
      // Should turn away from 0 towards Math.PI (target angle)
      expect(Math.abs(fled[0]!.heading)).toBeGreaterThan(0.3);
    });

    it('does not disturb bots when warning is not active', () => {
      const shelters = createInitialShelters(280);
      const bot = makeBot({
        id: 502,
        head: { x: 50, z: 0 },
        heading: 0,
      });

      const untouched = applyBotShelterFlee([bot], shelters, 280, false);
      expect(untouched[0]!.head.x).toBe(50);
      expect(untouched[0]!.heading).toBe(0);
    });
  });

  describe('Full Game Loop simulation with Monster Calamity', () => {
    it('triggers gameover when monster strike fires and player is outside shelter', () => {
      let s = startPlaying();
      // Move player far from center castle (0, 0)
      s = {
        ...s,
        snake: [{ x: 80, z: 80 }],
        prevSnake: [{ x: 80, z: 80 }],
        heading: 0,
        inShelter: false,
        monsterEvent: {
          phase: 'warning',
          ticksRemaining: 1, // will transition to strike on next tick!
          maxTicks: 160,
          countdownSec: 1,
          progress: 0.99,
          monsterPos: { x: 60, z: 65 },
          monsterHeading: 0,
          monsterSpeed: 0.55,
          distanceToPlayer: 25,
          isChasing: true,
          isBlockedByShelter: false,
          targetShelterId: null,
        },
      };

      s = reduce(s, { type: 'tick' });
      expect(s.phase).toBe('gameover');
      expect(s.hearts).toBe(0);
      expect(s.events.some((e) => e.kind === 'monster_strike')).toBe(true);
      expect(s.events.some((e) => e.kind === 'gameover')).toBe(true);
    });

    it('safely survives monster strike when player is inside shelter during tick', () => {
      let s = startPlaying();
      // Place player inside central castle (0, 0)
      s = {
        ...s,
        snake: [{ x: 0, z: 0 }],
        prevSnake: [{ x: 0, z: 0 }],
        heading: 0,
        inShelter: true,
        currentShelterId: 'shelter-castle-center',
        monsterEvent: {
          phase: 'warning',
          ticksRemaining: 1, // will transition to strike on next tick!
          maxTicks: 160,
          countdownSec: 1,
          progress: 0.99,
          monsterPos: { x: 60, z: 65 },
          monsterHeading: 0,
          monsterSpeed: 0.55,
          distanceToPlayer: 25,
          isChasing: true,
          isBlockedByShelter: false,
          targetShelterId: null,
        },
      };

      const scoreBefore = s.score;
      s = reduce(s, { type: 'tick' });
      expect(s.phase).toBe('playing');
      expect(s.hearts).toBeGreaterThan(0);
      expect(s.score).toBeGreaterThanOrEqual(scoreBefore + SHELTER_SURVIVAL_SCORE);
      expect(s.monsterEvent.phase).toBe('strike');
    });
  });

  describe('Monster Chase & Shelter Forcefield Audio (Sfx)', () => {
    it('executes standalone monster audio effect methods safely in headless mode', () => {
      const sfx = new Sfx(true);
      expect(() => sfx.playMonsterWingWhoosh(15)).not.toThrow();
      expect(() => sfx.playMonsterPursuitRoar(20)).not.toThrow();
      expect(() => sfx.playMonsterShieldDeflect()).not.toThrow();
      sfx.dispose();
    });

    it('triggers periodic wing-whoosh and pursuit roar when monster chases within 25 units outside shelter', () => {
      const sfx = new Sfx(true);
      const whooshSpy = vi.spyOn(sfx, 'playMonsterWingWhoosh');
      const roarSpy = vi.spyOn(sfx, 'playMonsterPursuitRoar');
      const deflectSpy = vi.spyOn(sfx, 'playMonsterShieldDeflect');

      let s = startPlaying();
      s = {
        ...s,
        elapsedTicks: 100,
        inShelter: false,
        snake: [{ x: 50, z: 50 }],
        monsterEvent: {
          phase: 'warning',
          countdownSec: 6,
          ticksRemaining: 120,
          maxTicks: 160,
          progress: 0.25,
          monsterPos: { x: 65, z: 50 },
          monsterHeading: 0,
          monsterSpeed: 0.55,
          distanceToPlayer: 15,
          isChasing: true,
          isBlockedByShelter: false,
          targetShelterId: null,
        },
      };

      sfx.updateState(s);
      expect(whooshSpy).toHaveBeenCalledTimes(1);
      expect(roarSpy).toHaveBeenCalledTimes(1);
      expect(deflectSpy).not.toHaveBeenCalled();

      // Calling immediately again on tick 101 should not retrigger due to cooldown intervals
      s = { ...s, elapsedTicks: 101 };
      sfx.updateState(s);
      expect(whooshSpy).toHaveBeenCalledTimes(1);
      expect(roarSpy).toHaveBeenCalledTimes(1);

      // Advance by 24 ticks -> triggers wing-whoosh again
      s = { ...s, elapsedTicks: 125 };
      sfx.updateState(s);
      expect(whooshSpy).toHaveBeenCalledTimes(2);
      expect(roarSpy).toHaveBeenCalledTimes(1);

      sfx.dispose();
    });

    it('triggers deflection sound and silences pursuit roar when monster hits shelter forcefield dome', () => {
      const sfx = new Sfx(true);
      const whooshSpy = vi.spyOn(sfx, 'playMonsterWingWhoosh');
      const roarSpy = vi.spyOn(sfx, 'playMonsterPursuitRoar');
      const deflectSpy = vi.spyOn(sfx, 'playMonsterShieldDeflect');

      let s = startPlaying();
      s = {
        ...s,
        elapsedTicks: 200,
        inShelter: true,
        currentShelterId: 'shelter-mushroom-south',
        snake: [{ x: 0, z: 160 }],
        monsterEvent: {
          phase: 'warning',
          countdownSec: 4,
          ticksRemaining: 80,
          maxTicks: 160,
          progress: 0.5,
          monsterPos: { x: 0, z: 144 },
          monsterHeading: 0,
          monsterSpeed: 0.55,
          distanceToPlayer: 16,
          isChasing: true,
          isBlockedByShelter: true,
          targetShelterId: 'shelter-mushroom-south',
        },
      };

      sfx.updateState(s);
      // Deflect sound should play
      expect(deflectSpy).toHaveBeenCalledTimes(1);
      // Whoosh and roar should NOT play because player is in shelter and monster is blocked
      expect(whooshSpy).not.toHaveBeenCalled();
      expect(roarSpy).not.toHaveBeenCalled();

      sfx.dispose();
    });
  });
});
