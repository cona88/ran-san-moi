/**
 * "Vương Quốc Huyền Thoại Hoành Tráng" — Celestial Sky Spectacle & Living Sky Guardians.
 *
 * Purely deterministic (seeded Mulberry32 PRNG — zero `Math.random()`),
 * zero per-frame heap allocations inside `draw()`, full GPU disposal in `dispose()`,
 * and theme-reactive across all 4 `VisualTheme`s.
 */
import {
  AdditiveBlending,
  BackSide,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Float32BufferAttribute,
  Group,
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
  type BufferGeometry,
  type Material,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DEFAULT_LANDMARKS } from '../core/adventure';
import type { GameState, VisualTheme } from '../core/types';

const PLANET_POS_X = 72;
const PLANET_POS_Y = 126;
const PLANET_POS_Z = -664;
const PLANET_RADIUS = 48;

const DRAGON_SEGMENT_COUNT = 14;
const WHALE_RING_COUNT = 4;
const SPIRIT_BIRD_COUNT = 36;
const COMET_COUNT = 6;

const UP_AXIS = new Vector3(0, 1, 0);

interface SeededRng {
  next(): number;
}

/** Deterministic Mulberry32 PRNG — zero Math.random(). */
function createSeededRng(seed: number): SeededRng {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

interface SpectacleThemeSpec {
  readonly planetSurface: number;
  readonly planetBand: number;
  readonly planetHalo: number;
  readonly planetHaloOpacity: number;
  readonly ringInner: number;
  readonly ringOuter: number;
  readonly ringOpacity: number;
  readonly godRayColor: number;
  readonly godRayOpacity: number;
  readonly dragonBody: number;
  readonly dragonEmissive: number;
  readonly dragonFin: number;
  readonly whaleBody: number;
  readonly whaleEmissive: number;
  readonly whaleRing: number;
  readonly birdTint: number;
  readonly cometHead: number;
  readonly cometTail: number;
}

const SPECTACLE_THEMES: Record<VisualTheme, SpectacleThemeSpec> = {
  honeycomb_arena: {
    planetSurface: 0xf4c47f,
    planetBand: 0xd98a4a,
    planetHalo: 0xffe4a8,
    planetHaloOpacity: 0.24,
    ringInner: 0xfff0c2,
    ringOuter: 0xf6b96d,
    ringOpacity: 0.44,
    godRayColor: 0xffe6a6,
    godRayOpacity: 0.072,
    dragonBody: 0xffd564,
    dragonEmissive: 0xff9b26,
    dragonFin: 0x6ff8ff,
    whaleBody: 0x8ef2ff,
    whaleEmissive: 0x3ecfff,
    whaleRing: 0xffe99c,
    birdTint: 0xfff7d4,
    cometHead: 0xfff7cf,
    cometTail: 0xffcc66,
  },
  crystal_garden: {
    planetSurface: 0x8f6bff,
    planetBand: 0xff7bd5,
    planetHalo: 0x7ef8e6,
    planetHaloOpacity: 0.34,
    ringInner: 0xa6ffef,
    ringOuter: 0xff9ce6,
    ringOpacity: 0.56,
    godRayColor: 0xb89eff,
    godRayOpacity: 0.105,
    dragonBody: 0xffd670,
    dragonEmissive: 0xff6bd6,
    dragonFin: 0x6cf7e6,
    whaleBody: 0x9cf7ff,
    whaleEmissive: 0x7a5cff,
    whaleRing: 0xffa6e8,
    birdTint: 0xf5dcff,
    cometHead: 0xffffff,
    cometTail: 0x82ffe8,
  },
  starlight_galaxy: {
    planetSurface: 0x4b8bff,
    planetBand: 0x9b6eff,
    planetHalo: 0x70e8ff,
    planetHaloOpacity: 0.42,
    ringInner: 0x9ef6ff,
    ringOuter: 0xc299ff,
    ringOpacity: 0.64,
    godRayColor: 0x84dfff,
    godRayOpacity: 0.115,
    dragonBody: 0xffe078,
    dragonEmissive: 0x58e2ff,
    dragonFin: 0x8ef6ff,
    whaleBody: 0x7ce6ff,
    whaleEmissive: 0x5c8aff,
    whaleRing: 0xa8f2ff,
    birdTint: 0xdff8ff,
    cometHead: 0xffffff,
    cometTail: 0x78e8ff,
  },
  candy_island: {
    planetSurface: 0xffa8d8,
    planetBand: 0xffd080,
    planetHalo: 0xfff0c8,
    planetHaloOpacity: 0.28,
    ringInner: 0xfff2c6,
    ringOuter: 0xff9ee0,
    ringOpacity: 0.48,
    godRayColor: 0xffd6ee,
    godRayOpacity: 0.082,
    dragonBody: 0xffe27a,
    dragonEmissive: 0xff7ec8,
    dragonFin: 0x8cf6ff,
    whaleBody: 0xa6f4ff,
    whaleEmissive: 0xff8ce0,
    whaleRing: 0xffe89e,
    birdTint: 0xfff4fc,
    cometHead: 0xfff8de,
    cometTail: 0xff9ee0,
  },
};

interface GodRayEntry {
  readonly mesh: Mesh;
  readonly phase: number;
  readonly speed: number;
  readonly baseScaleXZ: number;
}

interface DragonSegmentEntry {
  readonly group: Group;
  readonly leftFin: Mesh | null;
  readonly rightFin: Mesh | null;
}

interface SpiritBirdData {
  readonly centerX: number;
  readonly centerZ: number;
  readonly baseY: number;
  readonly radiusX: number;
  readonly radiusZ: number;
  readonly angularSpeed: number;
  readonly phase: number;
  readonly bobAmp: number;
  readonly bobSpeed: number;
  readonly scale: number;
  readonly direction: 1 | -1;
}

interface CometEntry {
  readonly group: Group;
  readonly headMat: MeshBasicMaterial;
  readonly tailMat: MeshBasicMaterial;
  readonly startX: number;
  readonly startY: number;
  readonly startZ: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly dirZ: number;
  readonly travelDist: number;
  readonly period: number;
  readonly phaseOffset: number;
  readonly activeDuration: number;
}

/** Bake a simple non-indexed vertex-colored part for merged geometries, disposing `raw`. */
function bakeColoredPart(
  raw: BufferGeometry,
  bottomHex: number,
  topHex: number,
  tx = 0,
  ty = 0,
  tz = 0,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
  tmpMat: Matrix4,
  tmpPos: Vector3,
  tmpScale: Vector3,
  tmpEuler: Euler,
  tmpQuat: Quaternion,
  colA: Color,
  colB: Color,
  colMix: Color,
): BufferGeometry {
  const geo = raw.index ? raw.toNonIndexed() : raw.clone();
  raw.dispose();

  for (const attr of Object.keys(geo.attributes)) {
    if (attr !== 'position' && attr !== 'normal') {
      geo.deleteAttribute(attr);
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
  const span = Math.max(1e-4, maxY - minY);

  colA.setHex(bottomHex);
  colB.setHex(topHex);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) / span;
    colMix.copy(colA).lerp(colB, t);
    colors[i * 3] = colMix.r;
    colors[i * 3 + 1] = colMix.g;
    colors[i * 3 + 2] = colMix.b;
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));

  tmpEuler.set(rx, ry, rz);
  tmpQuat.setFromEuler(tmpEuler);
  tmpPos.set(tx, ty, tz);
  tmpScale.set(sx, sy, sz);
  tmpMat.compose(tmpPos, tmpQuat, tmpScale);
  geo.applyMatrix4(tmpMat);

  if (!geo.attributes['normal']) {
    geo.computeVertexNormals();
  }
  return geo;
}

