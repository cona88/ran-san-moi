import { describe, expect, it } from 'vitest';
import { Scene } from 'three';
import {
  Shelter3DView,
  RoamingMonstersView,
  createMermaidPalace,
  createCandyCastle,
  createBlossomSanctuary,
  createStarlightPalace,
  createShelterVisual,
} from '../../src/rendering/shelter3d';
import { createInitialState } from '../../src/core';
import type {
  GameState,
  MonsterEventState,
  RoamingMonster,
  ShelterHouse,
} from '../../src/core/types';

describe('Shelter3DView (3D Behemoth / Storm Dragon Rendering)', () => {
  it('constructs successfully and initializes the monster in idle state', () => {
    const scene = new Scene();
    const view = new Shelter3DView(scene);

    const baseState = createInitialState();
    const idleEvent: MonsterEventState = {
      phase: 'idle',
      ticksRemaining: 1000,
      maxTicks: 1000,
      countdownSec: 50,
      progress: 0,
      monsterPos: { x: 0, z: -100 },
      monsterHeading: 0,
      monsterSpeed: 0,
      distanceToPlayer: 999,
      isChasing: false,
      isBlockedByShelter: false,
      targetShelterId: null,
    };

    const state: GameState = {
      ...baseState,
      monsterEvent: idleEvent,
    };

    view.sync(state);
    view.draw(0, 0.016, state);

    // In idle phase, the monster retreats high in the stratosphere and hides
    const sm = (
      view as unknown as {
        skyMonster: {
          altitude: number;
          dragonGroup: { visible: boolean };
          shadowMesh: { visible: boolean };
        };
      }
    ).skyMonster;
    expect(sm.altitude).toBeGreaterThan(90);
    expect(sm.shadowMesh.visible).toBe(false);

    view.dispose();
  });

  it('renders low-altitude camera-visible pursuit (Y = 3.5..5.5) during warning phase', () => {
    const scene = new Scene();
    const view = new Shelter3DView(scene);

    const baseState = createInitialState();
    const warningEvent: MonsterEventState = {
      phase: 'warning',
      ticksRemaining: 140,
      maxTicks: 160,
      countdownSec: 7,
      progress: 0.125,
      monsterPos: { x: 10, z: 20 },
      monsterHeading: 1.2,
      monsterSpeed: 0.55,
      distanceToPlayer: 22.3,
      isChasing: true,
      isBlockedByShelter: false,
      targetShelterId: null,
    };

    const state: GameState = {
      ...baseState,
      snake: [{ x: 5, z: 5 }],
      monsterEvent: warningEvent,
    };

    view.sync(state);

    // Simulate several animation frames
    for (let i = 0; i < 30; i++) {
      view.draw(i * 0.016, 0.016, state);
    }

    const sm = (
      view as unknown as {
        skyMonster: {
          altitude: number;
          currentX: number;
          currentZ: number;
          dragonGroup: { visible: boolean };
          shadowMesh: { visible: boolean; position: { y: number } };
          lowerJawGroup: { rotation: { x: number } };
          clawLeft: { rotation: { x: number } };
          wingLeft: { rotation: { z: number } };
        };
      }
    ).skyMonster;

    // Must be camera-visible at low altitude Y = 3.5..5.5
    expect(sm.altitude).toBeGreaterThanOrEqual(3.5);
    expect(sm.altitude).toBeLessThanOrEqual(5.5);
    expect(sm.dragonGroup.visible).toBe(true);

    // Ground shadow must be placed directly at terrain plane Y = 0.03
    expect(sm.shadowMesh.visible).toBe(true);
    expect(sm.shadowMesh.position.y).toBeCloseTo(0.03, 2);

    // Monster positions close to simulated monsterPos
    expect(Math.abs(sm.currentX - 10)).toBeLessThan(1.0);
    expect(Math.abs(sm.currentZ - 20)).toBeLessThan(1.0);

    // Claws and jaws are animated
    expect(typeof sm.lowerJawGroup.rotation.x).toBe('number');
    expect(typeof sm.clawLeft.rotation.x).toBe('number');
    expect(typeof sm.wingLeft.rotation.z).toBe('number');

    view.dispose();
  });

  it('activates shield collision animation when isBlockedByShelter is true', () => {
    const scene = new Scene();
    const view = new Shelter3DView(scene);

    const baseState = createInitialState();
    const blockedEvent: MonsterEventState = {
      phase: 'warning',
      ticksRemaining: 80,
      maxTicks: 160,
      countdownSec: 4,
      progress: 0.5,
      monsterPos: { x: 0, z: 18 },
      monsterHeading: 0,
      monsterSpeed: 0,
      distanceToPlayer: 18,
      isChasing: true,
      isBlockedByShelter: true,
      targetShelterId: 'shelter-castle-center',
    };

    const state: GameState = {
      ...baseState,
      inShelter: true,
      currentShelterId: 'shelter-castle-center',
      snake: [{ x: 0, z: 0 }],
      monsterEvent: blockedEvent,
    };

    view.sync(state);

    for (let i = 0; i < 20; i++) {
      view.draw(i * 0.016, 0.016, state);
    }

    const sm = (
      view as unknown as {
        skyMonster: {
          roarIntensity: number;
          lowerJawGroup: { rotation: { x: number } };
          clawSwipePhase: number;
          stormArcs: readonly { visible: boolean }[];
        };
      }
    ).skyMonster;

    // Roar intensity ramps up when blocked
    expect(sm.roarIntensity).toBeGreaterThan(0.5);
    // Lower jaw gapes wide open in a roar (> 0.4 rad)
    expect(sm.lowerJawGroup.rotation.x).toBeGreaterThan(0.4);
    // Claw swiping phase advanced
    expect(sm.clawSwipePhase).toBeGreaterThan(0);
    // Electric storm arcs discharge against shield
    expect(sm.stormArcs.some((a) => a.visible)).toBe(true);

    view.dispose();
  });

  it('performs ferocious strike dive (Y = 1.0..1.5) and snaps jaws during strike phase', () => {
    const scene = new Scene();
    const view = new Shelter3DView(scene);

    const baseState = createInitialState();
    const strikeEvent: MonsterEventState = {
      phase: 'strike',
      ticksRemaining: 10,
      maxTicks: 20,
      countdownSec: 1,
      progress: 0.5,
      monsterPos: { x: 5, z: 5 },
      monsterHeading: 0,
      monsterSpeed: 0,
      distanceToPlayer: 2,
      isChasing: true,
      isBlockedByShelter: false,
      targetShelterId: null,
    };

    const state: GameState = {
      ...baseState,
      snake: [{ x: 5, z: 5 }],
      monsterEvent: strikeEvent,
    };

    view.sync(state);

    for (let i = 0; i < 25; i++) {
      view.draw(i * 0.016, 0.016, state);
    }

    const sm = (
      view as unknown as {
        skyMonster: {
          altitude: number;
          stormArcs: readonly { visible: boolean }[];
          wingLeft: { rotation: { z: number } };
        };
      }
    ).skyMonster;

    // Dives down right to ground/snake height Y = 1.0..1.5
    expect(sm.altitude).toBeLessThanOrEqual(1.8);
    // All storm arcs flare violently
    expect(sm.stormArcs.every((a) => a.visible)).toBe(true);

    view.dispose();
  });

  it('safely disposes all meshes, geometries, and materials without errors', () => {
    const scene = new Scene();
    const view = new Shelter3DView(scene);

    const baseState = createInitialState();
    view.sync(baseState);
    view.draw(1.0, 0.016, baseState);

    expect(() => view.dispose()).not.toThrow();
  });

  describe('Exploration Castles Visuals (Mermaid, Candy, Blossom, Starlight)', () => {
    it('creates Mermaid Palace with conch citadel, coral turrets, glowing pearl dome, ripples and bubbles', () => {
      const shelter: ShelterHouse = {
        id: 'shelter-mermaid-palace',
        kind: 'mermaid',
        x: -180,
        z: 120,
        radius: 15,
        nameVi: '🧜‍♀️ Cung Điện Nàng Tiên Cá Đại Dương',
        colorHex: 0x00e5ff,
      };

      const mesh = createMermaidPalace(shelter);
      expect(mesh).toBeDefined();

      // Check key components
      const pearl = mesh.getObjectByName('mermaidPearl');
      expect(pearl).toBeDefined();
      const ripples = mesh.getObjectByName('mermaidRipples');
      expect(ripples).toBeDefined();

      // Check bubble motes
      const bubble0 = mesh.getObjectByName('mermaidBubble_0');
      expect(bubble0).toBeDefined();

      const visual = createShelterVisual(shelter);
      expect(visual.group).toBeDefined();
      expect(visual.domeMesh).toBeDefined();
    });

    it('creates Candy Castle with marshmallow towers, swirled lollipop spires, spun-sugar crystal roof, rainbow arches', () => {
      const shelter: ShelterHouse = {
        id: 'shelter-candy-castle',
        kind: 'candy',
        x: 180,
        z: -120,
        radius: 15,
        nameVi: '🍭 Lâu Đài Kẹo Ngọt Cầu Vồng',
        colorHex: 0xff69b4,
      };

      const mesh = createCandyCastle(shelter);
      expect(mesh).toBeDefined();

      // Check lollipop spires
      const lolli0 = mesh.getObjectByName('candyLolli_0');
      expect(lolli0).toBeDefined();
      const roofCone = mesh.getObjectByName('candyRoofCone');
      expect(roofCone).toBeDefined();
      const star = mesh.getObjectByName('candyStarFinial');
      expect(star).toBeDefined();

      const visual = createShelterVisual(shelter);
      expect(visual.group).toBeDefined();
    });

    it('creates Blossom Sanctuary with layered petals, butterfly wing entrance, golden pollen', () => {
      const shelter: ShelterHouse = {
        id: 'shelter-blossom-sanctuary',
        kind: 'blossom',
        x: -120,
        z: -180,
        radius: 14,
        nameVi: '🌸 Lâu Đài Hoa Tiên Bướm',
        colorHex: 0xff85c0,
      };

      const mesh = createBlossomSanctuary(shelter);
      expect(mesh).toBeDefined();

      const core = mesh.getObjectByName('blossomCore');
      expect(core).toBeDefined();
      const apex = mesh.getObjectByName('blossomApex');
      expect(apex).toBeDefined();
      const leftWing = mesh.getObjectByName('blossomWingLeft');
      expect(leftWing).toBeDefined();
      const rightWing = mesh.getObjectByName('blossomWingRight');
      expect(rightWing).toBeDefined();
      const pollen0 = mesh.getObjectByName('blossomPollen_0');
      expect(pollen0).toBeDefined();

      const visual = createShelterVisual(shelter);
      expect(visual.group).toBeDefined();
    });

    it('creates Starlight Palace with celestial crystal towers, moon crescent finials, star apex, constellation ring', () => {
      const shelter: ShelterHouse = {
        id: 'shelter-starlight-palace',
        kind: 'starlight',
        x: 120,
        z: 180,
        radius: 14,
        nameVi: '⭐ Cung Điện Tinh Tú Ánh Sao',
        colorHex: 0xb388ff,
      };

      const mesh = createStarlightPalace(shelter);
      expect(mesh).toBeDefined();

      const apex = mesh.getObjectByName('starlightApex');
      expect(apex).toBeDefined();
      const ring = mesh.getObjectByName('constellationRing');
      expect(ring).toBeDefined();
      const crescent0 = mesh.getObjectByName('moonCrescent_0');
      expect(crescent0).toBeDefined();

      const visual = createShelterVisual(shelter);
      expect(visual.group).toBeDefined();
    });

    it('animates all new castle types smoothly in Shelter3DView draw', () => {
      const scene = new Scene();
      const view = new Shelter3DView(scene);

      const castles: ShelterHouse[] = [
        {
          id: 's-mermaid',
          kind: 'mermaid',
          x: -180,
          z: 120,
          radius: 15,
          nameVi: 'Tiên Cá',
          colorHex: 0x00e5ff,
        },
        {
          id: 's-candy',
          kind: 'candy',
          x: 180,
          z: -120,
          radius: 15,
          nameVi: 'Kẹo Ngọt',
          colorHex: 0xff69b4,
        },
        {
          id: 's-blossom',
          kind: 'blossom',
          x: -120,
          z: -180,
          radius: 14,
          nameVi: 'Hoa Tiên',
          colorHex: 0xff85c0,
        },
        {
          id: 's-starlight',
          kind: 'starlight',
          x: 120,
          z: 180,
          radius: 14,
          nameVi: 'Ánh Sao',
          colorHex: 0xb388ff,
        },
      ];

      const baseState = createInitialState();
      const state: GameState = {
        ...baseState,
        shelters: castles,
      };

      view.sync(state);
      expect(() => {
        for (let i = 0; i < 10; i++) {
          view.draw(i * 0.016, 0.016, state);
        }
      }).not.toThrow();

      view.dispose();
    });

    it('renders grand royal architecture details and decorative waystone arches on Shelter3DView', () => {
      const scene = new Scene();
      const view = new Shelter3DView(scene);
      const baseState = createInitialState();

      view.sync(baseState);
      view.draw(1.0, 0.016, baseState);

      const internals = view as unknown as {
        shelterVisuals: readonly {
          shelter: ShelterHouse;
          houseGroup: { getObjectByName(name: string): unknown };
        }[];
        waystonesGroup: { children: readonly unknown[] };
      };

      expect(internals.shelterVisuals.length).toBe(11);
      expect(internals.waystonesGroup.children.length).toBeGreaterThan(0);

      const castle = internals.shelterVisuals.find((v) => v.shelter.kind === 'castle')!;
      expect(castle.houseGroup.getObjectByName('starFinial')).toBeDefined();
      expect(castle.houseGroup.getObjectByName('castleCrownHalo')).toBeDefined();
      expect(castle.houseGroup.getObjectByName('castleFlag_0')).toBeDefined();

      const mermaid = internals.shelterVisuals.find((v) => v.shelter.kind === 'mermaid')!;
      expect(mermaid.houseGroup.getObjectByName('mermaidPearlHalo')).toBeDefined();
      expect(mermaid.houseGroup.getObjectByName('mermaidRibbon_0')).toBeDefined();

      const candy = internals.shelterVisuals.find((v) => v.shelter.kind === 'candy')!;
      expect(candy.houseGroup.getObjectByName('candyMacaron_0')).toBeDefined();

      const blossom = internals.shelterVisuals.find((v) => v.shelter.kind === 'blossom')!;
      expect(blossom.houseGroup.getObjectByName('blossomCrownRing')).toBeDefined();

      const starlight = internals.shelterVisuals.find((v) => v.shelter.kind === 'starlight')!;
      expect(starlight.houseGroup.getObjectByName('starlightOrbitRingA')).toBeDefined();
      expect(starlight.houseGroup.getObjectByName('starlightOrbitRingB')).toBeDefined();

      expect(() => view.dispose()).not.toThrow();
    });
  });

  describe('RoamingMonstersView (3D Roaming Creatures Rendering)', () => {
    it('creates, syncs, animates, and disposes roaming monsters at low altitude (Y: 0.8..1.4) with ground shadows', () => {
      const scene = new Scene();
      const view = new RoamingMonstersView(scene);

      const roamingMonsters: RoamingMonster[] = [
        {
          id: 1,
          kind: 'sea_beast',
          x: -40,
          z: 60,
          heading: 0.5,
          speed: 0.22,
          hp: 3,
          frozenTicks: 0,
        },
        {
          id: 2,
          kind: 'forest_golem',
          x: 70,
          z: -50,
          heading: 1.8,
          speed: 0.2,
          hp: 4,
          frozenTicks: 0,
        },
        {
          id: 3,
          kind: 'candy_troll',
          x: 20,
          z: 80,
          heading: -0.7,
          speed: 0.24,
          hp: 2,
          frozenTicks: 0,
        },
      ];

      const baseState = createInitialState();
      const state: GameState = {
        ...baseState,
        roamingMonsters,
      };

      view.sync(state);

      // Animate 30 frames
      for (let i = 0; i < 30; i++) {
        view.draw(i * 0.016, 0.016, state);
      }

      // Check internal entries
      const entries = (
        view as unknown as {
          entries: Map<
            number,
            {
              currentY: number;
              currentX: number;
              currentZ: number;
              shadowMesh: { visible: boolean; position: { y: number } };
              creatureGroup: { position: { y: number } };
            }
          >;
        }
      ).entries;

      expect(entries.size).toBe(3);

      for (const entry of entries.values()) {
        // Altitude must be low lumbering animation (Y: 0.8 .. 1.4)
        expect(entry.currentY).toBeGreaterThanOrEqual(0.8);
        expect(entry.currentY).toBeLessThanOrEqual(1.4);

        // Ground shadow directly on terrain (Y = 0.03)
        expect(entry.shadowMesh.position.y).toBeCloseTo(0.03, 2);
      }

      // Test frozen creature
      const frozenState: GameState = {
        ...state,
        roamingMonsters: [
          {
            ...roamingMonsters[0]!,
            frozenTicks: 15,
          },
        ],
      };
      view.sync(frozenState);
      expect(entries.size).toBe(1);

      view.draw(1.0, 0.016, frozenState);

      // Test disposal
      expect(() => view.dispose()).not.toThrow();
      expect(entries.size).toBe(0);
    });
  });
});
