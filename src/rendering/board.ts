import {
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { DEFAULT_LANDMARKS, getRegionAt } from '../core/adventure';
import { DEFAULT_SHELTERS } from '../core/shelter';
import type { AdventureRegionId, VisualTheme } from '../core/types';
import { THEMES, type ThemePalette } from './palette';
import { createTerrainTextureSet, type TerrainTextureSet } from './terrainTextures';

interface DisposableObj {
  geometry: { dispose(): void };
  material: { dispose(): void } | { dispose(): void }[];
}

interface BiomeSpec {
  readonly baseHex: number;
  readonly altHex: number;
  readonly detailHex: number;
}

interface BasinPatch {
  readonly x: number;
  readonly z: number;
  readonly rx: number;
  readonly rz: number;
  readonly rot: number;
}

const BIOME_ORDER: readonly AdventureRegionId[] = [
  'royal_citadel',
  'mushroom_woods',
  'blossom_valley',
  'crystal_sanctum',
  'mermaid_lagoon',
  'candy_highlands',
  'starlight_peaks',
];

const ICE_POND_PATCHES: readonly BasinPatch[] = [
  { x: 122, z: -16, rx: 24, rz: 16, rot: 0.32 },
  { x: 198, z: 12, rx: 28, rz: 19, rot: -0.24 },
  { x: -126, z: -12, rx: 20, rz: 14, rot: -0.35 },
  { x: -194, z: 8, rx: 22, rz: 15, rot: 0.28 },
  { x: 24, z: 158, rx: 22, rz: 16, rot: 0.18 },
];

const SAKURA_DRIFT_PATCHES: readonly BasinPatch[] = [
  { x: -118, z: -128, rx: 32, rz: 24, rot: 0.4 },
  { x: -178, z: -86, rx: 34, rz: 26, rot: -0.28 },
  { x: -158, z: -172, rx: 30, rz: 22, rot: 0.18 },
];

const WOODLAND_MOSS_PATCHES: readonly BasinPatch[] = [
  { x: -28, z: -134, rx: 34, rz: 28, rot: -0.22 },
  { x: 34, z: -142, rx: 32, rz: 26, rot: 0.34 },
];

function createSeededRng(seed: number): { random: () => number } {
  let state = seed >>> 0;
  return {
    random: (): number => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function getBiomePalette(theme: VisualTheme): Readonly<Record<AdventureRegionId, BiomeSpec>> {
  switch (theme) {
    case 'crystal_garden':
      return {
        royal_citadel: { baseHex: 0x5c8b6e, altHex: 0x8e867a, detailHex: 0x74a37f },
        mushroom_woods: { baseHex: 0x1e5c4e, altHex: 0x354745, detailHex: 0x3b8568 },
        blossom_valley: { baseHex: 0x548573, altHex: 0xc27aa8, detailHex: 0x878d9c },
        crystal_sanctum: { baseHex: 0x8cb8e0, altHex: 0x536b8c, detailHex: 0xbadbff },
        mermaid_lagoon: { baseHex: 0x9b8c74, altHex: 0x1d889c, detailHex: 0x3eb8c9 },
        candy_highlands: { baseHex: 0x8c7b5c, altHex: 0xa67378, detailHex: 0x788e64 },
        starlight_peaks: { baseHex: 0x3a486e, altHex: 0x626b94, detailHex: 0x8fa8d6 },
      };
    case 'starlight_galaxy':
      return {
        royal_citadel: { baseHex: 0x4d7368, altHex: 0x747c8f, detailHex: 0x628c7d },
        mushroom_woods: { baseHex: 0x1a4b49, altHex: 0x2e3d47, detailHex: 0x2f6d63 },
        blossom_valley: { baseHex: 0x477075, altHex: 0xa6709e, detailHex: 0x737e96 },
        crystal_sanctum: { baseHex: 0x7da9db, altHex: 0x465d82, detailHex: 0xaad0f7 },
        mermaid_lagoon: { baseHex: 0x867e72, altHex: 0x166d8c, detailHex: 0x329fb8 },
        candy_highlands: { baseHex: 0x786e5e, altHex: 0x8c6876, detailHex: 0x647d64 },
        starlight_peaks: { baseHex: 0x2f3e66, altHex: 0x52618c, detailHex: 0x82a3d9 },
      };
    case 'candy_island':
      return {
        royal_citadel: { baseHex: 0x7ac76f, altHex: 0xeddcc4, detailHex: 0x92d67c },
        mushroom_woods: { baseHex: 0x388c5c, altHex: 0x665645, detailHex: 0x75994c },
        blossom_valley: { baseHex: 0x7ed17c, altHex: 0xf7b0cf, detailHex: 0xddd4cc },
        crystal_sanctum: { baseHex: 0xd9f0ff, altHex: 0x7f94ad, detailHex: 0xa8dcfa },
        mermaid_lagoon: { baseHex: 0xedd29a, altHex: 0x2cc4cf, detailHex: 0x52dce0 },
        candy_highlands: { baseHex: 0xd9b55d, altHex: 0xeb9f81, detailHex: 0xaec96b },
        starlight_peaks: { baseHex: 0x5b6c8c, altHex: 0x8d95b8, detailHex: 0xc2d1f0 },
      };
    case 'honeycomb_arena':
    default:
      return {
        royal_citadel: { baseHex: 0x68b54f, altHex: 0xe3d4b4, detailHex: 0x82c95f },
        mushroom_woods: { baseHex: 0x276b43, altHex: 0x4f3e2c, detailHex: 0x677d38 },
        blossom_valley: { baseHex: 0x6cc464, altHex: 0xf2a7c2, detailHex: 0xd1cabf },
        crystal_sanctum: { baseHex: 0xd8eeff, altHex: 0x6b7f96, detailHex: 0x9bd4f7 },
        mermaid_lagoon: { baseHex: 0xe6c88a, altHex: 0x23bcc7, detailHex: 0x4ad9de },
        candy_highlands: { baseHex: 0xcfa84c, altHex: 0xde986f, detailHex: 0x9fb852 },
        starlight_peaks: { baseHex: 0x4b5d7a, altHex: 0x7d85a6, detailHex: 0xb5c8eb },
      };
  }
}

/**
 * The open-world arena floor with multi-climate procedural terrain, border crystal
 * barriers (or rainbow portal curtains in Cozy `wrapWalls` mode), and corner/edge
 * beacon pillars.
 */
export class Board {
  readonly group = new Group();

  private floor?: Mesh<PlaneGeometry, MeshStandardMaterial>;
  private terrainTextures?: TerrainTextureSet;
  private sunburstMosaic?: Mesh<PlaneGeometry, MeshStandardMaterial>;
  private sunburstTexture?: CanvasTexture;
  private lagoonMesh?: Mesh<BufferGeometry, MeshStandardMaterial>;
  private lagoonFoamMesh?: Mesh<BufferGeometry, MeshStandardMaterial>;
  private featureMeshes: Mesh[] = [];
  private grid?: GridHelper;
  private frame?: LineSegments<EdgesGeometry, LineBasicMaterial>;
  private previewFrame?: LineSegments<EdgesGeometry, LineBasicMaterial>;

  private wallMeshes: Mesh[] = [];
  private portalTexture?: CanvasTexture;
  private portalMaterials: MeshBasicMaterial[] = [];
  private railMaterials: MeshStandardMaterial[] = [];

  private currentSize = -1;
  private currentWrapWalls = false;
  private currentTheme: VisualTheme = 'honeycomb_arena';
  private previewSize = -1;
  private gameOver = false;

  private readonly colorA = new Color();
  private readonly colorB = new Color();

  private readonly warpNoiseA = new SimplexNoise(createSeededRng(104729));
  private readonly warpNoiseB = new SimplexNoise(createSeededRng(224737));
  private readonly detailNoise = new SimplexNoise(createSeededRng(350377));
  private readonly heightNoise = new SimplexNoise(createSeededRng(479909));

  /** Rebuild arena geometry & theme visuals at `size`×`size` (`2 * worldRadius`). */
  rebuild(size: number, wrapWalls: boolean, theme: VisualTheme): void {
    this.currentSize = size;
    this.currentWrapWalls = wrapWalls;
    this.currentTheme = theme;
    this.disposeMeshes();

    const palette = THEMES[theme];
    const isHoneycomb = theme === 'honeycomb_arena';
    const isDark = theme === 'crystal_garden' || theme === 'starlight_galaxy';
    const floorSpan = isHoneycomb ? Math.max(size + 6, 118) : size + 4;

    this.terrainTextures = createTerrainTextureSet(theme);
    const repeats = Math.max(6, Math.round(floorSpan / 22));
    this.terrainTextures.albedoMap.repeat.set(repeats, repeats);
    this.terrainTextures.bumpMap.repeat.set(repeats, repeats);
    this.terrainTextures.roughnessMap.repeat.set(repeats, repeats);

    const floorTintHex =
      theme === 'honeycomb_arena'
        ? 0xffffff
        : theme === 'candy_island'
          ? 0xffeef6
          : theme === 'crystal_garden'
            ? 0xdfd4ff
            : 0xc2d4ff;

    this.floor = new Mesh(
      this.createRegionalFloorGeometry(floorSpan, theme),
      new MeshStandardMaterial({
        color: floorTintHex,
        map: this.terrainTextures.albedoMap,
        bumpMap: this.terrainTextures.bumpMap,
        bumpScale: 0.14,
        roughnessMap: this.terrainTextures.roughnessMap,
        roughness: 1.0,
        metalness: isDark ? 0.08 : 0.03,
        vertexColors: true,
      }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.5;
    this.group.add(this.floor);

    this.buildRegionalFeatureLayers(size, theme);

    this.sunburstTexture = this.createRoyalSunburstMosaicTexture(theme);
    const mosaicSpan = Math.min(58, Math.max(24, size * 0.45));
    this.sunburstMosaic = new Mesh(
      new PlaneGeometry(mosaicSpan, mosaicSpan),
      new MeshStandardMaterial({
        map: this.sunburstTexture,
        transparent: true,
        opacity: isDark ? 0.88 : 0.92,
        roughness: 0.46,
        metalness: 0.22,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        depthWrite: false,
      }),
    );
    this.sunburstMosaic.rotation.x = -Math.PI / 2;
    this.sunburstMosaic.position.y = -0.489;
    this.group.add(this.sunburstMosaic);

    if (palette.gridOpacity > 0) {
      const divisions = Math.max(12, Math.min(Math.round(size / 2), 280));
      this.grid = new GridHelper(size, divisions, palette.gridCenter, palette.gridLine);
      const gridMat = this.grid.material as LineBasicMaterial;
      gridMat.transparent = true;
      gridMat.opacity = palette.gridOpacity * 0.45;
      gridMat.depthWrite = false;
      this.grid.position.y = -0.489;
      this.group.add(this.grid);
    }

    if (wrapWalls) {
      this.buildCozyRainbowPortals(size, palette);
    } else {
      this.buildSolidCrystalWalls(size, palette);
    }

    this.frame = new LineSegments(
      new EdgesGeometry(new BoxGeometry(size, wrapWalls ? 0.85 : 0.92, size)),
      new LineBasicMaterial({
        color: palette.framePrimary,
        transparent: true,
        opacity: wrapWalls ? 0.55 : 0.82,
      }),
    );
    this.frame.position.y = wrapWalls ? -0.08 : -0.04;
    this.group.add(this.frame);
  }

  /** Switch visual theme and rebuild the board cleanly if already sized. */
  setTheme(theme: VisualTheme): void {
    if (theme === this.currentTheme && this.currentSize > 0) return;
    this.currentTheme = theme;
    if (this.currentSize > 0) {
      const prevPreview = this.previewSize;
      this.rebuild(this.currentSize, this.currentWrapWalls, theme);
      if (prevPreview > 0) this.showShrinkPreview(prevPreview);
      if (this.gameOver) this.setGameOver(true);
    }
  }

  /** Set whether the arena shows the game-over tint. */
  setGameOver(isGameOver: boolean): void {
    this.gameOver = isGameOver;
    if (isGameOver) {
      const palette = THEMES[this.currentTheme];
      this.frame?.material.color.setHex(palette.frameGameOver);
      for (const mat of this.railMaterials) {
        mat.color.setHex(palette.frameGameOver);
        mat.emissive.setHex(palette.frameGameOver);
      }
    }
  }

  /** Slowly pulse frame rails, flow lagoon caustics, or flow rainbow portal curtains at 60fps. */
  animate(elapsed: number): void {
    const palette = THEMES[this.currentTheme];

    if (this.terrainTextures && this.lagoonMesh) {
      this.terrainTextures.lagoonWaterMap.offset.set((elapsed * 0.026) % 1, (elapsed * 0.017) % 1);
      this.lagoonMesh.material.opacity = 0.76 + 0.05 * Math.sin(elapsed * 1.5);
    }

    if (this.terrainTextures && this.lagoonFoamMesh) {
      this.terrainTextures.lagoonFoamMap.offset.set((-elapsed * 0.014) % 1, (elapsed * 0.011) % 1);
      this.lagoonFoamMesh.material.opacity = 0.54 + 0.14 * Math.sin(elapsed * 1.9 + 0.8);
    }

    if (!this.gameOver && this.frame) {
      if (this.currentWrapWalls) {
        this.frame.material.color.setHSL((elapsed * 0.12) % 1, 0.85, 0.74);
      } else {
        const blend = 0.5 + 0.5 * Math.sin(elapsed * 1.4);
        this.colorA.setHex(palette.framePrimary);
        this.colorB.setHex(palette.frameSecondary);
        this.frame.material.color.copy(this.colorA).lerp(this.colorB, blend);
      }
    }

    if (this.portalTexture) {
      this.portalTexture.offset.x = (elapsed * 0.16) % 1;
      const shimmer = 0.5 + 0.16 * Math.sin(elapsed * 2.8);
      for (const mat of this.portalMaterials) {
        mat.opacity = shimmer;
      }
    }

    if (!this.gameOver && this.railMaterials.length > 0) {
      const blend = 0.5 + 0.5 * Math.sin(elapsed * 1.4);
      this.colorA.setHex(palette.framePrimary);
      this.colorB.setHex(palette.frameSecondary);
      this.colorA.lerp(this.colorB, blend);
      const baseIntensity = this.currentTheme === 'honeycomb_arena' ? 0.35 : 0.55;
      for (const mat of this.railMaterials) {
        mat.emissive.copy(this.colorA);
        mat.emissiveIntensity = baseIntensity + 0.15 * Math.sin(elapsed * 2.5);
      }
    }

    if (this.previewFrame) {
      this.previewFrame.material.opacity = 0.25 + 0.65 * (0.5 + 0.5 * Math.sin(elapsed * 8));
    }
  }

  /** Show a pulsing preview of the walls at their future (smaller) size. */
  showShrinkPreview(size: number): void {
    if (this.previewFrame && this.previewSize === size) return;
    this.hideShrinkPreview();
    this.previewFrame = new LineSegments(
      new EdgesGeometry(new BoxGeometry(size, 0.9, size)),
      new LineBasicMaterial({ color: 0xff85c8, transparent: true, opacity: 0 }),
    );
    this.previewFrame.position.y = -0.05;
    this.previewSize = size;
    this.group.add(this.previewFrame);
  }

  /** Remove the shrink-warning preview, if any. */
  hideShrinkPreview(): void {
    if (!this.previewFrame) return;
    this.group.remove(this.previewFrame);
    this.previewFrame.geometry.dispose();
    this.previewFrame.material.dispose();
    this.previewFrame = undefined;
    this.previewSize = -1;
  }

  dispose(): void {
    this.disposeMeshes();
  }

  private buildSolidCrystalWalls(size: number, palette: ThemePalette): void {
    const half = size / 2;
    const thickness = 0.42;
    const height = 0.68;
    const isWarm = palette.id === 'honeycomb_arena';

    const railMat = new MeshStandardMaterial({
      color: palette.framePrimary,
      emissive: palette.framePrimary,
      emissiveIntensity: isWarm ? 0.35 : 0.6,
      metalness: 0.22,
      roughness: 0.3,
      transparent: true,
      opacity: 0.88,
    });
    this.railMaterials.push(railMat);

    const railSpecs: readonly { w: number; d: number; x: number; z: number }[] = [
      { w: size + thickness * 2, d: thickness, x: 0, z: -half - thickness / 2 },
      { w: size + thickness * 2, d: thickness, x: 0, z: half + thickness / 2 },
      { w: thickness, d: size + thickness * 2, x: -half - thickness / 2, z: 0 },
      { w: thickness, d: size + thickness * 2, x: half + thickness / 2, z: 0 },
    ];

    for (const spec of railSpecs) {
      const rail = new Mesh(new BoxGeometry(spec.w, height, spec.d), railMat);
      rail.position.set(spec.x, -0.5 + height / 2, spec.z);
      this.group.add(rail);
      this.wallMeshes.push(rail);
    }

    const pillarMat = new MeshStandardMaterial({
      color: palette.pillarColor,
      emissive: palette.frameSecondary,
      emissiveIntensity: isWarm ? 0.38 : 0.65,
      metalness: 0.3,
      roughness: 0.22,
    });
    this.railMaterials.push(pillarMat);

    const pillarGeo = new OctahedronGeometry(0.55, 0);
    const offset = half + thickness / 2;
    const steps = Math.min(28, Math.max(6, Math.round(size / 20)));
    for (let i = 0; i <= steps; i++) {
      const t = -offset + (i / steps) * (offset * 2);
      const isCorner = i === 0 || i === steps;
      const scale = isCorner ? 1.35 : 0.85;
      const positions: readonly [number, number][] = isCorner
        ? [
            [t, -offset],
            [t, offset],
          ]
        : [
            [t, -offset],
            [t, offset],
            [-offset, t],
            [offset, t],
          ];
      for (const [px, pz] of positions) {
        const gem = new Mesh(pillarGeo, pillarMat);
        gem.scale.set(0.9 * scale, 1.5 * scale, 0.9 * scale);
        gem.position.set(px, 0.18, pz);
        this.group.add(gem);
        this.wallMeshes.push(gem);
      }
    }
  }

  private buildCozyRainbowPortals(size: number, palette: ThemePalette): void {
    const half = size / 2;
    const repeats = Math.max(1, Math.round(size / 14));
    this.portalTexture = this.createRainbowPortalTexture(repeats);
    const portalMat = new MeshBasicMaterial({
      map: this.portalTexture,
      transparent: true,
      opacity: 0.56,
      side: DoubleSide,
      depthWrite: false,
    });
    this.portalMaterials.push(portalMat);

    const curtainGeo = new PlaneGeometry(size, 0.88);
    const walls: readonly { x: number; z: number; ry: number }[] = [
      { x: 0, z: -half, ry: 0 },
      { x: 0, z: half, ry: Math.PI },
      { x: -half, z: 0, ry: Math.PI / 2 },
      { x: half, z: 0, ry: -Math.PI / 2 },
    ];
    for (const w of walls) {
      const curtain = new Mesh(curtainGeo, portalMat);
      curtain.position.set(w.x, -0.06, w.z);
      curtain.rotation.y = w.ry;
      this.group.add(curtain);
      this.wallMeshes.push(curtain);
    }

    const starMat = new MeshStandardMaterial({
      color: 0xffffff,
      emissive: palette.framePrimary,
      emissiveIntensity: 0.72,
      metalness: 0.15,
      roughness: 0.2,
    });
    this.railMaterials.push(starMat);
    const starGeo = new OctahedronGeometry(0.42, 0);
    const steps = Math.min(28, Math.max(6, Math.round(size / 20)));
    for (let i = 0; i <= steps; i++) {
      const t = -half + (i / steps) * size;
      const isCorner = i === 0 || i === steps;
      const coords: readonly [number, number][] = isCorner
        ? [
            [t, -half],
            [t, half],
          ]
        : [
            [t, -half],
            [t, half],
            [-half, t],
            [half, t],
          ];
      for (const [cx, cz] of coords) {
        const star = new Mesh(starGeo, starMat);
        star.position.set(cx, 0.12, cz);
        this.group.add(star);
        this.wallMeshes.push(star);
      }
    }
  }

  /**
   * Organic lagoon cove mask (`0..1`) in `mermaid_lagoon` (`x < -60, z > 10`),
   * leaving shelter and landmark plinths clear.
   */
  private evaluateLagoonMask(wx: number, wz: number): number {
    if (wx > -58 || wz < 8) return 0;
    const dx = (wx + 162) / 86;
    const dz = (wz - 128) / 84;
    const warp = this.warpNoiseA.noise(wx * 0.018, wz * 0.018) * 0.22;
    const dist = Math.hypot(dx, dz) + warp;
    let mask = 1 - smoothstep(0.62, 1.0, dist);
    if (mask <= 0.001) return 0;

    // Fade smoothly around shoreline boundary x > -68 / z < 16
    mask *= smoothstep(-60, -76, wx) * smoothstep(10, 26, wz);

    // Clear shelter-mermaid-sw (-180, 120) inner platform & crystal-falls (-88, 68)
    const dShelter = Math.hypot(wx + 180, wz - 120);
    const dFalls = Math.hypot(wx + 88, wz - 68);
    mask *= smoothstep(14.5, 21.0, dShelter);
    mask *= smoothstep(13.5, 19.0, dFalls);
    return clamp01(mask);
  }

  /** Organic mask (`0..1`) for any elliptical rotated basin patch. */
  private evaluateBasinMask(wx: number, wz: number, patch: BasinPatch): number {
    const dx = wx - patch.x;
    const dz = wz - patch.z;
    const c = Math.cos(patch.rot);
    const s = Math.sin(patch.rot);
    const lx = (dx * c - dz * s) / patch.rx;
    const lz = (dx * s + dz * c) / patch.rz;
    const warp = this.warpNoiseB.noise(wx * 0.042, wz * 0.042) * 0.24;
    const dist = Math.hypot(lx, lz) + warp;
    return clamp01(1 - smoothstep(0.64, 1.0, dist));
  }

  private evaluateIcePondMask(wx: number, wz: number): number {
    let best = 0;
    for (let i = 0; i < ICE_POND_PATCHES.length; i++) {
      const m = this.evaluateBasinMask(wx, wz, ICE_POND_PATCHES[i]!);
      if (m > best) best = m;
    }
    return best;
  }

  /**
   * Snake-safe micro-topography (`±0.075u`) smoothly flattened to `0` at `(0,0)`,
   * shelters, landmarks, and cardinal avenues, plus gentle recessed basins under
   * flat lagoon water / glacier ice ponds so overlays never clip.
   */
  private evaluateTerrainHeight(wx: number, wz: number): number {
    const r = Math.hypot(wx, wz);
    let flatFactor = smoothstep(24, 35, r);

    for (let i = 0; i < DEFAULT_SHELTERS.length; i++) {
      const s = DEFAULT_SHELTERS[i]!;
      const d = Math.hypot(wx - s.x, wz - s.z);
      flatFactor = Math.min(flatFactor, smoothstep(s.radius + 3, s.radius + 11, d));
    }

    for (let i = 0; i < DEFAULT_LANDMARKS.length; i++) {
      const lm = DEFAULT_LANDMARKS[i]!;
      const d = Math.hypot(wx - lm.x, wz - lm.z);
      flatFactor = Math.min(flatFactor, smoothstep(lm.radius + 3, lm.radius + 11, d));
    }

    const cardinalDist = Math.min(Math.abs(wx), Math.abs(wz));
    flatFactor = Math.min(flatFactor, smoothstep(5.5, 13.0, cardinalDist));

    const lagoonMask = this.evaluateLagoonMask(wx, wz);
    const iceMask = this.evaluateIcePondMask(wx, wz);
    const basinMask = Math.max(lagoonMask, iceMask);
    flatFactor *= 1 - smoothstep(0.05, 0.45, basinMask);

    const raw =
      this.heightNoise.noise(wx * 0.024, wz * 0.024) * 0.055 +
      this.heightNoise.noise(wx * 0.065 + 17.1, wz * 0.065 - 9.4) * 0.02;

    return raw * flatFactor - basinMask * 0.024;
  }

  /**
   * 144×144 subdivided floor plane with domain-warped `SimplexNoise` aligned with
   * `getRegionAt(pos)`, rich sub-biome detail, and snake-safe micro-topography.
   */
  private createRegionalFloorGeometry(floorSpan: number, theme: VisualTheme): PlaneGeometry {
    const geo = new PlaneGeometry(floorSpan, floorSpan, 144, 144);
    const posAttr = geo.attributes['position'];
    if (!posAttr) return geo;

    const biomePalette = getBiomePalette(theme);
    const count = posAttr.count;
    const colors = new Float32Array(count * 3);

    const regionBaseColors: Record<AdventureRegionId, Color> = {
      royal_citadel: new Color(biomePalette.royal_citadel.baseHex),
      mushroom_woods: new Color(biomePalette.mushroom_woods.baseHex),
      blossom_valley: new Color(biomePalette.blossom_valley.baseHex),
      crystal_sanctum: new Color(biomePalette.crystal_sanctum.baseHex),
      mermaid_lagoon: new Color(biomePalette.mermaid_lagoon.baseHex),
      candy_highlands: new Color(biomePalette.candy_highlands.baseHex),
      starlight_peaks: new Color(biomePalette.starlight_peaks.baseHex),
    };
    const regionAltColors: Record<AdventureRegionId, Color> = {
      royal_citadel: new Color(biomePalette.royal_citadel.altHex),
      mushroom_woods: new Color(biomePalette.mushroom_woods.altHex),
      blossom_valley: new Color(biomePalette.blossom_valley.altHex),
      crystal_sanctum: new Color(biomePalette.crystal_sanctum.altHex),
      mermaid_lagoon: new Color(biomePalette.mermaid_lagoon.altHex),
      candy_highlands: new Color(biomePalette.candy_highlands.altHex),
      starlight_peaks: new Color(biomePalette.starlight_peaks.altHex),
    };
    const regionDetailColors: Record<AdventureRegionId, Color> = {
      royal_citadel: new Color(biomePalette.royal_citadel.detailHex),
      mushroom_woods: new Color(biomePalette.mushroom_woods.detailHex),
      blossom_valley: new Color(biomePalette.blossom_valley.detailHex),
      crystal_sanctum: new Color(biomePalette.crystal_sanctum.detailHex),
      mermaid_lagoon: new Color(biomePalette.mermaid_lagoon.detailHex),
      candy_highlands: new Color(biomePalette.candy_highlands.detailHex),
      starlight_peaks: new Color(biomePalette.starlight_peaks.detailHex),
    };

    const kernel: readonly { ox: number; oz: number; w: number }[] = [
      { ox: 0, oz: 0, w: 2.0 },
      { ox: 15, oz: 0, w: 1.0 },
      { ox: -15, oz: 0, w: 1.0 },
      { ox: 0, oz: 15, w: 1.0 },
      { ox: 0, oz: -15, w: 1.0 },
      { ox: 11, oz: 11, w: 0.75 },
      { ox: -11, oz: 11, w: 0.75 },
      { ox: 11, oz: -11, w: 0.75 },
      { ox: -11, oz: -11, w: 0.75 },
    ];

    const weights: Record<AdventureRegionId, number> = {
      royal_citadel: 0,
      mushroom_woods: 0,
      blossom_valley: 0,
      crystal_sanctum: 0,
      mermaid_lagoon: 0,
      candy_highlands: 0,
      starlight_peaks: 0,
    };

    const samplePos = { x: 0, z: 0 };
    const accum = new Color();
    const regionCol = new Color();

    for (let i = 0; i < count; i++) {
      // PlaneGeometry rotated by -PI/2 around X maps local (x, y, z) -> world (x, z, -y)
      const wx = posAttr.getX(i);
      const wz = -posAttr.getY(i);
      const r = Math.hypot(wx, wz);

      // Elevation displacement along local +Z (= world +Y)
      const elevation = this.evaluateTerrainHeight(wx, wz);
      posAttr.setZ(i, elevation);

      // Domain-warped geography coordinates (fade warp near origin courtyard)
      const warpFade = smoothstep(18, 48, r);
      const sx =
        wx +
        (this.warpNoiseA.noise(wx * 0.012, wz * 0.012) * 18 +
          this.warpNoiseB.noise(wx * 0.032, wz * 0.032) * 6.5) *
          warpFade;
      const sz =
        wz +
        (this.warpNoiseA.noise(wx * 0.012 + 37.3, wz * 0.012 - 19.1) * 18 +
          this.warpNoiseB.noise(wx * 0.032 - 11.7, wz * 0.032 + 23.9) * 6.5) *
          warpFade;

      for (const id of BIOME_ORDER) weights[id] = 0;
      let totalW = 0;

      for (let k = 0; k < kernel.length; k++) {
        const kp = kernel[k]!;
        samplePos.x = sx + kp.ox;
        samplePos.z = sz + kp.oz;
        const reg = getRegionAt(samplePos);
        weights[reg.id] += kp.w;
        totalW += kp.w;
      }

      const nCoarse = 0.5 + 0.5 * this.detailNoise.noise(wx * 0.022 + 5.2, wz * 0.022 - 8.4);
      const nFine = 0.5 + 0.5 * this.warpNoiseB.noise(wx * 0.068 - 14.1, wz * 0.068 + 11.7);
      const nRidge = Math.abs(this.detailNoise.noise(wx * 0.045 + 21.3, wz * 0.045 + 3.7));

      accum.setRGB(0, 0, 0);
      const invW = 1 / totalW;

      for (const id of BIOME_ORDER) {
        const w = weights[id] * invW;
        if (w <= 1e-4) continue;

        regionCol.copy(regionBaseColors[id]);
        const alt = regionAltColors[id];
        const detail = regionDetailColors[id];

        if (id === 'royal_citadel') {
          const courtyardMask = 1 - smoothstep(26, 42, r + (nCoarse - 0.5) * 6);
          regionCol.lerp(detail, smoothstep(0.35, 0.78, nFine) * 0.48);
          regionCol.lerp(alt, courtyardMask * 0.92);
        } else if (id === 'mermaid_lagoon') {
          const lagoonDeep = this.evaluateLagoonMask(wx, wz);
          regionCol.lerp(detail, smoothstep(0.08, 0.55, lagoonDeep) * 0.65);
          regionCol.lerp(alt, smoothstep(0.28, 0.85, lagoonDeep) * 0.88);
        } else if (id === 'blossom_valley') {
          const petalPatch = smoothstep(0.46, 0.78, nCoarse);
          const pathBand = 1 - smoothstep(0.0, 0.14, Math.abs(nRidge - 0.18));
          regionCol.lerp(alt, petalPatch * 0.62);
          regionCol.lerp(detail, pathBand * 0.45);
        } else if (id === 'crystal_sanctum') {
          const slateRock = smoothstep(0.56, 0.84, nCoarse);
          const iceVein = smoothstep(0.54, 0.86, nFine);
          regionCol.lerp(detail, iceVein * 0.6);
          regionCol.lerp(alt, slateRock * 0.72);
        } else if (id === 'mushroom_woods') {
          const dampSoil = smoothstep(0.52, 0.82, nCoarse);
          const leafLitter = smoothstep(0.58, 0.86, nFine);
          regionCol.lerp(alt, dampSoil * 0.62);
          regionCol.lerp(detail, leafLitter * 0.48);
        } else if (id === 'candy_highlands') {
          const ridge = smoothstep(0.54, 0.82, nCoarse);
          const clover = smoothstep(0.48, 0.84, nFine);
          regionCol.lerp(detail, clover * 0.55);
          regionCol.lerp(alt, ridge * 0.66);
        } else {
          // starlight_peaks
          const heather = smoothstep(0.42, 0.76, nCoarse);
          const quartzVein = 1 - smoothstep(0.0, 0.11, nRidge);
          regionCol.lerp(alt, heather * 0.68);
          regionCol.lerp(detail, quartzVein * 0.62);
        }

        accum.r += regionCol.r * w;
        accum.g += regionCol.g * w;
        accum.b += regionCol.b * w;
      }

      // Subtle micro-relief contrast so slopes & basins read naturally
      const reliefShade = 1 + elevation * 0.48 + (nFine - 0.5) * 0.05;
      colors[i * 3] = clamp01(accum.r * reliefShade);
      colors[i * 3 + 1] = clamp01(accum.g * reliefShade);
      colors[i * 3 + 2] = clamp01(accum.b * reliefShade);
    }

    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Non-clipping regional ground feature layers (`Y = -0.494..-0.489`) with
   * `polygonOffset: true` and `depthWrite: false` to prevent Z-fighting.
   */
  private buildRegionalFeatureLayers(size: number, theme: VisualTheme): void {
    const textures = this.terrainTextures;
    if (!textures) return;
    const half = size / 2;
    if (half < 95) return;

    const isDark = theme === 'crystal_garden' || theme === 'starlight_galaxy';

    // 0. Inlaid limestone courtyard flagstone ground around Central Royal Citadel (0, 0)
    textures.courtyardStoneMap.repeat.set(7, 7);
    const courtyardRadius = 38;
    const courtyardGeo = this.createMaskedOverlayGeometry(
      courtyardRadius * 2,
      courtyardRadius * 2,
      28,
      0,
      0,
      false,
      (wx, wz, out) => {
        const r = Math.hypot(wx, wz);
        const innerFade = smoothstep(14, 19, r);
        const outerFade = 1 - smoothstep(26, courtyardRadius, r);
        out.set(1, 1, 1, innerFade * outerFade * 0.86);
      },
    );
    const courtyardMesh = new Mesh(
      courtyardGeo,
      new MeshStandardMaterial({
        map: textures.courtyardStoneMap,
        transparent: true,
        opacity: isDark ? 0.72 : 0.88,
        roughness: 0.72,
        metalness: 0.06,
        vertexColors: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        depthWrite: false,
      }),
    );
    courtyardMesh.rotation.x = -Math.PI / 2;
    courtyardMesh.position.y = -0.494;
    this.group.add(courtyardMesh);
    this.featureMeshes.push(courtyardMesh);

    // 1. Shallow animated turquoise coastal lagoon cove around mermaid_lagoon (x < -60, z > 10)
    const minX = Math.max(-half + 3, -248);
    const maxX = -60;
    const minZ = 10;
    const maxZ = Math.min(half - 3, 245);
    if (maxX - minX > 20 && maxZ - minZ > 20) {
      const spanX = maxX - minX;
      const spanZ = maxZ - minZ;
      const cx = (minX + maxX) * 0.5;
      const cz = (minZ + maxZ) * 0.5;

      textures.lagoonWaterMap.repeat.set(6, 6);
      const waterGeo = this.createMaskedOverlayGeometry(
        spanX,
        spanZ,
        52,
        cx,
        cz,
        false,
        (wx, wz, out) => {
          const mask = this.evaluateLagoonMask(wx, wz);
          if (mask <= 0.002) {
            out.set(1, 1, 1, 0);
            return;
          }
          const shore = smoothstep(0.02, 0.24, mask);
          const deep = smoothstep(0.32, 0.9, mask);
          const r = 0.94 * (1 - shore) + (isDark ? 0.14 : 0.18) * shore * (1 - deep * 0.35);
          const g = 0.99 * (1 - shore) + (isDark ? 0.72 : 0.88) * shore * (1 - deep * 0.16);
          const b = 1.0 * (1 - shore) + (isDark ? 0.86 : 0.95) * shore;
          out.set(r, g, b, smoothstep(0.01, 0.16, mask));
        },
      );

      this.lagoonMesh = new Mesh(
        waterGeo,
        new MeshStandardMaterial({
          map: textures.lagoonWaterMap,
          transparent: true,
          opacity: 0.78,
          roughness: 0.14,
          metalness: 0.14,
          vertexColors: true,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
          depthWrite: false,
        }),
      );
      this.lagoonMesh.rotation.x = -Math.PI / 2;
      this.lagoonMesh.position.set(cx, -0.492, cz);
      this.group.add(this.lagoonMesh);
      this.featureMeshes.push(this.lagoonMesh);

      textures.lagoonFoamMap.repeat.set(5, 5);
      const foamGeo = this.createMaskedOverlayGeometry(
        spanX,
        spanZ,
        44,
        cx,
        cz,
        false,
        (wx, wz, out) => {
          const mask = this.evaluateLagoonMask(wx, wz);
          const shoreBand = smoothstep(0.01, 0.12, mask) * (1 - smoothstep(0.14, 0.42, mask));
          out.set(0.95, 0.99, 1.0, shoreBand * 0.9);
        },
      );

      this.lagoonFoamMesh = new Mesh(
        foamGeo,
        new MeshStandardMaterial({
          map: textures.lagoonFoamMap,
          transparent: true,
          opacity: 0.58,
          roughness: 0.42,
          metalness: 0.04,
          vertexColors: true,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          depthWrite: false,
        }),
      );
      this.lagoonFoamMesh.rotation.x = -Math.PI / 2;
      this.lagoonFoamMesh.position.set(cx, -0.491, cz);
      this.group.add(this.lagoonFoamMesh);
      this.featureMeshes.push(this.lagoonFoamMesh);
    }

    // 2. Specular frozen glacier ice-pond sheets in crystal_sanctum (East/West/South sectors)
    textures.iceSheetMap.repeat.set(2.5, 2.5);
    const iceMat = new MeshStandardMaterial({
      map: textures.iceSheetMap,
      transparent: true,
      opacity: isDark ? 0.8 : 0.86,
      roughness: 0.12,
      metalness: 0.24,
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      depthWrite: false,
    });
    for (const patch of ICE_POND_PATCHES) {
      if (Math.abs(patch.x) + patch.rx > half - 4 || Math.abs(patch.z) + patch.rz > half - 4) {
        continue;
      }
      const span = Math.max(patch.rx, patch.rz) * 2.4;
      const iceGeo = this.createMaskedOverlayGeometry(
        span,
        span,
        24,
        patch.x,
        patch.z,
        false,
        (wx, wz, out) => {
          const m = this.evaluateBasinMask(wx, wz, patch);
          const tint = isDark ? 0.78 : 0.95;
          out.set(tint * 0.88, tint * 0.96, tint, smoothstep(0.02, 0.28, m));
        },
      );
      const iceMesh = new Mesh(iceGeo, iceMat);
      iceMesh.rotation.x = -Math.PI / 2;
      iceMesh.position.set(patch.x, -0.491, patch.z);
      this.group.add(iceMesh);
      this.featureMeshes.push(iceMesh);
    }

    // 3. Soft fallen sakura petal drifts across blossom_valley (contoured to terrainHeight)
    textures.sakuraPetalMap.repeat.set(3, 3);
    const sakuraMat = new MeshStandardMaterial({
      map: textures.sakuraPetalMap,
      transparent: true,
      opacity: isDark ? 0.78 : 0.92,
      roughness: 0.82,
      metalness: 0.02,
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      depthWrite: false,
    });
    for (const patch of SAKURA_DRIFT_PATCHES) {
      if (Math.abs(patch.x) + patch.rx > half - 4 || Math.abs(patch.z) + patch.rz > half - 4) {
        continue;
      }
      const span = Math.max(patch.rx, patch.rz) * 2.4;
      const petalGeo = this.createMaskedOverlayGeometry(
        span,
        span,
        24,
        patch.x,
        patch.z,
        true,
        (wx, wz, out) => {
          const m = this.evaluateBasinMask(wx, wz, patch);
          const tint = isDark ? 0.85 : 1.0;
          out.set(tint, tint * 0.92, tint * 0.96, smoothstep(0.04, 0.36, m));
        },
      );
      const petalMesh = new Mesh(petalGeo, sakuraMat);
      petalMesh.rotation.x = -Math.PI / 2;
      petalMesh.position.set(patch.x, -0.49, patch.z);
      this.group.add(petalMesh);
      this.featureMeshes.push(petalMesh);
    }

    // 4. Mossy woodland glade overlay in mushroom_woods (contoured to terrainHeight)
    textures.woodlandMossMap.repeat.set(3, 3);
    const mossMat = new MeshStandardMaterial({
      map: textures.woodlandMossMap,
      transparent: true,
      opacity: isDark ? 0.64 : 0.76,
      roughness: 0.9,
      metalness: 0.02,
      vertexColors: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      depthWrite: false,
    });
    for (const patch of WOODLAND_MOSS_PATCHES) {
      if (Math.abs(patch.x) + patch.rx > half - 4 || Math.abs(patch.z) + patch.rz > half - 4) {
        continue;
      }
      const span = Math.max(patch.rx, patch.rz) * 2.4;
      const mossGeo = this.createMaskedOverlayGeometry(
        span,
        span,
        22,
        patch.x,
        patch.z,
        true,
        (wx, wz, out) => {
          const m = this.evaluateBasinMask(wx, wz, patch);
          out.set(1, 1, 1, smoothstep(0.05, 0.35, m));
        },
      );
      const mossMesh = new Mesh(mossGeo, mossMat);
      mossMesh.rotation.x = -Math.PI / 2;
      mossMesh.position.set(patch.x, -0.493, patch.z);
      this.group.add(mossMesh);
      this.featureMeshes.push(mossMesh);
    }
  }

  /** Build a subdivided overlay plane with RGBA vertex colors and optional terrain contouring. */
  private createMaskedOverlayGeometry(
    width: number,
    height: number,
    segments: number,
    centerX: number,
    centerZ: number,
    followTerrain: boolean,
    evalRgba: (
      wx: number,
      wz: number,
      out: { set(r: number, g: number, b: number, a: number): void },
    ) => void,
  ): PlaneGeometry {
    const geo = new PlaneGeometry(width, height, segments, segments);
    const posAttr = geo.attributes['position'];
    if (!posAttr) return geo;

    const count = posAttr.count;
    const rgba = new Float32Array(count * 4);
    let cr = 1;
    let cg = 1;
    let cb = 1;
    let ca = 1;
    const out = {
      set: (r: number, g: number, b: number, a: number): void => {
        cr = r;
        cg = g;
        cb = b;
        ca = a;
      },
    };

    for (let i = 0; i < count; i++) {
      const wx = centerX + posAttr.getX(i);
      const wz = centerZ - posAttr.getY(i);
      if (followTerrain) {
        posAttr.setZ(i, this.evaluateTerrainHeight(wx, wz));
      }
      evalRgba(wx, wz, out);
      rgba[i * 4] = cr;
      rgba[i * 4 + 1] = cg;
      rgba[i * 4 + 2] = cb;
      rgba[i * 4 + 3] = ca;
    }

    geo.setAttribute('color', new Float32BufferAttribute(rgba, 4));
    if (followTerrain) {
      geo.computeVertexNormals();
    }
    return geo;
  }

  /**
   * Procedural 1024×1024 Inlaid Sunlit Marble & Gilded Stone Courtyard Compass Mosaic
   * centered around `(0, 0)`.
   */
  private createRoyalSunburstMosaicTexture(theme: VisualTheme): CanvasTexture {
    const dim = 1024;
    const cx = dim / 2;
    const cy = dim / 2;
    const canvas = document.createElement('canvas');
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      const isDark = theme === 'crystal_garden' || theme === 'starlight_galaxy';
      const isCandy = theme === 'candy_island';
      const rng = createSeededRng(6143);

      const marbleLight = isDark
        ? 'rgba(132, 146, 186, 0.62)'
        : isCandy
          ? 'rgba(255, 244, 238, 0.72)'
          : 'rgba(248, 239, 218, 0.76)';
      const marbleWarm = isDark
        ? 'rgba(98, 112, 152, 0.56)'
        : isCandy
          ? 'rgba(244, 222, 226, 0.64)'
          : 'rgba(232, 214, 180, 0.68)';
      const mortar = isDark ? 'rgba(42, 50, 78, 0.55)' : 'rgba(164, 140, 102, 0.42)';
      const goldMain = isDark ? 'rgba(242, 206, 108, 0.84)' : 'rgba(196, 138, 36, 0.82)';
      const goldBright = isDark ? 'rgba(255, 240, 184, 0.92)' : 'rgba(248, 214, 118, 0.90)';
      const accent =
        theme === 'starlight_galaxy'
          ? 'rgba(114, 212, 248, 0.62)'
          : theme === 'crystal_garden'
            ? 'rgba(236, 138, 212, 0.60)'
            : theme === 'candy_island'
              ? 'rgba(245, 162, 206, 0.62)'
              : 'rgba(222, 178, 86, 0.62)';

      // Radial sunlit limestone courtyard flagstone masonry rings (inner r=185 .. outer r=478)
      const ringBands: readonly [number, number, number][] = [
        [185, 245, 24],
        [245, 345, 32],
        [345, 448, 40],
        [448, 482, 48],
      ];

      for (let b = 0; b < ringBands.length; b++) {
        const [rIn, rOut, segs] = ringBands[b]!;
        const step = (Math.PI * 2) / segs;
        const rotOffset = (b % 2) * (step * 0.5);

        for (let s = 0; s < segs; s++) {
          const a0 = s * step + rotOffset + 0.004;
          const a1 = (s + 1) * step + rotOffset - 0.004;
          ctx.beginPath();
          ctx.arc(cx, cy, rOut - 1.5, a0, a1);
          ctx.arc(cx, cy, rIn + 1.5, a1, a0, true);
          ctx.closePath();

          ctx.fillStyle = (s + b) % 2 === 0 ? marbleLight : marbleWarm;
          ctx.fill();
          ctx.strokeStyle = mortar;
          ctx.lineWidth = 2.0;
          ctx.stroke();
        }
      }

      // Deterministic limestone mineral speckles over masonry ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, 480, 0, Math.PI * 2);
      ctx.arc(cx, cy, 185, 0, Math.PI * 2, true);
      ctx.clip();
      for (let i = 0; i < 900; i++) {
        const a = rng.random() * Math.PI * 2;
        const rad = 186 + rng.random() * 292;
        const sx = cx + Math.cos(a) * rad;
        const sy = cy + Math.sin(a) * rad;
        ctx.fillStyle =
          i % 2 === 0
            ? isDark
              ? 'rgba(205, 220, 255, 0.10)'
              : 'rgba(155, 134, 96, 0.16)'
            : 'rgba(255, 252, 242, 0.18)';
        ctx.fillRect(sx, sy, 2.2, 2.2);
      }
      ctx.restore();

      // Soft radial courtyard glow halo fading smoothly outward
      const halo = ctx.createRadialGradient(cx, cy, 170, cx, cy, 500);
      halo.addColorStop(0, isDark ? 'rgba(245, 212, 128, 0.14)' : 'rgba(255, 240, 195, 0.22)');
      halo.addColorStop(0.75, 'rgba(255, 240, 195, 0.06)');
      halo.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, dim, dim);

      // 16 Inlaid Gilded Sunburst Compass Rays
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        const isMajor = i % 2 === 0;
        const rInner = 192;
        const rOuter = isMajor ? 470 : 410;
        const halfSpread = isMajor ? 0.064 : 0.034;

        ctx.beginPath();
        ctx.moveTo(
          cx + Math.cos(angle - halfSpread) * rInner,
          cy + Math.sin(angle - halfSpread) * rInner,
        );
        ctx.lineTo(cx + Math.cos(angle) * rOuter, cy + Math.sin(angle) * rOuter);
        ctx.lineTo(
          cx + Math.cos(angle + halfSpread) * rInner,
          cy + Math.sin(angle + halfSpread) * rInner,
        );
        ctx.closePath();
        ctx.fillStyle = isMajor ? goldBright : accent;
        ctx.fill();
        ctx.strokeStyle = goldMain;
        ctx.lineWidth = isMajor ? 3.0 : 1.8;
        ctx.stroke();

        // Centerline stone-inlay crease along major compass rays
        if (isMajor) {
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(angle) * rInner, cy + Math.sin(angle) * rInner);
          ctx.lineTo(cx + Math.cos(angle) * (rOuter - 8), cy + Math.sin(angle) * (rOuter - 8));
          ctx.strokeStyle = mortar;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      }

      // Concentric inlaid brass/gold courtyard rings
      const rings: readonly { r: number; w: number; stroke: string }[] = [
        { r: 235, w: 6, stroke: goldMain },
        { r: 245, w: 2.5, stroke: goldBright },
        { r: 345, w: 8, stroke: goldMain },
        { r: 362, w: 3, stroke: accent },
        { r: 448, w: 6, stroke: goldMain },
        { r: 476, w: 3, stroke: goldBright },
      ];
      for (const ring of rings) {
        ctx.beginPath();
        ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
        ctx.strokeStyle = ring.stroke;
        ctx.lineWidth = ring.w;
        ctx.stroke();
      }

      // 32 carved stone degree ticks & 8 inlaid gilded diamond medallions
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        const r0 = i % 4 === 0 ? 350 : 356;
        const r1 = i % 4 === 0 ? 444 : 394;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.strokeStyle = i % 4 === 0 ? goldBright : goldMain;
        ctx.lineWidth = i % 4 === 0 ? 3.2 : 1.6;
        ctx.stroke();
      }

      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const mx = cx + Math.cos(a) * 448;
        const my = cy + Math.sin(a) * 448;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(a + Math.PI / 4);
        ctx.fillStyle = goldBright;
        ctx.strokeStyle = goldMain;
        ctx.lineWidth = 3;
        ctx.fillRect(-13, -13, 26, 26);
        ctx.strokeRect(-13, -13, 26, 26);
        ctx.restore();
      }
    }

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }

  private createRainbowPortalTexture(repeats: number): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 256, 0);
      grad.addColorStop(0.0, '#ff85d0');
      grad.addColorStop(0.17, '#ffb685');
      grad.addColorStop(0.34, '#fff08a');
      grad.addColorStop(0.51, '#85ffd4');
      grad.addColorStop(0.68, '#80d8ff');
      grad.addColorStop(0.85, '#c799ff');
      grad.addColorStop(1.0, '#ff85d0');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 64);

      ctx.globalCompositeOperation = 'destination-in';
      const alphaGrad = ctx.createLinearGradient(0, 0, 0, 64);
      alphaGrad.addColorStop(0, 'rgba(255,255,255,0.05)');
      alphaGrad.addColorStop(0.45, 'rgba(255,255,255,0.65)');
      alphaGrad.addColorStop(1, 'rgba(255,255,255,0.95)');
      ctx.fillStyle = alphaGrad;
      ctx.fillRect(0, 0, 256, 64);
    }

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.repeat.set(repeats, 1);
    texture.needsUpdate = true;
    return texture;
  }

  private disposeMeshes(): void {
    this.hideShrinkPreview();

    const disposables: DisposableObj[] = [];
    if (this.floor) disposables.push(this.floor);
    if (this.sunburstMosaic) disposables.push(this.sunburstMosaic);
    if (this.grid) disposables.push(this.grid);
    if (this.frame) disposables.push(this.frame);
    for (const m of this.featureMeshes) disposables.push(m);
    for (const m of this.wallMeshes) disposables.push(m);

    const disposedGeos = new Set<{ dispose(): void }>();
    const disposedMats = new Set<{ dispose(): void }>();

    for (const obj of disposables) {
      this.group.remove(obj as unknown as Mesh);
      if (!disposedGeos.has(obj.geometry)) {
        obj.geometry.dispose();
        disposedGeos.add(obj.geometry);
      }
      if (Array.isArray(obj.material)) {
        for (const mat of obj.material) {
          if (!disposedMats.has(mat)) {
            mat.dispose();
            disposedMats.add(mat);
          }
        }
      } else if (!disposedMats.has(obj.material)) {
        obj.material.dispose();
        disposedMats.add(obj.material);
      }
    }

    this.terrainTextures?.dispose();
    this.terrainTextures = undefined;
    this.sunburstTexture?.dispose();
    this.sunburstTexture = undefined;
    this.portalTexture?.dispose();
    this.portalTexture = undefined;

    this.floor = undefined;
    this.sunburstMosaic = undefined;
    this.lagoonMesh = undefined;
    this.lagoonFoamMesh = undefined;
    this.featureMeshes = [];
    this.grid = undefined;
    this.frame = undefined;
    this.wallMeshes = [];
    this.portalMaterials = [];
    this.railMaterials = [];
  }
}