/**
 * Sky spectacle layer: Colossal Ringed Planet, 12 volumetric-style god-ray shafts,
 * Celestial Sky Dragon, Starlight Sky Whale, 36 Spirit Birds, and 6 Shooting Stars.
 */
export class SkySpectacle3DView {
  private readonly root = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];

  // Ringed Planet
  private readonly planetGroup = new Group();
  private readonly planetMesh: Mesh;
  private readonly planetBandMesh: Mesh;
  private readonly planetHaloMesh: Mesh;
  private readonly ringInnerMesh: Mesh;
  private readonly ringOuterMesh: Mesh;
  private readonly planetMat: MeshBasicMaterial;
  private readonly planetBandMat: MeshBasicMaterial;
  private readonly planetHaloMat: MeshBasicMaterial;
  private readonly ringInnerMat: MeshBasicMaterial;
  private readonly ringOuterMat: MeshBasicMaterial;

  // 12 God-Rays
  private readonly godRayMat: MeshBasicMaterial;
  private readonly godRays: GodRayEntry[] = [];
  private baseGodRayOpacity = 0.072;

  // Celestial Sky Dragon
  private readonly dragonRoot = new Group();
  private readonly dragonHeadGroup = new Group();
  private readonly dragonSegments: DragonSegmentEntry[] = [];
  private readonly dragonBodyMat: MeshStandardMaterial;
  private readonly dragonFinMat: MeshBasicMaterial;
  private readonly dragonGoldMat: MeshStandardMaterial;

  // Starlight Sky Whale
  private readonly whaleRoot = new Group();
  private readonly whaleLeftFin: Mesh;
  private readonly whaleRightFin: Mesh;
  private readonly whaleTail: Group;
  private readonly whaleRings: Mesh[] = [];
  private readonly whaleBodyMat: MeshStandardMaterial;
  private readonly whaleFinMat: MeshBasicMaterial;
  private readonly whaleRingMat: MeshBasicMaterial;

  // 36 Shimmering Spirit Birds (1 InstancedMesh)
  private readonly birdMesh: InstancedMesh;
  private readonly birdMat: MeshBasicMaterial;
  private readonly birds: SpiritBirdData[] = [];

  // 6 Pooled Shooting Stars / Comets
  private readonly comets: CometEntry[] = [];

  // Reused scratch math objects (zero per-frame allocations!)
  private readonly scratchMat = new Matrix4();
  private readonly scratchLookMat = new Matrix4();
  private readonly scratchPos = new Vector3();
  private readonly scratchNextPos = new Vector3();
  private readonly scratchDir = new Vector3();
  private readonly scratchScale = new Vector3();
  private readonly scratchEuler = new Euler();
  private readonly scratchQuat = new Quaternion();

  constructor(private readonly scene: Scene) {
    const rng = createSeededRng(0x5a7c91e3);
    const colA = new Color();
    const colB = new Color();
    const colMix = new Color();

    // ------------------------------------------------------------------
    // 1. Colossal Ringed Celestial Planet & Nebula Rim (r ≈ 680)
    // ------------------------------------------------------------------
    this.planetMat = this.trackMat(
      new MeshBasicMaterial({
        color: 0xf4c47f,
        vertexColors: true,
        fog: false,
      }),
    );
    const planetGeo = this.trackGeo(this.createPlanetSphereGeometry(PLANET_RADIUS));
    this.planetMesh = new Mesh(planetGeo, this.planetMat);

    this.planetBandMat = this.trackMat(
      new MeshBasicMaterial({
        color: 0xd98a4a,
        transparent: true,
        opacity: 0.34,
        fog: false,
        depthWrite: false,
      }),
    );
    const bandGeo = this.trackGeo(
      new CylinderGeometry(
        PLANET_RADIUS * 1.012,
        PLANET_RADIUS * 1.012,
        PLANET_RADIUS * 0.36,
        36,
        1,
        true,
      ),
    );
    this.planetBandMesh = new Mesh(bandGeo, this.planetBandMat);

    this.planetHaloMat = this.trackMat(
      new MeshBasicMaterial({
        color: 0xffe4a8,
        transparent: true,
        opacity: 0.24,
        blending: AdditiveBlending,
        side: BackSide,
        fog: false,
        depthWrite: false,
      }),
    );
    const haloGeo = this.trackGeo(new SphereGeometry(PLANET_RADIUS * 1.19, 28, 20));
    this.planetHaloMesh = new Mesh(haloGeo, this.planetHaloMat);

    this.ringInnerMat = this.trackMat(
      new MeshBasicMaterial({
        color: 0xfff0c2,
        transparent: true,
        opacity: 0.44,
        side: DoubleSide,
        blending: AdditiveBlending,
        fog: false,
        depthWrite: false,
      }),
    );
    const ringInnerGeo = this.trackGeo(
      new RingGeometry(PLANET_RADIUS * 1.34, PLANET_RADIUS * 1.72, 64),
    );
    this.ringInnerMesh = new Mesh(ringInnerGeo, this.ringInnerMat);
    this.ringInnerMesh.rotation.x = Math.PI * 0.5;

    this.ringOuterMat = this.trackMat(
      new MeshBasicMaterial({
        color: 0xf6b96d,
        transparent: true,
        opacity: 0.3,
        side: DoubleSide,
        blending: AdditiveBlending,
        fog: false,
        depthWrite: false,
      }),
    );
    const ringOuterGeo = this.trackGeo(
      new RingGeometry(PLANET_RADIUS * 1.82, PLANET_RADIUS * 2.28, 64),
    );
    this.ringOuterMesh = new Mesh(ringOuterGeo, this.ringOuterMat);
    this.ringOuterMesh.rotation.x = Math.PI * 0.5;

    this.planetGroup.add(
      this.planetMesh,
      this.planetBandMesh,
      this.planetHaloMesh,
      this.ringInnerMesh,
      this.ringOuterMesh,
    );
    this.planetGroup.position.set(PLANET_POS_X, PLANET_POS_Y, PLANET_POS_Z);
    this.planetGroup.rotation.set(0.36, -0.22, -0.28);
    this.root.add(this.planetGroup);

    // ------------------------------------------------------------------
    // 2. Volumetric-Style Tilted Golden/Aurora God-Rays (12 shafts)
    // ------------------------------------------------------------------
    this.godRayMat = this.trackMat(
      new MeshBasicMaterial({
        color: 0xffe6a6,
        vertexColors: true,
        transparent: true,
        opacity: this.baseGodRayOpacity,
        blending: AdditiveBlending,
        side: DoubleSide,
        depthWrite: false,
        fog: false,
      }),
    );
    const godRayGeo = this.trackGeo(this.createGodRayGeometry());

    // 6 shafts fanning down around Central Royal Castle (0, 0)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.25;
      const dist = 7 + (i % 2) * 7;
      const shaft = new Mesh(godRayGeo, this.godRayMat);
      shaft.position.set(Math.cos(a) * dist, 42, Math.sin(a) * dist);
      shaft.rotation.set(0.22, a * 0.3, -0.18);
      const scaleXZ = 0.85 + (i % 3) * 0.22;
      shaft.scale.set(scaleXZ, 1.0 + (i % 2) * 0.16, scaleXZ);
      shaft.frustumCulled = false;
      this.root.add(shaft);
      this.godRays.push({
        mesh: shaft,
        phase: i * 1.05,
        speed: 0.45 + (i % 3) * 0.12,
        baseScaleXZ: scaleXZ,
      });
    }

    // 6 shafts streaming down over each of the 6 Colossal Landmarks
    for (let i = 0; i < DEFAULT_LANDMARKS.length; i++) {
      const lm = DEFAULT_LANDMARKS[i]!;
      const shaft = new Mesh(godRayGeo, this.godRayMat);
      shaft.position.set(lm.x, 48, lm.z);
      shaft.rotation.set(0.2, 0.35 * i, -0.16);
      const scaleXZ = 1.25;
      shaft.scale.set(scaleXZ, 1.18, scaleXZ);
      shaft.frustumCulled = false;
      this.root.add(shaft);
      this.godRays.push({
        mesh: shaft,
        phase: (i + 6) * 0.92,
        speed: 0.38 + (i % 3) * 0.1,
        baseScaleXZ: scaleXZ,
      });
    }

    // ------------------------------------------------------------------
    // 3. Celestial Sky Dragon (~38u long, 14 articulated segments)
    // ------------------------------------------------------------------
    this.dragonBodyMat = this.trackMat(
      new MeshStandardMaterial({
        color: 0xffd564,
        emissive: 0xff9b26,
        emissiveIntensity: 0.72,
        roughness: 0.28,
        metalness: 0.45,
        fog: false,
      }),
    );
    this.dragonGoldMat = this.trackMat(
      new MeshStandardMaterial({
        color: 0xfff2a6,
        emissive: 0xffcc44,
        emissiveIntensity: 0.85,
        roughness: 0.2,
        metalness: 0.7,
        fog: false,
      }),
    );
    this.dragonFinMat = this.trackMat(
      new MeshBasicMaterial({
        color: 0x6ff8ff,
        transparent: true,
        opacity: 0.68,
        side: DoubleSide,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.buildSkyDragon();
    this.root.add(this.dragonRoot);

    // ------------------------------------------------------------------
    // 4. Starlight Sky Whale (~30u long ethereal glowing whale)
    // ------------------------------------------------------------------
    this.whaleBodyMat = this.trackMat(
      new MeshStandardMaterial({
        color: 0x8ef2ff,
        emissive: 0x3ecfff,
        emissiveIntensity: 0.68,
        roughness: 0.25,
        metalness: 0.2,
        transparent: true,
        opacity: 0.88,
        fog: false,
      }),
    );
    this.whaleFinMat = this.trackMat(
      new MeshBasicMaterial({
        color: 0xb8f8ff,
        transparent: true,
        opacity: 0.62,
        side: DoubleSide,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.whaleRingMat = this.trackMat(
      new MeshBasicMaterial({
        color: 0xffe99c,
        transparent: true,
        opacity: 0.45,
        side: DoubleSide,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    const whaleParts = this.buildSkyWhale();
    this.whaleLeftFin = whaleParts.leftFin;
    this.whaleRightFin = whaleParts.rightFin;
    this.whaleTail = whaleParts.tail;
    this.root.add(this.whaleRoot);

    // ------------------------------------------------------------------
    // 5. Flock of 36 Shimmering Spirit Birds (1 InstancedMesh)
    // ------------------------------------------------------------------
    const birdGeo = this.trackGeo(this.createSpiritBirdGeometry(colA, colB, colMix));
    this.birdMat = this.trackMat(
      new MeshBasicMaterial({
        color: 0xfff7d4,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        side: DoubleSide,
        fog: false,
      }),
    );
    this.birdMesh = new InstancedMesh(birdGeo, this.birdMat, SPIRIT_BIRD_COUNT);
    this.birdMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.birdMesh.frustumCulled = false;

    const flockCenters: readonly { x: number; z: number; baseY: number; rMin: number }[] = [
      { x: 0, z: 0, baseY: 28, rMin: 22 },
      { x: -82, z: -62, baseY: 36, rMin: 20 },
      { x: 82, z: -62, baseY: 34, rMin: 22 },
    ];
    for (let i = 0; i < SPIRIT_BIRD_COUNT; i++) {
      const flock = flockCenters[i % 3]!;
      const localIdx = Math.floor(i / 3);
      const rX = flock.rMin + (localIdx % 4) * 4.5 + rng.next() * 5;
      const rZ = rX * (0.78 + rng.next() * 0.36);
      this.birds.push({
        centerX: flock.x + (rng.next() - 0.5) * 10,
        centerZ: flock.z + (rng.next() - 0.5) * 10,
        baseY: flock.baseY + (rng.next() - 0.5) * 9,
        radiusX: rX,
        radiusZ: rZ,
        angularSpeed: 0.24 + rng.next() * 0.16,
        phase: (localIdx / 12) * Math.PI * 2 + rng.next() * 0.5,
        bobAmp: 1.2 + rng.next() * 1.4,
        bobSpeed: 1.4 + rng.next() * 0.9,
        scale: 0.72 + rng.next() * 0.45,
        direction: i % 2 === 0 ? 1 : -1,
      });
    }
    this.root.add(this.birdMesh);

    // ------------------------------------------------------------------
    // 6. 6 Pooled Shooting Stars / Golden Comets
    // ------------------------------------------------------------------
    const cometHeadGeo = this.trackGeo(new OctahedronGeometry(2.4, 0));
    const cometTailGeo = this.trackGeo(new ConeGeometry(1.5, 42, 8, 1, true));
    // Align cone tip to +Z and tail extending along -Z
    cometTailGeo.rotateX(-Math.PI * 0.5);
    cometTailGeo.translate(0, 0, -21);

    for (let i = 0; i < COMET_COUNT; i++) {
      const headMat = this.trackMat(
        new MeshBasicMaterial({
          color: 0xfff7cf,
          transparent: true,
          opacity: 0.95,
          blending: AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
      );
      const tailMat = this.trackMat(
        new MeshBasicMaterial({
          color: 0xffcc66,
          transparent: true,
          opacity: 0.55,
          blending: AdditiveBlending,
          side: DoubleSide,
          depthWrite: false,
          fog: false,
        }),
      );
      const group = new Group();
      const headMesh = new Mesh(cometHeadGeo, headMat);
      const tailMesh = new Mesh(cometTailGeo, tailMat);
      group.add(headMesh, tailMesh);
      group.visible = false;
      this.root.add(group);

      const az = -Math.PI * 0.85 + (i / COMET_COUNT) * Math.PI * 0.7 + (rng.next() - 0.5) * 0.25;
      const dist = 480 + rng.next() * 120;
      const startX = Math.sin(az) * dist;
      const startZ = -Math.abs(Math.cos(az) * dist) - 120;
      const startY = 148 + rng.next() * 68;

      const dX = (i % 2 === 0 ? 1 : -1) * (0.72 + rng.next() * 0.25);
      const dY = -(0.28 + rng.next() * 0.16);
      const dZ = (rng.next() - 0.5) * 0.22;
      const invLen = 1 / Math.hypot(dX, dY, dZ);

      this.comets.push({
        group,
        headMat,
        tailMat,
        startX,
        startY,
        startZ,
        dirX: dX * invLen,
        dirY: dY * invLen,
        dirZ: dZ * invLen,
        travelDist: 230 + rng.next() * 120,
        period: 7.0 + i * 1.15 + rng.next() * 1.2,
        phaseOffset: i * 1.9 + rng.next() * 2.0,
        activeDuration: 1.7 + rng.next() * 0.65,
      });
    }

    this.scene.add(this.root);
    this.setTheme('honeycomb_arena');
  }

  /** Adapt planet, god-rays, sky guardians, spirit birds, and comets to the active `VisualTheme`. */
  setTheme(theme: VisualTheme): void {
    const spec = SPECTACLE_THEMES[theme];
    this.planetMat.color.setHex(spec.planetSurface);
    this.planetBandMat.color.setHex(spec.planetBand);
    this.planetHaloMat.color.setHex(spec.planetHalo);
    this.planetHaloMat.opacity = spec.planetHaloOpacity;
    this.ringInnerMat.color.setHex(spec.ringInner);
    this.ringInnerMat.opacity = spec.ringOpacity;
    this.ringOuterMat.color.setHex(spec.ringOuter);
    this.ringOuterMat.opacity = spec.ringOpacity * 0.68;

    this.baseGodRayOpacity = spec.godRayOpacity;
    this.godRayMat.color.setHex(spec.godRayColor);
    this.godRayMat.opacity = spec.godRayOpacity;

    this.dragonBodyMat.color.setHex(spec.dragonBody);
    this.dragonBodyMat.emissive.setHex(spec.dragonEmissive);
    this.dragonFinMat.color.setHex(spec.dragonFin);

    this.whaleBodyMat.color.setHex(spec.whaleBody);
    this.whaleBodyMat.emissive.setHex(spec.whaleEmissive);
    this.whaleFinMat.color.setHex(spec.whaleBody);
    this.whaleRingMat.color.setHex(spec.whaleRing);

    this.birdMat.color.setHex(spec.birdTint);

    for (let i = 0; i < this.comets.length; i++) {
      const c = this.comets[i]!;
      c.headMat.color.setHex(spec.cometHead);
      c.tailMat.color.setHex(spec.cometTail);
    }
  }

  /**
   * Animate all celestial spectacle elements at 60fps.
   * Strictly zero heap allocations per frame.
   */
  draw(elapsed: number, _delta: number, _state: GameState, _focusPos: Vector3): void {
    // 1. Slow celestial planet rotation & gentle ring shimmer
    this.planetMesh.rotation.y = elapsed * 0.018;
    this.planetBandMesh.rotation.y = elapsed * 0.026;
    this.ringInnerMesh.rotation.z = elapsed * 0.012;
    this.ringOuterMesh.rotation.z = -elapsed * 0.008;

    // 2. Softly pulsing volumetric-style god-rays
    this.godRayMat.opacity = this.baseGodRayOpacity * (0.86 + 0.14 * Math.sin(elapsed * 0.7));
    for (let i = 0; i < this.godRays.length; i++) {
      const ray = this.godRays[i]!;
      const pulse = 0.92 + 0.1 * Math.sin(elapsed * ray.speed + ray.phase);
      ray.mesh.scale.x = ray.baseScaleXZ * pulse;
      ray.mesh.scale.z = ray.baseScaleXZ * pulse;
    }

    // 3. Celestial Sky Dragon soaring on a grand 3D figure-8 sky orbit
    this.updateSkyDragon(elapsed);

    // 4. Starlight Sky Whale gliding across the upper aurora clouds
    this.updateSkyWhale(elapsed);

    // 5. Flock of 36 shimmering Spirit Birds (1 InstancedMesh update)
    this.updateSpiritBirds(elapsed);

    // 6. 6 Pooled Shooting Stars / Golden Comets
    this.updateComets(elapsed);
  }

  /** Dispose all GPU geometries and materials and detach from the scene. */
  dispose(): void {
    this.scene.remove(this.root);
    for (let i = 0; i < this.geometries.length; i++) {
      this.geometries[i]!.dispose();
    }
    for (let i = 0; i < this.materials.length; i++) {
      this.materials[i]!.dispose();
    }
    this.geometries.length = 0;
    this.materials.length = 0;
  }

  private trackGeo<T extends BufferGeometry>(geo: T): T {
    this.geometries.push(geo);
    return geo;
  }

  private trackMat<T extends Material>(mat: T): T {
    this.materials.push(mat);
    return mat;
  }

  private createPlanetSphereGeometry(radius: number): BufferGeometry {
    const geo = new SphereGeometry(radius, 32, 24);
    const pos = geo.attributes['position']!;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const ny = pos.getY(i) / radius;
      // Soft equatorial banding & bright illuminated upper hemisphere
      const band = 0.88 + 0.12 * Math.sin(ny * 10.5);
      const lit = 0.72 + 0.28 * Math.max(0, ny * 0.6 + 0.55);
      const shade = Math.min(1, band * lit);
      colors[i * 3] = shade;
      colors[i * 3 + 1] = shade * 0.98;
      colors[i * 3 + 2] = shade * 0.96;
    }
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return geo;
  }

  private createGodRayGeometry(): BufferGeometry {
    const height = 92;
    const geo = new CylinderGeometry(3.2, 13.5, height, 12, 1, true);
    const pos = geo.attributes['position']!;
    const colors = new Float32Array(pos.count * 3);
    const halfH = height * 0.5;
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) + halfH) / height; // 0 = bottom, 1 = top
      // Smooth bell fade: 0 at ground & sky tip, brightest in mid-upper shaft
      const fade = Math.sin(Math.max(0, Math.min(1, t)) * Math.PI);
      const intensity = fade * fade;
      colors[i * 3] = intensity;
      colors[i * 3 + 1] = intensity;
      colors[i * 3 + 2] = intensity;
    }
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return geo;
  }

  private createSpiritBirdGeometry(colA: Color, colB: Color, colMix: Color): BufferGeometry {
    const parts: BufferGeometry[] = [
      // Sleek body pointing along +Z
      bakeColoredPart(
        new ConeGeometry(0.28, 1.35, 5),
        0xd8f6ff,
        0xffffff,
        0,
        0,
        0,
        Math.PI * 0.5,
        0,
        0,
        1,
        1,
        1,
        this.scratchMat,
        this.scratchPos,
        this.scratchScale,
        this.scratchEuler,
        this.scratchQuat,
        colA,
        colB,
        colMix,
      ),
      // Left swept V-wing
      bakeColoredPart(
        new PlaneGeometry(1.55, 0.52),
        0xb8f0ff,
        0xffffff,
        -0.72,
        0.24,
        -0.12,
        Math.PI * 0.5,
        0.32,
        -0.32,
        1,
        1,
        1,
        this.scratchMat,
        this.scratchPos,
        this.scratchScale,
        this.scratchEuler,
        this.scratchQuat,
        colA,
        colB,
        colMix,
      ),
      // Right swept V-wing
      bakeColoredPart(
        new PlaneGeometry(1.55, 0.52),
        0xb8f0ff,
        0xffffff,
        0.72,
        0.24,
        -0.12,
        Math.PI * 0.5,
        -0.32,
        0.32,
        1,
        1,
        1,
        this.scratchMat,
        this.scratchPos,
        this.scratchScale,
        this.scratchEuler,
        this.scratchQuat,
        colA,
        colB,
        colMix,
      ),
      // Luminous tail chevron
      bakeColoredPart(
        new ConeGeometry(0.32, 0.72, 4),
        0xffe99c,
        0xffffff,
        0,
        0.04,
        -0.85,
        -Math.PI * 0.5,
        0,
        0,
        1,
        1,
        0.35,
        this.scratchMat,
        this.scratchPos,
        this.scratchScale,
        this.scratchEuler,
        this.scratchQuat,
        colA,
        colB,
        colMix,
      ),
    ];
    const merged = mergeGeometries(parts, false);
    for (let i = 0; i < parts.length; i++) parts[i]!.dispose();
    return merged ?? new OctahedronGeometry(0.5, 0);
  }

  private buildSkyDragon(): void {
    // Sculpted horned head (+Z forward)
    const snoutGeo = this.trackGeo(new ConeGeometry(1.55, 4.4, 8));
    snoutGeo.rotateX(Math.PI * 0.5);
    const snout = new Mesh(snoutGeo, this.dragonBodyMat);
    snout.position.set(0, 0, 1.5);

    const skullGeo = this.trackGeo(new SphereGeometry(1.75, 12, 10));
    const skull = new Mesh(skullGeo, this.dragonBodyMat);

    const hornGeo = this.trackGeo(new ConeGeometry(0.32, 3.4, 6));
    const leftHorn = new Mesh(hornGeo, this.dragonGoldMat);
    leftHorn.position.set(-0.95, 1.45, -1.2);
    leftHorn.rotation.set(-0.85, 0, 0.35);
    const rightHorn = new Mesh(hornGeo, this.dragonGoldMat);
    rightHorn.position.set(0.95, 1.45, -1.2);
    rightHorn.rotation.set(-0.85, 0, -0.35);

    const maneGeo = this.trackGeo(new TorusGeometry(1.85, 0.42, 6, 12));
    const mane = new Mesh(maneGeo, this.dragonFinMat);
    mane.position.set(0, 0.1, -1.1);

    const eyeGeo = this.trackGeo(new OctahedronGeometry(0.35, 0));
    const leftEye = new Mesh(eyeGeo, this.dragonFinMat);
    leftEye.position.set(-1.1, 0.55, 1.15);
    const rightEye = new Mesh(eyeGeo, this.dragonFinMat);
    rightEye.position.set(1.1, 0.55, 1.15);

    this.dragonHeadGroup.add(snout, skull, leftHorn, rightHorn, mane, leftEye, rightEye);
    this.dragonRoot.add(this.dragonHeadGroup);

    // 14 articulated tapered body segments (~38u total length)
    const segGeo = this.trackGeo(new SphereGeometry(1, 10, 8));
    const crestGeo = this.trackGeo(new ConeGeometry(0.32, 1.65, 4));
    const ribbonFinGeo = this.trackGeo(new PlaneGeometry(5.6, 2.0));
    const tailFanGeo = this.trackGeo(new ConeGeometry(2.6, 5.2, 5));
    tailFanGeo.rotateX(-Math.PI * 0.5);

    for (let i = 0; i < DRAGON_SEGMENT_COUNT; i++) {
      const frac = i / (DRAGON_SEGMENT_COUNT - 1);
      const radius = 1.65 * (1 - frac * 0.76);
      const segGroup = new Group();

      const body = new Mesh(segGeo, this.dragonBodyMat);
      body.scale.set(radius, radius * 0.92, radius * 1.45);
      segGroup.add(body);

      const crest = new Mesh(crestGeo, this.dragonGoldMat);
      crest.position.set(0, radius * 1.05, 0);
      crest.scale.setScalar(0.55 + (1 - frac) * 0.65);
      segGroup.add(crest);

      let leftFin: Mesh | null = null;
      let rightFin: Mesh | null = null;
      if (i === 2 || i === 5 || i === 9) {
        const finScale = i === 2 ? 1.15 : i === 5 ? 0.95 : 0.72;
        leftFin = new Mesh(ribbonFinGeo, this.dragonFinMat);
        leftFin.position.set(-radius * 1.6 - 1.5 * finScale, 0.25, -0.4);
        leftFin.rotation.set(Math.PI * 0.5, 0.2, 0.25);
        leftFin.scale.setScalar(finScale);

        rightFin = new Mesh(ribbonFinGeo, this.dragonFinMat);
        rightFin.position.set(radius * 1.6 + 1.5 * finScale, 0.25, -0.4);
        rightFin.rotation.set(Math.PI * 0.5, -0.2, -0.25);
        rightFin.scale.setScalar(finScale);

        segGroup.add(leftFin, rightFin);
      }

      if (i === DRAGON_SEGMENT_COUNT - 1) {
        const tailFan = new Mesh(tailFanGeo, this.dragonFinMat);
        tailFan.position.set(0, 0, -2.5);
        segGroup.add(tailFan);
      }

      this.dragonRoot.add(segGroup);
      this.dragonSegments.push({ group: segGroup, leftFin, rightFin });
    }
  }

  private buildSkyWhale(): { leftFin: Mesh; rightFin: Mesh; tail: Group } {
    // Streamlined glowing body (~30u long along Z, nose at +Z)
    const torsoGeo = this.trackGeo(new SphereGeometry(4.2, 16, 12));
    const torso = new Mesh(torsoGeo, this.whaleBodyMat);
    torso.scale.set(1.0, 0.85, 2.55);

    const browGeo = this.trackGeo(new SphereGeometry(3.6, 14, 10));
    const brow = new Mesh(browGeo, this.whaleBodyMat);
    brow.position.set(0, 0.35, 7.2);
    brow.scale.set(0.95, 0.82, 1.35);

    const dorsalGeo = this.trackGeo(new ConeGeometry(1.1, 3.4, 5));
    const dorsal = new Mesh(dorsalGeo, this.whaleFinMat);
    dorsal.position.set(0, 3.6, -2.5);
    dorsal.rotation.x = -0.52;

    // Broad pectoral fins (pivoted near shoulders)
    const pecGeo = this.trackGeo(new PlaneGeometry(10.5, 4.4));
    pecGeo.translate(-5.2, 0, -0.8);
    const leftFin = new Mesh(pecGeo, this.whaleFinMat);
    leftFin.position.set(-3.4, -0.6, 3.2);
    leftFin.rotation.set(Math.PI * 0.5, 0, 0.15);

    const rightPecGeo = this.trackGeo(new PlaneGeometry(10.5, 4.4));
    rightPecGeo.translate(5.2, 0, -0.8);
    const rightFin = new Mesh(rightPecGeo, this.whaleFinMat);
    rightFin.position.set(3.4, -0.6, 3.2);
    rightFin.rotation.set(Math.PI * 0.5, 0, -0.15);

    // Articulated tail peduncle & horizontal fluke
    const tail = new Group();
    tail.position.set(0, 0, -9.8);
    const peduncleGeo = this.trackGeo(new ConeGeometry(2.4, 8.8, 10));
    peduncleGeo.rotateX(-Math.PI * 0.5);
    const peduncle = new Mesh(peduncleGeo, this.whaleBodyMat);
    peduncle.position.set(0, 0, -3.4);

    const flukeGeo = this.trackGeo(new PlaneGeometry(11.2, 4.2));
    const fluke = new Mesh(flukeGeo, this.whaleFinMat);
    fluke.position.set(0, 0, -7.8);
    fluke.rotation.x = Math.PI * 0.5;
    tail.add(peduncle, fluke);

    // 4 trailing translucent stardust rings behind the whale
    const ringGeo = this.trackGeo(new TorusGeometry(3.2, 0.18, 6, 20));
    for (let i = 0; i < WHALE_RING_COUNT; i++) {
      const ring = new Mesh(ringGeo, this.whaleRingMat);
      ring.position.set(0, 0, -14 - i * 6.5);
      this.whaleRoot.add(ring);
      this.whaleRings.push(ring);
    }

    this.whaleRoot.add(torso, brow, dorsal, leftFin, rightFin, tail);
    return { leftFin, rightFin, tail };
  }

  private evalDragonCurve(t: number, out: Vector3): void {
    const x = 152 * Math.sin(t);
    const z = 104 * Math.sin(2 * t) - 28;
    const y = 58 + 11 * Math.sin(3 * t + 0.6);
    out.set(x, y, z);
  }

  private updateSkyDragon(elapsed: number): void {
    const headT = elapsed * 0.085 + 0.55;
    const lookAhead = 0.015;

    // Position & orient dragon head along figure-8 tangent
    this.evalDragonCurve(headT, this.scratchPos);
    this.evalDragonCurve(headT + lookAhead, this.scratchNextPos);
    this.dragonHeadGroup.position.copy(this.scratchPos);
    this.scratchLookMat.lookAt(this.scratchNextPos, this.scratchPos, UP_AXIS);
    this.dragonHeadGroup.quaternion.setFromRotationMatrix(this.scratchLookMat);

    // Articulated trailing segments (~38u total body span)
    const segTimeStep = 0.0145;
    for (let i = 0; i < this.dragonSegments.length; i++) {
      const entry = this.dragonSegments[i]!;
      const segT = headT - (i + 1) * segTimeStep;
      this.evalDragonCurve(segT, this.scratchPos);
      this.evalDragonCurve(segT + lookAhead, this.scratchNextPos);

      // Gentle serpentine lateral & vertical undulation
      const wave = Math.sin(elapsed * 4.2 - i * 0.58) * (0.45 + i * 0.08);
      this.scratchPos.y += wave;

      entry.group.position.copy(this.scratchPos);
      this.scratchLookMat.lookAt(this.scratchNextPos, this.scratchPos, UP_AXIS);
      entry.group.quaternion.setFromRotationMatrix(this.scratchLookMat);

      if (entry.leftFin && entry.rightFin) {
        const flutter = Math.sin(elapsed * 3.8 - i * 0.65) * 0.34;
        entry.leftFin.rotation.z = 0.25 + flutter;
        entry.rightFin.rotation.z = -0.25 - flutter;
      }
    }
  }

  private evalWhaleCurve(t: number, out: Vector3): void {
    const x = 186 * Math.cos(t);
    const z = 142 * Math.sin(t) - 35;
    const y = 62 + 9.5 * Math.sin(t * 2.0 + 1.1);
    out.set(x, y, z);
  }

  private updateSkyWhale(elapsed: number): void {
    const t = elapsed * 0.052 + 2.35;
    this.evalWhaleCurve(t, this.scratchPos);
    this.evalWhaleCurve(t + 0.018, this.scratchNextPos);

    this.whaleRoot.position.copy(this.scratchPos);
    this.scratchLookMat.lookAt(this.scratchNextPos, this.scratchPos, UP_AXIS);
    this.whaleRoot.quaternion.setFromRotationMatrix(this.scratchLookMat);

    // Slow graceful pectoral flap & tail fluke undulation
    const flap = Math.sin(elapsed * 1.45);
    this.whaleLeftFin.rotation.z = 0.12 + flap * 0.36;
    this.whaleRightFin.rotation.z = -0.12 - flap * 0.36;
    this.whaleTail.rotation.x = Math.sin(elapsed * 1.45 - 1.1) * 0.28;

    // Pulsing stardust wake rings
    for (let i = 0; i < this.whaleRings.length; i++) {
      const ring = this.whaleRings[i]!;
      const cycle = (elapsed * 0.45 + i / WHALE_RING_COUNT) % 1;
      const s = 0.65 + cycle * 1.65;
      ring.position.z = -12 - cycle * 26;
      ring.scale.set(s, s, 1);
      ring.rotation.z = elapsed * 0.6 + i;
    }
  }

  private updateSpiritBirds(elapsed: number): void {
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i]!;
      const a = b.phase + elapsed * b.angularSpeed * b.direction;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);

      const x = b.centerX + cosA * b.radiusX;
      const z = b.centerZ + sinA * b.radiusZ;
      const y = b.baseY + Math.sin(elapsed * b.bobSpeed + b.phase) * b.bobAmp;

      // Tangent velocity for heading yaw
      const vx = -sinA * b.radiusX * b.direction;
      const vz = cosA * b.radiusZ * b.direction;
      const yaw = Math.atan2(vx, vz);
      const bank = 0.28 * b.direction + Math.sin(elapsed * 4.5 + b.phase) * 0.14;
      const pitch = -Math.cos(elapsed * b.bobSpeed + b.phase) * 0.12;

      this.scratchPos.set(x, y, z);
      this.scratchEuler.set(pitch, yaw, bank);
      this.scratchQuat.setFromEuler(this.scratchEuler);
      this.scratchDir.set(
        b.scale,
        b.scale * (0.82 + 0.32 * Math.sin(elapsed * 7.5 + b.phase)),
        b.scale,
      );
      this.scratchMat.compose(this.scratchPos, this.scratchQuat, this.scratchDir);
      this.birdMesh.setMatrixAt(i, this.scratchMat);
    }
    this.birdMesh.instanceMatrix.needsUpdate = true;
  }

  private updateComets(elapsed: number): void {
    for (let i = 0; i < this.comets.length; i++) {
      const c = this.comets[i]!;
      const localT = (elapsed + c.phaseOffset) % c.period;
      if (localT > c.activeDuration) {
        c.group.visible = false;
        continue;
      }

      const p = localT / c.activeDuration;
      const travel = p * c.travelDist;
      this.scratchPos.set(
        c.startX + c.dirX * travel,
        c.startY + c.dirY * travel,
        c.startZ + c.dirZ * travel,
      );
      this.scratchNextPos.set(
        this.scratchPos.x + c.dirX * 10,
        this.scratchPos.y + c.dirY * 10,
        this.scratchPos.z + c.dirZ * 10,
      );

      c.group.visible = true;
      c.group.position.copy(this.scratchPos);
      this.scratchLookMat.lookAt(this.scratchNextPos, this.scratchPos, UP_AXIS);
      c.group.quaternion.setFromRotationMatrix(this.scratchLookMat);

      const envelope = Math.sin(p * Math.PI);
      const s = 0.55 + envelope * 0.85;
      c.group.scale.set(s, s, 0.5 + envelope * 1.1);
      c.headMat.opacity = 0.95 * envelope;
      c.tailMat.opacity = 0.6 * envelope;
    }
  }
}
