import {
  BoxGeometry,
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  type Material,
  type Scene,
} from 'three';
import type { BotMagicKind, GameState } from '../core/types';

const MAX_PROJECTILES = 32;
const MAX_TELEGRAPHS = 12;
const TRAIL_SEGMENTS = 5;
const PROJECTILE_Y = 0.85;
const DEFAULT_WARNING_TICKS = 10;

const KINDS: readonly BotMagicKind[] = ['bolt', 'fire_spread', 'frost_orb', 'arcane_homing'];

interface SpellStyle {
  readonly core: number;
  readonly glow: number;
  readonly trail: number;
  readonly accent: number;
}

/** Hostile magic is always warm/danger-coloured or crystal-white so it never reads as a friendly spray. */
export const SPELL_STYLE: Readonly<Record<BotMagicKind, SpellStyle>> = {
  bolt: { core: 0xfff1c8, glow: 0xff2e12, trail: 0xff5a1f, accent: 0xffb347 },
  fire_spread: { core: 0xffe14d, glow: 0xff7a00, trail: 0xff4a00, accent: 0xffb000 },
  frost_orb: { core: 0xffffff, glow: 0x25d9ff, trail: 0x7fdcff, accent: 0xc8f6ff },
  arcane_homing: { core: 0xf5dcff, glow: 0x9d2dff, trail: 0xc06bff, accent: 0xe39bff },
};

function kindIndex(kind: BotMagicKind): number {
  switch (kind) {
    case 'bolt':
      return 0;
    case 'fire_spread':
      return 1;
    case 'frost_orb':
      return 2;
    case 'arcane_homing':
      return 3;
  }
}

interface KindMaterials {
  readonly core: MeshBasicMaterial;
  readonly glow: MeshBasicMaterial;
  readonly trail: MeshBasicMaterial;
  readonly accent: MeshBasicMaterial;
  readonly aim: MeshBasicMaterial;
}

interface ProjectileSlot {
  readonly group: Group;
  readonly core: Mesh;
  readonly shard: Mesh;
  readonly glow: Mesh;
  readonly ring: Mesh;
  readonly orbA: Mesh;
  readonly orbB: Mesh;
  readonly trail: Mesh[];
  id: number;
  stamp: number;
  kind: number;
  prevX: number;
  prevZ: number;
  x: number;
  z: number;
  dx: number;
  dz: number;
  ttl: number;
  maxTtl: number;
  phase: number;
}

interface TelegraphSlot {
  readonly group: Group;
  readonly outer: Mesh;
  readonly inner: Mesh;
  readonly flare: Mesh;
  readonly aim: Mesh;
  botId: number;
  stamp: number;
  kind: number;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  ticks: number;
  maxTicks: number;
}

/**
 * Pooled 3D renderer for "Thử Thách Sinh Tồn" hostile bot magic: projectiles in
 * flight (4 distinct looks) and the telegraph ring/flare/aim-strip above a bot
 * that is charging a spell. `draw()` performs zero allocations.
 */
export class HostileMagicView {
  private readonly root = new Group();

  private readonly sphereGeo = new SphereGeometry(1, 14, 10);
  private readonly shardGeo = new OctahedronGeometry(1, 0);
  private readonly ringGeo = new TorusGeometry(1, 0.07, 8, 28);
  private readonly telegraphRingGeo = new TorusGeometry(1, 0.12, 8, 36);
  private readonly flatRingGeo = new TorusGeometry(1, 0.05, 6, 32);
  private readonly discGeo = new CircleGeometry(1, 24);
  private readonly aimGeo = new BoxGeometry(0.45, 0.02, 1);

