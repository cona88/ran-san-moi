/**
 * Procedural multi-part vertex-colored 3D biome prop archetypes (`16+` distinct
 * flora, rock, structure, ground-cover, and rolling-hillock geometries).
 *
 * Purely deterministic (zero `Math.random()`), non-indexed `{ position, normal, color }`
 * merged `BufferGeometry` for zero-overhead GPU `InstancedMesh` batching, with baked
 * subtle dark contact-shadow ground skirts at `y = -0.485` so every prop sits firmly
 * grounded on the `Y = -0.5` kingdom terrain.
 */
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Euler,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Matrix4,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type BiomePropKind =
  | 'broadleaf_oak'
  | 'royal_cypress'
  | 'rainforest_buttress_tree'
  | 'mossy_log_mushrooms'
  | 'rainforest_fern'
  | 'weeping_sakura'
  | 'bamboo_grove'
  | 'stone_lantern'
  | 'snow_spruce'
  | 'glacial_crag'
  | 'coconut_palm'
  | 'coastal_coral_rock'
  | 'orchard_tree'
  | 'candy_orchard_spire'
  | 'windswept_pine'
  | 'celestial_monolith'
  | 'rock_outcrop'
  | 'grass_wildflower_tuft'
  | 'river_reed_tuft'
  | 'rolling_hillock';

export interface BiomePropArchetype {
  readonly kind: BiomePropKind;
  readonly geometry: BufferGeometry;
  readonly isCrystalline: boolean;
  readonly baseHeight: number;
}

const M4_SCRATCH = new Matrix4();
const POS_SCRATCH = new Vector3();
const SCALE_SCRATCH = new Vector3();
const EULER_SCRATCH = new Euler();
const QUAT_SCRATCH = new Quaternion();
const COL_BOT = new Color();
const COL_TOP = new Color();
const COL_TMP = new Color();

/**
 * Convert any primitive BufferGeometry into a non-indexed geometry with `{ position, normal, color }`
 * attributes and vertical two-tone gradient, immediately disposing `rawGeo`.
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

  COL_BOT.setHex(bottomHex);
  COL_TOP.setHex(topHex);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) / spanY;
    COL_TMP.copy(COL_BOT).lerp(COL_TOP, t);
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

  geo.computeVertexNormals();
  return geo;
}

/**
 * Deterministically sculpt a primitive's vertices using smooth multi-frequency trig waves
 * before baking it so boulders, hillocks, and tree foliage look organic rather than geometric.
 */
function sculptOrganic(
  rawGeo: BufferGeometry,
  amp: number,
  freqX: number,
  freqY: number,
  freqZ: number,
  phase = 0,
  flattenBottomY?: number,
): BufferGeometry {
  const pos = rawGeo.attributes['position']!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const wave =
      Math.sin(x * freqX + phase) * Math.cos(z * freqZ - phase * 0.7) * 0.6 +
      Math.sin((x + z) * freqY + y * freqY + phase * 1.3) * 0.4;
    const scale = 1 + amp * wave;
    let ny = y * scale;
    if (flattenBottomY !== undefined && ny < flattenBottomY) {
      ny = flattenBottomY;
    }
    pos.setXYZ(i, x * scale, ny, z * scale);
  }
  pos.needsUpdate = true;
  rawGeo.computeVertexNormals();
  return rawGeo;
}

function mergeParts(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged ?? new BoxGeometry(0.1, 0.1, 0.1);
}

/** Subtle dark contact-shadow ground skirt centered at `y = -0.485` (just above `Y = -0.5`). */
function groundSkirt(
  radius: number,
  innerHex = 0x162218,
  outerHex = 0x223024,
  segs = 10,
): BufferGeometry {
  return bakePart(
    new CylinderGeometry(radius * 0.62, radius, 0.032, segs),
    outerHex,
    innerHex,
    0,
    -0.485,
    0,
  );
}

/** Build a curved tapered tree branch/trunk segment between `(x0,y0,z0)` and `(x1,y1,z1)`. */
function limbSegment(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  rBot: number,
  rTop: number,
  botHex: number,
  topHex: number,
  segs = 7,
): BufferGeometry {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const len = Math.max(0.05, Math.hypot(dx, dy, dz));
  const mx = (x0 + x1) * 0.5;
  const my = (y0 + y1) * 0.5;
  const mz = (z0 + z1) * 0.5;

  const dir = new Vector3(dx, dy, dz).normalize();
  const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
  const euler = new Euler().setFromQuaternion(quat);

  return bakePart(
    new CylinderGeometry(rTop, rBot, len, segs),
    botHex,
    topHex,
    mx,
    my,
    mz,
    euler.x,
    euler.y,
    euler.z,
  );
}

// ---------------------------------------------------------------------------
// 20 Realistic Multi-Part Biome Prop Archetypes
// ---------------------------------------------------------------------------

/** 0. Sunny Temperate Royal Broadleaf Oak (~13.5u tall). */
function buildBroadleafOak(): BufferGeometry {
  const parts: BufferGeometry[] = [groundSkirt(2.4, 0x1a2618, 0x2b3b24, 12)];

  // Exposed flared root buttresses dipping slightly below -0.5 for solid grounding
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.35;
    parts.push(
      limbSegment(
        Math.cos(a) * 1.25,
        -0.55,
        Math.sin(a) * 1.25,
        Math.cos(a) * 0.3,
        1.15,
        Math.sin(a) * 0.3,
        0.38,
        0.24,
        0x3b2616,
        0x593a22,
        6,
      ),
    );
  }

  // Main gnarled oak trunk
  parts.push(
    limbSegment(0, -0.55, 0, 0.12, 3.2, -0.08, 0.78, 0.56, 0x452d1a, 0x6b472b, 8),
    limbSegment(0.12, 3.1, -0.08, 0.0, 5.4, 0.05, 0.56, 0.4, 0x5c3c24, 0x785132, 7),
  );

  // 4 spreading primary boughs + layered broadleaf foliage puffs
  const boughs: readonly { x: number; y: number; z: number; r: number; c1: number; c2: number }[] =
    [
      { x: 2.35, y: 7.4, z: 1.0, r: 2.75, c1: 0x266d32, c2: 0x6fb848 },
      { x: -2.25, y: 7.1, z: 1.35, r: 2.65, c1: 0x20612d, c2: 0x63ad42 },
      { x: 1.1, y: 7.8, z: -2.35, r: 2.55, c1: 0x297536, c2: 0x7ac450 },
      { x: -1.45, y: 8.2, z: -1.85, r: 2.6, c1: 0x246b32, c2: 0x6cb546 },
    ];
  for (let i = 0; i < boughs.length; i++) {
    const b = boughs[i]!;
    parts.push(
      limbSegment(
        0.05,
        4.7,
        0.0,
        b.x * 0.85,
        b.y - 0.8,
        b.z * 0.85,
        0.3,
        0.16,
        0x5c3c24,
        0x7a5436,
        6,
      ),
      bakePart(
        sculptOrganic(new IcosahedronGeometry(b.r, 1), 0.12, 1.4, 1.3, 1.5, i * 1.4),
        b.c1,
        b.c2,
        b.x,
        b.y + 0.35,
        b.z,
        0,
        i * 0.8,
        0,
        1.25,
        0.74,
        1.18,
      ),
      bakePart(
        sculptOrganic(new IcosahedronGeometry(b.r * 0.72, 1), 0.12, 1.6, 1.4, 1.6, i * 2.1),
        b.c1,
        0x8fd65c,
        b.x * 1.22,
        b.y + 1.2,
        b.z * 1.18,
        0,
        i * 1.1,
        0,
        1.18,
        0.7,
        1.12,
      ),
    );
  }

  // Sunlit upper crown billows
  parts.push(
    bakePart(
      sculptOrganic(new IcosahedronGeometry(3.15, 1), 0.12, 1.2, 1.3, 1.2, 0.5),
      0x297838,
      0x88cf58,
      0.1,
      9.6,
      -0.1,
      0,
      0.4,
      0,
      1.26,
      0.76,
      1.22,
    ),
    bakePart(
      sculptOrganic(new IcosahedronGeometry(2.35, 1), 0.13, 1.5, 1.5, 1.4, 2.2),
      0x378c44,
      0xa6e36b,
      -0.35,
      11.3,
      0.25,
      0,
      1.2,
      0,
      1.2,
      0.72,
      1.16,
    ),
  );

  return mergeParts(parts);
}

