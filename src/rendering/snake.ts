import {
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  Shape,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FORM_METADATA } from '../core/config';
import { angleDiff, clamp } from '../core/systems/arena';
import type { GamePhase, GameState, SnakeForm, Vec2 } from '../core/types';
import type { BadgeTextureCache, CrownResources } from './labels3d';
import { cellToWorld } from './world';

interface BodySegment {
  readonly mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  readonly from: Vector3;
  readonly to: Vector3;
}

/** Snap (don't interpolate) when a segment jumps further than 4.0 units (wrap/push/reset). */
const TELEPORT_THRESHOLD_SQ = 4.0 * 4.0;

function computeThicknessScale(level: number): number {
  return clamp(0.85 + Math.log2(Math.max(1, level) + 4) * 0.14, 0.95, 1.85);
}

function headingToYaw(heading: number): number {
  return Math.atan2(Math.cos(heading), Math.sin(heading));
}

function normalizeAngleDiff(target: number, current: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function createBeveledStarBodyGeometry(): ExtrudeGeometry {
  const s = new Shape();
  const points = 5;
  const outerR = 0.4;
  const innerR = 0.25;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();

  const geo = new ExtrudeGeometry(s, {
    depth: 0.28,
    bevelEnabled: true,
    bevelThickness: 0.09,
    bevelSize: 0.06,
    bevelSegments: 2,
  });
  geo.center();
  geo.rotateX(Math.PI * 0.28);
  return geo;
}

function createWingGeometry(span: number, sweep: number): ExtrudeGeometry {
  const s = new Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(span * 0.55, sweep * 0.75, span, sweep * 0.22);
  s.quadraticCurveTo(span * 0.65, -sweep * 0.22, span * 0.25, -sweep * 0.35);
  s.closePath();

  return new ExtrudeGeometry(s, {
    depth: 0.035,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 1,
  });
}

const CHOMP_ANIM_DURATION = 0.18;
const MORPH_PULSE_DURATION = 0.85;

interface BreathColors {
  readonly coreHex: number;
  readonly outerHex: number;
  readonly ringAHex: number;
  readonly ringBHex: number;
}

const FORM_BREATH_COLORS: Record<SnakeForm, BreathColors> = {
  dragon: {
    coreHex: 0xffe45c, // gold
    outerHex: 0xff2e7e, // crimson-magenta
    ringAHex: 0xffc83d,
    ringBHex: 0xff3d8e,
  },
  phoenix: {
    coreHex: 0xf4feff, // frosty white
    outerHex: 0x26e8ff, // cyan
    ringAHex: 0xffffff,
    ringBHex: 0x48f2ff,
  },
  unicorn: {
    coreHex: 0x8efaff, // aqua
    outerHex: 0x22b4ff, // sky-blue
    ringAHex: 0xa6fcff,
    ringBHex: 0x38b8ff,
  },
  spirit: {
    coreHex: 0xf4fff9, // pearl-white
    outerHex: 0x4dff9a, // mint
    ringAHex: 0x62ffb0,
    ringBHex: 0xf0fff6,
  },
};

/**
 * Renders the player's 4-form Magical Snake in Snake Clash 3D style:
 * plump level-scaled tapered spine, 360° smooth steering, blinking 3D eyes,
 * cute chomping lower jaw & fangs, form accessories, shield bubble, rotating
 * magnet halo, speed booster glow, floating #1 golden crown, and crisp cached
 * 3D nameplate.
 */
export class SnakeView {
  private readonly formGeometries: Record<SnakeForm, BufferGeometry>;
  private readonly headGeometry = new RoundedBoxGeometry(0.78, 0.7, 0.8, 4, 0.26);
  private readonly jawGeometry = new RoundedBoxGeometry(0.56, 0.16, 0.44, 3, 0.075);
  private readonly mouthCavityGeo = new RoundedBoxGeometry(0.4, 0.06, 0.3, 2, 0.03);
  private readonly fangGeo = new ConeGeometry(0.042, 0.125, 8);
  private readonly chompAuraGeo = new TorusGeometry(0.74, 0.048, 8, 28);
  private readonly eyeWhiteGeo = new SphereGeometry(0.145, 14, 12);
  private readonly pupilGeo = new SphereGeometry(0.085, 12, 10);
  private readonly catchlightGeo = new SphereGeometry(0.034, 8, 8);
  private readonly cheekGeo = new SphereGeometry(0.08, 10, 8);

  private readonly hornConeGeo = new ConeGeometry(0.1, 0.46, 6);
  private readonly dragonWingGeo = createWingGeometry(0.62, 0.46);
  private readonly phoenixCrestGeo = new ConeGeometry(0.085, 0.5, 5);
  private readonly phoenixWingGeo = createWingGeometry(0.76, 0.54);
  private readonly unicornHornGeo = new ConeGeometry(0.09, 0.58, 12);
  private readonly unicornSpiralGeo = new TorusGeometry(0.072, 0.019, 6, 14);
  private readonly haloGeo = new TorusGeometry(0.34, 0.034, 8, 24);
  private readonly leafGeo = new SphereGeometry(0.145, 10, 8);
  private readonly petalGeo = new SphereGeometry(0.11, 10, 8);
  private readonly flowerCenterGeo = new SphereGeometry(0.09, 10, 8);

  private readonly shieldBubbleGeo = new SphereGeometry(0.98, 24, 18);
  private readonly shieldWireGeo = new IcosahedronGeometry(1.02, 1);
  private readonly magnetRingGeo = new TorusGeometry(1.12, 0.038, 8, 28);
  private readonly morphAuraGeo = new TorusGeometry(0.92, 0.052, 8, 28);
  private readonly morphStarGeo = new OctahedronGeometry(0.11, 0);

  private readonly breathInnerConeGeo = new ConeGeometry(0.22, 1.32, 14, 1, true);
  private readonly breathOuterConeGeo = new ConeGeometry(0.46, 1.92, 16, 1, true);
  private readonly breathVortexRingGeo = new TorusGeometry(0.32, 0.044, 8, 22);

  private readonly bodyMaterial: MeshStandardMaterial;
  private readonly headMaterial: MeshStandardMaterial;
  private readonly eyeWhiteMat = new MeshBasicMaterial({ color: 0xfffaff });
  private readonly pupilMat = new MeshBasicMaterial({ color: 0x160a2e });
  private readonly catchlightMat = new MeshBasicMaterial({ color: 0xffffff });
  private readonly cheekMat = new MeshStandardMaterial({
    color: 0xff80c2,
    emissive: 0xff4fa8,
    emissiveIntensity: 0.35,
    roughness: 0.45,
  });
  private readonly mouthCavityMat = new MeshStandardMaterial({
    color: 0xff6b8b,
    emissive: 0xff3d6e,
    emissiveIntensity: 0.45,
    roughness: 0.35,
  });
  private readonly fangMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffeef8,
    emissiveIntensity: 0.28,
    roughness: 0.18,
  });
  private readonly chompAuraMat = new MeshBasicMaterial({
    color: 0xffe45e,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
  private readonly morphAuraMat = new MeshBasicMaterial({
    color: 0xff70d0,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  private readonly morphStarMat = new MeshBasicMaterial({
    color: 0xfff5b8,
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
  });

  private readonly dragonMat = new MeshStandardMaterial({
    color: 0xff8cd6,
    emissive: 0xff49b8,
    emissiveIntensity: 0.55,
    metalness: 0.2,
    roughness: 0.22,
  });
  private readonly phoenixMat = new MeshStandardMaterial({
    color: 0x7ef8ff,
    emissive: 0x26e6ff,
    emissiveIntensity: 0.6,
    metalness: 0.25,
    roughness: 0.18,
  });
  private readonly unicornGoldMat = new MeshStandardMaterial({
    color: 0xffe066,
    emissive: 0xffb82e,
    emissiveIntensity: 0.65,
    metalness: 0.45,
    roughness: 0.16,
  });
  private readonly spiritLeafMat = new MeshStandardMaterial({
    color: 0x5effa8,
    emissive: 0x2de080,
    emissiveIntensity: 0.5,
    metalness: 0.15,
    roughness: 0.28,
  });
  private readonly flowerPetalMat = new MeshStandardMaterial({
    color: 0xffb3e6,
    emissive: 0xff70cc,
    emissiveIntensity: 0.45,
    roughness: 0.3,
  });

  private readonly shieldMaterial = new MeshPhysicalMaterial({
    color: 0xaaf5ff,
    emissive: 0x8ae8ff,
    emissiveIntensity: 0.45,
    transparent: true,
    opacity: 0.36,
    roughness: 0.1,
    metalness: 0.05,
    depthWrite: false,
  });
  private readonly shieldWireMat = new MeshBasicMaterial({
    color: 0xffb8f0,
    wireframe: true,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  });
  private readonly magnetOuterMat = new MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  private readonly magnetInnerMat = new MeshBasicMaterial({
    color: 0xa855f7,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
  });

  // ── Muzzle Elemental Breath Rig Materials ──
  private readonly breathInnerMat = new MeshBasicMaterial({
    color: FORM_BREATH_COLORS.dragon.coreHex,
    transparent: true,
    opacity: 0.9,
    side: DoubleSide,
    depthWrite: false,
  });
  private readonly breathOuterMat = new MeshStandardMaterial({
    color: FORM_BREATH_COLORS.dragon.outerHex,
    emissive: FORM_BREATH_COLORS.dragon.outerHex,
    emissiveIntensity: 1.05,
    transparent: true,
    opacity: 0.56,
    side: DoubleSide,
    roughness: 0.2,
    depthWrite: false,
  });
  private readonly breathRingAMat = new MeshBasicMaterial({
    color: FORM_BREATH_COLORS.dragon.ringAHex,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  private readonly breathRingBMat = new MeshBasicMaterial({
    color: FORM_BREATH_COLORS.dragon.ringBHex,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });

  // ── Fairy Butterfly Metamorphosis Geometries ──
  private readonly catAntennaStemGeo = new CylinderGeometry(0.018, 0.014, 0.38, 6);
  private readonly catPomPomGeo = new SphereGeometry(0.065, 10, 8);

  private readonly cocoonShellGeo = new SphereGeometry(0.5, 16, 14);
  private readonly cocoonRingGeo = new TorusGeometry(0.52, 0.024, 8, 22);

  private readonly bflyForewingGeo = createWingGeometry(1.62, 1.18);
  private readonly bflyHindwingGeo = createWingGeometry(1.06, 0.88);
  private readonly bflySpotGeo = new SphereGeometry(0.085, 10, 8);
  private readonly bflyDiamondGeo = new OctahedronGeometry(0.082, 0);
  private readonly bflyTiaraBandGeo = new TorusGeometry(0.24, 0.018, 6, 18, Math.PI);
  private readonly bflyTiaraGemGeo = new ConeGeometry(0.042, 0.14, 5);
  private readonly bflyAntennaStemGeo = new CylinderGeometry(0.013, 0.009, 0.46, 6);
  private readonly bflyStarTipGeo = new OctahedronGeometry(0.06, 0);

  // ── Princess Tiara Geometries & Materials ──
  private readonly tiaraBandGeo = new TorusGeometry(0.24, 0.022, 6, 18, Math.PI);
  private readonly tiaraCenterGemGeo = new OctahedronGeometry(0.068, 0);
  private readonly tiaraSideGemGeo = new ConeGeometry(0.036, 0.11, 5);
  private readonly tiaraGoldMat = new MeshStandardMaterial({
    color: 0xffe45c,
    emissive: 0xffb82e,
    emissiveIntensity: 0.72,
    metalness: 0.65,
    roughness: 0.16,
  });
  private readonly tiaraPinkGemMat = new MeshStandardMaterial({
    color: 0xff80d0,
    emissive: 0xff49b8,
    emissiveIntensity: 0.88,
    roughness: 0.14,
    metalness: 0.3,
  });
  private readonly tiaraDiamondMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x9efaff,
    emissiveIntensity: 0.88,
    roughness: 0.1,
    metalness: 0.4,
  });

  // ── Fairy Butterfly Metamorphosis Materials ──
  private readonly catPomPinkMat = new MeshStandardMaterial({
    color: 0xff9de6,
    emissive: 0xff9de6,
    emissiveIntensity: 0.7,
    roughness: 0.3,
  });
  private readonly catPomCyanMat = new MeshStandardMaterial({
    color: 0x5cf6ff,
    emissive: 0x5cf6ff,
    emissiveIntensity: 0.7,
    roughness: 0.3,
  });
  private readonly catStemMat = new MeshStandardMaterial({
    color: 0xffcce8,
    emissive: 0xff80c2,
    emissiveIntensity: 0.35,
    roughness: 0.35,
  });

  private readonly cocoonShellMat = new MeshStandardMaterial({
    color: 0xffd4f0,
    emissive: 0xff9de6,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.62,
    roughness: 0.15,
    metalness: 0.25,
  });
  private readonly cocoonRingMat = new MeshStandardMaterial({
    color: 0xffe066,
    emissive: 0xffb82e,
    emissiveIntensity: 0.65,
    metalness: 0.45,
    roughness: 0.16,
  });

  private readonly bflyWingMat = new MeshStandardMaterial({
    color: 0xffb8eb,
    emissive: 0xff5ec4,
    emissiveIntensity: 0.76,
    transparent: true,
    opacity: 0.9,
    side: DoubleSide,
    roughness: 0.16,
    metalness: 0.2,
  });
  private readonly bflyWingInnerMat = new MeshStandardMaterial({
    color: 0xffe6f7,
    emissive: 0xff8fd8,
    emissiveIntensity: 0.82,
    transparent: true,
    opacity: 0.74,
    side: DoubleSide,
    roughness: 0.12,
    metalness: 0.28,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  private readonly bflyWingRimMat = new MeshStandardMaterial({
    color: 0xff5ec4,
    emissive: 0xff5ec4,
    emissiveIntensity: 0.85,
    transparent: true,
    opacity: 0.86,
    side: DoubleSide,
    roughness: 0.18,
    depthWrite: false,
  });
  private readonly bflySpotMagentaMat = new MeshBasicMaterial({
    color: 0xff5ec4,
    transparent: true,
    opacity: 0.92,
  });
  private readonly bflySpotCyanMat = new MeshStandardMaterial({
    color: 0xbefcff,
    emissive: 0x7ef8ff,
    emissiveIntensity: 0.92,
    transparent: true,
    opacity: 0.92,
    roughness: 0.12,
    metalness: 0.3,
  });
  private readonly bflySpotGoldMat = new MeshStandardMaterial({
    color: 0xffe6f7,
    emissive: 0xffb8eb,
    emissiveIntensity: 0.88,
    transparent: true,
    opacity: 0.92,
    roughness: 0.14,
    metalness: 0.25,
  });
  private readonly bflyTiaraMat = new MeshStandardMaterial({
    color: 0xffe6f7,
    emissive: 0xff8fd8,
    emissiveIntensity: 0.82,
    metalness: 0.4,
    roughness: 0.15,
  });
  private readonly bflyAntennaStarMat = new MeshStandardMaterial({
    color: 0xfff5fb,
    emissive: 0xff8fd8,
    emissiveIntensity: 0.95,
    roughness: 0.15,
    metalness: 0.25,
  });

  private readonly headGroup = new Group();
  private readonly headMesh: Mesh<RoundedBoxGeometry, MeshStandardMaterial>;
  private readonly jawGroup = new Group();
  private readonly leftEyePivot = new Group();
  private readonly rightEyePivot = new Group();
  private readonly leftPupilGroup = new Group();
  private readonly rightPupilGroup = new Group();
  private readonly catchlightMeshes: { readonly mesh: Mesh; readonly baseScale: number }[] = [];

  private readonly chompAuraGroup = new Group();
  private readonly chompAuraRingA: Mesh<TorusGeometry, MeshBasicMaterial>;
  private readonly chompAuraRingB: Mesh<TorusGeometry, MeshBasicMaterial>;

  private readonly morphAuraGroup = new Group();
  private readonly morphAuraRingA: Mesh<TorusGeometry, MeshBasicMaterial>;
  private readonly morphAuraRingB: Mesh<TorusGeometry, MeshBasicMaterial>;
  private readonly morphOrbiters: Mesh<OctahedronGeometry, MeshBasicMaterial>[] = [];

  private readonly dragonRig = new Group();
  private readonly dragonLeftWing = new Group();
  private readonly dragonRightWing = new Group();

  private readonly phoenixRig = new Group();
  private readonly phoenixLeftWing = new Group();
  private readonly phoenixRightWing = new Group();

  private readonly unicornRig = new Group();
  private readonly unicornHalo: Mesh<TorusGeometry, MeshStandardMaterial>;

  private readonly spiritRig = new Group();
  private readonly spiritFlower = new Group();

  private readonly shieldGroup = new Group();
  private readonly shieldBubble: Mesh<SphereGeometry, MeshPhysicalMaterial>;
  private readonly shieldWire: Mesh<IcosahedronGeometry, MeshBasicMaterial>;

  private readonly magnetGroup = new Group();
  private readonly magnetRingA: Mesh<TorusGeometry, MeshBasicMaterial>;
  private readonly magnetRingB: Mesh<TorusGeometry, MeshBasicMaterial>;

  private readonly breathGroup = new Group();
  private breathInnerCone!: Mesh<ConeGeometry, MeshBasicMaterial>;
  private breathOuterCone!: Mesh<ConeGeometry, MeshStandardMaterial>;
  private breathRingA!: Mesh<TorusGeometry, MeshBasicMaterial>;
  private breathRingB!: Mesh<TorusGeometry, MeshBasicMaterial>;

  // ── Fairy Butterfly Metamorphosis Rig Groups ──
  private readonly caterpillarRig = new Group();
  private catPomL!: Mesh<SphereGeometry, MeshStandardMaterial>;
  private catPomR!: Mesh<SphereGeometry, MeshStandardMaterial>;

  private readonly cocoonRig = new Group();
  private cocoonRingA!: Mesh<TorusGeometry, MeshStandardMaterial>;
  private cocoonRingB!: Mesh<TorusGeometry, MeshStandardMaterial>;

  private readonly butterflyRig = new Group();
  private readonly bflyLeftWingPivot = new Group();
  private readonly bflyRightWingPivot = new Group();
  private bflyAntennaStarL!: Mesh;
  private bflyAntennaStarR!: Mesh;
  private bflyTiaraCenterGem!: Mesh;

  private readonly princessTiaraGroup = new Group();
  private princessTiaraGem!: Mesh;

  private readonly bflyRoseColor = new Color(0xff5ec4);
  private readonly bflySakuraColor = new Color(0xff8fd8);
  private readonly bflyPearlColor = new Color(0xffb8eb);
  private readonly bflyBodyPinkColor = new Color(0xff8ed4);
  private readonly bflyHeadPearlColor = new Color(0xffe6f7);
  private readonly bflyHeadGlowColor = new Color(0xff6ec7);
  private readonly scratchColorA = new Color();
  private readonly scratchColorB = new Color();
  private butterflyBodyTint = 0;

  private readonly crownGroup: Group;
  private readonly nameSpriteMaterial: SpriteMaterial;
  private readonly nameSprite: Sprite;
  private lastLabelKey = '';

  private readonly headFrom = new Vector3();
  private readonly headTo = new Vector3();
  private readonly headWorldPos = new Vector3();
  private readonly scratchForward = new Vector3();
  private readonly scratchPerp = new Vector3();

  private segments: BodySegment[] = [];
  private activeForm: SnakeForm = 'dragon';
  private headHeadingY = Math.PI / 2;
  private currentThickness = 1.29;
  private hasSyncedOnce = false;
  private lastSnakeRef: readonly Vec2[] | null = null;
  private lastPrevSnakeRef: readonly Vec2[] | null = null;
  private lastPhase: GamePhase | null = null;
  private lastLevel = -1;

  private chompAnimTimer = 0;
  private chompAuraTimer = 0;
  private chompDisplayStreak = 0;
  private morphPulseTimer = 0;
  private anticipateOpen = 0;
  private sprayVisualIntensity = 0;
  private visualAltitude = 0;

  private readonly groundShadowGroup = new Group();
  private readonly groundShadowRingGeo = new RingGeometry(0.45, 0.95, 24);
  private readonly groundShadowInnerGeo = new CircleGeometry(0.45, 24);
  private readonly groundShadowRingMat = new MeshBasicMaterial({
    color: 0x5cf6ff,
    transparent: true,
    opacity: 0.55,
    side: DoubleSide,
    depthWrite: false,
  });
  private readonly groundShadowInnerMat = new MeshBasicMaterial({
    color: 0xff6be6,
    transparent: true,
    opacity: 0.35,
    side: DoubleSide,
    depthWrite: false,
  });

  constructor(
    private readonly scene: Scene,
    private readonly half: number,
    private readonly badgeCache: BadgeTextureCache,
    crownResources: CrownResources,
  ) {
    this.formGeometries = {
      dragon: new SphereGeometry(0.37, 16, 14),
      phoenix: new OctahedronGeometry(0.38, 1),
      unicorn: createBeveledStarBodyGeometry(),
      spirit: new RoundedBoxGeometry(0.62, 0.58, 0.62, 3, 0.16),
    };

    const dragonColor = FORM_METADATA.dragon.hexColor;
    this.bodyMaterial = new MeshStandardMaterial({
      color: dragonColor,
      emissive: dragonColor,
      emissiveIntensity: 0.42,
      metalness: 0.24,
      roughness: 0.24,
      transparent: true,
      opacity: 1,
    });
    this.headMaterial = new MeshStandardMaterial({
      color: 0xffe4f5,
      emissive: dragonColor,
      emissiveIntensity: 0.48,
      metalness: 0.2,
      roughness: 0.2,
      transparent: true,
      opacity: 1,
    });

    this.headMesh = new Mesh(this.headGeometry, this.headMaterial);
    this.headGroup.add(this.headMesh);

    this.buildJawFeatures();
    this.buildBreathRig();
    this.buildFaceFeatures();
    this.buildDragonAccessories();
    this.buildPhoenixAccessories();
    this.unicornHalo = this.buildUnicornAccessories();
    this.buildSpiritAccessories();
    this.buildCaterpillarRig();
    this.buildCocoonRig();
    this.buildButterflyRig();
    this.buildPrincessTiara();

    this.shieldBubble = new Mesh(this.shieldBubbleGeo, this.shieldMaterial);
    this.shieldWire = new Mesh(this.shieldWireGeo, this.shieldWireMat);
    this.shieldGroup.add(this.shieldBubble, this.shieldWire);
    this.shieldGroup.visible = false;
    this.headGroup.add(this.shieldGroup);

    this.magnetRingA = new Mesh(this.magnetRingGeo, this.magnetOuterMat);
    this.magnetRingA.rotation.x = Math.PI * 0.36;
    this.magnetRingB = new Mesh(this.magnetRingGeo, this.magnetInnerMat);
    this.magnetRingB.rotation.x = -Math.PI * 0.36;
    this.magnetRingB.scale.setScalar(0.86);
    this.magnetGroup.add(this.magnetRingA, this.magnetRingB);
    this.magnetGroup.visible = false;
    this.headGroup.add(this.magnetGroup);

    this.chompAuraRingA = new Mesh(this.chompAuraGeo, this.chompAuraMat);
    this.chompAuraRingA.rotation.x = Math.PI / 2;
    this.chompAuraRingB = new Mesh(this.chompAuraGeo, this.chompAuraMat);
    this.chompAuraRingB.rotation.x = Math.PI / 2;
    this.chompAuraRingB.rotation.y = 0.32;
    this.chompAuraRingB.scale.setScalar(0.84);
    this.chompAuraGroup.add(this.chompAuraRingA, this.chompAuraRingB);
    this.chompAuraGroup.visible = false;
    this.headGroup.add(this.chompAuraGroup);

    this.morphAuraRingA = new Mesh(this.morphAuraGeo, this.morphAuraMat);
    this.morphAuraRingA.rotation.x = Math.PI * 0.38;
    this.morphAuraRingB = new Mesh(this.morphAuraGeo, this.morphStarMat);
    this.morphAuraRingB.rotation.x = -Math.PI * 0.38;
    this.morphAuraRingB.scale.setScalar(0.84);
    this.morphAuraGroup.add(this.morphAuraRingA, this.morphAuraRingB);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const orb = new Mesh(this.morphStarGeo, i % 2 === 0 ? this.morphAuraMat : this.morphStarMat);
      orb.position.set(Math.cos(a) * 0.96, 0.08 * (i % 2 === 0 ? 1 : -1), Math.sin(a) * 0.96);
      this.morphOrbiters.push(orb);
      this.morphAuraGroup.add(orb);
    }
    this.morphAuraGroup.visible = false;
    this.headGroup.add(this.morphAuraGroup);

    this.scene.add(this.headGroup);

    this.crownGroup = crownResources.createCrownGroup();
    this.crownGroup.visible = false;
    this.scene.add(this.crownGroup);

    this.nameSpriteMaterial = new SpriteMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.nameSprite = new Sprite(this.nameSpriteMaterial);
    this.nameSprite.renderOrder = 10;
    this.nameSprite.scale.set(3.2, 0.76, 1);
    this.scene.add(this.nameSprite);

    const shadowRing = new Mesh(this.groundShadowRingGeo, this.groundShadowRingMat);
    shadowRing.rotation.x = -Math.PI / 2;
    const shadowInner = new Mesh(this.groundShadowInnerGeo, this.groundShadowInnerMat);
    shadowInner.rotation.x = -Math.PI / 2;
    shadowInner.position.y = 0.005;
    this.groundShadowGroup.add(shadowRing, shadowInner);
    this.groundShadowGroup.visible = false;
    this.groundShadowGroup.renderOrder = 2;
    this.scene.add(this.groundShadowGroup);

    this.applyFormVisuals('dragon');
  }

  /** Expose the head's current interpolated world position. */
  getHeadWorldPosition(target = new Vector3()): Vector3 {
    return target.copy(this.headWorldPos);
  }

  /** Number of rendered body segments behind the head. */
  getSegmentCount(): number {
    return this.segments.length;
  }

  /** Copy the interpolated 3D world position of body segment `index` into `target`. */
  getSegmentWorldPosition(index: number, target = new Vector3()): boolean {
    const seg = this.segments[index];
    if (!seg) return false;
    target.copy(seg.mesh.position);
    return true;
  }

  /** Trigger the vibrant 0.85s morph aura rings & head glow pulse. */
  triggerMorphPulse(): void {
    this.morphPulseTimer = MORPH_PULSE_DURATION;
  }

  /** Trigger the cute 0.18s chomp jaw snap, head bounce & excited sparkle animation. */
  triggerChomp(streak: number): void {
    this.chompAnimTimer = CHOMP_ANIM_DURATION;
    this.chompDisplayStreak = Math.max(1, Math.floor(streak));
    if (this.chompDisplayStreak >= 2) {
      this.chompAuraTimer = 0.48;
    }
  }

  /** Reconcile segment count, form styling, nameplate & interpolation targets with `state`. */
  onTick(state: GameState): void {
    if (state.form !== this.activeForm) {
      if (this.hasSyncedOnce) {
        this.morphPulseTimer = MORPH_PULSE_DURATION;
      }
      this.applyFormVisuals(state.form);
    }

    this.syncNameplate(state);

    if (
      this.hasSyncedOnce &&
      state.snake === this.lastSnakeRef &&
      state.prevSnake === this.lastPrevSnakeRef &&
      state.phase === this.lastPhase &&
      state.level === this.lastLevel
    ) {
      return;
    }
    this.lastSnakeRef = state.snake;
    this.lastPrevSnakeRef = state.prevSnake;
    this.lastPhase = state.phase;
    this.lastLevel = state.level;

    const headCell = state.snake[0];
    const prevHeadCell = state.prevSnake[0] ?? headCell;
    if (headCell && prevHeadCell) {
      cellToWorld(prevHeadCell.x, prevHeadCell.z, this.half, this.headFrom);
      cellToWorld(headCell.x, headCell.z, this.half, this.headTo);
      if (this.headFrom.distanceToSquared(this.headTo) > TELEPORT_THRESHOLD_SQ) {
        this.headFrom.copy(this.headTo);
      }
      if (!this.hasSyncedOnce) {
        this.headHeadingY = headingToYaw(state.heading);
        this.headWorldPos.copy(this.headTo);
        this.currentThickness = computeThicknessScale(state.level);
        this.hasSyncedOnce = true;
      }
    }

    const bodyCount = Math.max(0, state.snake.length - 1);
    const bodyGeo = this.formGeometries[this.activeForm];

    while (this.segments.length < bodyCount) {
      const mesh = new Mesh(bodyGeo, this.bodyMaterial);
      this.scene.add(mesh);
      this.segments.push({ mesh, from: new Vector3(), to: new Vector3() });
    }
    while (this.segments.length > bodyCount) {
      const removed = this.segments.pop();
      if (removed) this.scene.remove(removed.mesh);
    }

    for (let i = 0; i < bodyCount; i++) {
      const cell = state.snake[i + 1];
      const seg = this.segments[i];
      if (!cell || !seg) continue;

      const prevCell = state.prevSnake[i + 1] ?? cell;
      cellToWorld(prevCell.x, prevCell.z, this.half, seg.from);
      cellToWorld(cell.x, cell.z, this.half, seg.to);
      if (seg.from.distanceToSquared(seg.to) > TELEPORT_THRESHOLD_SQ) {
        seg.from.copy(seg.to);
      }
    }
  }

  /** Interpolate head and tapered body at 60fps, animate accessories/crown/halo/label. */
  draw(alpha: number, elapsed: number, delta: number, state: GameState): void {
    this.onTick(state);

    const dt = Math.min(Math.max(delta, 0), 0.1);
    const a = Math.max(0, Math.min(1, alpha));
    const gameover = state.phase === 'gameover';

    const targetThickness = computeThicknessScale(state.level);
    this.currentThickness += (targetThickness - this.currentThickness) * Math.min(1, dt * 8);

    this.visualAltitude =
      state.phase === 'ready'
        ? state.butterflyAltitude
        : this.visualAltitude +
          (state.butterflyAltitude - this.visualAltitude) * Math.min(1, dt * 10);

    // 1. Head interpolation + level thickness + smooth 360° heading + aerial flight + chomp animation
    this.headWorldPos.lerpVectors(this.headFrom, this.headTo, a);
    const headScale = this.currentThickness * 0.96;
    const headAerialLift =
      this.visualAltitude * 2.65 + (this.visualAltitude > 0.2 ? Math.sin(elapsed * 4.5) * 0.14 : 0);
    const headBaseY = Math.max(0.08, 0.36 * headScale - 0.42) + headAerialLift;
    const headBob = gameover ? 0 : Math.sin(elapsed * 4.5) * 0.045;
    this.headGroup.position.set(this.headWorldPos.x, headBaseY + headBob, this.headWorldPos.z);

    const targetYaw = headingToYaw(state.heading);
    const headingDiff = normalizeAngleDiff(targetYaw, this.headHeadingY);
    this.headHeadingY += headingDiff * Math.min(1, dt * 18);
    this.headGroup.rotation.y = this.headHeadingY;

    const climbing =
      !gameover && !state.butterflyLanding && state.butterflyAltitude > this.visualAltitude + 0.02;
    const targetPitch = gameover
      ? 0
      : state.butterflyLanding
        ? 0.18
        : climbing || (state.butterflyStage === 'cocoon' && this.visualAltitude > 0.15)
          ? -0.14
          : 0;
    this.headGroup.rotation.x += (targetPitch - this.headGroup.rotation.x) * Math.min(1, dt * 10);

    const spraying = state.sprayActiveTicks > 0 && state.phase === 'playing';
    if (gameover) {
      this.sprayVisualIntensity = 0;
    } else {
      const blendRate = spraying ? 24 : 13;
      const targetSpray = spraying ? 1 : 0;
      this.sprayVisualIntensity +=
        (targetSpray - this.sprayVisualIntensity) * Math.min(1, dt * blendRate);
      if (!spraying && this.sprayVisualIntensity < 0.005) {
        this.sprayVisualIntensity = 0;
      }
    }

    this.animateChompJaw(elapsed, dt, headScale, state);
    this.animateBreathRig(elapsed, dt, state);

    // 2. Plump tapered body spine with subtle wave undulation
    const count = this.segments.length;
    const fallbackFx = Math.cos(state.heading);
    const fallbackFz = Math.sin(state.heading);

    for (let i = 0; i < count; i++) {
      const seg = this.segments[i];
      if (!seg) continue;

      const taper = 1.0 - 0.64 * (i / Math.max(1, count - 1));
      const segScale = this.currentThickness * taper;
      seg.mesh.scale.setScalar(segScale);
      seg.mesh.position.lerpVectors(seg.from, seg.to, a);

      this.scratchForward.subVectors(seg.to, seg.from);
      if (this.scratchForward.lengthSq() < 1e-4) {
        this.scratchForward.set(fallbackFx, 0, fallbackFz);
      } else {
        this.scratchForward.normalize();
      }
      this.scratchPerp.set(-this.scratchForward.z, 0, this.scratchForward.x);

      const waveAmp = gameover ? 0 : 0.04 * taper * Math.min(1, (i + 1) / 3);
      const wave = Math.sin(elapsed * 6.5 - (i + 1) * 0.72) * waveAmp;
      const segAerialLift =
        this.visualAltitude * 2.55 * Math.max(0.55, 1 - i * 0.015) +
        Math.sin(elapsed * 6 - i * 0.4) * 0.08 * this.visualAltitude;
      const baseSegY = Math.max(0, 0.37 * segScale - 0.44) + segAerialLift;
      const caterpillarBob =
        state.butterflyStage === 'caterpillar' && !gameover
          ? Math.sin(elapsed * 5.5 - (i + 1) * 1.2) * 0.035
          : 0;
      const bob = gameover ? 0 : Math.sin(elapsed * 4.5 - (i + 1) * 0.65) * 0.035;
      seg.mesh.position.addScaledVector(this.scratchPerp, wave);
      seg.mesh.position.y = baseSegY + bob + caterpillarBob;

      if (this.activeForm === 'phoenix' || this.activeForm === 'unicorn') {
        seg.mesh.rotation.y = elapsed * 1.4 - i * 0.35;
      } else {
        seg.mesh.rotation.y = Math.atan2(this.scratchForward.x, this.scratchForward.z);
      }
    }

    // 3. Cute blinking & eye glance toward steering target
    this.animateEyes(elapsed, state);

    // 4. Form-specific accessories
    this.animateFormAccessories(elapsed, state);

    // 4b. Fairy Butterfly Metamorphosis rigs
    this.animateButterflyMetamorphosis(elapsed, dt, state);

    // 5. Rainbow shield bubble (ONLY when shieldTicks > 0), Magnet Halo, Chomp Streak Aura & Morph Aura
    this.animateShield(elapsed, dt, state);
    this.animateMagnetHalo(elapsed, dt, state);
    this.animateChompAura(elapsed, dt, state);
    this.animateMorphAura(elapsed, dt, state);

    // 6. Speed booster / Dash / Invulnerability / Head glow pulses
    this.animateStatusMaterials(elapsed, state);

    // 7. #1 Golden Crown & 3D Nameplate stacked cleanly above head
    const showCrown = state.playerRank === 1 && !gameover;
    this.crownGroup.visible = showCrown;
    if (showCrown) {
      const crownScale = Math.max(1.0, this.currentThickness * 0.88);
      this.crownGroup.scale.setScalar(crownScale);
      this.crownGroup.position.set(
        this.headWorldPos.x,
        headBaseY + headScale * 0.86 + Math.sin(elapsed * 3.4) * 0.05,
        this.headWorldPos.z,
      );
      this.crownGroup.rotation.y += dt * 1.5;
    }

    const labelY = headBaseY + headScale * (showCrown ? 1.55 : 1.08);
    this.nameSprite.position.set(this.headWorldPos.x, labelY, this.headWorldPos.z);
    this.nameSprite.visible = !gameover;

    const showGroundShadow = this.visualAltitude > 0.05 && !gameover;
    this.groundShadowGroup.visible = showGroundShadow;
    if (showGroundShadow) {
      this.groundShadowGroup.position.set(this.headWorldPos.x, -0.34, this.headWorldPos.z);
      const pulseSpeed = state.butterflyLanding ? 11 : 5.5;
      const pulse = 0.92 + Math.sin(elapsed * pulseSpeed) * 0.14;
      this.groundShadowGroup.scale.setScalar(pulse * (0.85 + 0.25 * this.visualAltitude));
      this.groundShadowGroup.rotation.y = elapsed * 1.4;
      const altAlpha = Math.min(1, this.visualAltitude * 1.2);
      this.groundShadowRingMat.opacity = (0.45 + Math.sin(elapsed * pulseSpeed) * 0.12) * altAlpha;
      this.groundShadowInnerMat.opacity = (0.28 + Math.cos(elapsed * pulseSpeed) * 0.08) * altAlpha;
    }
  }

  dispose(): void {
    this.scene.remove(this.headGroup);
    this.scene.remove(this.crownGroup);
    this.scene.remove(this.nameSprite);
    this.scene.remove(this.groundShadowGroup);
    for (const seg of this.segments) {
      this.scene.remove(seg.mesh);
    }
    this.segments = [];

    for (const geo of Object.values(this.formGeometries)) {
      geo.dispose();
    }
    this.headGeometry.dispose();
    this.jawGeometry.dispose();
    this.mouthCavityGeo.dispose();
    this.fangGeo.dispose();
    this.chompAuraGeo.dispose();
    this.eyeWhiteGeo.dispose();
    this.pupilGeo.dispose();
    this.catchlightGeo.dispose();
    this.cheekGeo.dispose();
    this.hornConeGeo.dispose();
    this.dragonWingGeo.dispose();
    this.phoenixCrestGeo.dispose();
    this.phoenixWingGeo.dispose();
    this.unicornHornGeo.dispose();
    this.unicornSpiralGeo.dispose();
    this.haloGeo.dispose();
    this.leafGeo.dispose();
    this.petalGeo.dispose();
    this.flowerCenterGeo.dispose();
    this.shieldBubbleGeo.dispose();
    this.shieldWireGeo.dispose();
    this.magnetRingGeo.dispose();
    this.morphAuraGeo.dispose();
    this.morphStarGeo.dispose();
    this.breathInnerConeGeo.dispose();
    this.breathOuterConeGeo.dispose();
    this.breathVortexRingGeo.dispose();

    // Fairy butterfly metamorphosis geometries
    this.catAntennaStemGeo.dispose();
    this.catPomPomGeo.dispose();
    this.cocoonShellGeo.dispose();
    this.cocoonRingGeo.dispose();
    this.bflyForewingGeo.dispose();
    this.bflyHindwingGeo.dispose();
    this.bflySpotGeo.dispose();
    this.bflyDiamondGeo.dispose();
    this.bflyTiaraBandGeo.dispose();
    this.bflyTiaraGemGeo.dispose();
    this.bflyAntennaStemGeo.dispose();
    this.bflyStarTipGeo.dispose();

    this.bodyMaterial.dispose();
    this.headMaterial.dispose();
    this.eyeWhiteMat.dispose();
    this.pupilMat.dispose();
    this.catchlightMat.dispose();
    this.cheekMat.dispose();
    this.mouthCavityMat.dispose();
    this.fangMat.dispose();
    this.chompAuraMat.dispose();
    this.morphAuraMat.dispose();
    this.morphStarMat.dispose();
    this.dragonMat.dispose();
    this.phoenixMat.dispose();
    this.unicornGoldMat.dispose();
    this.spiritLeafMat.dispose();
    this.flowerPetalMat.dispose();
    this.shieldMaterial.dispose();
    this.shieldWireMat.dispose();
    this.magnetOuterMat.dispose();
    this.magnetInnerMat.dispose();
    this.breathInnerMat.dispose();
    this.breathOuterMat.dispose();
    this.breathRingAMat.dispose();
    this.breathRingBMat.dispose();

    // Fairy butterfly metamorphosis materials
    this.catPomPinkMat.dispose();
    this.catPomCyanMat.dispose();
    this.catStemMat.dispose();
    this.cocoonShellMat.dispose();
    this.cocoonRingMat.dispose();
    this.bflyWingMat.dispose();
    this.bflyWingInnerMat.dispose();
    this.bflyWingRimMat.dispose();
    this.bflySpotMagentaMat.dispose();
    this.bflySpotCyanMat.dispose();
    this.bflySpotGoldMat.dispose();
    this.bflyTiaraMat.dispose();
    this.bflyAntennaStarMat.dispose();
    this.tiaraBandGeo.dispose();
    this.tiaraCenterGemGeo.dispose();
    this.tiaraSideGemGeo.dispose();
    this.tiaraGoldMat.dispose();
    this.tiaraPinkGemMat.dispose();
    this.tiaraDiamondMat.dispose();
    this.groundShadowRingGeo.dispose();
    this.groundShadowInnerGeo.dispose();
    this.groundShadowRingMat.dispose();
    this.groundShadowInnerMat.dispose();

    this.nameSpriteMaterial.dispose();
  }

  private syncNameplate(state: GameState): void {
    const key = `${state.playerName}|${state.level}|player`;
    if (key === this.lastLabelKey) return;
    this.lastLabelKey = key;
    this.nameSpriteMaterial.map = this.badgeCache.getOrCreateNameplate({
      name: state.playerName,
      level: state.level,
      tier: 'player',
    });
    this.nameSpriteMaterial.needsUpdate = true;
  }

  private applyFormVisuals(form: SnakeForm): void {
    this.activeForm = form;
    const meta = FORM_METADATA[form];

    this.bodyMaterial.color.setHex(meta.hexColor);
    this.bodyMaterial.emissive.setHex(meta.hexColor);
    this.headMaterial.emissive.setHex(meta.hexColor);

    const nextGeo = this.formGeometries[form];
    for (const seg of this.segments) {
      seg.mesh.geometry = nextGeo;
    }

    this.dragonRig.visible = form === 'dragon';
    this.phoenixRig.visible = form === 'phoenix';
    this.unicornRig.visible = form === 'unicorn';
    this.spiritRig.visible = form === 'spirit';

    this.morphAuraMat.color.setHex(meta.hexColor);

    const breathColors = FORM_BREATH_COLORS[form];
    this.breathInnerMat.color.setHex(breathColors.coreHex);
    this.breathOuterMat.color.setHex(breathColors.outerHex);
    this.breathOuterMat.emissive.setHex(breathColors.outerHex);
    this.breathRingAMat.color.setHex(breathColors.ringAHex);
    this.breathRingBMat.color.setHex(breathColors.ringBHex);
  }

  private buildJawFeatures(): void {
    const jawMesh = new Mesh(this.jawGeometry, this.headMaterial);
    jawMesh.position.set(0, -0.04, 0.22);
    this.jawGroup.add(jawMesh);

    const cavity = new Mesh(this.mouthCavityGeo, this.mouthCavityMat);
    cavity.position.set(0, 0.042, 0.21);
    this.jawGroup.add(cavity);

    for (const xSign of [-1, 1] as const) {
      const fang = new Mesh(this.fangGeo, this.fangMat);
      fang.position.set(xSign * 0.14, 0.088, 0.35);
      fang.rotation.set(0.14, 0, -xSign * 0.12);
      this.jawGroup.add(fang);
    }

    this.jawGroup.position.set(0, -0.22, -0.02);
    this.headGroup.add(this.jawGroup);
  }

  private buildBreathRig(): void {
    this.breathGroup.position.set(0, -0.02, 0.62);

    this.breathInnerCone = new Mesh(this.breathInnerConeGeo, this.breathInnerMat);
    this.breathInnerCone.rotation.x = -Math.PI / 2;
    this.breathInnerCone.position.set(0, 0, 0.34);

    this.breathOuterCone = new Mesh(this.breathOuterConeGeo, this.breathOuterMat);
    this.breathOuterCone.rotation.x = -Math.PI / 2;
    this.breathOuterCone.position.set(0, 0, 0.6);

    this.breathRingA = new Mesh(this.breathVortexRingGeo, this.breathRingAMat);
    this.breathRingA.rotation.order = 'ZYX';
    this.breathRingA.rotation.x = 0.28;
    this.breathRingA.position.set(0, 0, 0.42);
    this.breathRingA.scale.set(0.95, 0.82, 1);

    this.breathRingB = new Mesh(this.breathVortexRingGeo, this.breathRingBMat);
    this.breathRingB.rotation.order = 'ZYX';
    this.breathRingB.rotation.x = -0.3;
    this.breathRingB.position.set(0, 0, 0.96);
    this.breathRingB.scale.set(1.36, 1.18, 1);

    this.breathGroup.add(
      this.breathOuterCone,
      this.breathInnerCone,
      this.breathRingA,
      this.breathRingB,
    );
    this.breathGroup.visible = false;
    this.headGroup.add(this.breathGroup);
  }

  private buildFaceFeatures(): void {
    const buildEye = (pivot: Group, pupilGroup: Group, xSign: number) => {
      pivot.position.set(xSign * 0.21, 0.16, 0.34);
      const white = new Mesh(this.eyeWhiteGeo, this.eyeWhiteMat);
      white.scale.set(0.95, 1.08, 0.72);
      pivot.add(white);

      const pupil = new Mesh(this.pupilGeo, this.pupilMat);
      pupil.position.set(0, 0, 0.072);
      pupil.scale.set(1, 1.08, 0.7);
      pupilGroup.add(pupil);

      const bigSpark = new Mesh(this.catchlightGeo, this.catchlightMat);
      bigSpark.position.set(0.028, 0.036, 0.118);
      pupilGroup.add(bigSpark);
      this.catchlightMeshes.push({ mesh: bigSpark, baseScale: 1 });

      const smallSpark = new Mesh(this.catchlightGeo, this.catchlightMat);
      smallSpark.scale.setScalar(0.55);
      smallSpark.position.set(-0.026, -0.024, 0.118);
      pupilGroup.add(smallSpark);
      this.catchlightMeshes.push({ mesh: smallSpark, baseScale: 0.55 });

      pivot.add(pupilGroup);
      this.headGroup.add(pivot);
    };

    buildEye(this.leftEyePivot, this.leftPupilGroup, -1);
    buildEye(this.rightEyePivot, this.rightPupilGroup, 1);

    for (const xSign of [-1, 1] as const) {
      const cheek = new Mesh(this.cheekGeo, this.cheekMat);
      cheek.scale.set(1.25, 0.65, 0.5);
      cheek.position.set(xSign * 0.32, -0.04, 0.28);
      this.headGroup.add(cheek);
    }
  }

  private buildDragonAccessories(): void {
    for (const xSign of [-1, 1] as const) {
      const horn = new Mesh(this.hornConeGeo, this.dragonMat);
      horn.position.set(xSign * 0.19, 0.46, -0.06);
      horn.rotation.set(-0.48, 0, -xSign * 0.28);
      this.dragonRig.add(horn);
    }

    const leftWingMesh = new Mesh(this.dragonWingGeo, this.dragonMat);
    this.dragonLeftWing.add(leftWingMesh);
    this.dragonLeftWing.position.set(-0.3, 0.12, -0.22);
    this.dragonLeftWing.scale.x = -1;
    this.dragonLeftWing.rotation.y = -0.35;

    const rightWingMesh = new Mesh(this.dragonWingGeo, this.dragonMat);
    this.dragonRightWing.add(rightWingMesh);
    this.dragonRightWing.position.set(0.3, 0.12, -0.22);
    this.dragonRightWing.rotation.y = 0.35;

    this.dragonRig.add(this.dragonLeftWing, this.dragonRightWing);
    this.headGroup.add(this.dragonRig);
  }

  private buildPhoenixAccessories(): void {
    const crestSpecs: readonly {
      x: number;
      y: number;
      z: number;
      rx: number;
      rz: number;
      s: number;
    }[] = [
      { x: 0, y: 0.5, z: -0.08, rx: -0.65, rz: 0, s: 1.15 },
      { x: -0.15, y: 0.43, z: -0.14, rx: -0.75, rz: 0.3, s: 0.88 },
      { x: 0.15, y: 0.43, z: -0.14, rx: -0.75, rz: -0.3, s: 0.88 },
    ];
    for (const spec of crestSpecs) {
      const plume = new Mesh(this.phoenixCrestGeo, this.phoenixMat);
      plume.position.set(spec.x, spec.y, spec.z);
      plume.rotation.set(spec.rx, 0, spec.rz);
      plume.scale.setScalar(spec.s);
      this.phoenixRig.add(plume);
    }

    const leftWing = new Mesh(this.phoenixWingGeo, this.phoenixMat);
    this.phoenixLeftWing.add(leftWing);
    this.phoenixLeftWing.position.set(-0.32, 0.1, -0.18);
    this.phoenixLeftWing.scale.x = -1;
    this.phoenixLeftWing.rotation.y = -0.25;

    const rightWing = new Mesh(this.phoenixWingGeo, this.phoenixMat);
    this.phoenixRightWing.add(rightWing);
    this.phoenixRightWing.position.set(0.32, 0.1, -0.18);
    this.phoenixRightWing.rotation.y = 0.25;

    this.phoenixRig.add(this.phoenixLeftWing, this.phoenixRightWing);
    this.headGroup.add(this.phoenixRig);
  }

  private buildUnicornAccessories(): Mesh<TorusGeometry, MeshStandardMaterial> {
    const hornGroup = new Group();
    hornGroup.position.set(0, 0.48, 0.16);
    hornGroup.rotation.x = 0.34;

    const horn = new Mesh(this.unicornHornGeo, this.unicornGoldMat);
    hornGroup.add(horn);

    for (let i = 0; i < 3; i++) {
      const ring = new Mesh(this.unicornSpiralGeo, this.unicornGoldMat);
      ring.rotation.x = Math.PI / 2;
      ring.rotation.y = 0.22;
      ring.position.y = -0.14 + i * 0.13;
      ring.scale.setScalar(1 - i * 0.22);
      hornGroup.add(ring);
    }
    this.unicornRig.add(hornGroup);

    const halo = new Mesh(this.haloGeo, this.unicornGoldMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.set(0, 0.74, -0.12);
    this.unicornRig.add(halo);

    this.headGroup.add(this.unicornRig);
    return halo;
  }

  private buildSpiritAccessories(): void {
    for (let i = 0; i < 5; i++) {
      const angle = ((i - 2) / 2) * 0.65;
      const leaf = new Mesh(this.leafGeo, this.spiritLeafMat);
      leaf.scale.set(0.65, 1.35, 0.38);
      leaf.position.set(Math.sin(angle) * 0.27, 0.39, Math.cos(angle) * 0.12 - 0.04);
      leaf.rotation.set(-0.2, angle, -angle * 0.6);
      this.spiritRig.add(leaf);
    }

    this.spiritFlower.position.set(0, 0.58, 0.02);
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5;
      const petal = new Mesh(this.petalGeo, this.flowerPetalMat);
      petal.scale.set(1.15, 0.42, 0.85);
      petal.position.set(Math.cos(a) * 0.13, 0, Math.sin(a) * 0.13);
      petal.rotation.y = -a;
      this.spiritFlower.add(petal);
    }
    const center = new Mesh(this.flowerCenterGeo, this.unicornGoldMat);
    this.spiritFlower.add(center);

    this.spiritRig.add(this.spiritFlower);
    this.headGroup.add(this.spiritRig);
  }

  private buildCaterpillarRig(): void {
    // Two cute curved pastel antennae with glowing pom-pom bobbles
    for (const xSign of [-1, 1] as const) {
      const stem = new Mesh(this.catAntennaStemGeo, this.catStemMat);
      stem.position.set(xSign * 0.14, 0.42, 0.12);
      stem.rotation.set(-0.35, 0, -xSign * 0.42);
      this.caterpillarRig.add(stem);

      const pom = new Mesh(this.catPomPomGeo, xSign < 0 ? this.catPomPinkMat : this.catPomCyanMat);
      pom.position.set(xSign * 0.28, 0.6, 0.2);
      this.caterpillarRig.add(pom);
    }
    // Store references for animation
    const poms = this.caterpillarRig.children.filter(
      (c): c is Mesh<SphereGeometry, MeshStandardMaterial> =>
        c instanceof Mesh && c.geometry === this.catPomPomGeo,
    );
    this.catPomL = poms[0]!;
    this.catPomR = poms[1]!;

    this.caterpillarRig.visible = false;
    this.headGroup.add(this.caterpillarRig);
  }

  private buildCocoonRig(): void {
    // Shimmering translucent pearlescent ovoid chrysalis
    const shell = new Mesh(this.cocoonShellGeo, this.cocoonShellMat);
    shell.scale.set(0.95, 1.15, 1.38);
    this.cocoonRig.add(shell);

    // Two counter-rotating golden silk torus rings
    this.cocoonRingA = new Mesh(this.cocoonRingGeo, this.cocoonRingMat);
    this.cocoonRingA.rotation.x = Math.PI * 0.38;
    this.cocoonRig.add(this.cocoonRingA);

    this.cocoonRingB = new Mesh(this.cocoonRingGeo, this.cocoonRingMat);
    this.cocoonRingB.rotation.x = -Math.PI * 0.38;
    this.cocoonRingB.scale.setScalar(0.88);
    this.cocoonRig.add(this.cocoonRingB);

    this.cocoonRig.visible = false;
    this.headGroup.add(this.cocoonRig);
  }

  private buildButterflyRig(): void {
    // ── Giant 4-lobed multi-layered Pink & Pearl-Sakura Fairy Butterfly Wings ──
    for (const xSign of [-1, 1] as const) {
      const pivot = xSign < 0 ? this.bflyLeftWingPivot : this.bflyRightWingPivot;
      pivot.position.set(xSign * 0.28, 0.16, -0.1);

      // Angle wings gently open toward the sky & isometric camera so both sides dazzle from every heading
      const wingPlane = new Group();
      wingPlane.rotation.x = Math.PI * 0.36;

      // Outer sakura-pink forewing & hindwing
      const forewing = new Mesh(this.bflyForewingGeo, this.bflyWingMat);
      forewing.scale.x = xSign;
      wingPlane.add(forewing);

      const hindwing = new Mesh(this.bflyHindwingGeo, this.bflyWingMat);
      hindwing.scale.x = xSign;
      hindwing.position.set(0, -0.34, -0.02);
      hindwing.rotation.z = -xSign * 0.24;
      wingPlane.add(hindwing);

      // Layered inner pearl-pink shimmer veil on forewing & hindwing
      const innerForewing = new Mesh(this.bflyForewingGeo, this.bflyWingInnerMat);
      innerForewing.scale.set(xSign * 0.72, 0.72, 1.15);
      innerForewing.position.set(xSign * 0.08, 0.08, 0.015);
      wingPlane.add(innerForewing);

      const innerHindwing = new Mesh(this.bflyHindwingGeo, this.bflyWingInnerMat);
      innerHindwing.scale.set(xSign * 0.68, 0.68, 1.15);
      innerHindwing.position.set(xSign * 0.06, -0.32, 0.005);
      innerHindwing.rotation.z = -xSign * 0.24;
      wingPlane.add(innerHindwing);

      // Symmetrical rose-petal spots, icy-cyan diamonds & pearl-crystal rim accents
      const roseSpot = new Mesh(this.bflySpotGeo, this.bflyWingRimMat);
      roseSpot.position.set(xSign * 0.62, 0.36, 0.02);
      roseSpot.scale.set(1.55, 0.95, 0.65);
      wingPlane.add(roseSpot);

      const icyDiamond = new Mesh(this.bflyDiamondGeo, this.bflySpotCyanMat);
      icyDiamond.position.set(xSign * 1.05, 0.28, 0.02);
      icyDiamond.scale.set(1.15, 1.15, 0.7);
      wingPlane.add(icyDiamond);

      const rimPearlDiamond = new Mesh(this.bflyDiamondGeo, this.bflySpotGoldMat);
      rimPearlDiamond.position.set(xSign * 1.38, 0.22, 0.02);
      rimPearlDiamond.scale.set(0.85, 0.85, 0.6);
      wingPlane.add(rimPearlDiamond);

      const hindIcySpot = new Mesh(this.bflySpotGeo, this.bflySpotCyanMat);
      hindIcySpot.position.set(xSign * 0.42, -0.28, 0);
      hindIcySpot.scale.set(1.05, 0.8, 0.65);
      wingPlane.add(hindIcySpot);

      const hindRoseGem = new Mesh(this.bflyDiamondGeo, this.bflySpotMagentaMat);
      hindRoseGem.position.set(xSign * 0.72, -0.24, 0);
      hindRoseGem.scale.set(0.9, 0.9, 0.65);
      wingPlane.add(hindRoseGem);

      pivot.add(wingPlane);
      this.butterflyRig.add(pivot);
    }

    // ── Glowing Crystal Tiara perched above the forehead ──
    const tiaraBand = new Mesh(this.bflyTiaraBandGeo, this.bflyTiaraMat);
    tiaraBand.position.set(0, 0.38, 0.16);
    tiaraBand.rotation.set(-0.25, 0, 0);
    this.butterflyRig.add(tiaraBand);

    this.bflyTiaraCenterGem = new Mesh(this.bflyDiamondGeo, this.bflySpotCyanMat);
    this.bflyTiaraCenterGem.position.set(0, 0.57, 0.21);
    this.bflyTiaraCenterGem.scale.set(1.0, 1.45, 0.85);
    this.butterflyRig.add(this.bflyTiaraCenterGem);

    for (const xSign of [-1, 1] as const) {
      const sideGem = new Mesh(this.bflyTiaraGemGeo, this.bflyWingRimMat);
      sideGem.position.set(xSign * 0.14, 0.49, 0.18);
      sideGem.rotation.set(0.15, 0, -xSign * 0.36);
      this.butterflyRig.add(sideGem);
    }

    // ── Slender pearl-pink antennae with glowing crystal star-tips ──
    for (const xSign of [-1, 1] as const) {
      const stem = new Mesh(this.bflyAntennaStemGeo, this.catStemMat);
      stem.position.set(xSign * 0.11, 0.52, 0.18);
      stem.rotation.set(-0.55, 0, -xSign * 0.48);
      this.butterflyRig.add(stem);

      const star = new Mesh(this.bflyStarTipGeo, this.bflyAntennaStarMat);
      star.position.set(xSign * 0.26, 0.74, 0.28);
      this.butterflyRig.add(star);
    }
    const stars = this.butterflyRig.children.filter(
      (c): c is Mesh => c instanceof Mesh && c.geometry === this.bflyStarTipGeo,
    );
    this.bflyAntennaStarL = stars[0]!;
    this.bflyAntennaStarR = stars[1]!;

    this.butterflyRig.visible = false;
    this.headGroup.add(this.butterflyRig);
  }

  private buildPrincessTiara(): void {
    const band = new Mesh(this.tiaraBandGeo, this.tiaraGoldMat);
    band.position.set(0, 0.36, 0.22);
    band.rotation.set(-0.26, 0, 0);
    this.princessTiaraGroup.add(band);

    this.princessTiaraGem = new Mesh(this.tiaraCenterGemGeo, this.tiaraPinkGemMat);
    this.princessTiaraGem.position.set(0, 0.56, 0.27);
    this.princessTiaraGem.scale.set(1.0, 1.35, 0.82);
    this.princessTiaraGroup.add(this.princessTiaraGem);

    for (const xSign of [-1, 1] as const) {
      const sideGem = new Mesh(this.tiaraSideGemGeo, this.tiaraDiamondMat);
      sideGem.position.set(xSign * 0.14, 0.47, 0.24);
      sideGem.rotation.set(0.16, 0, -xSign * 0.34);
      this.princessTiaraGroup.add(sideGem);
    }

    this.headGroup.add(this.princessTiaraGroup);
  }

  private computePreyAnticipation(state: GameState): number {
    if (state.phase !== 'playing') return 0;
    const fx = Math.cos(state.heading);
    const fz = Math.sin(state.heading);
    const hx = this.headWorldPos.x;
    const hz = this.headWorldPos.z;
    const maxDistSq = 2.5 * 2.5;
    let best = 0;

    for (const bot of state.bots) {
      if (bot.level > state.level) continue;
      for (const seg of bot.spine) {
        const dx = seg.x - hx;
        const dz = seg.z - hz;
        const distSq = dx * dx + dz * dz;
        if (distSq > maxDistSq) continue;
        const dist = Math.sqrt(distSq);
        const forwardDot = dx * fx + dz * fz;
        if (dist < 0.75 || forwardDot >= -0.1 * dist) {
          const proximity = clamp(1 - dist / 2.6, 0.45, 1);
          if (proximity > best) {
            best = proximity;
          }
        }
      }
    }
    return best;
  }

  private animateChompJaw(elapsed: number, dt: number, headScale: number, state: GameState): void {
    const targetAnticipate = this.computePreyAnticipation(state);
    this.anticipateOpen += (targetAnticipate - this.anticipateOpen) * Math.min(1, dt * 16);

    if (this.chompAnimTimer > 0) {
      this.chompAnimTimer = Math.max(0, this.chompAnimTimer - dt);
    }
    if (this.chompAuraTimer > 0) {
      this.chompAuraTimer = Math.max(0, this.chompAuraTimer - dt);
    }

    let jawOpen =
      state.phase === 'gameover' ? 0 : this.anticipateOpen * (0.72 + 0.14 * Math.sin(elapsed * 14));
    let headChompScale = 1;

    if (this.chompAnimTimer > 0 && state.phase !== 'gameover') {
      const p = 1 - this.chompAnimTimer / CHOMP_ANIM_DURATION;
      let animJaw = 0;
      if (p < 0.35) {
        animJaw = 0.95 * (1 - p / 0.35);
      } else if (p < 0.75) {
        animJaw = Math.sin(((p - 0.35) / 0.4) * Math.PI) * 0.82;
      }
      jawOpen = Math.max(jawOpen * 0.35, animJaw);

      const puff = Math.sin(Math.min(1, p / 0.7) * Math.PI);
      headChompScale = 1 + 0.16 * puff;
    }

    if (this.sprayVisualIntensity > 0.01 && state.phase !== 'gameover') {
      const breathJaw = this.sprayVisualIntensity * (0.86 + 0.14 * Math.sin(elapsed * 32));
      jawOpen = Math.max(jawOpen, breathJaw);
      headChompScale = Math.max(
        headChompScale,
        1 + 0.06 * this.sprayVisualIntensity * (0.5 + 0.5 * Math.sin(elapsed * 26)),
      );
    }

    if (this.morphPulseTimer > 0 && state.phase !== 'gameover') {
      const mp = 1 - this.morphPulseTimer / MORPH_PULSE_DURATION;
      headChompScale = Math.max(headChompScale, 1 + 0.16 * Math.sin(mp * Math.PI));
    }

    jawOpen = clamp(jawOpen, 0, 1);
    this.jawGroup.position.set(0, -0.22 - jawOpen * 0.04, -0.02 + jawOpen * 0.2);
    this.jawGroup.rotation.x = jawOpen * 0.62;
    this.headGroup.scale.setScalar(headScale * headChompScale);
  }

  private animateBreathRig(elapsed: number, dt: number, state: GameState): void {
    if (this.sprayVisualIntensity <= 0.01 || state.phase === 'gameover') {
      this.breathGroup.visible = false;
      this.mouthCavityMat.emissive.setHex(0xff3d6e);
      this.mouthCavityMat.emissiveIntensity = 0.45;
      return;
    }

    this.breathGroup.visible = true;
    this.mouthCavityMat.emissive
      .setHex(0xff3d6e)
      .lerp(this.breathOuterMat.emissive, this.sprayVisualIntensity);
    this.mouthCavityMat.emissiveIntensity =
      0.45 + this.sprayVisualIntensity * (1.45 + 0.3 * Math.sin(elapsed * 28));

    const radialPulse = 0.9 + 0.14 * Math.sin(elapsed * 26);
    const lengthPulse = 0.92 + 0.14 * Math.cos(elapsed * 22);
    this.breathGroup.scale.set(
      this.sprayVisualIntensity * radialPulse,
      this.sprayVisualIntensity * radialPulse,
      this.sprayVisualIntensity * lengthPulse,
    );

    this.breathInnerCone.rotation.y += dt * 10;
    this.breathOuterCone.rotation.y -= dt * 7.5;
    this.breathRingA.rotation.z += dt * 11;
    this.breathRingB.rotation.z -= dt * 14.5;

    const ringAPulse = 0.92 + 0.12 * Math.sin(elapsed * 24);
    const ringBPulse = 1.3 + 0.16 * Math.cos(elapsed * 20);
    this.breathRingA.scale.set(ringAPulse, ringAPulse * 0.86, 1);
    this.breathRingB.scale.set(ringBPulse, ringBPulse * 0.86, 1);

    this.breathInnerMat.opacity = 0.9 * this.sprayVisualIntensity;
    this.breathOuterMat.opacity = (0.48 + 0.1 * Math.sin(elapsed * 24)) * this.sprayVisualIntensity;
    this.breathRingAMat.opacity = 0.85 * this.sprayVisualIntensity;
    this.breathRingBMat.opacity = 0.78 * this.sprayVisualIntensity;
  }

  private animateChompAura(elapsed: number, dt: number, state: GameState): void {
    const streak =
      state.chompStreakTicks > 0
        ? state.chompStreak
        : this.chompAuraTimer > 0
          ? this.chompDisplayStreak
          : 0;
    if (streak < 2 || state.phase === 'gameover') {
      this.chompAuraGroup.visible = false;
      return;
    }
    this.chompAuraGroup.visible = true;
    if (streak >= 4) {
      this.chompAuraMat.color.setHSL((elapsed * 1.45) % 1, 0.95, 0.66);
    } else {
      this.chompAuraMat.color.setHex(0xffe45e);
    }
    this.chompAuraMat.opacity = 0.68 + 0.24 * Math.sin(elapsed * 16);
    this.chompAuraGroup.rotation.y += dt * 4.5;
    this.chompAuraRingB.rotation.z -= dt * 3.5;
    const auraPulse = 1 + 0.1 * Math.sin(elapsed * 14);
    this.chompAuraGroup.scale.setScalar(auraPulse);
  }

  private animateMorphAura(elapsed: number, dt: number, state: GameState): void {
    if (this.morphPulseTimer <= 0 || state.phase === 'gameover') {
      this.morphAuraGroup.visible = false;
      return;
    }
    this.morphPulseTimer = Math.max(0, this.morphPulseTimer - dt);
    const p = 1 - this.morphPulseTimer / MORPH_PULSE_DURATION;
    const eased = 1 - Math.pow(1 - p, 2);
    const fade = Math.sin((1 - p) * Math.PI * 0.5);

    this.morphAuraGroup.visible = true;
    this.morphAuraGroup.scale.setScalar(0.76 + eased * 1.12);
    this.morphAuraGroup.rotation.y += dt * 6.2;
    this.morphAuraRingA.rotation.z += dt * 4.5;
    this.morphAuraRingB.rotation.z -= dt * 5.8;

    this.morphAuraMat.opacity = 0.9 * fade;
    this.morphStarMat.opacity = 0.94 * fade;
    const orbScale = (1 + 0.35 * Math.sin(elapsed * 20)) * Math.max(0.2, fade);
    for (let i = 0; i < this.morphOrbiters.length; i++) {
      const orb = this.morphOrbiters[i];
      if (!orb) continue;
      orb.rotation.y = elapsed * 8 + i;
      orb.scale.setScalar(orbScale);
    }
  }

  private animateEyes(elapsed: number, state: GameState): void {
    const chompExcited =
      state.phase !== 'gameover' &&
      (this.chompAnimTimer > 0 || (state.chompStreak >= 2 && state.chompStreakTicks > 0));

    let eyeScaleX = 1;
    let eyeScaleY = 1;
    if (this.chompAnimTimer > 0 && state.phase !== 'gameover') {
      eyeScaleX = 1.08;
      eyeScaleY = 1.12;
    } else {
      const blinkCycle = elapsed % 3.6;
      if (blinkCycle > 3.44) {
        const t = (blinkCycle - 3.44) / 0.16;
        eyeScaleY = Math.max(0.08, Math.abs(Math.cos(t * Math.PI)));
      }
    }
    this.leftEyePivot.scale.set(eyeScaleX, eyeScaleY, eyeScaleX);
    this.rightEyePivot.scale.set(eyeScaleX, eyeScaleY, eyeScaleX);

    const sparkleMul = chompExcited ? 1.45 + 0.42 * Math.abs(Math.sin(elapsed * 28)) : 1;
    for (const entry of this.catchlightMeshes) {
      entry.mesh.scale.setScalar(entry.baseScale * sparkleMul);
    }

    let glanceX = Math.sin(elapsed * 1.3) * 0.008;
    if (state.targetHeading !== null) {
      const turnDelta = angleDiff(state.heading, state.targetHeading);
      // In screen space, positive angleDiff turns right (local -X in +Z-forward rig).
      glanceX = clamp(-turnDelta * 0.055, -0.036, 0.036);
    }
    this.leftPupilGroup.position.x = glanceX;
    this.rightPupilGroup.position.x = glanceX;
  }

  private animateFormAccessories(elapsed: number, state: GameState): void {
    const speedActive = state.isDashing || state.boosters.speed.activeTicks > 0;
    const flapSpeed = speedActive ? 16 : 8.5;
    if (this.activeForm === 'dragon') {
      const flap = Math.sin(elapsed * flapSpeed) * 0.42;
      this.dragonLeftWing.rotation.z = -0.25 - flap;
      this.dragonRightWing.rotation.z = 0.25 + flap;
    } else if (this.activeForm === 'phoenix') {
      const glide = Math.sin(elapsed * (flapSpeed * 0.85)) * 0.48;
      this.phoenixLeftWing.rotation.z = -0.2 - glide;
      this.phoenixRightWing.rotation.z = 0.2 + glide;
    } else if (this.activeForm === 'unicorn') {
      this.unicornHalo.position.y = 0.76 + Math.sin(elapsed * 3.5) * 0.05;
      this.unicornHalo.rotation.x = Math.PI / 2 + Math.sin(elapsed * 2.4) * 0.1;
      this.unicornHalo.rotation.y = Math.cos(elapsed * 2.0) * 0.1;
    } else if (this.activeForm === 'spirit') {
      this.spiritFlower.rotation.y = elapsed * 1.5;
      this.spiritFlower.position.y = 0.58 + Math.sin(elapsed * 3.2) * 0.03;
    }
  }

  private animateShield(elapsed: number, dt: number, state: GameState): void {
    if (state.shieldTicks <= 0 || state.phase === 'gameover') {
      this.shieldGroup.visible = false;
      return;
    }
    this.shieldGroup.visible = true;
    this.shieldWire.rotation.y += dt * 1.1;
    this.shieldWire.rotation.x += dt * 0.6;

    const hue = (elapsed * 0.35) % 1;
    this.shieldMaterial.color.setHSL(hue, 0.85, 0.76);
    this.shieldMaterial.emissive.setHSL((hue + 0.15) % 1, 0.9, 0.65);
    this.shieldWireMat.color.setHSL((hue + 0.5) % 1, 0.9, 0.78);

    const expiring = state.shieldTicks <= 4;
    const pulse = expiring ? 0.55 + 0.45 * Math.sin(elapsed * 18) : 1;
    this.shieldMaterial.opacity = 0.34 * pulse;
    this.shieldWireMat.opacity = 0.26 * pulse;
    this.shieldGroup.scale.setScalar(1 + Math.sin(elapsed * 4.5) * 0.035);
  }

  private animateMagnetHalo(elapsed: number, dt: number, state: GameState): void {
    const magnetActive =
      state.boosters.magnet.activeTicks > 0 ||
      (state.absorbedPower?.form === 'unicorn' && state.absorbedPower.ticksRemaining > 0);
    if (!magnetActive || state.phase === 'gameover') {
      this.magnetGroup.visible = false;
      return;
    }
    this.magnetGroup.visible = true;
    this.magnetRingA.rotation.z += dt * 2.6;
    this.magnetRingB.rotation.z -= dt * 3.2;
    this.magnetGroup.rotation.y += dt * 1.8;
    const pulse = 1 + Math.sin(elapsed * 6.5) * 0.08;
    this.magnetGroup.scale.setScalar(pulse);
  }

  private animateStatusMaterials(elapsed: number, state: GameState): void {
    const gameover = state.phase === 'gameover';
    if (gameover) {
      this.headMaterial.opacity = 0.75;
      this.bodyMaterial.opacity = 0.7;
      this.headMaterial.emissiveIntensity = 0.28;
      this.bodyMaterial.emissiveIntensity = 0.24;
      return;
    }

    let opacity = 1;
    if (state.invulnerableTicks > 0) {
      opacity = 0.52 + 0.48 * (0.5 + 0.5 * Math.sin(elapsed * 22));
    }
    this.headMaterial.opacity = opacity;
    this.bodyMaterial.opacity = opacity;

    const speedActive = state.isDashing || state.boosters.speed.activeTicks > 0;
    const dashBoost = speedActive ? 0.52 + 0.24 * Math.sin(elapsed * 18) : 0;
    const chompBoost =
      state.chompStreak >= 2 && state.chompStreakTicks > 0
        ? 0.28 + 0.18 * Math.sin(elapsed * 20)
        : 0;
    const morphBoost =
      this.morphPulseTimer > 0
        ? 0.85 * Math.sin((this.morphPulseTimer / MORPH_PULSE_DURATION) * Math.PI)
        : 0;
    const sprayBoost = this.sprayVisualIntensity * (0.42 + 0.18 * Math.sin(elapsed * 24));
    const butterflyBoost =
      state.butterflyStage === 'butterfly' ? 0.36 + 0.18 * Math.sin(elapsed * 8.5) : 0;
    const livingPulse = 0.52 + 0.11 * Math.sin(elapsed * 3.8);

    this.headMaterial.emissiveIntensity =
      livingPulse + dashBoost + chompBoost + morphBoost + sprayBoost + butterflyBoost;
    this.bodyMaterial.emissiveIntensity =
      0.44 +
      0.08 * Math.sin(elapsed * 3.8) +
      dashBoost * 0.65 +
      chompBoost * 0.55 +
      morphBoost * 0.6 +
      butterflyBoost * 0.55;

    const accBoost = morphBoost * 0.55 + dashBoost * 0.35 + sprayBoost * 0.35;
    this.dragonMat.emissiveIntensity = 0.55 + accBoost;
    this.phoenixMat.emissiveIntensity = 0.6 + accBoost;
    this.unicornGoldMat.emissiveIntensity = 0.65 + accBoost;
    this.spiritLeafMat.emissiveIntensity = 0.5 + accBoost;
    this.flowerPetalMat.emissiveIntensity = 0.45 + accBoost;
  }

  private animateButterflyMetamorphosis(elapsed: number, dt: number, state: GameState): void {
    const stage = state.butterflyStage;

    // Visibility
    this.caterpillarRig.visible = stage === 'caterpillar';
    this.cocoonRig.visible = stage === 'cocoon';
    this.butterflyRig.visible = stage === 'butterfly';
    this.princessTiaraGroup.visible = stage === 'caterpillar' && state.phase !== 'gameover';
    if (this.princessTiaraGroup.visible) {
      this.princessTiaraGem.rotation.y = elapsed * 2.2;
      const tiaraPulse = 0.94 + 0.16 * Math.sin(elapsed * 5.2);
      this.princessTiaraGem.scale.set(tiaraPulse, 1.35 * tiaraPulse, 0.82 * tiaraPulse);
    }

    // Smoothly tint body & head to pearlescent pink in butterfly form; restore immediately in caterpillar
    if (stage === 'butterfly') {
      this.butterflyBodyTint = Math.min(1, this.butterflyBodyTint + dt * 9);
    } else if (stage === 'caterpillar') {
      this.butterflyBodyTint = 0;
    } else {
      this.butterflyBodyTint = Math.max(0, this.butterflyBodyTint - dt * 6);
    }

    const meta = FORM_METADATA[state.form];
    if (this.butterflyBodyTint > 0) {
      this.scratchColorA.setHex(meta.hexColor);
      this.bodyMaterial.color
        .copy(this.scratchColorA)
        .lerp(this.bflyBodyPinkColor, this.butterflyBodyTint);
      this.bodyMaterial.emissive
        .copy(this.scratchColorA)
        .lerp(this.bflyRoseColor, this.butterflyBodyTint);

      this.scratchColorB.setHex(0xffe4f5);
      this.headMaterial.color
        .copy(this.scratchColorB)
        .lerp(this.bflyHeadPearlColor, this.butterflyBodyTint);
      this.headMaterial.emissive
        .copy(this.scratchColorA)
        .lerp(this.bflyHeadGlowColor, this.butterflyBodyTint);
    } else {
      this.bodyMaterial.color.setHex(meta.hexColor);
      this.bodyMaterial.emissive.setHex(meta.hexColor);
      this.headMaterial.color.setHex(0xffe4f5);
      this.headMaterial.emissive.setHex(meta.hexColor);
    }

    if (stage === 'caterpillar') {
      // Bobbing pom-pom antennae
      const pomBob = Math.sin(elapsed * 7) * 0.14;
      this.catPomL.position.y = 0.6 + pomBob;
      this.catPomR.position.y = 0.6 - pomBob * 0.8;
      // Gentle pom-pom glow pulsing
      this.catPomPinkMat.emissiveIntensity = 0.5 + 0.3 * Math.sin(elapsed * 5);
      this.catPomCyanMat.emissiveIntensity = 0.5 + 0.3 * Math.cos(elapsed * 5);
    } else if (stage === 'cocoon') {
      // Counter-rotating golden silk rings
      this.cocoonRingA.rotation.y += dt * 2.8;
      this.cocoonRingB.rotation.y -= dt * 3.4;
      // Shimmer opacity pulse
      this.cocoonShellMat.opacity = 0.52 + 0.16 * Math.sin(elapsed * 6);
      this.cocoonShellMat.emissiveIntensity = 0.45 + 0.2 * Math.sin(elapsed * 8);
    } else if (stage === 'butterfly') {
      // Smooth graceful wing flap
      const flap = Math.sin(elapsed * 11.5) * 0.58;
      this.bflyLeftWingPivot.rotation.z = -flap;
      this.bflyRightWingPivot.rotation.z = flap;

      // Dreamy radiant Pink & Pearl-Sakura shimmer (rose 0xff5ec4 -> sakura 0xff8fd8 -> pearl 0xffb8eb)
      const waveA = 0.5 + 0.5 * Math.sin(elapsed * 3.1);
      const waveB = 0.5 + 0.5 * Math.cos(elapsed * 2.3);
      this.scratchColorA.copy(this.bflyRoseColor).lerp(this.bflySakuraColor, waveA);
      this.bflyWingMat.emissive.copy(this.scratchColorA).lerp(this.bflyPearlColor, waveB * 0.65);
      this.bflyWingMat.emissiveIntensity = 0.66 + 0.22 * (0.5 + 0.5 * Math.sin(elapsed * 5.2));

      this.bflyWingInnerMat.emissive
        .copy(this.bflyPearlColor)
        .lerp(this.bflySakuraColor, 1 - waveA);
      this.bflyWingInnerMat.emissiveIntensity = 0.7 + 0.18 * (0.5 + 0.5 * Math.cos(elapsed * 4.4));
      this.bflyWingRimMat.emissiveIntensity = 0.72 + 0.2 * waveA;
      this.bflySpotCyanMat.emissiveIntensity = 0.78 + 0.32 * (0.5 + 0.5 * Math.sin(elapsed * 6.5));
      this.bflySpotGoldMat.emissiveIntensity = 0.76 + 0.24 * waveB;

      // Glowing star-tip antennae & crystal tiara pulse
      const starScale = 1 + 0.35 * Math.sin(elapsed * 9);
      this.bflyAntennaStarL.scale.setScalar(starScale);
      this.bflyAntennaStarR.scale.setScalar(starScale);
      this.bflyAntennaStarL.rotation.y = elapsed * 3.2;
      this.bflyAntennaStarR.rotation.y = -elapsed * 3.2;
      this.bflyAntennaStarMat.emissiveIntensity = 0.78 + 0.34 * Math.sin(elapsed * 7);
      this.bflyTiaraCenterGem.rotation.y = elapsed * 2.4;
      const tiaraPulse = 1 + 0.18 * Math.cos(elapsed * 6.2);
      this.bflyTiaraCenterGem.scale.set(tiaraPulse, 1.45 * tiaraPulse, 0.85 * tiaraPulse);
    }
  }
}
