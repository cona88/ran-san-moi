import {
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Scene,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type {
  GameState,
  MonsterEventPhase,
  MonsterEventState,
  RoamingMonster,
  RoamingMonsterKind,
  ShelterHouse,
} from '../core/types';
import { cellToWorld } from './world';

const FLOOR_Y = -0.47;
const SHADOW_Y = 0.03; // Crisp ground shadow directly on the terrain (Y = 0.03)

// Reusable scratch objects (zero GC in draw)
const VEC_A = new Vector3();
const COLOR_SCRATCH = new Color();

// --- Visual structures for Shelter Houses ---

interface ShelterSparkleMote {
  readonly mesh: Mesh<OctahedronGeometry, MeshBasicMaterial>;
  readonly baseAngle: number;
  readonly radius: number;
  readonly speed: number;
  readonly bobSpeed: number;
  readonly phase: number;
  readonly baseScale: number;
}

interface ShelterVisualEntry {
  readonly shelter: ShelterHouse;
  readonly group: Group;
  readonly houseGroup: Group;
  readonly domeGroup: Group;
  readonly domeMesh: Mesh<SphereGeometry, MeshStandardMaterial>;
  readonly domeMat: MeshStandardMaterial;
  readonly domeLattice: Mesh<SphereGeometry, MeshBasicMaterial>;
  readonly domeLatticeMat: MeshBasicMaterial;
  readonly groundRing: Mesh<RingGeometry, MeshBasicMaterial>;
  readonly groundRingMat: MeshBasicMaterial;
  readonly auraPillar: Mesh<CylinderGeometry, MeshBasicMaterial>;
  readonly auraPillarMat: MeshBasicMaterial;
  readonly beaconBeam: Mesh<CylinderGeometry, MeshBasicMaterial>;
  readonly beaconBeamMat: MeshBasicMaterial;
  readonly sparkMotes: readonly ShelterSparkleMote[];
  // Dynamic state
  insideLevel: number; // 0..1 smooth interpolation
  warningLevel: number; // 0..1 smooth interpolation
  strikeLevel: number; // 0..1 deflection flash
}

/**
 * Creates the 3D geometry for a Fairy Mushroom House:
 * Tapered ivory stem, plump pastel dome cap with decorative spots, rounded wooden door,
 * glowing entrance archway, round fairy windows, and cute chimney with spores.
 */
function createMushroomHouse(shelter: ShelterHouse): Group {
  const house = new Group();
  const capColor = shelter.colorHex;

  // 1. Mushroom Stem / Stalk (tapered rounded ivory cylinder)
  const stemGeo = new CylinderGeometry(2.3, 3.4, 4.0, 18);
  const stemMat = new MeshStandardMaterial({
    color: 0xfff9f0,
    emissive: 0x443b30,
    emissiveIntensity: 0.15,
    roughness: 0.45,
    metalness: 0.05,
  });
  const stem = new Mesh(stemGeo, stemMat);
  stem.position.y = 1.6;
  house.add(stem);

  // 2. Mushroom Cap: plump fairy dome
  const capGeo = new SphereGeometry(5.4, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.52);
  capGeo.scale(1, 0.65, 1);
  const capMat = new MeshStandardMaterial({
    color: capColor,
    emissive: capColor,
    emissiveIntensity: 0.45,
    roughness: 0.28,
    metalness: 0.1,
  });
  const cap = new Mesh(capGeo, capMat);
  cap.position.y = 3.6;
  house.add(cap);

  // Cap under-skirt / gills ring
  const skirtGeo = new RingGeometry(2.2, 5.3, 24);
  const skirtMat = new MeshStandardMaterial({
    color: 0xfff1dc,
    emissive: 0x554433,
    emissiveIntensity: 0.2,
    side: DoubleSide,
    roughness: 0.5,
  });
  const skirt = new Mesh(skirtGeo, skirtMat);
  skirt.rotation.x = Math.PI / 2;
  skirt.position.y = 3.58;
  house.add(skirt);

  // 3. Cute Polka Dots on the cap (pastel white/cream spots embedded on the curved cap)
  const spotGeo = new SphereGeometry(0.55, 10, 8);
  spotGeo.scale(1, 0.35, 1);
  const spotMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffe6f5,
    emissiveIntensity: 0.3,
    roughness: 0.3,
  });

  const spotAngles = [
    { azimuth: 0.2, elevation: 0.55, r: 4.1 },
    { azimuth: 1.1, elevation: 0.75, r: 3.4 },
    { azimuth: 2.3, elevation: 0.6, r: 3.9 },
    { azimuth: 3.5, elevation: 0.8, r: 3.2 },
    { azimuth: 4.6, elevation: 0.5, r: 4.2 },
    { azimuth: 5.7, elevation: 0.7, r: 3.6 },
    { azimuth: 0.9, elevation: 0.3, r: 4.8 },
    { azimuth: 2.9, elevation: 0.35, r: 4.7 },
    { azimuth: 4.1, elevation: 0.28, r: 4.85 },
    { azimuth: 0.0, elevation: 0.95, r: 2.1 }, // near top
  ];

  for (const s of spotAngles) {
    const spot = new Mesh(spotGeo, spotMat);
    const sx = Math.cos(s.azimuth) * s.r;
    const sz = Math.sin(s.azimuth) * s.r;
    const sy = 3.6 + Math.sin(s.elevation) * 2.3;
    spot.position.set(sx, sy, sz);
    spot.lookAt(sx * 1.5, sy + 0.8, sz * 1.5);
    house.add(spot);
  }

  // 4. Arched Fairy Door with warm glowing portal
  const doorGroup = new Group();
  doorGroup.position.set(0, 0, 3.1);

  // Wooden door slab
  const doorGeo = new RoundedBoxGeometry(1.6, 2.5, 0.25, 3, 0.08);
  const doorMat = new MeshStandardMaterial({
    color: 0x8b5a2b,
    roughness: 0.65,
    metalness: 0.1,
  });
  const doorMesh = new Mesh(doorGeo, doorMat);
  doorMesh.position.y = 1.25;
  doorGroup.add(doorMesh);

  // Glowing magical entrance arch
  const archGeo = new RingGeometry(0.85, 1.15, 18, 1, 0, Math.PI);
  const archMat = new MeshBasicMaterial({
    color: 0xffea78,
    side: DoubleSide,
  });
  const arch = new Mesh(archGeo, archMat);
  arch.position.set(0, 1.9, 0.15);
  doorGroup.add(arch);

  // Glowing doorway threshold light
  const thresholdGeo = new CircleGeometry(0.78, 16, 0, Math.PI);
  const thresholdMat = new MeshBasicMaterial({
    color: 0xffe066,
    transparent: true,
    opacity: 0.85,
    side: DoubleSide,
  });
  const threshold = new Mesh(thresholdGeo, thresholdMat);
  threshold.position.set(0, 1.9, 0.14);
  doorGroup.add(threshold);

  // Brass knob
  const knobGeo = new SphereGeometry(0.12, 8, 8);
  const knobMat = new MeshStandardMaterial({
    color: 0xffd700,
    metalness: 0.8,
    roughness: 0.2,
  });
  const knob = new Mesh(knobGeo, knobMat);
  knob.position.set(0.55, 1.15, 0.18);
  doorGroup.add(knob);

  house.add(doorGroup);

  // 5. Cute Round Fairy Windows on sides
  const windowAngles = [-Math.PI * 0.45, Math.PI * 0.45];
  const winFrameGeo = new RingGeometry(0.48, 0.68, 16);
  const winFrameMat = new MeshStandardMaterial({ color: 0x6e431f, roughness: 0.7 });
  const winGlassGeo = new CircleGeometry(0.48, 16);
  const winGlassMat = new MeshBasicMaterial({
    color: 0xffeb3b,
    transparent: true,
    opacity: 0.9,
    side: DoubleSide,
  });

  for (const wa of windowAngles) {
    const winGrp = new Group();
    const wx = Math.sin(wa) * 2.85;
    const wz = Math.cos(wa) * 2.85;
    winGrp.position.set(wx, 2.0, wz);
    winGrp.rotation.y = wa;

    const frame = new Mesh(winFrameGeo, winFrameMat);
    const glass = new Mesh(winGlassGeo, winGlassMat);
    winGrp.add(frame, glass);
    house.add(winGrp);
  }

  // 6. Cute Mushroom Chimney on the roof
  const chimneyGeo = new CylinderGeometry(0.35, 0.42, 1.8, 10);
  const chimneyMat = new MeshStandardMaterial({ color: 0x9e7051, roughness: 0.8 });
  const chimney = new Mesh(chimneyGeo, chimneyMat);
  chimney.position.set(1.6, 5.2, -1.2);
  chimney.rotation.z = -0.15;
  house.add(chimney);

  // Chimney cap
  const chimneyCapGeo = new SphereGeometry(0.55, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const chimneyCapMat = new MeshStandardMaterial({
    color: capColor,
    emissive: capColor,
    emissiveIntensity: 0.35,
  });
  const chimneyCap = new Mesh(chimneyCapGeo, chimneyCapMat);
  chimneyCap.position.set(1.7, 6.1, -1.2);
  house.add(chimneyCap);

  return house;
}

/**
 * Creates the 3D geometry for the Central Royal Castle:
 * Grand stone keep, circular battlements, towering central spire crowned with a
 * golden rotating star, 4 flanking turrets with cute cone roofs, and royal arched gateway.
 */
function createCastleHouse(shelter: ShelterHouse): Group {
  const house = new Group();
  const royalGold = shelter.colorHex;

  // 1. Main Castle Citadel / Keep
  const keepGeo = new CylinderGeometry(4.4, 4.8, 4.4, 18);
  const keepMat = new MeshStandardMaterial({
    color: 0xfdf7ee,
    emissive: 0x4a3b2c,
    emissiveIntensity: 0.18,
    roughness: 0.45,
    metalness: 0.1,
  });
  const keep = new Mesh(keepGeo, keepMat);
  keep.position.y = 1.8;
  house.add(keep);

  // 2. Parapet / Battlements ring on top of keep
  const battlementCount = 12;
  const battlementGeo = new BoxGeometry(0.8, 0.7, 0.45);
  const battlementMat = new MeshStandardMaterial({ color: 0xf5ebd9, roughness: 0.4 });
  for (let i = 0; i < battlementCount; i++) {
    const angle = (i / battlementCount) * Math.PI * 2;
    const bm = new Mesh(battlementGeo, battlementMat);
    bm.position.set(Math.cos(angle) * 4.3, 4.25, Math.sin(angle) * 4.3);
    bm.rotation.y = -angle + Math.PI / 2;
    house.add(bm);
  }

  // 3. Central Grand Spire (lavender/royal gold)
  const spireBaseGeo = new CylinderGeometry(2.4, 2.7, 2.8, 14);
  const spireBaseMat = new MeshStandardMaterial({
    color: 0xf0e6ff,
    roughness: 0.35,
  });
  const spireBase = new Mesh(spireBaseGeo, spireBaseMat);
  spireBase.position.y = 4.8;
  house.add(spireBase);

  const spireRoofGeo = new ConeGeometry(2.6, 6.8, 16);
  const spireRoofMat = new MeshStandardMaterial({
    color: 0x9b51e0,
    emissive: 0x7b2cbf,
    emissiveIntensity: 0.5,
    roughness: 0.25,
    metalness: 0.15,
  });
  const spireRoof = new Mesh(spireRoofGeo, spireRoofMat);
  spireRoof.position.y = 9.4;
  house.add(spireRoof);

  // Golden star finial atop central spire
  const starGeo = new OctahedronGeometry(0.85, 0);
  const starMat = new MeshStandardMaterial({
    color: royalGold,
    emissive: royalGold,
    emissiveIntensity: 0.75,
    roughness: 0.15,
    metalness: 0.8,
  });
  const starFinial = new Mesh(starGeo, starMat);
  starFinial.position.y = 13.2;
  starFinial.name = 'starFinial';
  house.add(starFinial);

  // 4. 4 Flanking Corner Turrets
  const turretAngles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
  const turretBodyGeo = new CylinderGeometry(1.2, 1.35, 3.8, 12);
  const turretBodyMat = new MeshStandardMaterial({ color: 0xfdf7ee, roughness: 0.4 });
  const turretRoofGeo = new ConeGeometry(1.55, 3.0, 12);
  const turretRoofMat = new MeshStandardMaterial({
    color: 0xff6b8b,
    emissive: 0xff477e,
    emissiveIntensity: 0.45,
    roughness: 0.25,
  });

  for (const ta of turretAngles) {
    const tx = Math.cos(ta) * 4.6;
    const tz = Math.sin(ta) * 4.6;

    const turret = new Mesh(turretBodyGeo, turretBodyMat);
    turret.position.set(tx, 2.0, tz);

    const roof = new Mesh(turretRoofGeo, turretRoofMat);
    roof.position.set(tx, 4.8, tz);

    house.add(turret, roof);
  }

  // 5. Grand Arched Royal Gateway
  const gateGroup = new Group();
  gateGroup.position.set(0, 0, 4.4);

  const gateArchGeo = new RingGeometry(1.2, 1.6, 20, 1, 0, Math.PI);
  const gateArchMat = new MeshBasicMaterial({ color: royalGold, side: DoubleSide });
  const gateArch = new Mesh(gateArchGeo, gateArchMat);
  gateArch.position.set(0, 2.4, 0.2);
  gateGroup.add(gateArch);

  // Portal portal light
  const gateLightGeo = new CircleGeometry(1.2, 18, 0, Math.PI);
  const gateLightMat = new MeshBasicMaterial({
    color: 0xffea78,
    transparent: true,
    opacity: 0.88,
    side: DoubleSide,
  });
  const gateLight = new Mesh(gateLightGeo, gateLightMat);
  gateLight.position.set(0, 2.4, 0.18);
  gateGroup.add(gateLight);

  house.add(gateGroup);
  return house;
}