/** 1. Slender Royal Cypress (~14.5u tall). */
function buildRoyalCypress(): BufferGeometry {
  const parts: BufferGeometry[] = [
    groundSkirt(1.35, 0x162218, 0x253624, 10),
    bakePart(new CylinderGeometry(0.24, 0.42, 4.0, 7), 0x452d1d, 0x6b472d, 0, 1.45, 0),
  ];

  const tiers: readonly { y: number; r: number; sy: number; ox: number; oz: number }[] = [
    { y: 3.1, r: 1.55, sy: 1.35, ox: 0.06, oz: -0.04 },
    { y: 4.9, r: 1.5, sy: 1.42, ox: -0.08, oz: 0.06 },
    { y: 6.8, r: 1.36, sy: 1.48, ox: 0.05, oz: 0.07 },
    { y: 8.7, r: 1.15, sy: 1.55, ox: -0.05, oz: -0.06 },
    { y: 10.6, r: 0.9, sy: 1.65, ox: 0.03, oz: 0.02 },
    { y: 12.5, r: 0.56, sy: 1.8, ox: 0, oz: 0 },
  ];
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i]!;
    parts.push(
      bakePart(
        sculptOrganic(new IcosahedronGeometry(t.r, 1), 0.14, 1.9, 1.5, 1.9, i * 1.15),
        0x17482d,
        0x3e884f,
        t.ox,
        t.y,
        t.oz,
        0,
        i * 0.9,
        0,
        1.0,
        t.sy,
        1.0,
      ),
    );
  }
  parts.push(bakePart(new ConeGeometry(0.45, 2.2, 7), 0x25663e, 0x58a862, 0, 13.9, 0));

  return mergeParts(parts);
}

/** 2. Gnarled Buttress-Root Ancient Rainforest Tree with Hanging Vines (~16u tall). */
function buildRainforestButtressTree(): BufferGeometry {
  const parts: BufferGeometry[] = [groundSkirt(2.8, 0x102016, 0x1b3322, 12)];

  // 5 dramatic flaring buttress root fins
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.2;
    parts.push(
      limbSegment(
        Math.cos(a) * 2.05,
        -0.55,
        Math.sin(a) * 2.05,
        Math.cos(a) * 0.45,
        2.5,
        Math.sin(a) * 0.45,
        0.48,
        0.26,
        0x332215,
        0x4c5429,
        6,
      ),
    );
  }

  // Gnarled mossy rainforest trunk
  parts.push(
    limbSegment(0, -0.55, 0, -0.25, 4.2, 0.18, 0.95, 0.68, 0x3b2718, 0x525229, 8),
    limbSegment(-0.25, 4.1, 0.18, 0.15, 8.2, -0.1, 0.68, 0.46, 0x4b3b24, 0x5a6b32, 8),
  );

  // 5 spreading boughs + humid emerald umbrella canopy pads + hanging vines
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const reach = 3.2 + (i % 2) * 0.65;
    const bx = Math.cos(a) * reach;
    const bz = Math.sin(a) * reach;
    const by = 9.8 + (i % 3) * 0.85;

    parts.push(
      limbSegment(
        0.1,
        7.6,
        -0.05,
        bx * 0.82,
        by - 0.6,
        bz * 0.82,
        0.34,
        0.18,
        0x4c3a23,
        0x5b6a30,
        6,
      ),
      bakePart(
        sculptOrganic(new IcosahedronGeometry(3.0, 1), 0.13, 1.3, 1.4, 1.3, i * 1.3),
        0x11522f,
        0x3ea659,
        bx,
        by + 0.5,
        bz,
        0,
        a,
        0,
        1.38,
        0.58,
        1.28,
      ),
    );

    // Hanging moss/vine tendrils draping from outer limbs
    const vx = bx * 1.12;
    const vz = bz * 1.12;
    const vineLen = 4.2 + (i % 3) * 1.25;
    parts.push(
      bakePart(
        new CylinderGeometry(0.075, 0.03, vineLen, 5),
        0x2e8246,
        0x6cd16e,
        vx,
        by - vineLen * 0.5 + 0.2,
        vz,
      ),
      bakePart(
        new CylinderGeometry(0.055, 0.02, vineLen * 0.72, 5),
        0x266e3c,
        0x5ec264,
        vx * 0.78 + Math.sin(a) * 0.7,
        by - vineLen * 0.34,
        vz * 0.78 - Math.cos(a) * 0.7,
      ),
    );
  }

  // Broad upper emergent rainforest crown
  parts.push(
    bakePart(
      sculptOrganic(new IcosahedronGeometry(3.6, 1), 0.12, 1.1, 1.4, 1.1, 0.7),
      0x146138,
      0x4eb865,
      0,
      12.4,
      0,
      0,
      0.5,
      0,
      1.42,
      0.6,
      1.36,
    ),
    bakePart(
      sculptOrganic(new IcosahedronGeometry(2.5, 1), 0.13, 1.4, 1.4, 1.4, 2.0),
      0x1d7544,
      0x74d678,
      0.5,
      14.2,
      -0.35,
      0,
      1.1,
      0,
      1.3,
      0.56,
      1.24,
    ),
  );

  return mergeParts(parts);
}

