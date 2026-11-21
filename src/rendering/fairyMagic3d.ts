import {
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Scene,
} from 'three';
import type {
  AoeBlast,
  AoeElement,
  FrostZone,
  GameState,
  GardenFlower,
  SkyLightningBolt,
} from '../core/types';
import { cellToWorld, halfOf } from './world';

// --- Flower color palettes (4 pastel variants by colorVariant 0..3) ---
const FLOWER_PETAL_COLORS: readonly number[] = [
  0xff7ac6, // 0: Sakura Pink
  0xffd447, // 1: Sunburst Gold
  0xc28bff, // 2: Lavender Lotus
  0x5ef2c8, // 3: Mint Rose
];
const STAMEN_COLOR = 0xffd447; // golden stamen center
const LEAF_COLOR = 0x3ddb8e; // emerald-mint

const FLOOR_Y = -0.34;
const FROST_FLOOR_Y = -0.465;
const PETAL_COUNT = 5;
const MAX_FROST_POOL = 28;
const FROST_GEM_COUNT = 5;

const UP_AXIS = new Vector3(0, 1, 0);
const SEG_START = new Vector3();
const SEG_END = new Vector3();
const SEG_DIR = new Vector3();
const SEG_QUAT = new Quaternion();

// --- 3D Flower mesh helpers ---

interface FlowerEntry {
  readonly id: number;
  readonly group: Group;
  readonly blossomGroup: Group;
  readonly haloMesh: Mesh<RingGeometry, MeshBasicMaterial>;
  readonly petalMat: MeshStandardMaterial;
  readonly stamenMat: MeshStandardMaterial;
  spawnAge: number;
}

function createFlowerEntry(flower: GardenFlower): FlowerEntry {
  const grp = new Group();
  const blossomGroup = new Group();
  const petalHex = FLOWER_PETAL_COLORS[flower.colorVariant] ?? 0xff7ac6;

  // 5 plump radial petals
  const petalGeo = new SphereGeometry(0.22, 8, 6);
  petalGeo.scale(1, 0.45, 1.4);
  const petalMat = new MeshStandardMaterial({
    color: petalHex,
    emissive: petalHex,
    emissiveIntensity: 0.34,
    side: DoubleSide,
    transparent: true,
    opacity: 0.94,
  });

  for (let i = 0; i < PETAL_COUNT; i++) {
    const angle = (i / PETAL_COUNT) * Math.PI * 2;
    const petal = new Mesh(petalGeo, petalMat);
    petal.position.set(Math.cos(angle) * 0.19, 0.08, Math.sin(angle) * 0.19);
    petal.rotation.y = -angle;
    blossomGroup.add(petal);
  }

  // Golden stamen center
  const stamenGeo = new SphereGeometry(0.105, 8, 6);
  const stamenMat = new MeshStandardMaterial({
    color: STAMEN_COLOR,
    emissive: STAMEN_COLOR,
    emissiveIntensity: 0.55,
  });
  const stamen = new Mesh(stamenGeo, stamenMat);
  stamen.position.y = 0.13;
  blossomGroup.add(stamen);

  // Shimmering fairy pollen ring beneath the petals
  const haloGeo = new RingGeometry(0.24, 0.36, 10);
  const haloMat = new MeshBasicMaterial({
    color: petalHex,
    transparent: true,
    opacity: 0.48,
    side: DoubleSide,
    depthWrite: false,
  });
  const haloMesh = new Mesh(haloGeo, haloMat);
  haloMesh.rotation.x = -Math.PI / 2;
  haloMesh.position.y = 0.02;
  blossomGroup.add(haloMesh);

  grp.add(blossomGroup);

  // 2 grounded emerald-mint leaves
  const leafGeo = new SphereGeometry(0.125, 6, 4);
  leafGeo.scale(0.5, 0.2, 1.25);
  const leafMat = new MeshStandardMaterial({
    color: LEAF_COLOR,
    emissive: LEAF_COLOR,
    emissiveIntensity: 0.2,
    side: DoubleSide,
  });
  for (let j = 0; j < 2; j++) {
    const leaf = new Mesh(leafGeo, leafMat);
    const la = (j === 0 ? 0.4 : -0.4) + Math.PI * 0.5;
    leaf.position.set(Math.cos(la) * 0.28, -0.02, Math.sin(la) * 0.28);
    leaf.rotation.y = -la;
    grp.add(leaf);
  }

  return {
    id: flower.id,
    group: grp,
    blossomGroup,
    haloMesh,
    petalMat,
    stamenMat,
    spawnAge: 0,
  };
}

// --- 3D Lightning bolt helpers ---

interface BoltEntry {
  readonly id: number;
  readonly group: Group;
  readonly outerRing: Mesh<RingGeometry, MeshStandardMaterial>;
  readonly innerRing: Mesh<RingGeometry, MeshBasicMaterial>;
  readonly impactCore: Mesh<SphereGeometry, MeshBasicMaterial>;
  readonly impactAura: Mesh<SphereGeometry, MeshStandardMaterial>;
  readonly impactFlash: Mesh<CircleGeometry, MeshBasicMaterial>;
  readonly boltMeshes: readonly Mesh[];
}

