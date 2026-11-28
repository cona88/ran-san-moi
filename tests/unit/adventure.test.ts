import { describe, expect, it } from 'vitest';
import {
  ADVENTURE_REGIONS,
  CHAPTER_XP_REWARD,
  createInitialLandmarks,
  createInitialState,
  DEFAULT_LANDMARKS,
  DEFAULT_SHELTERS,
  findNearestUndiscoveredWonder,
  getClimateAt,
  getClimateForRegion,
  getRegionAt,
  LANDMARK_BUTTERFLY_CHARGE_BONUS,
  LANDMARK_DISCOVERY_SCORE,
  LANDMARK_DISCOVERY_XP,
  reduce,
  REGION_CLIMATES,
  stepAdventure,
  type AdventureRegionId,
  type BiomeClimateId,
  type GameState,
} from '../../src/core';

function startPlaying(opts?: Parameters<typeof createInitialState>[0]): GameState {
  const s = reduce(createInitialState({ seed: 42, ...opts }), { type: 'start' });
  return {
    ...s,
    bots: [],
    orbs: [],
    roamingMonsters: [],
    hazards: [],
    quest: null,
  };
}

describe('Colossal Open-World Adventure (src/core/adventure.ts)', () => {
  describe('Initial state, reset, and origin stability', () => {
    it('initializes 6 landmarks, royal_citadel region, and chapter 0 at spawn', () => {
      const ready = createInitialState({ seed: 7 });
      expect(ready.landmarks).toHaveLength(6);
      expect(ready.discoveredLandmarkIds).toEqual([]);
      expect(ready.discoveredShelterIds).toEqual(['shelter-castle-center']);
      expect(ready.visitedRegionIds).toEqual(['royal_citadel']);
      expect(ready.currentRegionId).toBe('royal_citadel');
      expect(ready.adventureChapter).toBe(0);

      // Ticking near (0, 0) with 1 discovered shelter (< 2) keeps chapter 0 and royal_citadel
      let playing = startPlaying({ seed: 7 });
      const rngBefore = playing.rng;
      playing = stepAdventure(playing);
      expect(playing.adventureChapter).toBe(0);
      expect(playing.visitedRegionIds).toEqual(['royal_citadel']);
      expect(playing.currentRegionId).toBe('royal_citadel');
      expect(playing.rng).toEqual(rngBefore);
    });

    it('resets adventure progress cleanly on reset action', () => {
      let s = startPlaying();
      s = {
        ...s,
        snake: [{ x: -82, z: -62 }],
        prevSnake: [{ x: -82, z: -62 }],
      };
      s = reduce(s, { type: 'tick' });
      expect(s.discoveredLandmarkIds).toContain('landmark-world-tree');
      expect(s.adventureChapter).toBe(1);
      expect(s.visitedRegionIds.length).toBeGreaterThan(1);

      const reset = reduce(s, { type: 'reset' });
      expect(reset.discoveredLandmarkIds).toEqual([]);
      expect(reset.discoveredShelterIds).toEqual(['shelter-castle-center']);
      expect(reset.visitedRegionIds).toEqual(['royal_citadel']);
      expect(reset.currentRegionId).toBe('royal_citadel');
      expect(reset.adventureChapter).toBe(0);
    });
  });

  describe('Landmarks geometry and worldRadius scaling', () => {
    it('places all 6 colossal landmarks >= 80u from origin and >= 40u from every shelter', () => {
      expect(DEFAULT_LANDMARKS).toHaveLength(6);
      const kinds = new Set(DEFAULT_LANDMARKS.map((lm) => lm.kind));
      expect(kinds).toEqual(
        new Set([
          'world_tree',
          'rainbow_arch',
          'crystal_falls',
          'astral_observatory',
          'moon_shrine',
          'dragon_colosseum',
        ]),
      );

      for (const lm of DEFAULT_LANDMARKS) {
        const distFromOrigin = Math.hypot(lm.x, lm.z);
        expect(distFromOrigin).toBeGreaterThanOrEqual(80);
        for (const shelter of DEFAULT_SHELTERS) {
          const distToShelter = Math.hypot(lm.x - shelter.x, lm.z - shelter.z);
          expect(distToShelter).toBeGreaterThanOrEqual(40);
        }
      }
    });

    it('scales landmark positions and radii proportionally in createInitialLandmarks', () => {
      const base = createInitialLandmarks(280);
      expect(base).toEqual(DEFAULT_LANDMARKS);
      expect(base[0]).not.toBe(DEFAULT_LANDMARKS[0]);

      const half = createInitialLandmarks(140);
      expect(half[0]!.x).toBe(-41);
      expect(half[0]!.z).toBe(-31);
      expect(half[0]!.radius).toBeGreaterThanOrEqual(8);

      const larger = createInitialLandmarks(420);
      expect(larger[0]!.x).toBe(-123);
      expect(larger[0]!.z).toBe(-93);
    });
  });

  describe('Deterministic 7-region biome partitioning', () => {
    it('maps center (< 62u) and all 6 outer sectors to the 7 expected regions', () => {
      expect(Object.keys(ADVENTURE_REGIONS)).toHaveLength(7);

      expect(getRegionAt({ x: 0, z: 0 }).id).toBe('royal_citadel');
      expect(getRegionAt({ x: 40, z: 40 }).id).toBe('royal_citadel'); // hypot = 56.57 < 62

      expect(getRegionAt({ x: 0, z: -160 }).id).toBe('mushroom_woods');
      expect(getRegionAt({ x: 0, z: -92 }).id).toBe('mushroom_woods');
      expect(getRegionAt({ x: -120, z: -180 }).id).toBe('blossom_valley');
      expect(getRegionAt({ x: 180, z: -120 }).id).toBe('candy_highlands');
      expect(getRegionAt({ x: -180, z: 120 }).id).toBe('mermaid_lagoon');
      expect(getRegionAt({ x: 120, z: 180 }).id).toBe('starlight_peaks');
      expect(getRegionAt({ x: 160, z: 0 }).id).toBe('crystal_sanctum');
      expect(getRegionAt({ x: 0, z: 160 }).id).toBe('crystal_sanctum');
    });

    it('discovers unvisited regions with region_discovered event, zero score/XP change, and zero RNG usage', () => {
      const s0 = startPlaying();
      const moved: GameState = {
        ...s0,
        snake: [{ x: 180, z: -120 }],
        events: [],
      };

      const s1 = stepAdventure(moved);
      expect(s1.currentRegionId).toBe('candy_highlands');
      expect(s1.visitedRegionIds).toEqual(['royal_citadel', 'candy_highlands']);
      expect(s1.score).toBe(moved.score);
      expect(s1.xp).toBe(moved.xp);
      expect(s1.level).toBe(moved.level);
      expect(s1.rng).toEqual(moved.rng);

      const ev = s1.events.find((e) => e.kind === 'region_discovered');
      expect(ev).toBeDefined();
      expect(ev!.regionId).toBe('candy_highlands');
      expect(ev!.messageVi).toContain('Đồi Kẹo Cầu Vồng');

      // Staying in the same region hits the zero-allocation fast path
      const cleanS1 = { ...s1, events: [] };
      const s2 = stepAdventure(cleanS1);
      expect(s2).toBe(cleanS1);

      // Returning to royal_citadel updates currentRegionId without re-emitting region_discovered
      const backHome = stepAdventure({ ...cleanS1, snake: [{ x: 0, z: 0 }] });
      expect(backHome.currentRegionId).toBe('royal_citadel');
      expect(backHome.visitedRegionIds).toEqual(['royal_citadel', 'candy_highlands']);
      expect(backHome.events).toHaveLength(0);
    });
  });

  describe('Colossal landmark discovery and rewards', () => {
    it('discovers a landmark on entry, refills dash, boosts butterflyCharge, awards +200 score & +12 XP, and never touches RNG', () => {
      const base = startPlaying();
      // Set adventureChapter: 1 and 2 shelters so we isolate pure landmark reward from chapter 1 bonus
      const before: GameState = {
        ...base,
        discoveredShelterIds: ['shelter-castle-center', 'shelter-crystal-east'],
        adventureChapter: 1,
        visitedRegionIds: ['royal_citadel', 'mushroom_woods'] as readonly AdventureRegionId[],
        currentRegionId: 'mushroom_woods',
        dashEnergy: 35,
        butterflyCharge: 60,
        xp: 0,
        score: 500,
        best: 500,
        snake: [{ x: -82, z: -62 }], // inside landmark-world-tree
        events: [],
      };

      const after = stepAdventure(before);
      expect(after.discoveredLandmarkIds).toEqual(['landmark-world-tree']);
      expect(after.score).toBe(500 + LANDMARK_DISCOVERY_SCORE);
      expect(after.best).toBe(700);
      expect(after.dashEnergy).toBe(100);
      expect(after.butterflyCharge).toBe(60 + LANDMARK_BUTTERFLY_CHARGE_BONUS);
      expect(after.rng).toEqual(before.rng);

      const lmEv = after.events.find((e) => e.kind === 'landmark_discovered');
      expect(lmEv).toBeDefined();
      expect(lmEv!.landmarkId).toBe('landmark-world-tree');
      expect(lmEv!.points).toBe(LANDMARK_DISCOVERY_SCORE);
      expect(lmEv!.messageVi).toContain('Đại Thụ Thế Giới');

      // Re-stepping inside the already-discovered landmark gives no duplicate reward
      const repeat = stepAdventure({ ...after, events: [] });
      expect(repeat.score).toBe(after.score);
      expect(repeat.events).toHaveLength(0);
    });

    it('levels up and refreshes leaderboard when landmark XP crosses level threshold', () => {
      const base = startPlaying();
      const nearLevelUp: GameState = {
        ...base,
        discoveredShelterIds: ['shelter-castle-center', 'shelter-crystal-east'],
        adventureChapter: 1,
        level: 5,
        xp: 10, // threshold at level 5 is 8 + floor(5 * 1.4) = 15; +12 XP -> 22 >= 15 -> level 6
        snake: [{ x: 88, z: 68 }], // landmark-astral-observatory
        events: [],
      };
      const res = stepAdventure(nearLevelUp);
      expect(res.level).toBeGreaterThan(5);
      expect(res.xp).toBe(10 + LANDMARK_DISCOVERY_XP - 15);
      expect(res.events.some((e) => e.kind === 'level_up')).toBe(true);
      expect(res.leaderboard.find((e) => e.isPlayer)?.level).toBe(res.level);
    });
  });

  describe('4-Chapter wonder progression (thresholds 2, 5, 8, 12)', () => {
    it('advances chapters step-by-step and handles multi-chapter jumps cleanly', () => {
      const base = startPlaying();

      // Jump straight from chapter 0 to 5 total wonders (crosses Chapter 1 at 2 and Chapter 2 at 5)
      const fiveWonders: GameState = {
        ...base,
        discoveredShelterIds: [
          'shelter-castle-center',
          'shelter-mushroom-north',
          'shelter-crystal-east',
        ],
        discoveredLandmarkIds: ['landmark-world-tree', 'landmark-moon-shrine'],
        adventureChapter: 0,
        score: 0,
        xp: 0,
        events: [],
      };

      const afterJump = stepAdventure(fiveWonders);
      expect(afterJump.adventureChapter).toBe(2);
      // Chapter 1 (+250) + Chapter 2 (+400) = 650
      expect(afterJump.score).toBe(250 + 400);
      const chEvents = afterJump.events.filter((e) => e.kind === 'chapter_complete');
      expect(chEvents.map((e) => e.chapter)).toEqual([1, 2]);
      expect(chEvents[0]!.messageVi).toContain('Chương 1: Khởi Hành Thám Hiểm');
      expect(chEvents[1]!.messageVi).toContain('Chương 2: Dấu Chân Bốn Phương');

      // Advance from Chapter 2 to Chapter 4 at 12 wonders (crosses Chapter 3 at 8 and Chapter 4 at 12)
      const twelveWonders: GameState = {
        ...afterJump,
        discoveredShelterIds: DEFAULT_SHELTERS.slice(0, 8).map((s) => s.id),
        discoveredLandmarkIds: DEFAULT_LANDMARKS.slice(0, 4).map((l) => l.id),
        events: [],
      };
      const scoreBefore = twelveWonders.score;
      const afterAll = stepAdventure(twelveWonders);
      expect(afterAll.adventureChapter).toBe(4);
      expect(afterAll.score).toBe(scoreBefore + 600 + 1000);
      const chEvents2 = afterAll.events.filter((e) => e.kind === 'chapter_complete');
      expect(chEvents2.map((e) => e.chapter)).toEqual([3, 4]);
      expect(chEvents2[0]!.messageVi).toContain('Chương 3: Hiệp Sĩ Kỳ Quan');
      expect(chEvents2[1]!.messageVi).toContain('Chương 4: Huyền Thoại Vương Quốc');
      expect(CHAPTER_XP_REWARD).toBe(15);
    });
  });

  describe('Adventure Compass (findNearestUndiscoveredWonder)', () => {
    it('finds nearest undiscovered landmark or shelter and returns null when all 17 are discovered', () => {
      const s = startPlaying();
      // At (0, -10), Moon Shrine (0, -92) is distance 82, closer than any outer shelter
      const fromCenter = findNearestUndiscoveredWonder({ x: 0, z: -10 }, s);
      expect(fromCenter).not.toBeNull();
      expect(fromCenter!.id).toBe('landmark-moon-shrine');
      expect(fromCenter!.isLandmark).toBe(true);
      expect(fromCenter!.icon).toBe('🌙');
      expect(fromCenter!.distance).toBeCloseTo(82, 5);

      // Near East Crystal Sanctuary (160, 0), that shelter is the closest undiscovered wonder
      const nearEast = findNearestUndiscoveredWonder({ x: 150, z: 0 }, s);
      expect(nearEast).not.toBeNull();
      expect(nearEast!.id).toBe('shelter-crystal-east');
      expect(nearEast!.isLandmark).toBe(false);
      expect(nearEast!.icon).toBe('💎');
      expect(nearEast!.distance).toBeCloseTo(10, 5);

      // All 11 shelters + 6 landmarks discovered -> null
      const completed = findNearestUndiscoveredWonder(
        { x: 0, z: 0 },
        {
          shelters: s.shelters,
          discoveredShelterIds: s.shelters.map((sh) => sh.id),
          landmarks: s.landmarks,
          discoveredLandmarkIds: s.landmarks.map((lm) => lm.id),
        },
      );
      expect(completed).toBeNull();
    });
  });

  describe('7-Region Climate Model (REGION_CLIMATES, getClimateForRegion, getClimateAt)', () => {
    it('defines distinct climates with complete metadata for all 7 kingdom regions', () => {
      const expectedClimates: Readonly<Record<AdventureRegionId, BiomeClimateId>> = {
        royal_citadel: 'temperate_sunny',
        mushroom_woods: 'misty_rainforest',
        blossom_valley: 'spring_blossom',
        crystal_sanctum: 'alpine_frost',
        mermaid_lagoon: 'tropical_lagoon',
        candy_highlands: 'golden_highlands',
        starlight_peaks: 'aurora_peaks',
      };

      const regionIds = Object.keys(ADVENTURE_REGIONS) as AdventureRegionId[];
      expect(Object.keys(REGION_CLIMATES)).toHaveLength(7);

      const seenClimateIds = new Set<BiomeClimateId>();
      for (const regionId of regionIds) {
        const climate = getClimateForRegion(regionId);
        expect(climate).toBe(REGION_CLIMATES[regionId]);
        expect(climate.regionId).toBe(regionId);
        expect(climate.id).toBe(expectedClimates[regionId]);
        expect(climate.nameVi.length).toBeGreaterThan(0);
        expect(climate.weatherVi.length).toBeGreaterThan(0);
        expect(climate.icon.length).toBeGreaterThan(0);
        expect(Number.isFinite(climate.temperatureC)).toBe(true);
        expect(climate.accentHex).toBeGreaterThan(0);
        seenClimateIds.add(climate.id);
      }
      expect(seenClimateIds.size).toBe(7);

      // Cold alpine/aurora regions stay below 0°C while tropical lagoon is warmest
      expect(getClimateForRegion('crystal_sanctum').temperatureC).toBeLessThan(0);
      expect(getClimateForRegion('starlight_peaks').temperatureC).toBeLessThan(0);
      expect(getClimateForRegion('mermaid_lagoon').temperatureC).toBeGreaterThan(
        getClimateForRegion('royal_citadel').temperatureC,
      );
    });

    it('maps world coordinates deterministically via getClimateAt consistent with getRegionAt', () => {
      const samples: Array<{ pos: { x: number; z: number }; regionId: AdventureRegionId; climateId: BiomeClimateId }> = [
        { pos: { x: 0, z: 0 }, regionId: 'royal_citadel', climateId: 'temperate_sunny' },
        { pos: { x: 0, z: -160 }, regionId: 'mushroom_woods', climateId: 'misty_rainforest' },
        { pos: { x: -120, z: -180 }, regionId: 'blossom_valley', climateId: 'spring_blossom' },
        { pos: { x: 160, z: 0 }, regionId: 'crystal_sanctum', climateId: 'alpine_frost' },
        { pos: { x: -180, z: 120 }, regionId: 'mermaid_lagoon', climateId: 'tropical_lagoon' },
        { pos: { x: 180, z: -120 }, regionId: 'candy_highlands', climateId: 'golden_highlands' },
        { pos: { x: 120, z: 180 }, regionId: 'starlight_peaks', climateId: 'aurora_peaks' },
      ];

      for (const sample of samples) {
        const region = getRegionAt(sample.pos);
        const climate = getClimateAt(sample.pos);
        expect(region.id).toBe(sample.regionId);
        expect(climate.regionId).toBe(region.id);
        expect(climate.id).toBe(sample.climateId);
        expect(climate).toEqual(getClimateForRegion(region.id));
      }
    });
  });
});