/** 3. Layered Forest Mushroom Cluster on Mossy Nurse-Log (~4.5u tall). */
function buildMossyLogMushrooms(): BufferGeometry {
  const parts: BufferGeometry[] = [groundSkirt(2.3, 0x111f16, 0x1e3222, 10)];

  // Fallen mossy nurse-log resting into ground
  parts.push(
    bakePart(
      sculptOrganic(new CylinderGeometry(0.62, 0.76, 4.2, 8), 0.09, 1.8, 1.5, 1.8, 0.4),
      0x3d2616,
      0x4f7836,
      0,
      -0.05,
      0,
      0.06,
      0.32,
      Math.PI * 0.48,
    ),
    // Soft moss cushions hugging the log
    bakePart(
      sculptOrganic(new IcosahedronGeometry(0.72, 1), 0.15, 2.0, 1.6, 2.0, 1.1, -0.45),
      0x265e32,
      0x68bf54,
      -1.15,
      -0.25,
      0.42,
      0,
      0,
      0,
      1.3,
      0.55,
      1.1,
    ),
    bakePart(
      sculptOrganic(new IcosahedronGeometry(0.65, 1), 0.15, 2.0, 1.6, 2.0, 2.3, -0.45),
      0x265e32,
      0x68bf54,
      1.1,
      -0.28,
      -0.35,
      0,
      0,
      0,
      1.25,
      0.5,
      1.05,
    ),
  );

  // 4 layered forest mushrooms (varied heights & colors: crimson/amber/bioluminescent teal)
  const mushSpecs: readonly {
    x: number;
    yBase: number;
    z: number;
    h: number;
    capR: number;
    tiltZ: number;
    capBot: number;
    capTop: number;
  }[] = [
    {
      x: -0.35,
      yBase: 0.2,
      z: 0.1,
      h: 2.5,
      capR: 1.45,
      tiltZ: 0.08,
      capBot: 0xb82e5c,
      capTop: 0xff8fbd,
    },
    {
      x: 0.85,
      yBase: 0.05,
      z: 0.38,
      h: 1.75,
      capR: 1.05,
      tiltZ: -0.15,
      capBot: 0xc86428,
      capTop: 0xffc66e,
    },
    {
      x: -1.1,
      yBase: -0.35,
      z: -0.55,
      h: 1.5,
      capR: 0.85,
      tiltZ: 0.18,
      capBot: 0x2aa89e,
      capTop: 0x9efcf2,
    },
    {
      x: 0.25,
      yBase: -0.35,
      z: -0.78,
      h: 1.15,
      capR: 0.65,
      tiltZ: -0.1,
      capBot: 0x7c4ad6,
      capTop: 0xe6b8ff,
    },
  ];
  for (const m of mushSpecs) {
    parts.push(
      bakePart(
        new CylinderGeometry(m.capR * 0.17, m.capR * 0.24, m.h, 7),
        0xd9cbb8,
        0xfff7ec,
        m.x,
        m.yBase + m.h * 0.5,
        m.z,
        0,
        0,
        m.tiltZ,
      ),
      bakePart(
        new SphereGeometry(m.capR, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.54),
        m.capBot,
        m.capTop,
        m.x - Math.sin(m.tiltZ) * m.h * 0.5,
        m.yBase + m.h,
        m.z,
        0,
        0,
        m.tiltZ,
        1.0,
        0.58,
        1.0,
      ),
    );
  }

  // Shelf bracket fungi along the log flank
  for (let b = 0; b < 3; b++) {
    parts.push(
      bakePart(
        new CylinderGeometry(0.36 - b * 0.06, 0.16, 0.1, 7, 1, false, 0, Math.PI),
        0xc47b3b,
        0xf7d8a8,
        -0.5 + b * 0.55,
        0.15 + (b % 2) * 0.18,
        0.62,
        0,
        0.2,
        0,
      ),
    );
  }

  return mergeParts(parts);
}

/** 4. Dense Rainforest Fern Cluster (~2.4u tall). */
function buildRainforestFern(): BufferGeometry {
  const parts: BufferGeometry[] = [groundSkirt(1.35, 0x112015, 0x1d3322, 8)];

  // Rosette center base
  parts.push(bakePart(new CylinderGeometry(0.28, 0.42, 0.35, 6), 0x224a28, 0x3b7a40, 0, -0.38, 0));

  // Outer sweeping fronds (6) + inner upright fronds (4)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    parts.push(
      bakePart(
        new ConeGeometry(0.42, 1.9, 4),
        0x1b6636,
        0x52bd5e,
        ca * 0.72,
        0.15,
        sa * 0.72,
        sa * 1.05,
        0,
        -ca * 1.05,
        1.15,
        1.0,
        0.35,
      ),
    );
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.39;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    parts.push(
      bakePart(
        new ConeGeometry(0.34, 1.55, 4),
        0x278044,
        0x7ee67a,
        ca * 0.4,
        0.48,
        sa * 0.4,
        sa * 0.56,
        0,
        -ca * 0.56,
        1.1,
        1.0,
        0.32,
      ),
    );
  }

  return mergeParts(parts);
}

/** 5. Dark-Bark Weeping Sakura Cherry Tree (~12.5u tall). */
function buildWeepingSakura(): BufferGeometry {
  const parts: BufferGeometry[] = [groundSkirt(2.3, 0x241a24, 0x382838, 12)];

  // Dark plum-brown crooked sakura trunk + root flare
  parts.push(
    limbSegment(0, -0.55, 0, 0.35, 2.8, -0.2, 0.76, 0.5, 0x2c1923, 0x472a39, 8),
    limbSegment(0.35, 2.7, -0.2, -0.15, 5.1, 0.15, 0.5, 0.35, 0x3b222e, 0x593647, 7),
  );

  // 3 graceful curving boughs + cascading blossom clouds + weeping tendrils
  const boughs: readonly { x: number; y: number; z: number; r: number }[] = [
    { x: 2.3, y: 7.1, z: 1.15, r: 2.65 },
    { x: -2.4, y: 6.8, z: 0.7, r: 2.55 },
    { x: 0.3, y: 7.5, z: -2.25, r: 2.6 },
  ];
  for (let i = 0; i < boughs.length; i++) {
    const b = boughs[i]!;
    parts.push(
      limbSegment(
        -0.08,
        4.4,
        0.08,
        b.x * 0.85,
        b.y - 0.8,
        b.z * 0.85,
        0.28,
        0.14,
        0x3b222e,
        0x5c384a,
        6,
      ),
      bakePart(
        sculptOrganic(new IcosahedronGeometry(b.r, 1), 0.12, 1.4, 1.4, 1.4, i * 1.5),
        0xed5e9b,
        0xffd9eb,
        b.x,
        b.y + 0.3,
        b.z,
        0,
        i * 0.9,
        0,
        1.32,
        0.72,
        1.25,
      ),
    );
  }

  // Crown blossoms
  parts.push(
    bakePart(
      sculptOrganic(new IcosahedronGeometry(3.2, 1), 0.12, 1.2, 1.3, 1.2, 0.8),
      0xf574ad,
      0xffe8f3,
      0,
      9.2,
      0,
      0,
      0.3,
      0,
      1.32,
      0.74,
      1.26,
    ),
    bakePart(
      sculptOrganic(new IcosahedronGeometry(2.2, 1), 0.12, 1.5, 1.5, 1.5, 2.0),
      0xff94c2,
      0xffffff,
      -0.4,
      10.8,
      0.3,
      0,
      1.0,
      0,
      1.24,
      0.7,
      1.18,
    ),
  );

  // 8 delicate weeping sakura blossom curtains draping around the outer crown
  for (let w = 0; w < 8; w++) {
    const a = (w / 8) * Math.PI * 2 + 0.22;
    const rad = 2.75 + (w % 2) * 0.55;
    const dropH = 2.8 + (w % 3) * 0.65;
    parts.push(
      bakePart(
        new ConeGeometry(0.48, dropH, 5),
        0xffa6cf,
        0xf26ca6,
        Math.cos(a) * rad,
        6.1 - dropH * 0.32,
        Math.sin(a) * rad,
        Math.PI,
        a,
        0,
        1.0,
        1.0,
        0.65,
      ),
    );
  }

  return mergeParts(parts);
}