function addBoltSegment(
  grp: Group,
  boltMeshes: Mesh[],
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  coreR: number,
  midR: number,
  auraR: number,
  coreMat: MeshBasicMaterial,
  midMat: MeshStandardMaterial,
  auraMat: MeshStandardMaterial,
  includeSheath: boolean,
): void {
  SEG_START.set(x0, y0, z0);
  SEG_END.set(x1, y1, z1);
  SEG_DIR.subVectors(SEG_END, SEG_START);
  const len = Math.max(0.05, SEG_DIR.length());
  SEG_DIR.multiplyScalar(1 / len);
  SEG_QUAT.setFromUnitVectors(UP_AXIS, SEG_DIR);

  const mx = (x0 + x1) * 0.5;
  const my = (y0 + y1) * 0.5;
  const mz = (z0 + z1) * 0.5;

  const coreGeo = new CylinderGeometry(coreR, coreR, len, 5);
  const core = new Mesh(coreGeo, coreMat);
  core.position.set(mx, my, mz);
  core.quaternion.copy(SEG_QUAT);
  grp.add(core);
  boltMeshes.push(core);

  const midGeo = new CylinderGeometry(midR, midR, len, 6);
  const mid = new Mesh(midGeo, midMat);
  mid.position.set(mx, my, mz);
  mid.quaternion.copy(SEG_QUAT);
  grp.add(mid);
  boltMeshes.push(mid);

  if (includeSheath) {
    const auraGeo = new CylinderGeometry(auraR, auraR, len, 6);
    const aura = new Mesh(auraGeo, auraMat);
    aura.position.set(mx, my, mz);
    aura.quaternion.copy(SEG_QUAT);
    grp.add(aura);
    boltMeshes.push(aura);
  }
}

function createBoltEntry(bolt: SkyLightningBolt): BoltEntry {
  const grp = new Group();
  const hex = bolt.colorHex;
  const topY = 15.5;
  const botY = FLOOR_Y;
  const segments = 9;
  const segH = (topY - botY) / segments;
  const boltMeshes: Mesh[] = [];

  let seed = bolt.id * 7919;
  const nextR = (): number => {
    seed = ((seed * 16807) % 2147483647) >>> 0;
    return (seed / 2147483647) * 2 - 1;
  };

  // White-hot glowing core + colored mid-core + soft electric outer sheath
  const coreMat = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.98,
    depthWrite: false,
  });
  coreMat.userData['baseOpacity'] = 0.98;

  const midMat = new MeshStandardMaterial({
    color: hex,
    emissive: hex,
    emissiveIntensity: 1.35,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
  });
  midMat.userData['baseOpacity'] = 0.88;

  const auraMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: hex,
    emissiveIntensity: 0.95,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
  auraMat.userData['baseOpacity'] = 0.34;

  let px = nextR() * 0.4;
  let pz = nextR() * 0.4;
  let py = topY;
  for (let i = 0; i < segments; i++) {
    const isFinal = i === segments - 1;
    // Land the final tip squarely on (0, botY, 0) at the target cell
    const nx = isFinal ? 0 : px * 0.65 + nextR() * 0.85;
    const nz = isFinal ? 0 : pz * 0.65 + nextR() * 0.85;
    const ny = topY - (i + 1) * segH;

    addBoltSegment(
      grp,
      boltMeshes,
      px,
      py,
      pz,
      nx,
      ny,
      nz,
      0.068,
      0.15,
      0.32,
      coreMat,
      midMat,
      auraMat,
      true,
    );

    // Side fork branches off mid-bolt for dramatic silhouette
    if (i === 3 || i === 5) {
      const bx1 = nx + nextR() * 1.15;
      const by1 = ny - segH * 0.72;
      const bz1 = nz + nextR() * 1.15;
      addBoltSegment(
        grp,
        boltMeshes,
        nx,
        ny,
        nz,
        bx1,
        by1,
        bz1,
        0.032,
        0.078,
        0.16,
        coreMat,
        midMat,
        auraMat,
        false,
      );
    }

    px = nx;
    py = ny;
    pz = nz;
  }

  // Bright ground impact glowing core + plasma halo at (0, botY, 0)
  const impactCoreGeo = new SphereGeometry(0.32, 12, 10);
  const impactCoreMat = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
  });
  const impactCore = new Mesh(impactCoreGeo, impactCoreMat);
  impactCore.position.set(0, botY + 0.18, 0);
  grp.add(impactCore);

  const impactAuraGeo = new SphereGeometry(0.62, 14, 12);
  const impactAuraMat = new MeshStandardMaterial({
    color: hex,
    emissive: hex,
    emissiveIntensity: 1.4,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
  });
  const impactAura = new Mesh(impactAuraGeo, impactAuraMat);
  impactAura.position.set(0, botY + 0.18, 0);
  grp.add(impactAura);

  // Ground flash disc
  const flashGeo = new CircleGeometry(0.75, 24);
  const flashMat = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.72,
    side: DoubleSide,
    depthWrite: false,
  });
  const impactFlash = new Mesh(flashGeo, flashMat);
  impactFlash.rotation.x = -Math.PI / 2;
  impactFlash.position.y = botY + 0.015;
  grp.add(impactFlash);

  // Double ground impact shock rings (outer colored shock ring + crisp white inner ring)
  const outerRingGeo = new RingGeometry(0.58, 1.18, 28);
  const outerRingMat = new MeshStandardMaterial({
    color: hex,
    emissive: hex,
    emissiveIntensity: 1.3,
    transparent: true,
    opacity: 0.9,
    side: DoubleSide,
    depthWrite: false,
  });
  const outerRing = new Mesh(outerRingGeo, outerRingMat);
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.position.y = botY + 0.02;
  grp.add(outerRing);

  const innerRingGeo = new RingGeometry(0.32, 0.58, 24);
  const innerRingMat = new MeshBasicMaterial({
    color: 0xfff7b8,
    transparent: true,
    opacity: 0.92,
    side: DoubleSide,
    depthWrite: false,
  });
  const innerRing = new Mesh(innerRingGeo, innerRingMat);
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.y = botY + 0.03;
  grp.add(innerRing);

  return {
    id: bolt.id,
    group: grp,
    outerRing,
    innerRing,
    impactCore,
    impactAura,
    impactFlash,
    boltMeshes,
  };
}

// --- 3D AoE Blast helpers ---

interface BlastEntry {
  readonly id: number;
  readonly element: AoeElement;
  readonly radius: number;
  readonly group: Group;
  readonly domeShell: Mesh<SphereGeometry, MeshStandardMaterial>;
  readonly domeWire: Mesh<SphereGeometry, MeshBasicMaterial>;
  readonly pillarCore: Mesh<CylinderGeometry, MeshStandardMaterial>;
  readonly pillarAura: Mesh<CylinderGeometry, MeshStandardMaterial>;
  readonly primaryWave: Mesh;
  readonly secondaryWave: Mesh;
  readonly orbiterGroup: Group;
  readonly orbiters: readonly Mesh[];
}

