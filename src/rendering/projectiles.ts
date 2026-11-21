import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  type Scene,
  type Vector3,
} from 'three';
import type { GameState, Projectile, SilkWebZone, SnakeForm, SprayKind } from '../core/types';
import { lerpGridToWorld } from './world';

interface ActiveProjectile {
  readonly id: number;
  readonly form: SnakeForm;
  readonly sprayKind: SprayKind;
  readonly group: Group;
  readonly spinner: Group;
  prevX: number;
  prevZ: number;
  x: number;
  z: number;
  dx: number;
  dz: number;
  ttl: number;
  maxTtl: number;
  currentScale: number;
  lastWorldPos: Vector3;
}

interface ActiveSilkWeb {
  readonly id: number;
  readonly group: Group;
  readonly ringMat: MeshBasicMaterial;
  readonly spokeMat: MeshBasicMaterial;
  readonly discMat: MeshBasicMaterial;
  radius: number;
  ticksRemaining: number;
  maxTicks: number;
}

function computeProgress(ttl: number, maxTtl: number): number {
  return 1 - Math.max(0, ttl) / Math.max(1, maxTtl);
}

function scaleForProgress(progress: number): number {
  return 0.78 + Math.max(0, Math.min(1, progress)) * 0.97;
}

/**
 * Renders the 4 expanding 3D elemental spray plumes (interpolated at 60fps
 * between projectile steps) plus persistent Spirit silk web floor zones.
 */
export class ProjectilesView {
  private readonly root = new Group();

  // ── Shared Plume Geometries ──
  private readonly fireSphereGeo = new SphereGeometry(0.24, 12, 10);
  private readonly fireWakeConeGeo = new ConeGeometry(0.34, 0.94, 12, 1, true);

  private readonly iceCrescentGeo = new TorusGeometry(0.38, 0.054, 8, 20, Math.PI * 1.18);
  private readonly iceHaloGeo = new TorusGeometry(0.3, 0.032, 6, 20);
  private readonly iceShardGeo = new OctahedronGeometry(0.2, 0);

  private readonly waterSphereGeo = new SphereGeometry(0.26, 14, 10);
  private readonly waterDropletGeo = new SphereGeometry(0.11, 10, 8);
  private readonly waterFoamRingGeo = new TorusGeometry(0.31, 0.036, 8, 20);

  private readonly silkCoreGeo = new SphereGeometry(0.21, 12, 10);
  private readonly silkWrapRingGeo = new TorusGeometry(0.25, 0.025, 6, 18);
  private readonly silkRibbonGeo = new CylinderGeometry(0.048, 0.016, 0.82, 6);

  // ── Shared Silk Web Floor Geometries (unit radius, scaled by zone.radius) ──
  private readonly webOuterRingGeo = new TorusGeometry(0.97, 0.014, 6, 36);
  private readonly webMidRingGeo = new TorusGeometry(0.65, 0.012, 6, 32);
  private readonly webInnerRingGeo = new TorusGeometry(0.33, 0.011, 6, 24);
  private readonly webSpokeGeo = new BoxGeometry(0.022, 0.012, 1.94);
  private readonly webDiscGeo = new CircleGeometry(0.97, 32);