/** 6. Bamboo Grove Cluster (~10.5u tall). */
function buildBambooGrove(): BufferGeometry {
  const parts: BufferGeometry[] = [groundSkirt(1.75, 0x182418, 0x263824, 10)];

  const culms: readonly { x: number; z: number; h: number; rx: number; rz: number }[] = [
    { x: 0.0, z: 0.0, h: 10.2, rx: 0.03, rz: -0.02 },
    { x: -0.78, z: 0.48, h: 8.8, rx: 0.06, rz: 0.05 },
    { x: 0.82, z: 0.36, h: 9.4, rx: -0.05, rz: -0.07 },
    { x: -0.45, z: -0.75, h: 7.6, rx: -0.06, rz: 0.04 },
    { x: 0.6, z: -0.68, h: 8.1, rx: 0.04, rz: -0.06 },
    { x: 0.18, z: 0.85, h: 6.8, rx: 0.08, rz: 0.02 },
  ];

  for (let c = 0; c < culms.length; c++) {
    const cm = culms[c]!;
    const segs = 4;
    const segH = (cm.h + 0.05) / segs;
    for (let s = 0; s < segs; s++) {
      const y = -0.55 + (s + 0.5) * segH;
      const ox = cm.x + Math.sin(cm.rz) * y * -0.5;
      const oz = cm.z + Math.sin(cm.rx) * y * 0.5;
      const r = 0.21 - s * 0.022;
      parts.push(
        bakePart(
          new CylinderGeometry(r * 0.92, r, segH * 0.94, 6),
          0x3c7d36,
          0x86c95d,
          ox,
          y,
          oz,
          cm.rx,
          0,
          cm.rz,
        ),
        // Node ring
        bakePart(
          new CylinderGeometry(r * 1.15, r * 1.15, 0.08, 6),
          0x2d5e28,
          0x639e42,
          ox,
          y + segH * 0.46,
          oz,
          cm.rx,
          0,
          cm.rz,
        ),
      );
    }

    // Wispy upper bamboo leaf sprays
    const topY = cm.h - 1.1;
    const topX = cm.x + Math.sin(cm.rz) * topY * -0.5;
    const topZ = cm.z + Math.sin(cm.rx) * topY * 0.5;
    for (let l = 0; l < 3; l++) {
      const la = (c * 1.3 + l * 2.1) % (Math.PI * 2);
      parts.push(
        bakePart(
          new ConeGeometry(0.46, 1.9, 4),
          0x489c3e,
          0xa6e374,
          topX + Math.cos(la) * 0.65,
          topY + l * 0.45,
          topZ + Math.sin(la) * 0.65,
          Math.sin(la) * 0.95,
          0,
          -Math.cos(la) * 0.95,
          1.1,
          1.0,
          0.35,
        ),
      );
    }
  }

  return mergeParts(parts);
}

/** 7. Mossy Japanese Stone Lantern (`Toro`) with Warm Glowing Core (~4.2u tall). */
function buildStoneLantern(): BufferGeometry {
  const parts: BufferGeometry[] = [
    groundSkirt(1.15, 0x1b241d, 0x2c382c, 8),
    // Base pedestal (kiso)
    bakePart(new CylinderGeometry(0.68, 0.88, 0.55, 6), 0x4d5e4c, 0x7d8a7e, 0, -0.28, 0),
    // Carved stone post (sao)
    bakePart(new CylinderGeometry(0.28, 0.36, 1.55, 6), 0x5c6b5a, 0x8d998e, 0, 0.72, 0),
    // Middle platform (chudai)
    bakePart(new CylinderGeometry(0.76, 0.48, 0.34, 6), 0x677566, 0x9aa69b, 0, 1.66, 0),
    // Warm glowing firebox core (hibukuro light)
    bakePart(new OctahedronGeometry(0.38, 0), 0xff9e2c, 0xfff5b8, 0, 2.22, 0),
  ];

  // 4 carved corner lattice posts around the glowing core
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
    parts.push(
      bakePart(
        new BoxGeometry(0.14, 0.78, 0.14),
        0x677566,
        0x93a194,
        Math.cos(a) * 0.44,
        2.22,
        Math.sin(a) * 0.44,
      ),
    );
  }

  // Curved mossy pagoda roof (kasa) + lotus finial (hoju)
  parts.push(
    bakePart(new ConeGeometry(1.18, 0.72, 6), 0x4c6e46, 0x92a392, 0, 2.95, 0),
    bakePart(new SphereGeometry(0.24, 6, 5), 0x7e8c7f, 0xc2cfc3, 0, 3.38, 0),
    bakePart(new ConeGeometry(0.18, 0.35, 6), 0x879688, 0xd4e0d5, 0, 3.64, 0),
  );

  return mergeParts(parts);
}

/** 8. Snow-Laden Alpine Spruce / Fir (~15u tall). */
function buildSnowSpruce(): BufferGeometry {
  const parts: BufferGeometry[] = [
    groundSkirt(2.2, 0x1c2530, 0x33404f, 10),
    // Weathered dark conifer trunk
    bakePart(new CylinderGeometry(0.3, 0.72, 4.5, 7), 0x3b271c, 0x5c3e2e, 0, 1.7, 0),
  ];

  // 5 multi-tiered evergreen bough skirts + thick snow caps resting on each tier
  const tiers: readonly { y: number; r: number; h: number }[] = [
    { y: 3.9, r: 3.1, h: 3.2 },
    { y: 6.2, r: 2.65, h: 3.0 },
    { y: 8.4, r: 2.15, h: 2.75 },
    { y: 10.5, r: 1.62, h: 2.45 },
    { y: 12.5, r: 1.05, h: 2.2 },
  ];
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i]!;
    // Dark pine foliage underside
    parts.push(
      bakePart(new ConeGeometry(t.r, t.h, 8), 0x14382f, 0x275e4e, 0, t.y, 0, 0, i * 0.42, 0),
      // Thick crisp snow blanket perched on the upper slope of each tier
      bakePart(
        new ConeGeometry(t.r * 0.88, t.h * 0.72, 8),
        0xcbe6ff,
        0xffffff,
        0,
        t.y + t.h * 0.2,
        0,
        0,
        i * 0.42,
        0,
      ),
    );
  }
  parts.push(bakePart(new ConeGeometry(0.55, 1.5, 7), 0xdbf0ff, 0xffffff, 0, 14.3, 0));

  return mergeParts(parts);
}