/**
 * Creates the 3D geometry for a Crystal Sanctuary:
 * Towering crystalline geode monoliths clustered organically, a floating rotating
 * apex crystal prism bobbing gently, and glowing runic crystalline shards.
 */
function createCrystalSanctuary(shelter: ShelterHouse): Group {
  const house = new Group();
  const crystalColor = shelter.colorHex;

  const crystalMat = new MeshStandardMaterial({
    color: crystalColor,
    emissive: crystalColor,
    emissiveIntensity: 0.55,
    roughness: 0.12,
    metalness: 0.25,
    transparent: true,
    opacity: 0.88,
  });

  // Cluster of 6 surrounding crystal monoliths
  const pillarConfigs = [
    { r: 2.8, angle: 0.3, height: 5.2, width: 1.1, tiltX: 0.08, tiltZ: -0.06 },
    { r: 3.2, angle: 1.3, height: 6.4, width: 1.3, tiltX: 0.05, tiltZ: 0.09 },
    { r: 2.7, angle: 2.4, height: 4.8, width: 1.0, tiltX: -0.07, tiltZ: 0.08 },
    { r: 3.4, angle: 3.6, height: 6.0, width: 1.25, tiltX: -0.09, tiltZ: -0.05 },
    { r: 2.9, angle: 4.8, height: 5.6, width: 1.15, tiltX: 0.04, tiltZ: -0.1 },
    { r: 3.1, angle: 5.8, height: 4.5, width: 1.05, tiltX: 0.08, tiltZ: 0.04 },
  ];

  for (const cfg of pillarConfigs) {
    const geo = new ConeGeometry(cfg.width, cfg.height, 6);
    const mesh = new Mesh(geo, crystalMat);
    const px = Math.cos(cfg.angle) * cfg.r;
    const pz = Math.sin(cfg.angle) * cfg.r;
    mesh.position.set(px, cfg.height * 0.5 - 0.2, pz);
    mesh.rotation.set(cfg.tiltX, cfg.angle, cfg.tiltZ);
    house.add(mesh);
  }

  // Floating giant central crystal prism
  const apexGeo = new OctahedronGeometry(1.8, 0);
  apexGeo.scale(0.8, 1.4, 0.8);
  const apexMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: crystalColor,
    emissiveIntensity: 0.85,
    roughness: 0.08,
    metalness: 0.35,
    transparent: true,
    opacity: 0.95,
  });
  const apexMesh = new Mesh(apexGeo, apexMat);
  apexMesh.position.set(0, 4.6, 0);
  apexMesh.name = 'crystalApex';
  house.add(apexMesh);

  // Runic floor ring
  const runeRingGeo = new RingGeometry(3.6, 4.4, 32);
  const runeRingMat = new MeshBasicMaterial({
    color: crystalColor,
    transparent: true,
    opacity: 0.5,
    side: DoubleSide,
  });
  const runeRing = new Mesh(runeRingGeo, runeRingMat);
  runeRing.rotation.x = -Math.PI / 2;
  runeRing.position.y = 0.02;
  house.add(runeRing);

  return house;
}

/**
 * Creates the 3D geometry for Mermaid Palace (Cung Điện Nàng Tiên Cá Đại Dương):
 * Pearlescent conch shell castle citadel, spiraling coral turrets (aquamarine cyan & coral pink),
 * giant glowing pearl dome apex, sparkling water ripples and rising air bubbles.
 */
export function createMermaidPalace(shelter: ShelterHouse): Group {
  const house = new Group();
  const cyanAqua = shelter.colorHex || 0x00e5ff;
  const coralPink = 0xff6987;
  const pearlGlow = 0xebffff;

  // 1. Conch Shell Citadel Keep
  const keepGeo = new CylinderGeometry(4.2, 5.0, 4.6, 20);
  const keepMat = new MeshStandardMaterial({
    color: pearlGlow,
    emissive: 0x00bcd4,
    emissiveIntensity: 0.22,
    roughness: 0.25,
    metalness: 0.35,
  });
  const keep = new Mesh(keepGeo, keepMat);
  keep.position.y = 1.9;
  house.add(keep);

  // Conch shell spiraling ridges
  const ridgeMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: cyanAqua,
    emissiveIntensity: 0.3,
    roughness: 0.2,
    metalness: 0.3,
  });
  for (let i = 0; i < 3; i++) {
    const ridgeGeo = new TorusGeometry(4.4 - i * 0.3, 0.22, 8, 24);
    const ridge = new Mesh(ridgeGeo, ridgeMat);
    ridge.rotation.x = Math.PI / 2;
    ridge.position.y = 1.0 + i * 1.3;
    house.add(ridge);
  }

  // Giant glowing pearl dome apex in coral oyster cup
  const oysterCupGeo = new CylinderGeometry(2.4, 1.8, 1.2, 16);
  const oysterCupMat = new MeshStandardMaterial({
    color: coralPink,
    emissive: 0xff4081,
    emissiveIntensity: 0.4,
    roughness: 0.35,
  });
  const oysterCup = new Mesh(oysterCupGeo, oysterCupMat);
  oysterCup.position.y = 4.4;
  house.add(oysterCup);

  const pearlGeo = new SphereGeometry(1.75, 24, 20);
  const pearlMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x7ef8ff,
    emissiveIntensity: 0.82,
    roughness: 0.12,
    metalness: 0.45,
  });
  const pearl = new Mesh(pearlGeo, pearlMat);
  pearl.position.y = 6.2;
  pearl.name = 'mermaidPearl';
  house.add(pearl);

  // 2. Spiraling coral turrets (4 flanking towers: 2 aquamarine cyan & 2 coral pink)
  const turretConfigs = [
    { angle: Math.PI * 0.25, color: cyanAqua, emissive: 0x00b4d8 },
    { angle: Math.PI * 0.75, color: coralPink, emissive: 0xff4081 },
    { angle: Math.PI * 1.25, color: cyanAqua, emissive: 0x00b4d8 },
    { angle: Math.PI * 1.75, color: coralPink, emissive: 0xff4081 },
  ];

  for (const t of turretConfigs) {
    const tx = Math.cos(t.angle) * 4.8;
    const tz = Math.sin(t.angle) * 4.8;

    const turretMat = new MeshStandardMaterial({
      color: t.color,
      emissive: t.emissive,
      emissiveIntensity: 0.45,
      roughness: 0.3,
      metalness: 0.2,
    });

    const colGeo = new CylinderGeometry(1.15, 1.35, 3.8, 14);
    const colMesh = new Mesh(colGeo, turretMat);
    colMesh.position.set(tx, 1.9, tz);

    const coneGeo = new ConeGeometry(1.4, 3.6, 14);
    const coneMesh = new Mesh(coneGeo, turretMat);
    coneMesh.position.set(tx, 4.8, tz);

    const miniPearlGeo = new SphereGeometry(0.35, 10, 8);
    const miniPearlMat = new MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x00e5ff,
      emissiveIntensity: 0.7,
      roughness: 0.15,
      metalness: 0.5,
    });
    const miniPearl = new Mesh(miniPearlGeo, miniPearlMat);
    miniPearl.position.set(tx, 6.7, tz);

    house.add(colMesh, coneMesh, miniPearl);
  }

  // 3. Sparkling water ripples
  const rippleGeo = new RingGeometry(2.5, 5.0, 32);
  const rippleMat = new MeshBasicMaterial({
    color: 0x29b6f6,
    transparent: true,
    opacity: 0.45,
    side: DoubleSide,
  });
  const ripples = new Mesh(rippleGeo, rippleMat);
  ripples.rotation.x = -Math.PI / 2;
  ripples.position.y = 0.02;
  ripples.name = 'mermaidRipples';
  house.add(ripples);

  // 4. Rising air bubbles
  const bubbleCount = 7;
  const bubbleGeo = new SphereGeometry(0.25, 10, 8);
  const bubbleMat = new MeshStandardMaterial({
    color: 0xe0f7fa,
    emissive: 0x80deea,
    emissiveIntensity: 0.65,
    roughness: 0.1,
    metalness: 0.3,
    transparent: true,
    opacity: 0.8,
  });
  for (let i = 0; i < bubbleCount; i++) {
    const bubble = new Mesh(bubbleGeo, bubbleMat);
    const a = (i / bubbleCount) * Math.PI * 2 + 0.3;
    const r = 1.8 + (i % 3) * 1.1;
    bubble.position.set(Math.cos(a) * r, 1.5 + i * 0.6, Math.sin(a) * r);
    bubble.name = `mermaidBubble_${i}`;
    house.add(bubble);
  }

  // 5. Arched seashell gateway
  const gateGroup = new Group();
  gateGroup.position.set(0, 0, 4.5);
  const archGeo = new RingGeometry(1.2, 1.7, 20, 1, 0, Math.PI);
  const archMat = new MeshBasicMaterial({ color: cyanAqua, side: DoubleSide });
  const arch = new Mesh(archGeo, archMat);
  arch.position.set(0, 2.4, 0.2);
  gateGroup.add(arch);

  const portalGeo = new CircleGeometry(1.2, 18, 0, Math.PI);
  const portalMat = new MeshBasicMaterial({
    color: 0x80deea,
    transparent: true,
    opacity: 0.85,
    side: DoubleSide,
  });
  const portal = new Mesh(portalGeo, portalMat);
  portal.position.set(0, 2.4, 0.18);
  gateGroup.add(portal);

  house.add(gateGroup);
  return house;
}

/**
 * Creates the 3D geometry for Candy Castle (Lâu Đài Kẹo Ngọt Cầu Vồng):
 * Marshmallow pastel pink & lavender towers, swirled lollipop spires, spun-sugar crystal roof,
 * rainbow gradient light arches.
 */
export function createCandyCastle(shelter: ShelterHouse): Group {
  const house = new Group();
  const marshmallowPink = 0xffc1e3;
  const marshmallowLavender = 0xebd9fc;
  const candyPink = shelter.colorHex || 0xff4081;
  const lollipopCyan = 0x00e5ff;
  const sugarCrystal = 0xff85c0;

  // 1. Marshmallow central keep
  const keepGeo = new CylinderGeometry(4.3, 4.7, 4.4, 18);
  const keepMat = new MeshStandardMaterial({
    color: marshmallowPink,
    emissive: 0xba68c8,
    emissiveIntensity: 0.22,
    roughness: 0.55,
    metalness: 0.05,
  });
  const keep = new Mesh(keepGeo, keepMat);
  keep.position.y = 1.8;
  house.add(keep);

  // 2. 4 Marshmallow pastel lavender towers with swirled lollipop spires
  const towerAngles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
  const towerGeo = new CylinderGeometry(1.25, 1.4, 4.0, 14);
  const towerMat = new MeshStandardMaterial({
    color: marshmallowLavender,
    emissive: 0x9c27b0,
    emissiveIntensity: 0.25,
    roughness: 0.5,
  });

  for (let i = 0; i < towerAngles.length; i++) {
    const ta = towerAngles[i]!;
    const tx = Math.cos(ta) * 4.6;
    const tz = Math.sin(ta) * 4.6;

    const tower = new Mesh(towerGeo, towerMat);
    tower.position.set(tx, 2.0, tz);
    house.add(tower);

    const stickGeo = new CylinderGeometry(0.18, 0.18, 2.2, 8);
    const stickMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const stick = new Mesh(stickGeo, stickMat);
    stick.position.set(tx, 4.6, tz);
    house.add(stick);

    const lolliColor = i % 2 === 0 ? candyPink : lollipopCyan;
    const lolliHeadGeo = new CylinderGeometry(0.85, 0.85, 0.32, 16);
    lolliHeadGeo.rotateX(Math.PI / 2);
    const lolliMat = new MeshStandardMaterial({
      color: lolliColor,
      emissive: lolliColor,
      emissiveIntensity: 0.65,
      roughness: 0.2,
      metalness: 0.15,
    });
    const lolliMesh = new Mesh(lolliHeadGeo, lolliMat);
    lolliMesh.position.set(tx, 5.8, tz);
    lolliMesh.name = `candyLolli_${i}`;
    house.add(lolliMesh);
  }

  // 3. Spun-sugar crystal roof
  const roofBaseGeo = new CylinderGeometry(2.5, 2.8, 2.4, 14);
  const roofBaseMat = new MeshStandardMaterial({
    color: 0xfff0f8,
    emissive: 0xff80ab,
    emissiveIntensity: 0.35,
    roughness: 0.25,
  });
  const roofBase = new Mesh(roofBaseGeo, roofBaseMat);
  roofBase.position.y = 4.6;
  house.add(roofBase);

  const roofConeGeo = new ConeGeometry(2.7, 5.8, 16);
  const roofConeMat = new MeshStandardMaterial({
    color: sugarCrystal,
    emissive: 0xff1493,
    emissiveIntensity: 0.55,
    roughness: 0.12,
    metalness: 0.2,
    transparent: true,
    opacity: 0.88,
  });
  const roofCone = new Mesh(roofConeGeo, roofConeMat);
  roofCone.position.y = 8.6;
  roofCone.name = 'candyRoofCone';
  house.add(roofCone);

  const starGeo = new OctahedronGeometry(0.85, 0);
  const starMat = new MeshStandardMaterial({
    color: 0xffeb3b,
    emissive: 0xffd700,
    emissiveIntensity: 0.85,
    roughness: 0.15,
    metalness: 0.5,
  });
  const star = new Mesh(starGeo, starMat);
  star.position.y = 12.0;
  star.name = 'candyStarFinial';
  house.add(star);

  // 4. Rainbow gradient light arches
  const rainbowGroup = new Group();
  rainbowGroup.position.set(0, 0, 4.4);
  const rainbowColors = [0xff4081, 0xff9800, 0xffeb3b, 0x4caf50, 0x00e5ff, 0x7c4dff];
  for (let i = 0; i < rainbowColors.length; i++) {
    const rIn = 1.1 + i * 0.18;
    const rOut = rIn + 0.16;
    const archRingGeo = new RingGeometry(rIn, rOut, 20, 1, 0, Math.PI);
    const archRingMat = new MeshBasicMaterial({
      color: rainbowColors[i]!,
      side: DoubleSide,
    });
    const archRing = new Mesh(archRingGeo, archRingMat);
    archRing.position.set(0, 1.8, 0.2 - i * 0.03);
    rainbowGroup.add(archRing);
  }

  const portalGeo = new CircleGeometry(1.05, 18, 0, Math.PI);
  const portalMat = new MeshBasicMaterial({
    color: 0xfff9c4,
    transparent: true,
    opacity: 0.9,
    side: DoubleSide,
  });
  const portal = new Mesh(portalGeo, portalMat);
  portal.position.set(0, 1.8, 0.22);
  rainbowGroup.add(portal);

  house.add(rainbowGroup);
  return house;
}

