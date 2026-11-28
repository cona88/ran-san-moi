import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { ShelterHouse, ShelterKind } from '../core/types';

export interface CastlePrecinctHandle {
  readonly kind: ShelterKind;
  readonly group: Group;
  readonly shimmerRings: readonly {
    mesh: Mesh;
    baseOpacity: number;
    speed: number;
    phase: number;
    rotateSpeed: number;
  }[];
  readonly waveRings: readonly {
    mesh: Mesh;
    baseScale: number;
    baseOpacity: number;
    speed: number;
    phase: number;
  }[];
  readonly fountainJets: readonly {
    mesh: Mesh;
    baseY: number;
    amplitude: number;
    speed: number;
    phase: number;
  }[];
  readonly swayProps: readonly {
    obj: Group | Mesh;
    axis: 'x' | 'z';
    baseRot: number;
    amplitude: number;
    speed: number;
    phase: number;
  }[];
  readonly spinRings: readonly {
    mesh: Mesh;
    axis: 'x' | 'y' | 'z';
    speed: number;
  }[];
  readonly glowOrbs: readonly {
    mat: MeshStandardMaterial;
    baseIntensity: number;
    amplitude: number;
    speed: number;
    phase: number;
  }[];
  readonly mistRings: readonly {
    mesh: Mesh;
    baseY: number;
    baseOpacity: number;
    rotateSpeed: number;
    phase: number;
  }[];
  readonly bobItems: readonly {
    mesh: Mesh;
    baseY: number;
    amplitude: number;
    speed: number;
    phase: number;
  }[];
}

const PRECINCT_BY_HOUSE = new WeakMap<Group, CastlePrecinctHandle>();

