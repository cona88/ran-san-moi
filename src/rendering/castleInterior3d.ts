/**
 * "Thế Giới Nội Thất Lâu Đài Xa Hoa" — Opulent 3D Royal Palace Interior Worlds.
 *
 * Renders a 48×54 cutaway grand palace hall (`x ∈ [-24, 24], z ∈ [-26, 26]`) tailored
 * to all 7 `ShelterKind` themes (`castle`, `mushroom`, `crystal`, `mermaid`, `candy`,
 * `blossom`, `starlight`), complete with mirror-sheen inlaid floors, tiered chandeliers,
 * Grand Throne, Golden Vanity Mirror, Royal Banquet Table, Concert Harp, Treasure Chests,
 * Exit Portal, 7 animated theme centerpieces, and 3 spotlighted rotating 3D Boutique Pedestals.
 *
 * Purely deterministic (seeded Mulberry32 PRNG), zero per-frame allocations inside `draw()`,
 * and 100% GPU resource cleanup in `dispose()`.
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  PointLight,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CASTLE_ROYAL_SETS, INTERIOR_SPOTS } from '../core/castleInterior';
import type { CastleRoyalSet, GameState, ShelterKind } from '../core/types';
import {
  buildRoyalCrownMesh,
  buildSignatureWeaponMesh,
  type BuiltCosmeticAsset,
} from './princess3d';

interface SeededRng {
  next(): number;
}

/** Deterministic Mulberry32 PRNG — purely seeded and repeatable. */
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

interface PalacePalette {
  readonly skyTopHex: number;
  readonly skyHorizonHex: number;
  readonly wallLowerHex: number;
  readonly wallUpperHex: number;
  readonly trimGoldHex: number;
  readonly floorTileAHex: string;
  readonly floorTileBHex: string;
  readonly floorGoldCss: string;
  readonly carpetHex: number;
  readonly carpetBorderHex: number;
  readonly columnLowerHex: number;
  readonly columnUpperHex: number;
  readonly windowGlowHex: number;
  readonly chandelierCrystalHex: number;
  readonly lightColorHex: number;
}

const PALACE_PALETTES: Readonly<Record<ShelterKind, PalacePalette>> = {
  castle: {
    skyTopHex: 0x2b1038,
    skyHorizonHex: 0x6e2a58,
    wallLowerHex: 0xf5ece0,
    wallUpperHex: 0xfffaf2,
    trimGoldHex: 0xffcf56,
    floorTileAHex: '#fbf4e8',
    floorTileBHex: '#eedcc4',
    floorGoldCss: '#e0a434',
    carpetHex: 0xc9184a,
    carpetBorderHex: 0xffd166,
    columnLowerHex: 0xefe5d8,
    columnUpperHex: 0xffffff,
    windowGlowHex: 0xffe699,
    chandelierCrystalHex: 0xfff3c4,
    lightColorHex: 0xffe4a8,
  },
  mermaid: {
    skyTopHex: 0x041e3a,
    skyHorizonHex: 0x0d5c75,
    wallLowerHex: 0xb8f2f8,
    wallUpperHex: 0xe6fcff,
    trimGoldHex: 0x7ef8ff,
    floorTileAHex: '#134e6f',
    floorTileBHex: '#1b6ca8',
    floorGoldCss: '#64f8ff',
    carpetHex: 0x00b4d8,
    carpetBorderHex: 0xff9ee6,
    columnLowerHex: 0x48cae4,
    columnUpperHex: 0xcaf0f8,
    windowGlowHex: 0x56f6ff,
    chandelierCrystalHex: 0x9efaff,
    lightColorHex: 0xa8f9ff,
  },
  candy: {
    skyTopHex: 0x592654,
    skyHorizonHex: 0xb5598d,
    wallLowerHex: 0xffe0ee,
    wallUpperHex: 0xfff5fa,
    trimGoldHex: 0xffd166,
    floorTileAHex: '#ffe6f2',
    floorTileBHex: '#d8f8ee',
    floorGoldCss: '#ff75c3',
    carpetHex: 0xff5ca8,
    carpetBorderHex: 0x7ef8d8,
    columnLowerHex: 0xff70a6,
    columnUpperHex: 0xffffff,
    windowGlowHex: 0xffb3de,
    chandelierCrystalHex: 0xffe3f4,
    lightColorHex: 0xffe5f4,
  },
  blossom: {
    skyTopHex: 0x3b183e,
    skyHorizonHex: 0x8f4472,
    wallLowerHex: 0xfce4ec,
    wallUpperHex: 0xfff8fb,
    trimGoldHex: 0xffd166,
    floorTileAHex: '#fff0f6',
    floorTileBHex: '#f8d7e6',
    floorGoldCss: '#f497b6',
    carpetHex: 0xe64980,
    carpetBorderHex: 0xffe066,
    columnLowerHex: 0xf4acb7,
    columnUpperHex: 0xfff0f5,
    windowGlowHex: 0xffc2d8,
    chandelierCrystalHex: 0xffdfee,
    lightColorHex: 0xffe6f0,
  },
  crystal: {
    skyTopHex: 0x0b193d,
    skyHorizonHex: 0x1e4d7b,
    wallLowerHex: 0xd0f0fd,
    wallUpperHex: 0xf2fcff,
    trimGoldHex: 0x90e0ef,
    floorTileAHex: '#16325c',
    floorTileBHex: '#234b82',
    floorGoldCss: '#8be9ff',
    carpetHex: 0x0096c7,
    carpetBorderHex: 0xe0fbfc,
    columnLowerHex: 0x48bfe3,
    columnUpperHex: 0xffffff,
    windowGlowHex: 0x80ffdb,
    chandelierCrystalHex: 0xdffcff,
    lightColorHex: 0xd8f8ff,
  },
  starlight: {
    skyTopHex: 0x06081f,
    skyHorizonHex: 0x241654,
    wallLowerHex: 0x2c225e,
    wallUpperHex: 0x48388a,
    trimGoldHex: 0xffd700,
    floorTileAHex: '#11143a',
    floorTileBHex: '#1c2259',
    floorGoldCss: '#ffd166',
    carpetHex: 0x5a189a,
    carpetBorderHex: 0xffd700,
    columnLowerHex: 0x3c2f78,
    columnUpperHex: 0xc77dff,
    windowGlowHex: 0xc792ff,
    chandelierCrystalHex: 0xffe89e,
    lightColorHex: 0xe6d4ff,
  },
  mushroom: {
    skyTopHex: 0x0f2922,
    skyHorizonHex: 0x245c46,
    wallLowerHex: 0xe8f5e9,
    wallUpperHex: 0xf9fbe7,
    trimGoldHex: 0xffd166,
    floorTileAHex: '#1d4734',
    floorTileBHex: '#285e45',
    floorGoldCss: '#80ed99',
    carpetHex: 0x2d6a4f,
    carpetBorderHex: 0xffd166,
    columnLowerHex: 0xf4ece4,
    columnUpperHex: 0xff69b4,
    windowGlowHex: 0x80ffdb,
    chandelierCrystalHex: 0xb8ffda,
    lightColorHex: 0xd8ffe8,
  },
};

