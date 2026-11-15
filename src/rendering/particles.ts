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

const MAX_STAR_PARTICLES = 320;
const MAX_PETAL_PARTICLES = 160;
const MAX_WAVES = 24;

const RAINBOW_HEX = [
  0xff70d0, // pastel pink
  0xffb357, // peach gold
  0xffe95c, // starlight yellow
  0x5effa8, // spirit mint
  0x48efff, // phoenix cyan
  0xc082ff, // crystal lavender
] as const;

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
    });
  }
  return arr;
}

/**
 * Pooled 3D particle & expanding light-wave system for sparkles, morph waves,
 * Spirit 3×3 flower blooms, speed streaks and multi-color fireworks.
 */
export class ParticleSystem {
  private readonly root = new Group();
  private readonly starGeometry = new OctahedronGeometry(0.14, 0);
  private readonly starMaterial = new MeshBasicMaterial({ color: 0xffffff });
  private readonly starMesh: InstancedMesh;
  private readonly starSlots = createEmptySlots(MAX_STAR_PARTICLES);
  private starCursor = 0;

  private readonly petalGeometry = new SphereGeometry(0.13, 8, 6);
  private readonly petalMaterial = new MeshBasicMaterial({ color: 0xffffff });
  private readonly petalMesh: InstancedMesh;
  private readonly petalSlots = createEmptySlots(MAX_PETAL_PARTICLES);
  private petalCursor = 0;

  private readonly waveGeometry = new RingGeometry(0.76, 1.0, 32);
  private readonly waveSlots: WaveSlot[] = [];

  private readonly scratchMatrix = new Matrix4();
  private readonly scratchPos = new Vector3();
  private readonly scratchScale = new Vector3();
  private readonly scratchQuat = new Quaternion();
  private readonly scratchEuler = new Euler();
  private readonly scratchColor = new Color();

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

    // Initialize instanceColor attributes up front.
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