interface ElementBlastPalette {
  readonly domeHex: number;
  readonly wireHex: number;
  readonly pillarCoreHex: number;
  readonly pillarAuraHex: number;
  readonly primaryHex: number;
  readonly secondaryHex: number;
}

const BLAST_PALETTES: Record<AoeElement, ElementBlastPalette> = {
  fire: {
    domeHex: 0xff5522,
    wireHex: 0xffe45c,
    pillarCoreHex: 0xfff2a6,
    pillarAuraHex: 0xff4518,
    primaryHex: 0xff5522,
    secondaryHex: 0xffbe3b,
  },
  water: {
    domeHex: 0x1ee3ff,
    wireHex: 0xeaffff,
    pillarCoreHex: 0xeaffff,
    pillarAuraHex: 0x1ee3ff,
    primaryHex: 0x1ee3ff,
    secondaryHex: 0x8cf8ff,
  },
  arcane: {
    domeHex: 0xd96bff,
    wireHex: 0xffe66d,
    pillarCoreHex: 0xfff5b8,
    pillarAuraHex: 0xd96bff,
    primaryHex: 0xd96bff,
    secondaryHex: 0xffe66d,
  },
  thunder: {
    domeHex: 0x5cf6ff,
    wireHex: 0xffe066,
    pillarCoreHex: 0xffffff,
    pillarAuraHex: 0x5cf6ff,
    primaryHex: 0xffe066,
    secondaryHex: 0x5cf6ff,
  },
};

function makeBlastRingMesh(
  innerR: number,
  outerR: number,
  color: number,
  emissive: number,
  opacity: number,
  yOffset: number,
  finCount: number,
  finColor: number,
): Mesh {
  const geo = new RingGeometry(innerR, outerR, 36);
  const mat = new MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 1.0,
    transparent: true,
    opacity,
    side: DoubleSide,
    depthWrite: false,
  });
  mat.userData['baseOpacity'] = opacity;
  const mesh = new Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = FLOOR_Y + yOffset;

  // Radial energy teeth/fins on the ring so counter-rotation is crisp and unmistakable
  const finGeo = new ConeGeometry(0.11, 0.34, 4);
  const finMat = new MeshStandardMaterial({
    color: finColor,
    emissive: finColor,
    emissiveIntensity: 1.15,
    transparent: true,
    opacity: Math.min(1, opacity + 0.08),
    depthWrite: false,
  });
  finMat.userData['baseOpacity'] = Math.min(1, opacity + 0.08);
  const midR = (innerR + outerR) * 0.5;
  for (let i = 0; i < finCount; i++) {
    const a = (i / finCount) * Math.PI * 2;
    const fin = new Mesh(finGeo, finMat);
    fin.position.set(Math.cos(a) * midR, Math.sin(a) * midR, 0.02);
    fin.rotation.z = a - Math.PI / 2;
    mesh.add(fin);
  }

  return mesh;
}

