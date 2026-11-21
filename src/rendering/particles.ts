import {
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type Scene,
} from 'three';
import type { SnakeForm } from '../core/types';

const MAX_STAR_PARTICLES = 1024;
const MAX_PETAL_PARTICLES = 640;
const MAX_WAVES = 64;

const RAINBOW_HEX = [
  0xff70d0, // pastel pink
  0xffb357, // peach gold
  0xffe95c, // starlight yellow
  0x5effa8, // spirit mint
  0x48efff, // phoenix cyan
  0xc082ff, // crystal lavender
] as const;

const SPIRIT_PETAL_COLORS = [0xff8ce0, 0xffb8eb, 0x4dff9a, 0xfff099] as const;
const BUTTERFLY_COLORS = [0xff7ae0, 0xffb8eb, 0xffe6f7, 0x7ef8ff, 0xffffff] as const;
const BUTTERFLY_PINK_DUST_COLORS = [0xff7ae0, 0xffb8eb, 0xffe6f7, 0xffffff] as const;
const BUTTERFLY_ICE_SPARK_COLORS = [0x7ef8ff, 0xd8feff, 0xffffff] as const;
const FALLING_ICE_SHARD_COLORS = [0x7ef8ff, 0xc8feff, 0xe8feff, 0xffffff, 0x38f6ff] as const;
const FALLING_ICE_FLAKE_COLORS = [0xe8feff, 0xd4feff, 0xffffff, 0xffd8f3] as const;
const AOE_FIRE_COLORS = [0xff4518, 0xff8c22, 0xffbe3b, 0xff2e63, 0xfff3a8] as const;
const AOE_WATER_COLORS = [0x1ee3ff, 0x8cf8ff, 0x38b6ff, 0xd4ffff, 0xffffff] as const;
const AOE_ARCANE_COLORS = [0xd96bff, 0xffe66d, 0x7df9ff, 0xff6be6, 0xffffff] as const;
const FLOWER_BLOOM_COLORS = [0xff7ac6, 0xffd447, 0xc28bff, 0x5ef2c8, 0xffb8eb] as const;
const CHOMP_CONFETTI_COLORS = [0xffe95c, 0xff70d0, 0x48efff, 0x5effa8, 0xffb357, 0xffffff] as const;
const FIRE_SPRAY_COLORS = [0xfff3a1, 0xffe054, 0xff9b29, 0xff3b7f] as const;
const ICE_SPRAY_COLORS = [0xffffff, 0xc4feff, 0x9cfaff, 0x38f6ff] as const;
const WATER_SPRAY_COLORS = [0xeaffff, 0x8efaff, 0x25b8ff, 0x56d8ff] as const;
const SILK_SPRAY_COLORS = [0xffffff, 0xf4fff9, 0x5effa8, 0xb8ffda] as const;
const FIRE_IMPACT_COLORS = [0xffe45c, 0xff7b22, 0xff2e7a, 0xfff4b8] as const;
const ICE_IMPACT_COLORS = [0xffffff, 0x7ef8ff, 0x2de0ff, 0xe8feff] as const;
const WATER_IMPACT_COLORS = [0x25b8ff, 0x8efaff, 0xeaffff, 0xffffff] as const;
const SILK_IMPACT_COLORS = [0x4dff9a, 0xf4fff9, 0x9effcb, 0xfff0a8] as const;

interface ParticleSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  drag: number;
  age: number;
  life: number;
  baseScale: number;
  spin: number;
  color: number;
  twinkle: number;
}

interface WaveSlot {
  active: boolean;
  readonly mesh: Mesh<RingGeometry, MeshBasicMaterial>;
  age: number;
  duration: number;
  startRadius: number;
  endRadius: number;
}

function createEmptySlots(count: number): ParticleSlot[] {
  const arr: ParticleSlot[] = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      active: false,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      gravity: 6,
      drag: 1.5,
      age: 0,
      life: 0.6,
      baseScale: 1,
      spin: 4,
      color: 0xffffff,
      twinkle: 0,
    });
  }
  return arr;
}

/**
 * Pooled 3D particle & expanding light-wave system for sparkles, multi-ring starbursts,
 * chomp confetti showers, butterfly wing-dust trails, Spirit 3×3 flower blooms,
 * speed streaks, elemental breath plumes and multi-color fireworks.
 *
 * All runtime emissions mutate pre-allocated typed pools (zero-GC per frame).
 */
export class ParticleSystem {
  private readonly root = new Group();
  private readonly starGeometry = new OctahedronGeometry(0.145, 0);
  private readonly starMaterial = new MeshBasicMaterial({ color: 0xffffff });
  private readonly starMesh: InstancedMesh;
  private readonly starSlots = createEmptySlots(MAX_STAR_PARTICLES);
  private starCursor = 0;

  private readonly petalGeometry = new SphereGeometry(0.13, 8, 6);
  private readonly petalMaterial = new MeshBasicMaterial({ color: 0xffffff });
  private readonly petalMesh: InstancedMesh;
  private readonly petalSlots = createEmptySlots(MAX_PETAL_PARTICLES);
  private petalCursor = 0;

  private readonly waveGeometry = new RingGeometry(0.75, 1.0, 36);
  private readonly waveSlots: WaveSlot[] = [];
  private waveCursor = 0;

  private readonly scratchMatrix = new Matrix4();
  private readonly scratchPos = new Vector3();
  private readonly scratchScale = new Vector3();
  private readonly scratchQuat = new Quaternion();
  private readonly scratchEuler = new Euler();
  private readonly scratchColor = new Color();
  private readonly scratchFrostWavePos = new Vector3();