/** Deterministic pseudo-random helper in [0, 1) so visuals never use Math.random(). */
function hash01(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Returns true if polar angle lies inside one of the 4 wide cardinal snake avenues. */
function isCardinalCorridor(angle: number, halfWidthRad = 0.34): boolean {
  const twoPi = Math.PI * 2;
  const a = ((angle % twoPi) + twoPi) % twoPi;
  for (let k = 0; k < 4; k++) {
    const target = (k * Math.PI) / 2;
    let diff = Math.abs(a - target);
    if (diff > Math.PI) diff = twoPi - diff;
    if (diff < halfWidthRad) return true;
  }
  return false;
}

/** Returns true if (x, z) lies inside the wide front (+Z) or side cardinal snake corridors. */
function isInPathway(x: number, z: number, frontHalfW = 3.0, sideHalfW = 2.4): boolean {
  if (z > 0 && Math.abs(x) < frontHalfW) return true;
  if (Math.abs(x) < sideHalfW || Math.abs(z) < sideHalfW) return true;
  return false;
}

function createMutableHandle(
  kind: ShelterKind,
  group: Group,
): {
  handle: CastlePrecinctHandle;
  shimmerRings: CastlePrecinctHandle['shimmerRings'][number][];
  waveRings: CastlePrecinctHandle['waveRings'][number][];
  fountainJets: CastlePrecinctHandle['fountainJets'][number][];
  swayProps: CastlePrecinctHandle['swayProps'][number][];
  spinRings: CastlePrecinctHandle['spinRings'][number][];
  glowOrbs: CastlePrecinctHandle['glowOrbs'][number][];
  mistRings: CastlePrecinctHandle['mistRings'][number][];
  bobItems: CastlePrecinctHandle['bobItems'][number][];
} {
  const shimmerRings: CastlePrecinctHandle['shimmerRings'][number][] = [];
  const waveRings: CastlePrecinctHandle['waveRings'][number][] = [];
  const fountainJets: CastlePrecinctHandle['fountainJets'][number][] = [];
  const swayProps: CastlePrecinctHandle['swayProps'][number][] = [];
  const spinRings: CastlePrecinctHandle['spinRings'][number][] = [];
  const glowOrbs: CastlePrecinctHandle['glowOrbs'][number][] = [];
  const mistRings: CastlePrecinctHandle['mistRings'][number][] = [];
  const bobItems: CastlePrecinctHandle['bobItems'][number][] = [];
  return {
    handle: {
      kind,
      group,
      shimmerRings,
      waveRings,
      fountainJets,
      swayProps,
      spinRings,
      glowOrbs,
      mistRings,
      bobItems,
    },
    shimmerRings,
    waveRings,
    fountainJets,
    swayProps,
    spinRings,
    glowOrbs,
    mistRings,
    bobItems,
  };
}

/**
 * 1. `castle` (0,0 — Temperate Royal Meadow):
 * Circular reflecting stone moat ring around plinth (`r = 12.2..14.4`) with 4 arched marble
 * bridges, manicured emerald hedge parterres, slender courtyard cypresses, twin tiered marble
 * fountains with shimmering water jets, stone balustrade segments, warm glowing lanterns.
 * Kept within `r <= 16.3` so it integrates cleanly inside the outer world moat (`r = 16.6..19.6`).
 */
function buildRoyalCastlePrecinct(shelter: ShelterHouse): CastlePrecinctHandle {
  const group = new Group();
  group.name = 'precinct_castle';
  const ctx = createMutableHandle('castle', group);
  const R = Math.max(14, shelter.radius);

  const stoneMat = new MeshStandardMaterial({
    color: 0xf4eee6,
    emissive: 0x3b332d,
    emissiveIntensity: 0.12,
    roughness: 0.45,
    metalness: 0.08,
  });
  const trimGoldMat = new MeshStandardMaterial({
    color: 0xffd57e,
    emissive: 0xffab40,
    emissiveIntensity: 0.35,
    roughness: 0.25,
    metalness: 0.7,
  });
  const moatWaterMat = new MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 0.38,
    roughness: 0.12,
    metalness: 0.35,
    transparent: true,
    opacity: 0.86,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const shimmerMat = new MeshBasicMaterial({
    color: 0xcffafe,
    transparent: true,
    opacity: 0.42,
    side: DoubleSide,
    depthWrite: false,
  });
  const hedgeMat = new MeshStandardMaterial({
    color: 0x2e8b57,
    emissive: 0x14532d,
    emissiveIntensity: 0.2,
    roughness: 0.72,
  });
  const cypressMat = new MeshStandardMaterial({
    color: 0x1f6b43,
    emissive: 0x0f3d25,
    emissiveIntensity: 0.18,
    roughness: 0.75,
  });
  const trunkMat = new MeshStandardMaterial({
    color: 0x6d4c3d,
    roughness: 0.85,
  });

  // Circular reflecting stone moat ring (r = 12.2..14.4)
  const moatWater = new Mesh(new RingGeometry(12.22, 14.38, 64), moatWaterMat);
  moatWater.rotation.x = -Math.PI / 2;
  moatWater.position.y = 0.012;
  group.add(moatWater);

  const moatShimmer = new Mesh(new RingGeometry(12.6, 14.0, 56), shimmerMat);
  moatShimmer.rotation.x = -Math.PI / 2;
  moatShimmer.position.y = 0.017;
  group.add(moatShimmer);
  ctx.shimmerRings.push({
    mesh: moatShimmer,
    baseOpacity: 0.38,
    speed: 2.0,
    phase: 0,
    rotateSpeed: 0.12,
  });

  const innerCurb = new Mesh(new TorusGeometry(12.2, 0.16, 8, 56), stoneMat);
  innerCurb.rotation.x = Math.PI / 2;
  innerCurb.scale.set(1, 1, 0.55);
  innerCurb.position.y = 0.06;
  const outerCurb = new Mesh(new TorusGeometry(14.42, 0.18, 8, 56), stoneMat);
  outerCurb.rotation.x = Math.PI / 2;
  outerCurb.scale.set(1, 1, 0.55);
  outerCurb.position.y = 0.07;
  group.add(innerCurb, outerCurb);

  // 4 Arched Marble Bridges (front/back/left/right) spanning r = 11.7..14.9
  const bridgeRampGeo = new BoxGeometry(2.7, 0.14, 1.05);
  const bridgeSpanGeo = new BoxGeometry(2.7, 0.16, 1.55);
  const railGeo = new BoxGeometry(0.16, 0.36, 3.25);
  const postGeo = new CylinderGeometry(0.14, 0.17, 0.62, 8);
  const finialGeo = new SphereGeometry(0.14, 8, 8);

  for (let i = 0; i < 4; i++) {
    const yaw = (i * Math.PI) / 2;
    const bridge = new Group();
    bridge.rotation.y = yaw;
    bridge.position.set(Math.sin(yaw) * 13.3, 0, Math.cos(yaw) * 13.3);

    const centerSpan = new Mesh(bridgeSpanGeo, stoneMat);
    centerSpan.position.set(0, 0.26, 0);
    const rampIn = new Mesh(bridgeRampGeo, stoneMat);
    rampIn.position.set(0, 0.14, -1.1);
    rampIn.rotation.x = -0.22;
    const rampOut = new Mesh(bridgeRampGeo, stoneMat);
    rampOut.position.set(0, 0.14, 1.1);
    rampOut.rotation.x = 0.22;
    bridge.add(centerSpan, rampIn, rampOut);

    for (const side of [-1, 1] as const) {
      const rail = new Mesh(railGeo, stoneMat);
      rail.position.set(side * 1.32, 0.38, 0);
      bridge.add(rail);
      for (const end of [-1.52, 1.52] as const) {
        const post = new Mesh(postGeo, stoneMat);
        post.position.set(side * 1.32, 0.34, end);
        const cap = new Mesh(finialGeo, trimGoldMat);
        cap.position.set(side * 1.32, 0.72, end);
        bridge.add(post, cap);
      }
    }
    group.add(bridge);
  }

  // Stone balustrade segments + manicured emerald hedge parterres around r = 14.7..15.7
  const balusterGeo = new CylinderGeometry(0.08, 0.1, 0.44, 8);
  const topRailGeo = new BoxGeometry(1.15, 0.1, 0.2);
  const hedgeArcGeo = new BoxGeometry(2.2, 0.44, 0.78);
  const flowerBedGeo = new SphereGeometry(0.15, 8, 6);
  const rosePinkMat = new MeshStandardMaterial({
    color: 0xff6b9d,
    emissive: 0xd81b60,
    emissiveIntensity: 0.35,
    roughness: 0.35,
  });

  for (let q = 0; q < 4; q++) {
    const qCenter = q * (Math.PI / 2) + Math.PI / 4;

    // 4 balustrade posts/rails along each diagonal arc outside moat
    for (let s = -1; s <= 1; s++) {
      const a = qCenter + s * 0.22;
      if (isCardinalCorridor(a, 0.34)) continue;
      const rBal = 14.72;
      const bx = Math.cos(a) * rBal;
      const bz = Math.sin(a) * rBal;

      const post = new Mesh(balusterGeo, stoneMat);
      post.position.set(bx, 0.22, bz);
      const rail = new Mesh(topRailGeo, stoneMat);
      rail.position.set(bx, 0.46, bz);
      rail.rotation.y = -a + Math.PI / 2;
      group.add(post, rail);
    }

    // Manicured emerald hedge parterres flanking each diagonal quadrant
    for (const off of [-0.28, 0.28] as const) {
      const ha = qCenter + off;
      if (isCardinalCorridor(ha, 0.34)) continue;
      const rH = Math.min(15.4, R - 0.55);
      const hx = Math.cos(ha) * rH;
      const hz = Math.sin(ha) * rH;

      const hedge = new Mesh(hedgeArcGeo, hedgeMat);
      hedge.position.set(hx, 0.22, hz);
      hedge.rotation.y = -ha + Math.PI / 2;
      group.add(hedge);

      for (let f = -1; f <= 1; f += 2) {
        const rose = new Mesh(flowerBedGeo, rosePinkMat);
        rose.position.set(
          hx + Math.cos(ha + Math.PI / 2) * f * 0.55,
          0.46,
          hz + Math.sin(ha + Math.PI / 2) * f * 0.55,
        );
        group.add(rose);
      }
    }
  }

  // Slender courtyard cypresses in the 4 diagonal courtyard corners (kept concise near dome rim)
  const cypressTrunkGeo = new CylinderGeometry(0.11, 0.15, 0.65, 8);
  const cypressLowerGeo = new ConeGeometry(0.55, 1.85, 10);
  const cypressUpperGeo = new ConeGeometry(0.38, 1.45, 10);
  const cypressAngles = [Math.PI * 0.21, Math.PI * 0.79, Math.PI * 1.21, Math.PI * 1.79];
  for (let i = 0; i < cypressAngles.length; i++) {
    const a = cypressAngles[i]!;
    const rC = R - 0.7;
    const cx = Math.cos(a) * rC;
    const cz = Math.sin(a) * rC;
    const tree = new Group();
    tree.position.set(cx, 0, cz);

    const trunk = new Mesh(cypressTrunkGeo, trunkMat);
    trunk.position.y = 0.32;
    const lower = new Mesh(cypressLowerGeo, cypressMat);
    lower.position.y = 1.35;
    const upper = new Mesh(cypressUpperGeo, cypressMat);
    upper.position.y = 2.35;
    tree.add(trunk, lower, upper);
    group.add(tree);

    ctx.swayProps.push({
      obj: tree,
      axis: 'z',
      baseRot: 0,
      amplitude: 0.035,
      speed: 1.5,
      phase: i * 1.3,
    });
  }

  // Twin tiered marble fountains with shimmering water jets (NW & NE or Front-Left & Front-Right diagonals)
  const fountainBasinGeo = new CylinderGeometry(1.05, 1.18, 0.28, 18);
  const fountainPoolGeo = new CircleGeometry(0.92, 18);
  const fountainColGeo = new CylinderGeometry(0.22, 0.3, 0.85, 12);
  const fountainUpperGeo = new CylinderGeometry(0.55, 0.35, 0.2, 16);
  const fountainJetGeo = new ConeGeometry(0.18, 0.9, 10);
  const jetDropGeo = new SphereGeometry(0.1, 8, 6);
  const jetMat = new MeshStandardMaterial({
    color: 0xe0f7fa,
    emissive: 0x38bdf8,
    emissiveIntensity: 0.65,
    transparent: true,
    opacity: 0.85,
    roughness: 0.1,
  });

  const fountainAngles = [Math.PI * 0.31, Math.PI * 0.69];
  for (let f = 0; f < fountainAngles.length; f++) {
    const fa = fountainAngles[f]!;
    const fr = R - 0.75;
    const fGrp = new Group();
    fGrp.position.set(Math.cos(fa) * fr, 0, Math.sin(fa) * fr);

    const basin = new Mesh(fountainBasinGeo, stoneMat);
    basin.position.y = 0.14;
    const pool = new Mesh(fountainPoolGeo, moatWaterMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.29;
    const col = new Mesh(fountainColGeo, stoneMat);
    col.position.y = 0.65;
    const upper = new Mesh(fountainUpperGeo, stoneMat);
    upper.position.y = 1.05;
    const jet = new Mesh(fountainJetGeo, jetMat);
    jet.position.y = 1.55;
    fGrp.add(basin, pool, col, upper, jet);

    ctx.fountainJets.push({
      mesh: jet,
      baseY: 1.55,
      amplitude: 0.18,
      speed: 4.5,
      phase: f * 1.4,
    });

    for (let d = 0; d < 4; d++) {
      const da = (d / 4) * Math.PI * 2;
      const drop = new Mesh(jetDropGeo, jetMat);
      drop.position.set(Math.cos(da) * 0.38, 1.28, Math.sin(da) * 0.38);
      fGrp.add(drop);
      ctx.fountainJets.push({
        mesh: drop,
        baseY: 1.28,
        amplitude: 0.22,
        speed: 5.5,
        phase: f + d * 0.9,
      });
    }

    group.add(fGrp);
  }

  // Warm glowing courtyard lanterns flanking the 4 bridge entrances
  const lampPostGeo = new CylinderGeometry(0.07, 0.11, 1.5, 8);
  const lampOrbGeo = new OctahedronGeometry(0.22, 0);
  for (let b = 0; b < 4; b++) {
    const yaw = (b * Math.PI) / 2;
    for (const side of [-1, 1] as const) {
      const lx = Math.sin(yaw) * 14.9 + Math.cos(yaw) * side * 1.95;
      const lz = Math.cos(yaw) * 14.9 - Math.sin(yaw) * side * 1.95;

      const orbMat = new MeshStandardMaterial({
        color: 0xfff8dc,
        emissive: 0xffb74d,
        emissiveIntensity: 0.95,
        roughness: 0.15,
      });
      const post = new Mesh(lampPostGeo, trimGoldMat);
      post.position.set(lx, 0.75, lz);
      const orb = new Mesh(lampOrbGeo, orbMat);
      orb.position.set(lx, 1.62, lz);
      group.add(post, orb);

      ctx.glowOrbs.push({
        mat: orbMat,
        baseIntensity: 0.92,
        amplitude: 0.2,
        speed: 3.6,
        phase: b * 1.1 + side * 0.5,
      });
    }
  }

  return ctx.handle;
}

/**
 * 2. `mushroom` (0,-160 / 0,160 / -140,-140 — Misty Ancient Forest Glade):
 * Gnarled mossy root tendrils spreading across the earth, lush ring of rainforest ferns &
 * woodland boulders, curved mossy wooden footbridge over a shimmering forest dew-pool,
 * rustic timber garden fence posts with glowing lantern-caps, clustered woodland toadstools.
 */
function buildMushroomGladePrecinct(shelter: ShelterHouse): CastlePrecinctHandle {
  const group = new Group();
  group.name = 'precinct_mushroom';
  const ctx = createMutableHandle('mushroom', group);
  const R = Math.max(12, shelter.radius);

  const barkMat = new MeshStandardMaterial({
    color: 0x5c3c24,
    emissive: 0x26160b,
    emissiveIntensity: 0.14,
    roughness: 0.88,
  });
  const mossMat = new MeshStandardMaterial({
    color: 0x3b8c47,
    emissive: 0x1b4d24,
    emissiveIntensity: 0.22,
    roughness: 0.78,
  });
  const fernMat = new MeshStandardMaterial({
    color: 0x2e9a4f,
    emissive: 0x165b2b,
    emissiveIntensity: 0.22,
    roughness: 0.65,
    side: DoubleSide,
  });
  const boulderMat = new MeshStandardMaterial({
    color: 0x626e65,
    roughness: 0.88,
  });
  const dewPoolMat = new MeshStandardMaterial({
    color: 0x54e1d8,
    emissive: 0x14919b,
    emissiveIntensity: 0.42,
    roughness: 0.12,
    metalness: 0.35,
    transparent: true,
    opacity: 0.84,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const dewShimmerMat = new MeshBasicMaterial({
    color: 0xdffef9,
    transparent: true,
    opacity: 0.42,
    side: DoubleSide,
    depthWrite: false,
  });

  // Gnarled mossy root tendrils spreading radially from r = 3.5..11.2
  const rootSegGeo = new CylinderGeometry(0.18, 0.26, 2.5, 7);
  const rootTipGeo = new CylinderGeometry(0.06, 0.18, 2.3, 7);
  const mossCapGeo = new SphereGeometry(0.28, 7, 5);
  mossCapGeo.scale(1.4, 0.38, 0.9);

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.38;
    if (isCardinalCorridor(a, 0.36)) continue;

    const rMid = 6.2;
    const rx = Math.cos(a) * rMid;
    const rz = Math.sin(a) * rMid;
    const seg1 = new Mesh(rootSegGeo, barkMat);
    seg1.position.set(rx, 0.14, rz);
    seg1.rotation.z = Math.PI / 2 - 0.08;
    seg1.rotation.y = -a;
    group.add(seg1);

    const bend = a + (i % 2 === 0 ? 0.18 : -0.18);
    const tip = new Mesh(rootTipGeo, barkMat);
    tip.position.set(Math.cos(bend) * 8.4, 0.09, Math.sin(bend) * 8.4);
    tip.rotation.z = Math.PI / 2 - 0.05;
    tip.rotation.y = -bend;
    group.add(tip);

    const mossPatch = new Mesh(mossCapGeo, mossMat);
    mossPatch.position.set(rx, 0.28, rz);
    mossPatch.rotation.y = -a;
    group.add(mossPatch);
  }

  // Shimmering forest dew-pool along front approach (+Z) + curved mossy wooden footbridge spanning it
  const poolZ = R - 3.3; // e.g. ~10.7 for R=14, ~9.7 for R=13
  const dewPoolGeo = new CircleGeometry(3.8, 28);
  dewPoolGeo.scale(1.35, 0.62, 1);
  const dewPool = new Mesh(dewPoolGeo, dewPoolMat);
  dewPool.rotation.x = -Math.PI / 2;
  dewPool.position.set(0, 0.011, poolZ);
  group.add(dewPool);

  const dewShimmerGeo = new RingGeometry(1.6, 3.3, 28);
  dewShimmerGeo.scale(1.35, 0.62, 1);
  const dewShimmer = new Mesh(dewShimmerGeo, dewShimmerMat);
  dewShimmer.rotation.x = -Math.PI / 2;
  dewShimmer.position.set(0, 0.016, poolZ);
  group.add(dewShimmer);
  ctx.shimmerRings.push({
    mesh: dewShimmer,
    baseOpacity: 0.4,
    speed: 2.3,
    phase: 0.6,
    rotateSpeed: 0,
  });

  // Curved mossy wooden footbridge over the dew-pool along +Z
  const bridge = new Group();
  bridge.position.set(0, 0, poolZ);
  const plankGeo = new BoxGeometry(2.7, 0.13, 0.55);
  for (let p = -3; p <= 3; p++) {
    const t = p / 3;
    const py = 0.34 - t * t * 0.22;
    const plank = new Mesh(plankGeo, barkMat);
    plank.position.set(0, py, p * 0.62);
    plank.rotation.x = t * 0.14;
    bridge.add(plank);
  }
  const railPostGeo = new CylinderGeometry(0.08, 0.1, 0.62, 7);
  const railBeamGeo = new BoxGeometry(0.11, 0.09, 4.4);
  for (const side of [-1, 1] as const) {
    const beam = new Mesh(railBeamGeo, mossMat);
    beam.position.set(side * 1.32, 0.64, 0);
    bridge.add(beam);
    for (const pz of [-1.7, 0, 1.7] as const) {
      const post = new Mesh(railPostGeo, barkMat);
      post.position.set(side * 1.32, pz === 0 ? 0.56 : 0.42, pz);
      bridge.add(post);
    }
  }
  group.add(bridge);

  // Rustic timber garden fence posts with glowing lantern-caps around r = R - 0.8
  const fencePostGeo = new CylinderGeometry(0.11, 0.14, 1.15, 7);
  const fenceRailGeo = new BoxGeometry(1.75, 0.09, 0.1);
  const lanternCapGeo = new SphereGeometry(0.19, 8, 8);
  const fenceCount = 14;
  for (let i = 0; i < fenceCount; i++) {
    const a = (i / fenceCount) * Math.PI * 2 + 0.14;
    if (isCardinalCorridor(a, 0.36)) continue;
    const rF = R - 0.75;
    const fx = Math.cos(a) * rF;
    const fz = Math.sin(a) * rF;

    const post = new Mesh(fencePostGeo, barkMat);
    post.position.set(fx, 0.58, fz);
    group.add(post);

    const rail = new Mesh(fenceRailGeo, barkMat);
    rail.position.set(fx, 0.68, fz);
    rail.rotation.y = -a + Math.PI / 2;
    group.add(rail);

    if (i % 2 === 0) {
      const capMat = new MeshStandardMaterial({
        color: 0xfff5cc,
        emissive: shelter.colorHex || 0xff9eb5,
        emissiveIntensity: 0.9,
        roughness: 0.2,
      });
      const cap = new Mesh(lanternCapGeo, capMat);
      cap.position.set(fx, 1.24, fz);
      group.add(cap);
      ctx.glowOrbs.push({
        mat: capMat,
        baseIntensity: 0.88,
        amplitude: 0.25,
        speed: 3.1,
        phase: i * 0.8,
      });
    }
  }

  // Lush ring of rainforest ferns, woodland boulders, and clustered toadstools (r = R + 0.6 .. R + 2.7)
  const boulderGeo = new DodecahedronGeometry(0.68, 0);
  const fernBladeGeo = new ConeGeometry(0.24, 1.05, 4);
  fernBladeGeo.scale(1, 1, 0.25);
  const toadStemGeo = new CylinderGeometry(0.09, 0.13, 0.42, 8);
  const toadCapGeo = new SphereGeometry(0.32, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const toadMat = new MeshStandardMaterial({
    color: 0xff6b8b,
    emissive: 0xd81b60,
    emissiveIntensity: 0.35,
    roughness: 0.35,
  });
  const toadCreamMat = new MeshStandardMaterial({
    color: 0xfff8e7,
    roughness: 0.6,
  });

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.22;
    const rOuter = R + 0.95 + hash01(i * 3.1) * 1.4;
    const x = Math.cos(a) * rOuter;
    const z = Math.sin(a) * rOuter;
    if (isInPathway(x, z, 3.0, 2.4)) continue;

    // Woodland boulder + moss cap
    const rock = new Mesh(boulderGeo, boulderMat);
    const s = 0.72 + hash01(i * 7.3) * 0.55;
    rock.scale.set(s * 1.15, s * 0.68, s);
    rock.position.set(x, 0.24 * s, z);
    rock.rotation.y = i * 1.1;
    group.add(rock);

    const mossTop = new Mesh(mossCapGeo, mossMat);
    mossTop.scale.setScalar(s * 1.4);
    mossTop.position.set(x, 0.48 * s, z);
    group.add(mossTop);

    // Rainforest fern rosette
    const fernGrp = new Group();
    fernGrp.position.set(x + Math.cos(a + 0.5) * 0.9, 0, z + Math.sin(a + 0.5) * 0.9);
    for (let b = 0; b < 5; b++) {
      const ba = (b / 5) * Math.PI * 2;
      const blade = new Mesh(fernBladeGeo, fernMat);
      blade.position.set(Math.cos(ba) * 0.28, 0.36, Math.sin(ba) * 0.28);
      blade.rotation.y = -ba + Math.PI / 2;
      blade.rotation.x = 0.78;
      fernGrp.add(blade);
    }
    group.add(fernGrp);
    ctx.swayProps.push({
      obj: fernGrp,
      axis: 'x',
      baseRot: 0,
      amplitude: 0.06,
      speed: 2.1,
      phase: i * 0.7,
    });

    // Clustered woodland toadstools (3 per cluster)
    if (i % 2 === 1) {
      for (let t = 0; t < 3; t++) {
        const ta = a - 0.14 + t * 0.08;
        const tr = rOuter - 1.15 + (t % 2) * 0.35;
        const tx = Math.cos(ta) * tr;
        const tz = Math.sin(ta) * tr;
        if (isInPathway(tx, tz, 3.0, 2.4)) continue;
        const ts = 0.7 + t * 0.25;
        const stem = new Mesh(toadStemGeo, toadCreamMat);
        stem.scale.setScalar(ts);
        stem.position.set(tx, 0.21 * ts, tz);
        const cap = new Mesh(toadCapGeo, toadMat);
        cap.scale.setScalar(ts);
        cap.position.set(tx, 0.42 * ts, tz);
        group.add(stem, cap);
      }
    }
  }

  return ctx.handle;
}

/**
 * 3. `crystal` (160,0 / -160,0 / 140,140 — Glacial Frost Tundra):
 * Mirror-smooth frozen ice lake terrace with radial frost cracks, jagged snowdrifts &
 * frost-covered dark slate boulders, ring of carved ice-stone obelisks & crystalline frost
 * arches, glowing blue glacial braziers, low frost-mist ring.
 */
function buildCrystalTundraPrecinct(shelter: ShelterHouse): CastlePrecinctHandle {
  const group = new Group();
  group.name = 'precinct_crystal';
  const ctx = createMutableHandle('crystal', group);
  const R = Math.max(12, shelter.radius);
  const accent = shelter.colorHex || 0x00e5ff;

  const iceLakeMat = new MeshStandardMaterial({
    color: 0xcfefff,
    emissive: accent,
    emissiveIntensity: 0.18,
    roughness: 0.08,
    metalness: 0.48,
    transparent: true,
    opacity: 0.88,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const crackMat = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.62,
    side: DoubleSide,
    depthWrite: false,
  });
  const snowMat = new MeshStandardMaterial({
    color: 0xf4fbff,
    emissive: 0x90caf9,
    emissiveIntensity: 0.14,
    roughness: 0.72,
  });
  const slateMat = new MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.82,
    metalness: 0.18,
  });
  const iceCrystalMat = new MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: 0.65,
    roughness: 0.12,
    metalness: 0.3,
    transparent: true,
    opacity: 0.88,
  });
  const mistMat = new MeshBasicMaterial({
    color: 0xdff6ff,
    transparent: true,
    opacity: 0.22,
    side: DoubleSide,
    depthWrite: false,
  });

  // Mirror-smooth frozen ice lake terrace (r = 8.6 .. R + 2.4)
  const lakeRing = new Mesh(new RingGeometry(8.6, R + 2.4, 36), iceLakeMat);
  lakeRing.rotation.x = -Math.PI / 2;
  lakeRing.position.y = 0.011;
  group.add(lakeRing);

  // Radial frost cracks across the frozen terrace
  const crackGeo = new BoxGeometry(0.06, 0.008, R - 6.2);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.15;
    const crack = new Mesh(crackGeo, crackMat);
    const rMid = 8.8 + (R - 6.2) * 0.5;
    crack.position.set(Math.cos(a) * rMid, 0.016, Math.sin(a) * rMid);
    crack.rotation.y = -a + Math.PI / 2 + (i % 2 === 0 ? 0.08 : -0.08);
    group.add(crack);
  }

  // Twin crystalline frost arches framing the front (+Z) approach (wide 5.2u clearance)
  const archPillarGeo = new ConeGeometry(0.42, 3.0, 6);
  const archSpanGeo = new TorusGeometry(2.6, 0.16, 6, 18, Math.PI);
  const archGroup = new Group();
  archGroup.position.set(0, 0, R - 2.6);
  for (const side of [-1, 1] as const) {
    const pillar = new Mesh(archPillarGeo, iceCrystalMat);
    pillar.position.set(side * 2.6, 1.5, 0);
    archGroup.add(pillar);
  }
  const archTop = new Mesh(archSpanGeo, iceCrystalMat);
  archTop.position.set(0, 2.75, 0);
  archGroup.add(archTop);
  group.add(archGroup);

  // Ring of carved ice-stone obelisks & glowing blue glacial braziers around r = R - 1.2
  const obeliskBodyGeo = new CylinderGeometry(0.24, 0.4, 1.9, 6);
  const obeliskTipGeo = new ConeGeometry(0.26, 0.65, 6);
  const brazierBowlGeo = new CylinderGeometry(0.45, 0.25, 0.52, 8);
  const flameGeo = new OctahedronGeometry(0.28, 0);
  flameGeo.scale(0.8, 1.4, 0.8);

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.26;
    if (isCardinalCorridor(a, 0.34)) continue;
    const rRing = R - 1.1;
    const ox = Math.cos(a) * rRing;
    const oz = Math.sin(a) * rRing;

    if (i % 2 === 0) {
      const obBase = new Mesh(obeliskBodyGeo, slateMat);
      obBase.position.set(ox, 0.95, oz);
      const obTip = new Mesh(obeliskTipGeo, iceCrystalMat);
      obTip.position.set(ox, 2.22, oz);
      group.add(obBase, obTip);
    } else {
      const bowl = new Mesh(brazierBowlGeo, slateMat);
      bowl.position.set(ox, 0.26, oz);
      const flameMat = new MeshStandardMaterial({
        color: 0xe0ffff,
        emissive: 0x00e5ff,
        emissiveIntensity: 1.0,
        roughness: 0.1,
      });
      const flame = new Mesh(flameGeo, flameMat);
      flame.position.set(ox, 0.72, oz);
      group.add(bowl, flame);
      ctx.glowOrbs.push({
        mat: flameMat,
        baseIntensity: 0.95,
        amplitude: 0.28,
        speed: 4.2,
        phase: i * 1.1,
      });
      ctx.bobItems.push({
        mesh: flame,
        baseY: 0.72,
        amplitude: 0.08,
        speed: 3.4,
        phase: i * 0.9,
      });
    }
  }

  // Jagged snowdrifts & frost-covered dark slate boulders around r = R + 0.8 .. R + 2.8
  const snowdriftGeo = new SphereGeometry(1.15, 10, 8);
  const rockGeo = new DodecahedronGeometry(0.74, 0);
  const frostCapGeo = new ConeGeometry(0.56, 0.35, 6);

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.18;
    const rOut = R + 1.0 + hash01(i * 5.2) * 1.6;
    const x = Math.cos(a) * rOut;
    const z = Math.sin(a) * rOut;
    if (isInPathway(x, z, 3.0, 2.4)) continue;

    const drift = new Mesh(snowdriftGeo, snowMat);
    drift.scale.set(1.45, 0.32, 0.85);
    drift.position.set(x, 0.14, z);
    drift.rotation.y = -a + Math.PI / 2;
    group.add(drift);

    if (i % 2 === 0) {
      const bx = Math.cos(a + 0.12) * (rOut - 0.5);
      const bz = Math.sin(a + 0.12) * (rOut - 0.5);
      if (!isInPathway(bx, bz, 3.0, 2.4)) {
        const rock = new Mesh(rockGeo, slateMat);
        rock.scale.set(1.1, 0.75, 0.95);
        rock.position.set(bx, 0.34, bz);
        rock.rotation.y = i * 0.8;
        const frost = new Mesh(frostCapGeo, snowMat);
        frost.position.set(bx, 0.74, bz);
        group.add(rock, frost);
      }
    }
  }

  // Low frost-mist ring hovering gently around the tundra perimeter
  const mistRing = new Mesh(new RingGeometry(R - 1.2, R + 2.6, 40), mistMat);
  mistRing.rotation.x = -Math.PI / 2;
  mistRing.position.y = 0.22;
  group.add(mistRing);
  ctx.mistRings.push({
    mesh: mistRing,
    baseY: 0.22,
    baseOpacity: 0.22,
    rotateSpeed: 0.08,
    phase: 0.4,
  });

  return ctx.handle;
}