function createBlastEntry(blast: AoeBlast): BlastEntry {
  const group = new Group();
  const orbiterGroup = new Group();
  const orbiters: Mesh[] = [];
  const pal = BLAST_PALETTES[blast.element];

  // 1. Expanding translucent energy dome + wireframe energy lattice
  const domeGeo = new SphereGeometry(1.0, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const domeMat = new MeshStandardMaterial({
    color: pal.domeHex,
    emissive: pal.domeHex,
    emissiveIntensity: 0.9,
    transparent: true,
    opacity: 0.3,
    side: DoubleSide,
    roughness: 0.15,
    depthWrite: false,
  });
  domeMat.userData['baseOpacity'] = 0.3;
  const domeShell = new Mesh(domeGeo, domeMat);
  domeShell.position.y = FLOOR_Y;

  const wireGeo = new SphereGeometry(0.99, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const wireMat = new MeshBasicMaterial({
    color: pal.wireHex,
    wireframe: true,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
  });
  wireMat.userData['baseOpacity'] = 0.36;
  const domeWire = new Mesh(wireGeo, wireMat);
  domeWire.position.y = FLOOR_Y;

  // 2. Vertical light pillar (white-hot core column + outer colored aura beam)
  const pillarHeight = 14;
  const pillarCoreGeo = new CylinderGeometry(0.32, 0.7, pillarHeight, 14, 1, true);
  const pillarCoreMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: pal.pillarCoreHex,
    emissiveIntensity: 1.4,
    transparent: true,
    opacity: 0.72,
    side: DoubleSide,
    depthWrite: false,
  });
  pillarCoreMat.userData['baseOpacity'] = 0.72;
  const pillarCore = new Mesh(pillarCoreGeo, pillarCoreMat);
  pillarCore.position.y = FLOOR_Y + pillarHeight * 0.5;

  const pillarAuraGeo = new CylinderGeometry(0.75, 1.45, pillarHeight, 16, 1, true);
  const pillarAuraMat = new MeshStandardMaterial({
    color: pal.pillarAuraHex,
    emissive: pal.pillarAuraHex,
    emissiveIntensity: 1.05,
    transparent: true,
    opacity: 0.34,
    side: DoubleSide,
    depthWrite: false,
  });
  pillarAuraMat.userData['baseOpacity'] = 0.34;
  const pillarAura = new Mesh(pillarAuraGeo, pillarAuraMat);
  pillarAura.position.y = FLOOR_Y + pillarHeight * 0.5;

  // 3. Double counter-rotating shockwave rings + element-specific 3D orbiters
  let primaryWave: Mesh;
  let secondaryWave: Mesh;

  switch (blast.element) {
    case 'thunder': {
      primaryWave = makeBlastRingMesh(
        0.78,
        1.0,
        pal.primaryHex,
        pal.primaryHex,
        0.9,
        0.03,
        8,
        0xffffff,
      );
      secondaryWave = makeBlastRingMesh(
        0.5,
        0.72,
        pal.secondaryHex,
        pal.secondaryHex,
        0.8,
        0.05,
        6,
        pal.primaryHex,
      );
      const arcGeo = new CylinderGeometry(0.05, 0.08, 1.0, 5);
      const arcMat = new MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x5cf6ff,
        emissiveIntensity: 1.15,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      });
      arcMat.userData['baseOpacity'] = 0.92;
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const arc = new Mesh(arcGeo, arcMat);
        arc.rotation.z = Math.PI / 2;
        arc.rotation.y = angle;
        arc.position.set(Math.cos(angle) * 0.5, FLOOR_Y + 0.18, Math.sin(angle) * 0.5);
        orbiters.push(arc);
        orbiterGroup.add(arc);
      }
      break;
    }
    case 'fire': {
      const torusGeo = new TorusGeometry(1.0, 0.075, 10, 40);
      const torusMat = new MeshStandardMaterial({
        color: 0xff5522,
        emissive: 0xffbe3b,
        emissiveIntensity: 1.05,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      });
      torusMat.userData['baseOpacity'] = 0.92;
      primaryWave = new Mesh(torusGeo, torusMat);
      primaryWave.rotation.x = -Math.PI / 2;
      primaryWave.position.y = FLOOR_Y + 0.16;

      // Attach rotating flame fins directly to primaryWave torus
      const finGeo = new ConeGeometry(0.11, 0.34, 4);
      const finMat = new MeshStandardMaterial({
        color: 0xffe45c,
        emissive: 0xffe45c,
        emissiveIntensity: 1.2,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      });
      finMat.userData['baseOpacity'] = 0.92;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const fin = new Mesh(finGeo, finMat);
        fin.position.set(Math.cos(a) * 0.98, Math.sin(a) * 0.98, 0.02);
        fin.rotation.z = a - Math.PI / 2;
        primaryWave.add(fin);
      }

      secondaryWave = makeBlastRingMesh(0.6, 0.94, 0xffbe3b, 0xff5522, 0.78, 0.03, 6, 0xfff2a6);

      const coneGeo = new ConeGeometry(0.32, 0.95, 8);
      const fireWarmMat = new MeshStandardMaterial({
        color: 0xff5522,
        emissive: 0xff5522,
        emissiveIntensity: 0.98,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      });
      fireWarmMat.userData['baseOpacity'] = 0.92;
      const fireGoldMat = new MeshStandardMaterial({
        color: 0xffbe3b,
        emissive: 0xffbe3b,
        emissiveIntensity: 1.05,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      });
      fireGoldMat.userData['baseOpacity'] = 0.92;
      for (let i = 0; i < 10; i++) {
        const cone = new Mesh(coneGeo, i % 2 === 0 ? fireWarmMat : fireGoldMat);
        cone.rotation.z = 0.25;
        orbiters.push(cone);
        orbiterGroup.add(cone);
      }
      break;
    }
    case 'water': {
      primaryWave = makeBlastRingMesh(0.72, 1.0, 0x1ee3ff, 0x1ee3ff, 0.86, 0.04, 8, 0xeaffff);
      secondaryWave = makeBlastRingMesh(0.42, 0.72, 0x8cf8ff, 0x8cf8ff, 0.78, 0.06, 6, 0x1ee3ff);
      const dropGeo = new SphereGeometry(0.28, 10, 8);
      const dropMatA = new MeshStandardMaterial({
        color: 0x1ee3ff,
        emissive: 0x1ee3ff,
        emissiveIntensity: 0.82,
        roughness: 0.15,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
      });
      dropMatA.userData['baseOpacity'] = 0.88;
      const dropMatB = new MeshStandardMaterial({
        color: 0x8cf8ff,
        emissive: 0x8cf8ff,
        emissiveIntensity: 0.92,
        roughness: 0.15,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
      dropMatB.userData['baseOpacity'] = 0.9;
      for (let i = 0; i < 10; i++) {
        const drop = new Mesh(dropGeo, i % 2 === 0 ? dropMatA : dropMatB);
        orbiters.push(drop);
        orbiterGroup.add(drop);
      }
      break;
    }
    case 'arcane': {
      primaryWave = makeBlastRingMesh(0.74, 1.0, 0xd96bff, 0xd96bff, 0.9, 0.04, 8, 0xffe66d);
      secondaryWave = makeBlastRingMesh(0.48, 0.7, 0xffe66d, 0xffe66d, 0.82, 0.06, 6, 0x7df9ff);
      const crystalGeo = new OctahedronGeometry(0.36, 0);
      const crystalVioletMat = new MeshStandardMaterial({
        color: 0xd96bff,
        emissive: 0xd96bff,
        emissiveIntensity: 1.0,
        roughness: 0.15,
        transparent: true,
        opacity: 0.94,
        depthWrite: false,
      });
      crystalVioletMat.userData['baseOpacity'] = 0.94;
      const crystalGoldMat = new MeshStandardMaterial({
        color: 0xffe66d,
        emissive: 0xffe66d,
        emissiveIntensity: 1.05,
        roughness: 0.15,
        transparent: true,
        opacity: 0.94,
        depthWrite: false,
      });
      crystalGoldMat.userData['baseOpacity'] = 0.94;
      for (let i = 0; i < 8; i++) {
        const star = new Mesh(crystalGeo, i % 2 === 0 ? crystalVioletMat : crystalGoldMat);
        orbiters.push(star);
        orbiterGroup.add(star);
      }
      break;
    }
  }

  group.add(domeShell, domeWire, pillarAura, pillarCore, primaryWave, secondaryWave, orbiterGroup);
  return {
    id: blast.id,
    element: blast.element,
    radius: blast.radius,
    group,
    domeShell,
    domeWire,
    pillarCore,
    pillarAura,
    primaryWave,
    secondaryWave,
    orbiterGroup,
    orbiters,
  };
}