  // ── Shared Plume Materials ──
  private readonly fireCoreMat = new MeshStandardMaterial({
    color: 0xffe866,
    emissive: 0xffd83d,
    emissiveIntensity: 1.25,
    roughness: 0.18,
  });
  private readonly fireMidMat = new MeshStandardMaterial({
    color: 0xff8424,
    emissive: 0xff6218,
    emissiveIntensity: 1.1,
    roughness: 0.25,
    transparent: true,
    opacity: 0.92,
  });
  private readonly fireOuterMat = new MeshStandardMaterial({
    color: 0xff3088,
    emissive: 0xff2478,
    emissiveIntensity: 0.95,
    roughness: 0.28,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  private readonly fireWakeMat = new MeshBasicMaterial({
    color: 0xff6644,
    transparent: true,
    opacity: 0.54,
    side: DoubleSide,
    depthWrite: false,
  });

  private readonly iceCoreMat = new MeshStandardMaterial({
    color: 0xf2feff,
    emissive: 0xb8f9ff,
    emissiveIntensity: 1.15,
    roughness: 0.12,
    metalness: 0.25,
  });
  private readonly iceCyanMat = new MeshStandardMaterial({
    color: 0x38f6ff,
    emissive: 0x18d8ff,
    emissiveIntensity: 1.05,
    roughness: 0.15,
    metalness: 0.3,
    transparent: true,
    opacity: 0.9,
  });
  private readonly iceWaveMat = new MeshBasicMaterial({
    color: 0x9cfaff,
    transparent: true,
    opacity: 0.72,
    side: DoubleSide,
    depthWrite: false,
  });

  private readonly waterGlossMat = new MeshStandardMaterial({
    color: 0x38d9ff,
    emissive: 0x1298ff,
    emissiveIntensity: 0.82,
    roughness: 0.08,
    metalness: 0.18,
    transparent: true,
    opacity: 0.92,
  });
  private readonly waterAquaMat = new MeshStandardMaterial({
    color: 0x8efaff,
    emissive: 0x48efff,
    emissiveIntensity: 0.9,
    roughness: 0.1,
    transparent: true,
    opacity: 0.88,
  });
  private readonly waterFoamMat = new MeshBasicMaterial({
    color: 0xeaffff,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });

  private readonly silkPearlMat = new MeshStandardMaterial({
    color: 0xf4fff9,
    emissive: 0xc9ffea,
    emissiveIntensity: 0.88,
    roughness: 0.18,
    metalness: 0.18,
  });
  private readonly silkMintMat = new MeshStandardMaterial({
    color: 0x5effa8,
    emissive: 0x34e88a,
    emissiveIntensity: 0.92,
    roughness: 0.22,
    transparent: true,
    opacity: 0.88,
  });
  private readonly silkGossamerMat = new MeshBasicMaterial({
    color: 0xe6fff3,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });

  private readonly active = new Map<number, ActiveProjectile>();
  private readonly silkWebs = new Map<number, ActiveSilkWeb>();

  constructor(
    private readonly scene: Scene,
    private readonly half: number,
  ) {
    this.scene.add(this.root);
  }

  /**
   * Synchronize active elemental spray plumes and persistent silk web zones
   * with `state`. Returns world positions of vanished Spirit plumes (for 3×3 bloom).
   */
  sync(state: GameState): Vector3[] {
    const vanishedSpiritPositions: Vector3[] = [];
    const seen = new Set<number>();

    for (const p of state.projectiles) {
      seen.add(p.id);
      const existing = this.active.get(p.id);
      if (existing) {
        existing.prevX = p.prevX;
        existing.prevZ = p.prevZ;
        existing.x = p.x;
        existing.z = p.z;
        existing.dx = p.dx;
        existing.dz = p.dz;
        existing.ttl = p.ttl;
        existing.maxTtl = p.maxTtl;
      } else {
        this.active.set(p.id, this.createProjectileVisual(p));
      }
    }

    for (const [id, entry] of this.active) {
      if (!seen.has(id)) {
        if (entry.form === 'spirit' && state.phase === 'playing') {
          vanishedSpiritPositions.push(entry.lastWorldPos.clone());
        }
        this.root.remove(entry.group);
        this.active.delete(id);
      }
    }

    this.syncSilkWebs(state.silkWebs);

    return vanishedSpiritPositions;
  }

  /** Interpolate projectile positions/scales at 60fps and shimmer floor silk webs. */
  draw(projectileAlpha: number, elapsed: number, delta: number): void {
    const a = Math.max(0, Math.min(1, projectileAlpha));
    const dt = Math.min(Math.max(delta, 0), 0.1);

    for (const entry of this.active.values()) {
      const jumpSq =
        (entry.x - entry.prevX) * (entry.x - entry.prevX) +
        (entry.z - entry.prevZ) * (entry.z - entry.prevZ);
      lerpGridToWorld(
        entry.prevX,
        entry.prevZ,
        entry.x,
        entry.z,
        jumpSq > 25 ? 1 : a,
        this.half,
        entry.group.position,
      );
      entry.group.position.y = 0.16;
      entry.lastWorldPos.copy(entry.group.position);

      entry.group.rotation.y = Math.atan2(entry.dx, entry.dz);

      const targetScale = scaleForProgress(computeProgress(entry.ttl, entry.maxTtl));
      entry.currentScale += (targetScale - entry.currentScale) * Math.min(1, dt * 18);
      entry.group.scale.setScalar(entry.currentScale);

      switch (entry.sprayKind) {
        case 'fire':
          entry.spinner.rotation.z += dt * 9.5;
          entry.spinner.scale.setScalar(1 + Math.sin(elapsed * 22 + entry.id) * 0.1);
          break;
        case 'ice':
          entry.spinner.rotation.z += dt * 13.5;
          entry.spinner.rotation.x = Math.sin(elapsed * 11 + entry.id) * 0.24;
          break;
        case 'water':
          entry.spinner.rotation.z += dt * 16;
          entry.spinner.scale.setScalar(1 + Math.sin(elapsed * 24 + entry.id) * 0.1);
          break;
        case 'silk':
          entry.spinner.rotation.z += dt * 10;
          entry.spinner.rotation.x = Math.sin(elapsed * 14 + entry.id) * 0.14;
          entry.spinner.rotation.y = Math.cos(elapsed * 12 + entry.id) * 0.14;
          break;
      }
    }

    for (const web of this.silkWebs.values()) {
      const fade = web.ticksRemaining <= 20 ? Math.max(0, web.ticksRemaining / 20) : 1;
      const shimmer = 0.84 + 0.16 * Math.sin(elapsed * 5.2 + web.id * 2.1);
      const age = Math.max(0, web.maxTicks - web.ticksRemaining);
      const spawnScale = Math.min(1, 0.42 + age * 0.25);
      const pulse = 1 + Math.sin(elapsed * 3.0 + web.id * 1.4) * 0.022;

      web.group.scale.setScalar(web.radius * spawnScale * pulse);
      web.group.rotation.y += dt * 0.12 * (web.id % 2 === 0 ? 1 : -1);
      web.ringMat.opacity = 0.88 * shimmer * fade;
      web.spokeMat.opacity = 0.78 * shimmer * fade;
      web.discMat.opacity = 0.14 * shimmer * fade;
    }
  }

  dispose(): void {
    for (const entry of this.active.values()) {
      this.root.remove(entry.group);
    }
    this.active.clear();

    for (const web of this.silkWebs.values()) {
      this.root.remove(web.group);
      web.ringMat.dispose();
      web.spokeMat.dispose();
      web.discMat.dispose();
    }
    this.silkWebs.clear();

    this.scene.remove(this.root);

    this.fireSphereGeo.dispose();
    this.fireWakeConeGeo.dispose();
    this.iceCrescentGeo.dispose();
    this.iceHaloGeo.dispose();
    this.iceShardGeo.dispose();
    this.waterSphereGeo.dispose();
    this.waterDropletGeo.dispose();
    this.waterFoamRingGeo.dispose();
    this.silkCoreGeo.dispose();
    this.silkWrapRingGeo.dispose();
    this.silkRibbonGeo.dispose();
    this.webOuterRingGeo.dispose();
    this.webMidRingGeo.dispose();
    this.webInnerRingGeo.dispose();
    this.webSpokeGeo.dispose();
    this.webDiscGeo.dispose();

    this.fireCoreMat.dispose();
    this.fireMidMat.dispose();
    this.fireOuterMat.dispose();
    this.fireWakeMat.dispose();
    this.iceCoreMat.dispose();
    this.iceCyanMat.dispose();
    this.iceWaveMat.dispose();
    this.waterGlossMat.dispose();
    this.waterAquaMat.dispose();
    this.waterFoamMat.dispose();
    this.silkPearlMat.dispose();
    this.silkMintMat.dispose();
    this.silkGossamerMat.dispose();
  }

  private syncSilkWebs(zones: readonly SilkWebZone[]): void {
    const seen = new Set<number>();

    for (const zone of zones) {
      seen.add(zone.id);
      const existing = this.silkWebs.get(zone.id);
      if (existing) {
        existing.radius = zone.radius;
        existing.ticksRemaining = zone.ticksRemaining;
        existing.maxTicks = zone.maxTicks;
        lerpGridToWorld(zone.x, zone.z, zone.x, zone.z, 1, this.half, existing.group.position);
        existing.group.position.y = -0.41;
      } else {
        this.silkWebs.set(zone.id, this.createSilkWebVisual(zone));
      }
    }

    for (const [id, web] of this.silkWebs) {
      if (!seen.has(id)) {
        this.root.remove(web.group);
        web.ringMat.dispose();
        web.spokeMat.dispose();
        web.discMat.dispose();
        this.silkWebs.delete(id);
      }
    }
  }

  private createSilkWebVisual(zone: SilkWebZone): ActiveSilkWeb {
    const group = new Group();
    const fade = zone.ticksRemaining <= 20 ? Math.max(0, zone.ticksRemaining / 20) : 1;

    const ringMat = new MeshBasicMaterial({
      color: 0xd8fff0,
      transparent: true,
      opacity: 0.88 * fade,
      depthWrite: false,
    });
    const spokeMat = new MeshBasicMaterial({
      color: 0x62ffb8,
      transparent: true,
      opacity: 0.78 * fade,
      depthWrite: false,
    });
    const discMat = new MeshBasicMaterial({
      color: 0x4dff9a,
      transparent: true,
      opacity: 0.14 * fade,
      side: DoubleSide,
      depthWrite: false,
    });

    for (const ringGeo of [this.webOuterRingGeo, this.webMidRingGeo, this.webInnerRingGeo]) {
      const ring = new Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.004;
      group.add(ring);
    }

    // 4 crossed thin bars create 8 radial spider-silk spokes across the web.
    for (let i = 0; i < 4; i++) {
      const bar = new Mesh(this.webSpokeGeo, spokeMat);
      bar.rotation.y = (i * Math.PI) / 4;
      bar.position.y = 0.002;
      group.add(bar);
    }

    const disc = new Mesh(this.webDiscGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.004;
    group.add(disc);

    lerpGridToWorld(zone.x, zone.z, zone.x, zone.z, 1, this.half, group.position);
    group.position.y = -0.41;
    group.scale.setScalar(zone.radius);
    this.root.add(group);

    return {
      id: zone.id,
      group,
      ringMat,
      spokeMat,
      discMat,
      radius: zone.radius,
      ticksRemaining: zone.ticksRemaining,
      maxTicks: zone.maxTicks,
    };
  }

  private createProjectileVisual(p: Projectile): ActiveProjectile {
    const group = new Group();
    const spinner = new Group();

    switch (p.sprayKind) {
      case 'fire':
        this.buildFirePlume(group, spinner);
        break;
      case 'ice':
        this.buildIcePlume(group, spinner);
        break;
      case 'water':
        this.buildWaterPlume(group, spinner);
        break;
      case 'silk':
        this.buildSilkPlume(spinner);
        break;
    }

    group.add(spinner);

    const initialScale = scaleForProgress(computeProgress(p.ttl, p.maxTtl));
    group.scale.setScalar(initialScale);

    const startPos = lerpGridToWorld(p.prevX, p.prevZ, p.x, p.z, 1, this.half);
    startPos.y = 0.16;
    group.position.copy(startPos);
    group.rotation.y = Math.atan2(p.dx, p.dz);
    this.root.add(group);

    return {
      id: p.id,
      form: p.form,
      sprayKind: p.sprayKind,
      group,
      spinner,
      prevX: p.prevX,
      prevZ: p.prevZ,
      x: p.x,
      z: p.z,
      dx: p.dx,
      dz: p.dz,
      ttl: p.ttl,
      maxTtl: p.maxTtl,
      currentScale: initialScale,
      lastWorldPos: startPos.clone(),
    };
  }

  private buildFirePlume(group: Group, spinner: Group): void {
    // Yellow-gold hot fireball core
    const core = new Mesh(this.fireSphereGeo, this.fireCoreMat);
    core.position.set(0, 0.02, 0.14);
    core.scale.setScalar(0.92);
    spinner.add(core);

    // Orange mid billowing puffs
    const midSpecs: readonly [number, number, number, number][] = [
      [0.15, 0.05, 0.04, 0.82],
      [-0.15, -0.04, 0.02, 0.78],
      [0, 0.14, -0.04, 0.76],
    ];
    for (const [x, y, z, s] of midSpecs) {
      const puff = new Mesh(this.fireSphereGeo, this.fireMidMat);
      puff.position.set(x, y, z);
      puff.scale.setScalar(s);
      spinner.add(puff);
    }

    // Crimson-pink outer fireball puffs
    const outerSpecs: readonly [number, number, number, number][] = [
      [-0.22, 0.06, -0.14, 0.96],
      [0.22, -0.05, -0.16, 0.92],
      [0, -0.14, -0.12, 1.04],
    ];
    for (const [x, y, z, s] of outerSpecs) {
      const puff = new Mesh(this.fireSphereGeo, this.fireOuterMat);
      puff.position.set(x, y, z);
      puff.scale.setScalar(s);
      spinner.add(puff);
    }

    // Trailing flame wake cone pointing backward (-Z)
    const wake = new Mesh(this.fireWakeConeGeo, this.fireWakeMat);
    wake.rotation.x = -Math.PI / 2;
    wake.position.z = -0.38;
    group.add(wake);
  }

  private buildIcePlume(group: Group, spinner: Group): void {
    // Leading frosted crescent wave facing +Z
    const crescent = new Mesh(this.iceCrescentGeo, this.iceWaveMat);
    crescent.rotation.x = Math.PI / 2;
    crescent.rotation.z = -0.09 * Math.PI;
    crescent.position.set(0, 0.02, 0.12);
    group.add(crescent);

    const halo = new Mesh(this.iceHaloGeo, this.iceCyanMat);
    halo.rotation.x = Math.PI / 2;
    spinner.add(halo);

    // Central diamond icicle shard + 4 spinning outer shards
    const mainShard = new Mesh(this.iceShardGeo, this.iceCoreMat);
    mainShard.scale.set(0.72, 0.72, 1.65);
    mainShard.position.set(0, 0, 0.1);
    spinner.add(mainShard);

    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const shard = new Mesh(this.iceShardGeo, i % 2 === 0 ? this.iceCyanMat : this.iceCoreMat);
      shard.scale.set(0.45, 0.45, 1.15);
      shard.position.set(Math.cos(a) * 0.24, Math.sin(a) * 0.16, -0.08);
      shard.rotation.set(Math.sin(a) * 0.35, -Math.cos(a) * 0.35, a);
      spinner.add(shard);
    }
  }

  private buildWaterPlume(group: Group, spinner: Group): void {
    // Glossy pressurized water-wave crest + whitewater curl
    const waveHead = new Mesh(this.waterSphereGeo, this.waterGlossMat);
    waveHead.position.set(0, 0.03, 0.14);
    waveHead.scale.set(1.18, 0.72, 1.48);
    group.add(waveHead);

    const crestArc = new Mesh(this.iceCrescentGeo, this.waterFoamMat);
    crestArc.rotation.x = Math.PI / 2;
    crestArc.rotation.z = -0.09 * Math.PI;
    crestArc.position.set(0, 0.1, 0.16);
    crestArc.scale.set(0.95, 0.95, 0.85);
    group.add(crestArc);

    // 4 spiraling water droplets
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const drop = new Mesh(this.waterDropletGeo, this.waterAquaMat);
      drop.position.set(Math.cos(a) * 0.24, Math.sin(a) * 0.2, 0.06 - i * 0.14);
      drop.scale.set(0.85, 0.85, 1.45);
      spinner.add(drop);
    }

    // 2 whitewater foam rings
    const foamFront = new Mesh(this.waterFoamRingGeo, this.waterFoamMat);
    foamFront.position.set(0, 0, 0.04);
    foamFront.rotation.x = 0.24;
    foamFront.scale.setScalar(0.82);
    spinner.add(foamFront);

    const foamBack = new Mesh(this.waterFoamRingGeo, this.waterFoamMat);
    foamBack.position.set(0, 0, -0.32);
    foamBack.rotation.x = -0.24;
    foamBack.scale.setScalar(1.12);
    spinner.add(foamBack);
  }

  private buildSilkPlume(spinner: Group): void {
    // Pearlescent gossamer silk bundle core
    const core = new Mesh(this.silkCoreGeo, this.silkPearlMat);
    core.scale.set(1.0, 0.9, 1.2);
    spinner.add(core);

    const wrapTilts: readonly [number, number, number, boolean][] = [
      [0.55, 0.4, 0, true],
      [-0.55, 0.3, 0.9, false],
      [0.2, -0.6, 1.8, true],
    ];
    for (const [rx, ry, rz, mint] of wrapTilts) {
      const ring = new Mesh(this.silkWrapRingGeo, mint ? this.silkMintMat : this.silkPearlMat);
      ring.rotation.set(rx, ry, rz);
      spinner.add(ring);
    }

    // 4 trailing mint-white silk ribbons
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      const ribbon = new Mesh(
        this.silkRibbonGeo,
        i % 2 === 0 ? this.silkMintMat : this.silkGossamerMat,
      );
      ribbon.position.set(Math.cos(a) * 0.18, Math.sin(a) * 0.14, -0.44);
      ribbon.rotation.x = Math.PI / 2;
      ribbon.rotation.z = -Math.cos(a) * 0.22;
      spinner.add(ribbon);
    }
  }
}