/** 9. Frost-Crusted Granite Crags & Glacial Ice Spire Cluster (~11.5u tall). */
function buildGlacialCrag(): BufferGeometry {
  const parts: BufferGeometry[] = [groundSkirt(2.5, 0x1b2738, 0x334761, 10)];

  // Frost-crusted granite base crags
  parts.push(
    bakePart(
      sculptOrganic(new DodecahedronGeometry(1.85, 0), 0.16, 1.5, 1.2, 1.5, 0.3, -0.52),
      0x3d4b63,
      0x869cb8,
      -0.8,
      0.3,
      0.5,
      0.1,
      0.4,
      0.15,
      1.25,
      0.75,
      1.1,
    ),
    bakePart(
      sculptOrganic(new DodecahedronGeometry(1.55, 0), 0.16, 1.6, 1.4, 1.6, 1.7, -0.52),
      0x43526b,
      0x99b0cc,
      1.05,
      0.15,
      -0.55,
      -0.1,
      1.1,
      -0.12,
      1.18,
      0.7,
      1.05,
    ),
    // Wind-packed snow drift shelf
    bakePart(
      sculptOrganic(new IcosahedronGeometry(1.4, 1), 0.14, 1.4, 1.6, 1.4, 0.9, -0.52),
      0xc7e6ff,
      0xffffff,
      0.35,
      0.1,
      0.85,
      0,
      0,
      0,
      1.4,
      0.52,
      1.15,
    ),
  );

  // 4 faceted glacial ice spires thrusting upward
  const spires: readonly { x: number; z: number; r: number; h: number; rx: number; rz: number }[] =
    [
      { x: 0.0, z: 0.0, r: 1.32, h: 11.0, rx: 0.04, rz: -0.05 },
      { x: -1.15, z: 0.45, r: 0.92, h: 7.4, rx: 0.14, rz: 0.24 },
      { x: 1.1, z: -0.4, r: 0.85, h: 6.6, rx: -0.1, rz: -0.26 },
      { x: 0.35, z: 0.95, r: 0.68, h: 4.8, rx: 0.24, rz: -0.1 },
    ];
  for (const sp of spires) {
    parts.push(
      bakePart(
        new ConeGeometry(sp.r, sp.h, 6),
        0x3eaee6,
        0xeafbff,
        sp.x,
        sp.h * 0.46 - 0.1,
        sp.z,
        sp.rx,
        0.3,
        sp.rz,
      ),
    );
  }

  return mergeParts(parts);
}

/** 10. Curved Tropical Coconut Palm with Radiating Fronds & Coconuts (~13u tall). */
function buildCoconutPalm(): BufferGeometry {
  const parts: BufferGeometry[] = [groundSkirt(1.65, 0x3b3222, 0x5c4f38, 10)];

  // Smoothly curved 6-segment ringed coconut trunk
  const pts: readonly [number, number, number, number][] = [
    [0.0, -0.55, 0.0, 0.48],
    [0.32, 1.5, 0.12, 0.42],
    [0.85, 3.6, 0.28, 0.36],
    [1.48, 5.7, 0.42, 0.31],
    [1.98, 7.8, 0.5, 0.26],
    [2.22, 9.6, 0.52, 0.22],
  ];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i]!;
    const p1 = pts[i + 1]!;
    parts.push(
      limbSegment(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p0[3], p1[3], 0x6e4e35, 0x997050, 7),
    );
  }

  const cx = 2.22;
  const cy = 9.65;
  const cz = 0.52;

  // 3 brown coconuts tucked beneath the palm crown
  for (let c = 0; c < 3; c++) {
    const a = (c / 3) * Math.PI * 2 + 0.4;
    parts.push(
      bakePart(
        new SphereGeometry(0.34, 7, 6),
        0x472a15,
        0x784a28,
        cx + Math.cos(a) * 0.42,
        cy - 0.35,
        cz + Math.sin(a) * 0.42,
      ),
    );
  }

  // 7 radiating arched tropical palm fronds (each built with inner rise + drooping tip)
  for (let f = 0; f < 7; f++) {
    const a = (f / 7) * Math.PI * 2 + 0.15;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const p1x = cx + ca * 2.1;
    const p1y = cy + 0.85 + (f % 2) * 0.25;
    const p1z = cz + sa * 2.1;
    const p2x = cx + ca * 4.35;
    const p2y = cy - 0.65 + (f % 2) * 0.2;
    const p2z = cz + sa * 4.35;

    parts.push(
      // Inner rising frond arch
      bakePart(
        new BoxGeometry(0.82, 0.12, 2.35),
        0x1d7533,
        0x56ba48,
        (cx + p1x) * 0.5,
        (cy + p1y) * 0.5,
        (cz + p1z) * 0.5,
        -0.38,
        -a + Math.PI * 0.5,
        0,
      ),
      // Outer drooping frond blade tapering toward tip
      bakePart(
        new ConeGeometry(0.46, 2.65, 4),
        0x2e8f3c,
        0x8be05a,
        (p1x + p2x) * 0.5,
        (p1y + p2y) * 0.5,
        (p1z + p2z) * 0.5,
        Math.PI * 0.5 + 0.52,
        -a + Math.PI * 0.5,
        0,
        1.25,
        1.0,
        0.22,
      ),
    );
  }

  return mergeParts(parts);
}

/** 11. Weathered Coastal Sea-Rocks & Coral Reef Mound (~4.5u tall). */
function buildCoastalCoralRock(): BufferGeometry {
  const parts: BufferGeometry[] = [groundSkirt(2.2, 0x263838, 0x3b5454, 10)];

  // Weathered coastal sea-rocks
  parts.push(
    bakePart(
      sculptOrganic(new DodecahedronGeometry(1.5, 0), 0.15, 1.5, 1.3, 1.5, 0.5, -0.52),
      0x5e5c55,
      0xbab096,
      -0.55,
      0.15,
      0.2,
      0,
      0.3,
      0,
      1.25,
      0.72,
      1.12,
    ),
    bakePart(
      sculptOrganic(new DodecahedronGeometry(1.15, 0), 0.15, 1.6, 1.4, 1.6, 2.1, -0.52),
      0x57564f,
      0xad9f84,
      0.95,
      0.0,
      -0.45,
      0,
      1.1,
      0,
      1.15,
      0.65,
      1.05,
    ),
    // Golden-amber brain coral mound
    bakePart(
      sculptOrganic(new IcosahedronGeometry(0.75, 1), 0.1, 3.0, 3.0, 3.0, 0.7, -0.45),
      0xd47438,
      0xffcf7d,
      0.45,
      0.15,
      0.85,
      0,
      0,
      0,
      1.15,
      0.72,
      1.1,
    ),
  );

  // Branching staghorn & turquoise tube coral formations
  const branches: readonly {
    x: number;
    y: number;
    z: number;
    h: number;
    rx: number;
    rz: number;
    c1: number;
    c2: number;
  }[] = [
    { x: -0.4, y: 1.5, z: 0.15, h: 2.6, rx: 0.1, rz: 0.22, c1: 0xe64572, c2: 0xffb3c8 },
    { x: -0.95, y: 1.3, z: 0.45, h: 2.0, rx: 0.18, rz: 0.42, c1: 0xe64572, c2: 0xffc7d8 },
    { x: 0.9, y: 1.25, z: -0.3, h: 2.35, rx: -0.14, rz: -0.25, c1: 0x0ea8a0, c2: 0x9cfcf0 },
    { x: 1.35, y: 1.0, z: -0.05, h: 1.7, rx: 0.08, rz: -0.42, c1: 0x0ea8a0, c2: 0xb8fff6 },
  ];
  for (const br of branches) {
    parts.push(
      bakePart(
        new CylinderGeometry(0.16, 0.28, br.h, 6),
        br.c1,
        br.c2,
        br.x,
        br.y,
        br.z,
        br.rx,
        0,
        br.rz,
      ),
    );
  }
  // Glowing sea-pearl nested on rock shelf
  parts.push(bakePart(new SphereGeometry(0.36, 8, 7), 0xffeef8, 0xffffff, 0.1, 0.65, 0.45));

  return mergeParts(parts);
}