interface FrostZoneSlot {
  active: boolean;
  seen: boolean;
  zoneId: number;
  radius: number;
  ticksRemaining: number;
  maxTicks: number;
  spawnTime: number;
  readonly group: Group;
  readonly discGroup: Group;
  readonly outerHexRing: Mesh<RingGeometry, MeshBasicMaterial>;
  readonly innerCrystalRing: Mesh<RingGeometry, MeshBasicMaterial>;
  readonly gems: readonly Mesh<OctahedronGeometry, MeshStandardMaterial>[];
  readonly discMat: MeshBasicMaterial;
  readonly innerDiscMat: MeshBasicMaterial;
  readonly outerRingMat: MeshBasicMaterial;
  readonly innerRingMat: MeshBasicMaterial;
  readonly gemMat: MeshStandardMaterial;
}

interface FrostSharedGeos {
  readonly hexDiscGeo: CircleGeometry;
  readonly innerDiscGeo: CircleGeometry;
  readonly outerRingGeo: RingGeometry;
  readonly innerRingGeo: RingGeometry;
  readonly gemGeo: OctahedronGeometry;
}

function createFrostZoneSlot(geos: FrostSharedGeos): FrostZoneSlot {
  const group = new Group();
  group.visible = false;

  const discGroup = new Group();

  const discMat = new MeshBasicMaterial({
    color: 0x9ef9ff,
    transparent: true,
    opacity: 0.24,
    side: DoubleSide,
    depthWrite: false,
  });
  const hexDisc = new Mesh(geos.hexDiscGeo, discMat);
  hexDisc.rotation.x = -Math.PI / 2;

  const innerDiscMat = new MeshBasicMaterial({
    color: 0xe8feff,
    transparent: true,
    opacity: 0.26,
    side: DoubleSide,
    depthWrite: false,
  });
  const innerDisc = new Mesh(geos.innerDiscGeo, innerDiscMat);
  innerDisc.rotation.x = -Math.PI / 2;
  innerDisc.position.y = 0.006;

  const outerRingMat = new MeshBasicMaterial({
    color: 0x7ef8ff,
    transparent: true,
    opacity: 0.82,
    side: DoubleSide,
    depthWrite: false,
  });
  const outerHexRing = new Mesh(geos.outerRingGeo, outerRingMat);
  outerHexRing.rotation.x = -Math.PI / 2;
  outerHexRing.position.y = 0.012;

  const innerRingMat = new MeshBasicMaterial({
    color: 0xd8feff,
    transparent: true,
    opacity: 0.68,
    side: DoubleSide,
    depthWrite: false,
  });
  const innerCrystalRing = new Mesh(geos.innerRingGeo, innerRingMat);
  innerCrystalRing.rotation.x = -Math.PI / 2;
  innerCrystalRing.position.y = 0.018;

  discGroup.add(hexDisc, innerDisc, outerHexRing, innerCrystalRing);
  group.add(discGroup);

  const gemMat = new MeshStandardMaterial({
    color: 0xd8feff,
    emissive: 0x38e8ff,
    emissiveIntensity: 0.95,
    transparent: true,
    opacity: 0.9,
    roughness: 0.12,
    metalness: 0.3,
    depthWrite: false,
  });
  const gems: Mesh<OctahedronGeometry, MeshStandardMaterial>[] = [];
  for (let i = 0; i < FROST_GEM_COUNT; i++) {
    const gem = new Mesh(geos.gemGeo, gemMat);
    gems.push(gem);
    group.add(gem);
  }

  return {
    active: false,
    seen: false,
    zoneId: -1,
    radius: 3.6,
    ticksRemaining: 0,
    maxTicks: 46,
    spawnTime: -1,
    group,
    discGroup,
    outerHexRing,
    innerCrystalRing,
    gems,
    discMat,
    innerDiscMat,
    outerRingMat,
    innerRingMat,
    gemMat,
  };
}

/**
 * Manages 3D Garden Flowers, Sky Lightning Bolts, 360° Elemental AoE Blasts,
 * and pooled zero-GC Frost Zones, reconciled by id against `GameState`.
 */
export class FairyMagicView {
  private readonly scene: Scene;
  private readonly half: number;
  private readonly flowers = new Map<number, FlowerEntry>();
  private readonly bolts = new Map<number, BoltEntry>();
  private readonly blasts = new Map<number, BlastEntry>();

  private readonly frostRoot = new Group();
  private readonly frostGeos: FrostSharedGeos = {
    hexDiscGeo: new CircleGeometry(1.0, 6),
    innerDiscGeo: new CircleGeometry(0.68, 20),
    outerRingGeo: new RingGeometry(0.86, 1.0, 6),
    innerRingGeo: new RingGeometry(0.5, 0.62, 24),
    gemGeo: new OctahedronGeometry(0.16, 0),
  };
  private readonly frostPool: FrostZoneSlot[] = [];
  private readonly scratchFrostPos = new Vector3();

  constructor(scene: Scene, maxGrid: number) {
    this.scene = scene;
    this.half = halfOf(maxGrid);

    for (let i = 0; i < MAX_FROST_POOL; i++) {
      const slot = createFrostZoneSlot(this.frostGeos);
      this.frostPool.push(slot);
      this.frostRoot.add(slot.group);
    }
    this.scene.add(this.frostRoot);
  }

  sync(state: GameState): void {
    this.syncFlowers(state.gardenFlowers);
    this.syncBolts(state.lightningBolts);
    this.syncBlasts(state.aoeBlasts);
    this.syncFrostZones(state.frostZones);
  }