const M4_SCRATCH = new Matrix4();
const POS_SCRATCH = new Vector3();
const SCALE_SCRATCH = new Vector3();
const EULER_SCRATCH = new Euler();
const QUAT_SCRATCH = new Quaternion();
const COL_BOTTOM = new Color();
const COL_TOP = new Color();
const COL_TMP = new Color();

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

interface PedestalDisplay {
  readonly slot: 'outfit' | 'makeup' | 'weapon';
  readonly turntable: Group;
  readonly spotlightMat: MeshBasicMaterial;
  readonly ringMat: MeshBasicMaterial;
  readonly baseY: number;
}

interface SwimmerAnim {
  readonly group: Group;
  readonly centerX: number;
  readonly centerZ: number;
  readonly radiusX: number;
  readonly radiusZ: number;
  readonly baseY: number;
  readonly speed: number;
  readonly phase: number;
  readonly isJelly: boolean;
}

interface DriftMoteAnim {
  readonly mesh: Mesh;
  readonly centerX: number;
  readonly centerZ: number;
  readonly radius: number;
  readonly minY: number;
  readonly spanY: number;
  readonly speed: number;
  readonly phase: number;
}

export class CastleInterior3DView {
  private readonly root = new Group();
  private builtKind: ShelterKind | null = null;

  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly lights: PointLight[] = [];
  private floorTexture: CanvasTexture | null = null;
  private readonly cosmeticAssets: BuiltCosmeticAsset[] = [];

  private readonly chandeliers: Group[] = [];
  private readonly spinCenterpieces: Mesh[] = [];
  private readonly swimmers: SwimmerAnim[] = [];
  private readonly driftMotes: DriftMoteAnim[] = [];
  private readonly pedestals: PedestalDisplay[] = [];
  private exitPortalMesh: Mesh | null = null;
  private exitPortalMat: MeshBasicMaterial | null = null;
  private throneCrownMesh: Mesh | null = null;

  constructor(private readonly scene: Scene) {
    this.root.name = 'castleInterior3D';
    this.root.visible = false;
    this.scene.add(this.root);
  }

  /** Sync active castle interior theme; hides cleanly when `state.castleInterior === null`. */
  sync(state: GameState): void {
    const interior = state.castleInterior;
    if (!interior) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    if (this.builtKind !== interior.shelterKind) {
      this.rebuildPalace(interior.shelterKind);
    }
  }

  /** Animate chandeliers, pedestals, exit portal & signature castle centerpieces at 60fps (zero allocs). */
  draw(elapsed: number, _delta: number, state: GameState): void {
    const interior = state.castleInterior;
    if (!interior || !this.root.visible) return;

    // 1. Gently swaying & sparkling crystal chandeliers
    for (let i = 0; i < this.chandeliers.length; i++) {
      const ch = this.chandeliers[i]!;
      ch.rotation.y = elapsed * 0.22 + i * 1.1;
      ch.rotation.z = Math.sin(elapsed * 1.1 + i) * 0.025;
    }

    // 2. Throne crown & exit portal shimmer
    if (this.throneCrownMesh) {
      this.throneCrownMesh.rotation.y = elapsed * 1.1;
      this.throneCrownMesh.position.y = 8.4 + Math.sin(elapsed * 2.4) * 0.18;
    }
    if (this.exitPortalMesh && this.exitPortalMat) {
      this.exitPortalMesh.rotation.y = elapsed * 0.85;
      this.exitPortalMat.opacity = 0.42 + 0.16 * Math.sin(elapsed * 3.2);
    }

    // 3. Rotating 3D Boutique Display Pedestals (Outfit, Makeup/Crown, Signature Weapon)
    const activeZone = interior.nearZone;
    const wardrobe = state.wardrobe;
    for (let i = 0; i < this.pedestals.length; i++) {
      const ped = this.pedestals[i]!;
      const isFocused = activeZone === ped.slot;
      const isEquipped =
        (ped.slot === 'outfit' && wardrobe.equippedOutfit === interior.shelterKind) ||
        (ped.slot === 'makeup' && wardrobe.equippedMakeup === interior.shelterKind) ||
        (ped.slot === 'weapon' && wardrobe.equippedWeapon === interior.shelterKind);

      const spinSpeed = isFocused ? 1.8 : 0.85;
      ped.turntable.rotation.y = elapsed * spinSpeed + i * 0.8;
      ped.turntable.position.y = ped.baseY + Math.sin(elapsed * 2.6 + i) * 0.14;

      const baseSpot = isFocused ? 0.28 : isEquipped ? 0.2 : 0.12;
      ped.spotlightMat.opacity = baseSpot + 0.05 * Math.sin(elapsed * 4.2 + i);
      ped.ringMat.opacity =
        (isFocused ? 0.92 : isEquipped ? 0.75 : 0.48) + 0.12 * Math.sin(elapsed * 3.8 + i);
    }

    // 4. Spinning theme centerpieces (Candy Macaron Carousel, Starlight Orrery, Crystal Harp)
    for (let i = 0; i < this.spinCenterpieces.length; i++) {
      const sp = this.spinCenterpieces[i]!;
      const dir = i % 2 === 0 ? 1 : -1;
      sp.rotation.y = elapsed * dir * (0.55 + i * 0.22);
      if (i >= 1 && this.builtKind === 'starlight') {
        sp.rotation.x = Math.sin(elapsed * 0.7 + i) * 0.48;
      }
    }

    // 5. Swimming luminous fish & jellyfish in Mermaid Ocean Palace!
    for (let i = 0; i < this.swimmers.length; i++) {
      const sw = this.swimmers[i]!;
      const a = elapsed * sw.speed + sw.phase;
      const nx = Math.cos(a) * sw.radiusX + sw.centerX;
      const nz = Math.sin(a) * sw.radiusZ + sw.centerZ;
      const ny =
        sw.baseY +
        Math.sin(elapsed * (sw.isJelly ? 2.2 : 1.6) + sw.phase) * (sw.isJelly ? 0.65 : 0.35);
      sw.group.position.set(nx, ny, nz);
      if (sw.isJelly) {
        const pulse = 0.88 + 0.18 * Math.sin(elapsed * 3.6 + sw.phase);
        sw.group.scale.set(pulse, 1.15 - (pulse - 0.88) * 0.6, pulse);
        sw.group.rotation.y = a;
      } else {
        const tx = -Math.sin(a) * sw.radiusX;
        const tz = Math.cos(a) * sw.radiusZ;
        sw.group.rotation.y = Math.atan2(tx, tz);
        sw.group.rotation.z = Math.sin(elapsed * 6.5 + sw.phase) * 0.08;
      }
    }

    // 6. Drifting sakura petals, fireflies & pearl bubbles
    for (let i = 0; i < this.driftMotes.length; i++) {
      const dm = this.driftMotes[i]!;
      const t = (elapsed * dm.speed + dm.phase) % 1;
      const a = dm.phase * Math.PI * 2 + elapsed * 0.7 + t * 3.2;
      const y =
        this.builtKind === 'mermaid' || this.builtKind === 'mushroom'
          ? dm.minY + t * dm.spanY
          : dm.minY + (1 - t) * dm.spanY;
      dm.mesh.position.set(
        dm.centerX + Math.cos(a) * dm.radius,
        y,
        dm.centerZ + Math.sin(a) * dm.radius,
      );
      dm.mesh.rotation.y = a * 1.8;
      dm.mesh.rotation.x = elapsed * 2.0 + dm.phase;
    }
  }