  /** Burst sparkling stars from `pos`. */
  burstStars(
    pos: Vector3,
    colorHex: number,
    count = 16,
    speed = 4.2,
    scale = 1,
    rainbow = false,
  ): void {
    for (let i = 0; i < count; i++) {
      const angle = this.rand() * Math.PI * 2;
      const elev = 0.25 + this.rand() * 0.85;
      const spd = speed * (0.55 + this.rand() * 0.7);
      const color = rainbow
        ? (RAINBOW_HEX[Math.floor(this.rand() * RAINBOW_HEX.length)] ?? colorHex)
        : colorHex;

      this.spawnStar({
        x: pos.x + (this.rand() - 0.5) * 0.25,
        y: pos.y + 0.2,
        z: pos.z + (this.rand() - 0.5) * 0.25,
        vx: Math.cos(angle) * spd * (1 - elev * 0.35),
        vy: elev * spd * 1.15,
        vz: Math.sin(angle) * spd * (1 - elev * 0.35),
        gravity: 7.5,
        drag: 1.6,
        life: 0.42 + this.rand() * 0.35,
        baseScale: scale * (0.75 + this.rand() * 0.65),
        spin: (this.rand() - 0.5) * 12,
        color,
      });
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
    const slot = this.waveSlots.find((w) => !w.active) ?? this.waveSlots[0];
    if (!slot) return;
    slot.active = true;
    slot.age = 0;
    slot.duration = duration;
    slot.startRadius = startRadius;
    slot.endRadius = endRadius;
    slot.mesh.position.set(pos.x, -0.42, pos.z);
    slot.mesh.scale.setScalar(startRadius);
    slot.mesh.material.color.setHex(colorHex);
    slot.mesh.material.opacity = 0.9;
    slot.mesh.visible = true;
  }

  /** Multi-color celebratory fireworks for quest completion and level-ups. */
  fireworks(center: Vector3): void {
    this.expandingWave(center, 0xffe478, 2.9, 0.65, 0.35);
    this.expandingWave(center, 0xff7ae0, 2.1, 0.5, 0.25);

    const clusters = 3;
    for (let c = 0; c < clusters; c++) {
      const ox = (c === 0 ? 0 : this.rand() - 0.5) * 2.2;
      const oz = (c === 0 ? 0 : this.rand() - 0.5) * 2.2;
      const oy = 0.9 + c * 0.55;
      for (let i = 0; i < 22; i++) {
        const theta = this.rand() * Math.PI * 2;
        const phi = (this.rand() - 0.3) * Math.PI;
        const spd = 2.8 + this.rand() * 3.4;
        const color = RAINBOW_HEX[(i + c * 2) % RAINBOW_HEX.length] ?? 0xffe478;
        this.spawnStar({
          x: center.x + ox,
          y: center.y + oy,
          z: center.z + oz,
          vx: Math.cos(theta) * Math.cos(phi) * spd,
          vy: Math.sin(phi) * spd + 1.8,
          vz: Math.sin(theta) * Math.cos(phi) * spd,
          gravity: 5.5,
          drag: 1.8,
          life: 0.65 + this.rand() * 0.45,
          baseScale: 1.05 + this.rand() * 0.5,
          spin: (this.rand() - 0.5) * 14,
          color,
        });
      }
    }
  }

  /** Spirit 3×3 flower bloom detonation covering a 3×3 cell neighborhood. */
  spiritBloomExplosion(center: Vector3): void {
    this.expandingWave(center, 0x4dff9a, 1.85, 0.52, 0.35);
    this.expandingWave(center, 0xff8ce0, 1.45, 0.42, 0.2);

    // Spiraling 5-petal blossom burst + emerald sparkles across the 3x3 area.
    const petalColors = [0xff8ce0, 0xffb8eb, 0x4dff9a, 0xfff099] as const;
    for (let i = 0; i < 28; i++) {
      const angle = (i / 28) * Math.PI * 2 + this.rand() * 0.25;
      const spd = 2.4 + this.rand() * 2.5;
      const color = petalColors[i % petalColors.length] ?? 0xff8ce0;
      this.spawnPetal({
        x: center.x,
        y: center.y + 0.18,
        z: center.z,
        vx: Math.cos(angle) * spd,
        vy: 1.6 + this.rand() * 2.1,
        vz: Math.sin(angle) * spd,
        gravity: 4.5,
        drag: 2.1,
        life: 0.55 + this.rand() * 0.3,
        baseScale: 1.15 + this.rand() * 0.45,
        spin: (this.rand() - 0.5) * 9,
        color,
      });
    }
    this.burstStars(center, 0x4dff9a, 14, 4.0, 0.9, false);
  }

  /** Tiny speed-trail spark emitted behind the dashing snake head. */
  dashSpark(pos: Vector3, dirX: number, dirZ: number, colorHex: number): void {
    const spread = 0.55;
    this.spawnStar({
      x: pos.x - dirX * 0.35 + (this.rand() - 0.5) * spread,
      y: pos.y + 0.1 + this.rand() * 0.25,
      z: pos.z - dirZ * 0.35 + (this.rand() - 0.5) * spread,
      vx: -dirX * (1.2 + this.rand() * 1.4) + (this.rand() - 0.5) * 0.8,
      vy: 0.7 + this.rand() * 0.9,
      vz: -dirZ * (1.2 + this.rand() * 1.4) + (this.rand() - 0.5) * 0.8,
      gravity: 2.5,
      drag: 2.4,
      life: 0.26 + this.rand() * 0.16,
      baseScale: 0.7 + this.rand() * 0.4,
      spin: 9,
      color: colorHex,
    });
  }

  /** Advance all active stars, petals and wave rings. */
  update(delta: number): void {
    const dt = Math.min(Math.max(delta, 0), 0.1);
    if (dt <= 0) return;

    this.stepInstancedPool(this.starSlots, this.starMesh, dt, false);
    this.stepInstancedPool(this.petalSlots, this.petalMesh, dt, true);

    for (const w of this.waveSlots) {
      if (!w.active) continue;
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
      w.mesh.material.opacity = 0.88 * (1 - t);
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.starGeometry.dispose();
    this.starMaterial.dispose();
    this.petalGeometry.dispose();
    this.petalMaterial.dispose();
    this.waveGeometry.dispose();
    for (const w of this.waveSlots) {
      w.mesh.material.dispose();
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

    for (const p of slots) {
      if (!p.active) continue;
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
      const s = p.baseScale * Math.sin(lifeRatio * Math.PI * 0.5);

      this.scratchPos.set(p.x, p.y, p.z);
      this.scratchEuler.set(p.age * p.spin, p.age * p.spin * 0.8, p.age * 2);
      this.scratchQuat.setFromEuler(this.scratchEuler);
      if (flattenPetal) {
        this.scratchScale.set(s * 1.25, s * 0.42, s * 0.9);
      } else {
        this.scratchScale.set(s, s, s);
      }
      this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.scratchScale);
      mesh.setMatrixAt(activeCount, this.scratchMatrix);
      this.scratchColor.setHex(p.color);
      mesh.setColorAt(activeCount, this.scratchColor);
      activeCount += 1;
    }

    mesh.count = activeCount;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private spawnStar(cfg: Omit<ParticleSlot, 'active' | 'age'>): void {
    const slot = this.starSlots[this.starCursor];
    this.starCursor = (this.starCursor + 1) % MAX_STAR_PARTICLES;
    if (!slot) return;
    Object.assign(slot, cfg, { active: true, age: 0 });
  }

  private spawnPetal(cfg: Omit<ParticleSlot, 'active' | 'age'>): void {
    const slot = this.petalSlots[this.petalCursor];
    this.petalCursor = (this.petalCursor + 1) % MAX_PETAL_PARTICLES;
    if (!slot) return;
    Object.assign(slot, cfg, { active: true, age: 0 });
  }

  private rand(): number {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }
}