/**
 * 4. `mermaid` (-180,120 — Tropical Coastal Lagoon Cove):
 * Golden sandy beach terrace surrounded by shallow crystal-turquoise lagoon water with
 * animated foam wave ring, weathered sea-rocks & tide-pools, curved coastal palm trees
 * framing the back arc, swaying kelp/sea-fan clusters, giant pearl shells, coral-arch
 * entrance pillars.
 */
function buildMermaidLagoonPrecinct(shelter: ShelterHouse): CastlePrecinctHandle {
  const group = new Group();
  group.name = 'precinct_mermaid';
  const ctx = createMutableHandle('mermaid', group);
  const R = Math.max(13, shelter.radius);

  const sandMat = new MeshStandardMaterial({
    color: 0xf4d898,
    emissive: 0x8a6d3b,
    emissiveIntensity: 0.1,
    roughness: 0.85,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const lagoonMat = new MeshStandardMaterial({
    color: 0x16d9e8,
    emissive: 0x0097a7,
    emissiveIntensity: 0.32,
    roughness: 0.14,
    metalness: 0.28,
    transparent: true,
    opacity: 0.82,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const foamMat = new MeshBasicMaterial({
    color: 0xebffff,
    transparent: true,
    opacity: 0.56,
    side: DoubleSide,
    depthWrite: false,
  });
  const seaRockMat = new MeshStandardMaterial({
    color: 0x62727b,
    roughness: 0.86,
  });
  const coralMat = new MeshStandardMaterial({
    color: 0xff6b8b,
    emissive: 0xff4081,
    emissiveIntensity: 0.38,
    roughness: 0.38,
  });
  const palmTrunkMat = new MeshStandardMaterial({
    color: 0x8d5b3c,
    roughness: 0.85,
  });
  const palmLeafMat = new MeshStandardMaterial({
    color: 0x2ea043,
    emissive: 0x14532d,
    emissiveIntensity: 0.2,
    roughness: 0.55,
    side: DoubleSide,
  });
  const kelpMat = new MeshStandardMaterial({
    color: 0x1abc9c,
    emissive: 0x0e7490,
    emissiveIntensity: 0.3,
    roughness: 0.45,
    side: DoubleSide,
  });
  const shellMat = new MeshStandardMaterial({
    color: 0xfff0f5,
    emissive: 0x00bcd4,
    emissiveIntensity: 0.18,
    roughness: 0.25,
    metalness: 0.25,
  });

  // Golden sandy beach terrace (r = 10.6 .. 13.4)
  const sandTerrace = new Mesh(new RingGeometry(10.55, 13.4, 44), sandMat);
  sandTerrace.rotation.x = -Math.PI / 2;
  sandTerrace.position.y = 0.01;
  group.add(sandTerrace);

  // Shallow crystal-turquoise lagoon water (r = 13.1 .. R + 3.6)
  const lagoonRing = new Mesh(new RingGeometry(13.1, R + 3.6, 48), lagoonMat);
  lagoonRing.rotation.x = -Math.PI / 2;
  lagoonRing.position.y = 0.013;
  group.add(lagoonRing);

  // Animated foam wave rings along shoreline and outer lagoon
  const innerFoam = new Mesh(new RingGeometry(13.0, 13.55, 48), foamMat);
  innerFoam.rotation.x = -Math.PI / 2;
  innerFoam.position.y = 0.017;
  group.add(innerFoam);
  ctx.waveRings.push({
    mesh: innerFoam,
    baseScale: 1.0,
    baseOpacity: 0.58,
    speed: 2.1,
    phase: 0,
  });

  const outerFoam = new Mesh(new RingGeometry(R + 1.4, R + 2.0, 48), foamMat);
  outerFoam.rotation.x = -Math.PI / 2;
  outerFoam.position.y = 0.017;
  group.add(outerFoam);
  ctx.waveRings.push({
    mesh: outerFoam,
    baseScale: 1.0,
    baseOpacity: 0.45,
    speed: 1.8,
    phase: Math.PI * 0.7,
  });

  // Coral-arch entrance pillars flanking +Z path (wide 5.4u entryway)
  const pillarGeo = new CylinderGeometry(0.32, 0.45, 2.7, 10);
  const coralArchGeo = new TorusGeometry(2.7, 0.17, 8, 22, Math.PI);
  const orbGeo = new SphereGeometry(0.28, 10, 8);
  const gateArch = new Group();
  gateArch.position.set(0, 0, 12.2);
  for (const side of [-1, 1] as const) {
    const pillar = new Mesh(pillarGeo, coralMat);
    pillar.position.set(side * 2.7, 1.35, 0);
    const orbMat = new MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x00e5ff,
      emissiveIntensity: 0.9,
      roughness: 0.12,
    });
    const orb = new Mesh(orbGeo, orbMat);
    orb.position.set(side * 2.7, 2.85, 0);
    gateArch.add(pillar, orb);
    ctx.glowOrbs.push({
      mat: orbMat,
      baseIntensity: 0.88,
      amplitude: 0.22,
      speed: 2.8,
      phase: side,
    });
  }
  const archSpan = new Mesh(coralArchGeo, coralMat);
  archSpan.position.set(0, 2.6, 0);
  gateArch.add(archSpan);
  group.add(gateArch);

  // Giant pearl shells nestled along the sandy beach terrace
  const shellCupGeo = new SphereGeometry(0.65, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  shellCupGeo.scale(1.2, 0.42, 1.0);
  const pearlOrbGeo = new SphereGeometry(0.24, 10, 8);
  const pearlOrbMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x7ef8ff,
    emissiveIntensity: 0.85,
    roughness: 0.1,
  });
  const shellAngles = [Math.PI * 0.28, Math.PI * 0.72, Math.PI * 1.25, Math.PI * 1.75];
  for (let i = 0; i < shellAngles.length; i++) {
    const a = shellAngles[i]!;
    const sr = 12.1;
    const sx = Math.cos(a) * sr;
    const sz = Math.sin(a) * sr;
    const bottom = new Mesh(shellCupGeo, shellMat);
    bottom.rotation.x = Math.PI;
    bottom.position.set(sx, 0.24, sz);
    const lid = new Mesh(shellCupGeo, shellMat);
    lid.position.set(sx, 0.36, sz);
    lid.rotation.y = -a;
    lid.rotation.x = -0.55;
    const pearl = new Mesh(pearlOrbGeo, pearlOrbMat);
    pearl.position.set(sx, 0.32, sz);
    group.add(bottom, lid, pearl);
  }

  // Weathered sea-rocks, tide-pools & swaying kelp/sea-fan clusters in the lagoon
  const rockGeo = new DodecahedronGeometry(0.75, 0);
  const tidePoolGeo = new CircleGeometry(1.15, 16);
  const kelpBladeGeo = new BoxGeometry(0.18, 1.35, 0.05);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.24;
    const r = R + 0.4 + hash01(i * 4.7) * 2.0;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (isInPathway(x, z, 3.1, 2.5)) continue;

    const rock = new Mesh(rockGeo, seaRockMat);
    const s = 0.7 + hash01(i * 9.1) * 0.65;
    rock.scale.set(s * 1.3, s * 0.6, s);
    rock.position.set(x, 0.22 * s, z);
    rock.rotation.y = i * 1.4;
    group.add(rock);

    if (i % 2 === 0) {
      const tp = new Mesh(tidePoolGeo, lagoonMat);
      tp.rotation.x = -Math.PI / 2;
      tp.position.set(x * 0.9, 0.016, z * 0.9);
      group.add(tp);
    }

    // Swaying kelp / sea-fan cluster
    const kelpGrp = new Group();
    kelpGrp.position.set(x * 0.92, 0, z * 0.92);
    for (let k = 0; k < 3; k++) {
      const stalk = new Mesh(kelpBladeGeo, k === 1 ? coralMat : kelpMat);
      stalk.position.set((k - 1) * 0.22, 0.65, (k % 2) * 0.15);
      stalk.rotation.z = (k - 1) * 0.18;
      kelpGrp.add(stalk);
    }
    group.add(kelpGrp);
    ctx.swayProps.push({
      obj: kelpGrp,
      axis: 'z',
      baseRot: 0,
      amplitude: 0.14,
      speed: 2.2,
      phase: i * 0.9,
    });
  }

  // Curved coastal palm trees framing the back arc (-Z hemisphere)
  const trunkSegGeo = new CylinderGeometry(0.16, 0.22, 1.35, 8);
  const frondGeo = new ConeGeometry(0.45, 2.3, 4);
  frondGeo.scale(1, 1, 0.18);
  const palmAngles = [Math.PI * 1.18, Math.PI * 1.38, Math.PI * 1.62, Math.PI * 1.82];
  for (let i = 0; i < palmAngles.length; i++) {
    const a = palmAngles[i]!;
    const pr = R + 1.4;
    const palm = new Group();
    palm.position.set(Math.cos(a) * pr, 0, Math.sin(a) * pr);
    palm.rotation.y = -a + Math.PI / 2;

    const seg1 = new Mesh(trunkSegGeo, palmTrunkMat);
    seg1.position.set(0, 0.65, 0);
    seg1.rotation.z = 0.14;
    const seg2 = new Mesh(trunkSegGeo, palmTrunkMat);
    seg2.position.set(-0.22, 1.9, 0);
    seg2.rotation.z = 0.26;
    const seg3 = new Mesh(trunkSegGeo, palmTrunkMat);
    seg3.position.set(-0.56, 3.05, 0);
    seg3.rotation.z = 0.34;
    palm.add(seg1, seg2, seg3);

    const crown = new Group();
    crown.position.set(-0.78, 3.65, 0);
    for (let f = 0; f < 6; f++) {
      const fa = (f / 6) * Math.PI * 2;
      const frond = new Mesh(frondGeo, palmLeafMat);
      frond.position.set(Math.cos(fa) * 0.95, -0.15, Math.sin(fa) * 0.95);
      frond.rotation.y = -fa + Math.PI / 2;
      frond.rotation.x = 1.18;
      crown.add(frond);
    }
    palm.add(crown);
    group.add(palm);

    ctx.swayProps.push({
      obj: crown,
      axis: 'z',
      baseRot: 0,
      amplitude: 0.08,
      speed: 1.7,
      phase: i * 1.1,
    });
  }

  return ctx.handle;
}

