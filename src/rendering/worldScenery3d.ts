/**
 * "Vương Quốc Huyền Thoại Hoành Tráng" — Colossal 3D Open-World Scenery.
 *
 * Purely deterministic (seeded Mulberry32 PRNG + SimplexNoise),
 * GPU-batched (mergeGeometries + 20 InstancedMeshes for ~2,340 multi-layered biome flora,
 * rock outcrops, riverbank reeds & rolling hillocks + 1 InstancedMesh for 24 volumetric clouds),
 * zero per-frame allocations inside `draw()`, and 100% leak-free in `dispose()`.
 */
import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Material,
  type Scene,
} from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DEFAULT_LANDMARKS, getRegionAt } from '../core/adventure';
import { DEFAULT_SHELTERS } from '../core/shelter';
import type {
  AdventureRegionId,
  GameState,
  ShelterHouse,
  VisualTheme,
  WorldLandmark,
} from '../core/types';
import {
  createBiomePropArchetypes,
  type BiomePropArchetype,
  type BiomePropKind,
} from './biomeProps3d';

const SKY_DOME_RADIUS = 1080;
const CLOUD_COUNT = 24;
const SKY_CITADEL_COUNT = 10;
const LANDMARK_DETAIL_CULL_DIST_SQ = 185 * 185;
const ROAD_Y = -0.482;
const RIVER_Y = -0.476;
const OCEAN_Y = -1.8;

interface SeededRng {
  next(): number;
  random(): number;
}

/** Deterministic Mulberry32 PRNG — purely seeded and repeatable. */
function createSeededRng(seed: number): SeededRng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, random: next };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

interface SkyThemeSpec {
  readonly zenithHex: number;
  readonly midHex: number;
  readonly horizonHex: number;
  readonly sunHex: number;
  readonly twinMoonHex: number;
  readonly twinMoonOpacity: number;
  readonly auroraA: number;
  readonly auroraB: number;
  readonly auroraOpacity: number;
  readonly cloudHex: number;
  readonly oceanHex: number;
  readonly oceanEmissiveHex: number;
  readonly foamHex: number;
  readonly riverHex: number;
  readonly riverEmissiveHex: number;
  readonly mtnAtmosphereHex: number;
  readonly mtnRockHex: number;
  readonly mtnTitanBaseHex: number;
  readonly mtnTitanPeakHex: number;
}

const SKY_THEMES: Readonly<Record<VisualTheme, SkyThemeSpec>> = {
  honeycomb_arena: {
    zenithHex: 0xee9f4a,
    midHex: 0xfad296,
    horizonHex: 0xf7e4c5,
    sunHex: 0xfff5bd,
    twinMoonHex: 0xffd6a5,
    twinMoonOpacity: 0.58,
    auroraA: 0xffd166,
    auroraB: 0xff9770,
    auroraOpacity: 0.22,
    cloudHex: 0xfff9ee,
    oceanHex: 0x2cb7d8,
    oceanEmissiveHex: 0x16789c,
    foamHex: 0xfff8e6,
    riverHex: 0x3ef2ff,
    riverEmissiveHex: 0x14b8d4,
    mtnAtmosphereHex: 0x62739e,
    mtnRockHex: 0x4f5a7a,
    mtnTitanBaseHex: 0x566494,
    mtnTitanPeakHex: 0xfff7e4,
  },
  crystal_garden: {
    zenithHex: 0x0f0526,
    midHex: 0x361569,
    horizonHex: 0x220f47,
    sunHex: 0xffb8f2,
    twinMoonHex: 0x7ef7e4,
    twinMoonOpacity: 0.9,
    auroraA: 0x48f5d2,
    auroraB: 0xff6be6,
    auroraOpacity: 0.48,
    cloudHex: 0xdab6ff,
    oceanHex: 0x182b6e,
    oceanEmissiveHex: 0x285888,
    foamHex: 0x9ef9ef,
    riverHex: 0x52f8ff,
    riverEmissiveHex: 0x20d6e8,
    mtnAtmosphereHex: 0x3b2270,
    mtnRockHex: 0x54328e,
    mtnTitanBaseHex: 0x2e1b63,
    mtnTitanPeakHex: 0xf2d9ff,
  },
  starlight_galaxy: {
    zenithHex: 0x030716,
    midHex: 0x102460,
    horizonHex: 0x0b1538,
    sunHex: 0xc4e8ff,
    twinMoonHex: 0xffe28a,
    twinMoonOpacity: 0.96,
    auroraA: 0x38f6ff,
    auroraB: 0xb388ff,
    auroraOpacity: 0.52,
    cloudHex: 0x9ec5ff,
    oceanHex: 0x0a2254,
    oceanEmissiveHex: 0x1a4b8a,
    foamHex: 0x8be9ff,
    riverHex: 0x4ef6ff,
    riverEmissiveHex: 0x22a8ff,
    mtnAtmosphereHex: 0x1c2b66,
    mtnRockHex: 0x2f4185,
    mtnTitanBaseHex: 0x152052,
    mtnTitanPeakHex: 0xd8f2ff,
  },
  candy_island: {
    zenithHex: 0x774e90,
    midHex: 0xc479a5,
    horizonHex: 0x986882,
    sunHex: 0xfff0b8,
    twinMoonHex: 0xa8ffea,
    twinMoonOpacity: 0.74,
    auroraA: 0xffa6dc,
    auroraB: 0x8ff5dd,
    auroraOpacity: 0.36,
    cloudHex: 0xffeaf6,
    oceanHex: 0x3ecfd6,
    oceanEmissiveHex: 0x249fb0,
    foamHex: 0xfff0fa,
    riverHex: 0x62f8f5,
    riverEmissiveHex: 0x2cd4d8,
    mtnAtmosphereHex: 0x7a558c,
    mtnRockHex: 0x966399,
    mtnTitanBaseHex: 0x6e4a85,
    mtnTitanPeakHex: 0xfff0fa,
  },
};

const M4_SCRATCH = new Matrix4();
const POS_SCRATCH = new Vector3();
const SCALE_SCRATCH = new Vector3();
const EULER_SCRATCH = new Euler();
const QUAT_SCRATCH = new Quaternion();
const COL_BOTTOM = new Color();
const COL_MID = new Color();
const COL_TOP = new Color();
const COL_TMP = new Color();
const COL_SLOPE = new Color();
const COL_ROCK = new Color();
const COL_PEAK = new Color();
const COL_ATMO = new Color();

/**
 * Convert any primitive BufferGeometry into a non-indexed geometry with `{ position, normal, color }`
 * attributes and optional two-tone vertical color gradient, disposing `rawGeo` immediately.
 */
function bakePart(
  rawGeo: BufferGeometry,
  bottomHex: number,
  topHex: number = bottomHex,
  tx = 0,
  ty = 0,
  tz = 0,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): BufferGeometry {
  const geo = rawGeo.index ? rawGeo.toNonIndexed() : rawGeo.clone();
  rawGeo.dispose();

  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'normal') {
      geo.deleteAttribute(name);
    }
  }

  const pos = geo.attributes['position']!;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanY = Math.max(1e-4, maxY - minY);

  COL_BOTTOM.setHex(bottomHex);
  COL_TOP.setHex(topHex);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) / spanY;
    COL_TMP.copy(COL_BOTTOM).lerp(COL_TOP, t);
    colors[i * 3] = COL_TMP.r;
    colors[i * 3 + 1] = COL_TMP.g;
    colors[i * 3 + 2] = COL_TMP.b;
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));

  EULER_SCRATCH.set(rx, ry, rz);
  QUAT_SCRATCH.setFromEuler(EULER_SCRATCH);
  POS_SCRATCH.set(tx, ty, tz);
  SCALE_SCRATCH.set(sx, sy, sz);
  M4_SCRATCH.compose(POS_SCRATCH, QUAT_SCRATCH, SCALE_SCRATCH);
  geo.applyMatrix4(M4_SCRATCH);

  if (!geo.attributes['normal']) {
    geo.computeVertexNormals();
  }
  return geo;
}

function mergeParts(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged ?? new BoxGeometry(0.1, 0.1, 0.1);
}

interface CloudSlot {
  readonly baseAngle: number;
  readonly radius: number;
  readonly baseY: number;
  readonly speed: number;
  readonly bobPhase: number;
  readonly scale: number;
}

interface AuroraRibbonAnim {
  readonly mesh: Mesh;
  readonly mat: MeshBasicMaterial;
  readonly baseY: number;
  readonly baseRotY: number;
  readonly speed: number;
  readonly phase: number;
}

interface MountainColorMeta {
  readonly geo: BufferGeometry;
  readonly heights: Float32Array;
  readonly dirX: Float32Array;
  readonly dirZ: Float32Array;
  readonly isOuter: boolean;
}

interface SkyCitadelAnim {
  readonly group: Group;
  readonly coreCrystal: Mesh;
  readonly runeRingA: Mesh;
  readonly runeRingB: Mesh;
  readonly satelliteRing: Group;
  readonly waterfall: Mesh;
  readonly waterfallMat: MeshBasicMaterial;
  readonly mistRingOuter: Mesh;
  readonly mistRingInner: Mesh;
  readonly baseY: number;
  readonly bobSpeed: number;
  readonly phase: number;
}

interface BannerAnim {
  readonly mesh: Mesh;
  readonly baseRotY: number;
  readonly phase: number;
}

interface LeafSwirlItem {
  readonly mesh: Mesh;
  readonly radius: number;
  readonly baseAngle: number;
  readonly minY: number;
  readonly spanY: number;
  readonly speed: number;
  readonly phase: number;
}

interface OrbitPlanetItem {
  readonly mesh: Mesh;
  readonly radius: number;
  readonly centerY: number;
  readonly tilt: number;
  readonly speed: number;
  readonly phase: number;
}

interface LandmarkVisual {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly colorHex: number;
  readonly root: Group;
  readonly detailGroup: Group;
  readonly spinItems: readonly Mesh[];
  readonly bobItems: readonly {
    readonly mesh: Mesh;
    readonly baseY: number;
    readonly phase: number;
  }[];
  readonly pulseRings: readonly Mesh[];
  readonly leafItems: readonly LeafSwirlItem[];
  readonly orbitPlanets: readonly OrbitPlanetItem[];
  readonly beaconBeam: Mesh;
  readonly beaconMat: MeshBasicMaterial;
  readonly groundRing: Mesh;
  readonly groundRingMat: MeshBasicMaterial;
  discovered: boolean;
}

interface Segment2D {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
}

interface LakeCircle2D {
  readonly x: number;
  readonly z: number;
  readonly r: number;
}

function distSqPointToSeg2D(px: number, pz: number, s: Segment2D): number {
  const vx = s.bx - s.ax;
  const vz = s.bz - s.az;
  const wx = px - s.ax;
  const wz = pz - s.az;
  const lenSq = vx * vx + vz * vz;
  if (lenSq < 1e-6) return wx * wx + wz * wz;
  const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / lenSq));
  const dx = px - (s.ax + vx * t);
  const dz = pz - (s.az + vz * t);
  return dx * dx + dz * dz;
}

/**
 * Renders the colossal AAA fantasy kingdom surrounding and enriching the 560×560 world:
 * - Panoramic Sky Dome (r = 1080), twin moons, Aurora Borealis ribbons & 24 instanced clouds
 * - Shimmering Outer Ocean + Double-Layered Fog-Free Mega-Mountain Ranges (Inner 65–125u + Outer Titans 160–260u!)
 * - 4 Luminous Starlight Rivers, Crystal Lakes, 6 Grand Arched Marble Bridges & 5.2u Royal Avenues with Triumphal Archways
 * - 10 Colossal Floating Sky Citadels (1.8× Laputa scale) with multi-stream waterfalls, rune rings & orbiting boulders
 * - 6 Legendary Colossal Wonders (45–58u tall) with sky beacons & distance-culled sub-details
 * - ~760 Clustered Multi-Scale Biome Grove Props across 8 InstancedMesh batches (8 draw calls total!)
 */