/** 12. Warm Golden-Apricot / Peach Orchard Tree (~11.5u tall). */
function buildOrchardTree(): BufferGeometry {
  const parts: BufferGeometry[] = [groundSkirt(2.1, 0x2b2418, 0x423622, 10)];

  // Cinnamon orchard trunk + 3 spreading branches
  parts.push(
    limbSegment(0, -0.55, 0, 0.1, 2.9, 0.05, 0.64, 0.44, 0x573420, 0x825134, 7),
    limbSegment(0.1, 2.7, 0.05, 1.7, 5.2, 0.9, 0.34, 0.18, 0x6b4027, 0x915c3c, 6),
    limbSegment(0.1, 2.7, 0.05, -1.75, 5.0, 0.55, 0.34, 0.18, 0x6b4027, 0x915c3c, 6),
    limbSegment(0.1, 2.7, 0.05, 0.1, 5.4, -1.7, 0.34, 0.18, 0x6b4027, 0x915c3c, 6),
  );

  // Warm golden-apricot & peach summer-autumn foliage clouds
  const puffs: readonly { x: number; y: number; z: number; r: number; c1: number; c2: number }[] = [
    { x: 1.8, y: 6.2, z: 0.95, r: 2.35, c1: 0xc87a2c, c2: 0xffd26e },
    { x: -1.85, y: 5.9, z: 0.65, r: 2.25, c1: 0xd96846, c2: 0xffbfa0 },
    { x: 0.1, y: 6.4, z: -1.8, r: 2.3, c1: 0x889e32, c2: 0xebd966 },
    { x: 0.0, y: 8.1, z: 0.0, r: 2.75, c1: 0xd98634, c2: 0xffe48c },
    { x: -0.4, y: 9.4, z: 0.3, r: 1.95, c1: 0xe6845e, c2: 0xffdfc4 },
  ];
  for (let i = 0; i < puffs.length; i++) {
    const p = puffs[i]!;
    parts.push(
      bakePart(
        sculptOrganic(new IcosahedronGeometry(p.r, 1), 0.12, 1.4, 1.4, 1.4, i * 1.3),
        p.c1,
        p.c2,
        p.x,
        p.y,
        p.z,
        0,
        i * 0.7,
        0,
        1.24,
        0.78,
        1.2,
      ),
    );
  }

  // Ripe apricot/peach fruits hanging under the lower orchard boughs
  for (let f = 0; f < 5; f++) {
    const a = (f / 5) * Math.PI * 2 + 0.3;
    parts.push(
      bakePart(
        new SphereGeometry(0.28, 7, 6),
        0xe85a2a,
        0xffc866,
        Math.cos(a) * 2.15,
        4.6 + (f % 2) * 0.55,
        Math.sin(a) * 2.15,
      ),
    );
  }

  return mergeParts(parts);
}

/** 13. Refined Whimsical Pastel Candy-Orchard Spire & Berry Shrub (~9.5u tall). */
function buildCandyOrchardSpire(): BufferGeometry {
  const parts: BufferGeometry[] = [groundSkirt(1.85, 0x362430, 0x523748, 10)];

  // Cinnamon-sugar pedestal & sculpted pastel-rose/mint botanical topiary spire
  parts.push(
    bakePart(new CylinderGeometry(0.68, 0.92, 1.2, 8), 0xd49b6a, 0xffe8cc, 0, 0.05, 0),
    bakePart(new CylinderGeometry(0.32, 0.44, 3.6, 8), 0xf2e4d8, 0xffffff, 0, 2.3, 0),
    bakePart(
      sculptOrganic(new IcosahedronGeometry(1.75, 1), 0.1, 1.8, 1.5, 1.8, 0.4),
      0xe66fa8,
      0xffe3f1,
      0,
      4.5,
      0,
      0,
      0,
      0,
      1.15,
      0.88,
      1.15,
    ),
    bakePart(
      sculptOrganic(new IcosahedronGeometry(1.3, 1), 0.1, 2.0, 1.6, 2.0, 1.2),
      0x74d9c4,
      0xe8fff9,
      0,
      6.4,
      0,
      0,
      0.5,
      0,
      1.1,
      0.92,
      1.1,
    ),
    bakePart(new ConeGeometry(0.85, 2.4, 8), 0xf5a65b, 0xfff3c4, 0, 8.2, 0),
  );

  // Flanking berry shrub mound with jewel berries
  parts.push(
    bakePart(
      sculptOrganic(new IcosahedronGeometry(1.05, 1), 0.13, 2.0, 1.8, 2.0, 0.9, -0.48),
      0x4e8c3a,
      0xa8d962,
      1.35,
      -0.05,
      0.55,
      0,
      0,
      0,
      1.25,
      0.78,
      1.15,
    ),
    bakePart(
      sculptOrganic(new IcosahedronGeometry(0.88, 1), 0.13, 2.1, 1.8, 2.1, 2.1, -0.48),
      0x589942,
      0xbce670,
      -1.2,
      -0.12,
      -0.5,
      0,
      0,
      0,
      1.2,
      0.74,
      1.1,
    ),
  );
  for (let b = 0; b < 5; b++) {
    const a = (b / 5) * Math.PI * 2;
    parts.push(
      bakePart(
        new SphereGeometry(0.18, 6, 5),
        b % 2 === 0 ? 0xff4076 : 0xff9436,
        0xffe4ec,
        1.35 + Math.cos(a) * 0.72,
        0.35 + (b % 2) * 0.25,
        0.55 + Math.sin(a) * 0.65,
      ),
    );
  }

  return mergeParts(parts);
}

/** 14. Wind-Swept Alpine Pine (~13u tall). */
function buildWindsweptPine(): BufferGeometry {
  const parts: BufferGeometry[] = [groundSkirt(2.0, 0x1a1e2e, 0x2a314a, 10)];

  // Gnarled wind-leaning alpine pine trunk
  parts.push(
    limbSegment(0, -0.55, 0, 0.55, 3.4, 0.1, 0.68, 0.46, 0x3b2a2a, 0x5c4444, 7),
    limbSegment(0.55, 3.3, 0.1, 1.35, 7.6, 0.25, 0.46, 0.28, 0x4b3838, 0x6b5252, 7),
    limbSegment(1.35, 7.5, 0.25, 2.05, 11.4, 0.3, 0.28, 0.14, 0x594242, 0x786060, 6),
  );

  // Asymmetric windswept bough pads trailing downwind (+X)
  const pads: readonly { x: number; y: number; z: number; r: number }[] = [
    { x: 1.7, y: 4.9, z: -0.85, r: 2.15 },
    { x: 2.2, y: 6.8, z: 0.9, r: 2.35 },
    { x: 2.55, y: 8.8, z: -0.35, r: 2.05 },
    { x: 2.85, y: 10.6, z: 0.4, r: 1.7 },
    { x: 2.5, y: 12.1, z: 0.1, r: 1.3 },
  ];
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i]!;
    parts.push(
      limbSegment(
        0.6 + i * 0.35,
        p.y - 0.5,
        0.15,
        p.x * 0.8,
        p.y - 0.1,
        p.z * 0.7,
        0.18,
        0.1,
        0x4f3a3a,
        0x6e5656,
        5,
      ),
      bakePart(
        sculptOrganic(new IcosahedronGeometry(p.r, 1), 0.14, 1.5, 1.5, 1.5, i * 1.2),
        0x173e47,
        0x529aa3,
        p.x,
        p.y,
        p.z,
        0,
        0.2,
        -0.08,
        1.45,
        0.48,
        1.05,
      ),
    );
  }

  return mergeParts(parts);
}