/**
 * 5. `candy` (180,-120 — Sunlit Golden-Pastel Orchard Courtyard):
 * Warm cobblestone & cream-stone radial plaza, manicured pastel-berry hedges & golden-peach
 * blossom orchard shrubs, charming striped courtyard gazebos/pergolas, caramel-stone
 * stepping avenue, glowing honey-orb lamp posts.
 */
function buildCandyOrchardPrecinct(shelter: ShelterHouse): CastlePrecinctHandle {
  const group = new Group();
  group.name = 'precinct_candy';
  const ctx = createMutableHandle('candy', group);
  const R = Math.max(13, shelter.radius);

  const creamStoneMat = new MeshStandardMaterial({
    color: 0xfff1dc,
    emissive: 0xffe0b2,
    emissiveIntensity: 0.14,
    roughness: 0.65,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const caramelMat = new MeshStandardMaterial({
    color: 0xd98a4e,
    emissive: 0x8d4e1f,
    emissiveIntensity: 0.14,
    roughness: 0.55,
  });
  const hedgeLeafMat = new MeshStandardMaterial({
    color: 0x66bb6a,
    emissive: 0x2e7d32,
    emissiveIntensity: 0.2,
    roughness: 0.65,
  });
  const berryPinkMat = new MeshStandardMaterial({
    color: 0xff6b9d,
    emissive: 0xff4081,
    emissiveIntensity: 0.45,
    roughness: 0.25,
  });
  const peachBlossomMat = new MeshStandardMaterial({
    color: 0xffb38a,
    emissive: 0xff8a65,
    emissiveIntensity: 0.38,
    roughness: 0.35,
  });
  const mintStripeMat = new MeshStandardMaterial({
    color: 0x80cbc4,
    emissive: 0x26a69a,
    emissiveIntensity: 0.22,
    roughness: 0.38,
  });

  // Warm cobblestone & cream-stone radial plaza (r = 10.1 .. R + 0.8)
  const plazaRing = new Mesh(new RingGeometry(10.05, R + 0.8, 40), creamStoneMat);
  plazaRing.rotation.x = -Math.PI / 2;
  plazaRing.position.y = 0.01;
  group.add(plazaRing);

  const plazaCurb = new Mesh(new TorusGeometry(R + 0.82, 0.14, 8, 44), caramelMat);
  plazaCurb.rotation.x = Math.PI / 2;
  plazaCurb.scale.set(1, 1, 0.55);
  plazaCurb.position.y = 0.05;
  group.add(plazaCurb);

  // Caramel-stone stepping avenue along +Z entrance and side paths
  const stepStoneGeo = new CylinderGeometry(0.95, 1.05, 0.09, 10);
  for (let i = 0; i < 6; i++) {
    const sz = 10.7 + i * 1.45;
    if (sz > R + 3.6) break;
    const st = new Mesh(stepStoneGeo, caramelMat);
    st.scale.set(1.45, 1, 0.82);
    st.position.set(Math.sin(i * 0.9) * 0.32, 0.035, sz);
    group.add(st);
  }
  const sideStepGeo = new CylinderGeometry(0.72, 0.8, 0.08, 10);
  for (const angle of [0, Math.PI, -Math.PI / 2] as const) {
    for (let i = 0; i < 4; i++) {
      const sr = 11.2 + i * 1.55;
      if (sr > R + 3.2) break;
      const st = new Mesh(sideStepGeo, caramelMat);
      st.position.set(Math.cos(angle) * sr, 0.032, Math.sin(angle) * sr);
      group.add(st);
    }
  }

  // Manicured pastel-berry hedges along r = R - 1.6
  const hedgeGeo = new BoxGeometry(2.1, 0.48, 0.72);
  const berryGeo = new SphereGeometry(0.14, 8, 6);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.35;
    if (isCardinalCorridor(a, 0.34)) continue;
    const hr = R - 1.65;
    const hx = Math.cos(a) * hr;
    const hz = Math.sin(a) * hr;

    const hedge = new Mesh(hedgeGeo, hedgeLeafMat);
    hedge.position.set(hx, 0.24, hz);
    hedge.rotation.y = -a + Math.PI / 2;
    group.add(hedge);

    for (let b = -1; b <= 1; b++) {
      const berry = new Mesh(berryGeo, b === 0 ? peachBlossomMat : berryPinkMat);
      berry.position.set(
        hx + Math.cos(a + Math.PI / 2) * b * 0.58,
        0.5,
        hz + Math.sin(a + Math.PI / 2) * b * 0.58,
      );
      group.add(berry);
    }
  }

  // Charming striped courtyard gazebos/pergolas in back diagonal gardens
  const gazeboColGeo = new CylinderGeometry(0.12, 0.14, 2.1, 8);
  const gazeboRoofGeo = new ConeGeometry(1.75, 1.15, 8);
  const gazeboRingGeo = new TorusGeometry(1.45, 0.11, 6, 16);
  const gazeboAngles = [Math.PI * 1.24, Math.PI * 1.76];
  for (let g = 0; g < gazeboAngles.length; g++) {
    const ga = gazeboAngles[g]!;
    const gr = R - 0.6;
    const gzGrp = new Group();
    gzGrp.position.set(Math.cos(ga) * gr, 0, Math.sin(ga) * gr);

    for (let c = 0; c < 4; c++) {
      const ca = (c / 4) * Math.PI * 2 + Math.PI / 4;
      const col = new Mesh(gazeboColGeo, creamStoneMat);
      col.position.set(Math.cos(ca) * 1.15, 1.05, Math.sin(ca) * 1.15);
      gzGrp.add(col);
    }
    const roof = new Mesh(gazeboRoofGeo, g === 0 ? berryPinkMat : mintStripeMat);
    roof.position.y = 2.65;
    const trim = new Mesh(gazeboRingGeo, caramelMat);
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 2.1;
    gzGrp.add(roof, trim);
    group.add(gzGrp);
  }

  // Glowing honey-orb lamp posts flanking +Z avenue and diagonal plaza
  const postGeo = new CylinderGeometry(0.08, 0.12, 1.75, 8);
  const honeyOrbGeo = new SphereGeometry(0.26, 10, 8);
  const lampPositions: readonly [number, number][] = [
    [-2.4, 12.2],
    [2.4, 12.2],
    [-2.4, R + 1.2],
    [2.4, R + 1.2],
    [Math.cos(Math.PI * 0.25) * (R - 0.4), Math.sin(Math.PI * 0.25) * (R - 0.4)],
    [Math.cos(Math.PI * 0.75) * (R - 0.4), Math.sin(Math.PI * 0.75) * (R - 0.4)],
  ];
  for (let i = 0; i < lampPositions.length; i++) {
    const [lx, lz] = lampPositions[i]!;
    const orbMat = new MeshStandardMaterial({
      color: 0xfff8e1,
      emissive: 0xffb300,
      emissiveIntensity: 0.92,
      roughness: 0.15,
    });
    const post = new Mesh(postGeo, caramelMat);
    post.position.set(lx, 0.88, lz);
    const orb = new Mesh(honeyOrbGeo, orbMat);
    orb.position.set(lx, 1.88, lz);
    group.add(post, orb);

    ctx.glowOrbs.push({
      mat: orbMat,
      baseIntensity: 0.9,
      amplitude: 0.22,
      speed: 2.9,
      phase: i * 0.85,
    });
  }

  // Golden-peach blossom orchard shrubs around outer perimeter (r = R + 1.2 .. R + 2.8)
  const shrubGeo = new SphereGeometry(0.85, 10, 8);
  const blossomGeo = new SphereGeometry(0.22, 8, 6);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.18;
    const r = R + 1.5 + hash01(i * 6.4) * 1.1;
    const sx = Math.cos(a) * r;
    const sz = Math.sin(a) * r;
    if (isInPathway(sx, sz, 3.0, 2.4)) continue;

    const shrub = new Mesh(shrubGeo, hedgeLeafMat);
    shrub.scale.set(1.15, 0.82, 1.15);
    shrub.position.set(sx, 0.45, sz);
    group.add(shrub);

    for (let k = 0; k < 4; k++) {
      const ka = (k / 4) * Math.PI * 2 + i;
      const fl = new Mesh(blossomGeo, peachBlossomMat);
      fl.position.set(sx + Math.cos(ka) * 0.62, 0.72 + (k % 2) * 0.22, sz + Math.sin(ka) * 0.62);
      group.add(fl);
    }
  }

  return ctx.handle;
}

