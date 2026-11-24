import {
  AdditiveBlending,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PointLight,
  RingGeometry,
  Shape,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Scene,
} from 'three';
import { FORM_METADATA } from '../core/config';
import type { GameState, SnakeForm } from '../core/types';

/** Base hover height (world Y) of the pixie's feet when barely lifted. */
export const PRINCESS_BASE_Y = 0.5;
/** Extra height gained at full fairy altitude. */
export const PRINCESS_LIFT = 3.2;
/** Model scale of the Fairy Pixie. */
export const PRINCESS_SCALE = 2.25;
/** Local model height (slippers → hair bun) before scaling. */
const PRINCESS_MODEL_HEIGHT = 2.08;

const FX_PILLAR_HEIGHT = 10;
const HELIX_STAR_COUNT = 18;
const PETAL_COUNT = 8;
const PIXIE_DUST_COUNT = 16;
const SKIRT_OUTER_COUNT = 10;
const SKIRT_INNER_COUNT = 10;
const BLOOM_DURATION = 1.35;
const TELEPORT_SNAP_DIST_SQ = 16;

const RIBBON_COLORS: readonly number[] = [0xffd84d, 0x6ef29a, 0xff8ed4];

// Lush Tinker-pixie palette: vibrant spring leaf greens, sunlit honey-blonde hair, sapphire-aqua eyes
const LEAF_BRIGHT = 0x7be856;
const LEAF_EMERALD = 0x2fb84d;
const LEAF_TIP_GOLD = 0xc8f764;
const HAIR_HONEY = 0xffdf6b;
const HAIR_HIGHLIGHT = 0xfff0a6;
const GLOW_GOLD = 0xffe9a0;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function easeOutBack(t: number): number {
  const c1 = 1.55;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function normalizeAngle(rad: number): number {
  let a = rad % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Continuous 0..1 snake→fairy morph factor (0 = snake, 1 = fully fairy),
 * interpolated between simulation ticks with `alpha` for silky 60fps visuals.
 */
export function princessMorphFactor(state: GameState, alpha = 0): number {
  const stage = state.princessStage ?? 'snake';
  if (stage === 'snake') return 0;
  if (stage === 'princess') return 1;
  const max = Math.max(1, state.princessMaxTicks);
  const progress = clamp01((max - state.princessTicks + clamp01(alpha)) / max);
  return stage === 'transforming' ? progress : 1 - progress;
}

/** Progress (0..1) of the currently playing transformation or return animation. */
export function princessStageProgress(state: GameState, alpha = 0): number {
  const stage = state.princessStage ?? 'snake';
  if (stage !== 'transforming' && stage !== 'returning') return 0;
  const max = Math.max(1, state.princessMaxTicks);
  return clamp01((max - state.princessTicks + clamp01(alpha)) / max);
}

/** World height of the fairy's head top (for nameplate placement). */
export function princessHeadHeight(morph: number): number {
  return PRINCESS_BASE_Y + morph * PRINCESS_LIFT + PRINCESS_MODEL_HEIGHT * PRINCESS_SCALE;
}

/** Sculpted sweeping pixie forewing / hindwing with thin crystal bevel. */
function createSculptedWingGeometry(span: number, chord: number, depth = 0.016): ExtrudeGeometry {
  const s = new Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(span * 0.24, chord * 0.72, span * 0.68, chord * 0.96, span * 0.98, chord * 0.48);
  s.bezierCurveTo(
    span * 1.08,
    chord * 0.12,
    span * 0.82,
    -chord * 0.28,
    span * 0.38,
    -chord * 0.22,
  );
  s.bezierCurveTo(span * 0.16, -chord * 0.16, span * 0.05, -chord * 0.06, 0, 0);
  return new ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.006,
    bevelSegments: 1,
    curveSegments: 18,
  });
}

/** Delicate raised filigree rib inside a pixie wing. */
function createWingFiligreeGeometry(
  length: number,
  arch: number,
  thickness: number,
): ExtrudeGeometry {
  const s = new Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(length * 0.5, arch, length, arch * 0.32);
  s.quadraticCurveTo(length * 0.52, arch - thickness, 0, -thickness * 0.6);
  s.closePath();
  return new ExtrudeGeometry(s, {
    depth: 0.012,
    bevelEnabled: false,
    curveSegments: 12,
  });
}

/** Sculpted 3D pointed leaf petal hanging downward from (0, 0) to (0, -length). */
function createSculptedLeafGeometry(width: number, length: number): ExtrudeGeometry {
  const s = new Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(width * 1.05, -length * 0.28, width * 0.92, -length * 0.68, 0, -length);
  s.bezierCurveTo(-width * 0.92, -length * 0.68, -width * 1.05, -length * 0.28, 0, 0);
  return new ExtrudeGeometry(s, {
    depth: 0.018,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.006,
    bevelSegments: 1,
    curveSegments: 10,
  });
}

/** Fluttering satin ribbon tail hanging from the hair bow. */
function createRibbonTailGeometry(width: number, length: number): ExtrudeGeometry {
  const s = new Shape();
  s.moveTo(-width * 0.45, 0);
  s.quadraticCurveTo(-width * 0.9, -length * 0.55, -width * 0.55, -length);
  s.lineTo(0, -length * 0.82);
  s.lineTo(width * 0.55, -length);
  s.quadraticCurveTo(width * 0.9, -length * 0.55, width * 0.45, 0);
  s.closePath();
  return new ExtrudeGeometry(s, {
    depth: 0.01,
    bevelEnabled: false,
    curveSegments: 8,
  });
}

/**
 * 3D Fairy Pixie form of the player's snake — a luminous, expressive pixie
 * with a sculpted 3D leaf-petal dress, honey-blonde top-bun with fluttering
 * satin ribbon tails, big sparkling sapphire-aqua eyes that blink naturally,
 * four iridescent filigree wings with phase-lagged flutter, and critically
 * damped 60/120fps flight physics with overlapping secondary motion.
 *
 * Zero per-frame heap allocations inside `draw()`; full cleanup in `dispose()`.
 */
export class PrincessFairy3DView {
  private readonly root = new Group();

  // Articulated fairy rig
  private readonly princessGroup = new Group();
  private readonly bodyGroup = new Group();
  private readonly headPivot = new Group();
  private readonly leftEyeGroup = new Group();
  private readonly rightEyeGroup = new Group();
  private readonly leftPupilGroup = new Group();
  private readonly rightPupilGroup = new Group();
  private readonly sideLockL = new Group();
  private readonly sideLockR = new Group();
  private readonly bunGroup = new Group();
  private readonly ribbonTailL = new Group();
  private readonly ribbonTailR = new Group();
  private readonly wingUpperL = new Group();
  private readonly wingUpperR = new Group();
  private readonly wingLowerL = new Group();
  private readonly wingLowerR = new Group();
  private readonly leftArm = new Group();
  private readonly leftElbow = new Group();
  private readonly rightArm = new Group();
  private readonly rightElbow = new Group();
  private readonly handSparkle: Mesh<OctahedronGeometry, MeshBasicMaterial>;
  private readonly legFront = new Group();
  private readonly kneeFront = new Group();
  private readonly legBack = new Group();
  private readonly kneeBack = new Group();
  private readonly skirtGroup = new Group();
  private readonly outerSkirtLeaves: Group[] = [];
  private readonly innerSkirtLeaves: Group[] = [];

  private glowSprite: Sprite | null = null;
  private glowTexture: CanvasTexture | null = null;
  private readonly glowSpriteMat = new SpriteMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.72,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  private readonly pixieDust: Mesh[] = [];
  private readonly glowLight: PointLight;
  private readonly groundGlow: Mesh<CircleGeometry, MeshBasicMaterial>;