/**
 * Creates the 3D geometry for Blossom Sanctuary (Lâu Đài Hoa Tiên Bướm):
 * Layered glowing pink lotus/rose petals, fairy butterfly wing entrance, floating golden pollen particles.
 */
export function createBlossomSanctuary(shelter: ShelterHouse): Group {
  const house = new Group();
  const petalPink = shelter.colorHex || 0xff80bf;
  const coreGold = 0xffd700;
  const leafGreen = 0x66bb6a;

  // 1. Layered glowing lotus/rose petals
  const outerPetalGeo = new SphereGeometry(1.4, 12, 10);
  outerPetalGeo.scale(0.8, 1.8, 0.25);
  const petalMat = new MeshStandardMaterial({
    color: petalPink,
    emissive: 0xff4081,
    emissiveIntensity: 0.48,
    roughness: 0.35,
    metalness: 0.05,
    transparent: true,
    opacity: 0.92,
  });

  const outerCount = 8;
  for (let i = 0; i < outerCount; i++) {
    const a = (i / outerCount) * Math.PI * 2;
    const petal = new Mesh(outerPetalGeo, petalMat);
    const r = 3.6;
    petal.position.set(Math.cos(a) * r, 2.0, Math.sin(a) * r);
    petal.rotation.y = -a + Math.PI / 2;
    petal.rotation.x = 0.45;
    house.add(petal);
  }

  const innerPetalGeo = new SphereGeometry(1.2, 12, 10);
  innerPetalGeo.scale(0.7, 1.9, 0.22);
  const innerCount = 6;
  for (let i = 0; i < innerCount; i++) {
    const a = (i / innerCount) * Math.PI * 2 + 0.3;
    const petal = new Mesh(innerPetalGeo, petalMat);
    const r = 2.4;
    petal.position.set(Math.cos(a) * r, 2.7, Math.sin(a) * r);
    petal.rotation.y = -a + Math.PI / 2;
    petal.rotation.x = 0.22;
    house.add(petal);
  }

  // Golden lotus core altar
  const coreGeo = new CylinderGeometry(1.6, 2.0, 3.2, 16);
  const coreMat = new MeshStandardMaterial({
    color: 0xfff9c4,
    emissive: coreGold,
    emissiveIntensity: 0.75,
    roughness: 0.2,
    metalness: 0.2,
  });
  const core = new Mesh(coreGeo, coreMat);
  core.position.y = 1.6;
  core.name = 'blossomCore';
  house.add(core);

  // Floating blossom apex jewel
  const apexGeo = new OctahedronGeometry(1.1, 0);
  apexGeo.scale(0.8, 1.3, 0.8);
  const apexMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xff80ab,
    emissiveIntensity: 0.85,
    roughness: 0.15,
    metalness: 0.4,
  });
  const apex = new Mesh(apexGeo, apexMat);
  apex.position.y = 4.8;
  apex.name = 'blossomApex';
  house.add(apex);

  // 2. Fairy butterfly wing entrance
  const wingGroup = new Group();
  wingGroup.position.set(0, 0, 3.6);

  const wingGeo = new CircleGeometry(1.6, 16, 0, Math.PI * 1.3);
  const wingMat = new MeshStandardMaterial({
    color: 0xff4081,
    emissive: 0x7c4dff,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.75,
    side: DoubleSide,
    roughness: 0.3,
  });

  const leftWing = new Mesh(wingGeo, wingMat);
  leftWing.position.set(-1.1, 2.2, 0.2);
  leftWing.rotation.z = 0.4;
  leftWing.rotation.y = 0.2;
  leftWing.name = 'blossomWingLeft';

  const rightWing = new Mesh(wingGeo, wingMat);
  rightWing.position.set(1.1, 2.2, 0.2);
  rightWing.rotation.z = -0.4;
  rightWing.rotation.y = -0.2;
  rightWing.scale.x = -1;
  rightWing.name = 'blossomWingRight';

  wingGroup.add(leftWing, rightWing);

  const portalGeo = new CircleGeometry(1.1, 16, 0, Math.PI);
  const portalMat = new MeshBasicMaterial({
    color: 0xfff0f6,
    transparent: true,
    opacity: 0.88,
    side: DoubleSide,
  });
  const portal = new Mesh(portalGeo, portalMat);
  portal.position.set(0, 1.8, 0.15);
  wingGroup.add(portal);

  house.add(wingGroup);

  // 3. Floating golden pollen particles
  const pollenCount = 8;
  const pollenGeo = new SphereGeometry(0.18, 8, 6);
  const pollenMat = new MeshBasicMaterial({ color: 0xffeb3b });
  for (let i = 0; i < pollenCount; i++) {
    const pollen = new Mesh(pollenGeo, pollenMat);
    const a = (i / pollenCount) * Math.PI * 2;
    const r = 2.0 + (i % 3) * 0.9;
    pollen.position.set(Math.cos(a) * r, 1.2 + (i % 4) * 0.8, Math.sin(a) * r);
    pollen.name = `blossomPollen_${i}`;
    house.add(pollen);
  }

  // Lotus base lily pad ring
  const padGeo = new RingGeometry(2.8, 4.8, 24);
  const padMat = new MeshStandardMaterial({
    color: leafGreen,
    emissive: 0x2e7d32,
    emissiveIntensity: 0.25,
    roughness: 0.6,
    side: DoubleSide,
  });
  const pad = new Mesh(padGeo, padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.02;
  house.add(pad);

  return house;
}

/**
 * Creates the 3D geometry for Starlight Palace (Cung Điện Tinh Tú Ánh Sao):
 * Celestial blue & violet crystal towers, glowing moon crescent finials, rotating star apex,
 * constellation floor ring.
 */
export function createStarlightPalace(shelter: ShelterHouse): Group {
  const house = new Group();
  const celestialNavy = 0x1a237e;
  const cosmicViolet = shelter.colorHex || 0x7c4dff;
  const starCyan = 0x00e5ff;
  const moonGold = 0xfff8e1;

  // 1. Central hexagonal tower
  const keepGeo = new CylinderGeometry(3.6, 4.2, 5.2, 6);
  const keepMat = new MeshStandardMaterial({
    color: celestialNavy,
    emissive: cosmicViolet,
    emissiveIntensity: 0.42,
    roughness: 0.2,
    metalness: 0.45,
  });
  const keep = new Mesh(keepGeo, keepMat);
  keep.position.y = 2.3;
  house.add(keep);

  // 4 slender towers in cosmic violet with moon crescents
  const towerAngles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
  const towerGeo = new CylinderGeometry(1.1, 1.3, 4.8, 6);
  const towerMat = new MeshStandardMaterial({
    color: 0x311b92,
    emissive: cosmicViolet,
    emissiveIntensity: 0.5,
    roughness: 0.25,
    metalness: 0.35,
  });

  const moonMat = new MeshStandardMaterial({
    color: moonGold,
    emissive: 0xffd54f,
    emissiveIntensity: 0.85,
    roughness: 0.15,
    metalness: 0.4,
    side: DoubleSide,
  });

  for (let i = 0; i < towerAngles.length; i++) {
    const ta = towerAngles[i]!;
    const tx = Math.cos(ta) * 4.5;
    const tz = Math.sin(ta) * 4.5;

    const tower = new Mesh(towerGeo, towerMat);
    tower.position.set(tx, 2.4, tz);
    house.add(tower);

    const coneGeo = new ConeGeometry(1.3, 3.2, 6);
    const coneMat = new MeshStandardMaterial({
      color: 0x536dfe,
      emissive: 0x304ffe,
      emissiveIntensity: 0.55,
      roughness: 0.15,
      metalness: 0.3,
    });
    const cone = new Mesh(coneGeo, coneMat);
    cone.position.set(tx, 5.8, tz);
    house.add(cone);

    const crescentGeo = new RingGeometry(0.45, 0.75, 16, 1, 0, Math.PI * 1.5);
    const crescent = new Mesh(crescentGeo, moonMat);
    crescent.position.set(tx, 7.8, tz);
    crescent.rotation.y = ta;
    crescent.name = `moonCrescent_${i}`;
    house.add(crescent);
  }

  // 2. Central Spire & Rotating star apex
  const spireGeo = new ConeGeometry(2.4, 6.5, 8);
  const spireMat = new MeshStandardMaterial({
    color: 0x283593,
    emissive: 0x651fff,
    emissiveIntensity: 0.6,
    roughness: 0.18,
    metalness: 0.4,
  });
  const spire = new Mesh(spireGeo, spireMat);
  spire.position.y = 8.0;
  house.add(spire);

  const starGeo = new OctahedronGeometry(1.3, 0);
  const starMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: starCyan,
    emissiveIntensity: 0.95,
    roughness: 0.1,
    metalness: 0.7,
  });
  const starApex = new Mesh(starGeo, starMat);
  starApex.position.y = 12.0;
  starApex.name = 'starlightApex';
  house.add(starApex);

  // 3. Constellation floor ring
  const constRingGeo = new RingGeometry(3.5, 4.6, 32);
  const constRingMat = new MeshBasicMaterial({
    color: 0x80d8ff,
    transparent: true,
    opacity: 0.55,
    side: DoubleSide,
  });
  const constRing = new Mesh(constRingGeo, constRingMat);
  constRing.rotation.x = -Math.PI / 2;
  constRing.position.y = 0.02;
  constRing.name = 'constellationRing';
  house.add(constRing);

  const starNodeGeo = new OctahedronGeometry(0.25, 0);
  const starNodeMat = new MeshBasicMaterial({ color: 0xffffff });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const node = new Mesh(starNodeGeo, starNodeMat);
    node.position.set(Math.cos(a) * 4.05, 0.05, Math.sin(a) * 4.05);
    house.add(node);
  }

  // 4. Arched celestial gateway
  const gateGroup = new Group();
  gateGroup.position.set(0, 0, 4.1);

  const archGeo = new RingGeometry(1.2, 1.6, 20, 1, 0, Math.PI);
  const archMat = new MeshBasicMaterial({ color: starCyan, side: DoubleSide });
  const arch = new Mesh(archGeo, archMat);
  arch.position.set(0, 2.4, 0.2);
  gateGroup.add(arch);

  const portalGeo = new CircleGeometry(1.2, 18, 0, Math.PI);
  const portalMat = new MeshBasicMaterial({
    color: 0xb388ff,
    transparent: true,
    opacity: 0.88,
    side: DoubleSide,
  });
  const portal = new Mesh(portalGeo, portalMat);
  portal.position.set(0, 2.4, 0.18);
  gateGroup.add(portal);

  house.add(gateGroup);
  return house;
}