/**
 * 6. `blossom` (-120,-180 — Spring Sakura Zen Garden):
 * Tranquil curved lotus pond with floating green lily pads & pink lotus flowers, arching
 * red-lacquer wooden garden bridge at the entrance approach, carved mossy stone lanterns (`toro`),
 * raked gravel garden border, weeping cherry-blossom trees framing the sanctuary, drifts of
 * fallen pink petals.
 */
function buildBlossomZenPrecinct(shelter: ShelterHouse): CastlePrecinctHandle {
  const group = new Group();
  group.name = 'precinct_blossom';
  const ctx = createMutableHandle('blossom', group);
  const R = Math.max(12, shelter.radius);

  const pondMat = new MeshStandardMaterial({
    color: 0x3ec6bd,
    emissive: 0x0f766e,
    emissiveIntensity: 0.34,
    roughness: 0.12,
    metalness: 0.35,
    transparent: true,
    opacity: 0.86,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const pondShimmerMat = new MeshBasicMaterial({
    color: 0xdffef9,
    transparent: true,
    opacity: 0.38,
    side: DoubleSide,
    depthWrite: false,
  });
  const gravelMat = new MeshStandardMaterial({
    color: 0xe6e0d4,
    roughness: 0.9,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const rakeLineMat = new MeshBasicMaterial({
    color: 0xcbc2b4,
    transparent: true,
    opacity: 0.6,
    side: DoubleSide,
    depthWrite: false,
  });
  const lacquerRedMat = new MeshStandardMaterial({
    color: 0xc62828,
    emissive: 0x7f1d1d,
    emissiveIntensity: 0.22,
    roughness: 0.35,
  });
  const graniteMat = new MeshStandardMaterial({
    color: 0x8c8d8e,
    roughness: 0.88,
  });
  const lilyMat = new MeshStandardMaterial({
    color: 0x4caf50,
    emissive: 0x1b5e20,
    emissiveIntensity: 0.2,
    roughness: 0.65,
    side: DoubleSide,
  });
  const lotusMat = new MeshStandardMaterial({
    color: 0xff85c0,
    emissive: 0xff4081,
    emissiveIntensity: 0.45,
    roughness: 0.3,
  });
  const sakuraBarkMat = new MeshStandardMaterial({
    color: 0x4a312c,
    roughness: 0.88,
  });
  const sakuraCanopyMat = new MeshStandardMaterial({
    color: 0xffa6d0,
    emissive: 0xff69b4,
    emissiveIntensity: 0.32,
    roughness: 0.5,
  });
  const petalDriftMat = new MeshBasicMaterial({
    color: 0xffb7dc,
    transparent: true,
    opacity: 0.72,
    side: DoubleSide,
    depthWrite: false,
  });

  // Tranquil curved lotus pond (r = 10.1 .. 13.1)
  const pond = new Mesh(new RingGeometry(10.05, 13.1, 48), pondMat);
  pond.rotation.x = -Math.PI / 2;
  pond.position.y = 0.011;
  group.add(pond);

  const pondShimmer = new Mesh(new RingGeometry(10.6, 12.5, 44), pondShimmerMat);
  pondShimmer.rotation.x = -Math.PI / 2;
  pondShimmer.position.y = 0.016;
  group.add(pondShimmer);
  ctx.shimmerRings.push({
    mesh: pondShimmer,
    baseOpacity: 0.36,
    speed: 1.9,
    phase: 0.3,
    rotateSpeed: 0.08,
  });

  // Raked gravel garden border (r = 13.1 .. R + 2.4)
  const gravel = new Mesh(new RingGeometry(13.05, R + 2.4, 48), gravelMat);
  gravel.rotation.x = -Math.PI / 2;
  gravel.position.y = 0.009;
  group.add(gravel);

  for (let k = 0; k < 3; k++) {
    const rLine = 13.6 + k * 0.9;
    const rake = new Mesh(new RingGeometry(rLine, rLine + 0.08, 48), rakeLineMat);
    rake.rotation.x = -Math.PI / 2;
    rake.position.y = 0.014;
    group.add(rake);
  }

  // Floating green lily pads & pink lotus flowers on the pond
  const lilyGeo = new CircleGeometry(0.56, 14, 0.25, Math.PI * 1.82);
  const lotusGeo = new ConeGeometry(0.24, 0.32, 7);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.22;
    if (isCardinalCorridor(a, 0.32)) continue;
    const lr = 11.1 + (i % 2) * 1.05;
    const lx = Math.cos(a) * lr;
    const lz = Math.sin(a) * lr;

    const pad = new Mesh(lilyGeo, lilyMat);
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = i * 1.2;
    pad.position.set(lx, 0.022, lz);
    group.add(pad);

    if (i % 2 === 0) {
      const lotus = new Mesh(lotusGeo, lotusMat);
      lotus.rotation.x = Math.PI;
      lotus.position.set(lx, 0.18, lz);
      group.add(lotus);
      ctx.bobItems.push({
        mesh: lotus,
        baseY: 0.18,
        amplitude: 0.04,
        speed: 2.4,
        phase: i * 0.7,
      });
    }
  }

  // Arching red-lacquer wooden garden bridge at the +Z entrance approach (z = 9.9 .. 13.3)
  const bridge = new Group();
  bridge.position.set(0, 0, 11.55);
  const deckGeo = new BoxGeometry(2.8, 0.13, 0.56);
  for (let p = -3; p <= 3; p++) {
    const t = p / 3;
    const plank = new Mesh(deckGeo, lacquerRedMat);
    plank.position.set(0, 0.38 - t * t * 0.26, p * 0.54);
    plank.rotation.x = t * 0.16;
    bridge.add(plank);
  }
  const bRailGeo = new BoxGeometry(0.12, 0.1, 3.8);
  const bPostGeo = new CylinderGeometry(0.08, 0.1, 0.65, 8);
  for (const side of [-1, 1] as const) {
    const rail = new Mesh(bRailGeo, lacquerRedMat);
    rail.position.set(side * 1.38, 0.68, 0);
    bridge.add(rail);
    for (const pz of [-1.55, 0, 1.55] as const) {
      const post = new Mesh(bPostGeo, lacquerRedMat);
      post.position.set(side * 1.38, pz === 0 ? 0.62 : 0.45, pz);
      bridge.add(post);
    }
  }
  group.add(bridge);

  // Carved mossy stone lanterns (toro)
  const toroBaseGeo = new CylinderGeometry(0.28, 0.36, 0.35, 6);
  const toroShaftGeo = new CylinderGeometry(0.15, 0.18, 0.65, 6);
  const toroBoxGeo = new BoxGeometry(0.36, 0.34, 0.36);
  const toroRoofGeo = new ConeGeometry(0.52, 0.34, 6);
  const toroAngles = [
    Math.PI * 0.38,
    Math.PI * 0.62,
    Math.PI * 0.88,
    Math.PI * 1.12,
    Math.PI * 1.88,
    Math.PI * 0.12,
  ];
  for (let i = 0; i < toroAngles.length; i++) {
    const a = toroAngles[i]!;
    const tr = 13.9;
    const tx = Math.cos(a) * tr;
    const tz = Math.sin(a) * tr;
    if (isInPathway(tx, tz, 2.7, 2.2)) continue;

    const base = new Mesh(toroBaseGeo, graniteMat);
    base.position.set(tx, 0.18, tz);
    const shaft = new Mesh(toroShaftGeo, graniteMat);
    shaft.position.set(tx, 0.68, tz);
    const lanternMat = new MeshStandardMaterial({
      color: 0xfff8e1,
      emissive: 0xffb74d,
      emissiveIntensity: 0.88,
      roughness: 0.25,
    });
    const box = new Mesh(toroBoxGeo, lanternMat);
    box.position.set(tx, 1.16, tz);
    const roof = new Mesh(toroRoofGeo, graniteMat);
    roof.position.set(tx, 1.48, tz);
    group.add(base, shaft, box, roof);

    ctx.glowOrbs.push({
      mat: lanternMat,
      baseIntensity: 0.86,
      amplitude: 0.2,
      speed: 3.0,
      phase: i * 1.2,
    });
  }

  // Weeping cherry-blossom trees framing the back & outer diagonal sanctuary
  const sakuraTrunkGeo = new CylinderGeometry(0.18, 0.28, 2.2, 8);
  const sakuraDomeGeo = new SphereGeometry(1.55, 12, 10);
  const sakuraWeepGeo = new ConeGeometry(0.45, 1.5, 6);
  const treeAngles = [Math.PI * 1.18, Math.PI * 1.42, Math.PI * 1.58, Math.PI * 1.82];
  for (let i = 0; i < treeAngles.length; i++) {
    const a = treeAngles[i]!;
    const tr = R + 1.55;
    const tree = new Group();
    tree.position.set(Math.cos(a) * tr, 0, Math.sin(a) * tr);

    const trunk = new Mesh(sakuraTrunkGeo, sakuraBarkMat);
    trunk.position.y = 1.1;
    trunk.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.12;
    tree.add(trunk);

    const canopy = new Group();
    canopy.position.set(0, 2.45, 0);
    const puff = new Mesh(sakuraDomeGeo, sakuraCanopyMat);
    puff.scale.set(1.2, 0.72, 1.2);
    canopy.add(puff);
    for (let w = 0; w < 4; w++) {
      const wa = (w / 4) * Math.PI * 2 + 0.4;
      const weep = new Mesh(sakuraWeepGeo, sakuraCanopyMat);
      weep.rotation.x = Math.PI;
      weep.position.set(Math.cos(wa) * 1.05, -0.55, Math.sin(wa) * 1.05);
      canopy.add(weep);
    }
    tree.add(canopy);
    group.add(tree);

    ctx.swayProps.push({
      obj: canopy,
      axis: 'z',
      baseRot: 0,
      amplitude: 0.06,
      speed: 1.6,
      phase: i * 1.0,
    });
  }

  // Drifts of fallen pink sakura petals
  const driftGeo = new CircleGeometry(0.9, 12);
  driftGeo.scale(1.5, 0.75, 1);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const dr = R + 0.4 + hash01(i * 4.1) * 1.8;
    const dx = Math.cos(a) * dr;
    const dz = Math.sin(a) * dr;
    if (isInPathway(dx, dz, 3.0, 2.4)) continue;
    const drift = new Mesh(driftGeo, petalDriftMat);
    drift.rotation.x = -Math.PI / 2;
    drift.rotation.z = i * 0.7;
    drift.position.set(dx, 0.017, dz);
    group.add(drift);
  }

  return ctx.handle;
}

/**
 * 7. `starlight` (120,180 — Alpine Observatory Peak):
 * Stepped dark-slate alpine terrace, outer ring of ancient standing stones carved with glowing
 * starlight runes, gilded astronomical armillary/sundial pedestals, frost-rimmed mountain crags,
 * mirror starlight reflecting pool, low drifting alpine cloud mist ring.
 */
function buildStarlightPeakPrecinct(shelter: ShelterHouse): CastlePrecinctHandle {
  const group = new Group();
  group.name = 'precinct_starlight';
  const ctx = createMutableHandle('starlight', group);
  const R = Math.max(12, shelter.radius);
  const cosmicViolet = shelter.colorHex || 0xb388ff;

  const slateMat = new MeshStandardMaterial({
    color: 0x252d4a,
    emissive: 0x1a1e3a,
    emissiveIntensity: 0.2,
    roughness: 0.55,
    metalness: 0.25,
  });
  const mirrorPoolMat = new MeshStandardMaterial({
    color: 0x0f172a,
    emissive: 0x312e81,
    emissiveIntensity: 0.35,
    roughness: 0.06,
    metalness: 0.82,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const goldMat = new MeshStandardMaterial({
    color: 0xffe082,
    emissive: 0xffca28,
    emissiveIntensity: 0.55,
    metalness: 0.75,
    roughness: 0.2,
  });
  const frostMat = new MeshStandardMaterial({
    color: 0xe6f2ff,
    emissive: 0x90caf9,
    emissiveIntensity: 0.18,
    roughness: 0.65,
  });
  const cloudMistMat = new MeshBasicMaterial({
    color: 0xc4b5fd,
    transparent: true,
    opacity: 0.2,
    side: DoubleSide,
    depthWrite: false,
  });

  // Stepped dark-slate alpine terrace (r = 9.7 .. 13.3)
  const terraceDisc = new Mesh(new CylinderGeometry(13.3, 13.8, 0.22, 12), slateMat);
  terraceDisc.position.y = 0.11;
  group.add(terraceDisc);

  // Mirror starlight reflecting pool ring atop the terrace (r = 10.2 .. 12.6)
  const mirrorPool = new Mesh(new RingGeometry(10.2, 12.6, 36), mirrorPoolMat);
  mirrorPool.rotation.x = -Math.PI / 2;
  mirrorPool.position.y = 0.23;
  group.add(mirrorPool);

  const starTwinkleMat = new MeshBasicMaterial({
    color: 0xe0f7fa,
    transparent: true,
    opacity: 0.65,
    side: DoubleSide,
    depthWrite: false,
  });
  const starRing = new Mesh(new RingGeometry(11.1, 11.45, 36), starTwinkleMat);
  starRing.rotation.x = -Math.PI / 2;
  starRing.position.y = 0.235;
  group.add(starRing);
  ctx.shimmerRings.push({
    mesh: starRing,
    baseOpacity: 0.5,
    speed: 2.4,
    phase: 0.5,
    rotateSpeed: -0.1,
  });

  // Flat slate entrance causeways across the reflecting pool at +Z and cardinal paths
  const causewayGeo = new BoxGeometry(3.0, 0.12, 3.8);
  for (let i = 0; i < 4; i++) {
    const yaw = (i * Math.PI) / 2;
    const causeway = new Mesh(causewayGeo, slateMat);
    causeway.rotation.y = yaw;
    causeway.position.set(Math.sin(yaw) * 11.6, 0.22, Math.cos(yaw) * 11.6);
    group.add(causeway);
  }

  // Twin gilded astronomical armillary / sundial pedestals flanking +Z approach
  const pedColGeo = new CylinderGeometry(0.32, 0.44, 0.95, 8);
  const armRingGeo = new TorusGeometry(0.55, 0.045, 6, 20);
  const armStarGeo = new OctahedronGeometry(0.16, 0);
  for (const side of [-1, 1] as const) {
    const px = side * 4.4;
    const pz = 11.2;
    const ped = new Mesh(pedColGeo, slateMat);
    ped.position.set(px, 0.68, pz);
    const ringA = new Mesh(armRingGeo, goldMat);
    ringA.position.set(px, 1.65, pz);
    ringA.rotation.x = Math.PI * 0.3;
    const ringB = new Mesh(armRingGeo, goldMat);
    ringB.scale.setScalar(0.76);
    ringB.position.set(px, 1.65, pz);
    ringB.rotation.y = Math.PI * 0.4;
    const core = new Mesh(armStarGeo, goldMat);
    core.position.set(px, 1.65, pz);
    group.add(ped, ringA, ringB, core);

    ctx.spinRings.push({ mesh: ringA, axis: 'y', speed: 0.75 * side });
    ctx.spinRings.push({ mesh: ringB, axis: 'z', speed: -1.05 * side });
  }

  // Outer ring of ancient standing stones carved with glowing starlight runes (r = R + 0.4)
  const menhirGeo = new BoxGeometry(0.68, 1.85, 0.42);
  const runeBandGeo = new BoxGeometry(0.72, 0.24, 0.46);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.25;
    if (isCardinalCorridor(a, 0.34)) continue;
    const sr = R + 0.4;
    const sx = Math.cos(a) * sr;
    const sz = Math.sin(a) * sr;

    const stone = new Mesh(menhirGeo, slateMat);
    stone.position.set(sx, 0.92, sz);
    stone.rotation.y = -a + Math.PI / 2;
    stone.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.06;

    const runeMat = new MeshStandardMaterial({
      color: 0xe0f7fa,
      emissive: i % 2 === 0 ? cosmicViolet : 0x00e5ff,
      emissiveIntensity: 0.9,
      roughness: 0.2,
    });
    const rune = new Mesh(runeBandGeo, runeMat);
    rune.position.set(sx, 1.15, sz);
    rune.rotation.y = stone.rotation.y;
    rune.rotation.z = stone.rotation.z;
    group.add(stone, rune);

    ctx.glowOrbs.push({
      mat: runeMat,
      baseIntensity: 0.85,
      amplitude: 0.28,
      speed: 2.7,
      phase: i * 0.9,
    });
  }

  // Frost-rimmed mountain crags around outer alpine rim (r = R + 1.5 .. R + 2.9)
  const cragGeo = new ConeGeometry(0.95, 1.75, 5);
  const cragFrostGeo = new ConeGeometry(0.55, 0.7, 5);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.14;
    const cr = R + 1.7 + hash01(i * 5.8) * 1.1;
    const cx = Math.cos(a) * cr;
    const cz = Math.sin(a) * cr;
    if (isInPathway(cx, cz, 3.0, 2.4)) continue;

    const crag = new Mesh(cragGeo, slateMat);
    const s = 0.72 + hash01(i * 2.9) * 0.55;
    crag.scale.set(s, s, s);
    crag.position.set(cx, 0.8 * s, cz);
    crag.rotation.y = i * 1.2;
    const cap = new Mesh(cragFrostGeo, frostMat);
    cap.scale.set(s, s, s);
    cap.position.set(cx, 1.32 * s, cz);
    cap.rotation.y = crag.rotation.y;
    group.add(crag, cap);
  }

  // Low drifting alpine cloud mist ring
  const mist = new Mesh(new RingGeometry(R - 0.6, R + 3.0, 40), cloudMistMat);
  mist.rotation.x = -Math.PI / 2;
  mist.position.y = 0.26;
  group.add(mist);
  ctx.mistRings.push({
    mesh: mist,
    baseY: 0.26,
    baseOpacity: 0.2,
    rotateSpeed: -0.07,
    phase: 1.1,
  });

  return ctx.handle;
}

/** Create the signature surrounding courtyard precinct for the given shelter kind. */
export function createCastlePrecinct(shelter: ShelterHouse): CastlePrecinctHandle {
  switch (shelter.kind) {
    case 'castle':
      return buildRoyalCastlePrecinct(shelter);
    case 'mushroom':
      return buildMushroomGladePrecinct(shelter);
    case 'crystal':
      return buildCrystalTundraPrecinct(shelter);
    case 'mermaid':
      return buildMermaidLagoonPrecinct(shelter);
    case 'candy':
      return buildCandyOrchardPrecinct(shelter);
    case 'blossom':
      return buildBlossomZenPrecinct(shelter);
    case 'starlight':
      return buildStarlightPeakPrecinct(shelter);
    default:
      return buildRoyalCastlePrecinct(shelter);
  }
}

/** Build and attach a signature precinct to `houseGroup`, registering its animation handle. */
export function attachCastlePrecinct(
  houseGroup: Group,
  shelter: ShelterHouse,
): CastlePrecinctHandle {
  const handle = createCastlePrecinct(shelter);
  houseGroup.add(handle.group);
  PRECINCT_BY_HOUSE.set(houseGroup, handle);
  return handle;
}

/** Retrieve the precinct handle previously attached to `houseGroup`. */
export function getCastlePrecinct(houseGroup: Group): CastlePrecinctHandle | undefined {
  return PRECINCT_BY_HOUSE.get(houseGroup);
}

/** Animate precinct water, fountains, swaying flora, lanterns, and mist with zero allocations. */
export function animateCastlePrecinct(handle: CastlePrecinctHandle, elapsed: number): void {
  for (let i = 0; i < handle.shimmerRings.length; i++) {
    const item = handle.shimmerRings[i]!;
    const mat = item.mesh.material as MeshBasicMaterial;
    mat.opacity = item.baseOpacity + Math.sin(elapsed * item.speed + item.phase) * 0.16;
    if (item.rotateSpeed !== 0) {
      item.mesh.rotation.z = elapsed * item.rotateSpeed;
    }
  }

  for (let i = 0; i < handle.waveRings.length; i++) {
    const wave = handle.waveRings[i]!;
    const pulse = Math.sin(elapsed * wave.speed + wave.phase);
    const s = wave.baseScale + pulse * 0.025;
    wave.mesh.scale.set(s, s, 1);
    (wave.mesh.material as MeshBasicMaterial).opacity = wave.baseOpacity + pulse * 0.16;
  }

  for (let i = 0; i < handle.fountainJets.length; i++) {
    const jet = handle.fountainJets[i]!;
    const wave = Math.abs(Math.sin(elapsed * jet.speed + jet.phase));
    jet.mesh.position.y = jet.baseY + wave * jet.amplitude;
    jet.mesh.scale.y = 0.85 + wave * 0.35;
  }

  for (let i = 0; i < handle.swayProps.length; i++) {
    const prop = handle.swayProps[i]!;
    const rot = prop.baseRot + Math.sin(elapsed * prop.speed + prop.phase) * prop.amplitude;
    if (prop.axis === 'x') {
      prop.obj.rotation.x = rot;
    } else {
      prop.obj.rotation.z = rot;
    }
  }

  for (let i = 0; i < handle.spinRings.length; i++) {
    const ring = handle.spinRings[i]!;
    if (ring.axis === 'x') ring.mesh.rotation.x = elapsed * ring.speed;
    else if (ring.axis === 'y') ring.mesh.rotation.y = elapsed * ring.speed;
    else ring.mesh.rotation.z = elapsed * ring.speed;
  }

  for (let i = 0; i < handle.glowOrbs.length; i++) {
    const orb = handle.glowOrbs[i]!;
    orb.mat.emissiveIntensity =
      orb.baseIntensity + Math.sin(elapsed * orb.speed + orb.phase) * orb.amplitude;
  }

  for (let i = 0; i < handle.mistRings.length; i++) {
    const mist = handle.mistRings[i]!;
    mist.mesh.rotation.z = elapsed * mist.rotateSpeed;
    mist.mesh.position.y = mist.baseY + Math.sin(elapsed * 1.2 + mist.phase) * 0.06;
    (mist.mesh.material as MeshBasicMaterial).opacity =
      mist.baseOpacity + Math.sin(elapsed * 1.5 + mist.phase) * 0.06;
  }

  for (let i = 0; i < handle.bobItems.length; i++) {
    const item = handle.bobItems[i]!;
    item.mesh.position.y =
      item.baseY + Math.sin(elapsed * item.speed + item.phase) * item.amplitude;
  }
}