  draw(elapsed: number, state: GameState): void {
    this.sync(state);

    // Animate flowers: pop-in/shrink-out, gentle bob, spin, breeze sway & petal shimmer
    for (const entry of this.flowers.values()) {
      entry.spawnAge += 1;
      const flower = state.gardenFlowers.find((f) => f.id === entry.id);
      if (!flower) continue;

      const age01 = Math.min(1, entry.spawnAge / 15);
      const fadeOut = flower.ticksRemaining < 25 ? flower.ticksRemaining / 25 : 1;
      const popScale = flower.scale * easeOutBack(age01) * fadeOut;
      const breathe = 1 + 0.05 * Math.sin(elapsed * 3.8 + entry.id);

      entry.group.scale.setScalar(Math.max(0.01, popScale * breathe));
      entry.group.position.y = FLOOR_Y + 0.04 + Math.sin(elapsed * 2.6 + entry.id * 1.1) * 0.065;
      entry.group.rotation.z = Math.sin(elapsed * 1.5 + entry.id) * 0.08;
      entry.group.rotation.x = Math.sin(elapsed * 1.2 + entry.id * 1.3) * 0.05;

      const spinSpeed = 0.65 + (entry.id % 3) * 0.22;
      entry.blossomGroup.rotation.y = elapsed * spinSpeed + entry.id * 0.7;
      entry.haloMesh.rotation.z = -elapsed * 1.8;

      const shimmer = 0.5 + 0.5 * Math.sin(elapsed * 4.8 + entry.id * 1.7);
      entry.petalMat.emissiveIntensity = 0.28 + 0.34 * shimmer;
      entry.stamenMat.emissiveIntensity = 0.48 + 0.42 * (1 - shimmer);
      entry.haloMesh.material.opacity = (0.3 + 0.34 * shimmer) * fadeOut;
    }

    // Animate lightning bolts: blazing core flicker, impact sphere pulse & double ground shock rings
    for (const entry of this.bolts.values()) {
      const bolt = state.lightningBolts.find((b) => b.id === entry.id);
      if (!bolt) continue;

      const life = Math.max(0, Math.min(1, bolt.ttl / Math.max(1, bolt.maxTtl)));
      const progress = 1 - life;
      const flicker = 0.78 + 0.22 * Math.sin(elapsed * 36 + entry.id * 2.1);

      const outerScale = 1 + progress * 3.8;
      const innerScale = 0.85 + progress * 2.6;
      entry.outerRing.scale.setScalar(outerScale);
      entry.outerRing.rotation.z = elapsed * 4.5;
      entry.outerRing.material.opacity = life * 0.88;

      entry.innerRing.scale.setScalar(innerScale);
      entry.innerRing.rotation.z = -elapsed * 6.0;
      entry.innerRing.material.opacity = life * 0.94 * flicker;

      const corePulse = (0.85 + 0.55 * Math.sin(progress * Math.PI)) * flicker;
      entry.impactCore.scale.setScalar(corePulse);
      entry.impactCore.material.opacity = life * 0.96;
      entry.impactAura.scale.setScalar(1 + progress * 1.5);
      entry.impactAura.material.opacity = life * 0.58;
      entry.impactFlash.scale.setScalar(1 + progress * 2.2);
      entry.impactFlash.material.opacity = life * life * 0.75;

      for (const mesh of entry.boltMeshes) {
        const m = mesh.material;
        if (m instanceof MeshStandardMaterial || m instanceof MeshBasicMaterial) {
          const base =
            typeof m.userData['baseOpacity'] === 'number' ? m.userData['baseOpacity'] : 0.85;
          m.opacity = base * life * flicker;
        }
      }
    }

    // Animate 360° elemental AoE: expanding energy dome, double counter-rotating rings & vertical pillar
    for (const entry of this.blasts.values()) {
      const blast = state.aoeBlasts.find((b) => b.id === entry.id);
      if (!blast) continue;

      const life = Math.max(0, Math.min(1, blast.ttl / Math.max(1, blast.maxTtl)));
      const progress = 1 - life;
      const eased = 1 - Math.pow(1 - progress, 2);
      const currentRadius = 0.12 + eased * Math.max(0.1, entry.radius - 0.12);
      const alphaFade = Math.min(1, life * 1.38);

      // Translucent expanding energy dome (wide grand hemisphere)
      const domeHeightScale = currentRadius * (0.48 + 0.14 * (1 - progress));
      entry.domeShell.scale.set(currentRadius, domeHeightScale, currentRadius);
      entry.domeShell.rotation.y = elapsed * 1.1;
      entry.domeWire.scale.set(currentRadius * 0.99, domeHeightScale * 0.99, currentRadius * 0.99);
      entry.domeWire.rotation.y = -elapsed * 1.6;

      // Vertical light pillar: intense flash at cast, tapering cleanly as blast expands
      const pillarWidth = (1.45 - progress * 0.85) * Math.max(0.75, entry.radius * 0.12);
      const pillarFlicker = 0.9 + 0.15 * Math.sin(elapsed * 26 + entry.id);
      entry.pillarCore.scale.set(
        pillarWidth * pillarFlicker,
        1 + progress * 0.3,
        pillarWidth * pillarFlicker,
      );
      entry.pillarCore.rotation.y = elapsed * 3.5;
      entry.pillarAura.scale.set(
        pillarWidth * 1.25 * pillarFlicker,
        1 + progress * 0.25,
        pillarWidth * 1.25 * pillarFlicker,
      );
      entry.pillarAura.rotation.y = -elapsed * 2.4;

      // Double counter-rotating shockwave rings
      if (entry.element === 'fire') {
        entry.primaryWave.scale.set(currentRadius, currentRadius, 1 + (1 - progress) * 0.65);
      } else {
        entry.primaryWave.scale.setScalar(currentRadius);
      }
      entry.secondaryWave.scale.setScalar(0.12 + eased * Math.max(0.1, entry.radius * 0.78 - 0.12));

      if (entry.element === 'fire') {
        entry.primaryWave.rotation.z = elapsed * 2.9;
        entry.secondaryWave.rotation.z = -elapsed * 3.8;
        entry.orbiterGroup.rotation.y = elapsed * 3.8;
      } else if (entry.element === 'water') {
        entry.primaryWave.rotation.z = elapsed * 2.6;
        entry.secondaryWave.rotation.z = -elapsed * 3.4;
        entry.orbiterGroup.rotation.y = elapsed * 2.2;
      } else if (entry.element === 'arcane') {
        entry.primaryWave.rotation.z = elapsed * 2.1;
        entry.secondaryWave.rotation.z = -elapsed * 3.0;
        entry.orbiterGroup.rotation.y = elapsed * 2.8;
      } else {
        entry.primaryWave.rotation.z = elapsed * 3.4;
        entry.secondaryWave.rotation.z = -elapsed * 4.4;
        entry.orbiterGroup.rotation.y = elapsed * 3.2;
      }

      const orbCount = Math.max(1, entry.orbiters.length);
      const orbitRadius = currentRadius * 0.88;
      for (let i = 0; i < orbCount; i++) {
        const orb = entry.orbiters[i];
        if (!orb) continue;
        const angle = (i / orbCount) * Math.PI * 2;
        const arcHeight = Math.sin(progress * Math.PI);
        if (entry.element === 'thunder') {
          orb.position.set(
            Math.cos(angle) * orbitRadius * 0.72,
            FLOOR_Y + 0.22,
            Math.sin(angle) * orbitRadius * 0.72,
          );
          orb.scale.set(1, Math.max(0.45, currentRadius * 0.38), 1);
        } else if (entry.element === 'fire') {
          const spiral = angle + progress * 1.6;
          orb.position.set(
            Math.cos(spiral) * orbitRadius,
            FLOOR_Y + 0.4 + arcHeight * 1.25,
            Math.sin(spiral) * orbitRadius,
          );
          orb.scale.setScalar(0.9 + arcHeight * 0.85);
          orb.rotation.y = -spiral;
        } else if (entry.element === 'water') {
          orb.position.set(
            Math.cos(angle) * orbitRadius,
            FLOOR_Y + 0.34 + arcHeight * 1.9 + Math.sin(elapsed * 8 + i) * 0.16,
            Math.sin(angle) * orbitRadius,
          );
          orb.scale.setScalar(0.85 + arcHeight * 0.8);
        } else {
          orb.position.set(
            Math.cos(angle) * orbitRadius,
            FLOOR_Y + 0.58 + arcHeight * 1.2,
            Math.sin(angle) * orbitRadius,
          );
          orb.rotation.y = elapsed * 5 + i;
          orb.rotation.x = elapsed * 3.5;
          orb.scale.setScalar(0.9 + arcHeight * 0.7);
        }
      }

      entry.group.traverse((obj) => {
        if (!(obj instanceof Mesh)) return;
        const mat = obj.material;
        if (
          (mat instanceof MeshStandardMaterial || mat instanceof MeshBasicMaterial) &&
          mat.transparent
        ) {
          const base =
            typeof mat.userData['baseOpacity'] === 'number' ? mat.userData['baseOpacity'] : 0.85;
          const flicker =
            entry.element === 'thunder' ? 0.78 + Math.sin(elapsed * 32 + entry.id) * 0.22 : 1;
          mat.opacity = base * alphaFade * flicker;
        }
      });
    }

    // Animate pooled Frost Zones (zero-GC per frame)
    for (let s = 0; s < this.frostPool.length; s++) {
      const slot = this.frostPool[s];
      if (!slot || !slot.active) continue;

      if (slot.spawnTime < 0) {
        slot.spawnTime = elapsed;
      }
      const age01 = Math.min(1, Math.max(0, (elapsed - slot.spawnTime) / 0.22));
      const lifeRatio = Math.max(0, Math.min(1, slot.ticksRemaining / Math.max(1, slot.maxTicks)));
      const fadeOut = lifeRatio < 0.3 ? lifeRatio / 0.3 : 1;
      const popScale = easeOutBack(age01);
      const activeScale = Math.max(0.05, slot.radius * popScale * (0.76 + 0.24 * fadeOut));

      slot.discGroup.scale.set(activeScale, 1, activeScale);
      slot.outerHexRing.rotation.z = elapsed * 0.75 + slot.zoneId * 0.5;
      slot.innerCrystalRing.rotation.z = -elapsed * 1.35 + slot.zoneId * 0.8;

      const shimmer = 0.8 + 0.2 * Math.sin(elapsed * 5.2 + slot.zoneId);
      const alpha = fadeOut * (0.45 + 0.55 * lifeRatio);
      slot.discMat.opacity = 0.24 * alpha * shimmer;
      slot.innerDiscMat.opacity = 0.26 * alpha * shimmer;
      slot.outerRingMat.opacity = 0.82 * alpha;
      slot.innerRingMat.opacity = 0.68 * alpha * shimmer;
      slot.gemMat.opacity = 0.9 * alpha;
      slot.gemMat.emissiveIntensity = 0.85 + 0.35 * Math.sin(elapsed * 6.5 + slot.zoneId);

      const gemOrbitR = activeScale * 0.72;
      const gemScale = Math.max(0.01, popScale * fadeOut);
      for (let g = 0; g < slot.gems.length; g++) {
        const gem = slot.gems[g];
        if (!gem) continue;
        const angle = (g / slot.gems.length) * Math.PI * 2 + elapsed * 0.9 + slot.zoneId;
        gem.position.set(
          Math.cos(angle) * gemOrbitR,
          0.16 + Math.sin(elapsed * 4.2 + g * 1.3 + slot.zoneId) * 0.08,
          Math.sin(angle) * gemOrbitR,
        );
        gem.rotation.y = elapsed * 2.4 + g;
        gem.rotation.x = elapsed * 1.6;
        const pulse = 0.86 + 0.2 * Math.sin(elapsed * 5 + g);
        gem.scale.setScalar(gemScale * pulse);
      }
    }
  }