export class WorldScenery3DView {
  private readonly root = new Group();

  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];

  // Sky & atmosphere
  private skyDomeGeo!: SphereGeometry;
  private sunMat!: MeshBasicMaterial;
  private sunHaloMat!: MeshBasicMaterial;
  private twinMoonMat!: MeshBasicMaterial;
  private twinMoonHaloMat!: MeshBasicMaterial;
  private cloudMat!: MeshStandardMaterial;
  private cloudInst!: InstancedMesh;
  private readonly cloudSlots: CloudSlot[] = [];
  private readonly auroraRibbons: AuroraRibbonAnim[] = [];

  // Ocean, rivers & mountains
  private oceanMat!: MeshStandardMaterial;
  private foamMat!: MeshBasicMaterial;
  private riverMat!: MeshStandardMaterial;
  private mtnSeamMat!: MeshBasicMaterial;
  private readonly mountainMetas: MountainColorMeta[] = [];
  private readonly skyCitadels: SkyCitadelAnim[] = [];
  private readonly banners: BannerAnim[] = [];

  // Dynamic world layout (rebuilt only if worldRadius / shelter / landmark layout changes)
  private readonly worldGroup = new Group();
  private readonly worldGeos: BufferGeometry[] = [];
  private readonly worldMats: Material[] = [];
  private readonly worldInstancedMeshes: InstancedMesh[] = [];
  private readonly landmarks: LandmarkVisual[] = [];
  private crystalPropMat?: MeshStandardMaterial;
  private builtSignature = '';
  private lastDiscoveredRef: readonly string[] | null = null;
  private currentTheme: VisualTheme = 'honeycomb_arena';

  constructor(
    private readonly scene: Scene,
    initialWorldRadius = 280,
  ) {
    this.root.name = 'worldScenery3D';
    this.buildSkyAndClouds();
    this.root.add(this.worldGroup);
    this.rebuildWorldLayout(initialWorldRadius, DEFAULT_SHELTERS, DEFAULT_LANDMARKS);
    this.setTheme(this.currentTheme);
    this.scene.add(this.root);
  }

  /** Sync world landmarks, shelters & discovery beacon states on game ticks. */
  sync(state: GameState): void {
    const worldRadius = state.config.worldRadius;
    const shelters = state.shelters ?? DEFAULT_SHELTERS;
    const landmarks = state.landmarks ?? DEFAULT_LANDMARKS;
    const firstLm = landmarks[0];
    const sig = `${worldRadius}|${shelters.length}|${landmarks.length}|${firstLm ? firstLm.x : 0}`;
    if (sig !== this.builtSignature) {
      this.rebuildWorldLayout(worldRadius, shelters, landmarks);
      this.lastDiscoveredRef = null;
    }

    const discovered = state.discoveredLandmarkIds ?? [];
    if (discovered !== this.lastDiscoveredRef) {
      this.lastDiscoveredRef = discovered;
      for (let i = 0; i < this.landmarks.length; i++) {
        const lm = this.landmarks[i]!;
        lm.discovered = discovered.includes(lm.id);
      }
    }
  }

  /** Adapt sky dome, twin moons, aurora ribbons, clouds, rivers, ocean & fog-free mountains to the theme. */
  setTheme(theme: VisualTheme): void {
    this.currentTheme = theme;
    const spec = SKY_THEMES[theme];
    this.updateSkyDomeColors(spec);

    this.sunMat.color.setHex(spec.sunHex);
    this.sunHaloMat.color.setHex(spec.sunHex);
    this.twinMoonMat.color.setHex(spec.twinMoonHex);
    this.twinMoonMat.opacity = spec.twinMoonOpacity;
    this.twinMoonHaloMat.color.setHex(spec.twinMoonHex);
    this.twinMoonHaloMat.opacity = spec.twinMoonOpacity * 0.34;
    this.cloudMat.color.setHex(spec.cloudHex);
    this.cloudMat.emissive.setHex(spec.horizonHex);
    this.cloudMat.emissiveIntensity =
      theme === 'honeycomb_arena' ? 0.24 : theme === 'candy_island' ? 0.3 : 0.44;

    for (let i = 0; i < this.auroraRibbons.length; i++) {
      const ribbon = this.auroraRibbons[i]!;
      ribbon.mat.color.setHex(i % 2 === 0 ? spec.auroraA : spec.auroraB);
      ribbon.mat.opacity = spec.auroraOpacity;
    }

    if (this.oceanMat) {
      this.oceanMat.color.setHex(spec.oceanHex);
      this.oceanMat.emissive.setHex(spec.oceanEmissiveHex);
    }
    if (this.foamMat) {
      this.foamMat.color.setHex(spec.foamHex);
    }
    if (this.riverMat) {
      this.riverMat.color.setHex(spec.riverHex);
      this.riverMat.emissive.setHex(spec.riverEmissiveHex);
    }
    if (this.mtnSeamMat) {
      this.mtnSeamMat.color.setHex(spec.auroraA);
    }
    if (this.crystalPropMat) {
      this.crystalPropMat.emissive.setHex(spec.horizonHex);
      this.crystalPropMat.emissiveIntensity =
        theme === 'honeycomb_arena' ? 0.14 : theme === 'candy_island' ? 0.18 : 0.3;
    }

    for (let i = 0; i < this.mountainMetas.length; i++) {
      this.applyMountainThemeColors(this.mountainMetas[i]!, spec);
    }
  }

  /**
   * Animate instanced clouds, aurora ribbons, rivers, banners, 10 floating sky citadels,
   * and nearby landmark sub-details at 60fps with ZERO heap allocations.
   */
  draw(elapsed: number, _delta: number, _state: GameState, focusPos: Vector3): void {
    const spec = SKY_THEMES[this.currentTheme];

    // 1. Drifting low-poly volumetric cloud clusters (single InstancedMesh!)
    for (let i = 0; i < this.cloudSlots.length; i++) {
      const c = this.cloudSlots[i]!;
      const a = c.baseAngle + elapsed * c.speed;
      POS_SCRATCH.set(
        Math.cos(a) * c.radius,
        c.baseY + Math.sin(elapsed * 0.45 + c.bobPhase) * 1.4,
        Math.sin(a) * c.radius,
      );
      EULER_SCRATCH.set(0, -a + Math.PI * 0.5, 0);
      QUAT_SCRATCH.setFromEuler(EULER_SCRATCH);
      SCALE_SCRATCH.set(c.scale, c.scale * 0.84, c.scale);
      M4_SCRATCH.compose(POS_SCRATCH, QUAT_SCRATCH, SCALE_SCRATCH);
      this.cloudInst.setMatrixAt(i, M4_SCRATCH);
    }
    this.cloudInst.instanceMatrix.needsUpdate = true;

    // 2. Undulating Aurora Borealis ribbons
    for (let i = 0; i < this.auroraRibbons.length; i++) {
      const r = this.auroraRibbons[i]!;
      r.mesh.rotation.y = r.baseRotY + Math.sin(elapsed * r.speed + r.phase) * 0.08;
      r.mesh.position.y = r.baseY + Math.sin(elapsed * 0.35 + r.phase) * 3.8;
      r.mat.opacity = spec.auroraOpacity * (0.78 + 0.22 * Math.sin(elapsed * 0.9 + r.phase));
    }

    // 3. Ocean foam, mountain crystal seams & Starlight River shimmer
    if (this.foamMat) {
      this.foamMat.opacity = 0.48 + 0.16 * Math.sin(elapsed * 1.9);
    }
    if (this.oceanMat) {
      this.oceanMat.emissiveIntensity = 0.38 + 0.08 * Math.sin(elapsed * 1.3);
    }
    if (this.riverMat) {
      this.riverMat.emissiveIntensity = 0.54 + 0.18 * Math.sin(elapsed * 2.8);
    }
    if (this.mtnSeamMat) {
      this.mtnSeamMat.opacity = 0.65 + 0.22 * Math.sin(elapsed * 2.1);
    }

    // 4. Fluttering Triumphal Avenue Banners
    for (let i = 0; i < this.banners.length; i++) {
      const b = this.banners[i]!;
      b.mesh.rotation.y = b.baseRotY + Math.sin(elapsed * 4.4 + b.phase) * 0.22;
      b.mesh.rotation.z = Math.sin(elapsed * 3.6 + b.phase * 1.3) * 0.09;
    }

    // 5. 10 Colossal Floating Sky Citadels + rune rings + satellite boulders + multi-stream waterfalls
    for (let i = 0; i < this.skyCitadels.length; i++) {
      const cit = this.skyCitadels[i]!;
      cit.group.position.y = cit.baseY + Math.sin(elapsed * cit.bobSpeed + cit.phase) * 1.85;
      cit.coreCrystal.rotation.y = elapsed * 1.3 + cit.phase;
      cit.runeRingA.rotation.z = elapsed * 0.85 + cit.phase;
      cit.runeRingB.rotation.z = -elapsed * 1.15 - cit.phase;
      cit.satelliteRing.rotation.y = elapsed * 0.28 + cit.phase;

      cit.waterfallMat.opacity = 0.78 + 0.2 * Math.sin(elapsed * 5.2 + cit.phase);
      cit.waterfall.scale.x = 0.93 + 0.11 * Math.sin(elapsed * 6.4 + cit.phase);
      const mistWave = (elapsed * 0.6 + cit.phase * 0.3) % 1;
      cit.mistRingOuter.scale.setScalar(0.85 + mistWave * 0.95);
      cit.mistRingInner.scale.setScalar(0.65 + ((mistWave + 0.5) % 1) * 0.8);
    }

    // 6. 6 Legendary Colossal Wonders (45–58u tall): beacons + distance-culled fine animations
    const fx = focusPos.x;
    const fz = focusPos.z;
    for (let i = 0; i < this.landmarks.length; i++) {
      const lm = this.landmarks[i]!;
      const pulseFreq = lm.discovered ? 4.4 : 1.9;
      const baseBeam = lm.discovered ? 0.26 : 0.11;
      const ampBeam = lm.discovered ? 0.1 : 0.04;
      lm.beaconMat.opacity = baseBeam + ampBeam * Math.sin(elapsed * pulseFreq + i);
      lm.beaconBeam.rotation.y = elapsed * (lm.discovered ? 0.65 : 0.25);
      lm.groundRingMat.opacity =
        (lm.discovered ? 0.68 : 0.4) + 0.16 * Math.sin(elapsed * (lm.discovered ? 3.8 : 2.0) + i);
      lm.groundRing.rotation.z = elapsed * 0.22;

      const dx = lm.x - fx;
      const dz = lm.z - fz;
      const near = dx * dx + dz * dz <= LANDMARK_DETAIL_CULL_DIST_SQ;
      if (near) {
        if (!lm.detailGroup.parent) lm.root.add(lm.detailGroup);
        for (let s = 0; s < lm.spinItems.length; s++) {
          const item = lm.spinItems[s]!;
          const dir = s % 2 === 0 ? 1 : -1;
          item.rotation.y = elapsed * dir * (0.7 + s * 0.24);
          if (s % 2 === 1) {
            item.rotation.x = Math.sin(elapsed * 0.65 + s) * 0.55;
          } else if (s >= 2) {
            item.rotation.z = elapsed * 0.48;
          }
        }
        for (let b = 0; b < lm.bobItems.length; b++) {
          const bi = lm.bobItems[b]!;
          bi.mesh.position.y = bi.baseY + Math.sin(elapsed * 2.4 + bi.phase) * 0.55;
          bi.mesh.rotation.y = elapsed * 0.9 + bi.phase;
        }
        for (let p = 0; p < lm.pulseRings.length; p++) {
          const pr = lm.pulseRings[p]!;
          pr.scale.setScalar(0.88 + 0.24 * Math.sin(elapsed * 4.4 + p * 1.2));
        }
        for (let l = 0; l < lm.leafItems.length; l++) {
          const lf = lm.leafItems[l]!;
          const fallT = (elapsed * lf.speed + lf.phase) % 1;
          const a = lf.baseAngle + elapsed * 0.65 + fallT * 4.5;
          const r = lf.radius * (0.75 + 0.35 * Math.sin(fallT * Math.PI));
          lf.mesh.position.set(Math.cos(a) * r, lf.minY + (1 - fallT) * lf.spanY, Math.sin(a) * r);
          lf.mesh.rotation.y = a * 2;
          lf.mesh.rotation.x = elapsed * 2.5 + lf.phase;
        }
        for (let o = 0; o < lm.orbitPlanets.length; o++) {
          const pl = lm.orbitPlanets[o]!;
          const a = elapsed * pl.speed + pl.phase;
          const cx = Math.cos(a) * pl.radius;
          const cz = Math.sin(a) * pl.radius;
          pl.mesh.position.set(cx, pl.centerY + Math.sin(a) * pl.radius * pl.tilt, cz);
          pl.mesh.rotation.y = elapsed * 1.6 + pl.phase;
        }
      } else if (lm.detailGroup.parent) {
        lm.root.remove(lm.detailGroup);
      }
    }
  }

  dispose(): void {
    this.disposeWorldLayout();
    this.scene.remove(this.root);
    this.cloudInst.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.cloudSlots.length = 0;
    this.auroraRibbons.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Sky Dome (r = 1080), Celestial Moons, Aurora Ribbons & 24 Instanced Clouds
  // ---------------------------------------------------------------------------

  private buildSkyAndClouds(): void {
    this.skyDomeGeo = new SphereGeometry(SKY_DOME_RADIUS, 40, 24);
    const pos = this.skyDomeGeo.attributes['position']!;
    this.skyDomeGeo.setAttribute(
      'color',
      new Float32BufferAttribute(new Float32Array(pos.count * 3), 3),
    );
    this.geometries.push(this.skyDomeGeo);

    const skyMat = new MeshBasicMaterial({
      vertexColors: true,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.materials.push(skyMat);
    const skyDome = new Mesh(this.skyDomeGeo, skyMat);
    skyDome.frustumCulled = false;
    skyDome.renderOrder = -20;
    this.root.add(skyDome);

    // Primary Sun / Celestial Moon + Halo
    const sunGeo = new SphereGeometry(34, 20, 16);
    const sunHaloGeo = new RingGeometry(36, 68, 32);
    this.geometries.push(sunGeo, sunHaloGeo);
    this.sunMat = new MeshBasicMaterial({ color: 0xfff5bd, fog: false, depthWrite: false });
    this.sunHaloMat = new MeshBasicMaterial({
      color: 0xfff5bd,
      transparent: true,
      opacity: 0.28,
      side: DoubleSide,
      fog: false,
      depthWrite: false,
    });
    this.materials.push(this.sunMat, this.sunHaloMat);

    const sunMesh = new Mesh(sunGeo, this.sunMat);
    sunMesh.position.set(-230, 265, -660);
    const sunHalo = new Mesh(sunHaloGeo, this.sunHaloMat);
    sunHalo.position.copy(sunMesh.position);
    sunHalo.lookAt(0, 0, 0);
    this.root.add(sunMesh, sunHalo);

    // Glowing Twin Moon
    const twinGeo = new SphereGeometry(22, 18, 14);
    const twinHaloGeo = new RingGeometry(24, 44, 28);
    this.geometries.push(twinGeo, twinHaloGeo);
    this.twinMoonMat = new MeshBasicMaterial({
      color: 0xffe28a,
      transparent: true,
      opacity: 0.85,
      fog: false,
      depthWrite: false,
    });
    this.twinMoonHaloMat = new MeshBasicMaterial({
      color: 0xffe28a,
      transparent: true,
      opacity: 0.3,
      side: DoubleSide,
      fog: false,
      depthWrite: false,
    });
    this.materials.push(this.twinMoonMat, this.twinMoonHaloMat);

    const twinMoon = new Mesh(twinGeo, this.twinMoonMat);
    twinMoon.position.set(260, 215, -620);
    const twinHalo = new Mesh(twinHaloGeo, this.twinMoonHaloMat);
    twinHalo.position.copy(twinMoon.position);
    twinHalo.lookAt(0, 0, 0);
    this.root.add(twinMoon, twinHalo);

    // 3 Sweeping Aurora Borealis Ribbons
    for (let i = 0; i < 3; i++) {
      const arcRadius = 640 + i * 44;
      const ribbonGeo = new CylinderGeometry(
        arcRadius,
        arcRadius + 22,
        64 + i * 10,
        48,
        1,
        true,
        -Math.PI * 0.45,
        Math.PI * 0.9,
      );
      this.geometries.push(ribbonGeo);
      const ribbonMat = new MeshBasicMaterial({
        color: 0x38f6ff,
        transparent: true,
        opacity: 0.38,
        side: DoubleSide,
        depthWrite: false,
        fog: false,
      });
      this.materials.push(ribbonMat);
      const mesh = new Mesh(ribbonGeo, ribbonMat);
      const baseY = 148 + i * 28;
      const baseRotY = Math.PI + (i - 1) * 0.65;
      mesh.position.y = baseY;
      mesh.rotation.y = baseRotY;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.auroraRibbons.push({
        mesh,
        mat: ribbonMat,
        baseY,
        baseRotY,
        speed: 0.16 + i * 0.05,
        phase: i * 2.1,
      });
    }

    // 24 Low-Poly Volumetric Cloud Clusters batched into ONE InstancedMesh!
    const cloudRng = createSeededRng(0x7c10d24);
    const puffs: BufferGeometry[] = [];
    for (let k = 0; k < 7; k++) {
      const lx = (k - 3) * 4.5 + (cloudRng.next() - 0.5) * 1.6;
      const ly = (k >= 2 && k <= 4 ? 2.4 : 0.4) + cloudRng.next() * 1.2;
      const lz = (cloudRng.next() - 0.5) * 3.8;
      const r = (k >= 2 && k <= 4 ? 6.2 : 4.4) + cloudRng.next() * 1.2;
      puffs.push(
        bakePart(
          new IcosahedronGeometry(r, 1),
          0xdbe6f8,
          0xffffff,
          lx,
          ly,
          lz,
          0,
          0,
          0,
          1.3,
          0.7,
          1.0,
        ),
      );
    }
    const cloudGeo = mergeParts(puffs);
    this.geometries.push(cloudGeo);

    this.cloudMat = new MeshStandardMaterial({
      color: 0xfff9ee,
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02,
      fog: false,
    });
    this.materials.push(this.cloudMat);

    this.cloudInst = new InstancedMesh(cloudGeo, this.cloudMat, CLOUD_COUNT);
    this.cloudInst.instanceMatrix.setUsage(DynamicDrawUsage);
    this.cloudInst.frustumCulled = false;
    this.root.add(this.cloudInst);

    for (let i = 0; i < CLOUD_COUNT; i++) {
      const baseAngle = (i / CLOUD_COUNT) * Math.PI * 2 + cloudRng.next() * 0.22;
      const radius = 215 + (i % 4) * 110 + cloudRng.next() * 38;
      const baseY = 66 + (i % 5) * 14 + cloudRng.next() * 8;
      const scale = 1.2 + (i % 3) * 0.42;
      this.cloudSlots.push({
        baseAngle,
        radius,
        baseY,
        speed: 0.0042 + (i % 4) * 0.0014,
        bobPhase: i * 0.9,
        scale,
      });
    }
  }

  private updateSkyDomeColors(spec: SkyThemeSpec): void {
    const pos = this.skyDomeGeo.attributes['position']!;
    const colAttr = this.skyDomeGeo.attributes['color'] as Float32BufferAttribute;
    const zenith = COL_TOP.setHex(spec.zenithHex);
    const horizon = COL_BOTTOM.setHex(spec.horizonHex);
    const mid = COL_MID.setHex(spec.midHex);

    for (let i = 0; i < pos.count; i++) {
      const ny = Math.max(0, pos.getY(i) / SKY_DOME_RADIUS);
      if (ny < 0.3) {
        COL_TMP.copy(horizon).lerp(mid, smoothstep(0, 0.3, ny));
      } else {
        COL_TMP.copy(mid).lerp(zenith, smoothstep(0.3, 0.9, ny));
      }
      colAttr.setXYZ(i, COL_TMP.r, COL_TMP.g, COL_TMP.b);
    }
    colAttr.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------
  // Dynamic World Layout
  // ---------------------------------------------------------------------------

  private disposeWorldLayout(): void {
    for (const lm of this.landmarks) {
      if (!lm.detailGroup.parent) lm.root.add(lm.detailGroup);
    }
    this.worldGroup.clear();
    for (const inst of this.worldInstancedMeshes) inst.dispose();
    for (const g of this.worldGeos) g.dispose();
    for (const m of this.worldMats) m.dispose();
    this.worldInstancedMeshes.length = 0;
    this.worldGeos.length = 0;
    this.worldMats.length = 0;
    this.crystalPropMat = undefined;
    this.mountainMetas.length = 0;
    this.landmarks.length = 0;
    this.skyCitadels.length = 0;
    this.banners.length = 0;
  }

  private rebuildWorldLayout(
    worldRadius: number,
    shelters: readonly ShelterHouse[],
    landmarks: readonly WorldLandmark[],
  ): void {
    this.disposeWorldLayout();
    this.builtSignature = `${worldRadius}|${shelters.length}|${landmarks.length}|${landmarks[0]?.x ?? 0}`;

    this.buildOceanAndMegaMountains(worldRadius);
    this.buildFloatingSkyCitadels(worldRadius);
    const { riverSegments, lakes } = this.buildStarlightRiversAndLakes(worldRadius);
    const roadSegments = this.buildRoyalAvenuesAndBridges(worldRadius, shelters, landmarks);
    this.buildColossalLandmarks(landmarks);
    this.buildBiomeEcosystem(worldRadius, shelters, landmarks, roadSegments, riverSegments, lakes);
    this.setTheme(this.currentTheme);
  }

  // ---------------------------------------------------------------------------
  // 1. Shimmering Outer Ocean + Double-Layered Fog-Free Mega-Mountain Ranges
  // ---------------------------------------------------------------------------

  private buildOceanAndMegaMountains(worldRadius: number): void {
    const scale = worldRadius / 280;
    const outerLimit = Math.max(780 * scale, worldRadius + 500);

    // Shimmering Outer Ocean (y = -1.8)
    const oceanGeo = new RingGeometry(worldRadius * 0.96, outerLimit * 1.15, 64, 2);
    oceanGeo.rotateX(-Math.PI / 2);
    this.worldGeos.push(oceanGeo);

    this.oceanMat = new MeshStandardMaterial({
      color: SKY_THEMES[this.currentTheme].oceanHex,
      emissive: SKY_THEMES[this.currentTheme].oceanEmissiveHex,
      emissiveIntensity: 0.38,
      roughness: 0.2,
      metalness: 0.36,
      fog: false,
    });
    this.worldMats.push(this.oceanMat);
    const oceanMesh = new Mesh(oceanGeo, this.oceanMat);
    oceanMesh.position.y = OCEAN_Y;
    this.worldGroup.add(oceanMesh);

    // Shoreline cliff wall & glowing seafoam rim
    const span = worldRadius * 2 + 2.4;
    const cliffParts: BufferGeometry[] = [
      bakePart(
        new BoxGeometry(span + 2.4, 1.35, 2.2),
        0x6c7a89,
        0xd8c3a5,
        0,
        -1.15,
        -worldRadius - 1.1,
      ),
      bakePart(
        new BoxGeometry(span + 2.4, 1.35, 2.2),
        0x6c7a89,
        0xd8c3a5,
        0,
        -1.15,
        worldRadius + 1.1,
      ),
      bakePart(
        new BoxGeometry(2.2, 1.35, span + 2.4),
        0x6c7a89,
        0xd8c3a5,
        -worldRadius - 1.1,
        -1.15,
        0,
      ),
      bakePart(
        new BoxGeometry(2.2, 1.35, span + 2.4),
        0x6c7a89,
        0xd8c3a5,
        worldRadius + 1.1,
        -1.15,
        0,
      ),
    ];
    const cliffGeo = mergeParts(cliffParts);
    this.worldGeos.push(cliffGeo);
    const cliffMat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
    });
    this.worldMats.push(cliffMat);
    this.worldGroup.add(new Mesh(cliffGeo, cliffMat));

    const foamParts: BufferGeometry[] = [
      bakePart(
        new PlaneGeometry(span + 7, 3.6),
        0xffffff,
        0xffffff,
        0,
        OCEAN_Y + 0.06,
        -worldRadius - 3.4,
        -Math.PI / 2,
      ),
      bakePart(
        new PlaneGeometry(span + 7, 3.6),
        0xffffff,
        0xffffff,
        0,
        OCEAN_Y + 0.06,
        worldRadius + 3.4,
        -Math.PI / 2,
      ),
      bakePart(
        new PlaneGeometry(3.6, span + 7),
        0xffffff,
        0xffffff,
        -worldRadius - 3.4,
        OCEAN_Y + 0.06,
        0,
        -Math.PI / 2,
      ),
      bakePart(
        new PlaneGeometry(3.6, span + 7),
        0xffffff,
        0xffffff,
        worldRadius + 3.4,
        OCEAN_Y + 0.06,
        0,
        -Math.PI / 2,
      ),
    ];
    const foamGeo = mergeParts(foamParts);
    this.worldGeos.push(foamGeo);
    this.foamMat = new MeshBasicMaterial({
      color: SKY_THEMES[this.currentTheme].foamHex,
      transparent: true,
      opacity: 0.54,
      depthWrite: false,
    });
    this.worldMats.push(this.foamMat);
    this.worldGroup.add(new Mesh(foamGeo, this.foamMat));

    // Fog-FREE faceted alpine mountain material (dramatic & crisp across all 4 themes!)
    const mtnMat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.14,
      flatShading: true,
      fog: false,
    });
    this.worldMats.push(mtnMat);

    // Layer 1: Inner Foothill Range (r = 286..430, height 65..125u)
    const innerSimplex = new SimplexNoise(createSeededRng(0x51a7e3d));
    const innerMeta = this.buildMountainRingGeometry(
      innerSimplex,
      worldRadius + 6,
      144 * scale,
      144,
      16,
      54,
      78,
      false,
    );
    this.mountainMetas.push(innerMeta);
    this.worldGeos.push(innerMeta.geo);
    this.worldGroup.add(new Mesh(innerMeta.geo, mtnMat));

    // Layer 2: Outer Titan Mega-Peak Ring (r = 420..760, soaring 160–260u tall!)
    const outerSimplex = new SimplexNoise(createSeededRng(0x717a49b));
    const outerMeta = this.buildMountainRingGeometry(
      outerSimplex,
      worldRadius + 138 * scale,
      340 * scale,
      160,
      16,
      132,
      142,
      true,
    );
    this.mountainMetas.push(outerMeta);
    this.worldGeos.push(outerMeta.geo);
    this.worldGroup.add(new Mesh(outerMeta.geo, mtnMat));

    // Glowing Mountain Waterfall & Crystal Seams along dramatic inner slopes (fog: false!)
    const seamParts: BufferGeometry[] = [];
    const seamCount = 24;
    for (let i = 0; i < seamCount; i++) {
      const a = (i / seamCount) * Math.PI * 2 + 0.14;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const maxAxis = Math.max(Math.abs(dx), Math.abs(dz), 1e-4);
      const sx = (dx / maxAxis) * (worldRadius + 6) + dx * (58 * scale);
      const sz = (dz / maxAxis) * (worldRadius + 6) + dz * (58 * scale);
      const h = 44 + (i % 4) * 14;
      seamParts.push(
        bakePart(
          new CylinderGeometry(0.9, 3.2, h, 5, 1, true),
          0x64f8ff,
          0xffffff,
          sx,
          h * 0.45,
          sz,
          0,
          -a,
          0,
        ),
      );
    }
    const seamGeo = mergeParts(seamParts);
    this.worldGeos.push(seamGeo);
    this.mtnSeamMat = new MeshBasicMaterial({
      color: SKY_THEMES[this.currentTheme].auroraA,
      transparent: true,
      opacity: 0.72,
      side: DoubleSide,
      depthWrite: false,
      fog: false,
    });
    this.worldMats.push(this.mtnSeamMat);
    this.worldGroup.add(new Mesh(seamGeo, this.mtnSeamMat));
  }

  private buildMountainRingGeometry(
    simplex: SimplexNoise,
    innerPad: number,
    radialSpan: number,
    angularSegs: number,
    radialRings: number,
    basePeakHeight: number,
    ridgeAmp: number,
    isOuter: boolean,
  ): MountainColorMeta {
    const vertCount = (angularSegs + 1) * (radialRings + 1);
    const positions = new Float32Array(vertCount * 3);
    const colors = new Float32Array(vertCount * 3);
    const heights = new Float32Array(vertCount);
    const dirXs = new Float32Array(vertCount);
    const dirZs = new Float32Array(vertCount);
    const indices: number[] = [];

    const freq = isOuter ? 0.0038 : 0.0058;

    for (let ir = 0; ir <= radialRings; ir++) {
      const v = ir / radialRings;
      const outDist = v * radialSpan;

      const riseMask = smoothstep(0.02, 0.36, v);
      const outerFade = 1 - 0.62 * smoothstep(0.74, 1.0, v);
      const envelope = riseMask * outerFade;

      for (let ia = 0; ia <= angularSegs; ia++) {
        const theta = (ia / angularSegs) * Math.PI * 2;
        const dirX = Math.cos(theta);
        const dirZ = Math.sin(theta);

        const maxAxis = Math.max(Math.abs(dirX), Math.abs(dirZ), 1e-4);
        const rimX = (dirX / maxAxis) * innerPad;
        const rimZ = (dirZ / maxAxis) * innerPad;
        const wx = rimX + dirX * outDist;
        const wz = rimZ + dirZ * outDist;

        // 4-octave sharp ridged alpine fBm
        const nx = wx * freq;
        const nz = wz * freq;
        const n1 = 1 - Math.abs(simplex.noise(nx, nz));
        const n2 = 1 - Math.abs(simplex.noise(nx * 2.15 + 11.3, nz * 2.15 - 7.9));
        const n3 = 0.5 + 0.5 * simplex.noise(nx * 4.4 - 5.1, nz * 4.4 + 13.7);
        const n4 = 0.5 + 0.5 * simplex.noise(nx * 8.8 + 19.2, nz * 8.8 + 3.4);
        const fbm = n1 * 0.54 + n2 * 0.27 + n3 * 0.13 + n4 * 0.06;

        // Sharp spire modulation on outer titans so iconic cathedral peaks punctuate the skyline
        const spireBoost = isOuter ? Math.pow(Math.max(0, Math.sin(theta * 9 + 0.7)), 4) * 0.34 : 0;
        const height =
          ir === 0 || ir === radialRings
            ? OCEAN_Y - 0.6
            : OCEAN_Y + envelope * (basePeakHeight + (fbm * fbm + spireBoost) * ridgeAmp);

        const idx = ir * (angularSegs + 1) + ia;
        positions[idx * 3] = wx;
        positions[idx * 3 + 1] = height;
        positions[idx * 3 + 2] = wz;
        heights[idx] = height;
        dirXs[idx] = dirX;
        dirZs[idx] = dirZ;
      }
    }

    for (let ir = 0; ir < radialRings; ir++) {
      for (let ia = 0; ia < angularSegs; ia++) {
        const a = ir * (angularSegs + 1) + ia;
        const b = a + 1;
        const c = a + (angularSegs + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return { geo, heights, dirX: dirXs, dirZ: dirZs, isOuter };
  }

  private applyMountainThemeColors(meta: MountainColorMeta, spec: SkyThemeSpec): void {
    const colAttr = meta.geo.attributes['color'] as Float32BufferAttribute;
    const count = meta.heights.length;

    COL_ROCK.setHex(meta.isOuter ? spec.mtnTitanBaseHex : spec.mtnRockHex);
    COL_ATMO.setHex(spec.mtnAtmosphereHex);
    COL_TOP.setHex(spec.mtnTitanPeakHex);

    for (let i = 0; i < count; i++) {
      const h = meta.heights[i]!;
      const dx = meta.dirX[i]!;
      const dz = meta.dirZ[i]!;

      this.sampleMountainBiomeColors(dx, dz, COL_SLOPE, COL_PEAK);

      if (meta.isOuter) {
        // Outer Titan Mega-Peaks: climate-matched foothills rising to gleaming biome peaks
        COL_SLOPE.lerp(COL_ATMO, 0.36);
        COL_PEAK.lerp(COL_TOP, 0.34);
        if (h < 78) {
          COL_TMP.copy(COL_SLOPE).lerp(COL_ROCK, smoothstep(0, 78, h));
        } else {
          COL_TMP.copy(COL_ROCK).lerp(COL_PEAK, smoothstep(78, 178, h));
        }
      } else {
        // Inner Foothills: vivid climate slopes -> alpine rock -> sunlit/snowy biome ridges
        COL_SLOPE.lerp(COL_ATMO, 0.16);
        COL_PEAK.lerp(COL_TOP, 0.24);
        if (h < 34) {
          COL_TMP.copy(COL_SLOPE).lerp(COL_ROCK, smoothstep(2, 34, h));
        } else {
          COL_TMP.copy(COL_ROCK).lerp(COL_PEAK, smoothstep(34, 86, h));
        }
      }
      colAttr.setXYZ(i, COL_TMP.r, COL_TMP.g, COL_TMP.b);
    }
    colAttr.needsUpdate = true;
  }

  /**
   * Smoothly blend the 7 kingdom climates around the 360° mountain horizon with zero hard seams.
   * Zero allocations: writes directly into `outSlope` and `outPeak`.
   */
  private sampleMountainBiomeColors(
    dirX: number,
    dirZ: number,
    outSlope: Color,
    outPeak: Color,
  ): void {
    const anchors: readonly {
      ax: number;
      az: number;
      slopeHex: number;
      peakHex: number;
    }[] = [
      // North: Mushroom Woods (misty emerald rainforest ridges)
      { ax: 0, az: -1, slopeHex: 0x1c6945, peakHex: 0x8be0ac },
      // NW: Blossom Valley (sakura rose-plum & spring clover ridges)
      { ax: -Math.SQRT1_2, az: -Math.SQRT1_2, slopeHex: 0x9c5586, peakHex: 0xffd9f0 },
      // West: Crystal Sanctum (crisp frost & snowy glaciers)
      { ax: -1, az: 0, slopeHex: 0x4b77a8, peakHex: 0xf2fbff },
      // SW: Mermaid Lagoon (warm coastal cliffs & tropical turquoise cove ridges)
      { ax: -Math.SQRT1_2, az: Math.SQRT1_2, slopeHex: 0x35877e, peakHex: 0xe6f6cf },
      // South: Crystal Sanctum (glacial snow & frosted granite)
      { ax: 0, az: 1, slopeHex: 0x4b77a8, peakHex: 0xf2fbff },
      // SE: Starlight Peaks (twilight alpine indigo-slate & aurora peaks)
      { ax: Math.SQRT1_2, az: Math.SQRT1_2, slopeHex: 0x3b417a, peakHex: 0xd9d2ff },
      // East: Crystal Sanctum (snowy glaciers)
      { ax: 1, az: 0, slopeHex: 0x4b77a8, peakHex: 0xf2fbff },
      // NE: Candy Highlands (sun-drenched golden-apricot & warm sandstone highlands)
      { ax: Math.SQRT1_2, az: -Math.SQRT1_2, slopeHex: 0xc9823c, peakHex: 0xfff0be },
    ];

    let totalW = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let pr = 0;
    let pg = 0;
    let pb = 0;

    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i]!;
      const dot = dirX * a.ax + dirZ * a.az;
      const w = smoothstep(0.62, 0.98, dot);
      if (w <= 0) continue;
      totalW += w;
      COL_BOTTOM.setHex(a.slopeHex);
      COL_MID.setHex(a.peakHex);
      sr += COL_BOTTOM.r * w;
      sg += COL_BOTTOM.g * w;
      sb += COL_BOTTOM.b * w;
      pr += COL_MID.r * w;
      pg += COL_MID.g * w;
      pb += COL_MID.b * w;
    }

    if (totalW > 1e-5) {
      const inv = 1 / totalW;
      outSlope.setRGB(sr * inv, sg * inv, sb * inv);
      outPeak.setRGB(pr * inv, pg * inv, pb * inv);
    } else {
      outSlope.setHex(this.biomeSlopeColor(dirX, dirZ));
      outPeak.setHex(this.biomePeakColor(dirX, dirZ));
    }
  }

  private biomeSlopeColor(dirX: number, dirZ: number): number {
    if (dirZ < -0.55 && Math.abs(dirX) < 0.48) return 0x1c6945; // Mushroom Woods
    if (dirX < -0.35 && dirZ < -0.25) return 0x9c5586; // Blossom Valley
    if (dirX > 0.35 && dirZ < -0.25) return 0xc9823c; // Candy Highlands
    if (dirX < -0.35 && dirZ >= 0.25) return 0x35877e; // Mermaid Lagoon
    if (dirX > 0.35 && dirZ >= 0.25) return 0x3b417a; // Starlight Peaks
    return 0x4b77a8; // Crystal Sanctum glaciers
  }

  private biomePeakColor(dirX: number, dirZ: number): number {
    if (dirZ < -0.55 && Math.abs(dirX) < 0.48) return 0x8be0ac; // Mushroom Woods
    if (dirX < -0.35 && dirZ < -0.25) return 0xffd9f0; // Blossom Valley
    if (dirX > 0.35 && dirZ < -0.25) return 0xfff0be; // Candy Highlands
    if (dirX < -0.35 && dirZ >= 0.25) return 0xe6f6cf; // Mermaid Lagoon
    if (dirX > 0.35 && dirZ >= 0.25) return 0xd9d2ff; // Starlight Peaks
    return 0xf2fbff; // Crystal Sanctum snow peaks
  }

  // ---------------------------------------------------------------------------
  // 2. 10 Colossal Floating Sky Citadels (1.8× Laputa / TotK Grandeur!)
  // ---------------------------------------------------------------------------

  private buildFloatingSkyCitadels(worldRadius: number): void {
    const scale = worldRadius / 280;
    const citadelMat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.48,
      metalness: 0.2,
      fog: false,
    });
    const coreMat = new MeshBasicMaterial({ color: 0x7ef8ff, fog: false });
    const runeMat = new MeshBasicMaterial({ color: 0xffdf70, fog: false });
    const mistMat = new MeshBasicMaterial({
      color: 0xdffcff,
      transparent: true,
      opacity: 0.54,
      side: DoubleSide,
      depthWrite: false,
      fog: false,
    });

    const coreGeo = new OctahedronGeometry(3.6, 0);
    const runeGeoA = new TorusGeometry(8.2, 0.28, 6, 36);
    const runeGeoB = new TorusGeometry(5.6, 0.22, 6, 32);
    runeGeoA.rotateX(Math.PI / 2);
    runeGeoB.rotateX(Math.PI / 2);

    // Multi-stream waterfall geometry (3 parallel luminous streams merged into 1 mesh!)
    const wfParts: BufferGeometry[] = [
      bakePart(new CylinderGeometry(1.45, 2.7, 34, 10, 1, true), 0xffffff, 0xffffff, 0, 0, 0),
      bakePart(
        new CylinderGeometry(0.85, 1.6, 31, 8, 1, true),
        0xe6ffff,
        0xffffff,
        -2.8,
        1.2,
        -0.5,
      ),
      bakePart(new CylinderGeometry(0.85, 1.6, 31, 8, 1, true), 0xe6ffff, 0xffffff, 2.8, 1.2, -0.5),
    ];
    const waterfallGeo = mergeParts(wfParts);

    const mistOuterGeo = new RingGeometry(4.2, 8.8, 28);
    const mistInnerGeo = new RingGeometry(2.2, 4.5, 24);
    mistOuterGeo.rotateX(-Math.PI / 2);
    mistInnerGeo.rotateX(-Math.PI / 2);

    // Shared orbiting satellite boulders geometry (4 crystal-tipped boulders)
    const satParts: BufferGeometry[] = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.4;
      const sr = 23 + (k % 2) * 3.5;
      const sy = -4 + (k % 2) * 6;
      const sx = Math.cos(a) * sr;
      const sz = Math.sin(a) * sr;
      satParts.push(
        bakePart(
          new IcosahedronGeometry(2.8, 0),
          0x4b5578,
          0x9aa6c4,
          sx,
          sy,
          sz,
          0,
          a,
          0,
          1.1,
          1.35,
          1.0,
        ),
        bakePart(new ConeGeometry(1.1, 3.2, 5), 0x38f6ff, 0xffffff, sx, sy + 2.6, sz),
      );
    }
    const satGeo = mergeParts(satParts);

    this.worldGeos.push(
      coreGeo,
      runeGeoA,
      runeGeoB,
      waterfallGeo,
      mistOuterGeo,
      mistInnerGeo,
      satGeo,
    );
    this.worldMats.push(citadelMat, coreMat, runeMat, mistMat);

    const specs: readonly {
      angle: number;
      r: number;
      y: number;
      goldFall: boolean;
      accent: number;
    }[] = [
      { angle: -Math.PI * 0.5, r: 195, y: 44, goldFall: false, accent: 0x6ef29a },
      { angle: -Math.PI * 0.72, r: 215, y: 52, goldFall: false, accent: 0xff8ed8 },
      { angle: -Math.PI * 0.28, r: 215, y: 48, goldFall: true, accent: 0xffb3de },
      { angle: -Math.PI * 0.9, r: 245, y: 56, goldFall: false, accent: 0x7ef8ff },
      { angle: -Math.PI * 0.1, r: 245, y: 54, goldFall: true, accent: 0xffd700 },
      { angle: Math.PI * 0.9, r: 255, y: 46, goldFall: false, accent: 0x38f6ff },
      { angle: Math.PI * 0.1, r: 255, y: 60, goldFall: true, accent: 0xc792ff },
      { angle: Math.PI * 0.72, r: 210, y: 42, goldFall: false, accent: 0x00e5ff },
      { angle: Math.PI * 0.28, r: 225, y: 58, goldFall: true, accent: 0xb388ff },
      { angle: Math.PI * 0.5, r: 265, y: 62, goldFall: true, accent: 0xff9e66 },
    ];

    for (let i = 0; i < SKY_CITADEL_COUNT; i++) {
      const s = specs[i]!;
      const parts: BufferGeometry[] = [
        // 1.8× Massive multi-tiered inverted crystal-and-alabaster hull
        bakePart(new ConeGeometry(18.5, 27, 10), 0x3c4566, 0x8c97b8, 0, -13.5, 0, Math.PI),
        bakePart(new ConeGeometry(11.5, 19, 8), 0x2c3554, 0x7380a3, 9.2, -9.5, 4.2, Math.PI),
        bakePart(new ConeGeometry(10.5, 17, 8), 0x2c3554, 0x7380a3, -8.8, -8.8, -4.6, Math.PI),
        bakePart(new ConeGeometry(8.2, 14, 7), 0x344063, 0x8694ba, 0, -9.8, -9.5, Math.PI),
        // Upper emerald/golden plateau + gilded terrace rim
        bakePart(new CylinderGeometry(19.8, 17.8, 3.2, 12), 0x4bb574, s.accent, 0, 1.4, 0),
        bakePart(new TorusGeometry(19.2, 0.72, 6, 28), 0xffd700, 0xfff5c0, 0, 2.7, 0, Math.PI / 2),
        // Cradling low-poly cloud collar hugging the cliff waist
        bakePart(
          new IcosahedronGeometry(6.8, 1),
          0xe6eefc,
          0xffffff,
          -14,
          -4.5,
          6,
          0,
          0,
          0,
          1.35,
          0.65,
          1.1,
        ),
        bakePart(
          new IcosahedronGeometry(6.4, 1),
          0xe6eefc,
          0xffffff,
          14,
          -5.2,
          5,
          0,
          0,
          0,
          1.35,
          0.65,
          1.1,
        ),
        bakePart(
          new IcosahedronGeometry(7.2, 1),
          0xe6eefc,
          0xffffff,
          0,
          -6.5,
          -13,
          0,
          0,
          0,
          1.45,
          0.68,
          1.1,
        ),
        // Multi-spired white-and-gold Sky Temple / Pagoda crowning the citadel
        bakePart(new CylinderGeometry(8.5, 9.8, 2.2, 8), 0xf4efe8, 0xffffff, 0, 4.0, 0),
        bakePart(new CylinderGeometry(5.2, 5.8, 7.6, 8), 0xfaf7f2, 0xffffff, 0, 8.8, 0),
        bakePart(new ConeGeometry(7.4, 8.2, 8), s.accent, 0xfff5bd, 0, 16.5, 0),
        bakePart(new OctahedronGeometry(2.1, 0), 0xffd700, 0xffffff, 0, 21.8, 0),
        // 4 corner gilded temple spires + lush sky-trees
        bakePart(new CylinderGeometry(1.6, 2.0, 7.5, 7), 0xf8f4ee, 0xffffff, -8.5, 6.8, 5.2),
        bakePart(new ConeGeometry(2.8, 5.2, 7), s.accent, 0xfff3b0, -8.5, 13.0, 5.2),
        bakePart(new CylinderGeometry(1.6, 2.0, 7.5, 7), 0xf8f4ee, 0xffffff, 8.5, 6.8, 5.2),
        bakePart(new ConeGeometry(2.8, 5.2, 7), s.accent, 0xfff3b0, 8.5, 13.0, 5.2),
        bakePart(new CylinderGeometry(1.6, 2.0, 7.5, 7), 0xf8f4ee, 0xffffff, -7.8, 6.8, -6.2),
        bakePart(new ConeGeometry(2.8, 5.2, 7), s.accent, 0xfff3b0, -7.8, 13.0, -6.2),
        bakePart(new CylinderGeometry(1.6, 2.0, 7.5, 7), 0xf8f4ee, 0xffffff, 7.8, 6.8, -6.2),
        bakePart(new ConeGeometry(2.8, 5.2, 7), s.accent, 0xfff3b0, 7.8, 13.0, -6.2),
        bakePart(new ConeGeometry(3.8, 7.6, 7), 0x269c62, s.accent, -12.5, 6.5, -1.5),
        bakePart(new ConeGeometry(3.5, 6.8, 7), 0x269c62, s.accent, 12.2, 6.2, -1.5),
      ];
      // Hanging glowing vines draping off the cliff rim
      for (let v = 0; v < 6; v++) {
        const va = (v / 6) * Math.PI * 2 + 0.5;
        const vr = 15.8;
        parts.push(
          bakePart(
            new CylinderGeometry(0.28, 0.08, 10 + (v % 3) * 3.5, 5),
            0x4cf2a1,
            0xffe066,
            Math.cos(va) * vr,
            -5.2,
            Math.sin(va) * vr,
          ),
        );
      }

      const bodyGeo = mergeParts(parts);
      this.worldGeos.push(bodyGeo);

      const group = new Group();
      const dist = s.r * scale;
      group.position.set(Math.cos(s.angle) * dist, s.y, Math.sin(s.angle) * dist);
      group.add(new Mesh(bodyGeo, citadelMat));

      const coreCrystal = new Mesh(coreGeo, coreMat);
      coreCrystal.position.y = -29.2;
      const runeRingA = new Mesh(runeGeoA, runeMat);
      runeRingA.position.y = -27.2;
      const runeRingB = new Mesh(runeGeoB, coreMat);
      runeRingB.position.y = -30.5;
      group.add(coreCrystal, runeRingA, runeRingB);

      const satelliteRing = new Group();
      satelliteRing.add(new Mesh(satGeo, citadelMat));
      group.add(satelliteRing);

      const waterfallMat = new MeshBasicMaterial({
        color: s.goldFall ? 0xffe482 : 0x56f6ff,
        transparent: true,
        opacity: 0.84,
        side: DoubleSide,
        depthWrite: false,
        fog: false,
      });
      this.worldMats.push(waterfallMat);
      const waterfall = new Mesh(waterfallGeo, waterfallMat);
      waterfall.position.set(0, -15.5, 16.5);
      group.add(waterfall);

      const mistRingOuter = new Mesh(mistOuterGeo, mistMat);
      mistRingOuter.position.set(0, -32.2, 16.5);
      const mistRingInner = new Mesh(mistInnerGeo, mistMat);
      mistRingInner.position.set(0, -32.5, 16.5);
      group.add(mistRingOuter, mistRingInner);

      this.worldGroup.add(group);
      this.skyCitadels.push({
        group,
        coreCrystal,
        runeRingA,
        runeRingB,
        satelliteRing,
        waterfall,
        waterfallMat,
        mistRingOuter,
        mistRingInner,
        baseY: s.y,
        bobSpeed: 0.65 + (i % 3) * 0.16,
        phase: i * 1.05,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 3. 4 Luminous Starlight Rivers, Central Castle Moat & 2 Crystal Lakes (y = -0.476)
  // ---------------------------------------------------------------------------

  private buildStarlightRiversAndLakes(worldRadius: number): {
    riverSegments: Segment2D[];
    lakes: readonly LakeCircle2D[];
  } {
    const scale = worldRadius / 280;
    const riverSegments: Segment2D[] = [];
    const waterParts: BufferGeometry[] = [];
    const bankParts: BufferGeometry[] = [];
    const lotusParts: BufferGeometry[] = [];

    // Shimmering Central Castle Moat Ring around (0, 0) (r = 16.4..19.8)
    waterParts.push(
      bakePart(new RingGeometry(16.6, 19.6, 56), 0x3ef2ff, 0x9cfaff, 0, RIVER_Y, 0, -Math.PI / 2),
    );
    bankParts.push(
      bakePart(
        new RingGeometry(16.0, 16.7, 56),
        0xe6eef8,
        0xffffff,
        0,
        RIVER_Y - 0.002,
        0,
        -Math.PI / 2,
      ),
      bakePart(
        new RingGeometry(19.5, 20.3, 56),
        0xe6eef8,
        0xffffff,
        0,
        RIVER_Y - 0.002,
        0,
        -Math.PI / 2,
      ),
    );

    // 4 Organic Winding Starlight Rivers radiating out toward SW, NW, NE, SE biomes!
    const riverPaths: readonly (readonly [number, number][])[] = [
      // SW Mermaid Lagoon River
      [
        [-13, 14],
        [-38, 34],
        [-72, 42],
        [-112, 74],
        [-134, 96],
        [-195, 146],
        [-280, 178],
      ],
      // NW Blossom Valley River
      [
        [-13, -14],
        [-40, -34],
        [-64, -74],
        [-106, -104],
        [-152, -130],
        [-210, -195],
        [-265, -280],
      ],
      // NE Candy Highlands River
      [
        [13, -14],
        [42, -32],
        [68, -76],
        [114, -92],
        [152, -138],
        [218, -162],
        [280, -190],
      ],
      // SE Starlight Peaks River
      [
        [13, 14],
        [40, 36],
        [66, 78],
        [110, 102],
        [156, 128],
        [208, 196],
        [258, 280],
      ],
    ];

    const addRiverRibbon = (pts: readonly [number, number][]): void => {
      // Sample smooth polyline with Catmull-Rom-like quadratic subdivisions
      const sampled: { x: number; z: number }[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)]!;
        const p1 = pts[i]!;
        const p2 = pts[i + 1]!;
        const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
        const sub = 6;
        for (let s = 0; s < sub; s++) {
          const t = s / sub;
          const t2 = t * t;
          const t3 = t2 * t;
          const x =
            0.5 *
            (2 * p1[0] +
              (-p0[0] + p2[0]) * t +
              (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
              (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3) *
            scale;
          const z =
            0.5 *
            (2 * p1[1] +
              (-p0[1] + p2[1]) * t +
              (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
              (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3) *
            scale;
          sampled.push({ x, z });
        }
      }
      const last = pts[pts.length - 1]!;
      sampled.push({ x: last[0] * scale, z: last[1] * scale });

      const count = sampled.length;
      const waterHalf = 2.45;
      const bankHalf = 3.25;
      const wVerts: number[] = [];
      const wCols: number[] = [];
      const bVerts: number[] = [];
      const bCols: number[] = [];

      for (let i = 0; i < count; i++) {
        const prev = sampled[Math.max(0, i - 1)]!;
        const curr = sampled[i]!;
        const next = sampled[Math.min(count - 1, i + 1)]!;
        const tx = next.x - prev.x;
        const tz = next.z - prev.z;
        const len = Math.hypot(tx, tz) || 1;
        const nx = -tz / len;
        const nz = tx / len;

        // Water strip (3 bands: bright turquoise core + pale aqua edges)
        const wOffs = [-waterHalf, 0, waterHalf] as const;
        const wHex = i % 2 === 0 ? 0x38f2ff : 0x62f8ff;
        for (let k = 0; k < 3; k++) {
          const off = wOffs[k]!;
          wVerts.push(curr.x + nx * off, RIVER_Y, curr.z + nz * off);
          COL_TMP.setHex(k === 1 ? 0x9cfcff : wHex);
          wCols.push(COL_TMP.r, COL_TMP.g, COL_TMP.b);
        }

        // White marble stone riverbanks flanking both sides
        const bOffs = [-bankHalf, -waterHalf + 0.15, waterHalf - 0.15, bankHalf] as const;
        for (let k = 0; k < 4; k++) {
          const off = bOffs[k]!;
          bVerts.push(curr.x + nx * off, RIVER_Y - 0.002, curr.z + nz * off);
          COL_TMP.setHex(k === 0 || k === 3 ? 0xd9e4f2 : 0xffffff);
          bCols.push(COL_TMP.r, COL_TMP.g, COL_TMP.b);
        }

        if (i > 0) {
          riverSegments.push({ ax: prev.x, az: prev.z, bx: curr.x, bz: curr.z });
          // Glowing lotus pads & pink blossoms dotted near banks
          if (i % 4 === 2 && i < count - 2) {
            const side = i % 8 === 2 ? 1.55 : -1.55;
            const lx = curr.x + nx * side;
            const lz = curr.z + nz * side;
            lotusParts.push(
              bakePart(
                new CylinderGeometry(0.65, 0.65, 0.06, 8),
                0x2ec4b6,
                0x80ffdb,
                lx,
                RIVER_Y + 0.04,
                lz,
              ),
              bakePart(
                new ConeGeometry(0.35, 0.36, 6),
                0xff70a6,
                0xfff0f6,
                lx,
                RIVER_Y + 0.22,
                lz,
                Math.PI,
              ),
            );
          }
        }
      }

      waterParts.push(this.buildStripGeometry(wVerts, wCols, count, 3));
      // Build left bank (bands 0..1) and right bank (bands 2..3)
      const bankSteps = count - 1;
      const posArr = new Float32Array(bankSteps * 2 * 2 * 3 * 3);
      const normArr = new Float32Array(bankSteps * 2 * 2 * 3 * 3);
      const colArr = new Float32Array(bankSteps * 2 * 2 * 3 * 3);
      let out = 0;
      const pushB = (vi: number): void => {
        posArr[out] = bVerts[vi * 3]!;
        posArr[out + 1] = bVerts[vi * 3 + 1]!;
        posArr[out + 2] = bVerts[vi * 3 + 2]!;
        normArr[out] = 0;
        normArr[out + 1] = 1;
        normArr[out + 2] = 0;
        colArr[out] = bCols[vi * 3]!;
        colArr[out + 1] = bCols[vi * 3 + 1]!;
        colArr[out + 2] = bCols[vi * 3 + 2]!;
        out += 3;
      };
      for (let i = 0; i < bankSteps; i++) {
        const rA = i * 4;
        const rB = (i + 1) * 4;
        for (const band of [0, 2]) {
          pushB(rA + band);
          pushB(rB + band);
          pushB(rA + band + 1);
          pushB(rA + band + 1);
          pushB(rB + band);
          pushB(rB + band + 1);
        }
      }
      const bGeo = new BufferGeometry();
      bGeo.setAttribute('position', new Float32BufferAttribute(posArr, 3));
      bGeo.setAttribute('normal', new Float32BufferAttribute(normArr, 3));
      bGeo.setAttribute('color', new Float32BufferAttribute(colArr, 3));
      bankParts.push(bGeo);
    };

    for (const path of riverPaths) addRiverRibbon(path);

    // 2 Scenic Crystal Lakes along SW & NW rivers (well clear of shelters & landmarks)
    const lakes: readonly { x: number; z: number; r: number }[] = [
      { x: -134 * scale, z: 96 * scale, r: 10.5 },
      { x: -106 * scale, z: -104 * scale, r: 9.2 },
    ];
    for (const lk of lakes) {
      waterParts.push(
        bakePart(
          new CylinderGeometry(lk.r, lk.r, 0.04, 24),
          0x38f2ff,
          0x9cfcff,
          lk.x,
          RIVER_Y,
          lk.z,
        ),
      );
      bankParts.push(
        bakePart(
          new RingGeometry(lk.r - 0.2, lk.r + 1.1, 28),
          0xd9e4f2,
          0xffffff,
          lk.x,
          RIVER_Y - 0.002,
          lk.z,
          -Math.PI / 2,
        ),
      );
    }

    const waterGeo = mergeParts(waterParts);
    const bankGeo = mergeParts(bankParts);
    this.worldGeos.push(waterGeo, bankGeo);

    this.riverMat = new MeshStandardMaterial({
      color: SKY_THEMES[this.currentTheme].riverHex,
      emissive: SKY_THEMES[this.currentTheme].riverEmissiveHex,
      emissiveIntensity: 0.56,
      vertexColors: true,
      roughness: 0.16,
      metalness: 0.25,
    });
    const bankMat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.62,
      metalness: 0.08,
    });
    this.worldMats.push(this.riverMat, bankMat);

    const waterMesh = new Mesh(waterGeo, this.riverMat);
    waterMesh.renderOrder = 2;
    this.worldGroup.add(new Mesh(bankGeo, bankMat), waterMesh);

    if (lotusParts.length > 0) {
      const lotusGeo = mergeParts(lotusParts);
      this.worldGeos.push(lotusGeo);
      const lotusMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.4 });
      this.worldMats.push(lotusMat);
      this.worldGroup.add(new Mesh(lotusGeo, lotusMat));
    }

    return { riverSegments, lakes };
  }

  private buildStripGeometry(
    verts: readonly number[],
    cols: readonly number[],
    rowCount: number,
    colsPerRow: number,
  ): BufferGeometry {
    const steps = rowCount - 1;
    const bands = colsPerRow - 1;
    const triCount = steps * bands * 2;
    const posArr = new Float32Array(triCount * 3 * 3);
    const normArr = new Float32Array(triCount * 3 * 3);
    const colArr = new Float32Array(triCount * 3 * 3);
    let out = 0;
    const pushV = (vi: number): void => {
      posArr[out] = verts[vi * 3]!;
      posArr[out + 1] = verts[vi * 3 + 1]!;
      posArr[out + 2] = verts[vi * 3 + 2]!;
      normArr[out] = 0;
      normArr[out + 1] = 1;
      normArr[out + 2] = 0;
      colArr[out] = cols[vi * 3]!;
      colArr[out + 1] = cols[vi * 3 + 1]!;
      colArr[out + 2] = cols[vi * 3 + 2]!;
      out += 3;
    };
    for (let i = 0; i < steps; i++) {
      const rA = i * colsPerRow;
      const rB = (i + 1) * colsPerRow;
      for (let b = 0; b < bands; b++) {
        pushV(rA + b);
        pushV(rB + b);
        pushV(rA + b + 1);
        pushV(rA + b + 1);
        pushV(rB + b);
        pushV(rB + b + 1);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(posArr, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(normArr, 3));
    geo.setAttribute('color', new Float32BufferAttribute(colArr, 3));
    return geo;
  }

  // ---------------------------------------------------------------------------
  // 4. Bold 5.2u Royal Avenues, Triumphal Archways, Banners & 6 Arched Marble Bridges
  // ---------------------------------------------------------------------------

  private buildRoyalAvenuesAndBridges(
    worldRadius: number,
    shelters: readonly ShelterHouse[],
    landmarks: readonly WorldLandmark[],
  ): Segment2D[] {
    const scale = worldRadius / 280;
    const roadSegments: Segment2D[] = [];
    const cobbleParts: BufferGeometry[] = [];
    const archStoneParts: BufferGeometry[] = [];
    const lanternGemParts: BufferGeometry[] = [];
    const bridgeParts: BufferGeometry[] = [];

    // Shared fluttering banner geometry & material
    const bannerGeo = bakePart(new PlaneGeometry(1.15, 2.8), 0xff4d6d, 0xffd166, 0, -1.4, 0);
    const bannerMat = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
    this.worldGeos.push(bannerGeo);
    this.worldMats.push(bannerMat);

    // Grand Royal Plaza Ring just outside Central Castle Moat (r = 20.0..24.4)
    const plazaInner = 20.1;
    const plazaOuter = 24.5;
    cobbleParts.push(
      bakePart(
        new RingGeometry(plazaInner, plazaOuter, 56),
        0xf2c252,
        0xfff4c2,
        0,
        ROAD_Y,
        0,
        -Math.PI / 2,
      ),
    );

    const addGrandAvenue = (
      ax: number,
      az: number,
      bx: number,
      bz: number,
      startTrim: number,
      endTrim: number,
      curveBow: number,
      placeArches: boolean,
    ): void => {
      const dx = bx - ax;
      const dz = bz - az;
      const fullLen = Math.hypot(dx, dz);
      if (fullLen <= startTrim + endTrim + 4) return;
      const ux = dx / fullLen;
      const uz = dz / fullLen;
      const px = -uz;
      const pz = ux;

      const sx = ax + ux * startTrim;
      const sz = az + uz * startTrim;
      const ex = bx - ux * endTrim;
      const ez = bz - uz * endTrim;
      const mx = (sx + ex) * 0.5 + px * curveBow;
      const mz = (sz + ez) * 0.5 + pz * curveBow;

      const steps = Math.max(10, Math.round(Math.hypot(ex - sx, ez - sz) / 4.0));
      const halfW = 2.6; // Bold 5.2u-wide golden cobblestone Royal Avenue!
      const innerW = 2.02;
      const rVerts: number[] = [];
      const rCols: number[] = [];

      let prevX = sx;
      let prevZ = sz;

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const omt = 1 - t;
        const cx = omt * omt * sx + 2 * omt * t * mx + t * t * ex;
        const cz = omt * omt * sz + 2 * omt * t * mz + t * t * ez;

        const tx = 2 * omt * (mx - sx) + 2 * t * (ex - mx);
        const tz = 2 * omt * (mz - sz) + 2 * t * (ez - mz);
        const tLen = Math.hypot(tx, tz) || 1;
        const nx = -tz / tLen;
        const nz = tx / tLen;

        const offsets = [-halfW, -innerW, innerW, halfW] as const;
        const stoneHex = i % 2 === 0 ? 0xe0a63a : 0xf5cc62;
        const railHex = 0xfff6c4;

        for (let k = 0; k < 4; k++) {
          const off = offsets[k]!;
          rVerts.push(cx + nx * off, ROAD_Y, cz + nz * off);
          COL_TMP.setHex(k === 0 || k === 3 ? railHex : stoneHex);
          rCols.push(COL_TMP.r, COL_TMP.g, COL_TMP.b);
        }

        if (i > 0) {
          if (Math.hypot(cx - prevX, cz - prevZ) > 0.05) {
            roadSegments.push({ ax: prevX, az: prevZ, bx: cx, bz: cz });
          }

          // Grand Triumphal Archway & fluttering kingdom banners at midpoint of main avenues
          if (placeArches && i === Math.floor(steps * 0.52) && steps >= 10) {
            const yaw = Math.atan2(tx, tz);
            const span = 3.6;
            const lx = cx + nx * span;
            const lz = cz + nz * span;
            const rx = cx - nx * span;
            const rz = cz - nz * span;
            archStoneParts.push(
              bakePart(new CylinderGeometry(0.52, 0.68, 7.6, 8), 0xeae4f2, 0xffffff, lx, 3.3, lz),
              bakePart(new CylinderGeometry(0.52, 0.68, 7.6, 8), 0xeae4f2, 0xffffff, rx, 3.3, rz),
              bakePart(
                new TorusGeometry(span, 0.42, 7, 20, Math.PI),
                0xdba02c,
                0xfff3b0,
                cx,
                7.1,
                cz,
                0,
                yaw + Math.PI * 0.5,
                0,
              ),
            );
            lanternGemParts.push(
              bakePart(new OctahedronGeometry(0.52, 0), 0xffd700, 0xffffff, lx, 7.6, lz),
              bakePart(new OctahedronGeometry(0.52, 0), 0xffd700, 0xffffff, rx, 7.6, rz),
            );
            // Twin fluttering kingdom banners hanging from archway pillars
            for (const [bxPos, bzPos, sign] of [
              [lx - nx * 0.6, lz - nz * 0.6, 1],
              [rx + nx * 0.6, rz + nz * 0.6, -1],
            ] as const) {
              const bMesh = new Mesh(bannerGeo, bannerMat);
              bMesh.position.set(bxPos, 6.6, bzPos);
              bMesh.rotation.y = yaw;
              this.worldGroup.add(bMesh);
              this.banners.push({ mesh: bMesh, baseRotY: yaw, phase: (cx + cz) * 0.08 + sign });
            }
          } else if (i % 5 === 2 && i < steps - 1) {
            // Runestone lantern markers flanking the 5.2u Royal Avenue
            const side = (i % 10 === 2 ? 1 : -1) * 3.35;
            const lx = cx + nx * side;
            const lz = cz + nz * side;
            archStoneParts.push(
              bakePart(new CylinderGeometry(0.26, 0.38, 1.45, 6), 0x8f859e, 0xf2ecfa, lx, 0.2, lz),
            );
            lanternGemParts.push(
              bakePart(new OctahedronGeometry(0.32, 0), 0xffe066, 0x7ef8ff, lx, 1.15, lz),
            );
          }
        }
        prevX = cx;
        prevZ = cz;
      }

      cobbleParts.push(this.buildStripGeometry(rVerts, rCols, steps + 1, 4));
    };

    // Connect Central Plaza to all 6 Colossal Landmarks
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i]!;
      const bow = (i % 2 === 0 ? 1 : -1) * 6.0;
      addGrandAvenue(0, 0, lm.x, lm.z, plazaOuter - 0.5, lm.radius + 1.2, bow, true);
    }

    // Connect all 10 Regional Castles
    for (let i = 0; i < shelters.length; i++) {
      const sh = shelters[i]!;
      if (Math.hypot(sh.x, sh.z) < 5) continue;
      let hubX = 0;
      let hubZ = 0;
      let hubR = plazaOuter - 0.5;
      let bestDist = Math.hypot(sh.x, sh.z) * 0.78;
      for (let j = 0; j < landmarks.length; j++) {
        const lm = landmarks[j]!;
        const d = Math.hypot(sh.x - lm.x, sh.z - lm.z);
        if (d < bestDist && Math.hypot(lm.x, lm.z) < Math.hypot(sh.x, sh.z)) {
          bestDist = d;
          hubX = lm.x;
          hubZ = lm.z;
          hubR = lm.radius + 1.2;
        }
      }
      if (Math.hypot(sh.x, sh.z) <= worldRadius + 2) {
        addGrandAvenue(
          hubX,
          hubZ,
          sh.x,
          sh.z,
          hubR,
          sh.radius + 1.2,
          (i % 2 === 0 ? -1 : 1) * 5.0,
          false,
        );
      }
    }

    // 6 Grand Arched Golden-Marble Bridges spanning the Central Moat & 4 Starlight Rivers!
    const bridgeSpecs: readonly { x: number; z: number; yaw: number }[] = [
      // 4 Grand Moat Bridges at N, S, E, W gateways of Central Royal Castle
      { x: 0, z: -18.1, yaw: 0 },
      { x: 0, z: 18.1, yaw: 0 },
      { x: 18.1, z: 0, yaw: Math.PI / 2 },
      { x: -18.1, z: 0, yaw: Math.PI / 2 },
      // 2 Scenic River Crossing Bridges on SW & NW Royal Highways
      { x: -58 * scale, z: 40 * scale, yaw: Math.atan2(-88, 68) },
      { x: -56 * scale, z: -48 * scale, yaw: Math.atan2(-82, -62) },
    ];

    for (const br of bridgeSpecs) {
      const c = Math.cos(br.yaw);
      const s = Math.sin(br.yaw);
      // Graceful low-arched white-marble & rose-gold bridge deck (snakes glide cleanly across!)
      bridgeParts.push(
        bakePart(
          new BoxGeometry(5.8, 0.36, 7.6),
          0xebe6f2,
          0xffffff,
          br.x,
          -0.32,
          br.z,
          0,
          br.yaw,
          0,
        ),
        bakePart(
          new BoxGeometry(4.4, 0.38, 7.8),
          0xe6b850,
          0xfff1b8,
          br.x,
          -0.3,
          br.z,
          0,
          br.yaw,
          0,
        ),
      );
      // Arched golden-marble side balustrades & 4 corner lantern posts
      for (const side of [-2.85, 2.85]) {
        const bx = br.x + c * side;
        const bz = br.z - s * side;
        bridgeParts.push(
          bakePart(
            new TorusGeometry(3.5, 0.24, 6, 16, Math.PI),
            0xdba02c,
            0xfff4c2,
            bx,
            -0.35,
            bz,
            0,
            br.yaw + Math.PI * 0.5,
            0,
            1,
            0.46,
            1,
          ),
        );
        for (const end of [-3.4, 3.4]) {
          const px = bx + s * end;
          const pz = bz + c * end;
          bridgeParts.push(
            bakePart(new CylinderGeometry(0.28, 0.36, 2.2, 6), 0xf5f1fa, 0xffffff, px, 0.6, pz),
          );
          lanternGemParts.push(
            bakePart(new OctahedronGeometry(0.42, 0), 0xffd700, 0x7ef8ff, px, 1.95, pz),
          );
        }
      }
    }

    if (cobbleParts.length > 0) {
      const roadGeo = mergeParts(cobbleParts);
      this.worldGeos.push(roadGeo);
      const roadMat = new MeshStandardMaterial({
        vertexColors: true,
        emissive: 0xffc857,
        emissiveIntensity: 0.26,
        roughness: 0.58,
        metalness: 0.18,
      });
      this.worldMats.push(roadMat);
      const roadMesh = new Mesh(roadGeo, roadMat);
      roadMesh.renderOrder = 1;
      this.worldGroup.add(roadMesh);
    }

    if (bridgeParts.length > 0) {
      const bGeo = mergeParts(bridgeParts);
      this.worldGeos.push(bGeo);
      const bMat = new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.42,
        metalness: 0.26,
      });
      this.worldMats.push(bMat);
      this.worldGroup.add(new Mesh(bGeo, bMat));
    }

    if (archStoneParts.length > 0) {
      const stoneGeo = mergeParts(archStoneParts);
      this.worldGeos.push(stoneGeo);
      const stoneMat = new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.55,
        metalness: 0.2,
      });
      this.worldMats.push(stoneMat);
      this.worldGroup.add(new Mesh(stoneGeo, stoneMat));
    }

    if (lanternGemParts.length > 0) {
      const gemGeo = mergeParts(lanternGemParts);
      this.worldGeos.push(gemGeo);
      const gemMat = new MeshBasicMaterial({ vertexColors: true });
      this.worldMats.push(gemMat);
      this.worldGroup.add(new Mesh(gemGeo, gemMat));
    }

    return roadSegments;
  }

  // ---------------------------------------------------------------------------
  // 5. Legendary 6 Colossal Wonders (45–58u tall!)
  // ---------------------------------------------------------------------------

  private buildColossalLandmarks(landmarks: readonly WorldLandmark[]): void {
    const monumentMat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.4,
      metalness: 0.22,
    });
    const glowDetailMat = new MeshBasicMaterial({ vertexColors: true });
    const beaconGeo = new CylinderGeometry(0.75, 3.2, 86, 14, 1, true);
    this.worldGeos.push(beaconGeo);
    this.worldMats.push(monumentMat, glowDetailMat);

    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i]!;
      const root = new Group();
      root.position.set(lm.x, 0, lm.z);

      const detailGroup = new Group();
      const spinItems: Mesh[] = [];
      const bobItems: { readonly mesh: Mesh; readonly baseY: number; readonly phase: number }[] =
        [];
      const pulseRings: Mesh[] = [];
      const leafItems: LeafSwirlItem[] = [];
      const orbitPlanets: OrbitPlanetItem[] = [];
      const staticParts: BufferGeometry[] = [];

      switch (lm.kind) {
        case 'world_tree':
          this.populateWorldTree(
            staticParts,
            detailGroup,
            spinItems,
            bobItems,
            leafItems,
            glowDetailMat,
          );
          break;
        case 'rainbow_arch':
          this.populateRainbowArch(staticParts, detailGroup, spinItems, bobItems, glowDetailMat);
          break;
        case 'crystal_falls':
          this.populateCrystalFalls(staticParts, detailGroup, bobItems, pulseRings, glowDetailMat);
          break;
        case 'astral_observatory':
          this.populateAstralObservatory(
            staticParts,
            detailGroup,
            spinItems,
            orbitPlanets,
            monumentMat,
            glowDetailMat,
          );
          break;
        case 'moon_shrine':
          this.populateMoonShrine(staticParts, detailGroup, spinItems, bobItems, glowDetailMat);
          break;
        case 'dragon_colosseum':
          this.populateDragonColosseum(
            staticParts,
            detailGroup,
            spinItems,
            pulseRings,
            glowDetailMat,
          );
          break;
      }

      const monumentGeo = mergeParts(staticParts);
      this.worldGeos.push(monumentGeo);
      root.add(new Mesh(monumentGeo, monumentMat));
      root.add(detailGroup);

      // Ground sanctuary discovery rune ring
      const ringGeo = new RingGeometry(lm.radius - 0.6, lm.radius, 48);
      ringGeo.rotateX(-Math.PI / 2);
      this.worldGeos.push(ringGeo);
      const groundRingMat = new MeshBasicMaterial({
        color: lm.colorHex,
        transparent: true,
        opacity: 0.44,
        side: DoubleSide,
        depthWrite: false,
      });
      this.worldMats.push(groundRingMat);
      const groundRing = new Mesh(ringGeo, groundRingMat);
      groundRing.position.y = -0.45;
      root.add(groundRing);

      // Tall Sky-Beacon Beam (86u tall!)
      const beaconMat = new MeshBasicMaterial({
        color: lm.colorHex,
        transparent: true,
        opacity: 0.14,
        side: DoubleSide,
        depthWrite: false,
      });
      this.worldMats.push(beaconMat);
      const beaconBeam = new Mesh(beaconGeo, beaconMat);
      beaconBeam.position.y = 43;
      root.add(beaconBeam);

      this.worldGroup.add(root);
      this.landmarks.push({
        id: lm.id,
        x: lm.x,
        z: lm.z,
        radius: lm.radius,
        colorHex: lm.colorHex,
        root,
        detailGroup,
        spinItems,
        bobItems,
        pulseRings,
        leafItems,
        orbitPlanets,
        beaconBeam,
        beaconMat,
        groundRing,
        groundRingMat,
        discovered: false,
      });
    }
  }

  /** 1. Đại Thụ Thế Giới Ngàn Năm (58u): fluted trunk with golden sap veins, terraced roots, multi-cluster emerald-gold + blossom canopy clouds & falling leaf-sparkles. */
  private populateWorldTree(
    parts: BufferGeometry[],
    detailGroup: Group,
    spinItems: Mesh[],
    bobItems: { readonly mesh: Mesh; readonly baseY: number; readonly phase: number }[],
    leafItems: LeafSwirlItem[],
    glowMat: Material,
  ): void {
    // 2-tier mossy rune sanctuary + 8 walk-through buttress root arches
    parts.push(
      bakePart(new CylinderGeometry(12.2, 13.5, 0.55, 16), 0x2f6845, 0x6ef29a, 0, -0.22, 0),
      bakePart(new CylinderGeometry(8.8, 9.6, 0.55, 14), 0x3b7a52, 0x9ef7b0, 0, 0.3, 0),
    );
    for (let r = 0; r < 8; r++) {
      const a = (r / 8) * Math.PI * 2;
      parts.push(
        bakePart(
          new TorusGeometry(5.6, 0.85, 7, 16, Math.PI),
          0x523420,
          0x8c5e38,
          Math.cos(a) * 5.6,
          0.1,
          Math.sin(a) * 5.6,
          0,
          -a,
          0,
        ),
      );
    }

    // Fluted colossal trunk (y = 0..38) + spiraling glowing golden sap veins!
    parts.push(
      bakePart(new CylinderGeometry(3.4, 5.4, 18, 12), 0x523420, 0x784e30, 0, 9, 0),
      bakePart(
        new CylinderGeometry(2.5, 3.6, 20, 12),
        0x633f26,
        0x91633d,
        0.3,
        27,
        -0.2,
        0.04,
        0.3,
        -0.03,
      ),
    );
    // Fluted bark ridges & golden sap veins spiraling up the trunk
    for (let v = 0; v < 6; v++) {
      const a = (v / 6) * Math.PI * 2;
      parts.push(
        bakePart(
          new CylinderGeometry(0.45, 0.95, 22, 6),
          0x4a2f1c,
          0x784e30,
          Math.cos(a) * 3.8,
          11,
          Math.sin(a) * 3.8,
        ),
        bakePart(
          new CylinderGeometry(0.18, 0.22, 24, 5),
          0xffc83d,
          0xfff6b8,
          Math.cos(a + 0.28) * 3.45,
          14,
          Math.sin(a + 0.28) * 3.45,
        ),
      );
    }

    // 7 Sweeping upper boughs + 22 multi-cluster golden-emerald & pink-blossom canopy clouds (NO single green ball!)
    for (let b = 0; b < 7; b++) {
      const a = (b / 7) * Math.PI * 2 + 0.2;
      const bx = Math.cos(a) * 9.5;
      const bz = Math.sin(a) * 9.5;
      const tierY = 30 + (b % 3) * 4.5;
      parts.push(
        bakePart(
          new CylinderGeometry(0.75, 1.65, 14, 7),
          0x633f26,
          0x94663f,
          bx * 0.52,
          tierY - 4,
          bz * 0.52,
          Math.sin(a) * 0.62,
          0,
          -Math.cos(a) * 0.62,
        ),
        // Emerald-gold outer foliage cloud cluster
        bakePart(
          new IcosahedronGeometry(6.8, 1),
          0x1b8a4c,
          0x96f7a8,
          bx * 1.15,
          tierY + 2.5,
          bz * 1.15,
          0,
          a,
          0,
          1.35,
          0.66,
          1.25,
        ),
        // Sunlit blossom/gold accent puff nestled beside each bough!
        bakePart(
          new IcosahedronGeometry(4.4, 1),
          b % 2 === 0 ? 0xff8ec8 : 0xf4c44e,
          b % 2 === 0 ? 0xffe6f4 : 0xfff8b8,
          bx * 1.48,
          tierY + 4.8,
          bz * 1.48,
          0,
          a,
          0,
          1.2,
          0.68,
          1.15,
        ),
      );
    }

    // Upper crown terraced canopy clouds soaring to 56u + 58u radiant golden star crest!
    for (let c = 0; c < 5; c++) {
      const a = (c / 5) * Math.PI * 2 + 0.5;
      parts.push(
        bakePart(
          new IcosahedronGeometry(6.2, 1),
          0x24a35d,
          0xb8ff9e,
          Math.cos(a) * 6.5,
          44.5 + (c % 2) * 3.2,
          Math.sin(a) * 6.5,
          0,
          a,
          0,
          1.35,
          0.68,
          1.25,
        ),
      );
    }
    parts.push(
      bakePart(
        new IcosahedronGeometry(7.6, 1),
        0x2ecc71,
        0xfff29c,
        0,
        51.5,
        0,
        0,
        0.4,
        0,
        1.35,
        0.65,
        1.35,
      ),
      bakePart(new OctahedronGeometry(2.8, 0), 0xffd700, 0xffffff, 0, 57.5, 0),
    );

    // Animated swaying spirit lanterns, 2 counter-rotating golden halos & 14 swirling falling golden leaf-sparkles!
    const lanternGeo = bakePart(new OctahedronGeometry(0.68, 0), 0x6ef29a, 0xfff5b0);
    const haloGeoA = bakePart(
      new TorusGeometry(12.2, 0.22, 6, 40),
      0x6ef29a,
      0xffe066,
      0,
      0,
      0,
      Math.PI / 2,
    );
    const haloGeoB = bakePart(
      new TorusGeometry(8.6, 0.18, 6, 36),
      0xff9de6,
      0xfff3b0,
      0,
      0,
      0,
      Math.PI / 2,
    );
    const leafGeo = bakePart(
      new OctahedronGeometry(0.38, 0),
      0xffd700,
      0xfff8b8,
      0,
      0,
      0,
      0,
      0,
      0,
      1.2,
      0.4,
      1.0,
    );
    this.worldGeos.push(lanternGeo, haloGeoA, haloGeoB, leafGeo);

    const haloA = new Mesh(haloGeoA, glowMat);
    haloA.position.y = 22.5;
    const haloB = new Mesh(haloGeoB, glowMat);
    haloB.position.y = 38.0;
    detailGroup.add(haloA, haloB);
    spinItems.push(haloA, haloB);

    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const m = new Mesh(lanternGeo, glowMat);
      const baseY = 9.5 + (i % 4) * 5.2;
      m.position.set(Math.cos(a) * 11.4, baseY, Math.sin(a) * 11.4);
      detailGroup.add(m);
      bobItems.push({ mesh: m, baseY, phase: i * 0.85 });
    }

    for (let i = 0; i < 14; i++) {
      const lf = new Mesh(leafGeo, glowMat);
      detailGroup.add(lf);
      leafItems.push({
        mesh: lf,
        radius: 8 + (i % 4) * 3.2,
        baseAngle: (i / 14) * Math.PI * 2,
        minY: 3.5,
        spanY: 38,
        speed: 0.08 + (i % 3) * 0.025,
        phase: i / 14,
      });
    }
  }

  /** 2. Cổng Cầu Vồng Ngân Hà (52u span, 46u tall): twin winged crystal guardian towers, double concentric 7-band rainbow arches & apex sun-star! */
  private populateRainbowArch(
    parts: BufferGeometry[],
    detailGroup: Group,
    spinItems: Mesh[],
    bobItems: { readonly mesh: Mesh; readonly baseY: number; readonly phase: number }[],
    glowMat: Material,
  ): void {
    // Twin Winged Crystal Guardian Towers at x = ±24 (52u total span!)
    for (const side of [-1, 1]) {
      const cx = side * 23.5;
      parts.push(
        bakePart(new CylinderGeometry(5.6, 6.4, 1.8, 12), 0xf4ecfc, 0xffffff, cx, 0.5, 0),
        bakePart(
          new IcosahedronGeometry(4.6, 1),
          0xe6daf8,
          0xffffff,
          cx,
          2.8,
          0,
          0,
          0,
          0,
          1.38,
          0.72,
          1.2,
        ),
        bakePart(new IcosahedronGeometry(3.4, 1), 0xf2eaff, 0xffffff, cx - side * 2.8, 2.2, 2.4),
        bakePart(new IcosahedronGeometry(3.4, 1), 0xf2eaff, 0xffffff, cx + side * 2.4, 2.3, -2.2),
        // Guardian Crystal Tower + Sweeping Crystal Wings soaring to 28u!
        bakePart(new CylinderGeometry(1.4, 2.1, 22, 8), 0xffe4a0, 0xffffff, cx, 12.0, 0),
        bakePart(new ConeGeometry(2.8, 7.5, 8), 0xff85d0, 0xfff8cc, cx, 26.2, 0),
        bakePart(
          new ConeGeometry(2.2, 13.5, 5),
          0x62f6ff,
          0xffffff,
          cx + side * 4.2,
          17.5,
          0,
          0,
          0,
          -side * 0.55,
        ),
        bakePart(
          new ConeGeometry(1.7, 10.5, 5),
          0xc792ff,
          0xffe8fa,
          cx + side * 3.4,
          13.5,
          0,
          0,
          0,
          -side * 0.72,
        ),
      );
    }

    const bands: readonly number[] = [
      0xff4d6d, 0xff9e3d, 0xffe66d, 0x52f296, 0x38e4ff, 0x6c8cff, 0xd972ff,
    ];
    // Inner 7-band crystalline rainbow arch (r = 17..20.6 -> y = 34u)
    for (let b = 0; b < bands.length; b++) {
      const r = 17.0 + b * 0.6;
      parts.push(
        bakePart(
          new TorusGeometry(r, 0.36, 8, 48, Math.PI),
          bands[b]!,
          0xffffff,
          0,
          2.5,
          0,
          0,
          0,
          0,
          1.0,
          1.52,
          1.0,
        ),
      );
    }
    // Outer concentric 7-band crystalline rainbow arch (r = 22.8..26.4 -> y = 43.5u!)
    for (let b = 0; b < bands.length; b++) {
      const r = 22.8 + b * 0.6;
      parts.push(
        bakePart(
          new TorusGeometry(r, 0.38, 8, 52, Math.PI),
          bands[b]!,
          0xfff8f0,
          0,
          3.0,
          0,
          0,
          0,
          0,
          1.0,
          1.54,
          1.0,
        ),
      );
    }

    // Radiant Apex Sun-Star Crystal (y = 46u) + spinning double prism rings + 10 prism shards
    const starCrestGeo = bakePart(new OctahedronGeometry(3.2, 0), 0xffd700, 0xffffff);
    const starRingGeo = bakePart(new TorusGeometry(5.2, 0.22, 6, 32), 0xff85d0, 0x7ef8ff);
    const shardGeo = bakePart(new OctahedronGeometry(0.82, 0), 0x7ef8ff, 0xff9ee6);
    this.worldGeos.push(starCrestGeo, starRingGeo, shardGeo);

    const crest = new Mesh(starCrestGeo, glowMat);
    crest.position.y = 46.2;
    const starRing = new Mesh(starRingGeo, glowMat);
    starRing.position.y = 46.2;
    detailGroup.add(crest, starRing);
    spinItems.push(crest, starRing);

    for (let i = 0; i < 10; i++) {
      const t = ((i + 0.5) / 10) * Math.PI;
      const m = new Mesh(shardGeo, glowMat);
      const baseY = 4.0 + Math.sin(t) * 29.0;
      m.position.set(Math.cos(t) * 19.5, baseY, (i % 2 === 0 ? 1 : -1) * 2.4);
      detailGroup.add(m);
      bobItems.push({ mesh: m, baseY, phase: i * 0.9 });
    }
  }

  /** 3. Thác Pha Lê Vĩnh Cửu (50u): 3 tiered floating diamond cliffs, 3 glowing cascading waterfalls, giant glowing lotus bloom & orbiting prism shards! */
  private populateCrystalFalls(
    parts: BufferGeometry[],
    detailGroup: Group,
    bobItems: { readonly mesh: Mesh; readonly baseY: number; readonly phase: number }[],
    pulseRings: Mesh[],
    glowMat: Material,
  ): void {
    // Turquoise sanctuary pool + marble rim
    parts.push(
      bakePart(new CylinderGeometry(13.2, 14.0, 0.5, 28), 0x1698bd, 0x62f8ff, 0, -0.22, 1.5),
      bakePart(new TorusGeometry(13.4, 0.65, 6, 36), 0x90d4e8, 0xffffff, 0, 0.08, 1.5, Math.PI / 2),
    );

    // Giant Glowing Multi-Petal 3D Lotus Bloom in the pool center!
    parts.push(
      bakePart(new CylinderGeometry(4.4, 4.4, 0.14, 14), 0x2ec4b6, 0x80ffdb, 0, 0.12, 3.2),
      bakePart(new SphereGeometry(1.45, 12, 10), 0xffd700, 0xfff8b8, 0, 1.4, 3.2),
    );
    for (let p = 0; p < 10; p++) {
      const a = (p / 10) * Math.PI * 2;
      const r = p % 2 === 0 ? 2.4 : 1.75;
      parts.push(
        bakePart(
          new ConeGeometry(1.05, 2.8, 6),
          0xff5ca8,
          0xffeef6,
          Math.cos(a) * r,
          1.35,
          3.2 + Math.sin(a) * r,
          Math.sin(a) * 0.65,
          0,
          -Math.cos(a) * 0.65,
        ),
      );
    }

    // 3 Tiered Floating Diamond Cliffs stepping up to y = 50u!
    parts.push(
      // Lower cliff (y = 0..24)
      bakePart(new ConeGeometry(8.5, 24, 8), 0x2a4580, 0x56cfe1, -5.2, 12, -5.8),
      bakePart(new ConeGeometry(7.8, 22, 8), 0x2a4580, 0x56cfe1, 5.5, 11, -5.2),
      // Mid levitating diamond cliff (y = 14..36)
      bakePart(new ConeGeometry(7.4, 14, 8), 0x3b4894, 0x72efdd, 0, 21, -7.2, Math.PI),
      bakePart(new CylinderGeometry(7.6, 6.8, 1.8, 8), 0x48bfe3, 0xe0fbfc, 0, 28.5, -7.2),
      // Upper floating diamond crown cliff soaring to y = 50u!
      bakePart(new ConeGeometry(5.2, 11, 7), 0x4e3fa8, 0x9ef9ff, 0, 36, -7.6, Math.PI),
      bakePart(new ConeGeometry(3.2, 15, 6), 0x00b4d8, 0xffffff, 0, 44.5, -7.6),
      bakePart(new ConeGeometry(2.1, 12, 6), 0x7209b7, 0xc77dff, -3.8, 41.0, -7.2, 0.1, 0, 0.24),
      bakePart(new ConeGeometry(2.1, 12, 6), 0x4cc9f0, 0xffffff, 3.8, 41.0, -7.2, 0.1, 0, -0.24),
    );

    // 3 Glowing Cascading Waterfalls + pulsing mist rings + 8 orbiting prism shards
    const fallMat = new MeshBasicMaterial({
      color: 0x62f8ff,
      transparent: true,
      opacity: 0.84,
      side: DoubleSide,
      depthWrite: false,
    });
    this.worldMats.push(fallMat);
    const fallCenterGeo = new CylinderGeometry(1.3, 2.6, 38, 12, 1, true);
    const fallSideGeo = new CylinderGeometry(0.95, 1.9, 25, 10, 1, true);
    const rippleGeo = bakePart(
      new TorusGeometry(3.4, 0.18, 6, 28),
      0x9ef9ff,
      0xffffff,
      0,
      0,
      0,
      Math.PI / 2,
    );
    const prismGeo = bakePart(new OctahedronGeometry(0.95, 0), 0x38f6ff, 0xf2c4ff);
    this.worldGeos.push(fallCenterGeo, fallSideGeo, rippleGeo, prismGeo);

    const fallC = new Mesh(fallCenterGeo, fallMat);
    fallC.position.set(0, 19, -3.5);
    const fallL = new Mesh(fallSideGeo, fallMat);
    fallL.position.set(-4.6, 12.5, -2.5);
    const fallR = new Mesh(fallSideGeo, fallMat);
    fallR.position.set(4.8, 12.5, -2.5);
    detailGroup.add(fallC, fallL, fallR);

    for (const [rx, rz] of [
      [0, -3.2],
      [-4.6, -2.2],
      [4.8, -2.2],
    ] as const) {
      const rip = new Mesh(rippleGeo, glowMat);
      rip.position.set(rx, 0.18, rz);
      detailGroup.add(rip);
      pulseRings.push(rip);
    }

    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const orb = new Mesh(prismGeo, glowMat);
      const baseY = 16 + (i % 4) * 7.5;
      orb.position.set(Math.cos(a) * 9.2, baseY, -4.5 + Math.sin(a) * 6.5);
      detailGroup.add(orb);
      bobItems.push({ mesh: orb, baseY, phase: i * 1.1 });
    }
  }

  /** 4. Đài Thiên Văn Tinh Tú (48u): 2-tier marble Pantheon colonnade, 5 counter-rotating golden astrolabe rings, 6 orbiting miniature planets & blazing star-core beam! */
  private populateAstralObservatory(
    parts: BufferGeometry[],
    detailGroup: Group,
    spinItems: Mesh[],
    orbitPlanets: OrbitPlanetItem[],
    monumentMat: Material,
    glowMat: Material,
  ): void {
    // Grand 2-Tier Marble Pantheon Colonnade (r = 13.4, height 18u)
    parts.push(
      bakePart(new CylinderGeometry(13.2, 14.2, 0.8, 20), 0x262866, 0xeae4f8, 0, -0.05, 0),
      bakePart(new CylinderGeometry(10.8, 11.4, 0.7, 20), 0x3b3e8f, 0xfff8eb, 0, 0.65, 0),
      bakePart(new TorusGeometry(11.0, 0.28, 6, 40), 0xffd700, 0xfff3b0, 0, 1.05, 0, Math.PI / 2),
      bakePart(new CylinderGeometry(1.5, 2.4, 18.5, 12), 0xd8d2ec, 0xffffff, 0, 9.5, 0),
      // Lower & upper Pantheon entablature rings
      bakePart(new TorusGeometry(11.0, 0.62, 8, 36), 0xeae4f8, 0xffd700, 0, 10.6, 0, Math.PI / 2),
      bakePart(new TorusGeometry(9.6, 0.52, 8, 36), 0xf6f0ff, 0xffe484, 0, 18.2, 0, Math.PI / 2),
      // Fixed grand meridian arch reaching 48u!
      bakePart(new TorusGeometry(15.2, 0.44, 8, 52), 0xd49b2a, 0xfff099, 0, 31.8, 0),
      bakePart(new OctahedronGeometry(1.9, 0), 0xffd700, 0xffffff, 0, 48.0, 0),
    );

    for (let c = 0; c < 12; c++) {
      const a = (c / 12) * Math.PI * 2;
      parts.push(
        bakePart(
          new CylinderGeometry(0.52, 0.62, 9.6, 8),
          0xdcd6f0,
          0xffffff,
          Math.cos(a) * 11.0,
          5.6,
          Math.sin(a) * 11.0,
        ),
        bakePart(
          new CylinderGeometry(0.42, 0.48, 7.2, 7),
          0xebe6f8,
          0xfff8e6,
          Math.cos(a + Math.PI / 12) * 9.6,
          14.4,
          Math.sin(a + Math.PI / 12) * 9.6,
        ),
      );
    }

    // 5 Counter-Rotating Golden & Cyan Celestial Astrolabe Rings + Blazing Star Core Beam!
    const ringSpecs: readonly { r: number; tube: number; c1: number; c2: number; tilt: number }[] =
      [
        { r: 13.4, tube: 0.34, c1: 0xffb703, c2: 0xfff3b0, tilt: 0 },
        { r: 11.4, tube: 0.3, c1: 0x38f6ff, c2: 0xd0faff, tilt: Math.PI / 3 },
        { r: 9.4, tube: 0.28, c1: 0xc792ff, c2: 0xffe885, tilt: -Math.PI / 4 },
        { r: 7.4, tube: 0.26, c1: 0xff85c0, c2: 0xfff3b0, tilt: Math.PI / 5 },
        { r: 5.5, tube: 0.24, c1: 0xffd700, c2: 0xffffff, tilt: -Math.PI / 3 },
      ];
    for (const rs of ringSpecs) {
      const rg = bakePart(new TorusGeometry(rs.r, rs.tube, 8, 40), rs.c1, rs.c2, 0, 0, 0, rs.tilt);
      this.worldGeos.push(rg);
      const m = new Mesh(rg, monumentMat);
      m.position.y = 31.8;
      detailGroup.add(m);
      spinItems.push(m);
    }

    const coreStarGeo = bakePart(new IcosahedronGeometry(2.8, 1), 0xffaa00, 0xffffff);
    const coreBeamGeo = new CylinderGeometry(0.55, 1.35, 44, 12, 1, true);
    const coreBeamMat = new MeshBasicMaterial({
      color: 0xffe985,
      transparent: true,
      opacity: 0.38,
      side: DoubleSide,
      depthWrite: false,
    });
    this.worldGeos.push(coreStarGeo, coreBeamGeo);
    this.worldMats.push(coreBeamMat);

    const core = new Mesh(coreStarGeo, glowMat);
    core.position.y = 31.8;
    const beam = new Mesh(coreBeamGeo, coreBeamMat);
    beam.position.y = 28.0;
    detailGroup.add(core, beam);
    spinItems.push(core);

    // 6 Orbiting Miniature Glowing Planets!
    const planetSpecs: readonly {
      r: number;
      size: number;
      hex: number;
      tilt: number;
      speed: number;
    }[] = [
      { r: 7.2, size: 0.72, hex: 0xff5c8a, tilt: 0.25, speed: 1.25 },
      { r: 9.2, size: 0.86, hex: 0x56f6ff, tilt: -0.32, speed: 0.96 },
      { r: 11.2, size: 0.95, hex: 0x6ef29a, tilt: 0.38, speed: 0.78 },
      { r: 13.0, size: 1.1, hex: 0xffd166, tilt: -0.22, speed: 0.62 },
      { r: 14.8, size: 0.9, hex: 0xc792ff, tilt: 0.42, speed: 0.5 },
      { r: 16.4, size: 0.82, hex: 0x9cfaff, tilt: -0.35, speed: 0.4 },
    ];
    for (let i = 0; i < planetSpecs.length; i++) {
      const ps = planetSpecs[i]!;
      const pGeo = bakePart(new SphereGeometry(ps.size, 12, 10), ps.hex, 0xffffff);
      this.worldGeos.push(pGeo);
      const pm = new Mesh(pGeo, glowMat);
      detailGroup.add(pm);
      orbitPlanets.push({
        mesh: pm,
        radius: ps.r,
        centerY: 31.8,
        tilt: ps.tilt,
        speed: ps.speed,
        phase: i * 1.15,
      });
    }
  }

  /** 5. Đền Cổ Ánh Trăng (45u): monumental triple crimson-gold Torii promenade, giant levitating crescent moon & twin Spirit Sakura trees! */
  private populateMoonShrine(
    parts: BufferGeometry[],
    detailGroup: Group,
    spinItems: Mesh[],
    bobItems: { readonly mesh: Mesh; readonly baseY: number; readonly phase: number }[],
    glowMat: Material,
  ): void {
    parts.push(
      bakePart(new CylinderGeometry(12.2, 13.0, 0.6, 18), 0x392b58, 0xe0d0ff, 0, -0.2, 0),
      bakePart(new TorusGeometry(12.3, 0.26, 6, 40), 0xc792ff, 0xffffff, 0, 0.14, 0, Math.PI / 2),
    );

    // Monumental Triple Crimson-Gold Torii Promenade ascending to 35u!
    const gates: readonly { z: number; span: number; h: number }[] = [
      { z: 8.8, span: 6.2, h: 16.5 },
      { z: 0.6, span: 7.8, h: 24.5 },
      { z: -7.6, span: 9.8, h: 34.0 },
    ];
    for (const g of gates) {
      parts.push(
        bakePart(
          new CylinderGeometry(0.68, 0.86, g.h, 8),
          0x9e1220,
          0xff4d6d,
          -g.span,
          g.h * 0.5,
          g.z,
        ),
        bakePart(
          new CylinderGeometry(0.68, 0.86, g.h, 8),
          0x9e1220,
          0xff4d6d,
          g.span,
          g.h * 0.5,
          g.z,
        ),
        bakePart(new BoxGeometry(g.span * 2.65, 1.1, 1.4), 0xb81428, 0xffd166, 0, g.h + 0.4, g.z),
        bakePart(new BoxGeometry(g.span * 2.25, 0.72, 1.0), 0x9e1424, 0xff85a1, 0, g.h - 2.8, g.z),
        // Upturned golden kasagi eave tips
        bakePart(
          new BoxGeometry(2.6, 0.8, 1.2),
          0xffb703,
          0xfff5bd,
          -g.span * 1.38,
          g.h + 0.95,
          g.z,
          0,
          0,
          -0.32,
        ),
        bakePart(
          new BoxGeometry(2.6, 0.8, 1.2),
          0xffb703,
          0xfff5bd,
          g.span * 1.38,
          g.h + 0.95,
          g.z,
          0,
          0,
          0.32,
        ),
      );
    }

    // Twin Giant Spirit Sakura Trees (22u tall!) flanking the Torii promenade
    for (const side of [-1, 1]) {
      const sx = side * 12.2;
      parts.push(
        bakePart(new CylinderGeometry(0.65, 1.25, 13.5, 8), 0x4a2c40, 0x734663, sx, 6.5, -2.5),
        bakePart(
          new IcosahedronGeometry(5.6, 1),
          0xff6b9d,
          0xffe6f4,
          sx,
          15.5,
          -2.5,
          0,
          0,
          0,
          1.32,
          0.72,
          1.2,
        ),
        bakePart(
          new IcosahedronGeometry(4.2, 1),
          0xff85c0,
          0xffffff,
          sx - side * 3.4,
          18.2,
          -0.5,
          0,
          0,
          0,
          1.2,
          0.72,
          1.1,
        ),
        bakePart(new IcosahedronGeometry(3.8, 1), 0xff85c0, 0xffeef6, sx + side * 2.6, 13.5, 2.0),
      );
    }

    // Giant Levitating Luminous Crescent Moon (soaring to 45u!) + Pearl Orb + Lunar Halos
    const crescentGeo = bakePart(
      new TorusGeometry(5.6, 0.88, 10, 32, Math.PI * 1.35),
      0xffb703,
      0xfff9d6,
      0,
      0,
      0,
      0,
      0,
      Math.PI * 0.82,
    );
    const moonOrbGeo = bakePart(new SphereGeometry(3.0, 18, 14), 0xd8bbff, 0xffffff);
    const moonHaloGeo = bakePart(
      new TorusGeometry(6.2, 0.18, 6, 36),
      0xc792ff,
      0xffffff,
      0,
      0,
      0,
      Math.PI / 3,
    );
    this.worldGeos.push(crescentGeo, moonOrbGeo, moonHaloGeo);

    const crescent = new Mesh(crescentGeo, glowMat);
    crescent.position.set(0, 41.2, -7.6);
    detailGroup.add(crescent);
    bobItems.push({ mesh: crescent, baseY: 41.2, phase: 0.2 });

    const orb = new Mesh(moonOrbGeo, glowMat);
    orb.position.set(0, 29.0, -3.2);
    detailGroup.add(orb);
    bobItems.push({ mesh: orb, baseY: 29.0, phase: 1.4 });

    const halo = new Mesh(moonHaloGeo, glowMat);
    halo.position.set(0, 29.0, -3.2);
    detailGroup.add(halo);
    spinItems.push(halo);
  }

  /** 6. Đấu Trường Rồng Cổ Đại (46u): 2-tier golden-obsidian Colosseum, giant sculpted rearing golden Dragon Wings, 12 eternal flame braziers & floating rune halo! */
  private populateDragonColosseum(
    parts: BufferGeometry[],
    detailGroup: Group,
    spinItems: Mesh[],
    pulseRings: Mesh[],
    glowMat: Material,
  ): void {
    const arenaR = 13.0;
    parts.push(
      bakePart(
        new CylinderGeometry(arenaR + 1.4, arenaR + 2.0, 0.55, 24),
        0x3b2c3a,
        0xf2cc8f,
        0,
        -0.22,
        0,
      ),
      bakePart(
        new TorusGeometry(arenaR - 1.2, 0.28, 6, 40),
        0xff7043,
        0xffd166,
        0,
        0.1,
        0,
        Math.PI / 2,
      ),
      // Upper golden-obsidian gallery ring at y = 21.5u
      bakePart(new TorusGeometry(arenaR, 0.65, 8, 40), 0x2f2433, 0xffd166, 0, 21.2, 0, Math.PI / 2),
    );

    // 16-bay 2-tier golden-obsidian amphitheater colonnade (open cardinal triumphal gates!)
    for (let i = 0; i < 16; i++) {
      if (i % 4 === 0) continue;
      const a = (i / 16) * Math.PI * 2;
      const cx = Math.cos(a) * arenaR;
      const cz = Math.sin(a) * arenaR;
      parts.push(
        bakePart(new CylinderGeometry(0.62, 0.78, 12.0, 8), 0x2f2536, 0xd49a52, cx, 6.0, cz),
        bakePart(new CylinderGeometry(0.52, 0.62, 9.2, 7), 0x453447, 0xffd875, cx, 16.5, cz),
        bakePart(new BoxGeometry(3.2, 1.3, 1.5), 0x382a3d, 0xffe08a, cx, 12.2, cz, 0, -a, 0),
      );
    }

    // Giant Sculpted Rearing Golden Dragon Wings & Triumphal Dragon Arch soaring to y = 46u!
    parts.push(
      bakePart(
        new CylinderGeometry(1.8, 2.5, 25, 8),
        0x332238,
        0xffb703,
        -5.6,
        12.5,
        -arenaR + 0.6,
      ),
      bakePart(new CylinderGeometry(1.8, 2.5, 25, 8), 0x332238, 0xffb703, 5.6, 12.5, -arenaR + 0.6),
      bakePart(
        new TorusGeometry(5.6, 0.85, 8, 28, Math.PI),
        0xd96b27,
        0xffe885,
        0,
        25.0,
        -arenaR + 0.6,
      ),
      // Massive sweeping multi-feather golden Dragon Wings reaching 46u!
      bakePart(
        new ConeGeometry(4.4, 21.5, 5),
        0xd95d24,
        0xfff2a8,
        -11.8,
        35.5,
        -arenaR + 0.6,
        0,
        0,
        0.48,
      ),
      bakePart(
        new ConeGeometry(4.4, 21.5, 5),
        0xd95d24,
        0xfff2a8,
        11.8,
        35.5,
        -arenaR + 0.6,
        0,
        0,
        -0.48,
      ),
      bakePart(
        new ConeGeometry(3.2, 16.0, 5),
        0xb84318,
        0xffd166,
        -14.8,
        28.5,
        -arenaR + 0.6,
        0,
        0,
        0.82,
      ),
      bakePart(
        new ConeGeometry(3.2, 16.0, 5),
        0xb84318,
        0xffd166,
        14.8,
        28.5,
        -arenaR + 0.6,
        0,
        0,
        -0.82,
      ),
      // Dragon Crest Crown Orb
      bakePart(new OctahedronGeometry(2.6, 0), 0xff4500, 0xfff3a0, 0, 38.5, -arenaR + 0.6),
    );

    // 12 Roaring Eternal Flame Braziers + Floating Spinning Golden Dragon Rune Halo
    const flameGeo = bakePart(new ConeGeometry(1.05, 3.6, 7), 0xff4500, 0xfff599);
    const haloGeo = bakePart(
      new TorusGeometry(8.2, 0.24, 6, 36),
      0xff7043,
      0xffe885,
      0,
      0,
      0,
      Math.PI / 2,
    );
    this.worldGeos.push(flameGeo, haloGeo);

    for (let b = 0; b < 12; b++) {
      const a = (b / 12) * Math.PI * 2 + Math.PI / 24;
      const bx = Math.cos(a) * arenaR;
      const bz = Math.sin(a) * arenaR;
      parts.push(
        bakePart(new CylinderGeometry(1.05, 0.55, 1.4, 8), 0x3b2836, 0xe8b954, bx, 22.4, bz),
      );
      const flame = new Mesh(flameGeo, glowMat);
      flame.position.set(bx, 24.8, bz);
      detailGroup.add(flame);
      pulseRings.push(flame);
    }

    const halo = new Mesh(haloGeo, glowMat);
    halo.position.y = 32.5;
    detailGroup.add(halo);
    spinItems.push(halo);
  }

  // ---------------------------------------------------------------------------
  // 6. Multi-Layered Realistic Biome Ecosystem (~2,200–2,500 GPU-Instanced Props)
  // ---------------------------------------------------------------------------

  private buildBiomeEcosystem(
    worldRadius: number,
    shelters: readonly ShelterHouse[],
    landmarks: readonly WorldLandmark[],
    roadSegments: readonly Segment2D[],
    riverSegments: readonly Segment2D[],
    lakes: readonly LakeCircle2D[],
  ): void {
    const archetypes: readonly BiomePropArchetype[] = createBiomePropArchetypes();
    const kindToIdx = new Map<BiomePropKind, number>();
    const buckets: {
      x: number;
      z: number;
      rotY: number;
      sx: number;
      sy: number;
      sz: number;
      tint: number;
    }[][] = [];
    for (let i = 0; i < archetypes.length; i++) {
      const arch = archetypes[i]!;
      this.worldGeos.push(arch.geometry);
      kindToIdx.set(arch.kind, i);
      buckets.push([]);
    }

    const organicMat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.78,
      metalness: 0.04,
    });
    const crystalPropMat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.3,
      metalness: 0.16,
      emissive: SKY_THEMES[this.currentTheme].horizonHex,
      emissiveIntensity: 0.14,
    });
    this.crystalPropMat = crystalPropMat;
    this.worldMats.push(organicMat, crystalPropMat);

    // Spatial hash grid for O(1) prop-to-prop clearance checks
    const cellSize = 8;
    const gridDim = Math.max(8, Math.ceil((worldRadius * 2) / cellSize) + 2);
    const gridOrigin = -worldRadius - cellSize;
    const spatialCells: number[][] = Array.from({ length: gridDim * gridDim }, () => []);
    const placed: { x: number; z: number; r: number }[] = [];
    const hillocks: { x: number; z: number; r: number }[] = [];

    const rng = createSeededRng(0x9e3779b9);
    const margin = Math.max(18, worldRadius - 7);
    const hillockMargin = Math.max(20, worldRadius - 14);
    const areaRatio = Math.min(1.25, Math.max(0.08, (worldRadius / 280) * (worldRadius / 280)));

    const cellCoord = (v: number): number =>
      Math.max(0, Math.min(gridDim - 1, Math.floor((v - gridOrigin) / cellSize)));

    const isClearZone = (
      x: number,
      z: number,
      bound: number,
      minCenterDist: number,
      shelterPad: number,
      landmarkPad: number,
      roadPad: number,
      riverPad: number,
      lakePad: number,
    ): boolean => {
      if (Math.abs(x) > bound || Math.abs(z) > bound) return false;
      if (x * x + z * z < minCenterDist * minCenterDist) return false;

      for (let i = 0; i < shelters.length; i++) {
        const s = shelters[i]!;
        const pad = s.radius + shelterPad;
        const dx = x - s.x;
        const dz = z - s.z;
        if (dx * dx + dz * dz < pad * pad) return false;
      }
      for (let i = 0; i < landmarks.length; i++) {
        const lm = landmarks[i]!;
        const pad = lm.radius + landmarkPad;
        const dx = x - lm.x;
        const dz = z - lm.z;
        if (dx * dx + dz * dz < pad * pad) return false;
      }
      for (let i = 0; i < lakes.length; i++) {
        const lk = lakes[i]!;
        const pad = lk.r + lakePad;
        const dx = x - lk.x;
        const dz = z - lk.z;
        if (dx * dx + dz * dz < pad * pad) return false;
      }
      const roadPadSq = roadPad * roadPad;
      for (let i = 0; i < roadSegments.length; i++) {
        if (distSqPointToSeg2D(x, z, roadSegments[i]!) < roadPadSq) return false;
      }
      const riverPadSq = riverPad * riverPad;
      for (let i = 0; i < riverSegments.length; i++) {
        if (distSqPointToSeg2D(x, z, riverSegments[i]!) < riverPadSq) return false;
      }
      return true;
    };

    const hasPlacedConflict = (x: number, z: number, minGap: number): boolean => {
      const cx = cellCoord(x);
      const cz = cellCoord(z);
      const searchCells = Math.max(1, Math.ceil((minGap + 5) / cellSize));
      const x0 = Math.max(0, cx - searchCells);
      const x1 = Math.min(gridDim - 1, cx + searchCells);
      const z0 = Math.max(0, cz - searchCells);
      const z1 = Math.min(gridDim - 1, cz + searchCells);

      for (let gz = z0; gz <= z1; gz++) {
        const rowOff = gz * gridDim;
        for (let gx = x0; gx <= x1; gx++) {
          const list = spatialCells[rowOff + gx]!;
          for (let k = 0; k < list.length; k++) {
            const p = placed[list[k]!]!;
            const gap = Math.max(minGap, p.r);
            const dx = x - p.x;
            const dz = z - p.z;
            if (dx * dx + dz * dz < gap * gap) return true;
          }
        }
      }
      return false;
    };

    const insideHillockCore = (x: number, z: number, factor: number): boolean => {
      for (let i = 0; i < hillocks.length; i++) {
        const h = hillocks[i]!;
        const pad = h.r * factor;
        const dx = x - h.x;
        const dz = z - h.z;
        if (dx * dx + dz * dz < pad * pad) return true;
      }
      return false;
    };

    const pushProp = (
      x: number,
      z: number,
      kind: BiomePropKind,
      sx: number,
      sy: number,
      sz: number,
      minGap: number,
      tint: number,
      recordPlacement = true,
    ): void => {
      if (recordPlacement) {
        const idx = placed.length;
        placed.push({ x, z, r: minGap });
        spatialCells[cellCoord(z) * gridDim + cellCoord(x)]!.push(idx);
      }
      const bucketIdx = kindToIdx.get(kind)!;
      buckets[bucketIdx]!.push({
        x,
        z,
        rotY: rng.next() * Math.PI * 2,
        sx,
        sy,
        sz,
        tint,
      });
    };

    // -------------------------------------------------------------------------
    // Layer A: ~36–48 Scenic Outer Rolling Hillocks (radius 6..12u, height 1.8..4.5u)
    // -------------------------------------------------------------------------
    const targetHillocks = Math.max(6, Math.round(42 * areaRatio));
    let hillockAttempts = 0;
    while (hillocks.length < targetHillocks && hillockAttempts < 1400) {
      hillockAttempts++;
      const x = (rng.next() * 2 - 1) * hillockMargin;
      const z = (rng.next() * 2 - 1) * hillockMargin;
      if (!isClearZone(x, z, hillockMargin, 58, 22, 22, 14, 14, 14)) continue;

      const sx = 1.35 + rng.next() * 1.25; // ~6.1..11.7u radius
      const sz = 1.32 + rng.next() * 1.22;
      const sy = 0.92 + rng.next() * 1.28; // ~1.84..4.4u height
      const effR = Math.max(sx, sz) * 4.5;

      let overlapsHill = false;
      for (let i = 0; i < hillocks.length; i++) {
        const h = hillocks[i]!;
        const gap = effR + h.r + 5;
        const dx = x - h.x;
        const dz = z - h.z;
        if (dx * dx + dz * dz < gap * gap) {
          overlapsHill = true;
          break;
        }
      }
      if (overlapsHill) continue;

      hillocks.push({ x, z, r: effR });
      const regionId = getRegionAt({ x, z }).id;
      pushProp(
        x,
        z,
        'rolling_hillock',
        sx,
        sy,
        sz,
        effR * 0.55,
        this.hillockTintForRegion(regionId, rng),
        false,
      );
    }

    // -------------------------------------------------------------------------
    // Helpers for Layer B / C / D placement
    // -------------------------------------------------------------------------
    const tryPlaceProp = (
      x: number,
      z: number,
      kind: BiomePropKind,
      scale: number,
      minGap: number,
      tint: number,
      avoidHillockFactor = 0.72,
      riverPad = 5.0,
      lakePad = 2.6,
    ): boolean => {
      if (!isClearZone(x, z, margin, 26, 10, 10, 5.5, riverPad, lakePad)) return false;
      if (avoidHillockFactor > 0 && insideHillockCore(x, z, avoidHillockFactor)) return false;
      if (hasPlacedConflict(x, z, minGap)) return false;
      pushProp(x, z, kind, scale, scale, scale, minGap, tint, true);
      return true;
    };

    const targetHeroes = Math.round(520 * areaRatio);
    const targetMid = Math.round(550 * areaRatio);
    const targetReeds = Math.round(260 * areaRatio);
    const targetGround = Math.round(970 * areaRatio);

    let heroCount = 0;
    let midCount = 0;
    let reedCount = 0;
    let groundCount = 0;

    // -------------------------------------------------------------------------
    // Layer B + C + Grove-Skirt Layer D: Seeded Organic Biome Groves & Roadside Vistas
    // -------------------------------------------------------------------------
    const groveCenters: { x: number; z: number }[] = [];
    const desiredGroves = Math.max(18, Math.round(115 * areaRatio));
    let groveAttempts = 0;

    // Seed dedicated inner Royal Citadel & Crystal Sanctum groves first so smaller regions stay lush
    const citadelTarget = Math.max(2, Math.round(10 * areaRatio));
    const crystalTarget = Math.max(3, Math.round(14 * areaRatio));
    let citadelSeeded = 0;
    let crystalSeeded = 0;

    while (groveCenters.length < desiredGroves && groveAttempts < 2400) {
      groveAttempts++;
      let gx: number;
      let gz: number;

      if (citadelSeeded < citadelTarget) {
        const a = rng.next() * Math.PI * 2;
        const r = 29 + rng.next() * 29;
        gx = Math.cos(a) * r;
        gz = Math.sin(a) * r;
      } else if (crystalSeeded < crystalTarget) {
        if (rng.next() < 0.52) {
          // East Crystal corridor (x > 44, -18 <= z < 38)
          gx = (46 + rng.next() * 215) * (worldRadius / 280);
          gz = (-17 + rng.next() * 53) * (worldRadius / 280);
        } else {
          // South Crystal corridor (|x| <= 38, z >= 64)
          gx = (-36 + rng.next() * 72) * (worldRadius / 280);
          gz = (66 + rng.next() * 195) * (worldRadius / 280);
        }
      } else if (roadSegments.length > 0 && rng.next() < 0.34) {
        // Scenic roadside vistas (offset 9.5..22u from Royal Avenues)
        const seg = roadSegments[Math.floor(rng.next() * roadSegments.length)]!;
        const side = rng.next() < 0.5 ? 1 : -1;
        const rdx = seg.bx - seg.ax;
        const rdz = seg.bz - seg.az;
        const rlen = Math.hypot(rdx, rdz) || 1;
        const off = 9.5 + rng.next() * 12.5;
        gx = (seg.ax + seg.bx) * 0.5 + (-rdz / rlen) * side * off;
        gz = (seg.az + seg.bz) * 0.5 + (rdx / rlen) * side * off;
      } else {
        gx = (rng.next() * 2 - 1) * (margin - 8);
        gz = (rng.next() * 2 - 1) * (margin - 8);
      }

      if (!isClearZone(gx, gz, margin - 4, 27, 10.5, 10.5, 6.0, 5.5, 3.0)) continue;
      if (insideHillockCore(gx, gz, 0.78)) continue;

      let tooCloseGrove = false;
      for (let i = 0; i < groveCenters.length; i++) {
        const g = groveCenters[i]!;
        const dx = gx - g.x;
        const dz = gz - g.z;
        if (dx * dx + dz * dz < 14 * 14) {
          tooCloseGrove = true;
          break;
        }
      }
      if (tooCloseGrove) continue;

      groveCenters.push({ x: gx, z: gz });
      const regId = getRegionAt({ x: gx, z: gz }).id;
      if (regId === 'royal_citadel') citadelSeeded++;
      if (regId === 'crystal_sanctum') crystalSeeded++;
    }

    // Populate each organic grove with layered Hero Trees (B), Mid-Story Flora (C), and Understory Tufts (D)
    for (let gi = 0; gi < groveCenters.length; gi++) {
      const g = groveCenters[gi]!;
      const regId = getRegionAt({ x: g.x, z: g.z }).id;

      // Layer B: 3–5 Towering Biome Hero Trees / Palms / Glaciers / Monoliths
      const groveHeroes = 3 + Math.floor(rng.next() * 3);
      for (let h = 0; h < groveHeroes && heroCount < targetHeroes; h++) {
        const a = rng.next() * Math.PI * 2;
        const dist = h === 0 ? 0 : 4.2 + rng.next() * 7.2;
        const px = g.x + Math.cos(a) * dist;
        const pz = g.z + Math.sin(a) * dist;
        const pReg = getRegionAt({ x: px, z: pz }).id;
        const kind = this.pickHeroProp(pReg, rng);
        const sc = 0.85 + rng.next() * 0.52;
        const tint = this.heroColorTempTint(pReg, rng);
        if (tryPlaceProp(px, pz, kind, sc, 4.1, tint, 0.74)) {
          heroCount++;
        }
      }

      // Layer C: 4–6 Mid-Story Companion Flora (bamboo, ferns, Toro lanterns, coral, boulders, snow crags)
      const groveMids = 4 + Math.floor(rng.next() * 3);
      for (let m = 0; m < groveMids && midCount < targetMid; m++) {
        const a = (m / groveMids) * Math.PI * 2 + rng.next() * 0.75;
        const dist = 4.6 + rng.next() * 10.5;
        const px = g.x + Math.cos(a) * dist;
        const pz = g.z + Math.sin(a) * dist;
        const pReg = getRegionAt({ x: px, z: pz }).id;
        const spec = this.pickMidProp(pReg, rng);
        if (tryPlaceProp(px, pz, spec.kind, spec.scale, spec.gap, spec.tint, 0.85)) {
          midCount++;
        }
      }

      // Layer D (grove skirt): 5–8 Low Ground-Cover Tufts framing the grove
      const groveTufts = 5 + Math.floor(rng.next() * 4);
      for (let f = 0; f < groveTufts && groundCount < targetGround; f++) {
        const a = rng.next() * Math.PI * 2;
        const dist = 3.2 + rng.next() * 13.0;
        const px = g.x + Math.cos(a) * dist;
        const pz = g.z + Math.sin(a) * dist;
        const pReg = getRegionAt({ x: px, z: pz }).id;
        const spec = this.pickGroundProp(pReg, rng);
        if (tryPlaceProp(px, pz, spec.kind, spec.scale, 1.45, spec.tint, 0.45)) {
          groundCount++;
        }
      }

      // Extra roadside Japanese Toro stone lanterns in Blossom Valley
      if (regId === 'blossom_valley' && midCount < targetMid && rng.next() < 0.45) {
        const lx = g.x + (rng.next() - 0.5) * 8;
        const lz = g.z + (rng.next() - 0.5) * 8;
        if (tryPlaceProp(lx, lz, 'stone_lantern', 0.88 + rng.next() * 0.25, 2.5, 0xffffff, 0.8)) {
          midCount++;
        }
      }
    }

    // Fallback scatter passes to ensure Layer B & Layer C reach exact target density
    let fillAttempts = 0;
    while (heroCount < targetHeroes && fillAttempts < 2400) {
      fillAttempts++;
      const x = (rng.next() * 2 - 1) * margin;
      const z = (rng.next() * 2 - 1) * margin;
      const pReg = getRegionAt({ x, z }).id;
      const kind = this.pickHeroProp(pReg, rng);
      const sc = 0.82 + rng.next() * 0.52;
      if (tryPlaceProp(x, z, kind, sc, 4.0, this.heroColorTempTint(pReg, rng), 0.74)) {
        heroCount++;
      }
    }

    fillAttempts = 0;
    while (midCount < targetMid && fillAttempts < 2400) {
      fillAttempts++;
      const x = (rng.next() * 2 - 1) * margin;
      const z = (rng.next() * 2 - 1) * margin;
      const pReg = getRegionAt({ x, z }).id;
      const spec = this.pickMidProp(pReg, rng);
      if (tryPlaceProp(x, z, spec.kind, spec.scale, spec.gap, spec.tint, 0.85)) {
        midCount++;
      }
    }

    // -------------------------------------------------------------------------
    // Layer D1: Riverbank Cattail Reed Tufts & River Stones (offset 4.2..7.5u along banks!)
    // -------------------------------------------------------------------------
    let reedAttempts = 0;
    while (reedCount < targetReeds && reedAttempts < 2200 && riverSegments.length > 0) {
      reedAttempts++;
      const seg = riverSegments[Math.floor(rng.next() * riverSegments.length)]!;
      const t = rng.next();
      const bx = seg.ax + (seg.bx - seg.ax) * t;
      const bz = seg.az + (seg.bz - seg.az) * t;
      const rdx = seg.bx - seg.ax;
      const rdz = seg.bz - seg.az;
      const rlen = Math.hypot(rdx, rdz) || 1;
      const side = rng.next() < 0.5 ? 1 : -1;
      const off = 4.2 + rng.next() * 3.3; // strictly 4.2..7.5u on banks!
      const px = bx + (-rdz / rlen) * side * off;
      const pz = bz + (rdx / rlen) * side * off;

      const pReg = getRegionAt({ x: px, z: pz }).id;
      const isRiverRock = rng.next() < 0.16;
      const kind: BiomePropKind = isRiverRock ? 'rock_outcrop' : 'river_reed_tuft';
      const sc = isRiverRock ? 0.34 + rng.next() * 0.2 : 0.74 + rng.next() * 0.38; // 1.48..2.24u tall
      const tint = isRiverRock
        ? this.rockTintForRegion(pReg, rng)
        : this.reedTintForRegion(pReg, rng);

      if (tryPlaceProp(px, pz, kind, sc, 1.35, tint, 0.4, 4.15, 1.1)) {
        reedCount++;
      }
    }

    // Also ring the 2 Crystal Lakes with scenic cattail reeds
    for (let li = 0; li < lakes.length && reedCount < targetReeds; li++) {
      const lk = lakes[li]!;
      const shoreReeds = Math.round(14 * areaRatio);
      for (let sr = 0; sr < shoreReeds && reedCount < targetReeds; sr++) {
        const a = (sr / shoreReeds) * Math.PI * 2 + rng.next() * 0.25;
        const r = lk.r + 1.6 + rng.next() * 2.2;
        const px = lk.x + Math.cos(a) * r;
        const pz = lk.z + Math.sin(a) * r;
        const pReg = getRegionAt({ x: px, z: pz }).id;
        const sc = 0.76 + rng.next() * 0.34;
        if (
          tryPlaceProp(
            px,
            pz,
            'river_reed_tuft',
            sc,
            1.35,
            this.reedTintForRegion(pReg, rng),
            0.4,
            4.15,
            1.1,
          )
        ) {
          reedCount++;
        }
      }
    }

    // -------------------------------------------------------------------------
    // Layer D2: Open Meadow Grass, Wildflowers, Fallen-Petal Tufts & Snow-Dusted Stones
    // -------------------------------------------------------------------------
    let groundAttempts = 0;
    while (groundCount < targetGround && groundAttempts < 5000) {
      groundAttempts++;
      let px: number;
      let pz: number;

      if (roadSegments.length > 0 && rng.next() < 0.26) {
        // Lush roadside verge tufts (6.2..11.2u from road center)
        const seg = roadSegments[Math.floor(rng.next() * roadSegments.length)]!;
        const side = rng.next() < 0.5 ? 1 : -1;
        const rdx = seg.bx - seg.ax;
        const rdz = seg.bz - seg.az;
        const rlen = Math.hypot(rdx, rdz) || 1;
        const off = 6.2 + rng.next() * 5.0;
        px = (seg.ax + seg.bx) * 0.5 + (-rdz / rlen) * side * off;
        pz = (seg.az + seg.bz) * 0.5 + (rdx / rlen) * side * off;
      } else if (hillocks.length > 0 && rng.next() < 0.18) {
        // Wildflowers & stones dotting hillock flanks
        const h = hillocks[Math.floor(rng.next() * hillocks.length)]!;
        const a = rng.next() * Math.PI * 2;
        const dist = h.r * (0.72 + rng.next() * 0.65);
        px = h.x + Math.cos(a) * dist;
        pz = h.z + Math.sin(a) * dist;
      } else {
        px = (rng.next() * 2 - 1) * margin;
        pz = (rng.next() * 2 - 1) * margin;
      }

      const pReg = getRegionAt({ x: px, z: pz }).id;
      const spec = this.pickGroundProp(pReg, rng);
      if (tryPlaceProp(px, pz, spec.kind, spec.scale, 1.35, spec.tint, 0.42)) {
        groundCount++;
      }
    }

    // Upload all 20 GPU InstancedMesh batches
    for (let k = 0; k < archetypes.length; k++) {
      const list = buckets[k]!;
      if (list.length === 0) continue;
      const arch = archetypes[k]!;
      const mat = arch.isCrystalline ? crystalPropMat : organicMat;
      const inst = new InstancedMesh(arch.geometry, mat, list.length);

      for (let i = 0; i < list.length; i++) {
        const item = list[i]!;
        // Grounding shift: local Y=-0.5 maps cleanly to world Y=-0.5 regardless of scale!
        const posY = -0.5 + 0.5 * item.sy;
        POS_SCRATCH.set(item.x, posY, item.z);
        EULER_SCRATCH.set(0, item.rotY, 0);
        QUAT_SCRATCH.setFromEuler(EULER_SCRATCH);
        SCALE_SCRATCH.set(item.sx, item.sy, item.sz);
        M4_SCRATCH.compose(POS_SCRATCH, QUAT_SCRATCH, SCALE_SCRATCH);
        inst.setMatrixAt(i, M4_SCRATCH);
        COL_TMP.setHex(item.tint);
        inst.setColorAt(i, COL_TMP);
      }

      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      this.worldInstancedMeshes.push(inst);
      this.worldGroup.add(inst);
    }
  }

  private pickHeroProp(regionId: AdventureRegionId, rng: SeededRng): BiomePropKind {
    switch (regionId) {
      case 'royal_citadel':
        return rng.next() < 0.68 ? 'broadleaf_oak' : 'royal_cypress';
      case 'mushroom_woods':
        return rng.next() < 0.82 ? 'rainforest_buttress_tree' : 'mossy_log_mushrooms';
      case 'blossom_valley':
        return rng.next() < 0.78 ? 'weeping_sakura' : 'bamboo_grove';
      case 'crystal_sanctum':
        return rng.next() < 0.68 ? 'snow_spruce' : 'glacial_crag';
      case 'mermaid_lagoon':
        return rng.next() < 0.78 ? 'coconut_palm' : 'coastal_coral_rock';
      case 'candy_highlands':
        return rng.next() < 0.72 ? 'orchard_tree' : 'candy_orchard_spire';
      case 'starlight_peaks':
        return rng.next() < 0.66 ? 'windswept_pine' : 'celestial_monolith';
    }
  }

  private pickMidProp(
    regionId: AdventureRegionId,
    rng: SeededRng,
  ): { kind: BiomePropKind; scale: number; gap: number; tint: number } {
    const r = rng.next();
    switch (regionId) {
      case 'royal_citadel':
        if (r < 0.38) {
          return {
            kind: 'rock_outcrop',
            scale: 0.65 + rng.next() * 0.35,
            gap: 2.4,
            tint: this.rockTintForRegion(regionId, rng),
          };
        }
        if (r < 0.72) {
          return {
            kind: 'rainforest_fern',
            scale: 0.78 + rng.next() * 0.32,
            gap: 2.0,
            tint: 0xdff5be,
          };
        }
        return {
          kind: 'royal_cypress',
          scale: 0.56 + rng.next() * 0.2,
          gap: 2.8,
          tint: this.heroColorTempTint(regionId, rng),
        };

      case 'mushroom_woods':
        if (r < 0.42) {
          return {
            kind: 'mossy_log_mushrooms',
            scale: 0.72 + rng.next() * 0.38,
            gap: 2.6,
            tint: this.heroColorTempTint(regionId, rng),
          };
        }
        if (r < 0.78) {
          return {
            kind: 'rainforest_fern',
            scale: 0.85 + rng.next() * 0.42,
            gap: 2.0,
            tint: r < 0.6 ? 0xeafce6 : 0xd0f5dc,
          };
        }
        return {
          kind: 'rock_outcrop',
          scale: 0.68 + rng.next() * 0.34,
          gap: 2.4,
          tint: this.rockTintForRegion(regionId, rng),
        };

      case 'blossom_valley':
        if (r < 0.44) {
          return {
            kind: 'bamboo_grove',
            scale: 0.7 + rng.next() * 0.36,
            gap: 2.5,
            tint: this.heroColorTempTint(regionId, rng),
          };
        }
        if (r < 0.76) {
          return {
            kind: 'stone_lantern',
            scale: 0.82 + rng.next() * 0.28,
            gap: 2.2,
            tint: 0xf8fff6,
          };
        }
        return {
          kind: 'rock_outcrop',
          scale: 0.62 + rng.next() * 0.32,
          gap: 2.4,
          tint: this.rockTintForRegion(regionId, rng),
        };

      case 'crystal_sanctum':
        if (r < 0.44) {
          return {
            kind: 'glacial_crag',
            scale: 0.54 + rng.next() * 0.3,
            gap: 2.6,
            tint: 0xf5fbff,
          };
        }
        if (r < 0.76) {
          return {
            kind: 'rock_outcrop',
            scale: 0.68 + rng.next() * 0.38,
            gap: 2.4,
            tint: this.rockTintForRegion(regionId, rng),
          };
        }
        return {
          kind: 'snow_spruce',
          scale: 0.52 + rng.next() * 0.2,
          gap: 2.8,
          tint: 0xf2faff,
        };

      case 'mermaid_lagoon':
        if (r < 0.5) {
          return {
            kind: 'coastal_coral_rock',
            scale: 0.72 + rng.next() * 0.38,
            gap: 2.5,
            tint: 0xfff8f4,
          };
        }
        if (r < 0.78) {
          return {
            kind: 'rainforest_fern',
            scale: 0.8 + rng.next() * 0.36,
            gap: 2.0,
            tint: 0xd4fce4,
          };
        }
        return {
          kind: 'rock_outcrop',
          scale: 0.64 + rng.next() * 0.35,
          gap: 2.4,
          tint: this.rockTintForRegion(regionId, rng),
        };

      case 'candy_highlands':
        if (r < 0.48) {
          return {
            kind: 'candy_orchard_spire',
            scale: 0.58 + rng.next() * 0.28,
            gap: 2.5,
            tint: 0xfff8f5,
          };
        }
        if (r < 0.76) {
          return {
            kind: 'orchard_tree',
            scale: 0.56 + rng.next() * 0.2,
            gap: 2.7,
            tint: this.heroColorTempTint(regionId, rng),
          };
        }
        return {
          kind: 'rock_outcrop',
          scale: 0.62 + rng.next() * 0.32,
          gap: 2.4,
          tint: this.rockTintForRegion(regionId, rng),
        };

      case 'starlight_peaks':
        if (r < 0.42) {
          return {
            kind: 'celestial_monolith',
            scale: 0.58 + rng.next() * 0.26,
            gap: 2.6,
            tint: 0xf4f0ff,
          };
        }
        if (r < 0.76) {
          return {
            kind: 'rock_outcrop',
            scale: 0.72 + rng.next() * 0.38,
            gap: 2.4,
            tint: this.rockTintForRegion(regionId, rng),
          };
        }
        return {
          kind: 'windswept_pine',
          scale: 0.54 + rng.next() * 0.2,
          gap: 2.7,
          tint: 0xebf6ff,
        };
    }
  }

  private pickGroundProp(
    regionId: AdventureRegionId,
    rng: SeededRng,
  ): { kind: BiomePropKind; scale: number; tint: number } {
    const r = rng.next();
    if (r < 0.14) {
      // Small weathered / snow-dusted ground stones
      return {
        kind: 'rock_outcrop',
        scale: 0.3 + rng.next() * 0.18,
        tint: this.rockTintForRegion(regionId, rng),
      };
    }
    if ((regionId === 'mushroom_woods' || regionId === 'mermaid_lagoon') && r < 0.42) {
      return {
        kind: 'rainforest_fern',
        scale: 0.52 + rng.next() * 0.36, // ~1.1..1.9u
        tint: regionId === 'mushroom_woods' ? 0xcff5d2 : 0xd8fce0,
      };
    }

    const sc = 0.72 + rng.next() * 0.58; // ~1.04..1.88u tall
    let tint = 0xe4f5b8;
    switch (regionId) {
      case 'royal_citadel':
        tint = r < 0.5 ? 0xdff59a : 0xf4f8be;
        break;
      case 'mushroom_woods':
        tint = r < 0.5 ? 0x6cd98a : 0x8ef2a8;
        break;
      case 'blossom_valley':
        tint = r < 0.45 ? 0xffd2ea : 0xcff5b0;
        break;
      case 'crystal_sanctum':
        tint = r < 0.5 ? 0xdcf4ff : 0xeffaff;
        break;
      case 'mermaid_lagoon':
        tint = r < 0.5 ? 0x7ef2c4 : 0xd4fce2;
        break;
      case 'candy_highlands':
        tint = r < 0.5 ? 0xffd68e : 0xffe4b8;
        break;
      case 'starlight_peaks':
        tint = r < 0.5 ? 0xbec8ff : 0xdfdbff;
        break;
    }
    return { kind: 'grass_wildflower_tuft', scale: sc, tint };
  }

  private heroColorTempTint(regionId: AdventureRegionId, rng: SeededRng): number {
    const v = rng.next();
    switch (regionId) {
      case 'royal_citadel':
        return v < 0.34 ? 0xffffff : v < 0.68 ? 0xfff4df : 0xebf8e4;
      case 'mushroom_woods':
        return v < 0.34 ? 0xffffff : v < 0.68 ? 0xddf8ea : 0xeffce4;
      case 'blossom_valley':
        return v < 0.34 ? 0xffffff : v < 0.68 ? 0xfff0f6 : 0xfffaec;
      case 'crystal_sanctum':
        return v < 0.34 ? 0xffffff : v < 0.68 ? 0xeaf6ff : 0xf4f0ff;
      case 'mermaid_lagoon':
        return v < 0.34 ? 0xffffff : v < 0.68 ? 0xfff6e2 : 0xe6fcf8;
      case 'candy_highlands':
        return v < 0.34 ? 0xffffff : v < 0.68 ? 0xfff2da : 0xffebe6;
      case 'starlight_peaks':
        return v < 0.34 ? 0xffffff : v < 0.68 ? 0xe6ecff : 0xf0e8ff;
    }
  }

  private rockTintForRegion(regionId: AdventureRegionId, rng: SeededRng): number {
    const warm = rng.next() < 0.5;
    switch (regionId) {
      case 'royal_citadel':
        return warm ? 0xc8d4b8 : 0xb8c4b0;
      case 'mushroom_woods':
        return warm ? 0x8cb894 : 0x7aa888;
      case 'blossom_valley':
        return warm ? 0xcfd6c8 : 0xdcccd6;
      case 'crystal_sanctum':
        return warm ? 0xd8ecff : 0xc6dff8;
      case 'mermaid_lagoon':
        return warm ? 0xe6d8ba : 0xc8dcd6;
      case 'candy_highlands':
        return warm ? 0xe6c8a8 : 0xdcc0a8;
      case 'starlight_peaks':
        return warm ? 0x9aa6cc : 0x8c94bf;
    }
  }

  private reedTintForRegion(regionId: AdventureRegionId, rng: SeededRng): number {
    const alt = rng.next() < 0.5;
    switch (regionId) {
      case 'crystal_sanctum':
        return alt ? 0xd4eefc : 0xe8f6ff;
      case 'starlight_peaks':
        return alt ? 0xbec8f5 : 0xd2dcff;
      case 'candy_highlands':
        return alt ? 0xf5e2a6 : 0xffefc2;
      case 'blossom_valley':
        return alt ? 0xe4f7c8 : 0xf7e6f0;
      default:
        return alt ? 0xffffff : 0xeaf8dc;
    }
  }

  private hillockTintForRegion(regionId: AdventureRegionId, rng: SeededRng): number {
    const alt = rng.next() < 0.5;
    switch (regionId) {
      case 'royal_citadel':
        return alt ? 0x82c468 : 0x92cf72;
      case 'mushroom_woods':
        return alt ? 0x3ba66e : 0x48b578;
      case 'blossom_valley':
        return alt ? 0x9ed67e : 0xc2d49a;
      case 'crystal_sanctum':
        return alt ? 0xdaf0ff : 0xeef8ff;
      case 'mermaid_lagoon':
        return alt ? 0xe2cf98 : 0xb2d89c;
      case 'candy_highlands':
        return alt ? 0xebb674 : 0xe5a86c;
      case 'starlight_peaks':
        return alt ? 0x7682ba : 0x858fc9;
    }
  }
}
