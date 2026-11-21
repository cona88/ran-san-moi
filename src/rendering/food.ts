import {
  Color,
  DynamicDrawUsage,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  Euler,
  Shape,
  TorusGeometry,
  Vector3,
  type Scene,
} from 'three';
import type { GameState, VisualTheme, WorldOrb } from '../core/types';
import { THEMES } from './palette';
import { cellToWorld } from './world';

const MAX_WORLD_ORBS = 1500;

interface SyncedOrb {
  id: number;
  x: number;
  z: number;
  colorHex: number;
  isLoot: boolean;
}

function createStarGeometry(outerR: number, innerR: number, points = 5): ExtrudeGeometry {
  const s = new Shape();
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
    depth: 0.14,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.04,
    bevelSegments: 2,
  });
  geo.center();
  return geo;
}

/**
 * Renders up to 260 open-world golden energy orbs & high-value loot jewels via a
 * single `InstancedMesh` draw call, plus the dazzling Rainbow Star-Crown `bonusFood`.
 */
export class FoodView {
  private readonly orbGeometry = new IcosahedronGeometry(0.24, 1);
  private readonly orbMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffe08a,
    emissiveIntensity: 0.16,
    metalness: 0.18,
    roughness: 0.24,
  });
  private readonly orbMesh: InstancedMesh;
  private readonly orbBuffer: SyncedOrb[] = [];
  private orbCount = 0;

  private readonly starGeometry = createStarGeometry(0.42, 0.2, 5);
  private readonly crownRingGeometry = new TorusGeometry(0.46, 0.045, 8, 28);
  private readonly bonusGroup = new Group();
  private readonly bonusMaterial: MeshStandardMaterial;
  private readonly bonusRingMaterial: MeshStandardMaterial;
  private readonly bonusStar: Mesh<ExtrudeGeometry, MeshStandardMaterial>;
  private readonly bonusCrown: Mesh<TorusGeometry, MeshStandardMaterial>;
  private readonly bonusLight: PointLight;
  private bonusTicksLeft = 0;

  private lastOrbsRef: readonly WorldOrb[] | null = null;
  private lastBonusFoodRef: GameState['bonusFood'] = null;

  private readonly scratchMatrix = new Matrix4();
  private readonly scratchPos = new Vector3();
  private readonly scratchScale = new Vector3();
  private readonly scratchEuler = new Euler();
  private readonly scratchQuat = new Quaternion();
  private readonly scratchColor = new Color();

  constructor(
    private readonly scene: Scene,
    private readonly half: number,
  ) {
    const initial = THEMES.honeycomb_arena;

    this.orbMesh = new InstancedMesh(this.orbGeometry, this.orbMaterial, MAX_WORLD_ORBS);
    this.orbMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.orbMesh.frustumCulled = false;
    this.orbMesh.count = 0;
    this.scratchColor.setHex(0xffd43b);
    for (let i = 0; i < MAX_WORLD_ORBS; i++) {
      this.orbMesh.setColorAt(i, this.scratchColor);
      this.orbBuffer.push({ id: 0, x: 0, z: 0, colorHex: 0xffd43b, isLoot: false });
    }
    this.scene.add(this.orbMesh);

    this.bonusRingMaterial = new MeshStandardMaterial({
      color: 0xffffff,
      emissive: initial.bonusColor,
      emissiveIntensity: 0.55,
      metalness: 0.2,
      roughness: 0.25,
    });
    this.bonusMaterial = new MeshStandardMaterial({
      color: initial.bonusColor,
      emissive: initial.bonusColor,
      emissiveIntensity: 0.78,
      metalness: 0.3,
      roughness: 0.16,
    });
    this.bonusStar = new Mesh(this.starGeometry, this.bonusMaterial);
    this.bonusGroup.add(this.bonusStar);

    this.bonusCrown = new Mesh(this.crownRingGeometry, this.bonusRingMaterial);
    this.bonusCrown.rotation.x = Math.PI / 2;
    this.bonusCrown.position.y = -0.18;
    this.bonusGroup.add(this.bonusCrown);

    this.bonusLight = new PointLight(initial.bonusColor, 1.0, 5.5);
    this.bonusGroup.visible = false;
    this.bonusLight.visible = false;
    this.scene.add(this.bonusGroup);
    this.scene.add(this.bonusLight);
  }

  /** Adjust orb glow contrast subtly for light vs dark visual themes. */
  setTheme(theme: VisualTheme): void {
    const palette = THEMES[theme];
    const isBright = theme === 'honeycomb_arena' || theme === 'candy_island';
    this.orbMaterial.emissiveIntensity = isBright ? 0.15 : 0.42;
    this.bonusRingMaterial.emissive.setHex(palette.bonusColor);
  }

  /** Synchronize open-world `WorldOrb` instances & optional `bonusFood` from `state`. */
  sync(state: GameState): void {
    if (state.orbs !== this.lastOrbsRef) {
      this.lastOrbsRef = state.orbs;
      const total = state.orbs.length;

      // Prioritize loot orbs first if total ever exceeds MAX_WORLD_ORBS.
      let count = 0;
      if (total <= MAX_WORLD_ORBS) {
        for (let i = 0; i < total; i++) {
          const orb = state.orbs[i];
          if (!orb) continue;
          const slot = this.orbBuffer[count];
          if (!slot) break;
          slot.id = orb.id;
          slot.x = orb.x;
          slot.z = orb.z;
          slot.colorHex = orb.colorHex;
          slot.isLoot = orb.isLoot;
          this.scratchColor.setHex(orb.colorHex);
          this.orbMesh.setColorAt(count, this.scratchColor);
          count++;
        }
      } else {
        for (let i = 0; i < total && count < MAX_WORLD_ORBS; i++) {
          const orb = state.orbs[i];
          if (!orb || !orb.isLoot) continue;
          const slot = this.orbBuffer[count];
          if (!slot) break;
          slot.id = orb.id;
          slot.x = orb.x;
          slot.z = orb.z;
          slot.colorHex = orb.colorHex;
          slot.isLoot = true;
          this.scratchColor.setHex(orb.colorHex);
          this.orbMesh.setColorAt(count, this.scratchColor);
          count++;
        }
        for (let i = 0; i < total && count < MAX_WORLD_ORBS; i++) {
          const orb = state.orbs[i];
          if (!orb || orb.isLoot) continue;
          const slot = this.orbBuffer[count];
          if (!slot) break;
          slot.id = orb.id;
          slot.x = orb.x;
          slot.z = orb.z;
          slot.colorHex = orb.colorHex;
          slot.isLoot = false;
          this.scratchColor.setHex(orb.colorHex);
          this.orbMesh.setColorAt(count, this.scratchColor);
          count++;
        }
      }

      this.orbCount = count;
      this.orbMesh.count = count;
      if (this.orbMesh.instanceColor) {
        this.orbMesh.instanceColor.needsUpdate = true;
      }
    }

    if (state.bonusFood !== this.lastBonusFoodRef) {
      this.lastBonusFoodRef = state.bonusFood;
    }

    if (state.bonusFood) {
      const bw = cellToWorld(state.bonusFood.x, state.bonusFood.z, this.half);
      this.bonusGroup.position.set(bw.x, 0, bw.z);
      this.bonusLight.position.set(bw.x, 0.8, bw.z);
      this.bonusGroup.visible = true;
      this.bonusLight.visible = true;
      this.bonusTicksLeft = state.bonusTicks;
    } else {
      this.bonusGroup.visible = false;
      this.bonusLight.visible = false;
      this.bonusTicksLeft = 0;
    }
  }

  /** Animate all instanced orbs and bonus star smoothly at 60fps. */
  animate(elapsed: number, delta: number, state?: GameState): void {
    if (state) {
      this.sync(state);
    }

    for (let i = 0; i < this.orbCount; i++) {
      const orb = this.orbBuffer[i];
      if (!orb) continue;

      const phase = (orb.id % 97) * 0.45;
      if (orb.isLoot) {
        const y = -0.05 + Math.sin(elapsed * 4.5 + phase) * 0.11;
        const s = 1.65 + Math.sin(elapsed * 7.2 + phase) * 0.22;
        this.scratchPos.set(orb.x, y, orb.z);
        this.scratchEuler.set(elapsed * 1.4, elapsed * 2.8 + phase, 0);
        this.scratchQuat.setFromEuler(this.scratchEuler);
        this.scratchScale.set(s, s, s);
      } else {
        const y = -0.18 + Math.sin(elapsed * 3.1 + phase) * 0.06;
        const s = 0.94 + Math.sin(elapsed * 4.2 + phase) * 0.09;
        this.scratchPos.set(orb.x, y, orb.z);
        this.scratchEuler.set(0, elapsed * 1.5 + phase, 0);
        this.scratchQuat.setFromEuler(this.scratchEuler);
        this.scratchScale.set(s, s, s);
      }
      this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.scratchScale);
      this.orbMesh.setMatrixAt(i, this.scratchMatrix);
    }
    this.orbMesh.instanceMatrix.needsUpdate = true;

    if (this.bonusGroup.visible) {
      this.bonusStar.rotation.y += delta * 3.0;
      this.bonusCrown.rotation.z += delta * 2.4;
      const hue = (elapsed * 0.45) % 1;
      this.bonusMaterial.color.setHSL(hue, 0.9, 0.68);
      this.bonusMaterial.emissive.setHSL(hue, 0.9, 0.52);
      this.bonusLight.color.setHSL(hue, 0.9, 0.68);

      const urgentPulse = this.bonusTicksLeft > 0 && this.bonusTicksLeft <= 6;
      const pulseSpeed = urgentPulse ? 14 : 4.5;
      const pulseAmp = urgentPulse ? 0.2 : 0.11;
      this.bonusGroup.scale.setScalar(1 + Math.sin(elapsed * pulseSpeed) * pulseAmp);
      this.bonusGroup.position.y = 0.28 + Math.sin(elapsed * 3.6 + 1) * 0.13;
    }
  }

  dispose(): void {
    this.scene.remove(this.orbMesh);
    this.scene.remove(this.bonusGroup);
    this.scene.remove(this.bonusLight);

    this.orbGeometry.dispose();
    this.orbMaterial.dispose();
    this.starGeometry.dispose();
    this.crownRingGeometry.dispose();
    this.bonusMaterial.dispose();
    this.bonusRingMaterial.dispose();
  }
}