  dispose(): void {
    this.clearPalace();
    this.scene.remove(this.root);
  }

  // ---------------------------------------------------------------------------
  // Palace Hall Builder
  // ---------------------------------------------------------------------------

  private clearPalace(): void {
    this.root.clear();
    for (const asset of this.cosmeticAssets) {
      for (const g of asset.geometries) g.dispose();
      for (const m of asset.materials) m.dispose();
    }
    this.cosmeticAssets.length = 0;
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const l of this.lights) l.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.lights.length = 0;
    this.floorTexture?.dispose();
    this.floorTexture = null;
    this.chandeliers.length = 0;
    this.spinCenterpieces.length = 0;
    this.swimmers.length = 0;
    this.driftMotes.length = 0;
    this.pedestals.length = 0;
    this.exitPortalMesh = null;
    this.exitPortalMat = null;
    this.throneCrownMesh = null;
    this.builtKind = null;
  }

  private rebuildPalace(kind: ShelterKind): void {
    this.clearPalace();
    this.builtKind = kind;
    const pal = PALACE_PALETTES[kind];
    const royalSet = CASTLE_ROYAL_SETS[kind];

    // 1. Enchanted Palace Atmosphere Backdrop Dome (encloses cutaway vista cleanly)
    const domeGeo = bakePart(new SphereGeometry(115, 28, 18), pal.skyHorizonHex, pal.skyTopHex);
    const domeMat = new MeshBasicMaterial({
      vertexColors: true,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.geometries.push(domeGeo);
    this.materials.push(domeMat);
    const dome = new Mesh(domeGeo, domeMat);
    dome.renderOrder = -15;
    this.root.add(dome);

    // 2. Mirror-Sheen Inlaid Palace Floor (48 × 52)
    this.floorTexture = this.createInlaidFloorTexture(pal);
    const floorGeo = new PlaneGeometry(48, 52);
    const floorMat = new MeshStandardMaterial({
      map: this.floorTexture,
      roughness: 0.18,
      metalness: 0.22,
      fog: false,
    });
    this.geometries.push(floorGeo);
    this.materials.push(floorMat);
    const floorMesh = new Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -0.02;
    this.root.add(floorMesh);

    // Shared palace materials (fog: false so interior sparkles at full vibrancy!)
    const solidMat = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.34,
      metalness: 0.24,
      fog: false,
    });
    const glowMat = new MeshBasicMaterial({ vertexColors: true, fog: false });
    this.materials.push(solidMat, glowMat);

    const staticParts: BufferGeometry[] = [];
    const glowParts: BufferGeometry[] = [];

    // 3. Grand Velvet/Silk Carpet Runner + 3-Step Royal Dais + Walls + Windows + 12 Columns
    this.populateHallArchitecture(kind, pal, staticParts, glowParts);

    // 4. Opulent Furnishings at exact INTERIOR_SPOTS: Throne, Vanity, Banquet, Harp & Chests, Exit Gate
    this.populateGrandFurnishings(kind, pal, staticParts, glowParts, glowMat);

    // 5. 7 Signature Theme Centerpieces & Animated Wonders
    this.populateThemeCenterpieces(kind, pal, staticParts, glowParts, solidMat, glowMat);

    const staticGeo = mergeParts(staticParts);
    this.geometries.push(staticGeo);
    this.root.add(new Mesh(staticGeo, solidMat));

    if (glowParts.length > 0) {
      const gGeo = mergeParts(glowParts);
      this.geometries.push(gGeo);
      this.root.add(new Mesh(gGeo, glowMat));
    }

    // 6. 3 Colossal Sparkling Tiered Crystal Chandeliers + Warm PointLights
    this.buildChandeliers(pal, solidMat, glowMat);

    // 7. 3 Spotlighted Rotating 3D Display Mannequins / Pedestals
    this.buildBoutiquePedestals(royalSet, solidMat);
  }

  private createInlaidFloorTexture(pal: PalacePalette): CanvasTexture {
    const dim = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      // Checkerboard marble / crystal diamond tiles
      const cells = 16;
      const step = dim / cells;
      for (let r = 0; r < cells; r++) {
        for (let c = 0; c < cells; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? pal.floorTileAHex : pal.floorTileBHex;
          ctx.fillRect(c * step, r * step, step, step);
          ctx.strokeStyle = pal.floorGoldCss;
          ctx.globalAlpha = 0.25;
          ctx.lineWidth = 2;
          ctx.strokeRect(c * step + 1, r * step + 1, step - 2, step - 2);
          ctx.globalAlpha = 1;
        }
      }

      // Central Grand Royal Sunburst Medallion
      const cx = dim / 2;
      const cy = dim / 2;
      ctx.strokeStyle = pal.floorGoldCss;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(cx, cy, 220, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, 165, 0, Math.PI * 2);
      ctx.stroke();

      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 55, cy + Math.sin(a) * 55);
        ctx.lineTo(cx + Math.cos(a) * 215, cy + Math.sin(a) * 215);
        ctx.stroke();
      }
    }

    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }

  private populateHallArchitecture(
    kind: ShelterKind,
    pal: PalacePalette,
    parts: BufferGeometry[],
    glowParts: BufferGeometry[],
  ): void {
    // Plush Grand Carpet Runner (z = -20 to +21.5) with gilded border rails
    parts.push(
      bakePart(
        new BoxGeometry(7.2, 0.05, 41.5),
        pal.carpetBorderHex,
        pal.carpetBorderHex,
        0,
        0.01,
        0.75,
      ),
      bakePart(new BoxGeometry(6.2, 0.065, 41.2), pal.carpetHex, pal.carpetHex, 0, 0.02, 0.75),
      // 3-Step Royal Dais at north end (z = -17.2 .. -23.5)
      bakePart(
        new BoxGeometry(18.5, 0.36, 7.2),
        pal.wallLowerHex,
        pal.wallUpperHex,
        0,
        0.18,
        -20.2,
      ),
      bakePart(
        new BoxGeometry(15.2, 0.36, 5.8),
        pal.wallLowerHex,
        pal.wallUpperHex,
        0,
        0.54,
        -20.6,
      ),
      bakePart(new BoxGeometry(11.8, 0.36, 4.4), pal.carpetHex, pal.carpetBorderHex, 0, 0.9, -21.0),
    );

    // Back Grand Throne Wall (z = -24.6, h = 14.5) + Gilded Cornice
    parts.push(
      bakePart(
        new BoxGeometry(48.4, 14.5, 1.2),
        pal.wallLowerHex,
        pal.wallUpperHex,
        0,
        7.25,
        -24.6,
      ),
      bakePart(new BoxGeometry(49.0, 0.85, 1.8), pal.trimGoldHex, 0xffffff, 0, 14.6, -24.6),
      bakePart(new BoxGeometry(48.6, 0.7, 1.5), pal.trimGoldHex, pal.wallUpperHex, 0, 0.35, -24.4),
    );

    // 4 Arched Enchanted Stained-Glass Windows along Back Wall
    for (const wx of [-16.5, -7.5, 7.5, 16.5]) {
      glowParts.push(
        bakePart(
          new CylinderGeometry(2.1, 2.1, 0.25, 16),
          pal.windowGlowHex,
          0xffffff,
          wx,
          9.6,
          -23.95,
          Math.PI / 2,
        ),
        bakePart(new BoxGeometry(4.2, 5.6, 0.22), pal.windowGlowHex, 0xffffff, wx, 6.8, -23.95),
      );
      parts.push(
        bakePart(
          new TorusGeometry(2.15, 0.18, 6, 20, Math.PI),
          pal.trimGoldHex,
          0xffffff,
          wx,
          9.6,
          -23.85,
        ),
      );
    }

    // Cutaway Colonnade Side Balustrades & Arched Side Walls (x = ±23.4, h = 12.5)
    for (const side of [-1, 1] as const) {
      const sx = side * 23.4;
      parts.push(
        bakePart(
          new BoxGeometry(1.1, 12.2, 51.0),
          pal.wallLowerHex,
          pal.wallUpperHex,
          sx,
          6.1,
          0.5,
        ),
        bakePart(new BoxGeometry(1.6, 0.75, 51.4), pal.trimGoldHex, 0xffffff, sx, 12.4, 0.5),
      );
      for (const wz of [-15, -5, 5, 15]) {
        glowParts.push(
          bakePart(
            new BoxGeometry(0.24, 6.4, 3.6),
            pal.windowGlowHex,
            0xffffff,
            sx - side * 0.52,
            6.8,
            wz,
          ),
        );
      }
    }

    // 12 Tall Sculpted Columns (x = ±19.4, z = -19, -12, -5, +2, +9, +16) styled by ShelterKind!
    const colZs = [-19, -12, -5, 2, 9, 16] as const;
    for (const side of [-1, 1] as const) {
      const cx = side * 19.4;
      for (const cz of colZs) {
        parts.push(
          bakePart(
            new CylinderGeometry(0.92, 1.08, 0.7, 12),
            pal.trimGoldHex,
            0xffffff,
            cx,
            0.35,
            cz,
          ),
          bakePart(
            new CylinderGeometry(0.66, 0.76, 10.6, 12),
            pal.columnLowerHex,
            pal.columnUpperHex,
            cx,
            6.0,
            cz,
          ),
          bakePart(
            new CylinderGeometry(0.98, 0.7, 0.8, 12),
            pal.trimGoldHex,
            0xffffff,
            cx,
            11.5,
            cz,
          ),
        );
        if (kind === 'mushroom') {
          // Glowing bioluminescent mushroom-cap capital!
          parts.push(
            bakePart(
              new SphereGeometry(1.85, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.52),
              0xd63384,
              0xff9ebb,
              cx,
              11.2,
              cz,
            ),
          );
        } else if (kind === 'candy') {
          // Peppermint spiral rings around column!
          for (let r = 0; r < 4; r++) {
            parts.push(
              bakePart(
                new TorusGeometry(0.74, 0.11, 6, 18),
                r % 2 === 0 ? 0xff4d9e : 0x7ef8d8,
                0xffffff,
                cx,
                2.5 + r * 2.3,
                cz,
                Math.PI / 2 + 0.22,
              ),
            );
          }
        } else if (kind === 'crystal') {
          glowParts.push(
            bakePart(
              new OctahedronGeometry(0.65, 0),
              0x56f6ff,
              0xffffff,
              cx - side * 0.65,
              6.2,
              cz,
            ),
          );
        }
      }
    }
  }

  private populateGrandFurnishings(
    kind: ShelterKind,
    pal: PalacePalette,
    parts: BufferGeometry[],
    glowParts: BufferGeometry[],
    glowMat: Material,
  ): void {
    // 1. 👑 GRAND ROYAL THRONE at (0, -19.5) on the 3-step dais (y_base = 1.08)
    const tx = INTERIOR_SPOTS.throne.x;
    const tz = INTERIOR_SPOTS.throne.z;
    if (kind === 'mermaid') {
      // Giant Open Pearl-Clam Shell Throne!
      parts.push(
        bakePart(new CylinderGeometry(2.6, 3.0, 0.8, 16), 0x48cae4, 0xffb3e6, tx, 1.48, tz),
        bakePart(
          new SphereGeometry(1.5, 16, 12),
          0xfff0fa,
          0xffffff,
          tx,
          2.25,
          tz,
          0,
          0,
          0,
          1.3,
          0.65,
          1.1,
        ),
        bakePart(
          new CylinderGeometry(3.4, 2.2, 5.8, 14, 1, false, -Math.PI * 0.48, Math.PI * 0.96),
          0xff75c3,
          0x9efaff,
          tx,
          4.6,
          tz - 1.1,
          -0.18,
          Math.PI,
          0,
          1.0,
          1.0,
          0.35,
        ),
      );
    } else {
      parts.push(
        // Velvet seat + high sculpted gilded backrest + lion/gold armrests + royal canopy
        bakePart(new BoxGeometry(3.6, 1.1, 2.6), pal.trimGoldHex, 0xfff3b0, tx, 1.62, tz),
        bakePart(new BoxGeometry(3.1, 0.45, 2.3), pal.carpetHex, 0xff85a1, tx, 2.3, tz + 0.1),
        bakePart(new BoxGeometry(3.5, 5.4, 0.65), pal.trimGoldHex, 0xfff5c0, tx, 4.6, tz - 1.05),
        bakePart(
          new BoxGeometry(2.7, 4.4, 0.72),
          pal.carpetHex,
          pal.carpetBorderHex,
          tx,
          4.5,
          tz - 0.98,
        ),
        bakePart(new BoxGeometry(0.55, 1.6, 2.6), pal.trimGoldHex, 0xffffff, tx - 1.75, 2.6, tz),
        bakePart(new BoxGeometry(0.55, 1.6, 2.6), pal.trimGoldHex, 0xffffff, tx + 1.75, 2.6, tz),
        // Royal canopy arch above throne
        bakePart(
          new CylinderGeometry(3.2, 3.8, 1.4, 8),
          pal.carpetHex,
          pal.trimGoldHex,
          tx,
          9.6,
          tz - 0.6,
        ),
      );
    }

    // Floating spinning golden crown above the throne
    const throneCrownGeo = bakePart(new OctahedronGeometry(0.75, 0), 0xffd700, 0xffffff);
    this.geometries.push(throneCrownGeo);
    this.throneCrownMesh = new Mesh(throneCrownGeo, glowMat);
    this.throneCrownMesh.position.set(tx, 8.4, tz - 0.4);
    this.root.add(this.throneCrownMesh);

    // 2. 🪞 GIANT GOLDEN VANITY MIRROR & DRESSING TABLE at (-13.5, -5.5), angled toward hall center
    const vx = INTERIOR_SPOTS.vanity.x;
    const vz = INTERIOR_SPOTS.vanity.z;
    const vYaw = 0.42;
    parts.push(
      // Ornate dressing table + legs + tufted velvet stool
      bakePart(new BoxGeometry(5.6, 0.45, 2.4), pal.trimGoldHex, 0xffffff, vx, 2.1, vz, 0, vYaw, 0),
      bakePart(
        new CylinderGeometry(1.9, 2.1, 1.9, 12),
        pal.wallLowerHex,
        pal.wallUpperHex,
        vx,
        0.95,
        vz,
        0,
        vYaw,
        0,
      ),
      bakePart(
        new CylinderGeometry(0.95, 0.85, 1.15, 14),
        pal.carpetHex,
        pal.carpetBorderHex,
        vx + 1.4,
        0.58,
        vz + 1.8,
      ),
      // Tall 7.8u Arched Golden Mirror Frame
      bakePart(
        new BoxGeometry(4.4, 6.2, 0.38),
        pal.trimGoldHex,
        0xfff5c0,
        vx - 0.5,
        5.3,
        vz - 0.8,
        0,
        vYaw,
        0,
      ),
      bakePart(
        new TorusGeometry(2.1, 0.28, 8, 24, Math.PI),
        pal.trimGoldHex,
        0xffffff,
        vx - 0.5,
        8.2,
        vz - 0.8,
        0,
        vYaw,
        0,
      ),
      // Perfume bottles, golden lipsticks & open jewel box on tabletop!
      bakePart(
        new CylinderGeometry(0.28, 0.36, 0.75, 10),
        0xff69b4,
        0xffffff,
        vx - 1.2,
        2.7,
        vz + 0.1,
      ),
      bakePart(
        new CylinderGeometry(0.16, 0.16, 0.58, 8),
        0xffd700,
        0xff2a55,
        vx - 0.4,
        2.6,
        vz + 0.3,
      ),
      bakePart(
        new BoxGeometry(0.85, 0.42, 0.65),
        0x9d4edd,
        0xffd700,
        vx + 0.8,
        2.52,
        vz - 0.1,
        0,
        vYaw,
        0,
      ),
    );
    // Shimmering mirror glass plane
    glowParts.push(
      bakePart(
        new PlaneGeometry(3.7, 5.6),
        0xb8f4ff,
        0xffffff,
        vx - 0.35,
        5.3,
        vz - 0.58,
        0,
        vYaw,
        0,
      ),
    );

    // 3. 🍰 ROYAL BANQUET TABLE at (+13.5, -5.5) with 3-tier frosted cakes, goblets & candelabras!
    const bx = INTERIOR_SPOTS.banquet.x;
    const bz = INTERIOR_SPOTS.banquet.z;
    parts.push(
      // Silk-draped banquet table (4.2 × 8.8) + 4 high-back royal dining chairs
      bakePart(new BoxGeometry(4.2, 1.85, 8.8), pal.wallLowerHex, pal.wallUpperHex, bx, 0.92, bz),
      bakePart(new BoxGeometry(4.5, 0.32, 9.1), pal.carpetHex, pal.trimGoldHex, bx, 1.92, bz),
      // Grand 3-Tier Frosted Royal Cake in the center!
      bakePart(new CylinderGeometry(1.15, 1.2, 0.68, 16), 0xff85c0, 0xfff0f6, bx, 2.42, bz),
      bakePart(new CylinderGeometry(0.82, 0.86, 0.58, 16), 0x7ef8d8, 0xffffff, bx, 3.05, bz),
      bakePart(new CylinderGeometry(0.5, 0.54, 0.5, 14), 0xffe066, 0xffffff, bx, 3.58, bz),
      bakePart(new SphereGeometry(0.24, 10, 8), 0xff2a55, 0xff9ebb, bx, 3.98, bz),
      // Crystal fruit/macaron platters & golden goblets
      bakePart(
        new CylinderGeometry(0.75, 0.4, 0.45, 12),
        pal.trimGoldHex,
        0xffffff,
        bx,
        2.3,
        bz - 2.6,
      ),
      bakePart(
        new CylinderGeometry(0.75, 0.4, 0.45, 12),
        pal.trimGoldHex,
        0xffffff,
        bx,
        2.3,
        bz + 2.6,
      ),
      bakePart(
        new CylinderGeometry(0.18, 0.22, 0.95, 8),
        0xffd700,
        0xfff5c0,
        bx - 0.9,
        2.55,
        bz - 1.4,
      ),
      bakePart(
        new CylinderGeometry(0.18, 0.22, 0.95, 8),
        0xffd700,
        0xfff5c0,
        bx + 0.9,
        2.55,
        bz + 1.4,
      ),
    );
    glowParts.push(
      bakePart(new OctahedronGeometry(0.28, 0), 0xffe066, 0xffffff, bx - 0.9, 3.2, bz - 1.4),
      bakePart(new OctahedronGeometry(0.28, 0), 0xffe066, 0xffffff, bx + 0.9, 3.2, bz + 1.4),
    );
    for (const czOff of [-2.2, 2.2]) {
      parts.push(
        bakePart(
          new BoxGeometry(1.1, 2.6, 1.1),
          pal.trimGoldHex,
          pal.carpetHex,
          bx - 2.8,
          1.3,
          bz + czOff,
        ),
        bakePart(
          new BoxGeometry(1.1, 2.6, 1.1),
          pal.trimGoldHex,
          pal.carpetHex,
          bx + 2.8,
          1.3,
          bz + czOff,
        ),
      );
    }

    // 4. 🎵 GRAND GOLDEN HARP (-14, +7.5) & OVERFLOWING TREASURE CHESTS (+14, +7.5)
    parts.push(
      bakePart(new CylinderGeometry(1.3, 1.5, 0.45, 12), pal.trimGoldHex, 0xffffff, -14, 0.22, 7.5),
      bakePart(new CylinderGeometry(0.22, 0.3, 5.4, 8), 0xffd700, 0xfff6c4, -14.8, 2.9, 7.5),
      bakePart(
        new TorusGeometry(2.2, 0.22, 8, 24, Math.PI * 0.85),
        0xffb703,
        0xfff5bd,
        -13.4,
        3.4,
        7.5,
        0,
        0,
        Math.PI * 0.6,
      ),
      // Treasure Chests (+14, +7.5) overflowing with gold & gems!
      bakePart(new BoxGeometry(2.8, 1.45, 1.9), 0x7c4722, 0xffd700, 14, 0.72, 7.5, 0, -0.35, 0),
      bakePart(
        new CylinderGeometry(0.95, 0.95, 2.8, 10, 1, false, 0, Math.PI),
        0x9c5a2b,
        0xffe066,
        14.1,
        1.65,
        7.1,
        0,
        -0.35,
        Math.PI / 2,
      ),
      bakePart(new BoxGeometry(1.9, 1.05, 1.35), 0x6b3d1e, 0xffd700, 11.8, 0.52, 8.8, 0, 0.4, 0),
    );
    glowParts.push(
      bakePart(
        new SphereGeometry(0.95, 12, 8),
        0xffd700,
        0x7ef8ff,
        14,
        1.45,
        7.6,
        0,
        0,
        0,
        1.25,
        0.55,
        0.85,
      ),
    );

    // 5. 🚪 CUTAWAY SHIMMERING EXIT PORTAL THRESHOLD at (0, +21.5)
    // Open-top twin crystal portal lanterns (x = ±4.8) + glowing starlight floor portal pad
    // so the 3rd-person isometric camera has a 100% unobstructed view of the Fairy & Crown at spawn!
    const ex = INTERIOR_SPOTS.exitGate.x;
    const ez = INTERIOR_SPOTS.exitGate.z;
    parts.push(
      bakePart(
        new CylinderGeometry(0.52, 0.72, 2.2, 10),
        pal.trimGoldHex,
        0xffffff,
        ex - 4.8,
        1.1,
        ez,
      ),
      bakePart(
        new CylinderGeometry(0.52, 0.72, 2.2, 10),
        pal.trimGoldHex,
        0xffffff,
        ex + 4.8,
        1.1,
        ez,
      ),
      bakePart(
        new TorusGeometry(3.15, 0.16, 8, 36),
        pal.trimGoldHex,
        0xfff6cc,
        ex,
        0.1,
        ez,
        Math.PI / 2,
      ),
    );
    glowParts.push(
      bakePart(new OctahedronGeometry(0.48, 0), 0x56f6ff, 0xffffff, ex - 4.8, 2.55, ez),
      bakePart(new OctahedronGeometry(0.48, 0), 0x56f6ff, 0xffffff, ex + 4.8, 2.55, ez),
      bakePart(new RingGeometry(2.2, 2.95, 36), 0x56f6ff, 0xffe066, ex, 0.05, ez, -Math.PI / 2),
    );

    const portalGeo = new CircleGeometry(2.85, 32);
    portalGeo.rotateX(-Math.PI / 2);
    this.exitPortalMat = new MeshBasicMaterial({
      color: pal.windowGlowHex,
      transparent: true,
      opacity: 0.46,
      side: DoubleSide,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.geometries.push(portalGeo);
    this.materials.push(this.exitPortalMat);
    this.exitPortalMesh = new Mesh(portalGeo, this.exitPortalMat);
    this.exitPortalMesh.position.set(ex, 0.06, ez);
    this.root.add(this.exitPortalMesh);
  }

  private populateThemeCenterpieces(
    kind: ShelterKind,
    pal: PalacePalette,
    parts: BufferGeometry[],
    glowParts: BufferGeometry[],
    solidMat: Material,
    glowMat: Material,
  ): void {
    const rng = createSeededRng(0xc4571e0 + kind.length * 97);

    if (kind === 'castle') {
      // Twin Golden Winged Lion/Dragon Guardian Statues flanking the Royal Dais!
      for (const side of [-1, 1] as const) {
        const gx = side * 6.8;
        const gz = -17.6;
        parts.push(
          bakePart(new BoxGeometry(2.2, 1.2, 2.6), pal.wallLowerHex, 0xffffff, gx, 0.6, gz),
          bakePart(new CylinderGeometry(0.65, 0.85, 2.8, 8), 0xdba02c, 0xfff3b0, gx, 2.5, gz),
          bakePart(new SphereGeometry(0.75, 10, 10), 0xffb703, 0xfff6cc, gx, 4.1, gz + 0.35),
          bakePart(
            new ConeGeometry(1.1, 3.8, 5),
            0xe09f24,
            0xfff8cc,
            gx - side * 1.2,
            3.8,
            gz - 0.2,
            0,
            0,
            side * 0.48,
          ),
        );
      }
    } else if (kind === 'mermaid') {
      // Pearl Bubble Fountain (+6.8, +4.2) + 12 Animated Swimming Luminous Fish & Jellyfish overhead!
      parts.push(
        bakePart(new CylinderGeometry(2.5, 2.9, 0.65, 20), 0x00b4d8, 0xcaf0f8, 6.8, 0.32, 4.2),
        bakePart(new SphereGeometry(0.95, 14, 12), 0xffb3e6, 0xffffff, 6.8, 1.6, 4.2),
      );

      const fishBodyGeo = bakePart(
        new ConeGeometry(0.38, 1.45, 8),
        0x38f6ff,
        0xff85d0,
        0,
        0,
        0,
        Math.PI / 2,
      );
      const fishTailGeo = bakePart(
        new ConeGeometry(0.32, 0.55, 4),
        0xffe066,
        0xffffff,
        0,
        0,
        -0.85,
        -Math.PI / 2,
      );
      const fishGeo = mergeParts([fishBodyGeo, fishTailGeo]);

      const jellyBellGeo = bakePart(
        new SphereGeometry(0.72, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58),
        0xff75c3,
        0x7ef8ff,
      );
      const jellyTentGeo = bakePart(
        new CylinderGeometry(0.05, 0.02, 1.35, 5),
        0x7ef8ff,
        0xffb8f0,
        0,
        -0.7,
        0,
      );
      const jellyGeo = mergeParts([jellyBellGeo, jellyTentGeo]);
      this.geometries.push(fishGeo, jellyGeo);

      for (let i = 0; i < 12; i++) {
        const isJelly = i % 3 === 0;
        const grp = new Group();
        grp.add(new Mesh(isJelly ? jellyGeo : fishGeo, glowMat));
        this.root.add(grp);
        this.swimmers.push({
          group: grp,
          centerX: (rng.next() - 0.5) * 10,
          centerZ: -4 + (rng.next() - 0.5) * 12,
          radiusX: 6 + rng.next() * 9,
          radiusZ: 5 + rng.next() * 8,
          baseY: 4.8 + (i % 4) * 1.35,
          speed: (i % 2 === 0 ? 1 : -1) * (0.38 + rng.next() * 0.28),
          phase: (i / 12) * Math.PI * 2,
          isJelly,
        });
      }

      const bubbleGeo = bakePart(new SphereGeometry(0.18, 8, 8), 0x9efaff, 0xffffff);
      this.geometries.push(bubbleGeo);
      for (let i = 0; i < 12; i++) {
        const m = new Mesh(bubbleGeo, glowMat);
        this.root.add(m);
        this.driftMotes.push({
          mesh: m,
          centerX: 6.8,
          centerZ: 4.2,
          radius: 0.6 + rng.next() * 2.2,
          minY: 0.8,
          spanY: 8.5,
          speed: 0.16 + rng.next() * 0.1,
          phase: i / 12,
        });
      }
    } else if (kind === 'candy') {
      // Spinning Macaron & Lollipop Carousel (-7.2, +4.2) + 3-Tier Flowing Chocolate Fountain (+7.2, +4.2)!
      parts.push(
        bakePart(new CylinderGeometry(2.4, 2.7, 0.55, 18), 0xff85c0, 0xffffff, -7.2, 0.28, 4.2),
        bakePart(new ConeGeometry(2.8, 2.1, 16), 0xff5ca8, 0xffe066, -7.2, 6.0, 4.2),
        // Chocolate Fountain (+7.2, +4.2)
        bakePart(new CylinderGeometry(2.2, 2.5, 0.6, 18), 0x5c3317, 0xffd166, 7.2, 0.3, 4.2),
        bakePart(new CylinderGeometry(1.4, 1.7, 1.5, 16), 0x4a2511, 0x7c4222, 7.2, 1.25, 4.2),
        bakePart(new CylinderGeometry(0.9, 1.15, 1.4, 14), 0x4a2511, 0x8a4b28, 7.2, 2.6, 4.2),
        bakePart(new SphereGeometry(0.6, 12, 10), 0x5c3317, 0xff85c0, 7.2, 3.65, 4.2),
      );

      const carouselParts: BufferGeometry[] = [
        bakePart(new CylinderGeometry(0.26, 0.26, 5.0, 10), 0xffd700, 0xffffff, 0, 2.7, 0),
      ];
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        const mx = Math.cos(a) * 1.75;
        const mz = Math.sin(a) * 1.75;
        carouselParts.push(
          bakePart(new CylinderGeometry(0.08, 0.08, 4.5, 6), 0xffe066, 0xffffff, mx, 2.7, mz),
          bakePart(
            new CylinderGeometry(0.58, 0.58, 0.38, 14),
            k % 2 === 0 ? 0xff75c3 : 0x7ef8d8,
            0xfff0f8,
            mx,
            1.55 + (k % 2) * 0.45,
            mz,
          ),
        );
      }
      const carouselGeo = mergeParts(carouselParts);
      this.geometries.push(carouselGeo);
      const carouselMesh = new Mesh(carouselGeo, solidMat);
      carouselMesh.position.set(-7.2, 0.3, 4.2);
      this.root.add(carouselMesh);
      this.spinCenterpieces.push(carouselMesh);
    } else if (kind === 'blossom') {
      // Twin Indoor Blooming Cherry-Blossom Spirit Trees (x = ±14.5, z = -15.5) + Lotus Alcove + 16 Drifting Petals!
      for (const side of [-1, 1] as const) {
        const sx = side * 14.5;
        const sz = -15.5;
        parts.push(
          bakePart(new CylinderGeometry(0.52, 0.95, 6.8, 8), 0x59344c, 0x7d4c6b, sx, 3.4, sz),
          bakePart(
            new IcosahedronGeometry(3.6, 1),
            0xff6b9d,
            0xffe6f2,
            sx,
            8.2,
            sz,
            0,
            0,
            0,
            1.3,
            0.72,
            1.2,
          ),
          bakePart(
            new IcosahedronGeometry(2.6, 1),
            0xff9ec7,
            0xffffff,
            sx - side * 2.4,
            7.2,
            sz + 1.4,
          ),
        );
      }
      const petalGeo = bakePart(
        new OctahedronGeometry(0.22, 0),
        0xff85c0,
        0xfff0f6,
        0,
        0,
        0,
        0,
        0,
        0,
        1.3,
        0.35,
        1.0,
      );
      this.geometries.push(petalGeo);
      for (let i = 0; i < 16; i++) {
        const m = new Mesh(petalGeo, glowMat);
        this.root.add(m);
        this.driftMotes.push({
          mesh: m,
          centerX: (i % 2 === 0 ? -1 : 1) * 11,
          centerZ: -11 + (rng.next() - 0.5) * 12,
          radius: 2.5 + rng.next() * 4.5,
          minY: 0.4,
          spanY: 9.5,
          speed: 0.1 + rng.next() * 0.06,
          phase: i / 16,
        });
      }
    } else if (kind === 'starlight') {
      // Spinning Golden Planetary Orrery at (+6.8, +4.2) flanking the royal runway!
      parts.push(
        bakePart(new CylinderGeometry(2.3, 2.7, 0.65, 18), 0x2c225e, 0xffd700, 6.8, 0.32, 4.2),
        bakePart(new CylinderGeometry(0.28, 0.42, 3.2, 10), 0xd49b2a, 0xfff3b0, 6.8, 1.8, 4.2),
      );
      glowParts.push(bakePart(new SphereGeometry(0.78, 14, 12), 0xffaa00, 0xffffff, 6.8, 3.8, 4.2));

      for (let r = 0; r < 3; r++) {
        const ringParts: BufferGeometry[] = [
          bakePart(new TorusGeometry(1.7 + r * 0.88, 0.09, 6, 32), 0xffd700, 0xc792ff),
          bakePart(
            new SphereGeometry(0.32, 10, 8),
            r === 0 ? 0x38f6ff : r === 1 ? 0xff75c3 : 0xffe066,
            0xffffff,
            1.7 + r * 0.88,
            0,
            0,
          ),
        ];
        const rg = mergeParts(ringParts);
        this.geometries.push(rg);
        const rm = new Mesh(rg, glowMat);
        rm.position.set(6.8, 3.8, 4.2);
        this.root.add(rm);
        this.spinCenterpieces.push(rm);
      }
    } else if (kind === 'crystal') {
      // Levitating Spinning Ice-Prism Diamond Centerpiece at (+6.8, +4.2)
      parts.push(
        bakePart(new CylinderGeometry(2.3, 2.7, 0.55, 12), 0x1e4d7b, 0x90e0ef, 6.8, 0.28, 4.2),
      );
      const prismGeo = mergeParts([
        bakePart(
          new OctahedronGeometry(1.35, 0),
          0x38f6ff,
          0xffffff,
          0,
          0,
          0,
          0,
          0,
          0,
          0.85,
          1.65,
          0.85,
        ),
        bakePart(new TorusGeometry(2.1, 0.09, 6, 28), 0x9efaff, 0xffffff, 0, 0, 0, Math.PI / 3),
      ]);
      this.geometries.push(prismGeo);
      const pm = new Mesh(prismGeo, glowMat);
      pm.position.set(6.8, 3.6, 4.2);
      this.root.add(pm);
      this.spinCenterpieces.push(pm);
    } else if (kind === 'mushroom') {
      // Glowing Dewdrop Fountain (+6.8, +4.2) + 12 Floating Firefly Lanterns!
      parts.push(
        bakePart(new CylinderGeometry(2.4, 2.8, 0.55, 16), 0x2d6a4f, 0x95d5b2, 6.8, 0.28, 4.2),
        bakePart(
          new SphereGeometry(1.6, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.54),
          0x52b788,
          0xffd166,
          6.8,
          1.6,
          4.2,
        ),
      );
      const fireflyGeo = bakePart(new OctahedronGeometry(0.22, 0), 0x80ffdb, 0xffe066);
      this.geometries.push(fireflyGeo);
      for (let i = 0; i < 12; i++) {
        const m = new Mesh(fireflyGeo, glowMat);
        this.root.add(m);
        this.driftMotes.push({
          mesh: m,
          centerX: (rng.next() - 0.5) * 22,
          centerZ: -6 + (rng.next() - 0.5) * 20,
          radius: 1.8 + rng.next() * 3.0,
          minY: 1.2,
          spanY: 6.5,
          speed: 0.12 + rng.next() * 0.08,
          phase: i / 12,
        });
      }
    }
  }

  private buildChandeliers(pal: PalacePalette, solidMat: Material, glowMat: Material): void {
    const chMetalParts: BufferGeometry[] = [
      bakePart(new CylinderGeometry(0.1, 0.1, 3.2, 6), pal.trimGoldHex, 0xffffff, 0, 2.1, 0),
      bakePart(
        new TorusGeometry(2.4, 0.14, 6, 28),
        pal.trimGoldHex,
        0xffffff,
        0,
        0.6,
        0,
        Math.PI / 2,
      ),
      bakePart(
        new TorusGeometry(1.45, 0.12, 6, 24),
        pal.trimGoldHex,
        0xffffff,
        0,
        -0.25,
        0,
        Math.PI / 2,
      ),
    ];
    const chGlowParts: BufferGeometry[] = [
      bakePart(new OctahedronGeometry(0.55, 0), pal.chandelierCrystalHex, 0xffffff, 0, -0.95, 0),
    ];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      chGlowParts.push(
        bakePart(
          new OctahedronGeometry(0.28, 0),
          pal.chandelierCrystalHex,
          0xffffff,
          Math.cos(a) * 2.4,
          0.95,
          Math.sin(a) * 2.4,
        ),
      );
    }
    const metalGeo = mergeParts(chMetalParts);
    const crystalGeo = mergeParts(chGlowParts);
    this.geometries.push(metalGeo, crystalGeo);

    const positions: readonly [number, number, number][] = [
      [0, 11.2, -13.5],
      [-10.5, 11.2, -1.5],
      [10.5, 11.2, -1.5],
    ];
    for (const [x, y, z] of positions) {
      const grp = new Group();
      grp.position.set(x, y, z);
      grp.add(new Mesh(metalGeo, solidMat), new Mesh(crystalGeo, glowMat));
      this.root.add(grp);
      this.chandeliers.push(grp);

      const light = new PointLight(pal.lightColorHex, 1.35, 36, 1.2);
      light.position.set(x, y - 1.2, z);
      this.root.add(light);
      this.lights.push(light);
    }
  }

  private buildBoutiquePedestals(set: CastleRoyalSet, solidMat: Material): void {
    const pedBaseGeo = mergeParts([
      bakePart(new CylinderGeometry(1.85, 2.15, 0.45, 20), 0xeae2f2, 0xffffff, 0, 0.22, 0),
      bakePart(new CylinderGeometry(1.35, 1.55, 0.55, 20), set.gownGoldHex, 0xffffff, 0, 0.72, 0),
      bakePart(new TorusGeometry(1.5, 0.11, 6, 28), 0xffd700, 0xffffff, 0, 0.98, 0, Math.PI / 2),
    ]);
    const spotGeo = new CylinderGeometry(0.95, 2.25, 8.8, 18, 1, true);
    const ringGeo = new RingGeometry(2.15, 2.58, 36);
    ringGeo.rotateX(-Math.PI / 2);
    this.geometries.push(pedBaseGeo, spotGeo, ringGeo);

    const specs: readonly {
      slot: 'outfit' | 'makeup' | 'weapon';
      pos: { readonly x: number; readonly z: number };
      accentHex: number;
    }[] = [
      { slot: 'outfit', pos: INTERIOR_SPOTS.outfitPedestal, accentHex: set.gownPrimaryHex },
      { slot: 'makeup', pos: INTERIOR_SPOTS.makeupPedestal, accentHex: set.crownHex },
      { slot: 'weapon', pos: INTERIOR_SPOTS.weaponPedestal, accentHex: set.weaponPrimaryHex },
    ];

    for (const sp of specs) {
      const pedRoot = new Group();
      pedRoot.position.set(sp.pos.x, 0, sp.pos.z);
      pedRoot.add(new Mesh(pedBaseGeo, solidMat));

      const spotlightMat = new MeshBasicMaterial({
        color: sp.accentHex,
        transparent: true,
        opacity: 0.14,
        side: DoubleSide,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      const ringMat = new MeshBasicMaterial({
        color: sp.accentHex,
        transparent: true,
        opacity: 0.58,
        side: DoubleSide,
        depthWrite: false,
        fog: false,
      });
      this.materials.push(spotlightMat, ringMat);

      const spotMesh = new Mesh(spotGeo, spotlightMat);
      spotMesh.position.y = 4.6;
      const ringMesh = new Mesh(ringGeo, ringMat);
      ringMesh.position.y = 0.04;
      pedRoot.add(spotMesh, ringMesh);

      const turntable = new Group();
      const baseY = 1.25;
      turntable.position.y = baseY;

      if (sp.slot === 'outfit') {
        // 3D Royal Ballgown Mannequin: gilded stand, sweetheart corset bodice, puffed sleeves & flared multi-tier gown!
        const gownGeo = mergeParts([
          bakePart(new CylinderGeometry(0.08, 0.12, 2.6, 8), 0xffd700, 0xffffff, 0, 1.3, 0),
          bakePart(
            new ConeGeometry(1.38, 1.95, 18),
            set.gownSecondaryHex,
            set.gownPrimaryHex,
            0,
            1.15,
            0,
          ),
          bakePart(new ConeGeometry(1.12, 1.45, 16), set.gownPrimaryHex, 0xffffff, 0, 1.45, 0),
          bakePart(
            new TorusGeometry(0.46, 0.08, 6, 20),
            set.gownGoldHex,
            0xffffff,
            0,
            2.02,
            0,
            Math.PI / 2,
          ),
          bakePart(
            new CylinderGeometry(0.36, 0.28, 0.78, 14),
            set.gownPrimaryHex,
            set.gownGoldHex,
            0,
            2.42,
            0,
          ),
          bakePart(
            new SphereGeometry(0.24, 10, 10),
            set.gownSecondaryHex,
            0xffffff,
            -0.44,
            2.68,
            0,
          ),
          bakePart(new SphereGeometry(0.24, 10, 10), set.gownSecondaryHex, 0xffffff, 0.44, 2.68, 0),
        ]);
        this.geometries.push(gownGeo);
        turntable.add(new Mesh(gownGeo, solidMat));
      } else if (sp.slot === 'makeup') {
        // Tufted velvet cushion + Sculpted 3D Royal Crown + floating lipstick & jewel compact!
        const cushionGeo = mergeParts([
          bakePart(new BoxGeometry(1.45, 0.36, 1.45), set.gownPrimaryHex, 0xffffff, 0, 0.2, 0),
          // Floating golden lipstick tube
          bakePart(
            new CylinderGeometry(0.14, 0.14, 0.55, 10),
            0xffd700,
            0xfff5c0,
            -0.92,
            0.95,
            0.2,
            0,
            0,
            0.24,
          ),
          bakePart(
            new ConeGeometry(0.13, 0.32, 10),
            set.lipHex,
            0xffb3c6,
            -1.0,
            1.35,
            0.2,
            0,
            0,
            0.24,
          ),
          // Floating jewel powder compact
          bakePart(
            new CylinderGeometry(0.34, 0.34, 0.12, 14),
            set.crownHex,
            set.blushHex,
            0.92,
            0.95,
            0.2,
            0.35,
            0,
            -0.2,
          ),
        ]);
        this.geometries.push(cushionGeo);
        turntable.add(new Mesh(cushionGeo, solidMat));

        const crownAsset = buildRoyalCrownMesh(set.crownHex, set.crownGemHex);
        this.cosmeticAssets.push(crownAsset);
        crownAsset.group.position.set(0, 0.55, 0);
        crownAsset.group.scale.setScalar(3.1);
        turntable.add(crownAsset.group);
      } else {
        // Levitating 3D Signature Weapon!
        const weaponAsset = buildSignatureWeaponMesh(
          set.weaponKind,
          set.weaponPrimaryHex,
          set.weaponAccentHex,
        );
        this.cosmeticAssets.push(weaponAsset);
        weaponAsset.group.position.set(0, 1.05, 0);
        weaponAsset.group.scale.setScalar(2.15);
        turntable.add(weaponAsset.group);
      }

      pedRoot.add(turntable);
      this.root.add(pedRoot);
      this.pedestals.push({
        slot: sp.slot,
        turntable,
        spotlightMat,
        ringMat,
        baseY,
      });
    }
  }
}