/**
 * Builds the visual representation of a single Sanctuary Shelter:
 * The house model, the protective translucent dome, ground boundary ring,
 * soothing aura light pillar, sky guidance beacon beam, and floating fairy motes.
 */
export function createShelterVisual(shelter: ShelterHouse): ShelterVisualEntry {
  const group = new Group();
  cellToWorld(shelter.x, shelter.z, 0, group.position);
  group.position.y = FLOOR_Y;

  // 1. House model based on kind
  let houseGroup: Group;
  switch (shelter.kind) {
    case 'castle':
      houseGroup = createCastleHouse(shelter);
      break;
    case 'mushroom':
      houseGroup = createMushroomHouse(shelter);
      break;
    case 'crystal':
      houseGroup = createCrystalSanctuary(shelter);
      break;
    case 'mermaid':
      houseGroup = createMermaidPalace(shelter);
      break;
    case 'candy':
      houseGroup = createCandyCastle(shelter);
      break;
    case 'blossom':
      houseGroup = createBlossomSanctuary(shelter);
      break;
    case 'starlight':
      houseGroup = createStarlightPalace(shelter);
      break;
    default:
      houseGroup = createCastleHouse(shelter);
      break;
  }
  group.add(houseGroup);

  // 2. Translucent Protective Dome / Shield
  const domeGroup = new Group();
  const domeRadius = shelter.radius;

  // Outer smooth protective dome (hemisphere)
  const domeGeo = new SphereGeometry(domeRadius, 32, 18, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const domeMat = new MeshStandardMaterial({
    color: shelter.colorHex,
    emissive: shelter.colorHex,
    emissiveIntensity: 0.22,
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 0.18,
    side: DoubleSide,
    depthWrite: false,
  });
  const domeMesh = new Mesh(domeGeo, domeMat);
  domeGroup.add(domeMesh);

  // Wireframe / hexagonal energy lattice
  const latticeGeo = new SphereGeometry(
    domeRadius * 1.002,
    18,
    10,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.5,
  );
  const domeLatticeMat = new MeshBasicMaterial({
    color: shelter.colorHex,
    wireframe: true,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });
  const domeLattice = new Mesh(latticeGeo, domeLatticeMat);
  domeGroup.add(domeLattice);

  // Ground boundary ring
  const ringGeo = new RingGeometry(domeRadius - 0.5, domeRadius + 0.1, 48);
  const groundRingMat = new MeshBasicMaterial({
    color: shelter.colorHex,
    transparent: true,
    opacity: 0.45,
    side: DoubleSide,
    depthWrite: false,
  });
  const groundRing = new Mesh(ringGeo, groundRingMat);
  groundRing.rotation.x = -Math.PI / 2;
  groundRing.position.y = 0.03;
  domeGroup.add(groundRing);

  // Soothing vertical aura pillar (illuminates when player is inside)
  const pillarGeo = new CylinderGeometry(domeRadius * 0.45, domeRadius * 0.55, 8.5, 24, 1, true);
  const auraPillarMat = new MeshBasicMaterial({
    color: shelter.colorHex,
    transparent: true,
    opacity: 0,
    side: DoubleSide,
    depthWrite: false,
  });
  const auraPillar = new Mesh(pillarGeo, auraPillarMat);
  auraPillar.position.y = 4.25;
  domeGroup.add(auraPillar);

  // Guidance beacon beam (illuminates sky during warning)
  const beaconGeo = new CylinderGeometry(0.8, 1.6, 55, 16, 1, true);
  const beaconBeamMat = new MeshBasicMaterial({
    color: 0xffea78,
    transparent: true,
    opacity: 0,
    side: DoubleSide,
    depthWrite: false,
  });
  const beaconBeam = new Mesh(beaconGeo, beaconBeamMat);
  beaconBeam.position.y = 27.5;
  domeGroup.add(beaconBeam);

  // Floating fairy sparkle motes inside sanctuary
  const sparkleMotes: ShelterSparkleMote[] = [];
  const sparkleCount = 8;
  const moteGeo = new OctahedronGeometry(0.18, 0);
  const moteMat = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.75,
  });

  for (let i = 0; i < sparkleCount; i++) {
    const mesh = new Mesh(moteGeo, moteMat);
    const baseAngle = (i / sparkleCount) * Math.PI * 2;
    const r = 2.0 + (i % 3) * 1.5;
    sparkleMotes.push({
      mesh,
      baseAngle,
      radius: r,
      speed: 0.4 + (i % 4) * 0.15,
      bobSpeed: 1.5 + (i % 3) * 0.5,
      phase: i * 0.78,
      baseScale: 0.8 + (i % 3) * 0.3,
    });
    domeGroup.add(mesh);
  }

  group.add(domeGroup);

  return {
    shelter,
    group,
    houseGroup,
    domeGroup,
    domeMesh,
    domeMat,
    domeLattice,
    domeLatticeMat,
    groundRing,
    groundRingMat,
    auraPillar,
    auraPillarMat,
    beaconBeam,
    beaconBeamMat,
    sparkMotes: sparkleMotes,
    insideLevel: 0,
    warningLevel: 0,
    strikeLevel: 0,
  };
}

// --- Visual structure for the Sky Monster Calamity (Storm Dragon Behemoth) ---

interface SkyMonsterVisual {
  readonly root: Group;
  readonly dragonGroup: Group;
  readonly behemothGroup: Group;
  readonly shadowMesh: Mesh<CircleGeometry, MeshBasicMaterial>;
  readonly headGroup: Group;
  readonly lowerJawGroup: Group;
  readonly eyeLeft: Mesh<SphereGeometry, MeshBasicMaterial>;
  readonly eyeRight: Mesh<SphereGeometry, MeshBasicMaterial>;
  readonly eyePupilLeft: Mesh<SphereGeometry, MeshBasicMaterial>;
  readonly eyePupilRight: Mesh<SphereGeometry, MeshBasicMaterial>;
  readonly clawLeft: Group;
  readonly clawRight: Group;
  readonly bodySegments: readonly Mesh[];
  readonly dorsalSpines: readonly Mesh[];
  readonly wingLeft: Group;
  readonly wingRight: Group;
  readonly stormArcs: readonly Mesh[];
  readonly wingMotes: readonly Mesh[];
  // Dynamic flight state
  flightAngle: number;
  altitude: number;
  targetAltitude: number;
  currentX: number;
  currentZ: number;
  swoopProgress: number;
  activePhase: MonsterEventPhase;
  hasSpawned: boolean;
  clawSwipePhase: number;
  roarIntensity: number;
}

/**
 * Creates the Sky Monster Calamity 3D entity:
 * An imposing, distinct, awesome 3D Behemoth / Storm Dragon:
 * - Large horned draconic skull with glowing red/cyan eyes, gaping animated jaws that chomp/snap as it pursues.
 * - Muscular segmented serpentine body with glowing dorsal spines and lightning sparks.
 * - Massive articulated wings that flap strongly, generating wind particle trails or storm arcs.
 * - Front claws/talons reaching forward toward the snake!
 * - Bold colors and emissive highlights (deep obsidian, vivid purple/crimson storm glow) visible against any floor theme.
 * - Large crisp ground shadow directly beneath the monster on the terrain (Y = 0.03).
 */