  private seed = 0x13579bdf;

  constructor(private readonly scene: Scene) {
    this.starMesh = new InstancedMesh(this.starGeometry, this.starMaterial, MAX_STAR_PARTICLES);
    this.starMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.starMesh.frustumCulled = false;
    this.starMesh.count = 0;

    this.petalMesh = new InstancedMesh(this.petalGeometry, this.petalMaterial, MAX_PETAL_PARTICLES);
    this.petalMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.petalMesh.frustumCulled = false;
    this.petalMesh.count = 0;

    this.scratchColor.setHex(0xffffff);
    for (let i = 0; i < MAX_STAR_PARTICLES; i++) {
      this.starMesh.setColorAt(i, this.scratchColor);
    }
    for (let i = 0; i < MAX_PETAL_PARTICLES; i++) {
      this.petalMesh.setColorAt(i, this.scratchColor);
    }

    this.root.add(this.starMesh, this.petalMesh);

    for (let i = 0; i < MAX_WAVES; i++) {
      const mat = new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: DoubleSide,
        depthWrite: false,
      });
      const mesh = new Mesh(this.waveGeometry, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.root.add(mesh);
      this.waveSlots.push({
        active: false,
        mesh,
        age: 0,
        duration: 0.5,
        startRadius: 0.4,
        endRadius: 2.0,
      });
    }

