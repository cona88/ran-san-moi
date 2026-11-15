import {
  ConeGeometry,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
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

/**
 * Renders the player's 4-form Magical Snake in Snake Clash 3D style:
 * plump level-scaled tapered spine, 360° smooth steering, blinking 3D eyes,
 * form accessories, shield bubble, rotating magnet halo, speed booster glow,
 * floating #1 golden crown, and crisp cached 3D nameplate.
 */
export class SnakeView {
  private readonly formGeometries: Record<SnakeForm, BufferGeometry>;
  private readonly headGeometry = new RoundedBoxGeometry(0.78, 0.7, 0.8, 4, 0.26);
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

  private readonly headGroup = new Group();
  private readonly headMesh: Mesh<RoundedBoxGeometry, MeshStandardMaterial>;
  private readonly leftEyePivot = new Group();
  private readonly rightEyePivot = new Group();
  private readonly leftPupilGroup = new Group();
  private readonly rightPupilGroup = new Group();

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

    this.buildFaceFeatures();
    this.buildDragonAccessories();
    this.buildPhoenixAccessories();
    this.unicornHalo = this.buildUnicornAccessories();
    this.buildSpiritAccessories();

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

    this.applyFormVisuals('dragon');
  }

  /** Expose the head's current interpolated world position. */
  getHeadWorldPosition(target = new Vector3()): Vector3 {
    return target.copy(this.headWorldPos);
  }

  /** Reconcile segment count, form styling, nameplate & interpolation targets with `state`. */
  onTick(state: GameState): void {
    if (state.form !== this.activeForm) {
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

    // 1. Head interpolation + level thickness + smooth 360° heading
    this.headWorldPos.lerpVectors(this.headFrom, this.headTo, a);
    const headScale = this.currentThickness * 0.96;
    const headBaseY = Math.max(0.08, 0.36 * headScale - 0.42);
    const headBob = gameover ? 0 : Math.sin(elapsed * 4.5) * 0.045;
    this.headGroup.scale.setScalar(headScale);
    this.headGroup.position.set(this.headWorldPos.x, headBaseY + headBob, this.headWorldPos.z);

    const targetYaw = headingToYaw(state.heading);
    const headingDiff = normalizeAngleDiff(targetYaw, this.headHeadingY);
    this.headHeadingY += headingDiff * Math.min(1, dt * 18);
    this.headGroup.rotation.y = this.headHeadingY;

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
      const baseSegY = Math.max(0, 0.37 * segScale - 0.44);
      const bob = gameover ? 0 : Math.sin(elapsed * 4.5 - (i + 1) * 0.65) * 0.035;
      seg.mesh.position.addScaledVector(this.scratchPerp, wave);
      seg.mesh.position.y = baseSegY + bob;

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

    // 5. Rainbow shield bubble (ONLY when shieldTicks > 0) & Magnet Halo
    this.animateShield(elapsed, dt, state);
    this.animateMagnetHalo(elapsed, dt, state);

    // 6. Speed booster / Dash / Invulnerability glow
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
  }

  dispose(): void {
    this.scene.remove(this.headGroup);
    this.scene.remove(this.crownGroup);
    this.scene.remove(this.nameSprite);
    for (const seg of this.segments) {
      this.scene.remove(seg.mesh);
    }
    this.segments = [];

    for (const geo of Object.values(this.formGeometries)) {
      geo.dispose();
    }
    this.headGeometry.dispose();
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

    this.bodyMaterial.dispose();
    this.headMaterial.dispose();
    this.eyeWhiteMat.dispose();
    this.pupilMat.dispose();
    this.catchlightMat.dispose();
    this.cheekMat.dispose();
    this.dragonMat.dispose();
    this.phoenixMat.dispose();
    this.unicornGoldMat.dispose();
    this.spiritLeafMat.dispose();
    this.flowerPetalMat.dispose();
    this.shieldMaterial.dispose();
    this.shieldWireMat.dispose();
    this.magnetOuterMat.dispose();
    this.magnetInnerMat.dispose();
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

      const smallSpark = new Mesh(this.catchlightGeo, this.catchlightMat);
      smallSpark.scale.setScalar(0.55);
      smallSpark.position.set(-0.026, -0.024, 0.118);
      pupilGroup.add(smallSpark);

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

  private animateEyes(elapsed: number, state: GameState): void {
    const blinkCycle = elapsed % 3.6;
    let blinkScaleY = 1;
    if (blinkCycle > 3.44) {
      const t = (blinkCycle - 3.44) / 0.16;
      blinkScaleY = Math.max(0.08, Math.abs(Math.cos(t * Math.PI)));
    }
    this.leftEyePivot.scale.y = blinkScaleY;
    this.rightEyePivot.scale.y = blinkScaleY;

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
    const dashBoost = speedActive ? 0.48 + 0.22 * Math.sin(elapsed * 18) : 0;
    this.headMaterial.emissiveIntensity = 0.48 + dashBoost;
    this.bodyMaterial.emissiveIntensity = 0.42 + dashBoost * 0.6;
  }
}