/** 15. Celestial Standing-Stone Monolith & Alpine Slate Crags (~11.5u tall). */
function buildCelestialMonolith(): BufferGeometry {
  const parts: BufferGeometry[] = [groundSkirt(2.3, 0x1a1d33, 0x2c3254, 10)];

  // Alpine slate crag base & flanking tilted slate slabs
  parts.push(
    bakePart(
      sculptOrganic(new DodecahedronGeometry(1.7, 0), 0.16, 1.5, 1.3, 1.5, 0.5, -0.52),
      0x29304a,
      0x68769e,
      -0.9,
      0.2,
      0.4,
      0.12,
      0.4,
      0.18,
      1.25,
      0.78,
      1.1,
    ),
    bakePart(
      sculptOrganic(new DodecahedronGeometry(1.35, 0), 0.15, 1.7, 1.4, 1.7, 1.9, -0.52),
      0x2f3754,
      0x7484ad,
      1.1,
      0.1,
      -0.45,
      -0.1,
      0.9,
      -0.22,
      1.15,
      0.85,
      0.95,
    ),
    // Tall runic standing-stone menhir
    bakePart(
      new CylinderGeometry(0.62, 1.05, 8.6, 5),
      0x222842,
      0x5c6b94,
      0,
      3.75,
      0,
      0,
      0.25,
      0.04,
    ),
    bakePart(new ConeGeometry(0.62, 1.9, 5), 0x4e5c82, 0x8da0cc, 0.17, 8.95, 0, 0, 0.25, 0.04),
    // Glowing aurora-quartz vein inlaid along the monolith face
    bakePart(new BoxGeometry(0.2, 6.2, 0.28), 0x8c6eff, 0xd4fcff, 0.06, 4.1, 0.72, 0.04, 0, 0.04),
    // Floating starlight prism crest at apex
    bakePart(new OctahedronGeometry(0.76, 0), 0x9e7aff, 0xffffff, 0.22, 10.6, 0),
  );

  return mergeParts(parts);
}

/** 16. Universal Weathered Multi-Boulder Rock Outcrop (~3.6u tall). */
function buildRockOutcrop(): BufferGeometry {
  const parts: BufferGeometry[] = [groundSkirt(2.25, 0x222629, 0x373c40, 10)];

  const rocks: readonly {
    x: number;
    y: number;
    z: number;
    r: number;
    sx: number;
    sy: number;
    sz: number;
    ry: number;
    bot: number;
    top: number;
  }[] = [
    {
      x: -0.25,
      y: 0.65,
      z: 0.0,
      r: 1.45,
      sx: 1.28,
      sy: 0.92,
      sz: 1.12,
      ry: 0.3,
      bot: 0x4f565e,
      top: 0xb6bec4,
    },
    {
      x: 1.05,
      y: 0.22,
      z: 0.55,
      r: 1.05,
      sx: 1.18,
      sy: 0.72,
      sz: 1.02,
      ry: 1.2,
      bot: 0x484f57,
      top: 0xa4acb3,
    },
    {
      x: -1.15,
      y: 0.15,
      z: -0.58,
      r: 0.95,
      sx: 1.12,
      sy: 0.68,
      sz: 1.08,
      ry: 2.1,
      bot: 0x52595e,
      top: 0xabb3b8,
    },
    {
      x: 0.35,
      y: -0.1,
      z: -0.95,
      r: 0.72,
      sx: 1.2,
      sy: 0.58,
      sz: 0.95,
      ry: 0.8,
      bot: 0x4a524c,
      top: 0x9aa69e,
    },
    {
      x: -0.55,
      y: -0.25,
      z: 1.08,
      r: 0.52,
      sx: 1.15,
      sy: 0.55,
      sz: 1.0,
      ry: 1.7,
      bot: 0x565c61,
      top: 0x9ca4ab,
    },
  ];
  for (let i = 0; i < rocks.length; i++) {
    const rk = rocks[i]!;
    parts.push(
      bakePart(
        sculptOrganic(new DodecahedronGeometry(rk.r, 0), 0.16, 1.6, 1.4, 1.6, i * 1.35, -0.52),
        rk.bot,
        rk.top,
        rk.x,
        rk.y,
        rk.z,
        0,
        rk.ry,
        0,
        rk.sx,
        rk.sy,
        rk.sz,
      ),
    );
  }

  return mergeParts(parts);
}

/** 17. Lush Ground-Cover Grass & Wildflower Tuft (~1.45u tall, neutral-sage base for clean biome tinting). */
function buildGrassWildflowerTuft(): BufferGeometry {
  const parts: BufferGeometry[] = [groundSkirt(0.75, 0x3b4a36, 0x52634c, 7)];

  // 8 radiating grass blades
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + (i % 2) * 0.2;
    const h = 0.85 + (i % 3) * 0.28;
    const tilt = 0.26 + (i % 3) * 0.12;
    parts.push(
      bakePart(
        new ConeGeometry(0.14, h, 3),
        0x7ea670,
        0xeafad8,
        Math.cos(a) * 0.22,
        -0.48 + h * 0.42,
        Math.sin(a) * 0.22,
        Math.sin(a) * tilt,
        a,
        -Math.cos(a) * tilt,
      ),
    );
  }

  // 3 delicate wildflower heads
  const flowers: readonly { x: number; y: number; z: number; hex: number }[] = [
    { x: -0.24, y: 0.46, z: 0.18, hex: 0xfff0a8 },
    { x: 0.26, y: 0.38, z: -0.16, hex: 0xffd6eb },
    { x: 0.02, y: 0.6, z: -0.04, hex: 0xffffff },
  ];
  for (const fl of flowers) {
    parts.push(
      bakePart(
        new CylinderGeometry(0.03, 0.04, fl.y + 0.46, 4),
        0x739c64,
        0xbadb9c,
        fl.x,
        (fl.y - 0.46) * 0.5,
        fl.z,
      ),
      bakePart(
        new OctahedronGeometry(0.16, 0),
        fl.hex,
        0xffffff,
        fl.x,
        fl.y,
        fl.z,
        0,
        0,
        0,
        1.15,
        0.55,
        1.15,
      ),
    );
  }

  return mergeParts(parts);
}