  dispose(): void {
    for (const entry of this.flowers.values()) {
      this.scene.remove(entry.group);
      disposeGroup(entry.group);
    }
    this.flowers.clear();
    for (const entry of this.bolts.values()) {
      this.scene.remove(entry.group);
      disposeGroup(entry.group);
    }
    this.bolts.clear();
    for (const entry of this.blasts.values()) {
      this.scene.remove(entry.group);
      disposeGroup(entry.group);
    }
    this.blasts.clear();

    this.scene.remove(this.frostRoot);
    this.frostGeos.hexDiscGeo.dispose();
    this.frostGeos.innerDiscGeo.dispose();
    this.frostGeos.outerRingGeo.dispose();
    this.frostGeos.innerRingGeo.dispose();
    this.frostGeos.gemGeo.dispose();
    for (let i = 0; i < this.frostPool.length; i++) {
      const slot = this.frostPool[i];
      if (!slot) continue;
      slot.discMat.dispose();
      slot.innerDiscMat.dispose();
      slot.outerRingMat.dispose();
      slot.innerRingMat.dispose();
      slot.gemMat.dispose();
    }
    this.frostPool.length = 0;
  }

  // --- Private reconciliation ---

  private syncFrostZones(frostZones: readonly FrostZone[]): void {
    for (let s = 0; s < this.frostPool.length; s++) {
      const slot = this.frostPool[s];
      if (slot) slot.seen = false;
    }

    for (let i = 0; i < frostZones.length; i++) {
      const fz = frostZones[i];
      if (!fz) continue;

      let matched: FrostZoneSlot | undefined;
      for (let s = 0; s < this.frostPool.length; s++) {
        const candidate = this.frostPool[s];
        if (candidate && candidate.active && candidate.zoneId === fz.id) {
          matched = candidate;
          break;
        }
      }

      if (matched) {
        matched.seen = true;
        matched.radius = fz.radius;
        matched.ticksRemaining = fz.ticksRemaining;
        matched.maxTicks = fz.maxTicks;
      } else {
        let freeSlot: FrostZoneSlot | undefined;
        let oldestSlot: FrostZoneSlot | undefined;
        for (let s = 0; s < this.frostPool.length; s++) {
          const candidate = this.frostPool[s];
          if (!candidate) continue;
          if (!candidate.active) {
            freeSlot = candidate;
            break;
          }
          if (!oldestSlot || candidate.ticksRemaining < oldestSlot.ticksRemaining) {
            oldestSlot = candidate;
          }
        }
        const target = freeSlot ?? oldestSlot;
        if (!target) continue;

        target.active = true;
        target.seen = true;
        target.zoneId = fz.id;
        target.radius = fz.radius;
        target.ticksRemaining = fz.ticksRemaining;
        target.maxTicks = fz.maxTicks;
        target.spawnTime = -1;
        cellToWorld(fz.x, fz.z, this.half, this.scratchFrostPos);
        target.group.position.set(this.scratchFrostPos.x, FROST_FLOOR_Y, this.scratchFrostPos.z);
        target.group.visible = true;
      }
    }

    for (let s = 0; s < this.frostPool.length; s++) {
      const slot = this.frostPool[s];
      if (slot && slot.active && !slot.seen) {
        slot.active = false;
        slot.zoneId = -1;
        slot.group.visible = false;
      }
    }
  }

