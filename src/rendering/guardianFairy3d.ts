import {
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Scene,
} from 'three';
import type { GameState, GuardianFairyKind } from '../core/types';
import { cellToWorld } from './world';

const GROUND_SHADOW_Y = 0.03;

function createFairyWingGeometry(span: number, height: number): ExtrudeGeometry {
  const s = new Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(span * 0.45, height * 0.95, span, height * 0.48);
  s.quadraticCurveTo(span * 0.92, -height * 0.15, span * 0.28, -height * 0.32);
  s.closePath();

  return new ExtrudeGeometry(s, {
    depth: 0.025,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.01,
    bevelSegments: 1,
  });
}

interface FairyPalette {
  readonly gownHex: number;
  readonly overskirtHex: number;
  readonly wingHex: number;
  readonly hairHex: number;
  readonly starHex: number;
  readonly ringHex: number;
}

const FAIRY_PALETTES: Readonly<Record<GuardianFairyKind, FairyPalette>> = {
  blossom: {
    gownHex: 0xff6ec7,
    overskirtHex: 0xffb8eb,
    wingHex: 0xff9de6,
    hairHex: 0xffe082,
    starHex: 0xffe66d,
    ringHex: 0xff80cc,
  },
  starlight: {
    gownHex: 0xa86bff,
    overskirtHex: 0xd9b8ff,
    wingHex: 0x8ef8ff,
    hairHex: 0xe6e8ff,
    starHex: 0xfff078,
    ringHex: 0xc792ff,
  },
  crystal: {
    gownHex: 0x38e8ff,
    overskirtHex: 0xc4feff,
    wingHex: 0xe0feff,
    hairHex: 0xbef6ff,
    starHex: 0xffffff,
    ringHex: 0x5ef6ff,
  },
  rainbow: {
    gownHex: 0xff9ec4,
    overskirtHex: 0xffe57f,
    wingHex: 0x7ef8ff,
    hairHex: 0xffd1e8,
    starHex: 0xffd447,
    ringHex: 0xff80cc,
  },
};

/**
 * 3D Rendering Controller for visiting Guardian Fairies and their protective blessing aura.
 *
 * Zero per-frame heap allocations inside `draw()` and full resource cleanup on `dispose()`.
 */
export class GuardianFairy3DView {
  private readonly root = new Group();
  private readonly fairyGroup = new Group();
  private readonly bodyTiltGroup = new Group();
  private readonly wingUpperL = new Group();
  private readonly wingUpperR = new Group();
  private readonly wingLowerL = new Group();
  private readonly wingLowerR = new Group();
  private readonly wandGroup = new Group();
  private readonly wandStar: Mesh<OctahedronGeometry, MeshStandardMaterial>;
  private readonly groundGlowMesh: Mesh<CircleGeometry, MeshBasicMaterial>;
  private readonly stardustMotes: Mesh<OctahedronGeometry, MeshBasicMaterial>[] = [];

  private readonly playerBlessingGroup = new Group();
  private readonly blessingRingOuter: Mesh<TorusGeometry, MeshBasicMaterial>;
  private readonly blessingRingInner: Mesh<TorusGeometry, MeshBasicMaterial>;
  private readonly blessingStars: Mesh<OctahedronGeometry, MeshBasicMaterial>[] = [];