/** 18. Riverbank Cattail Reed Tuft (~2.0u tall). */
function buildRiverReedTuft(): BufferGeometry {
  const parts: BufferGeometry[] = [
    groundSkirt(0.8, 0x1a2618, 0x2d3b26, 8),
    // Smooth river pebbles at base
    bakePart(
      new DodecahedronGeometry(0.24, 0),
      0x5c666e,
      0x9aa4ab,
      -0.3,
      -0.4,
      0.25,
      0,
      0.4,
      0,
      1.2,
      0.55,
      1.0,
    ),
    bakePart(
      new DodecahedronGeometry(0.19, 0),
      0x535d63,
      0x8d979e,
      0.28,
      -0.42,
      -0.2,
      0,
      1.2,
      0,
      1.1,
      0.5,
      1.0,
    ),
  ];

  // 6 tall marsh sedge blades
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.25;
    const h = 1.2 + (i % 3) * 0.3;
    parts.push(
      bakePart(
        new ConeGeometry(0.1, h, 3),
        0x266335,
        0x72c25b,
        Math.cos(a) * 0.22,
        -0.48 + h * 0.44,
        Math.sin(a) * 0.22,
        Math.sin(a) * 0.22,
        a,
        -Math.cos(a) * 0.22,
      ),
    );
  }

  // 3 upright cattail stalks with cylindrical velvety brown seed spikes
  const stalks: readonly { x: number; z: number; h: number }[] = [
    { x: -0.1, z: 0.08, h: 1.95 },
    { x: 0.18, z: -0.1, h: 1.7 },
    { x: -0.18, z: -0.18, h: 1.5 },
  ];
  for (const st of stalks) {
    parts.push(
      bakePart(
        new CylinderGeometry(0.032, 0.045, st.h, 5),
        0x3b7838,
        0x72ad52,
        st.x,
        -0.48 + st.h * 0.5,
        st.z,
      ),
      bakePart(
        new CylinderGeometry(0.082, 0.082, 0.42, 6),
        0x472814,
        0x704224,
        st.x,
        -0.48 + st.h - 0.28,
        st.z,
      ),
    );
  }

  return mergeParts(parts);
}

/** 19. Gentle Scenic Rolling Hillock / Natural Earth Mound (base radius ~4.5u, height ~2.0u -> scaled to r=6..12u, h=1.8..4.5u). */
function buildRollingHillock(): BufferGeometry {
  const parts: BufferGeometry[] = [groundSkirt(4.65, 0x4f524a, 0x73786c, 16)];

  // 3 overlapping organic undulating dome lobes (bright neutral tones for clean per-biome instanceColor tinting)
  const lobes: readonly {
    x: number;
    z: number;
    r: number;
    sx: number;
    sy: number;
    sz: number;
    ph: number;
  }[] = [
    { x: 0.0, z: 0.0, r: 3.4, sx: 1.22, sy: 0.58, sz: 1.08, ph: 0.3 },
    { x: -1.6, z: 0.75, r: 2.55, sx: 1.18, sy: 0.52, sz: 1.1, ph: 1.8 },
    { x: 1.55, z: -0.65, r: 2.35, sx: 1.14, sy: 0.46, sz: 1.06, ph: 3.1 },
  ];
  for (const lb of lobes) {
    const raw = new SphereGeometry(lb.r, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.52);
    sculptOrganic(raw, 0.14, 0.65, 0.85, 0.65, lb.ph, -0.08);
    parts.push(
      bakePart(raw, 0x8c877c, 0xf2f7eb, lb.x, -0.54, lb.z, 0, lb.ph * 0.4, 0, lb.sx, lb.sy, lb.sz),
    );
  }

  // Embedded natural outcrop rocks along the hillock flank
  parts.push(
    bakePart(
      sculptOrganic(new DodecahedronGeometry(0.95, 0), 0.15, 1.5, 1.3, 1.5, 0.6, -0.45),
      0x70767d,
      0xc2cad1,
      2.2,
      -0.12,
      1.1,
      0.1,
      0.6,
      0,
      1.3,
      0.7,
      1.05,
    ),
    bakePart(
      sculptOrganic(new DodecahedronGeometry(0.8, 0), 0.15, 1.6, 1.4, 1.6, 2.2, -0.45),
      0x6b7178,
      0xb8c0c7,
      -2.3,
      -0.18,
      -0.95,
      0,
      1.4,
      -0.1,
      1.2,
      0.65,
      1.0,
    ),
  );

  return mergeParts(parts);
}

/** Create all 20 deterministic multi-part vertex-colored biome prop archetypes. */
export function createBiomePropArchetypes(): BiomePropArchetype[] {
  return [
    {
      kind: 'broadleaf_oak',
      geometry: buildBroadleafOak(),
      isCrystalline: false,
      baseHeight: 13.5,
    },
    {
      kind: 'royal_cypress',
      geometry: buildRoyalCypress(),
      isCrystalline: false,
      baseHeight: 14.5,
    },
    {
      kind: 'rainforest_buttress_tree',
      geometry: buildRainforestButtressTree(),
      isCrystalline: false,
      baseHeight: 16.0,
    },
    {
      kind: 'mossy_log_mushrooms',
      geometry: buildMossyLogMushrooms(),
      isCrystalline: false,
      baseHeight: 4.5,
    },
    {
      kind: 'rainforest_fern',
      geometry: buildRainforestFern(),
      isCrystalline: false,
      baseHeight: 2.2,
    },
    {
      kind: 'weeping_sakura',
      geometry: buildWeepingSakura(),
      isCrystalline: false,
      baseHeight: 12.5,
    },
    { kind: 'bamboo_grove', geometry: buildBambooGrove(), isCrystalline: false, baseHeight: 10.5 },
    { kind: 'stone_lantern', geometry: buildStoneLantern(), isCrystalline: true, baseHeight: 4.2 },
    { kind: 'snow_spruce', geometry: buildSnowSpruce(), isCrystalline: false, baseHeight: 15.0 },
    { kind: 'glacial_crag', geometry: buildGlacialCrag(), isCrystalline: true, baseHeight: 11.5 },
    { kind: 'coconut_palm', geometry: buildCoconutPalm(), isCrystalline: false, baseHeight: 13.0 },
    {
      kind: 'coastal_coral_rock',
      geometry: buildCoastalCoralRock(),
      isCrystalline: true,
      baseHeight: 4.5,
    },
    { kind: 'orchard_tree', geometry: buildOrchardTree(), isCrystalline: false, baseHeight: 11.5 },
    {
      kind: 'candy_orchard_spire',
      geometry: buildCandyOrchardSpire(),
      isCrystalline: false,
      baseHeight: 9.5,
    },
    {
      kind: 'windswept_pine',
      geometry: buildWindsweptPine(),
      isCrystalline: false,
      baseHeight: 13.0,
    },
    {
      kind: 'celestial_monolith',
      geometry: buildCelestialMonolith(),
      isCrystalline: true,
      baseHeight: 11.5,
    },
    { kind: 'rock_outcrop', geometry: buildRockOutcrop(), isCrystalline: false, baseHeight: 3.6 },
    {
      kind: 'grass_wildflower_tuft',
      geometry: buildGrassWildflowerTuft(),
      isCrystalline: false,
      baseHeight: 1.45,
    },
    {
      kind: 'river_reed_tuft',
      geometry: buildRiverReedTuft(),
      isCrystalline: false,
      baseHeight: 2.0,
    },
    {
      kind: 'rolling_hillock',
      geometry: buildRollingHillock(),
      isCrystalline: false,
      baseHeight: 2.0,
    },
  ];
}