  private syncFlowers(gardenFlowers: readonly GardenFlower[]): void {
    const activeIds = new Set<number>();
    for (const flower of gardenFlowers) {
      activeIds.add(flower.id);
      if (!this.flowers.has(flower.id)) {
        const entry = createFlowerEntry(flower);
        const pos = cellToWorld(flower.x, flower.z, this.half, entry.group.position);
        pos.y = FLOOR_Y;
        entry.group.scale.setScalar(0.01);
        this.scene.add(entry.group);
        this.flowers.set(flower.id, entry);
      }
    }
    for (const [id, entry] of this.flowers) {
      if (!activeIds.has(id)) {
        this.scene.remove(entry.group);
        disposeGroup(entry.group);
        this.flowers.delete(id);
      }
    }
  }

  private syncBolts(lightningBolts: readonly SkyLightningBolt[]): void {
    const activeIds = new Set<number>();
    for (const bolt of lightningBolts) {
      activeIds.add(bolt.id);
      if (!this.bolts.has(bolt.id)) {
        const entry = createBoltEntry(bolt);
        const pos = cellToWorld(bolt.x, bolt.z, this.half, entry.group.position);
        pos.y = 0;
        this.scene.add(entry.group);
        this.bolts.set(bolt.id, entry);
      }
    }
    for (const [id, entry] of this.bolts) {
      if (!activeIds.has(id)) {
        this.scene.remove(entry.group);
        disposeGroup(entry.group);
        this.bolts.delete(id);
      }
    }
  }

  private syncBlasts(aoeBlasts: readonly AoeBlast[]): void {
    const activeIds = new Set<number>();
    for (const blast of aoeBlasts) {
      activeIds.add(blast.id);
      if (!this.blasts.has(blast.id)) {
        const entry = createBlastEntry(blast);
        const pos = cellToWorld(blast.x, blast.z, this.half, entry.group.position);
        pos.y = 0;
        this.scene.add(entry.group);
        this.blasts.set(blast.id, entry);
      }
    }
    for (const [id, entry] of this.blasts) {
      if (!activeIds.has(id)) {
        this.scene.remove(entry.group);
        disposeGroup(entry.group);
        this.blasts.delete(id);
      }
    }
  }
}

// --- Utilities ---

function easeOutBack(t: number): number {
  const c = 1.5;
  return 1 + (t - 1) * (t - 1) * ((c + 1) * (t - 1) + c);
}

function disposeGroup(group: Group): void {
  const disposedGeos = new Set<BufferGeometry>();
  const disposedMats = new Set<Material>();
  group.traverse((obj) => {
    if (obj instanceof Mesh) {
      if (obj.geometry && !disposedGeos.has(obj.geometry)) {
        disposedGeos.add(obj.geometry);
        obj.geometry.dispose();
      }
      const mat = obj.material;
      if (Array.isArray(mat)) {
        for (const m of mat) {
          if (m && !disposedMats.has(m)) {
            disposedMats.add(m);
            m.dispose();
          }
        }
      } else if (mat && !disposedMats.has(mat)) {
        disposedMats.add(mat);
        mat.dispose();
      }
    }
  });
}