  // Shared Materials (for dynamic kind palette updates & disposal)
  private readonly dressMat = new MeshStandardMaterial({
    color: 0xff6ec7,
    emissive: 0xff49b8,
    emissiveIntensity: 0.48,
    roughness: 0.25,
    metalness: 0.12,
  });
  private readonly overskirtMat = new MeshStandardMaterial({
    color: 0xffb8eb,
    emissive: 0xff7ac6,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.78,
    roughness: 0.18,
    side: DoubleSide,
  });
  private readonly skinMat = new MeshStandardMaterial({
    color: 0xffe0cc,
    emissive: 0xffb69e,
    emissiveIntensity: 0.16,
    roughness: 0.48,
  });
  private readonly hairMat = new MeshStandardMaterial({
    color: 0xffe082,
    emissive: 0xffca28,
    emissiveIntensity: 0.34,
    roughness: 0.3,
  });
  private readonly goldMat = new MeshStandardMaterial({
    color: 0xffe45c,
    emissive: 0xffb82e,
    emissiveIntensity: 0.72,
    metalness: 0.65,
    roughness: 0.18,
  });
  private readonly wingMat = new MeshStandardMaterial({
    color: 0xff9de6,
    emissive: 0xff80cc,
    emissiveIntensity: 0.85,
    transparent: true,
    opacity: 0.78,
    side: DoubleSide,
    roughness: 0.12,
    depthWrite: false,
  });
  private readonly wandStarMat = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffe66d,
    emissiveIntensity: 1.0,
    roughness: 0.1,
    metalness: 0.4,
  });
  private readonly wandStarGeo = new OctahedronGeometry(0.22, 0);
  private readonly eyeMat = new MeshBasicMaterial({ color: 0x1a0b33 });
  private readonly catchlightMat = new MeshBasicMaterial({ color: 0xffffff });
  private readonly cheekMat = new MeshBasicMaterial({ color: 0xff6ea8 });
  private readonly groundGlowMat = new MeshBasicMaterial({
    color: 0xff80cc,
    transparent: true,
    opacity: 0,
    side: DoubleSide,
    depthWrite: false,
  });
  private readonly stardustMat = new MeshBasicMaterial({
    color: 0xfff5b8,
    transparent: true,
    opacity: 0.9,
  });
  private readonly blessingRingMat = new MeshBasicMaterial({
    color: 0xff80cc,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
  });
  private readonly blessingStarMat = new MeshBasicMaterial({
    color: 0xffe66d,
    transparent: true,
    opacity: 0.92,
  });

  // Geometries
  private readonly upperWingGeo = createFairyWingGeometry(1.08, 0.78);
  private readonly lowerWingGeo = createFairyWingGeometry(0.76, 0.56);
  private readonly stardustGeo = new OctahedronGeometry(0.11, 0);
  private readonly blessingStarGeo = new OctahedronGeometry(0.14, 0);

  private readonly scratchTargetWorld = new Vector3();
  private readonly scratchHeadWorld = new Vector3();
  private activeKind: GuardianFairyKind | null = null;
  private currentX = 0;
  private currentZ = 0;
  private currentY = 12;
  private currentHeading = 0;
  private hasInitPos = false;

  constructor(private readonly scene: Scene) {
    this.wandStar = new Mesh(this.wandStarGeo, this.wandStarMat);
    this.buildFairyModel();

    this.groundGlowMesh = new Mesh(new CircleGeometry(1.35, 24), this.groundGlowMat);
    this.groundGlowMesh.rotation.x = -Math.PI / 2;
    this.groundGlowMesh.position.y = GROUND_SHADOW_Y;
    this.groundGlowMesh.visible = false;

    this.blessingRingOuter = new Mesh(new TorusGeometry(1.65, 0.045, 8, 36), this.blessingRingMat);
    this.blessingRingOuter.rotation.x = Math.PI / 2;

    this.blessingRingInner = new Mesh(new TorusGeometry(1.28, 0.032, 8, 32), this.blessingStarMat);
    this.blessingRingInner.rotation.x = Math.PI / 2;

    this.playerBlessingGroup.add(this.blessingRingOuter, this.blessingRingInner);
    for (let i = 0; i < 6; i++) {
      const star = new Mesh(this.blessingStarGeo, this.blessingStarMat);
      const a = (i / 6) * Math.PI * 2;
      star.position.set(Math.cos(a) * 1.65, 0.18, Math.sin(a) * 1.65);
      this.blessingStars.push(star);
      this.playerBlessingGroup.add(star);
    }
    this.playerBlessingGroup.visible = false;

    this.fairyGroup.visible = false;
    this.root.add(this.fairyGroup, this.groundGlowMesh, this.playerBlessingGroup);
    this.scene.add(this.root);
  }

  private buildFairyModel(): void {
    // 1. Layered Pastel Fairy Gown & Bodice
    const skirt = new Mesh(new ConeGeometry(0.72, 1.38, 16, 1, true), this.dressMat);
    skirt.position.y = 0.05;
    this.bodyTiltGroup.add(skirt);

    const overskirt = new Mesh(new ConeGeometry(0.84, 0.86, 12, 1, true), this.overskirtMat);
    overskirt.position.y = 0.18;
    this.bodyTiltGroup.add(overskirt);

    const bodice = new Mesh(new CylinderGeometry(0.24, 0.3, 0.65, 12), this.dressMat);
    bodice.position.y = 0.84;
    this.bodyTiltGroup.add(bodice);

    const sash = new Mesh(new TorusGeometry(0.28, 0.045, 6, 16), this.goldMat);
    sash.rotation.x = Math.PI / 2;
    sash.position.y = 0.62;
    this.bodyTiltGroup.add(sash);

    // 2. Cute Head, Hair, Eyes, Blush & Princess Tiara
    const headPivot = new Group();
    headPivot.position.set(0, 1.44, 0.04);

    const head = new Mesh(new SphereGeometry(0.36, 16, 14), this.skinMat);
    headPivot.add(head);

    const hairCap = new Mesh(
      new SphereGeometry(0.385, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
      this.hairMat,
    );
    hairCap.position.set(0, 0.04, -0.04);
    hairCap.rotation.x = -0.22;
    headPivot.add(hairCap);

    // Twin cute fairy hair buns
    const bunGeo = new SphereGeometry(0.16, 10, 8);
    for (const side of [-1, 1] as const) {
      const bun = new Mesh(bunGeo, this.hairMat);
      bun.position.set(side * 0.34, 0.25, -0.14);
      headPivot.add(bun);

      const eye = new Mesh(new SphereGeometry(0.052, 8, 8), this.eyeMat);
      eye.position.set(side * 0.13, 0.02, 0.32);
      const spark = new Mesh(new SphereGeometry(0.02, 6, 6), this.catchlightMat);
      spark.position.set(side * 0.14, 0.045, 0.36);
      const cheek = new Mesh(new SphereGeometry(0.055, 8, 6), this.cheekMat);
      cheek.scale.set(1.2, 0.65, 0.4);
      cheek.position.set(side * 0.2, -0.07, 0.29);
      headPivot.add(eye, spark, cheek);
    }

    // Miniature Golden Princess Tiara
    const tiaraBand = new Mesh(new TorusGeometry(0.22, 0.022, 6, 16, Math.PI), this.goldMat);
    tiaraBand.position.set(0, 0.33, 0.09);
    tiaraBand.rotation.x = -0.25;
    headPivot.add(tiaraBand);

    const tiaraGem = new Mesh(new OctahedronGeometry(0.075, 0), this.wandStarMat);
    tiaraGem.position.set(0, 0.45, 0.12);
    headPivot.add(tiaraGem);

    this.bodyTiltGroup.add(headPivot);

    // 3. Arms & Magic Star Wand
    const armGeo = new CylinderGeometry(0.065, 0.055, 0.52, 8);
    const leftArm = new Mesh(armGeo, this.skinMat);
    leftArm.position.set(-0.34, 0.85, 0.08);
    leftArm.rotation.z = 0.55;
    leftArm.rotation.x = -0.3;
    this.bodyTiltGroup.add(leftArm);

    this.wandGroup.position.set(0.32, 0.9, 0.12);
    const rightArm = new Mesh(armGeo, this.skinMat);
    rightArm.position.set(0.08, -0.04, 0.12);
    rightArm.rotation.z = -0.5;
    rightArm.rotation.x = -0.75;
    this.wandGroup.add(rightArm);

    const wandStick = new Mesh(new CylinderGeometry(0.024, 0.03, 0.85, 8), this.goldMat);
    wandStick.position.set(0.2, 0.15, 0.52);
    wandStick.rotation.x = Math.PI * 0.35;
    this.wandGroup.add(wandStick);

    this.wandStar.position.set(0.2, 0.35, 0.92);
    this.wandGroup.add(this.wandStar);

    this.bodyTiltGroup.add(this.wandGroup);

    // 4. 4 Articulated Iridescent Fairy Wings
    for (const side of [-1, 1] as const) {
      const upperPivot = side < 0 ? this.wingUpperL : this.wingUpperR;
      upperPivot.position.set(side * 0.18, 0.96, -0.18);
      const upperMesh = new Mesh(this.upperWingGeo, this.wingMat);
      upperMesh.scale.x = side;
      upperMesh.rotation.y = side * -0.35;
      upperPivot.add(upperMesh);

      const lowerPivot = side < 0 ? this.wingLowerL : this.wingLowerR;
      lowerPivot.position.set(side * 0.15, 0.72, -0.18);
      const lowerMesh = new Mesh(this.lowerWingGeo, this.wingMat);
      lowerMesh.scale.x = side;
      lowerMesh.rotation.y = side * -0.45;
      lowerMesh.rotation.z = -side * 0.25;
      lowerPivot.add(lowerMesh);

      this.bodyTiltGroup.add(upperPivot, lowerPivot);
    }

    this.fairyGroup.add(this.bodyTiltGroup);

    // 5. Orbiting Stardust Halo around Fairy
    for (let i = 0; i < 8; i++) {
      const mote = new Mesh(this.stardustGeo, this.stardustMat);
      this.stardustMotes.push(mote);
      this.fairyGroup.add(mote);
    }
  }

  /** Sync Guardian Fairy kind color palette when state updates. */
  sync(state: GameState): void {
    const fairy = state.guardianFairy;
    if (!fairy) return;
    if (fairy.kind !== this.activeKind) {
      this.activeKind = fairy.kind;
      const pal = FAIRY_PALETTES[fairy.kind];
      this.dressMat.color.setHex(pal.gownHex);
      this.dressMat.emissive.setHex(pal.gownHex);
      this.overskirtMat.color.setHex(pal.overskirtHex);
      this.overskirtMat.emissive.setHex(pal.gownHex);
      this.wingMat.color.setHex(pal.wingHex);
      this.wingMat.emissive.setHex(pal.gownHex);
      this.hairMat.color.setHex(pal.hairHex);
      this.hairMat.emissive.setHex(pal.hairHex);
      this.wandStarMat.emissive.setHex(pal.starHex);
      this.groundGlowMat.color.setHex(pal.ringHex);
      this.blessingRingMat.color.setHex(pal.ringHex);
      this.blessingStarMat.color.setHex(pal.starHex);
    }
  }

  /** Animate Guardian Fairy and protective blessing halo at 60fps (zero allocations). */
  draw(elapsed: number, delta: number, state: GameState, playerHeadWorld?: Vector3): void {
    this.sync(state);
    const fairy = state.guardianFairy;
    if (!fairy || state.phase === 'gameover' || fairy.phase === 'idle') {
      this.fairyGroup.visible = false;
      this.groundGlowMesh.visible = false;
      this.playerBlessingGroup.visible = false;
      this.hasInitPos = false;
      return;
    }

    const dt = Math.min(Math.max(delta, 0), 0.1);
    cellToWorld(fairy.pos.x, fairy.pos.z, 0, this.scratchTargetWorld);

    const targetY = 2.6 + (fairy.altitude - 1.0) * 5.2 + Math.sin(elapsed * 4.2) * 0.25;
    if (!this.hasInitPos) {
      this.hasInitPos = true;
      this.currentX = this.scratchTargetWorld.x;
      this.currentZ = this.scratchTargetWorld.z;
      this.currentY = targetY;
      this.currentHeading = Math.atan2(Math.cos(fairy.heading), Math.sin(fairy.heading));
    } else {
      const smooth = 1 - Math.exp(-12 * dt);
      this.currentX += (this.scratchTargetWorld.x - this.currentX) * smooth;
      this.currentZ += (this.scratchTargetWorld.z - this.currentZ) * smooth;
      this.currentY += (targetY - this.currentY) * (1 - Math.exp(-10 * dt));

      const targetYaw = Math.atan2(Math.cos(fairy.heading), Math.sin(fairy.heading));
      let diff = targetYaw - this.currentHeading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.currentHeading += diff * (1 - Math.exp(-12 * dt));
    }

    this.fairyGroup.visible = true;
    this.fairyGroup.position.set(this.currentX, this.currentY, this.currentZ);
    this.fairyGroup.rotation.y = this.currentHeading;
    this.bodyTiltGroup.rotation.x = 0.14;
    this.bodyTiltGroup.rotation.z = Math.sin(elapsed * 3.0) * 0.08;

    // Rainbow fairy shimmers smoothly through pastel hues
    if (fairy.kind === 'rainbow') {
      const hue = (elapsed * 0.38) % 1;
      this.dressMat.color.setHSL(hue, 0.85, 0.72);
      this.dressMat.emissive.setHSL(hue, 0.9, 0.56);
      this.wingMat.emissive.setHSL((hue + 0.35) % 1, 0.9, 0.72);
      this.blessingRingMat.color.setHSL((hue + 0.15) % 1, 0.9, 0.72);
    }

    // Flutter 4 fairy wings at 14Hz
    const flap = Math.sin(elapsed * 14 * Math.PI * 0.5) * 0.55;
    this.wingUpperL.rotation.z = -flap;
    this.wingUpperR.rotation.z = flap;
    this.wingLowerL.rotation.z = -flap * 0.82;
    this.wingLowerR.rotation.z = flap * 0.82;

    // Wave magic star wand & spin star tip
    this.wandGroup.rotation.x = Math.sin(elapsed * 4.5) * 0.22;
    this.wandStar.rotation.y = elapsed * 3.8;
    const starPulse = 1.0 + Math.sin(elapsed * 7.5) * 0.22;
    this.wandStar.scale.setScalar(starPulse);

    // Orbit stardust motes
    for (let i = 0; i < this.stardustMotes.length; i++) {
      const mote = this.stardustMotes[i]!;
      const a = (i / this.stardustMotes.length) * Math.PI * 2 + elapsed * 2.4;
      const r = 1.15 + Math.sin(elapsed * 3 + i) * 0.18;
      mote.position.set(
        Math.cos(a) * r,
        0.7 + Math.sin(elapsed * 4 + i * 0.9) * 0.45,
        Math.sin(a) * r,
      );
      mote.rotation.y = elapsed * 3;
    }

    // Soft glowing light circle on ground beneath fairy
    this.groundGlowMesh.visible = true;
    this.groundGlowMesh.position.set(this.currentX, GROUND_SHADOW_Y, this.currentZ);
    const glowScale = 0.88 + Math.sin(elapsed * 5.0) * 0.14;
    this.groundGlowMesh.scale.setScalar(glowScale);
    this.groundGlowMat.opacity = fairy.phase === 'escorting' ? 0.36 : 0.2;

    // Protective Blessing Ring around player snake during escort
    if (fairy.phase === 'escorting') {
      if (playerHeadWorld) {
        this.scratchHeadWorld.copy(playerHeadWorld);
      } else {
        const head = state.snake[0];
        if (head) cellToWorld(head.x, head.z, 0, this.scratchHeadWorld);
      }
      this.playerBlessingGroup.visible = true;
      this.playerBlessingGroup.position.set(
        this.scratchHeadWorld.x,
        0.16 + state.butterflyAltitude * 2.5,
        this.scratchHeadWorld.z,
      );
      this.playerBlessingGroup.rotation.y = elapsed * 1.4;
      const ringScale = 1.0 + Math.sin(elapsed * 4.2) * 0.06;
      this.playerBlessingGroup.scale.setScalar(ringScale);
      this.blessingRingMat.opacity = 0.48 + Math.sin(elapsed * 6.0) * 0.15;
    } else {
      this.playerBlessingGroup.visible = false;
    }
  }

  /** Clean up all meshes, geometries, and materials. */
  dispose(): void {
    this.scene.remove(this.root);
    const disposedGeos = new Set<BufferGeometry>();
    const disposedMats = new Set<Material>();
    this.root.traverse((obj) => {
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
    this.upperWingGeo.dispose();
    this.lowerWingGeo.dispose();
    this.stardustGeo.dispose();
    this.blessingStarGeo.dispose();
    this.wandStarGeo.dispose();
  }
}