function createSkyMonsterVisual(): SkyMonsterVisual {
  const root = new Group();
  const dragonGroup = new Group();
  const behemothGroup = new Group();
  dragonGroup.add(behemothGroup);

  // Palettes:
  // Deep obsidian violet body with intense purple emissive glow
  const bodyMat = new MeshStandardMaterial({
    color: 0x140a22,
    emissive: 0x5a1288,
    emissiveIntensity: 0.75,
    roughness: 0.28,
    metalness: 0.65,
  });

  // Metallic dark horn with electric cyan glow
  const hornMat = new MeshStandardMaterial({
    color: 0x080210,
    emissive: 0x00e5ff,
    emissiveIntensity: 0.6,
    roughness: 0.2,
    metalness: 0.8,
  });

  // Glowing electric dorsal spines
  const spineMat = new MeshStandardMaterial({
    color: 0x100320,
    emissive: 0x00ffff,
    emissiveIntensity: 0.9,
    roughness: 0.2,
    metalness: 0.5,
  });

  // Sharp crimson/cyan fangs
  const fangMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xff0055,
    emissiveIntensity: 0.65,
    roughness: 0.15,
  });

  // Articulated dragon wing membrane: deep storm purple with high translucency & emissive
  const wingMembraneMat = new MeshStandardMaterial({
    color: 0x220938,
    emissive: 0x8a15b8,
    emissiveIntensity: 0.65,
    side: DoubleSide,
    transparent: true,
    opacity: 0.9,
    roughness: 0.35,
  });

  // 1. Dragon Head & Jaws Group
  const headGroup = new Group();

  // Cranium / Upper Skull
  const craniumGeo = new RoundedBoxGeometry(2.4, 1.7, 3.2, 3, 0.25);
  const cranium = new Mesh(craniumGeo, bodyMat);
  cranium.position.set(0, 0.2, 1.4);
  headGroup.add(cranium);

  // Snout (Upper Jaw)
  const snoutGeo = new RoundedBoxGeometry(1.8, 1.0, 2.4, 2, 0.15);
  const snout = new Mesh(snoutGeo, bodyMat);
  snout.position.set(0, -0.1, 3.7);
  headGroup.add(snout);

  // Upper fangs (4 vicious downward-pointing fangs)
  const fangGeo = new ConeGeometry(0.12, 0.6, 4);
  fangGeo.rotateX(Math.PI);
  const fangsUpPos: readonly [number, number, number][] = [
    [-0.65, -0.55, 4.4],
    [0.65, -0.55, 4.4],
    [-0.75, -0.55, 3.3],
    [0.75, -0.55, 3.3],
  ];
  for (const [fx, fy, fz] of fangsUpPos) {
    const f = new Mesh(fangGeo, fangMat);
    f.position.set(fx, fy, fz);
    headGroup.add(f);
  }

  // Animated Lower Jaw (hinged at back of skull)
  const lowerJawGroup = new Group();
  lowerJawGroup.position.set(0, -0.45, 1.6);

  const lowerJawGeo = new RoundedBoxGeometry(1.6, 0.65, 2.8, 2, 0.12);
  const lowerJaw = new Mesh(lowerJawGeo, bodyMat);
  lowerJaw.position.set(0, -0.15, 1.3);
  lowerJawGroup.add(lowerJaw);

  // Lower fangs (4 upward-pointing fangs)
  const lowerFangGeo = new ConeGeometry(0.12, 0.6, 4);
  const fangsLowPos: readonly [number, number, number][] = [
    [-0.55, 0.25, 2.3],
    [0.55, 0.25, 2.3],
    [-0.65, 0.25, 1.3],
    [0.65, 0.25, 1.3],
  ];
  for (const [fx, fy, fz] of fangsLowPos) {
    const f = new Mesh(lowerFangGeo, fangMat);
    f.position.set(fx, fy, fz);
    lowerJawGroup.add(f);
  }

  // Chin spike / barb
  const chinGeo = new ConeGeometry(0.2, 0.75, 4);
  chinGeo.rotateX(-0.4);
  const chin = new Mesh(chinGeo, hornMat);
  chin.position.set(0, -0.45, 2.3);
  lowerJawGroup.add(chin);

  headGroup.add(lowerJawGroup);

  // Fierce dual-layer glowing eyes (Electric Cyan + Crimson Core)
  const eyeOrbGeo = new SphereGeometry(0.35, 10, 10);
  const eyeOrbMat = new MeshBasicMaterial({ color: 0x00ffff });
  const eyeLeft = new Mesh(eyeOrbGeo, eyeOrbMat);
  eyeLeft.position.set(-1.05, 0.55, 2.4);
  const eyeRight = new Mesh(eyeOrbGeo, eyeOrbMat);
  eyeRight.position.set(1.05, 0.55, 2.4);

  const eyePupilGeo = new SphereGeometry(0.18, 8, 8);
  const eyePupilMat = new MeshBasicMaterial({ color: 0xff1744 });
  const eyePupilLeft = new Mesh(eyePupilGeo, eyePupilMat);
  eyePupilLeft.position.set(-1.12, 0.55, 2.62);
  const eyePupilRight = new Mesh(eyePupilGeo, eyePupilMat);
  eyePupilRight.position.set(1.12, 0.55, 2.62);

  headGroup.add(eyeLeft, eyeRight, eyePupilLeft, eyePupilRight);

  // Primary Swept Horns (grand draconic horns sweeping backward)
  const hornGeo = new ConeGeometry(0.48, 3.6, 7);
  const hornLeft = new Mesh(hornGeo, hornMat);
  hornLeft.position.set(-1.1, 1.45, 0.2);
  hornLeft.rotation.set(-0.5, -0.15, -0.32);

  const hornRight = new Mesh(hornGeo, hornMat);
  hornRight.position.set(1.1, 1.45, 0.2);
  hornRight.rotation.set(-0.5, 0.15, 0.32);

  // Cheek Mandible Spikes
  const cheekGeo = new ConeGeometry(0.3, 1.8, 5);
  const cheekLeft = new Mesh(cheekGeo, hornMat);
  cheekLeft.position.set(-1.3, -0.15, 1.6);
  cheekLeft.rotation.set(0.1, -0.3, -0.7);

  const cheekRight = new Mesh(cheekGeo, hornMat);
  cheekRight.position.set(1.3, -0.15, 1.6);
  cheekRight.rotation.set(0.1, 0.3, 0.7);

  headGroup.add(hornLeft, hornRight, cheekLeft, cheekRight);
  behemothGroup.add(headGroup);

  // 2. Front Claws / Talons Reaching Forward Toward Prey
  const clawLeft = new Group();
  clawLeft.position.set(-1.45, -0.25, 1.1);

  // Upper arm
  const armGeo1 = new CylinderGeometry(0.3, 0.22, 1.8, 8);
  const armUpperL = new Mesh(armGeo1, bodyMat);
  armUpperL.position.set(-0.5, -0.6, 0.4);
  armUpperL.rotation.set(0.4, 0, -0.3);
  clawLeft.add(armUpperL);

  // Forearm reaching forward
  const armGeo2 = new CylinderGeometry(0.22, 0.16, 1.6, 8);
  const forearmL = new Mesh(armGeo2, bodyMat);
  forearmL.position.set(-0.7, -1.3, 1.2);
  forearmL.rotation.set(-0.6, 0.2, 0);
  clawLeft.add(forearmL);

  // 3 Sharp Talons curving forward
  const talonGeo = new ConeGeometry(0.14, 0.9, 5);
  talonGeo.rotateX(-0.5);
  const talonL1 = new Mesh(talonGeo, hornMat);
  talonL1.position.set(-0.95, -1.9, 1.8);
  const talonL2 = new Mesh(talonGeo, hornMat);
  talonL2.position.set(-0.7, -1.95, 2.05);
  const talonL3 = new Mesh(talonGeo, hornMat);
  talonL3.position.set(-0.45, -1.9, 1.8);
  clawLeft.add(talonL1, talonL2, talonL3);

  // Mirrored Right Claw
  const clawRight = new Group();
  clawRight.position.set(1.45, -0.25, 1.1);

  const armUpperR = new Mesh(armGeo1, bodyMat);
  armUpperR.position.set(0.5, -0.6, 0.4);
  armUpperR.rotation.set(0.4, 0, 0.3);
  clawRight.add(armUpperR);

  const forearmR = new Mesh(armGeo2, bodyMat);
  forearmR.position.set(0.7, -1.3, 1.2);
  forearmR.rotation.set(-0.6, -0.2, 0);
  clawRight.add(forearmR);

  const talonR1 = new Mesh(talonGeo, hornMat);
  talonR1.position.set(0.95, -1.9, 1.8);
  const talonR2 = new Mesh(talonGeo, hornMat);
  talonR2.position.set(0.7, -1.95, 2.05);
  const talonR3 = new Mesh(talonGeo, hornMat);
  talonR3.position.set(0.45, -1.9, 1.8);
  clawRight.add(talonR1, talonR2, talonR3);

  behemothGroup.add(clawLeft, clawRight);

  // 3. Segmented Serpentine Dragon Body & Dorsal Spines
  const bodySegments: Mesh[] = [];
  const dorsalSpines: Mesh[] = [];
  const segCount = 8;

  for (let i = 0; i < segCount; i++) {
    const t = 1.0 - (i / segCount) * 0.62;
    const segGeo = new SphereGeometry(1.65 * t, 12, 10);
    segGeo.scale(1, 0.88, 1.45);
    const seg = new Mesh(segGeo, bodyMat);
    seg.position.set(0, 0, -1.8 - i * 2.2);
    behemothGroup.add(seg);
    bodySegments.push(seg);

    // Glowing dorsal spine
    const spineGeo = new ConeGeometry(0.36 * t, 1.5 * t, 4);
    const spine = new Mesh(spineGeo, spineMat);
    spine.position.set(0, 1.45 * t, -1.8 - i * 2.2);
    spine.rotation.x = -0.25;
    behemothGroup.add(spine);
    dorsalSpines.push(spine);
  }

  // Tail barb and horizontal stabilizers at the end of the serpentine body
  const tailBarbGeo = new ConeGeometry(0.38, 2.2, 4);
  tailBarbGeo.rotateX(-Math.PI / 2);
  const tailBarb = new Mesh(tailBarbGeo, hornMat);
  tailBarb.position.set(0, 0, -1.8 - segCount * 2.2 + 0.3);
  behemothGroup.add(tailBarb);

  const tailFinGeo = new BoxGeometry(2.4, 0.12, 1.2);
  const tailFin = new Mesh(tailFinGeo, wingMembraneMat);
  tailFin.position.set(0, 0, -1.8 - segCount * 2.2 + 0.5);
  behemothGroup.add(tailFin);

  // 4. Massive Articulated Wings (Left & Right)
  const wingLeft = new Group();
  wingLeft.position.set(-1.4, 0.9, -0.3);

  // Primary Wing Spar
  const spar1Geo = new CylinderGeometry(0.32, 0.24, 4.6, 8);
  spar1Geo.rotateZ(Math.PI / 2.3);
  const spar1L = new Mesh(spar1Geo, bodyMat);
  spar1L.position.set(-2.2, 0.6, 0);
  wingLeft.add(spar1L);

  // Secondary Wing Spar
  const spar2Geo = new CylinderGeometry(0.24, 0.14, 5.4, 8);
  spar2Geo.rotateZ(Math.PI / 2.6);
  const spar2L = new Mesh(spar2Geo, bodyMat);
  spar2L.position.set(-5.8, 1.6, -0.4);
  wingLeft.add(spar2L);

  // Wing Membrane
  const wingGeo = new RingGeometry(1.0, 8.5, 10, 1, 0, Math.PI * 0.88);
  const membraneL = new Mesh(wingGeo, wingMembraneMat);
  membraneL.rotation.x = Math.PI / 2;
  membraneL.position.set(-4.5, 0.9, -2.2);
  wingLeft.add(membraneL);

  // Right Wing
  const wingRight = new Group();
  wingRight.position.set(1.4, 0.9, -0.3);

  const spar1R = new Mesh(spar1Geo, bodyMat);
  spar1R.position.set(2.2, 0.6, 0);
  spar1R.rotation.y = Math.PI;
  wingRight.add(spar1R);

  const spar2R = new Mesh(spar2Geo, bodyMat);
  spar2R.position.set(5.8, 1.6, -0.4);
  spar2R.rotation.y = Math.PI;
  wingRight.add(spar2R);

  const membraneR = new Mesh(wingGeo, wingMembraneMat);
  membraneR.rotation.x = Math.PI / 2;
  membraneR.rotation.z = Math.PI;
  membraneR.position.set(4.5, 0.9, -2.2);
  wingRight.add(membraneR);

  behemothGroup.add(wingLeft, wingRight);

  // 5. Storm Lightning Arcs & Wingtip Particles
  const stormArcs: Mesh[] = [];
  const arcGeo = new OctahedronGeometry(0.35, 0);
  const arcMat = new MeshBasicMaterial({ color: 0x7df9ff });
  for (let i = 0; i < 8; i++) {
    const arc = new Mesh(arcGeo, arcMat);
    arc.visible = false;
    behemothGroup.add(arc);
    stormArcs.push(arc);
  }

  const wingMotes: Mesh[] = [];
  const moteGeo = new OctahedronGeometry(0.24, 0);
  const moteMat = new MeshBasicMaterial({
    color: 0xdf66ff,
    transparent: true,
    opacity: 0.85,
  });
  for (let i = 0; i < 4; i++) {
    const mote = new Mesh(moteGeo, moteMat);
    mote.visible = false;
    behemothGroup.add(mote);
    wingMotes.push(mote);
  }

  root.add(dragonGroup);

  // 6. Large Crisp Ground Shadow directly beneath monster on terrain (Y = 0.03)
  const shadowGeo = new CircleGeometry(7.5, 32);
  const shadowMat = new MeshBasicMaterial({
    color: 0x030108,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const shadowMesh = new Mesh(shadowGeo, shadowMat);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.y = SHADOW_Y;
  root.add(shadowMesh);

  return {
    root,
    dragonGroup,
    behemothGroup,
    shadowMesh,
    headGroup,
    lowerJawGroup,
    eyeLeft,
    eyeRight,
    eyePupilLeft,
    eyePupilRight,
    clawLeft,
    clawRight,
    bodySegments,
    dorsalSpines,
    wingLeft,
    wingRight,
    stormArcs,
    wingMotes,
    flightAngle: 0,
    altitude: 95,
    targetAltitude: 95,
    currentX: 0,
    currentZ: 0,
    swoopProgress: 0,
    activePhase: 'idle',
    hasSpawned: false,
    clawSwipePhase: 0,
    roarIntensity: 0,
  };
}

/**
 * 3D Rendering Controller for Snake Shelters (Fairy Houses) and the Sky Monster Calamity.
 *
 * Responsibilities:
 * - Renders 7 Sanctuary Houses (Royal Castle, Mushroom Cottages, Crystal Sanctuaries).
 * - Smoothly manages the glowing protective domes, ground boundary rings, and soothing entrance auras.
 * - Renders the Sky Monster Calamity: soaring across clouds during warning, casting moving ground shadows,
 *   swooping down during strike, and deflecting against shelter shields.
 * - Ensures zero GC during 60fps draw and clean mesh disposal on reset.
 */
export class Shelter3DView {
  private readonly root = new Group();
  private readonly shelterVisuals: ShelterVisualEntry[] = [];
  private readonly skyMonster: SkyMonsterVisual;

  constructor(
    private readonly scene: Scene,
    _maxGrid = 560,
  ) {
    this.skyMonster = createSkyMonsterVisual();
    this.root.add(this.skyMonster.root);
    this.scene.add(this.root);
  }

  /**
   * Sync active shelter houses from GameState into 3D view.
   * If shelters array has changed or is initialized, updates or creates visuals.
   */
  sync(state: GameState): void {
    const shelters = state.shelters ?? [];
    if (this.shelterVisuals.length !== shelters.length) {
      this.rebuildShelters(shelters);
    }
  }

  private rebuildShelters(shelters: readonly ShelterHouse[]): void {
    // Clear old visuals
    for (const v of this.shelterVisuals) {
      this.root.remove(v.group);
      disposeGroup(v.group);
    }
    this.shelterVisuals.length = 0;

    // Create fresh visuals
    for (const s of shelters) {
      const visual = createShelterVisual(s);
      this.root.add(visual.group);
      this.shelterVisuals.push(visual);
    }
  }

  /**
   * Render and animate shelter houses, protective domes, and the Sky Monster Calamity.
   * Runs at 60fps with zero allocations.
   */
  draw(elapsed: number, delta: number, state: GameState): void {
    const dt = Math.min(Math.max(delta, 0), 0.1);
    const monsterEvent: MonsterEventState = state.monsterEvent ?? {
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
    const playerInShelter = state.inShelter ?? false;
    const currentShelterId = state.currentShelterId ?? null;

    // 1. Animate Sanctuary Houses & Protective Domes
    for (const entry of this.shelterVisuals) {
      const isPlayerInside = playerInShelter && currentShelterId === entry.shelter.id;
      const isWarning = monsterEvent.phase === 'warning';
      const isStrike = monsterEvent.phase === 'strike';

      // Smooth interpolation for inside aura
      const targetInside = isPlayerInside ? 1.0 : 0.0;
      entry.insideLevel += (targetInside - entry.insideLevel) * (1 - Math.exp(-6 * dt));

      // Warning urgency level
      const targetWarning = isWarning ? 1.0 : 0.0;
      entry.warningLevel += (targetWarning - entry.warningLevel) * (1 - Math.exp(-8 * dt));

      // Strike deflection level
      const targetStrike = isStrike ? 1.0 : 0.0;
      entry.strikeLevel += (targetStrike - entry.strikeLevel) * (1 - Math.exp(-12 * dt));

      // Gentle decorative animations
      if (entry.shelter.kind === 'castle') {
        const star = entry.houseGroup.getObjectByName('starFinial');
        if (star) {
          star.rotation.y = elapsed * 1.5;
          star.position.y = 13.2 + Math.sin(elapsed * 2.5) * 0.2;
        }
      } else if (entry.shelter.kind === 'crystal') {
        const apex = entry.houseGroup.getObjectByName('crystalApex');
        if (apex) {
          apex.rotation.y = elapsed * 1.2;
          apex.rotation.x = Math.sin(elapsed * 0.8) * 0.15;
          apex.position.y = 4.6 + Math.sin(elapsed * 2.0) * 0.25;
        }
      } else if (entry.shelter.kind === 'mermaid') {
        const pearl = entry.houseGroup.getObjectByName('mermaidPearl');
        if (pearl) {
          pearl.rotation.y = elapsed * 0.8;
          pearl.position.y = 6.2 + Math.sin(elapsed * 2.0) * 0.2;
        }
        const ripples = entry.houseGroup.getObjectByName('mermaidRipples');
        if (ripples) {
          ripples.rotation.z = elapsed * 0.25;
        }
        for (let i = 0; i < 7; i++) {
          const bubble = entry.houseGroup.getObjectByName(`mermaidBubble_${i}`);
          if (bubble) {
            bubble.position.y = 1.5 + ((elapsed * 1.2 + i * 0.8) % 4.0);
            bubble.scale.setScalar(0.8 + Math.sin(elapsed * 3.0 + i) * 0.2);
          }
        }
      } else if (entry.shelter.kind === 'candy') {
        const star = entry.houseGroup.getObjectByName('candyStarFinial');
        if (star) {
          star.rotation.y = elapsed * 1.6;
        }
        const roof = entry.houseGroup.getObjectByName('candyRoofCone');
        if (roof) {
          roof.rotation.y = -elapsed * 0.3;
        }
        for (let i = 0; i < 4; i++) {
          const lolli = entry.houseGroup.getObjectByName(`candyLolli_${i}`);
          if (lolli) {
            lolli.rotation.z = elapsed * 1.8 * (i % 2 === 0 ? 1 : -1);
          }
        }
      } else if (entry.shelter.kind === 'blossom') {
        const apex = entry.houseGroup.getObjectByName('blossomApex');
        if (apex) {
          apex.rotation.y = elapsed * 1.3;
          apex.position.y = 4.8 + Math.sin(elapsed * 2.0) * 0.18;
        }
        const leftWing = entry.houseGroup.getObjectByName('blossomWingLeft');
        const rightWing = entry.houseGroup.getObjectByName('blossomWingRight');
        if (leftWing && rightWing) {
          leftWing.rotation.y = 0.2 + Math.sin(elapsed * 3.5) * 0.15;
          rightWing.rotation.y = -0.2 - Math.sin(elapsed * 3.5) * 0.15;
        }
        for (let i = 0; i < 8; i++) {
          const pollen = entry.houseGroup.getObjectByName(`blossomPollen_${i}`);
          if (pollen) {
            pollen.position.y = 1.2 + (i % 4) * 0.8 + Math.sin(elapsed * 2.5 + i) * 0.25;
            pollen.rotation.y = elapsed * 1.5;
          }
        }
      } else if (entry.shelter.kind === 'starlight') {
        const apex = entry.houseGroup.getObjectByName('starlightApex');
        if (apex) {
          apex.rotation.y = elapsed * 2.0;
          apex.rotation.x = Math.sin(elapsed * 1.2) * 0.2;
        }
        const ring = entry.houseGroup.getObjectByName('constellationRing');
        if (ring) {
          ring.rotation.z = elapsed * 0.2;
        }
        for (let i = 0; i < 4; i++) {
          const crescent = entry.houseGroup.getObjectByName(`moonCrescent_${i}`);
          if (crescent) {
            crescent.rotation.z = Math.sin(elapsed * 2.0 + i) * 0.15;
          }
        }
      }

      // Protective Dome visual pulsation
      const baseOpacity = 0.18;
      const insidePulse = Math.sin(elapsed * 3.5) * 0.08;
      const warningPulse = isWarning ? Math.sin(elapsed * 8.0) * 0.12 : 0;
      const strikeFlash = entry.strikeLevel * 0.55;

      const domeOpacity =
        baseOpacity +
        entry.insideLevel * 0.32 +
        insidePulse * entry.insideLevel +
        warningPulse +
        strikeFlash;
      entry.domeMat.opacity = Math.min(0.92, Math.max(0.12, domeOpacity));

      // Emissive glow modulation
      const baseEmissive = 0.22;
      entry.domeMat.emissiveIntensity =
        baseEmissive +
        entry.insideLevel * 0.55 +
        Math.sin(elapsed * 4.0) * 0.15 * entry.insideLevel +
        entry.strikeLevel * 0.8;

      // Lattice rotation
      entry.domeLattice.rotation.y = elapsed * 0.15;
      entry.domeLatticeMat.opacity = 0.1 + entry.insideLevel * 0.25 + entry.strikeLevel * 0.4;

      // Ground safety ring: pulses brightly and rotates slowly
      entry.groundRing.rotation.z = elapsed * 0.25;
      const ringPulse = Math.sin(elapsed * 3.0) * 0.12;
      const warningRingPulse = isWarning ? Math.sin(elapsed * 12.0) * 0.35 : 0;
      entry.groundRingMat.opacity =
        0.4 + entry.insideLevel * 0.45 + ringPulse + warningRingPulse + entry.strikeLevel * 0.5;

      // Color shift when inside (soothing warm golden/pastel radiance)
      if (entry.insideLevel > 0.05) {
        COLOR_SCRATCH.setHex(entry.shelter.colorHex).lerp(
          new Color(0xfff0aa),
          entry.insideLevel * 0.4,
        );
        entry.groundRingMat.color.copy(COLOR_SCRATCH);
      } else {
        entry.groundRingMat.color.setHex(entry.shelter.colorHex);
      }

      // Vertical soothing aura pillar
      entry.auraPillarMat.opacity =
        entry.insideLevel * 0.38 * (0.8 + Math.sin(elapsed * 4.5) * 0.2);
      entry.auraPillar.rotation.y = -elapsed * 0.5;

      // Sky guidance beacon beam (only during warning, guides players from across the arena!)
      if (entry.warningLevel > 0.05) {
        const beaconPulse = 0.45 + Math.sin(elapsed * 6.0) * 0.3;
        entry.beaconBeamMat.opacity = entry.warningLevel * beaconPulse;
        entry.beaconBeam.rotation.y = elapsed * 0.8;
      } else {
        entry.beaconBeamMat.opacity = 0;
      }

      // Floating fairy sparkle motes inside sanctuary
      for (const mote of entry.sparkMotes) {
        const a = mote.baseAngle + elapsed * mote.speed;
        const mx = Math.cos(a) * mote.radius;
        const mz = Math.sin(a) * mote.radius;
        const my = 0.6 + Math.sin(elapsed * mote.bobSpeed + mote.phase) * 0.7 + mote.phase * 0.4;
        mote.mesh.position.set(mx, my, mz);
        mote.mesh.rotation.x = elapsed * 2.0 + mote.phase;
        mote.mesh.rotation.y = elapsed * 1.5;

        // Sparkles grow slightly brighter when player enters
        const moteScale = mote.baseScale * (1.0 + entry.insideLevel * 0.6);
        mote.mesh.scale.setScalar(moteScale);
      }
    }

    // 2. Animate the Sky Monster Calamity
    this.animateSkyMonster(elapsed, dt, state, monsterEvent);
  }

  private animateSkyMonster(
    elapsed: number,
    dt: number,
    state: GameState,
    monsterEvent: MonsterEventState,
  ): void {
    const sm = this.skyMonster;
    const playerHead = state.snake[0];
    const playerX = playerHead ? playerHead.x : 0;
    const playerZ = playerHead ? playerHead.z : 0;
    const isPlayerInShelter = state.inShelter ?? false;

    sm.activePhase = monsterEvent.phase;

    if (monsterEvent.phase === 'idle') {
      // Monster retreats to upper stratosphere
      sm.targetAltitude = 110;
      sm.altitude += (sm.targetAltitude - sm.altitude) * (1 - Math.exp(-4 * dt));
      sm.dragonGroup.position.set(sm.currentX, sm.altitude, sm.currentZ);
      sm.dragonGroup.visible = sm.altitude < 90;
      sm.shadowMesh.visible = false;
      sm.hasSpawned = false;
      return;
    }

    sm.dragonGroup.visible = true;

    if (monsterEvent.phase === 'warning') {
      const progress = monsterEvent.progress ?? 0;

      // Spawn swooping in when warning first starts
      if (!sm.hasSpawned) {
        sm.hasSpawned = true;
        if (monsterEvent.monsterPos) {
          sm.currentX = monsterEvent.monsterPos.x;
          sm.currentZ = monsterEvent.monsterPos.z;
        } else {
          sm.currentX = playerX;
          sm.currentZ = playerZ - 25;
        }
        sm.altitude = 7.5; // Starts just above chase altitude and swoops in immediately
      }

      // Camera-visible Low-Altitude Pursuit: Y = 3.5 to 5.5 units
      // Hovering menacingly right above the snake and terrain, squarely inside the camera viewport!
      sm.targetAltitude = 4.2 + Math.sin(elapsed * 3.5) * 0.45;
      sm.altitude += (sm.targetAltitude - sm.altitude) * (1 - Math.exp(-10 * dt));

      // Pursuit Coordinates: Track monsterEvent.monsterPos (simulated by core) or fallback toward player
      let targetX = playerX;
      let targetZ = playerZ;
      if (monsterEvent.monsterPos) {
        targetX = monsterEvent.monsterPos.x;
        targetZ = monsterEvent.monsterPos.z;
      }

      // Smooth pursuit interpolation (fast, agile hunter)
      sm.currentX += (targetX - sm.currentX) * (1 - Math.exp(-14 * dt));
      sm.currentZ += (targetZ - sm.currentZ) * (1 - Math.exp(-14 * dt));
      sm.dragonGroup.position.set(sm.currentX, sm.altitude, sm.currentZ);

      // Facing: Point monster directly toward playerHead / snake tail
      // Facing slightly downward toward the snake on the terrain
      VEC_A.set(playerX, sm.altitude * 0.72, playerZ);
      sm.dragonGroup.lookAt(VEC_A);

      // Shield Collision & Blocked State Check
      const isBlocked = Boolean(monsterEvent.isBlockedByShelter || isPlayerInShelter);

      if (isBlocked) {
        // Monster is blocked at the perimeter of the shelter's protective dome!
        // 1. Claws furiously swipe and slash at the glowing shield dome
        sm.clawSwipePhase += dt * 18;
        sm.clawLeft.rotation.x = Math.sin(sm.clawSwipePhase) * 0.75;
        sm.clawRight.rotation.x = -Math.sin(sm.clawSwipePhase) * 0.75;
        sm.clawLeft.rotation.y = 0.4 + Math.cos(sm.clawSwipePhase * 0.8) * 0.35;
        sm.clawRight.rotation.y = -0.4 - Math.cos(sm.clawSwipePhase * 0.8) * 0.35;

        // 2. Gaping animated jaws roaring furiously, unable to enter
        sm.roarIntensity += (1.0 - sm.roarIntensity) * (1 - Math.exp(-10 * dt));
        sm.lowerJawGroup.rotation.x = 0.65 + Math.sin(elapsed * 12) * 0.22;

        // 3. Wings flapping furiously in hover
        const flapFreq = 14.0;
        const wingFlap = Math.sin(elapsed * flapFreq) * 0.58;
        sm.wingLeft.rotation.z = wingFlap;
        sm.wingRight.rotation.z = -wingFlap;
        sm.wingLeft.rotation.x = Math.cos(elapsed * flapFreq) * 0.3;
        sm.wingRight.rotation.x = Math.cos(elapsed * flapFreq) * 0.3;

        // 4. Frustrated recoil shudder on the behemoth
        sm.behemothGroup.position.set(
          (Math.random() - 0.5) * 0.16,
          (Math.random() - 0.5) * 0.16,
          (Math.random() - 0.5) * 0.16,
        );

        // 5. Electric sparks discharging at the barrier shield
        for (let i = 0; i < sm.stormArcs.length; i++) {
          const arc = sm.stormArcs[i]!;
          arc.visible = true;
          arc.position.set(
            (Math.sin(elapsed * 25 + i * 1.7) - 0.5) * 3.2,
            (Math.cos(elapsed * 30 + i * 2.1) - 0.5) * 2.4,
            3.0 + Math.sin(elapsed * 40 + i) * 1.5,
          );
        }
      } else {
        // Active predatory chase in the open arena!
        sm.roarIntensity += (0.0 - sm.roarIntensity) * (1 - Math.exp(-6 * dt));
        sm.behemothGroup.position.set(0, 0, 0);

        // 1. Animated chomping jaws: rhythmically snaps shut as it pursues
        sm.lowerJawGroup.rotation.x = Math.max(0, Math.sin(elapsed * 7.5) * 0.48);

        // 2. Front claws reach forward toward the snake
        sm.clawLeft.rotation.x = 0.35 + Math.sin(elapsed * 6.0) * 0.22;
        sm.clawRight.rotation.x = 0.35 + Math.sin(elapsed * 6.0 + 1.2) * 0.22;
        sm.clawLeft.rotation.y = 0.15;
        sm.clawRight.rotation.y = -0.15;

        // 3. Strong flapping wings (accelerates as warning progresses)
        const flapFreq = 7.0 + progress * 3.5;
        const wingFlap = Math.sin(elapsed * flapFreq) * 0.48;
        sm.wingLeft.rotation.z = wingFlap;
        sm.wingRight.rotation.z = -wingFlap;
        sm.wingLeft.rotation.x = Math.cos(elapsed * flapFreq) * 0.22;
        sm.wingRight.rotation.x = Math.cos(elapsed * flapFreq) * 0.22;

        // 4. Crackling lightning sparks along dragon spine
        for (let i = 0; i < sm.stormArcs.length; i++) {
          const arc = sm.stormArcs[i]!;
          const flash = Math.sin(elapsed * 20 + i * 2.3) > 0.4;
          arc.visible = flash;
          if (flash) {
            arc.position.set(
              (Math.sin(i * 1.5) - 0.5) * 2.5,
              (Math.cos(i * 2.1) - 0.5) * 1.6,
              -1.5 - i * 1.8,
            );
          }
        }
      }

      // Sinuous serpentine undulation along the 8 muscular body segments
      for (let i = 0; i < sm.bodySegments.length; i++) {
        const seg = sm.bodySegments[i]!;
        const spine = sm.dorsalSpines[i]!;
        const wave = Math.sin(elapsed * 6.0 - i * 0.55);
        const bob = Math.cos(elapsed * 4.5 - i * 0.42);
        const latOffset = wave * (0.32 + i * 0.08);

        seg.position.x = latOffset;
        seg.position.y = bob * 0.16;
        seg.rotation.y = Math.cos(elapsed * 6.0 - i * 0.55) * 0.22;

        if (spine) {
          spine.position.x = latOffset;
          spine.position.y = 1.45 - (i / 8) * 0.85 + bob * 0.16;
          spine.rotation.y = seg.rotation.y;
        }
      }

      // Wingtip wind vortex trails shedding behind
      for (let i = 0; i < sm.wingMotes.length; i++) {
        const mote = sm.wingMotes[i]!;
        mote.visible = true;
        const side = i % 2 === 0 ? -1 : 1;
        const phaseOffset = Math.floor(i / 2) * 1.5;
        mote.position.set(
          side * (7.5 + Math.sin(elapsed * 12 + phaseOffset) * 0.8),
          sm.altitude * 0.1 + Math.cos(elapsed * 10 + phaseOffset) * 0.5,
          -2.5 - ((elapsed * 5 + phaseOffset * 2) % 4.0),
        );
      }

      // Crisp Ground Shadow directly beneath the monster on the terrain (Y = 0.03)
      sm.shadowMesh.visible = true;
      sm.shadowMesh.position.set(sm.currentX, SHADOW_Y, sm.currentZ);

      // Shadow scales and darkens realistically at low altitude
      const shadowScale = Math.max(0.85, Math.min(2.0, sm.altitude / 3.5));
      sm.shadowMesh.scale.set(shadowScale, shadowScale, shadowScale);
      sm.shadowMesh.material.opacity = Math.min(
        0.85,
        Math.max(0.45, 0.55 + (1 - sm.altitude / 10) * 0.3),
      );
    } else if (monsterEvent.phase === 'strike') {
      // Ferocious Strike Dive / Pounce!
      const strikeProgress = monsterEvent.progress ?? 0;

      if (!sm.hasSpawned) {
        sm.hasSpawned = true;
        sm.altitude = 4.2;
        sm.currentX = playerX;
        sm.currentZ = playerZ;
      }

      // Dives right toward ground level (Y = 1.0) and bites!
      const diveAltitude = 1.1 + Math.abs(strikeProgress - 0.5) * 3.5;
      sm.altitude += (diveAltitude - sm.altitude) * (1 - Math.exp(-14 * dt));

      // Lunge forward directly toward player
      VEC_A.set(playerX, 0.2, playerZ);
      sm.dragonGroup.lookAt(VEC_A);

      sm.currentX += (playerX - sm.currentX) * (1 - Math.exp(-10 * dt));
      sm.currentZ += (playerZ - sm.currentZ) * (1 - Math.exp(-10 * dt));
      sm.dragonGroup.position.set(sm.currentX, sm.altitude, sm.currentZ);

      // Jaws snapping violently shut
      sm.lowerJawGroup.rotation.x = Math.abs(Math.sin(elapsed * 24)) * 0.55;

      // Claws pounce downward
      sm.clawLeft.rotation.x = 0.85;
      sm.clawRight.rotation.x = 0.85;

      // Wings swept back in aggressive dive pose
      sm.wingLeft.rotation.set(-0.6, -0.4, -0.7);
      sm.wingRight.rotation.set(-0.6, 0.4, 0.7);

      // Ground shadow tight and intense
      sm.shadowMesh.visible = true;
      sm.shadowMesh.position.set(sm.currentX, SHADOW_Y, sm.currentZ);
      sm.shadowMesh.scale.set(1.1, 1.1, 1.1);
      sm.shadowMesh.material.opacity = 0.9;

      // All storm lightning arcs flare violently
      for (let i = 0; i < sm.stormArcs.length; i++) {
        const arc = sm.stormArcs[i]!;
        arc.visible = true;
        arc.position.set(
          (Math.sin(elapsed * 35 + i * 2) - 0.5) * 3.5,
          (Math.cos(elapsed * 40 + i * 3) - 0.5) * 2.2,
          -1.0 - i * 1.5,
        );
      }
    }
  }

  /**
   * Complete recursive cleanup of all geometries, materials, and textures
   * to guarantee zero memory leaks when restarting or transitioning.
   */
  dispose(): void {
    this.scene.remove(this.root);
    for (const v of this.shelterVisuals) {
      disposeGroup(v.group);
    }
    this.shelterVisuals.length = 0;
    disposeGroup(this.skyMonster.root);
    disposeGroup(this.root);
  }
}

// --- Roaming Monsters 3D Rendering ---

interface RoamingMonsterVisualEntry {
  readonly id: number;
  readonly kind: RoamingMonsterKind;
  readonly group: Group;
  readonly creatureGroup: Group;
  readonly shadowMesh: Mesh<CircleGeometry, MeshBasicMaterial>;
  readonly flipperLeft?: Mesh;
  readonly flipperRight?: Mesh;
  readonly tailMesh?: Group;
  readonly armLeft?: Mesh;
  readonly armRight?: Mesh;
  readonly bioluminescentSpots?: readonly Mesh[];
  currentX: number;
  currentZ: number;
  currentY: number;
  targetX: number;
  targetZ: number;
  heading: number;
  frozenTicks: number;
}

function createSeaBeastMesh(): {
  creatureGroup: Group;
  flipperLeft: Mesh;
  flipperRight: Mesh;
  tailMesh: Group;
  bioluminescentSpots: Mesh[];
} {
  const creatureGroup = new Group();

  const bodyMat = new MeshStandardMaterial({
    color: 0x00838f,
    emissive: 0x004d40,
    emissiveIntensity: 0.28,
    roughness: 0.32,
    metalness: 0.2,
  });

  const bellyMat = new MeshStandardMaterial({
    color: 0xb2ebf2,
    emissive: 0x80deea,
    emissiveIntensity: 0.2,
    roughness: 0.45,
  });

  const eyeWhiteMat = new MeshBasicMaterial({ color: 0xffffff });
  const eyeIrisMat = new MeshStandardMaterial({
    color: 0x00e5ff,
    emissive: 0x00e5ff,
    emissiveIntensity: 0.95,
  });
  const eyePupilMat = new MeshBasicMaterial({ color: 0x0a0a14 });

  const spotMat = new MeshStandardMaterial({
    color: 0x00ffff,
    emissive: 0x00ffff,
    emissiveIntensity: 0.95,
    roughness: 0.1,
  });

  // Plump rounded sea-turtle / drake body
  const bodyGeo = new SphereGeometry(1.2, 16, 12);
  bodyGeo.scale(1.05, 0.72, 1.45);
  const body = new Mesh(bodyGeo, bodyMat);
  body.position.y = 0.35;
  creatureGroup.add(body);

  // Soft belly
  const bellyGeo = new SphereGeometry(1.05, 14, 10);
  bellyGeo.scale(0.95, 0.32, 1.35);
  const belly = new Mesh(bellyGeo, bellyMat);
  belly.position.y = 0.08;
  creatureGroup.add(belly);

  // Cute neck & head
  const head = new Group();
  head.position.set(0, 0.55, 1.4);

  const skullGeo = new SphereGeometry(0.72, 14, 10);
  skullGeo.scale(0.92, 0.82, 1.05);
  const skull = new Mesh(skullGeo, bodyMat);
  head.add(skull);

  // Friendly rounded snout
  const snoutGeo = new RoundedBoxGeometry(0.75, 0.45, 0.7, 2, 0.1);
  const snout = new Mesh(snoutGeo, bodyMat);
  snout.position.set(0, -0.15, 0.65);
  head.add(snout);

  // Big cute eyes
  const eyeGeo = new SphereGeometry(0.22, 10, 8);
  const irisGeo = new SphereGeometry(0.15, 10, 8);
  const pupilGeo = new SphereGeometry(0.09, 8, 8);

  for (const side of [-1, 1]) {
    const eyeWhite = new Mesh(eyeGeo, eyeWhiteMat);
    eyeWhite.position.set(side * 0.46, 0.22, 0.35);

    const iris = new Mesh(irisGeo, eyeIrisMat);
    iris.position.set(side * 0.49, 0.22, 0.45);

    const pupil = new Mesh(pupilGeo, eyePupilMat);
    pupil.position.set(side * 0.51, 0.22, 0.52);

    head.add(eyeWhite, iris, pupil);

    // Cute coral horns on head
    const hornGeo = new ConeGeometry(0.12, 0.5, 6);
    const hornMat = new MeshStandardMaterial({
      color: 0x26c6da,
      emissive: 0x00bcd4,
      emissiveIntensity: 0.5,
    });
    const horn = new Mesh(hornGeo, hornMat);
    horn.position.set(side * 0.32, 0.62, -0.15);
    horn.rotation.x = -0.35;
    horn.rotation.z = -side * 0.25;
    head.add(horn);
  }
  creatureGroup.add(head);

  // Fin wings / flippers (left and right)
  const finGeo = new SphereGeometry(1.0, 10, 6);
  finGeo.scale(1.15, 0.1, 0.48);
  const finMat = new MeshStandardMaterial({
    color: 0x26c6da,
    emissive: 0x00acc1,
    emissiveIntensity: 0.35,
    roughness: 0.35,
    side: DoubleSide,
  });

  const flipperLeft = new Mesh(finGeo, finMat);
  flipperLeft.position.set(-1.15, 0.22, 0.35);
  flipperLeft.rotation.y = 0.25;
  creatureGroup.add(flipperLeft);

  const flipperRight = new Mesh(finGeo, finMat);
  flipperRight.position.set(1.15, 0.22, 0.35);
  flipperRight.rotation.y = -0.25;
  creatureGroup.add(flipperRight);

  // Bioluminescent blue spots along spine & shell
  const bioluminescentSpots: Mesh[] = [];
  const spotGeo = new SphereGeometry(0.12, 8, 8);
  const spotCoords: readonly [number, number, number][] = [
    [0, 0.95, 0.5],
    [0, 1.02, 0],
    [0, 0.95, -0.6],
    [-0.55, 0.72, 0.2],
    [0.55, 0.72, 0.2],
    [-0.55, 0.72, -0.4],
    [0.55, 0.72, -0.4],
  ];
  for (const [sx, sy, sz] of spotCoords) {
    const sp = new Mesh(spotGeo, spotMat);
    sp.position.set(sx, sy, sz);
    creatureGroup.add(sp);
    bioluminescentSpots.push(sp);
  }

  // Wagging tail with caudal fin fan
  const tailMesh = new Group();
  tailMesh.position.set(0, 0.25, -1.35);

  const tailConeGeo = new ConeGeometry(0.38, 1.3, 8);
  tailConeGeo.rotateX(-Math.PI / 2);
  const tailCone = new Mesh(tailConeGeo, bodyMat);
  tailCone.position.z = -0.65;
  tailMesh.add(tailCone);

  const tailFinGeo = new SphereGeometry(0.7, 8, 4);
  tailFinGeo.scale(0.85, 0.08, 0.55);
  const tailFin = new Mesh(tailFinGeo, finMat);
  tailFin.position.z = -1.4;
  tailMesh.add(tailFin);

  creatureGroup.add(tailMesh);

  return { creatureGroup, flipperLeft, flipperRight, tailMesh, bioluminescentSpots };
}

function createForestGolemMesh(): {
  creatureGroup: Group;
  armLeft: Mesh;
  armRight: Mesh;
} {
  const creatureGroup = new Group();

  const stoneMat = new MeshStandardMaterial({
    color: 0x4e5d4e,
    emissive: 0x2e3d2e,
    emissiveIntensity: 0.18,
    roughness: 0.85,
    metalness: 0.08,
  });

  const leafMat = new MeshStandardMaterial({
    color: 0x388e3c,
    emissive: 0x1b5e20,
    emissiveIntensity: 0.28,
    roughness: 0.65,
  });

  const eyeMat = new MeshStandardMaterial({
    color: 0xffb300,
    emissive: 0xff9100,
    emissiveIntensity: 1.0,
    roughness: 0.2,
  });

  // Sturdy mossy stone torso
  const torsoGeo = new RoundedBoxGeometry(1.6, 1.7, 1.3, 2, 0.25);
  const torso = new Mesh(torsoGeo, stoneMat);
  torso.position.y = 0.85;
  creatureGroup.add(torso);

  // Carved blocky stone head
  const headGeo = new RoundedBoxGeometry(1.05, 0.95, 0.95, 2, 0.18);
  const head = new Mesh(headGeo, stoneMat);
  head.position.set(0, 2.05, 0.15);
  creatureGroup.add(head);

  // Gentle glowing amber eyes
  const eyeGeo = new SphereGeometry(0.16, 8, 8);
  for (const side of [-1, 1]) {
    const eye = new Mesh(eyeGeo, eyeMat);
    eye.position.set(side * 0.28, 2.12, 0.68);
    creatureGroup.add(eye);
  }

  // Leafy shoulder cushions and head canopy
  const leafClusterGeo = new SphereGeometry(0.42, 8, 6);
  const leafPositions: readonly [number, number, number][] = [
    [-1.0, 1.75, 0],
    [1.0, 1.75, 0],
    [-0.35, 2.62, 0.1],
    [0.35, 2.62, 0.1],
  ];
  for (const [lx, ly, lz] of leafPositions) {
    const leaf = new Mesh(leafClusterGeo, leafMat);
    leaf.position.set(lx, ly, lz);
    creatureGroup.add(leaf);
  }

  // Blooming flowers on head
  const flowerGeo = new SphereGeometry(0.16, 6, 6);
  const pinkFlowerMat = new MeshStandardMaterial({
    color: 0xff69b4,
    emissive: 0xff4081,
    emissiveIntensity: 0.6,
  });
  const yellowFlowerMat = new MeshStandardMaterial({
    color: 0xffeb3b,
    emissive: 0xffd700,
    emissiveIntensity: 0.6,
  });
  const fl1 = new Mesh(flowerGeo, pinkFlowerMat);
  fl1.position.set(-0.25, 2.82, 0.2);
  const fl2 = new Mesh(flowerGeo, yellowFlowerMat);
  fl2.position.set(0.3, 2.84, 0.15);
  creatureGroup.add(fl1, fl2);

  // Chunky stone arms swinging gently
  const armGeo = new CylinderGeometry(0.32, 0.4, 1.4, 8);
  const armLeft = new Mesh(armGeo, stoneMat);
  armLeft.position.set(-1.18, 0.85, 0);
  creatureGroup.add(armLeft);

  const armRight = new Mesh(armGeo, stoneMat);
  armRight.position.set(1.18, 0.85, 0);
  creatureGroup.add(armRight);

  // Chunky stone feet
  const footGeo = new RoundedBoxGeometry(0.5, 0.35, 0.72, 2, 0.1);
  for (const side of [-1, 1]) {
    const foot = new Mesh(footGeo, stoneMat);
    foot.position.set(side * 0.52, -0.05, 0.1);
    creatureGroup.add(foot);
  }

  return { creatureGroup, armLeft, armRight };
}

function createCandyTrollMesh(): {
  creatureGroup: Group;
  armLeft: Mesh;
  armRight: Mesh;
} {
  const creatureGroup = new Group();

  const gummyMat = new MeshStandardMaterial({
    color: 0xff69b4,
    emissive: 0xff80ab,
    emissiveIntensity: 0.48,
    roughness: 0.15,
    metalness: 0.08,
    transparent: true,
    opacity: 0.92,
  });

  const hornMat = new MeshStandardMaterial({
    color: 0xffeb3b,
    emissive: 0xffd700,
    emissiveIntensity: 0.75,
    roughness: 0.2,
    metalness: 0.25,
  });

  const eyeWhiteMat = new MeshBasicMaterial({ color: 0xffffff });
  const eyePupilMat = new MeshBasicMaterial({ color: 0x1a0a22 });
  const cheekMat = new MeshStandardMaterial({
    color: 0xff4081,
    emissive: 0xff4081,
    emissiveIntensity: 0.65,
    roughness: 0.3,
  });

  // Plump bouncy round gummy marshmallow body
  const bodyGeo = new SphereGeometry(1.25, 16, 14);
  bodyGeo.scale(1.15, 1.05, 1.1);
  const body = new Mesh(bodyGeo, gummyMat);
  body.position.y = 0.95;
  creatureGroup.add(body);

  // Swirled unicorn candy horn on forehead
  const hornGeo = new ConeGeometry(0.28, 1.25, 12);
  hornGeo.rotateX(0.35);
  const horn = new Mesh(hornGeo, hornMat);
  horn.position.set(0, 2.15, 0.65);
  creatureGroup.add(horn);

  // Big friendly eyes
  const eyeWhiteGeo = new SphereGeometry(0.24, 10, 8);
  const eyePupilGeo = new SphereGeometry(0.12, 8, 8);
  const cheekGeo = new SphereGeometry(0.18, 8, 6);

  for (const side of [-1, 1]) {
    const ew = new Mesh(eyeWhiteGeo, eyeWhiteMat);
    ew.position.set(side * 0.42, 1.15, 1.08);

    const ep = new Mesh(eyePupilGeo, eyePupilMat);
    ep.position.set(side * 0.45, 1.15, 1.25);

    const cheek = new Mesh(cheekGeo, cheekMat);
    cheek.position.set(side * 0.65, 0.82, 0.95);

    // Cute marshmallow ear tufts
    const earGeo = new SphereGeometry(0.32, 10, 8);
    const ear = new Mesh(earGeo, gummyMat);
    ear.position.set(side * 0.75, 1.95, 0);

    creatureGroup.add(ew, ep, cheek, ear);
  }

  // Chubby gummy arms
  const armGeo = new SphereGeometry(0.35, 10, 8);
  armGeo.scale(0.65, 1.15, 0.65);

  const armLeft = new Mesh(armGeo, gummyMat);
  armLeft.position.set(-1.25, 0.85, 0);
  creatureGroup.add(armLeft);

  const armRight = new Mesh(armGeo, gummyMat);
  armRight.position.set(1.25, 0.85, 0);
  creatureGroup.add(armRight);

  // Chubby gummy feet
  const footGeo = new SphereGeometry(0.38, 10, 8);
  footGeo.scale(0.85, 0.48, 1.12);
  for (const side of [-1, 1]) {
    const foot = new Mesh(footGeo, gummyMat);
    foot.position.set(side * 0.58, -0.05, 0.15);
    creatureGroup.add(foot);
  }

  return { creatureGroup, armLeft, armRight };
}

/**
 * 3D Rendering Controller for Roaming Monsters:
 * - Renders 4–6 slow-moving roaming creatures across the arena:
 *   * 'sea_beast': Cute aquatic serpent / sea turtle drake with fin wings and bioluminescent blue spots.
 *   * 'forest_golem': Mossy stone/flower golem with leafy shoulders and gentle glowing amber eyes.
 *   * 'candy_troll': Round gummy marshmallow monster with candy horn.
 * - Low-altitude slow lumbering animation (Y: 0.8 .. 1.4), slow bobbing walk, small soft ground shadow.
 * - Syncs with state.roamingMonsters and animates smoothly at 60fps.
 */
export class RoamingMonstersView {
  private readonly root = new Group();
  private readonly entries = new Map<number, RoamingMonsterVisualEntry>();

  constructor(private readonly scene: Scene) {
    this.scene.add(this.root);
  }

  sync(state: GameState): void {
    const monsters: readonly RoamingMonster[] = state.roamingMonsters ?? [];
    const activeIds = new Set<number>();

    for (const m of monsters) {
      activeIds.add(m.id);
      let entry = this.entries.get(m.id);
      if (!entry) {
        entry = this.createEntry(m);
        this.entries.set(m.id, entry);
        this.root.add(entry.group);
      }
      entry.targetX = m.x;
      entry.targetZ = m.z;
      entry.heading = m.heading;
      entry.frozenTicks = m.frozenTicks ?? 0;
    }

    for (const [id, entry] of this.entries.entries()) {
      if (!activeIds.has(id)) {
        this.root.remove(entry.group);
        disposeGroup(entry.group);
        this.entries.delete(id);
      }
    }
  }

  private createEntry(m: RoamingMonster): RoamingMonsterVisualEntry {
    const group = new Group();
    const shadowGeo = new CircleGeometry(1.35, 20);
    const shadowMat = new MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.35,
      side: DoubleSide,
      depthWrite: false,
    });
    const shadowMesh = new Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = SHADOW_Y;
    group.add(shadowMesh);

    let creatureGroup: Group;
    let flipperLeft: Mesh | undefined;
    let flipperRight: Mesh | undefined;
    let tailMesh: Group | undefined;
    let armLeft: Mesh | undefined;
    let armRight: Mesh | undefined;
    let bioluminescentSpots: Mesh[] | undefined;

    switch (m.kind) {
      case 'sea_beast': {
        const res = createSeaBeastMesh();
        creatureGroup = res.creatureGroup;
        flipperLeft = res.flipperLeft;
        flipperRight = res.flipperRight;
        tailMesh = res.tailMesh;
        bioluminescentSpots = res.bioluminescentSpots;
        break;
      }
      case 'forest_golem': {
        const res = createForestGolemMesh();
        creatureGroup = res.creatureGroup;
        armLeft = res.armLeft;
        armRight = res.armRight;
        break;
      }
      case 'candy_troll': {
        const res = createCandyTrollMesh();
        creatureGroup = res.creatureGroup;
        armLeft = res.armLeft;
        armRight = res.armRight;
        break;
      }
    }

    group.add(creatureGroup);

    return {
      id: m.id,
      kind: m.kind,
      group,
      creatureGroup,
      shadowMesh,
      flipperLeft,
      flipperRight,
      tailMesh,
      armLeft,
      armRight,
      bioluminescentSpots,
      currentX: m.x,
      currentZ: m.z,
      currentY: 1.0,
      targetX: m.x,
      targetZ: m.z,
      heading: m.heading,
      frozenTicks: m.frozenTicks ?? 0,
    };
  }

  draw(elapsed: number, delta: number, _state: GameState): void {
    const dt = Math.min(Math.max(delta, 0), 0.1);

    for (const entry of this.entries.values()) {
      // Smooth position interpolation
      entry.currentX += (entry.targetX - entry.currentX) * (1 - Math.exp(-10 * dt));
      entry.currentZ += (entry.targetZ - entry.currentZ) * (1 - Math.exp(-10 * dt));

      const isFrozen = entry.frozenTicks > 0;
      const bobRate = isFrozen ? 0 : 3.2;
      const bob = Math.abs(Math.sin(elapsed * bobRate + entry.id * 1.5)) * 0.35;
      entry.currentY = 0.85 + bob;

      // Position creature group (Y: 0.85 .. 1.2, within 0.8 .. 1.4)
      entry.creatureGroup.position.set(entry.currentX, entry.currentY, entry.currentZ);

      // Facing direction
      entry.creatureGroup.rotation.y = entry.heading;

      // Bobbing waddle tilt
      entry.creatureGroup.rotation.z = isFrozen
        ? Math.sin(elapsed * 30) * 0.03
        : Math.sin(elapsed * 3.2 + entry.id) * 0.08;

      // Small soft ground shadow beneath monster on terrain
      entry.shadowMesh.position.set(entry.currentX, SHADOW_Y, entry.currentZ);
      const shadowScale = 1.0 - (entry.currentY - 0.85) * 0.3;
      entry.shadowMesh.scale.set(shadowScale, shadowScale, shadowScale);
      entry.shadowMesh.material.opacity = 0.38 - (entry.currentY - 0.85) * 0.12;

      // Creature specific animations
      if (entry.kind === 'sea_beast') {
        if (entry.flipperLeft && entry.flipperRight) {
          const flap = Math.sin(elapsed * 4.2 + entry.id) * 0.32;
          entry.flipperLeft.rotation.z = flap;
          entry.flipperRight.rotation.z = -flap;
        }
        if (entry.tailMesh) {
          entry.tailMesh.rotation.y = Math.sin(elapsed * 4.2 + entry.id) * 0.28;
        }
        if (entry.bioluminescentSpots) {
          const pulse = 0.8 + Math.sin(elapsed * 5.0 + entry.id) * 0.2;
          for (const sp of entry.bioluminescentSpots) {
            (sp.material as MeshStandardMaterial).emissiveIntensity = pulse;
          }
        }
      } else if (entry.kind === 'forest_golem') {
        if (entry.armLeft && entry.armRight) {
          const armSwing = Math.sin(elapsed * 2.6 + entry.id) * 0.36;
          entry.armLeft.rotation.x = armSwing;
          entry.armRight.rotation.x = -armSwing;
        }
      } else if (entry.kind === 'candy_troll') {
        const squish = 1.0 + Math.sin(elapsed * 6.5 + entry.id) * 0.08;
        entry.creatureGroup.scale.set(1.0 / Math.sqrt(squish), squish, 1.0 / Math.sqrt(squish));
        if (entry.armLeft && entry.armRight) {
          entry.armLeft.rotation.z = 0.25 + Math.sin(elapsed * 5.0 + entry.id) * 0.18;
          entry.armRight.rotation.z = -0.25 - Math.sin(elapsed * 5.0 + entry.id) * 0.18;
        }
      }
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const entry of this.entries.values()) {
      disposeGroup(entry.group);
    }
    this.entries.clear();
    disposeGroup(this.root);
  }
}

// --- Utilities ---

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