  private readonly mats: KindMaterials[] = [];
  private readonly dangerRingMat = new MeshBasicMaterial({
    color: 0xff2a2a,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  });
  private readonly shadowMat = new MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });

  private readonly projectiles: ProjectileSlot[] = [];
  private readonly projectileById = new Map<number, ProjectileSlot>();
  private readonly telegraphs: TelegraphSlot[] = [];
  private readonly telegraphByBot = new Map<number, TelegraphSlot>();
  private stamp = 0;

  /** True when at least one hostile object is visible (cheap early-out for draw). */
  private anyActive = false;

  constructor(private readonly scene: Scene) {
    for (const kind of KINDS) {
      const s = SPELL_STYLE[kind];
      this.mats.push({
        core: new MeshBasicMaterial({ color: s.core }),
        glow: new MeshBasicMaterial({
          color: s.glow,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
        }),
        trail: new MeshBasicMaterial({
          color: s.trail,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
        }),
        accent: new MeshBasicMaterial({ color: s.accent }),
        aim: new MeshBasicMaterial({
          color: s.glow,
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
          side: DoubleSide,
        }),
      });
    }
    const first = this.mats[0];
    if (!first) throw new Error('hostile magic materials missing');

    for (let i = 0; i < MAX_PROJECTILES; i++) this.projectiles.push(this.buildProjectile(first));
    for (let i = 0; i < MAX_TELEGRAPHS; i++) this.telegraphs.push(this.buildTelegraph(first));
    this.root.frustumCulled = false;
    this.scene.add(this.root);
  }

  private buildProjectile(m: KindMaterials): ProjectileSlot {
    const group = new Group();
    group.visible = false;

    const shadow = new Mesh(this.discGeo, this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.04 - PROJECTILE_Y;
    shadow.scale.setScalar(0.85);
    shadow.renderOrder = 1;
    const danger = new Mesh(this.flatRingGeo, this.dangerRingMat);
    danger.rotation.x = -Math.PI / 2;
    danger.position.y = 0.06 - PROJECTILE_Y;
    danger.scale.setScalar(0.95);
    danger.renderOrder = 2;

    const glow = new Mesh(this.sphereGeo, m.glow);
    glow.scale.setScalar(0.78);
    const core = new Mesh(this.sphereGeo, m.core);
    core.scale.setScalar(0.34);
    const shard = new Mesh(this.shardGeo, m.core);
    shard.scale.set(0.3, 0.46, 0.3);
    const ring = new Mesh(this.ringGeo, m.accent);
    ring.scale.setScalar(0.62);
    const orbA = new Mesh(this.sphereGeo, m.accent);
    orbA.scale.setScalar(0.17);
    const orbB = new Mesh(this.sphereGeo, m.accent);
    orbB.scale.setScalar(0.17);

    group.add(shadow, danger, glow, core, shard, ring, orbA, orbB);
    const trail: Mesh[] = [];
    for (let i = 0; i < TRAIL_SEGMENTS; i++) {
      const t = new Mesh(this.sphereGeo, m.trail);
      t.position.z = -(i + 1) * 0.5;
      t.scale.setScalar(0.3 * (1 - i / (TRAIL_SEGMENTS + 1)));
      group.add(t);
      trail.push(t);
    }
    this.root.add(group);
    return {
      group,
      core,
      shard,
      glow,
      ring,
      orbA,
      orbB,
      trail,
      id: -1,
      stamp: -1,
      kind: 0,
      prevX: 0,
      prevZ: 0,
      x: 0,
      z: 0,
      dx: 0,
      dz: 1,
      ttl: 1,
      maxTtl: 1,
      phase: 0,
    };
  }

  private buildTelegraph(m: KindMaterials): TelegraphSlot {
    const group = new Group();
    group.visible = false;
    const outer = new Mesh(this.telegraphRingGeo, m.accent);
    outer.rotation.x = Math.PI / 2;
    const inner = new Mesh(this.telegraphRingGeo, m.glow);
    inner.rotation.x = Math.PI / 2;
    const flare = new Mesh(this.sphereGeo, m.glow);
    const aim = new Mesh(this.aimGeo, m.aim);
    aim.renderOrder = 1;
    group.add(outer, inner, flare);
    // The aim strip lives in the root so it can lie flat on the ground, not above the bot.
    this.root.add(group);
    this.root.add(aim);
    aim.visible = false;
    return {
      group,
      outer,
      inner,
      flare,
      aim,
      botId: -1,
      stamp: -1,
      kind: 0,
      x: 0,
      z: 0,
      prevX: 0,
      prevZ: 0,
      ticks: 0,
      maxTicks: DEFAULT_WARNING_TICKS,
    };
  }

  private applyKind(slot: ProjectileSlot, kind: number): void {
    const m = this.mats[kind];
    if (!m) return;
    slot.kind = kind;
    slot.glow.material = m.glow;
    slot.core.material = m.core;
    slot.shard.material = m.core;
    slot.ring.material = m.accent;
    slot.orbA.material = m.accent;
    slot.orbB.material = m.accent;
    for (const t of slot.trail) t.material = m.trail;
    slot.shard.visible = kind === 2;
    slot.core.visible = kind !== 2;
    slot.ring.visible = kind === 3;
    slot.orbA.visible = kind === 1;
    slot.orbB.visible = kind === 1;
  }

  /** Reflect hostile projectiles and telegraphing bots (called on sim ticks, may allocate nothing per frame). */
  sync(state: GameState): void {
    this.stamp++;
    const stamp = this.stamp;

    const list = state.hostileProjectiles;
    if (list) {
      for (const p of list) {
        let slot = this.projectileById.get(p.id);
        if (!slot) {
          slot = this.projectiles.find((s) => s.stamp !== stamp && !s.group.visible);
          if (!slot) continue; // pool exhausted: the core caps projectiles at ~24
          slot.id = p.id;
          this.projectileById.set(p.id, slot);
          this.applyKind(slot, kindIndex(p.kind));
          slot.phase = (p.id * 1.7) % 6.28;
          slot.group.visible = true;
        }
        slot.stamp = stamp;
        slot.prevX = p.prevX;
        slot.prevZ = p.prevZ;
        slot.x = p.x;
        slot.z = p.z;
        const len = Math.hypot(p.dx, p.dz);
        if (len > 1e-6) {
          slot.dx = p.dx / len;
          slot.dz = p.dz / len;
        }
        slot.ttl = p.ttl;
        slot.maxTtl = p.maxTtl;
      }
    }
    for (const slot of this.projectiles) {
      if (slot.stamp !== stamp && slot.group.visible) {
        slot.group.visible = false;
        this.projectileById.delete(slot.id);
        slot.id = -1;
      }
    }

    const survival = state.phase === 'playing' || state.phase === 'paused';
    if (survival) {
      for (const bot of state.bots) {
        const warn = bot.magicWarningTicks ?? 0;
        if (warn <= 0) continue;
        let slot = this.telegraphByBot.get(bot.id);
        if (!slot) {
          slot = this.telegraphs.find((s) => s.stamp !== stamp && !s.group.visible);
          if (!slot) continue;
          slot.botId = bot.id;
          this.telegraphByBot.set(bot.id, slot);
          slot.maxTicks = Math.max(DEFAULT_WARNING_TICKS, warn);
          slot.group.visible = true;
        }
        slot.stamp = stamp;
        slot.maxTicks = Math.max(slot.maxTicks, warn);
        slot.ticks = warn;
        slot.x = bot.head.x;
        slot.z = bot.head.z;
        slot.prevX = bot.prevHead.x;
        slot.prevZ = bot.prevHead.z;
        const kind = kindIndex(bot.magicSpell ?? 'bolt');
        if (kind !== slot.kind || !slot.aim.visible) {
          const m = this.mats[kind];
          if (m) {
            slot.kind = kind;
            slot.outer.material = m.accent;
            slot.inner.material = m.glow;
            slot.flare.material = m.glow;
            slot.aim.material = m.aim;
          }
        }
      }
    }
    for (const slot of this.telegraphs) {
      if (slot.stamp !== stamp && slot.group.visible) {
        slot.group.visible = false;
        slot.aim.visible = false;
        this.telegraphByBot.delete(slot.botId);
        slot.botId = -1;
      }
    }
    this.anyActive = this.projectileById.size > 0 || this.telegraphByBot.size > 0;
  }

  /** Interpolate at 60fps. `alpha` is the bot tick alpha, `projectileAlpha` the projectile step alpha. */
  draw(alpha: number, projectileAlpha: number, elapsed: number, state: GameState): void {
    if (!this.anyActive) return;
    const pa = projectileAlpha < 0 ? 0 : projectileAlpha > 1 ? 1 : projectileAlpha;
    const ba = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;

    for (const s of this.projectiles) {
      if (!s.group.visible) continue;
      const jumpSq = (s.x - s.prevX) * (s.x - s.prevX) + (s.z - s.prevZ) * (s.z - s.prevZ);
      const k = jumpSq > 25 ? 1 : pa;
      const g = s.group;
      g.position.x = s.prevX + (s.x - s.prevX) * k;
      g.position.z = s.prevZ + (s.z - s.prevZ) * k;
      g.position.y = PROJECTILE_Y + Math.sin(elapsed * 9 + s.phase) * 0.06;
      g.rotation.y = Math.atan2(s.dx, s.dz);

      const life = s.maxTtl > 0 ? s.ttl / s.maxTtl : 1;
      // fade out in the last 20% of life so expiry is never a surprise pop
      const fade = life < 0.2 ? Math.max(0.2, life / 0.2) : 1;
      const pulse = 1 + Math.sin(elapsed * 14 + s.phase) * 0.12;
      s.glow.scale.setScalar(0.78 * pulse * fade);
      switch (s.kind) {
        case 0: // bolt: stretched hot spark
          s.core.scale.set(0.3 * fade, 0.3 * fade, 0.62 * fade);
          break;
        case 1: // fire: pulsing orb with two orbiting embers
          s.core.scale.setScalar(0.38 * pulse * fade);
          s.orbA.position.set(
            Math.cos(elapsed * 11 + s.phase) * 0.46,
            Math.sin(elapsed * 11 + s.phase) * 0.46,
            0,
          );
          s.orbB.position.set(
            -Math.cos(elapsed * 11 + s.phase) * 0.46,
            -Math.sin(elapsed * 11 + s.phase) * 0.46,
            0,
          );
          break;
        case 2: // frost: spinning crystal
          s.shard.rotation.y = elapsed * 5 + s.phase;
          s.shard.rotation.z = elapsed * 3;
          s.shard.scale.set(0.32 * fade, 0.5 * fade, 0.32 * fade);
          break;
        default: // arcane: orb inside a tumbling ring
          s.core.scale.setScalar(0.34 * fade);
          s.ring.rotation.x = elapsed * 6 + s.phase;
          s.ring.rotation.y = elapsed * 4;
          s.ring.scale.setScalar(0.66 * pulse * fade);
          break;
      }
      for (let i = 0; i < s.trail.length; i++) {
        const t = s.trail[i];
        if (!t) continue;
        const wob = Math.sin(elapsed * 18 + i * 1.3 + s.phase) * 0.05;
        t.position.x = wob;
        t.scale.setScalar(0.3 * (1 - i / (TRAIL_SEGMENTS + 1)) * fade * (s.kind === 0 ? 0.8 : 1));
      }
    }

    const head = state.snake[0];
    for (const s of this.telegraphs) {
      if (!s.group.visible) continue;
      const g = s.group;
      const bx = s.prevX + (s.x - s.prevX) * ba;
      const bz = s.prevZ + (s.z - s.prevZ) * ba;
      g.position.set(bx, 1.9, bz);
      const progress = 1 - Math.min(1, Math.max(0, s.ticks / s.maxTicks));
      // ring converges onto the charging flare right before the cast
      const ringScale = 2.1 - progress * 1.25;
      s.outer.scale.setScalar(ringScale);
      s.outer.rotation.z = elapsed * 3;
      s.inner.scale.setScalar(ringScale * 0.62);
      s.inner.rotation.z = -elapsed * 4.5;
      const flicker = 1 + Math.sin(elapsed * 40) * 0.15;
      s.flare.scale.setScalar((0.3 + progress * 0.7) * flicker);

      const aim = s.aim;
      if (head) {
        const ax = head.x - bx;
        const az = head.z - bz;
        const dist = Math.hypot(ax, az);
        if (dist > 1.5) {
          const len = Math.min(dist - 1, 14);
          aim.visible = true;
          aim.position.set(
            bx + (ax / dist) * (len / 2 + 1),
            0.07,
            bz + (az / dist) * (len / 2 + 1),
          );
          aim.rotation.y = Math.atan2(ax, az);
          aim.scale.set(1 + progress * 0.8, 1, len);
          const mat = aim.material as MeshBasicMaterial;
          mat.opacity = 0.12 + progress * 0.22 + Math.sin(elapsed * 30) * 0.03;
        } else {
          aim.visible = false;
        }
      } else {
        aim.visible = false;
      }
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    this.sphereGeo.dispose();
    this.shardGeo.dispose();
    this.ringGeo.dispose();
    this.telegraphRingGeo.dispose();
    this.flatRingGeo.dispose();
    this.discGeo.dispose();
    this.aimGeo.dispose();
    const all: Material[] = [this.dangerRingMat, this.shadowMat];
    for (const m of this.mats) all.push(m.core, m.glow, m.trail, m.accent, m.aim);
    for (const m of all) m.dispose();
    this.projectiles.length = 0;
    this.telegraphs.length = 0;
    this.projectileById.clear();
    this.telegraphByBot.clear();
  }
}