    this.scene.add(this.root);
  }

  /** Burst sparkling twinkling stars from `pos`. */
  burstStars(
    pos: Vector3,
    colorHex: number,
    count = 18,
    speed = 4.6,
    scale = 1,
    rainbow = false,
  ): void {
    for (let i = 0; i < count; i++) {
      const angle = this.rand() * Math.PI * 2;
      const elev = 0.22 + this.rand() * 0.88;
      const spd = speed * (0.55 + this.rand() * 0.78);
      let color = colorHex;
      if (rainbow) {
        color = RAINBOW_HEX[Math.floor(this.rand() * RAINBOW_HEX.length)] ?? colorHex;
      } else if (i % 5 === 0) {
        color = 0xffffff;
      }

      this.spawnStar(
        pos.x + (this.rand() - 0.5) * 0.28,
        pos.y + 0.2,
        pos.z + (this.rand() - 0.5) * 0.28,
        Math.cos(angle) * spd * (1 - elev * 0.32),
        elev * spd * 1.18,
        Math.sin(angle) * spd * (1 - elev * 0.32),
        7.0,
        1.55,
        0.44 + this.rand() * 0.36,
        scale * (0.78 + this.rand() * 0.68),
        (this.rand() - 0.5) * 14,
        color,
        18 + this.rand() * 14,
      );
    }
  }

  /** Multi-ring geometric starburst with glittering inner core & sweeping outer star crown. */
  multiRingStarburst(
    pos: Vector3,
    primaryHex: number,
    secondaryHex = 0xffe95c,
    countPerRing = 18,
    speed = 5.4,
    scale = 1.05,
  ): void {
    this.expandingWave(pos, primaryHex, 2.5 * scale, 0.46, 0.32);
    this.expandingWave(pos, secondaryHex, 1.65 * scale, 0.34, 0.2);

    // Inner bright fast planar ring
    for (let i = 0; i < countPerRing; i++) {
      const a = (i / countPerRing) * Math.PI * 2 + this.rand() * 0.14;
      const spd = speed * (0.62 + this.rand() * 0.22);
      const color = i % 3 === 0 ? 0xffffff : secondaryHex;
      this.spawnStar(
        pos.x,
        pos.y + 0.26,
        pos.z,
        Math.cos(a) * spd,
        1.1 + this.rand() * 1.2,
        Math.sin(a) * spd,
        4.2,
        1.9,
        0.38 + this.rand() * 0.18,
        scale * (0.8 + this.rand() * 0.4),
        (this.rand() - 0.5) * 16,
        color,
        24,
      );
    }

    // Outer tilted star halo ring
    const tilt = 0.36;
    for (let i = 0; i < countPerRing; i++) {
      const a = (i / countPerRing) * Math.PI * 2 + 0.16;
      const spd = speed * (1.0 + this.rand() * 0.28);
      const vy = Math.sin(a) * Math.sin(tilt) * spd * 0.65 + 1.85;
      const color = i % 2 === 0 ? primaryHex : secondaryHex;
      this.spawnStar(
        pos.x,
        pos.y + 0.22,
        pos.z,
        Math.cos(a) * spd,
        vy,
        Math.sin(a) * Math.cos(tilt) * spd,
        5.2,
        1.5,
        0.5 + this.rand() * 0.26,
        scale * (0.9 + this.rand() * 0.5),
        (this.rand() - 0.5) * 14,
        color,
        20,
      );
    }
  }

  /** Expanding luminous shockwave ring along the arena floor. */
  expandingWave(
    pos: Vector3,
    colorHex: number,
    endRadius = 2.0,
    duration = 0.48,
    startRadius = 0.35,
  ): void {
    let slot: WaveSlot | undefined;
    for (let i = 0; i < MAX_WAVES; i++) {
      const candidate = this.waveSlots[i];
      if (candidate && !candidate.active) {
        slot = candidate;
        break;
      }
    }
    if (!slot) {
      slot = this.waveSlots[this.waveCursor];
      this.waveCursor = (this.waveCursor + 1) % MAX_WAVES;
    }
    if (!slot) return;

    slot.active = true;
    slot.age = 0;
    slot.duration = duration;
    slot.startRadius = startRadius;
    slot.endRadius = endRadius;
    slot.mesh.position.set(pos.x, -0.42, pos.z);
    slot.mesh.scale.setScalar(startRadius);
    slot.mesh.material.color.setHex(colorHex);
    slot.mesh.material.opacity = 0.92;
    slot.mesh.visible = true;
  }

  /** Multi-color celebratory fireworks & confetti shower for quest completion, emergence & level-ups. */
  fireworks(center: Vector3): void {
    this.expandingWave(center, 0xffe478, 3.4, 0.68, 0.38);
    this.expandingWave(center, 0xff7ae0, 2.5, 0.52, 0.25);
    this.expandingWave(center, 0x5cf6ff, 1.75, 0.4, 0.18);

    const clusters = 4;
    for (let c = 0; c < clusters; c++) {
      const ox = (c === 0 ? 0 : this.rand() - 0.5) * 2.6;
      const oz = (c === 0 ? 0 : this.rand() - 0.5) * 2.6;
      const oy = 0.85 + c * 0.55;
      for (let i = 0; i < 24; i++) {
        const theta = this.rand() * Math.PI * 2;
        const phi = (this.rand() - 0.28) * Math.PI;
        const spd = 3.0 + this.rand() * 3.8;
        const color =
          i % 6 === 0 ? 0xffffff : (RAINBOW_HEX[(i + c * 2) % RAINBOW_HEX.length] ?? 0xffe478);
        this.spawnStar(
          center.x + ox,
          center.y + oy,
          center.z + oz,
          Math.cos(theta) * Math.cos(phi) * spd,
          Math.sin(phi) * spd + 2.1,
          Math.sin(theta) * Math.cos(phi) * spd,
          5.2,
          1.65,
          0.68 + this.rand() * 0.48,
          1.1 + this.rand() * 0.55,
          (this.rand() - 0.5) * 16,
          color,
          22,
        );
      }
      for (let j = 0; j < 10; j++) {
        const a = (j / 10) * Math.PI * 2 + this.rand() * 0.4;
        const spd = 2.4 + this.rand() * 2.8;
        const color = RAINBOW_HEX[(j + c) % RAINBOW_HEX.length] ?? 0xff70d0;
        this.spawnPetal(
          center.x + ox,
          center.y + oy,
          center.z + oz,
          Math.cos(a) * spd,
          2.2 + this.rand() * 2.2,
          Math.sin(a) * spd,
          4.2,
          2.1,
          0.65 + this.rand() * 0.35,
          1.05 + this.rand() * 0.45,
          (this.rand() - 0.5) * 14,
          color,
          0,
        );
      }
    }
  }

  /** Spirit 3×3 flower bloom detonation covering a 3×3 cell neighborhood. */
  spiritBloomExplosion(center: Vector3): void {
    this.expandingWave(center, 0x4dff9a, 2.05, 0.54, 0.35);
    this.expandingWave(center, 0xff8ce0, 1.55, 0.44, 0.22);

    this.emitRadialPetals(center, SPIRIT_PETAL_COLORS, 34, 2.4, 2.7, 1.18);
    this.burstStars(center, 0x4dff9a, 20, 4.4, 0.98, false);
  }

  /** Lush floral petal swirl & golden nectar sparkle burst when planting 3D flowers. */
  flowerBloomBurst(center: Vector3, colorHex = 0xff7ac6): void {
    this.expandingWave(center, colorHex, 2.2, 0.46, 0.3);
    this.expandingWave(center, 0xffe478, 1.45, 0.36, 0.2);
    this.emitRadialPetals(center, FLOWER_BLOOM_COLORS, 24, 2.1, 2.5, 1.08);
    this.multiRingStarburst(center, colorHex, 0xffe478, 14, 4.3, 0.95);
  }

  /** Soft petal puff & sky-cyan shockwave when the butterfly swoops to the floor. */
  butterflyLandBurst(center: Vector3): void {
    this.expandingWave(center, 0x5cf6ff, 3.6, 0.56, 0.42);
    this.expandingWave(center, 0xff7ae0, 2.5, 0.46, 0.28);
    this.expandingWave(center, 0xffe066, 1.7, 0.36, 0.2);
    this.emitRadialPetals(center, BUTTERFLY_COLORS, 32, 2.4, 2.9, 1.15);
    this.multiRingStarburst(center, 0x5cf6ff, 0xff7ae0, 18, 5.2, 1.12);
    this.burstStars(center, 0x5cf6ff, 22, 4.8, 1.1, true);
  }

  /** Symmetrical pink stardust & icy crystal sparkles trailing from both butterfly wings. */
  butterflyWingDust(pos: Vector3, heading: number, wingSpread = 1.1): void {
    const perpX = -Math.sin(heading);
    const perpZ = Math.cos(heading);
    const backX = -Math.cos(heading);
    const backZ = -Math.sin(heading);

    for (let side = -1; side <= 1; side += 2) {
      const offset = wingSpread * (0.65 + this.rand() * 0.48) * side;
      const wx = pos.x + perpX * offset + backX * 0.25;
      const wy = pos.y + 0.16 + (this.rand() - 0.5) * 0.26;
      const wz = pos.z + perpZ * offset + backZ * 0.25;
      const pinkStarColor =
        BUTTERFLY_PINK_DUST_COLORS[Math.floor(this.rand() * BUTTERFLY_PINK_DUST_COLORS.length)] ??
        0xff7ae0;

      // Sparkling pink stardust shed from the wing
      this.spawnStar(
        wx,
        wy,
        wz,
        perpX * side * (0.75 + this.rand() * 0.85) + backX * 0.85,
        0.4 + this.rand() * 0.78,
        perpZ * side * (0.75 + this.rand() * 0.85) + backZ * 0.85,
        0.95,
        2.1,
        0.5 + this.rand() * 0.24,
        0.78 + this.rand() * 0.4,
        (this.rand() - 0.5) * 14,
        pinkStarColor,
        26,
      );

      // Matching icy crystal sparkle drifting from the wing
      const iceColor =
        BUTTERFLY_ICE_SPARK_COLORS[Math.floor(this.rand() * BUTTERFLY_ICE_SPARK_COLORS.length)] ??
        0x7ef8ff;
      this.spawnStar(
        wx + (this.rand() - 0.5) * 0.25,
        wy - 0.06,
        wz + (this.rand() - 0.5) * 0.25,
        perpX * side * (0.45 + this.rand() * 0.6) + backX * 0.5,
        -(0.55 + this.rand() * 0.9),
        perpZ * side * (0.45 + this.rand() * 0.6) + backZ * 0.5,
        4.2,
        1.4,
        0.46 + this.rand() * 0.24,
        0.64 + this.rand() * 0.34,
        (this.rand() - 0.5) * 16,
        iceColor,
        28,
      );

      if (this.rand() > 0.3) {
        const petalColor =
          this.rand() > 0.28
            ? (BUTTERFLY_PINK_DUST_COLORS[
                Math.floor(this.rand() * BUTTERFLY_PINK_DUST_COLORS.length)
              ] ?? 0xffb8eb)
            : 0x7ef8ff;
        this.spawnPetal(
          wx,
          wy,
          wz,
          perpX * side * 0.58 + (this.rand() - 0.5) * 0.52,
          0.25 + this.rand() * 0.55,
          perpZ * side * 0.58 + (this.rand() - 0.5) * 0.52,
          0.8,
          2.4,
          0.48 + this.rand() * 0.22,
          0.66 + this.rand() * 0.32,
          (this.rand() - 0.5) * 10,
          petalColor,
          0,
        );
      }
    }
  }

  /** Falling crystal ice shards & frosty flakes dropping from the butterfly's altitude onto the floor. */
  fallingIceShower(pos: Vector3, spreadRadius = 2.8): void {
    const r = Math.max(0.8, spreadRadius);
    const startBaseY = Math.max(0.65, pos.y);

    for (let i = 0; i < 6; i++) {
      const angle = this.rand() * Math.PI * 2;
      const dist = Math.sqrt(this.rand()) * r;
      const sx = pos.x + Math.cos(angle) * dist;
      const sz = pos.z + Math.sin(angle) * dist;
      const sy = startBaseY + (this.rand() - 0.35) * 0.75;
      const color =
        FALLING_ICE_SHARD_COLORS[Math.floor(this.rand() * FALLING_ICE_SHARD_COLORS.length)] ??
        0x7ef8ff;

      this.spawnStar(
        sx,
        sy,
        sz,
        (this.rand() - 0.5) * 1.15,
        -(3.2 + this.rand() * 2.6),
        (this.rand() - 0.5) * 1.15,
        7.2,
        0.9,
        0.52 + this.rand() * 0.28,
        0.72 + this.rand() * 0.5,
        (this.rand() - 0.5) * 16,
        color,
        26 + this.rand() * 10,
      );
    }

    for (let i = 0; i < 4; i++) {
      const angle = this.rand() * Math.PI * 2;
      const dist = Math.sqrt(this.rand()) * (r * 1.08);
      const fx = pos.x + Math.cos(angle) * dist;
      const fz = pos.z + Math.sin(angle) * dist;
      const fy = startBaseY + (this.rand() - 0.25) * 0.85;
      const color =
        FALLING_ICE_FLAKE_COLORS[Math.floor(this.rand() * FALLING_ICE_FLAKE_COLORS.length)] ??
        0xe8feff;

      this.spawnPetal(
        fx,
        fy,
        fz,
        (this.rand() - 0.5) * 1.35,
        -(2.1 + this.rand() * 1.6),
        (this.rand() - 0.5) * 1.35,
        4.0,
        1.4,
        0.58 + this.rand() * 0.3,
        0.68 + this.rand() * 0.42,
        (this.rand() - 0.5) * 12,
        color,
        18,
      );
    }

    if (this.rand() > 0.48) {
      const ringAngle = this.rand() * Math.PI * 2;
      const ringDist = this.rand() * r * 0.45;
      this.scratchFrostWavePos.set(
        pos.x + Math.cos(ringAngle) * ringDist,
        0,
        pos.z + Math.sin(ringAngle) * ringDist,
      );
      const waveColor = this.rand() > 0.4 ? 0x7ef8ff : 0xd8feff;
      this.expandingWave(
        this.scratchFrostWavePos,
        waveColor,
        Math.max(1.2, r * (0.52 + this.rand() * 0.35)),
        0.48,
        0.24,
      );
    }
  }

  /** Gentle ascending chrysalis shimmer particles while cocooned. */
  cocoonSparkle(pos: Vector3): void {
    const a = this.rand() * Math.PI * 2;
    const r = 0.55 + this.rand() * 0.35;
    const color = this.rand() > 0.45 ? 0xffe066 : 0xff9de6;
    this.spawnStar(
      pos.x + Math.cos(a) * r,
      pos.y + 0.1 + this.rand() * 0.35,
      pos.z + Math.sin(a) * r,
      Math.cos(a + 1.2) * 0.45,
      1.35 + this.rand() * 0.9,
      Math.sin(a + 1.2) * 0.45,
      -0.4,
      1.8,
      0.42 + this.rand() * 0.22,
      0.68 + this.rand() * 0.32,
      10,
      color,
      20,
    );
  }

  /** Continuous soft glowing body/tail spark emitted along the snake's spine. */
  bodyTrailSpark(pos: Vector3, colorHex: number, scale = 0.72, rainbow = false): void {
    const color = rainbow
      ? (RAINBOW_HEX[Math.floor(this.rand() * RAINBOW_HEX.length)] ?? colorHex)
      : this.rand() > 0.72
        ? 0xffffff
        : colorHex;
    this.spawnStar(
      pos.x + (this.rand() - 0.5) * 0.34,
      pos.y + 0.08 + this.rand() * 0.22,
      pos.z + (this.rand() - 0.5) * 0.34,
      (this.rand() - 0.5) * 0.55,
      0.5 + this.rand() * 0.75,
      (this.rand() - 0.5) * 0.55,
      0.8,
      2.4,
      0.34 + this.rand() * 0.18,
      scale * (0.72 + this.rand() * 0.42),
      (this.rand() - 0.5) * 11,
      color,
      18,
    );
  }

  /** Electric thunder impact burst with crisp white-cyan core sparks & ground shockwaves. */
  thunderStrikeBurst(pos: Vector3, colorHex = 0x5cf6ff): void {
    this.expandingWave(pos, 0xffe066, 3.0, 0.45, 0.32);
    this.expandingWave(pos, colorHex, 2.0, 0.35, 0.2);

    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + this.rand() * 0.2;
      const spd = 4.2 + this.rand() * 3.8;
      const color = i % 3 === 0 ? 0xffffff : i % 2 === 0 ? colorHex : 0xffe066;
      this.spawnStar(
        pos.x,
        pos.y + 0.15,
        pos.z,
        Math.cos(a) * spd,
        2.0 + this.rand() * 3.4,
        Math.sin(a) * spd,
        6.5,
        1.7,
        0.38 + this.rand() * 0.24,
        0.9 + this.rand() * 0.45,
        (this.rand() - 0.5) * 18,
        color,
        28,
      );
    }
  }

  /** 360° roaring crimson-amber dragon flame blast. */
  aoeFireBurst(center: Vector3): void {
    this.expandingWave(center, 0xff5522, 7.2, 0.66, 0.5);
    this.expandingWave(center, 0xffbe3b, 5.4, 0.54, 0.32);
    this.expandingWave(center, 0xfff3a8, 3.6, 0.4, 0.2);
    this.emitRadialPetals(center, AOE_FIRE_COLORS, 38, 4.4, 4.8, 1.32);
    this.multiRingStarburst(center, 0xff5522, 0xffe45c, 20, 7.4, 1.35);
    this.burstStars(center, 0xff7b29, 32, 7.6, 1.35, false);
  }

  /** 360° swirling aqua tsunami wave & water-droplet splash burst. */
  aoeWaterBurst(center: Vector3): void {
    this.expandingWave(center, 0x1ee3ff, 7.4, 0.68, 0.45);
    this.expandingWave(center, 0x8cf8ff, 5.5, 0.54, 0.26);
    this.expandingWave(center, 0xffffff, 3.7, 0.4, 0.18);
    this.emitRadialPetals(center, AOE_WATER_COLORS, 38, 4.2, 4.6, 1.26);
    this.multiRingStarburst(center, 0x1ee3ff, 0xeaffff, 20, 7.0, 1.3);
    this.burstStars(center, 0x8cf8ff, 30, 7.0, 1.3, false);
  }

  /** 360° violet-gold cosmic starlight supernova explosion. */
  aoeArcaneBurst(center: Vector3): void {
    this.expandingWave(center, 0xd96bff, 7.6, 0.7, 0.45);
    this.expandingWave(center, 0xffe66d, 5.6, 0.56, 0.3);
    this.expandingWave(center, 0x7df9ff, 3.8, 0.42, 0.2);
    this.emitRadialPetals(center, AOE_ARCANE_COLORS, 40, 4.5, 4.9, 1.32);
    this.multiRingStarburst(center, 0xd96bff, 0xffe66d, 22, 7.8, 1.38);
    this.burstStars(center, 0xd96bff, 34, 7.8, 1.38, true);
  }

  private emitRadialPetals(
    center: Vector3,
    colors: readonly number[],
    count: number,
    minSpeed: number,
    speedSpan: number,
    scale: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + this.rand() * 0.28;
      const spd = minSpeed + this.rand() * speedSpan;
      const color = colors[i % colors.length] ?? 0xffffff;
      this.spawnPetal(
        center.x,
        center.y + 0.2,
        center.z,
        Math.cos(angle) * spd,
        1.9 + this.rand() * 2.5,
        Math.sin(angle) * spd,
        4.6,
        2.0,
        0.54 + this.rand() * 0.34,
        scale + this.rand() * 0.42,
        (this.rand() - 0.5) * 11,
        color,
        0,
      );
    }
  }

  /** Multi-spark speed trail emitted behind the dashing snake head. */
  dashSpark(pos: Vector3, dirX: number, dirZ: number, colorHex: number): void {
    const spread = 0.6;
    for (let i = 0; i < 2; i++) {
      const sparkColor = i === 0 ? colorHex : 0xffffff;
      this.spawnStar(
        pos.x - dirX * 0.38 + (this.rand() - 0.5) * spread,
        pos.y + 0.1 + this.rand() * 0.28,
        pos.z - dirZ * 0.38 + (this.rand() - 0.5) * spread,
        -dirX * (1.4 + this.rand() * 1.6) + (this.rand() - 0.5) * 0.9,
        0.75 + this.rand() * 0.95,
        -dirZ * (1.4 + this.rand() * 1.6) + (this.rand() - 0.5) * 0.9,
        2.4,
        2.3,
        0.28 + this.rand() * 0.18,
        (i === 0 ? 0.8 : 0.62) + this.rand() * 0.42,
        11,
        sparkColor,
        20,
      );
    }
    this.spawnPetal(
      pos.x - dirX * 0.42 + (this.rand() - 0.5) * 0.45,
      pos.y + 0.08 + this.rand() * 0.2,
      pos.z - dirZ * 0.42 + (this.rand() - 0.5) * 0.45,
      -dirX * (1.1 + this.rand() * 1.1) + (this.rand() - 0.5) * 0.6,
      0.45 + this.rand() * 0.65,
      -dirZ * (1.1 + this.rand() * 1.1) + (this.rand() - 0.5) * 0.6,
      1.8,
      2.6,
      0.24 + this.rand() * 0.12,
      0.65 + this.rand() * 0.3,
      9,
      colorHex,
      0,
    );
  }

  /** Forward-jetting 60fps elemental breath stream emitted from the snake's mouth. */
  sprayStreamJet(origin: Vector3, dirX: number, dirZ: number, form: SnakeForm): void {
    const len = Math.hypot(dirX, dirZ);
    const nx = len > 1e-5 ? dirX / len : 0;
    const nz = len > 1e-5 ? dirZ / len : 1;
    const baseAngle = Math.atan2(nz, nx);

    switch (form) {
      case 'dragon': {
        for (let i = 0; i < 7; i++) {
          const a = baseAngle + (this.rand() - 0.5) * 0.56;
          const spd = 6.8 + this.rand() * 4.4;
          this.spawnPetal(
            origin.x + (this.rand() - 0.5) * 0.24,
            origin.y + (this.rand() - 0.5) * 0.18,
            origin.z + (this.rand() - 0.5) * 0.24,
            Math.cos(a) * spd,
            0.55 + this.rand() * 1.5,
            Math.sin(a) * spd,
            -2.4,
            2.15,
            0.25 + this.rand() * 0.15,
            0.9 + this.rand() * 0.54,
            (this.rand() - 0.5) * 13,
            FIRE_SPRAY_COLORS[i % FIRE_SPRAY_COLORS.length] ?? 0xffe054,
            0,
          );
        }
        for (let i = 0; i < 6; i++) {
          const a = baseAngle + (this.rand() - 0.5) * 0.68;
          const spd = 4.9 + this.rand() * 4.1;
          this.spawnStar(
            origin.x + (this.rand() - 0.5) * 0.3,
            origin.y + this.rand() * 0.16,
            origin.z + (this.rand() - 0.5) * 0.3,
            Math.cos(a) * spd,
            1.6 + this.rand() * 2.1,
            Math.sin(a) * spd,
            -4.4,
            1.75,
            0.35 + this.rand() * 0.19,
            0.6 + this.rand() * 0.44,
            (this.rand() - 0.5) * 16,
            FIRE_SPRAY_COLORS[(i + 1) % FIRE_SPRAY_COLORS.length] ?? 0xff9b29,
            22,
          );
        }
        break;
      }
      case 'phoenix': {
        for (let i = 0; i < 9; i++) {
          const a = baseAngle + (this.rand() - 0.5) * 0.96;
          const spd = 6.2 + this.rand() * 4.5;
          this.spawnStar(
            origin.x + (this.rand() - 0.5) * 0.32,
            origin.y + (this.rand() - 0.5) * 0.24,
            origin.z + (this.rand() - 0.5) * 0.32,
            Math.cos(a) * spd,
            0.65 + this.rand() * 1.5,
            Math.sin(a) * spd,
            1.7,
            1.65,
            0.34 + this.rand() * 0.19,
            0.74 + this.rand() * 0.52,
            (this.rand() - 0.5) * 18,
            ICE_SPRAY_COLORS[i % ICE_SPRAY_COLORS.length] ?? 0x38f6ff,
            24,
          );
        }
        for (let i = 0; i < 5; i++) {
          const a = baseAngle + (this.rand() - 0.5) * 0.82;
          const spd = 5.2 + this.rand() * 3.2;
          this.spawnPetal(
            origin.x + (this.rand() - 0.5) * 0.26,
            origin.y + (this.rand() - 0.5) * 0.18,
            origin.z + (this.rand() - 0.5) * 0.26,
            Math.cos(a) * spd,
            0.4 + this.rand() * 1.1,
            Math.sin(a) * spd,
            0.55,
            2.25,
            0.3 + this.rand() * 0.14,
            0.82 + this.rand() * 0.38,
            (this.rand() - 0.5) * 11,
            i % 2 === 0 ? 0xe8feff : 0x5cf6ff,
            0,
          );
        }
        break;
      }
      case 'unicorn': {
        for (let i = 0; i < 8; i++) {
          const a = baseAngle + (this.rand() - 0.5) * 0.48;
          const spd = 7.6 + this.rand() * 4.2;
          this.spawnPetal(
            origin.x + (this.rand() - 0.5) * 0.22,
            origin.y + (this.rand() - 0.5) * 0.16,
            origin.z + (this.rand() - 0.5) * 0.22,
            Math.cos(a) * spd,
            2.2 + this.rand() * 1.8,
            Math.sin(a) * spd,
            11.4,
            1.15,
            0.38 + this.rand() * 0.18,
            0.78 + this.rand() * 0.42,
            (this.rand() - 0.5) * 13,
            WATER_SPRAY_COLORS[i % WATER_SPRAY_COLORS.length] ?? 0x8efaff,
            0,
          );
        }
        for (let i = 0; i < 5; i++) {
          const a = baseAngle + (this.rand() - 0.5) * 0.56;
          const spd = 7.0 + this.rand() * 3.0;
          this.spawnStar(
            origin.x + (this.rand() - 0.5) * 0.24,
            origin.y + this.rand() * 0.18,
            origin.z + (this.rand() - 0.5) * 0.24,
            Math.cos(a) * spd,
            1.7 + this.rand() * 1.3,
            Math.sin(a) * spd,
            9.2,
            1.35,
            0.3 + this.rand() * 0.14,
            0.68 + this.rand() * 0.34,
            (this.rand() - 0.5) * 15,
            i % 2 === 0 ? 0xffffff : 0x72f6ff,
            20,
          );
        }
        break;
      }
      case 'spirit': {
        for (let i = 0; i < 7; i++) {
          const a = baseAngle + (this.rand() - 0.5) * 0.78;
          const spd = 4.6 + this.rand() * 3.2;
          this.spawnPetal(
            origin.x + (this.rand() - 0.5) * 0.3,
            origin.y + (this.rand() - 0.5) * 0.2,
            origin.z + (this.rand() - 0.5) * 0.3,
            Math.cos(a) * spd,
            0.65 + this.rand() * 1.3,
            Math.sin(a) * spd,
            0.45,
            2.7,
            0.44 + this.rand() * 0.22,
            0.76 + this.rand() * 0.4,
            (this.rand() - 0.5) * 9,
            SILK_SPRAY_COLORS[i % SILK_SPRAY_COLORS.length] ?? 0xf4fff9,
            0,
          );
        }
        for (let i = 0; i < 5; i++) {
          const a = baseAngle + (this.rand() - 0.5) * 0.84;
          const spd = 4.0 + this.rand() * 2.8;
          this.spawnStar(
            origin.x + (this.rand() - 0.5) * 0.3,
            origin.y + this.rand() * 0.2,
            origin.z + (this.rand() - 0.5) * 0.3,
            Math.cos(a) * spd,
            0.85 + this.rand() * 1.2,
            Math.sin(a) * spd,
            -0.9,
            2.5,
            0.42 + this.rand() * 0.18,
            0.64 + this.rand() * 0.34,
            (this.rand() - 0.5) * 11,
            i % 2 === 0 ? 0x4dff9a : 0xffffff,
            20,
          );
        }
        break;
      }
    }
  }

  /** Vivid elemental impact burst on bots and hazards. */
  sprayImpactBurst(pos: Vector3, form: SnakeForm): void {
    switch (form) {
      case 'dragon':
        this.expandingWave(pos, 0xff5e2b, 2.05, 0.4, 0.32);
        this.expandingWave(pos, 0xffe45c, 1.38, 0.3, 0.2);
        this.emitRadialPetals(pos, FIRE_IMPACT_COLORS, 18, 3.0, 3.2, 1.12);
        this.burstStars(pos, 0xffe45c, 22, 5.2, 1.12, false);
        break;
      case 'phoenix':
        this.expandingWave(pos, 0x38f6ff, 2.1, 0.42, 0.3);
        this.expandingWave(pos, 0xe8feff, 1.38, 0.3, 0.18);
        this.burstStars(pos, 0x5cf6ff, 24, 5.2, 1.15, false);
        this.emitRadialPetals(pos, ICE_IMPACT_COLORS, 14, 2.4, 2.6, 1.0);
        break;
      case 'unicorn':
        this.expandingWave(pos, 0x25b8ff, 2.15, 0.44, 0.3);
        this.expandingWave(pos, 0x9cfcff, 1.45, 0.32, 0.2);
        this.emitRadialPetals(pos, WATER_IMPACT_COLORS, 20, 3.2, 3.2, 1.06);
        this.burstStars(pos, 0xeaffff, 18, 4.8, 1.02, false);
        break;
      case 'spirit':
        this.expandingWave(pos, 0x4dff9a, 2.05, 0.44, 0.3);
        this.expandingWave(pos, 0xf2fff8, 1.4, 0.34, 0.2);
        this.emitRadialPetals(pos, SILK_IMPACT_COLORS, 16, 2.4, 2.4, 1.02);
        this.burstStars(pos, 0x5effa8, 18, 4.4, 1.02, false);
        break;
    }
  }

  /** Progressive segment-chomp confetti & sparkle shower scaled by `streak`. */
  chompBurst(pos: Vector3, colorHex: number, streak: number): void {
    const s = Math.max(1, Math.floor(streak));
    const intensity = Math.min(1, (s - 1) / 8);
    const starCount = Math.min(40, 22 + Math.floor(s * 2.0));
    const petalCount = Math.min(26, 14 + Math.floor(s * 1.4));

    this.burstStars(
      pos,
      colorHex,
      starCount,
      4.8 + intensity * 2.4,
      1.0 + intensity * 0.48,
      s >= 3,
    );

    // High-arcing confetti shower
    for (let i = 0; i < petalCount; i++) {
      const angle = (i / petalCount) * Math.PI * 2 + this.rand() * 0.38;
      const spd = (2.6 + this.rand() * 2.6) * (1 + intensity * 0.38);
      const color =
        i % 4 === 0
          ? colorHex
          : (CHOMP_CONFETTI_COLORS[i % CHOMP_CONFETTI_COLORS.length] ?? colorHex);
      this.spawnPetal(
        pos.x + (this.rand() - 0.5) * 0.26,
        pos.y + 0.22,
        pos.z + (this.rand() - 0.5) * 0.26,
        Math.cos(angle) * spd,
        2.9 + this.rand() * (2.6 + intensity * 1.5),
        Math.sin(angle) * spd,
        5.4,
        1.7,
        0.44 + this.rand() * 0.28,
        1.0 + intensity * 0.38 + this.rand() * 0.36,
        (this.rand() - 0.5) * 15,
        color,
        0,
      );
    }

    this.expandingWave(pos, colorHex, 1.65 + intensity * 1.45, 0.36 + intensity * 0.14, 0.3);
    this.expandingWave(pos, 0xffe95c, 1.15 + intensity * 0.95, 0.28 + intensity * 0.1, 0.2);
    if (s >= 3) {
      const innerHex = RAINBOW_HEX[s % RAINBOW_HEX.length] ?? 0xff70d0;
      this.expandingWave(pos, innerHex, 2.2 + intensity * 1.2, 0.44, 0.34);
    }
  }

  /** Advance all active stars, petals and wave rings. */
  update(delta: number): void {
    const dt = Math.min(Math.max(delta, 0), 0.1);
    if (dt <= 0) return;

    this.stepInstancedPool(this.starSlots, this.starMesh, dt, false);
    this.stepInstancedPool(this.petalSlots, this.petalMesh, dt, true);

    for (let i = 0; i < MAX_WAVES; i++) {
      const w = this.waveSlots[i];
      if (!w || !w.active) continue;
      w.age += dt;
      if (w.age >= w.duration) {
        w.active = false;
        w.mesh.visible = false;
        continue;
      }
      const t = w.age / w.duration;
      const eased = 1 - Math.pow(1 - t, 2.2);
      const radius = w.startRadius + (w.endRadius - w.startRadius) * eased;
      w.mesh.scale.setScalar(radius);
      w.mesh.material.opacity = 0.9 * (1 - t);
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.starGeometry.dispose();
    this.starMaterial.dispose();
    this.petalGeometry.dispose();
    this.petalMaterial.dispose();
    this.waveGeometry.dispose();
    for (let i = 0; i < this.waveSlots.length; i++) {
      this.waveSlots[i]?.mesh.material.dispose();
    }
  }

  private stepInstancedPool(
    slots: ParticleSlot[],
    mesh: InstancedMesh,
    dt: number,
    flattenPetal: boolean,
  ): void {
    let activeCount = 0;
    const damp = Math.exp(-1 * dt);
    const colorBoost = flattenPetal ? 1.05 : 1.18;

    for (let i = 0; i < slots.length; i++) {
      const p = slots[i];
      if (!p || !p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        continue;
      }

      const dragFactor = Math.max(0, 1 - p.drag * dt);
      p.vx *= dragFactor * damp;
      p.vz *= dragFactor * damp;
      p.vy -= p.gravity * dt;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < -0.44) {
        p.y = -0.44;
        p.vy = Math.abs(p.vy) * 0.25;
      }

      const lifeRatio = 1 - p.age / p.life;
      const flicker =
        p.twinkle > 0 ? 0.68 + 0.44 * Math.abs(Math.sin(p.age * p.twinkle + p.spin)) : 1;
      const s = p.baseScale * Math.sin(lifeRatio * Math.PI * 0.5) * flicker;

      this.scratchPos.set(p.x, p.y, p.z);
      this.scratchEuler.set(p.age * p.spin, p.age * p.spin * 0.8, p.age * 2);
      this.scratchQuat.setFromEuler(this.scratchEuler);
      if (flattenPetal) {
        this.scratchScale.set(s * 1.28, s * 0.42, s * 0.92);
      } else {
        this.scratchScale.set(s, s, s);
      }
      this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.scratchScale);
      mesh.setMatrixAt(activeCount, this.scratchMatrix);
      this.scratchColor.setHex(p.color).multiplyScalar(colorBoost);
      mesh.setColorAt(activeCount, this.scratchColor);
      activeCount += 1;
    }

    mesh.count = activeCount;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private spawnStar(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    gravity: number,
    drag: number,
    life: number,
    baseScale: number,
    spin: number,
    color: number,
    twinkle: number,
  ): void {
    const slot = this.starSlots[this.starCursor];
    this.starCursor = (this.starCursor + 1) % MAX_STAR_PARTICLES;
    if (!slot) return;
    slot.active = true;
    slot.age = 0;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.vx = vx;
    slot.vy = vy;
    slot.vz = vz;
    slot.gravity = gravity;
    slot.drag = drag;
    slot.life = life;
    slot.baseScale = baseScale;
    slot.spin = spin;
    slot.color = color;
    slot.twinkle = twinkle;
  }

  private spawnPetal(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    gravity: number,
    drag: number,
    life: number,
    baseScale: number,
    spin: number,
    color: number,
    twinkle: number,
  ): void {
    const slot = this.petalSlots[this.petalCursor];
    this.petalCursor = (this.petalCursor + 1) % MAX_PETAL_PARTICLES;
    if (!slot) return;
    slot.active = true;
    slot.age = 0;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.vx = vx;
    slot.vy = vy;
    slot.vz = vz;
    slot.gravity = gravity;
    slot.drag = drag;
    slot.life = life;
    slot.baseScale = baseScale;
    slot.spin = spin;
    slot.color = color;
    slot.twinkle = twinkle;
  }

  private rand(): number {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }
}