  // Transformation FX
  private readonly fxGroup = new Group();
  private readonly pillarOuter: Mesh<CylinderGeometry, MeshBasicMaterial>;
  private readonly pillarInner: Mesh<CylinderGeometry, MeshBasicMaterial>;
  private readonly runeGroup = new Group();
  private readonly ribbons: Mesh<TorusGeometry, MeshBasicMaterial>[] = [];
  private readonly helixStars: Mesh<OctahedronGeometry, MeshBasicMaterial>[] = [];
  private readonly flashSphere: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly petalPivots: Group[] = [];
  private readonly petalGroup = new Group();

  // Materials
  private readonly leafLightMat = new MeshStandardMaterial({
    color: LEAF_BRIGHT,
    emissive: 0x3eb835,
    emissiveIntensity: 0.28,
    roughness: 0.34,
    metalness: 0.06,
    side: DoubleSide,
  });
  private readonly leafDeepMat = new MeshStandardMaterial({
    color: LEAF_EMERALD,
    emissive: 0x1b7d32,
    emissiveIntensity: 0.28,
    roughness: 0.38,
    metalness: 0.08,
    side: DoubleSide,
  });
  private readonly leafGoldMat = new MeshStandardMaterial({
    color: LEAF_TIP_GOLD,
    emissive: 0xffd24c,
    emissiveIntensity: 0.58,
    roughness: 0.22,
    metalness: 0.32,
  });
  private readonly skinMat = new MeshStandardMaterial({
    color: 0xffe4d4,
    emissive: 0xffb89e,
    emissiveIntensity: 0.2,
    roughness: 0.44,
  });
  private readonly hairMat = new MeshStandardMaterial({
    color: HAIR_HONEY,
    emissive: 0xffb72b,
    emissiveIntensity: 0.32,
    roughness: 0.3,
    metalness: 0.1,
  });
  private readonly hairHighlightMat = new MeshStandardMaterial({
    color: HAIR_HIGHLIGHT,
    emissive: 0xffd45e,
    emissiveIntensity: 0.42,
    roughness: 0.26,
    metalness: 0.14,
  });
  private readonly ribbonMat = new MeshStandardMaterial({
    color: 0xff5ec4,
    emissive: 0xff5ec4,
    emissiveIntensity: 0.55,
    roughness: 0.26,
    side: DoubleSide,
  });
  private readonly pomMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfff5d6,
    emissiveIntensity: 0.52,
    roughness: 0.5,
  });
  private readonly scleraMat = new MeshBasicMaterial({ color: 0xfffaf7 });
  private readonly irisDeepMat = new MeshBasicMaterial({ color: 0x1e78ff });
  private readonly irisGlowMat = new MeshBasicMaterial({ color: 0x7ef4ff });
  private readonly pupilMat = new MeshBasicMaterial({ color: 0x0e1738 });
  private readonly catchlightMat = new MeshBasicMaterial({ color: 0xffffff });
  private readonly lashMat = new MeshBasicMaterial({ color: 0x3b2214 });
  private readonly browMat = new MeshBasicMaterial({ color: 0xb8781e });
  private readonly blushMat = new MeshBasicMaterial({
    color: 0xff82b2,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  private readonly smileMat = new MeshBasicMaterial({ color: 0xe64978 });
  private readonly wingOuterMat = new MeshStandardMaterial({
    color: 0xe4fcff,
    emissive: 0x9ef3ff,
    emissiveIntensity: 0.62,
    transparent: true,
    opacity: 0.52,
    side: DoubleSide,
    roughness: 0.08,
    metalness: 0.18,
    depthWrite: false,
  });
  private readonly wingInnerMat = new MeshStandardMaterial({
    color: 0xfff0fa,
    emissive: 0xffb8eb,
    emissiveIntensity: 0.68,
    transparent: true,
    opacity: 0.42,
    side: DoubleSide,
    roughness: 0.1,
    metalness: 0.22,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  private readonly wingFiligreeMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfff2b2,
    emissiveIntensity: 0.85,
    transparent: true,
    opacity: 0.86,
    roughness: 0.14,
    metalness: 0.3,
    depthWrite: false,
  });
  private readonly pixieDustMat = new MeshBasicMaterial({
    color: 0xfff2a6,
    transparent: true,
    opacity: 0.95,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  private readonly groundGlowMat = new MeshBasicMaterial({
    color: GLOW_GOLD,
    transparent: true,
    opacity: 0,
    side: DoubleSide,
    depthWrite: false,
  });
  private readonly pillarOuterMat = new MeshBasicMaterial({
    color: 0xffe9a0,
    transparent: true,
    opacity: 0,
    side: DoubleSide,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  private readonly pillarInnerMat = new MeshBasicMaterial({
    color: 0xfff8e1,
    transparent: true,
    opacity: 0,
    side: DoubleSide,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  private readonly runeMat = new MeshBasicMaterial({
    color: 0xffe885,
    transparent: true,
    opacity: 0,
    side: DoubleSide,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  private readonly ribbonMats: MeshBasicMaterial[] = [];
  private readonly helixStarMat = new MeshBasicMaterial({
    color: 0xfff3a8,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  private readonly flashMat = new MeshBasicMaterial({
    color: 0xfff4c8,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  private readonly petalMat = new MeshStandardMaterial({
    color: LEAF_BRIGHT,
    emissive: 0x4fc23c,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0,
    side: DoubleSide,
    roughness: 0.28,
    depthWrite: false,
  });

  // Shared geometries & scratch colors
  private readonly sparkleGeo = new OctahedronGeometry(0.062, 0);
  private readonly helixStarGeo = new OctahedronGeometry(0.16, 0);
  private readonly petalGeo = new SphereGeometry(0.6, 12, 10);
  private readonly wingAquaColor = new Color(0x8cf6ff);
  private readonly wingMintColor = new Color(0xa6ffcb);
  private readonly wingPearlColor = new Color(0xffc8f0);
  private readonly scratchWingColor = new Color();

  // Dynamic 60/120fps smoothed flight state
  private readonly smoothPos = new Vector3();
  private readonly princessWorldPos = new Vector3();
  private hasSmoothPos = false;
  private smoothSpeed = 0;
  private smoothTourClimb = 0;
  private currentYaw = 0;
  private yawVel = 0;
  private hasYaw = false;
  private smoothBank = 0;
  private smoothPitch = 0.2;
  private smoothLookSide = 0;
  private smoothLookFront = 0.5;
  private headTopWorldY = PRINCESS_BASE_Y + PRINCESS_MODEL_HEIGHT * PRINCESS_SCALE;

  private activeForm: SnakeForm | null = null;
  private lastStage: GameState['princessStage'] = 'snake';
  private bloomTimer = 0;
  private visible = false;

  constructor(private readonly scene: Scene) {
    this.handSparkle = new Mesh(this.sparkleGeo, this.pixieDustMat);
    this.buildFairyModel();

    this.glowLight = new PointLight(0xffe2a0, 0, 9.5, 1.6);
    this.glowLight.position.set(0, 1.25, 0.2);
    this.princessGroup.add(this.glowLight);

    this.groundGlow = new Mesh(new CircleGeometry(1.5, 28), this.groundGlowMat);
    this.groundGlow.rotation.x = -Math.PI / 2;
    this.groundGlow.position.y = 0.03;
    this.groundGlow.visible = false;

    // --- Transformation FX ---
    this.pillarOuter = new Mesh(
      new CylinderGeometry(1.3, 1.7, FX_PILLAR_HEIGHT, 28, 1, true),
      this.pillarOuterMat,
    );
    this.pillarOuter.position.y = FX_PILLAR_HEIGHT / 2;
    this.pillarInner = new Mesh(
      new CylinderGeometry(0.5, 0.7, FX_PILLAR_HEIGHT, 20, 1, true),
      this.pillarInnerMat,
    );
    this.pillarInner.position.y = FX_PILLAR_HEIGHT / 2;
    this.fxGroup.add(this.pillarOuter, this.pillarInner);

    // Magic rune circle on the ground
    const runeOuter = new Mesh(new RingGeometry(2.2, 2.45, 64), this.runeMat);
    const runeMid = new Mesh(new RingGeometry(1.55, 1.68, 6), this.runeMat);
    const runeMid2 = new Mesh(new RingGeometry(1.55, 1.68, 6), this.runeMat);
    runeMid2.rotation.z = Math.PI / 6;
    const runeInner = new Mesh(new RingGeometry(0.85, 0.95, 48), this.runeMat);
    this.runeGroup.add(runeOuter, runeMid, runeMid2, runeInner);
    const runeDotGeo = new CircleGeometry(0.14, 10);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const dot = new Mesh(runeDotGeo, this.runeMat);
      dot.position.set(Math.cos(a) * 1.95, Math.sin(a) * 1.95, 0);
      this.runeGroup.add(dot);
    }
    this.runeGroup.rotation.x = -Math.PI / 2;
    this.runeGroup.position.y = 0.05;
    this.fxGroup.add(this.runeGroup);

    // Rising ribbon rings (golden pixie dust, spring mint, rose pink)
    const ribbonGeo = new TorusGeometry(1.45, 0.062, 8, 48);
    for (const hex of RIBBON_COLORS) {
      const mat = new MeshBasicMaterial({
        color: hex,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      this.ribbonMats.push(mat);
      const ribbon = new Mesh(ribbonGeo, mat);
      ribbon.rotation.x = Math.PI / 2;
      this.ribbons.push(ribbon);
      this.fxGroup.add(ribbon);
    }

    // Double helix of rising stars
    for (let i = 0; i < HELIX_STAR_COUNT; i++) {
      const star = new Mesh(this.helixStarGeo, this.helixStarMat);
      this.helixStars.push(star);
      this.fxGroup.add(star);
    }

    // Reveal flash sphere
    this.flashSphere = new Mesh(new SphereGeometry(1, 24, 18), this.flashMat);
    this.flashSphere.visible = false;
    this.fxGroup.add(this.flashSphere);

    // Leaf bud that wraps around and then blooms open to reveal the pixie
    for (let i = 0; i < PETAL_COUNT; i++) {
      const pivot = new Group();
      pivot.rotation.order = 'YXZ';
      pivot.rotation.y = (i / PETAL_COUNT) * Math.PI * 2;
      const petal = new Mesh(this.petalGeo, this.petalMat);
      petal.scale.set(0.5, 0.08, 1.3);
      petal.position.set(0, 0, 0.78);
      pivot.add(petal);
      this.petalPivots.push(pivot);
      this.petalGroup.add(pivot);
    }
    this.fxGroup.add(this.petalGroup);

    this.fxGroup.visible = false;
    this.princessGroup.visible = false;

    this.root.add(this.princessGroup, this.groundGlow, this.fxGroup);
    this.scene.add(this.root);
  }

  private buildFairyModel(): void {
    // 1. Smooth articulated legs with rounded knee joints, leaf slippers & fluffy pom-poms
    const hipJointGeo = new SphereGeometry(0.058, 10, 8);
    const thighGeo = new CylinderGeometry(0.058, 0.046, 0.35, 12);
    const kneeJointGeo = new SphereGeometry(0.045, 10, 8);
    const shinGeo = new CylinderGeometry(0.044, 0.032, 0.35, 12);
    const slipperGeo = new SphereGeometry(0.068, 12, 10);
    const slipperCuffGeo = new TorusGeometry(0.036, 0.011, 6, 12);
    const pomGeo = new SphereGeometry(0.042, 10, 8);

    const buildLeg = (leg: Group, knee: Group, side: number): void => {
      leg.position.set(side * 0.068, 0.8, 0);
      const hipJoint = new Mesh(hipJointGeo, this.skinMat);
      const thigh = new Mesh(thighGeo, this.skinMat);
      thigh.position.y = -0.175;
      leg.add(hipJoint, thigh);

      knee.position.y = -0.35;
      const kneeBall = new Mesh(kneeJointGeo, this.skinMat);
      const shin = new Mesh(shinGeo, this.skinMat);
      shin.position.y = -0.175;
      const cuff = new Mesh(slipperCuffGeo, this.leafLightMat);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.set(0, -0.33, 0.01);
      const slipper = new Mesh(slipperGeo, this.leafDeepMat);
      slipper.scale.set(0.86, 0.65, 1.68);
      slipper.rotation.x = 0.16;
      slipper.position.set(0, -0.37, 0.045);
      const pom = new Mesh(pomGeo, this.pomMat);
      pom.position.set(0, -0.345, 0.155);
      knee.add(kneeBall, shin, cuff, slipper, pom);
      leg.add(knee);
      this.bodyGroup.add(leg);
    };
    buildLeg(this.legFront, this.kneeFront, -1);
    buildLeg(this.legBack, this.kneeBack, 1);

    // 2. Sculpted 3D multi-layered leaf-petal skirt with individually rippling petals
    const outerLeafGeo = createSculptedLeafGeometry(0.125, 0.46);
    const innerLeafGeo = createSculptedLeafGeometry(0.11, 0.38);
    this.skirtGroup.position.y = 0.96;

    for (let i = 0; i < SKIRT_INNER_COUNT; i++) {
      const a = (i / SKIRT_INNER_COUNT) * Math.PI * 2 + Math.PI / SKIRT_INNER_COUNT;
      const pivot = new Group();
      pivot.rotation.order = 'YXZ';
      pivot.rotation.y = a;
      pivot.rotation.x = -0.38;
      pivot.position.set(Math.sin(a) * 0.12, 0.02, Math.cos(a) * 0.12);
      const leaf = new Mesh(innerLeafGeo, this.leafDeepMat);
      pivot.add(leaf);
      this.innerSkirtLeaves.push(pivot);
      this.skirtGroup.add(pivot);
    }

    for (let i = 0; i < SKIRT_OUTER_COUNT; i++) {
      const a = (i / SKIRT_OUTER_COUNT) * Math.PI * 2;
      const pivot = new Group();
      pivot.rotation.order = 'YXZ';
      pivot.rotation.y = a;
      pivot.rotation.x = -0.54;
      pivot.position.set(Math.sin(a) * 0.128, -0.01, Math.cos(a) * 0.128);
      const leaf = new Mesh(outerLeafGeo, this.leafLightMat);
      pivot.add(leaf);
      this.outerSkirtLeaves.push(pivot);
      this.skirtGroup.add(pivot);
    }
    this.bodyGroup.add(this.skirtGroup);

    // 3. Sculpted sweetheart leaf-corset bodice & golden dewdrop vine belt
    const hips = new Mesh(new SphereGeometry(0.135, 14, 12), this.leafDeepMat);
    hips.scale.set(1.04, 0.78, 0.96);
    hips.position.y = 0.92;
    this.bodyGroup.add(hips);

    const bodice = new Mesh(new CylinderGeometry(0.108, 0.132, 0.36, 16), this.leafLightMat);
    bodice.scale.set(1.04, 1, 0.88);
    bodice.position.y = 1.13;
    this.bodyGroup.add(bodice);

    const vineBelt = new Mesh(new TorusGeometry(0.132, 0.02, 8, 22), this.leafDeepMat);
    vineBelt.scale.set(1.04, 0.92, 1);
    vineBelt.rotation.x = Math.PI / 2;
    vineBelt.position.y = 0.97;
    this.bodyGroup.add(vineBelt);

    const dewdropGeo = new OctahedronGeometry(0.032, 0);
    for (const side of [-1, 0, 1] as const) {
      const gem = new Mesh(dewdropGeo, this.leafGoldMat);
      gem.position.set(side * 0.075, 0.97, side === 0 ? 0.145 : 0.125);
      gem.scale.set(1, 1.25, 0.8);
      this.bodyGroup.add(gem);
    }

    const sweetheartLeafGeo = createSculptedLeafGeometry(0.068, 0.17);
    for (const side of [-1, 1] as const) {
      const cup = new Mesh(sweetheartLeafGeo, this.leafDeepMat);
      cup.rotation.z = Math.PI + side * 0.32;
      cup.position.set(side * 0.052, 1.27, 0.098);
      this.bodyGroup.add(cup);
    }

    // Dainty shoulders & collarbone
    const chest = new Mesh(new SphereGeometry(0.105, 14, 12), this.skinMat);
    chest.scale.set(1.55, 0.68, 0.88);
    chest.position.set(0, 1.33, 0.005);
    this.bodyGroup.add(chest);

    const neck = new Mesh(new CylinderGeometry(0.042, 0.048, 0.15, 12), this.skinMat);
    neck.position.set(0, 1.42, 0.005);
    this.bodyGroup.add(neck);

    // 4. Smoothly jointed balletic arms (shoulder ball → upper arm → elbow ball → forearm → hand)
    const shoulderGeo = new SphereGeometry(0.044, 10, 8);
    const upperArmGeo = new CylinderGeometry(0.038, 0.032, 0.27, 10);
    const elbowGeo = new SphereGeometry(0.033, 10, 8);
    const foreArmGeo = new CylinderGeometry(0.031, 0.025, 0.26, 10);
    const handGeo = new SphereGeometry(0.036, 10, 8);

    const buildArm = (shoulder: Group, elbow: Group, side: number): Mesh => {
      shoulder.position.set(side * 0.158, 1.33, 0.005);
      shoulder.rotation.order = 'ZYX';
      const sBall = new Mesh(shoulderGeo, this.skinMat);
      const upper = new Mesh(upperArmGeo, this.skinMat);
      upper.position.y = -0.135;
      shoulder.add(sBall, upper);

      elbow.position.y = -0.27;
      elbow.rotation.order = 'ZYX';
      const eBall = new Mesh(elbowGeo, this.skinMat);
      const fore = new Mesh(foreArmGeo, this.skinMat);
      fore.position.y = -0.13;
      const hand = new Mesh(handGeo, this.skinMat);
      hand.scale.set(0.9, 1.25, 0.72);
      hand.position.y = -0.27;
      elbow.add(eBall, fore, hand);
      shoulder.add(elbow);
      this.bodyGroup.add(shoulder);
      return hand;
    };
    buildArm(this.leftArm, this.leftElbow, -1);
    buildArm(this.rightArm, this.rightElbow, 1);

    // Twinkling golden pixie-dust starlight floating just off her right fingertips
    this.handSparkle.position.set(0, -0.35, 0.05);
    this.rightElbow.add(this.handSparkle);

    // 5. Adorable Chibi-Pixie Head: big sapphire-aqua eyes, lashes, brows, nose, blush & ears
    this.headPivot.position.set(0, 1.65, 0.015);
    this.headPivot.rotation.order = 'YXZ';
    const head = new Mesh(new SphereGeometry(0.275, 24, 20), this.skinMat);
    head.scale.set(1.02, 1.0, 0.96);
    this.headPivot.add(head);

    // Tiny cute button nose
    const nose = new Mesh(new SphereGeometry(0.021, 10, 8), this.skinMat);
    nose.scale.set(0.95, 0.85, 1.15);
    nose.position.set(0, -0.042, 0.266);
    this.headPivot.add(nose);

    const scleraGeo = new SphereGeometry(0.072, 14, 12);
    const irisGeo = new SphereGeometry(0.058, 14, 12);
    const lowerGlowGeo = new SphereGeometry(0.042, 12, 10);
    const pupilGeo = new SphereGeometry(0.032, 10, 10);
    const sparkBigGeo = new SphereGeometry(0.02, 8, 8);
    const sparkSmallGeo = new SphereGeometry(0.011, 6, 6);
    const lashArchGeo = new TorusGeometry(0.068, 0.013, 6, 14, Math.PI * 1.06);
    const lashWingGeo = new ConeGeometry(0.015, 0.052, 6);
    const browGeo = new TorusGeometry(0.062, 0.0075, 6, 12, Math.PI * 0.72);
    const earGeo = new ConeGeometry(0.048, 0.21, 10);

    for (const side of [-1, 1] as const) {
      const eyeGroup = side < 0 ? this.leftEyeGroup : this.rightEyeGroup;
      const pupilGrp = side < 0 ? this.leftPupilGroup : this.rightPupilGroup;
      eyeGroup.position.set(side * 0.102, -0.008, 0.228);
      eyeGroup.rotation.y = side * 0.24;

      const sclera = new Mesh(scleraGeo, this.scleraMat);
      sclera.scale.set(0.92, 1.04, 0.38);

      const iris = new Mesh(irisGeo, this.irisDeepMat);
      iris.scale.set(0.92, 1.05, 0.38);
      iris.position.set(0, -0.004, 0.014);

      const lowerGlow = new Mesh(lowerGlowGeo, this.irisGlowMat);
      lowerGlow.scale.set(0.95, 0.68, 0.36);
      lowerGlow.position.set(0, -0.022, 0.022);

      const pupil = new Mesh(pupilGeo, this.pupilMat);
      pupil.scale.set(0.9, 1.05, 0.38);
      pupil.position.set(0, 0.002, 0.026);

      const sparkBig = new Mesh(sparkBigGeo, this.catchlightMat);
      sparkBig.scale.set(1, 1, 0.45);
      sparkBig.position.set(side * -0.014 + 0.016, 0.026, 0.035);

      const sparkSmall = new Mesh(sparkSmallGeo, this.catchlightMat);
      sparkSmall.scale.set(1, 1, 0.45);
      sparkSmall.position.set(-0.018, -0.024, 0.035);

      pupilGrp.add(iris, lowerGlow, pupil, sparkBig, sparkSmall);

      // Thick curved upper eyelash hugging the top of the eye + cute winged outer tip
      const lash = new Mesh(lashArchGeo, this.lashMat);
      lash.scale.set(0.98, 1.06, 0.55);
      lash.rotation.z = -0.03 * side;
      lash.position.set(0, 0.006, 0.019);

      const wingTip = new Mesh(lashWingGeo, this.lashMat);
      wingTip.position.set(side * 0.068, 0.028, 0.014);
      wingTip.rotation.z = -side * 1.05;

      eyeGroup.add(sclera, pupilGrp, lash, wingTip);
      this.headPivot.add(eyeGroup);

      // Delicate golden-brown arched eyebrow
      const brow = new Mesh(browGeo, this.browMat);
      brow.position.set(side * 0.104, 0.088, 0.228);
      brow.rotation.y = side * 0.24;
      brow.rotation.z = 0.44 - side * 0.08;
      this.headPivot.add(brow);

      // Rosy coral-pink blush + cute cheek sheen
      const blush = new Mesh(new SphereGeometry(0.048, 10, 8), this.blushMat);
      blush.scale.set(1.38, 0.62, 0.3);
      blush.position.set(side * 0.162, -0.078, 0.205);
      blush.rotation.y = side * 0.38;
      this.headPivot.add(blush);

      // Tapered pointed pixie ear
      const ear = new Mesh(earGeo, this.skinMat);
      ear.scale.set(1, 1, 0.46);
      ear.position.set(side * 0.285, 0.022, -0.015);
      ear.rotation.z = -side * 1.12;
      ear.rotation.y = side * 0.32;
      this.headPivot.add(ear);
    }

    // Sweet rosebud smile
    const smile = new Mesh(new TorusGeometry(0.042, 0.0095, 6, 14, Math.PI * 0.88), this.smileMat);
    smile.rotation.z = Math.PI * 1.06;
    smile.position.set(0, -0.102, 0.248);
    this.headPivot.add(smile);

    // 6. Lush honey-blonde pixie hair: sculpted crown, sweeping bangs, side wisps & ribbon top-bun
    const hairCrown = new Mesh(
      new SphereGeometry(0.296, 22, 18, 0, Math.PI * 2, 0, Math.PI * 0.56),
      this.hairMat,
    );
    hairCrown.position.set(0, 0.032, -0.022);
    hairCrown.rotation.x = -0.38;
    this.headPivot.add(hairCrown);

    const hairBack = new Mesh(new SphereGeometry(0.288, 18, 14), this.hairMat);
    hairBack.scale.set(1.04, 1.02, 0.98);
    hairBack.position.set(0, -0.005, -0.058);
    this.headPivot.add(hairBack);

    // Sweeping side-parted bangs across forehead (layered golden & sunlit locks)
    const bangMainGeo = new SphereGeometry(0.145, 14, 10);
    const bangSweep = new Mesh(bangMainGeo, this.hairMat);
    bangSweep.scale.set(1.38, 0.52, 0.68);
    bangSweep.position.set(-0.045, 0.185, 0.178);
    bangSweep.rotation.set(0.18, -0.12, 0.32);

    const bangHighlight = new Mesh(bangMainGeo, this.hairHighlightMat);
    bangHighlight.scale.set(1.05, 0.38, 0.58);
    bangHighlight.position.set(-0.02, 0.205, 0.195);
    bangHighlight.rotation.set(0.15, -0.1, 0.34);

    const bangSideR = new Mesh(bangMainGeo, this.hairMat);
    bangSideR.scale.set(0.95, 0.46, 0.62);
    bangSideR.position.set(0.135, 0.175, 0.158);
    bangSideR.rotation.set(0.16, 0.22, -0.42);
    this.headPivot.add(bangSweep, bangHighlight, bangSideR);

    // Tiny sparkling starlight hair clip tucked on her side-swept bangs
    const hairStar = new Mesh(new OctahedronGeometry(0.036, 0), this.leafGoldMat);
    hairStar.position.set(-0.185, 0.145, 0.195);
    hairStar.rotation.z = 0.35;
    this.headPivot.add(hairStar);

    // Cheek-framing curled side locks right in front of her pixie ears
    const sideLockGeo = createSculptedLeafGeometry(0.046, 0.25);
    for (const side of [-1, 1] as const) {
      const lockPivot = side < 0 ? this.sideLockL : this.sideLockR;
      lockPivot.position.set(side * 0.235, 0.105, 0.085);
      const lock = new Mesh(sideLockGeo, this.hairMat);
      lock.rotation.y = side * 0.55;
      lock.rotation.z = side * 0.14;
      lockPivot.add(lock);
      this.headPivot.add(lockPivot);
    }

    // High plump pixie puff-bun with satin bow & fluttering ribbon tails
    this.bunGroup.position.set(0, 0.305, -0.085);
    const bunPuff = new Mesh(new SphereGeometry(0.152, 16, 14), this.hairMat);
    bunPuff.scale.set(1.05, 0.94, 1.02);
    bunPuff.position.y = 0.078;

    const bunHighlight = new Mesh(new SphereGeometry(0.115, 12, 10), this.hairHighlightMat);
    bunHighlight.scale.set(1.0, 0.72, 0.85);
    bunHighlight.position.set(-0.02, 0.125, 0.045);

    const bunBand = new Mesh(new TorusGeometry(0.098, 0.024, 8, 20), this.ribbonMat);
    bunBand.rotation.x = Math.PI / 2 - 0.15;
    bunBand.position.y = -0.015;

    const bowLoopGeo = new SphereGeometry(0.056, 10, 8);
    const bowKnot = new Mesh(new SphereGeometry(0.028, 8, 8), this.ribbonMat);
    bowKnot.position.set(0, -0.01, -0.102);
    for (const side of [-1, 1] as const) {
      const loop = new Mesh(bowLoopGeo, this.ribbonMat);
      loop.scale.set(1.45, 0.82, 0.45);
      loop.position.set(side * 0.082, -0.005, -0.098);
      loop.rotation.z = side * 0.22;
      loop.rotation.y = -side * 0.25;
      this.bunGroup.add(loop);
    }

    const tailGeo = createRibbonTailGeometry(0.042, 0.26);
    this.ribbonTailL.position.set(-0.035, -0.02, -0.105);
    this.ribbonTailR.position.set(0.035, -0.02, -0.105);
    const tailMeshL = new Mesh(tailGeo, this.ribbonMat);
    tailMeshL.rotation.z = -0.22;
    const tailMeshR = new Mesh(tailGeo, this.ribbonMat);
    tailMeshR.rotation.z = 0.22;
    this.ribbonTailL.add(tailMeshL);
    this.ribbonTailR.add(tailMeshR);

    this.bunGroup.add(bunPuff, bunHighlight, bunBand, bowKnot, this.ribbonTailL, this.ribbonTailR);
    this.headPivot.add(this.bunGroup);
    this.bodyGroup.add(this.headPivot);

    // 7. Four sweeping iridescent filigree pixie wings (forewings + hindwings)
    const upperGeo = createSculptedWingGeometry(1.36, 0.58);
    const lowerGeo = createSculptedWingGeometry(0.92, 0.42);
    const upperVeilGeo = createSculptedWingGeometry(0.96, 0.38, 0.008);
    const lowerVeilGeo = createSculptedWingGeometry(0.64, 0.27, 0.008);
    const ribLongGeo = createWingFiligreeGeometry(1.12, 0.34, 0.022);
    const ribMidGeo = createWingFiligreeGeometry(0.84, 0.14, 0.018);
    const ribLowerGeo = createWingFiligreeGeometry(0.72, 0.18, 0.018);
    const wingGemGeo = new OctahedronGeometry(0.038, 0);

    for (const side of [-1, 1] as const) {
      const upperPivot = side < 0 ? this.wingUpperL : this.wingUpperR;
      upperPivot.position.set(side * 0.055, 1.29, -0.105);
      upperPivot.rotation.order = 'ZYX';

      const upperTilt = new Group();
      upperTilt.rotation.order = 'YXZ';
      upperTilt.rotation.y = -side * 0.28;
      upperTilt.rotation.x = -0.72;
      upperTilt.rotation.z = side * 0.18;

      const uOuter = new Mesh(upperGeo, this.wingOuterMat);
      uOuter.scale.x = side;
      const uVeil = new Mesh(upperVeilGeo, this.wingInnerMat);
      uVeil.scale.x = side;
      uVeil.position.set(side * 0.1, 0.03, 0.006);
      const uRibA = new Mesh(ribLongGeo, this.wingFiligreeMat);
      uRibA.scale.x = side;
      uRibA.position.set(side * 0.04, 0.02, 0.008);
      const uRibB = new Mesh(ribMidGeo, this.wingFiligreeMat);
      uRibB.scale.x = side;
      uRibB.rotation.z = -side * 0.18;
      uRibB.position.set(side * 0.06, -0.01, 0.008);
      const uGem = new Mesh(wingGemGeo, this.leafGoldMat);
      uGem.position.set(side * 0.56, 0.22, 0.014);
      uGem.scale.set(1, 1, 0.55);

      upperTilt.add(uOuter, uVeil, uRibA, uRibB, uGem);
      upperPivot.add(upperTilt);
      this.bodyGroup.add(upperPivot);

      const lowerPivot = side < 0 ? this.wingLowerL : this.wingLowerR;
      lowerPivot.position.set(side * 0.05, 1.13, -0.105);
      lowerPivot.rotation.order = 'ZYX';

      const lowerTilt = new Group();
      lowerTilt.rotation.order = 'YXZ';
      lowerTilt.rotation.y = -side * 0.36;
      lowerTilt.rotation.x = -0.68;
      lowerTilt.rotation.z = -side * 0.22;

      const lOuter = new Mesh(lowerGeo, this.wingOuterMat);
      lOuter.scale.x = side;
      const lVeil = new Mesh(lowerVeilGeo, this.wingInnerMat);
      lVeil.scale.x = side;
      lVeil.position.set(side * 0.08, 0.01, 0.006);
      const lRib = new Mesh(ribLowerGeo, this.wingFiligreeMat);
      lRib.scale.x = side;
      lRib.position.set(side * 0.04, 0, 0.008);

      lowerTilt.add(lOuter, lVeil, lRib);
      lowerPivot.add(lowerTilt);
      this.bodyGroup.add(lowerPivot);
    }

    this.bodyGroup.rotation.order = 'YXZ';
    this.princessGroup.add(this.bodyGroup);

    // 8. Soft warm golden pixie aura sprite (browser only; guarded for headless unit tests)
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, 'rgba(255, 250, 220, 0.88)');
        g.addColorStop(0.28, 'rgba(255, 232, 150, 0.44)');
        g.addColorStop(0.62, 'rgba(255, 212, 120, 0.12)');
        g.addColorStop(1, 'rgba(255, 200, 120, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
        this.glowTexture = new CanvasTexture(canvas);
        this.glowTexture.colorSpace = SRGBColorSpace;
        this.glowSpriteMat.map = this.glowTexture;
        this.glowSpriteMat.needsUpdate = true;
        this.glowSprite = new Sprite(this.glowSpriteMat);
        this.glowSprite.scale.set(2.5, 2.7, 1);
        this.glowSprite.position.set(0, 1.18, -0.05);
        this.princessGroup.add(this.glowSprite);
      }
    }

    // 9. Orbiting pixie dust motes
    for (let i = 0; i < PIXIE_DUST_COUNT; i++) {
      const mote = new Mesh(this.sparkleGeo, this.pixieDustMat);
      this.pixieDust.push(mote);
      this.princessGroup.add(mote);
    }
  }

  /** Current interpolated world position of the fairy (center of her body). */
  getPrincessWorldPosition(target: Vector3): Vector3 {
    return target.copy(this.princessWorldPos);
  }

  /** Current world Y of the top of her hair bun (for smooth nameplate tracking). */
  getHeadTopWorldY(): number {
    return this.headTopWorldY;
  }

  /** Whether the fairy model is currently shown. */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Animate the fairy & transformation FX at 60/120fps with critically damped
   * flight smoothing and overlapping secondary motion.
   */
  draw(elapsed: number, delta: number, state: GameState, headWorld: Vector3, alpha = 1): void {
    const dt = Math.min(Math.max(delta, 0), 0.1);
    const stage = state.princessStage ?? 'snake';
    const gameover = state.phase === 'gameover';
    const morph = gameover ? 0 : princessMorphFactor(state, alpha);
    const fxProgress = princessStageProgress(state, alpha);

    // Bloom when the fairy is revealed
    if (stage === 'princess' && this.lastStage === 'transforming') {
      this.bloomTimer = BLOOM_DURATION;
    }
    if (stage !== 'princess') {
      this.bloomTimer = stage === 'transforming' ? 0 : Math.max(0, this.bloomTimer - dt);
    } else if (this.bloomTimer > 0) {
      this.bloomTimer = Math.max(0, this.bloomTimer - dt);
    }
    this.lastStage = stage;

    // Hair ribbon tinted by the current snake form colour
    if (state.form !== this.activeForm) {
      this.activeForm = state.form;
      const hex = FORM_METADATA[state.form].hexColor;
      this.ribbonMat.color.setHex(hex);
      this.ribbonMat.emissive.setHex(hex);
    }

    const reveal = smoothstep(0.46, 1, morph);
    this.visible = reveal > 0.001;
    this.princessGroup.visible = this.visible;
    this.groundGlow.visible = this.visible;

    // Smooth XZ trajectory to round off 20Hz simulation corners & turn snaps
    if (!this.visible) {
      this.smoothPos.copy(headWorld);
      this.hasSmoothPos = false;
      this.hasYaw = false;
      this.yawVel = 0;
      this.smoothSpeed = 0;
      this.smoothBank = 0;
      this.smoothTourClimb = 0;
      this.glowLight.intensity = 0;
    } else if (
      !this.hasSmoothPos ||
      this.smoothPos.distanceToSquared(headWorld) > TELEPORT_SNAP_DIST_SQ
    ) {
      this.smoothPos.copy(headWorld);
      this.hasSmoothPos = true;
    } else if (dt > 0) {
      const prevX = this.smoothPos.x;
      const prevZ = this.smoothPos.z;
      const posBlend = 1 - Math.exp(-24 * dt);
      this.smoothPos.x += (headWorld.x - this.smoothPos.x) * posBlend;
      this.smoothPos.z += (headWorld.z - this.smoothPos.z) * posBlend;
      this.smoothPos.y = headWorld.y;
      const instSpeed = Math.hypot(this.smoothPos.x - prevX, this.smoothPos.z - prevZ) / dt;
      this.smoothSpeed += (clamp(instSpeed, 0, 16) - this.smoothSpeed) * (1 - Math.exp(-8 * dt));
    }

    // Scenic altitude lift when sweeping behind a toured castle so spires never hide her
    let targetTourClimb = 0;
    if (stage === 'princess' && state.princessTourShelterId !== null) {
      const toured = (state.shelters ?? []).find((s) => s.id === state.princessTourShelterId);
      if (toured) {
        const relZ = (this.smoothPos.z - toured.z) / Math.max(6, toured.radius);
        targetTourClimb = 1.45 * smoothstep(0.15, -0.85, relZ);
      }
    }
    this.smoothTourClimb +=
      (targetTourClimb - this.smoothTourClimb) * (dt > 0 ? 1 - Math.exp(-4.5 * dt) : 1);

    // Multi-harmonic weightless fairy hover
    const hoverBob =
      (Math.sin(elapsed * 2.3) * 0.13 + Math.sin(elapsed * 3.9 + 0.8) * 0.035) * reveal;
    const baseY = PRINCESS_BASE_Y + morph * PRINCESS_LIFT + this.smoothTourClimb + hoverBob;
    this.princessWorldPos.set(this.smoothPos.x, baseY + 1.1 * PRINCESS_SCALE, this.smoothPos.z);
    this.headTopWorldY = baseY + PRINCESS_MODEL_HEIGHT * PRINCESS_SCALE;

    if (this.visible) {
      // Critically-damped 2nd-order angular spring on heading: zero 20Hz stepping or overshoot
      const targetYaw = Math.atan2(Math.cos(state.heading), Math.sin(state.heading));
      if (!this.hasYaw) {
        this.currentYaw = targetYaw;
        this.yawVel = 0;
        this.hasYaw = true;
      } else if (dt > 0) {
        const yawErr = normalizeAngle(targetYaw - this.currentYaw);
        const omega = 12.5;
        const accel = omega * omega * yawErr - 2 * omega * this.yawVel;
        this.yawVel = clamp(this.yawVel + accel * dt, -8, 8);
        this.currentYaw = normalizeAngle(this.currentYaw + this.yawVel * dt);
      }

      // Continuous, wrap-free camera glance: sin(-yaw) is smooth across all 360° (0 at ±π!)
      const targetLookSide = Math.sin(-this.currentYaw);
      const targetLookFront = Math.max(0, Math.cos(this.currentYaw));
      const lookBlend = dt > 0 ? 1 - Math.exp(-8 * dt) : 1;
      this.smoothLookSide += (targetLookSide - this.smoothLookSide) * lookBlend;
      this.smoothLookFront += (targetLookFront - this.smoothLookFront) * lookBlend;

      const bodyTurn = this.smoothLookSide * 0.24;
      const headTurn = this.smoothLookSide * 0.42 + clamp(this.yawVel * 0.045, -0.18, 0.18);

      const spin = (1 - reveal) * Math.PI * 3.2;
      const scale = PRINCESS_SCALE * Math.max(0.001, easeOutBack(reveal));

      this.princessGroup.position.set(this.smoothPos.x, baseY, this.smoothPos.z);
      this.princessGroup.rotation.y = this.currentYaw + bodyTurn + spin;
      this.princessGroup.scale.setScalar(scale);

      // Smooth bank roll & graceful forward fairy glide pitch
      const speedNorm = clamp01(this.smoothSpeed / 9.5);
      const targetBank = clamp(-this.yawVel * 0.082, -0.32, 0.32);
      const targetPitch = 0.16 + speedNorm * 0.14 + Math.sin(elapsed * 2.3 + 0.6) * 0.035;
      const poseBlend = dt > 0 ? 1 - Math.exp(-8.5 * dt) : 1;
      this.smoothBank += (targetBank - this.smoothBank) * poseBlend;
      this.smoothPitch += (targetPitch - this.smoothPitch) * poseBlend;

      this.bodyGroup.rotation.z = this.smoothBank;
      this.bodyGroup.rotation.x = this.smoothPitch;

      // Head gently counter-tilts upward toward the isometric camera so her sweet face shines
      this.headPivot.rotation.y = headTurn;
      this.headPivot.rotation.x =
        -this.smoothPitch * 0.72 -
        (0.14 + 0.18 * this.smoothLookFront) +
        Math.sin(elapsed * 2.3 - 0.5) * 0.035;
      this.headPivot.rotation.z = -this.smoothBank * 0.35 + Math.sin(elapsed * 1.5) * 0.055;

      // Natural cute blinking + subtle pupil glance
      const blinkPhase = elapsed % 3.8;
      let eyeOpenY = 1;
      if (blinkPhase > 3.64) {
        const bt = (blinkPhase - 3.64) / 0.16;
        eyeOpenY = Math.max(0.08, Math.abs(Math.cos(bt * Math.PI)));
      }
      this.leftEyeGroup.scale.y = eyeOpenY;
      this.rightEyeGroup.scale.y = eyeOpenY;
      const pupilGlance = clamp(headTurn * 0.035, -0.018, 0.018);
      this.leftPupilGroup.position.x = pupilGlance;
      this.rightPupilGroup.position.x = pupilGlance;

      // Airy, phase-lagged figure-8 wing flutter (12.8 rad/s avoids 60Hz strobing)
      const wingFreq = stage === 'princess' ? 12.8 : 17.5;
      const foreFlap = Math.sin(elapsed * wingFreq);
      const foreFeather = Math.cos(elapsed * wingFreq) * 0.14;
      const hindFlap = Math.sin(elapsed * wingFreq - 0.52);

      this.wingUpperL.rotation.z = -0.1 - foreFlap * 0.48;
      this.wingUpperR.rotation.z = 0.1 + foreFlap * 0.48;
      this.wingUpperL.rotation.x = foreFeather;
      this.wingUpperR.rotation.x = foreFeather;

      this.wingLowerL.rotation.z = -0.04 - hindFlap * 0.38;
      this.wingLowerR.rotation.z = 0.04 + hindFlap * 0.38;

      // Opalescent pearl-aqua-mint wing shimmer
      const shimmerWave = 0.5 + 0.5 * Math.sin(elapsed * 2.4);
      const roseWave = 0.5 + 0.5 * Math.cos(elapsed * 1.8);
      this.scratchWingColor.copy(this.wingAquaColor).lerp(this.wingMintColor, shimmerWave);
      this.wingOuterMat.emissive
        .copy(this.scratchWingColor)
        .lerp(this.wingPearlColor, roseWave * 0.35);
      this.wingOuterMat.opacity = 0.48 + 0.08 * shimmerWave;
      this.wingInnerMat.opacity = 0.38 + 0.1 * roseWave;

      // Balletic arms with shoulder→elbow phase lag (fluid overlapping action)
      const breath = Math.sin(elapsed * 2.3);
      this.leftArm.rotation.z = -0.52 - breath * 0.08 + this.smoothBank * 0.25;
      this.leftArm.rotation.x = 0.24 + Math.sin(elapsed * 1.9 + 0.5) * 0.08;
      this.leftElbow.rotation.z = 0.42 + Math.sin(elapsed * 2.3 - 0.6) * 0.1;
      this.leftElbow.rotation.x = -0.32;

      const wave = Math.sin(elapsed * 3.1);
      const waveLag = Math.sin(elapsed * 3.1 - 0.75);
      this.rightArm.rotation.z = 2.28 + wave * 0.16;
      this.rightArm.rotation.x = -0.28 + Math.cos(elapsed * 2.1) * 0.08;
      this.rightElbow.rotation.z = 0.36 + waveLag * 0.22;
      this.rightElbow.rotation.x = -0.18;

      const handStarScale = 0.85 + 0.35 * Math.sin(elapsed * 7.5);
      this.handSparkle.scale.setScalar(handStarScale);
      this.handSparkle.rotation.y = elapsed * 4.2;

      // Graceful trailing pixie legs with gentle scissor-flutter & knee follow-through
      const legSwing = Math.sin(elapsed * 2.2);
      const kneeLagA = Math.sin(elapsed * 2.2 - 0.7);
      const kneeLagB = Math.sin(elapsed * 2.2 + Math.PI - 0.7);
      this.legFront.rotation.x = 0.22 + legSwing * 0.12 + speedNorm * 0.12;
      this.kneeFront.rotation.x = 0.26 + Math.max(0, kneeLagA) * 0.18;
      this.legBack.rotation.x = 0.42 - legSwing * 0.12 + speedNorm * 0.14;
      this.kneeBack.rotation.x = 0.68 + kneeLagB * 0.16;

      // Rippling leaf-petal skirt & fluttering hair/ribbon follow-through
      this.skirtGroup.rotation.y = Math.sin(elapsed * 1.7) * 0.06;
      for (let i = 0; i < this.outerSkirtLeaves.length; i++) {
        const leaf = this.outerSkirtLeaves[i]!;
        leaf.rotation.x = -0.54 - speedNorm * 0.08 + Math.sin(elapsed * 3.4 + i * 0.65) * 0.065;
      }
      for (let i = 0; i < this.innerSkirtLeaves.length; i++) {
        const leaf = this.innerSkirtLeaves[i]!;
        leaf.rotation.x =
          -0.38 - speedNorm * 0.06 + Math.sin(elapsed * 3.4 + i * 0.65 + 0.9) * 0.05;
      }

      this.bunGroup.position.y = 0.305 + Math.sin(elapsed * 2.3 - 0.6) * 0.008;
      this.ribbonTailL.rotation.x = 0.28 + speedNorm * 0.25 + Math.sin(elapsed * 4.6) * 0.14;
      this.ribbonTailR.rotation.x = 0.32 + speedNorm * 0.25 + Math.sin(elapsed * 4.6 + 0.9) * 0.14;
      this.sideLockL.rotation.z = -0.05 + Math.sin(elapsed * 3.1) * 0.06 - this.smoothBank * 0.2;
      this.sideLockR.rotation.z =
        0.05 + Math.sin(elapsed * 3.1 + 0.8) * 0.06 - this.smoothBank * 0.2;

      // Soft warm golden glow & light
      const glowPulse = 0.88 + Math.sin(elapsed * 2.8) * 0.12;
      this.glowSpriteMat.opacity = 0.48 * glowPulse * reveal;
      if (this.glowSprite) {
        const gs = 2.45 + Math.sin(elapsed * 2.8) * 0.16;
        this.glowSprite.scale.set(gs, gs * 1.12, 1);
      }
      this.glowLight.intensity = 2.2 * glowPulse * reveal;

      // Spiralling golden pixie dust motes
      for (let i = 0; i < this.pixieDust.length; i++) {
        const mote = this.pixieDust[i]!;
        const t = (elapsed * 0.38 + i / this.pixieDust.length) % 1;
        const a = i * 2.39996 + elapsed * 1.45;
        const r = 0.32 + t * 0.78;
        mote.position.set(Math.cos(a) * r, 1.72 - t * 1.92, Math.sin(a) * r - t * 0.38);
        mote.scale.setScalar((1.22 - t * 0.88) * (0.85 + 0.25 * Math.sin(elapsed * 8 + i)));
        mote.rotation.y = elapsed * 3.6 + i;
      }

      this.groundGlow.position.set(this.smoothPos.x, 0.03, this.smoothPos.z);
      this.groundGlow.scale.setScalar(0.9 + Math.sin(elapsed * 2.8) * 0.08);
      this.groundGlowMat.opacity = 0.26 * reveal;
    }

    // --- Transformation FX ---
    const fxActive =
      !gameover && (stage === 'transforming' || stage === 'returning' || this.bloomTimer > 0);
    this.fxGroup.visible = fxActive;
    if (!fxActive) return;

    this.fxGroup.position.set(this.smoothPos.x, 0, this.smoothPos.z);
    const env =
      stage === 'transforming' || stage === 'returning' ? Math.sin(Math.PI * fxProgress) : 0;

    // Crisp magical light pillar (balanced to avoid washing out warm pastel arenas)
    this.pillarOuterMat.opacity = env * 0.14;
    this.pillarInnerMat.opacity = env * 0.24;
    this.pillarOuter.rotation.y = elapsed * 1.5;
    const pillarPulse = 1 + Math.sin(elapsed * 8) * 0.05;
    this.pillarOuter.scale.set(pillarPulse, 1, pillarPulse);

    // Rune circle
    this.runeMat.opacity = env * 0.78;
    this.runeGroup.rotation.z = elapsed * 2.0;
    this.runeGroup.scale.setScalar(0.72 + env * 0.48);

    // Rising ribbons
    for (let i = 0; i < this.ribbons.length; i++) {
      const ribbon = this.ribbons[i]!;
      const phase = (fxProgress * 1.8 + i / this.ribbons.length) % 1;
      ribbon.position.y = 0.3 + phase * 6.5;
      ribbon.scale.setScalar(1.25 - phase * 0.65);
      ribbon.rotation.z = elapsed * (2 + i);
      ribbon.rotation.x = Math.PI / 2 + Math.sin(elapsed * 3 + i) * 0.25;
      this.ribbonMats[i]!.opacity = env * (1 - phase * 0.6) * 0.88;
    }

    // Double helix of stars spiralling upward
    this.helixStarMat.opacity = env * 0.95;
    const helixRadius = 1.6 - fxProgress * 0.9;
    for (let i = 0; i < this.helixStars.length; i++) {
      const star = this.helixStars[i]!;
      const strand = i % 2 === 0 ? 0 : Math.PI;
      const t = i / this.helixStars.length;
      const a = strand + t * Math.PI * 4 + elapsed * 4.2;
      star.position.set(
        Math.cos(a) * helixRadius,
        0.4 + t * 6 * (0.3 + fxProgress * 0.7),
        Math.sin(a) * helixRadius,
      );
      star.rotation.y = elapsed * 5.5 + i;
      star.scale.setScalar(0.72 + Math.sin(elapsed * 9 + i) * 0.28);
    }

    // Reveal flash
    let flash = 0;
    if (stage === 'transforming') {
      flash = smoothstep(0.62, 0.72, fxProgress) * (1 - smoothstep(0.72, 1, fxProgress));
    } else if (stage === 'returning') {
      flash = smoothstep(0.35, 0.5, fxProgress) * (1 - smoothstep(0.5, 0.8, fxProgress));
    }
    this.flashSphere.visible = flash > 0.01;
    if (this.flashSphere.visible) {
      const centerY = PRINCESS_BASE_Y + morph * PRINCESS_LIFT + 1.4;
      this.flashSphere.position.set(0, centerY, 0);
      this.flashSphere.scale.setScalar(0.8 + flash * 2.2);
      this.flashMat.opacity = flash * 0.45;
    }

    // Leaf bud: closes around her near the end of the transform, then blooms open on reveal
    let petalOpen = 0;
    let petalAlpha = 0;
    let petalScale = 1;
    if (stage === 'transforming') {
      const bud = smoothstep(0.35, 0.65, fxProgress);
      petalAlpha = bud * 0.9;
      petalScale = 0.6 + bud * 0.6;
    } else if (this.bloomTimer > 0) {
      const t = 1 - this.bloomTimer / BLOOM_DURATION;
      petalOpen = easeOutBack(clamp01(t * 1.55));
      petalAlpha = 0.9 * (1 - smoothstep(0.55, 1, t));
      petalScale = 1.2 + t * 0.9;
    }
    this.petalMat.opacity = petalAlpha;
    this.petalGroup.visible = petalAlpha > 0.01;
    if (this.petalGroup.visible) {
      this.petalGroup.position.y = PRINCESS_BASE_Y + morph * PRINCESS_LIFT + 0.65;
      this.petalGroup.rotation.y = elapsed * 0.8;
      this.petalGroup.scale.setScalar(petalScale);
      for (const pivot of this.petalPivots) {
        pivot.rotation.x = -1.25 + petalOpen * 1.5;
      }
    }
  }

  /** Remove the view and free every GPU resource. */
  dispose(): void {
    this.scene.remove(this.root);
    const geos = new Set<BufferGeometry>();
    const mats = new Set<Material>();
    this.root.traverse((obj) => {
      if (obj instanceof Mesh) {
        geos.add(obj.geometry as BufferGeometry);
        const m = obj.material as Material | Material[];
        if (Array.isArray(m)) for (const mm of m) mats.add(mm);
        else mats.add(m);
      }
    });
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    this.glowSpriteMat.dispose();
    this.glowTexture?.dispose();
    this.sparkleGeo.dispose();
    this.helixStarGeo.dispose();
    this.petalGeo.dispose();
    this.glowLight.dispose();
  }
}
