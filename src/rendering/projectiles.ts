import {
  ConeGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  type Scene,
  type Vector3,
} from 'three';
import { FORM_METADATA } from '../core/config';
import type { GameState, Projectile, SnakeForm } from '../core/types';
import { lerpGridToWorld } from './world';

function createStarBoltGeometry(): ExtrudeGeometry {
  const s = new Shape();
  const points = 5;
  const outer = 0.3;
  const inner = 0.13;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();

  const geo = new ExtrudeGeometry(s, {
    depth: 0.08,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.02,
    bevelSegments: 1,
  });
  geo.center();
  return geo;
}

interface ActiveProjectile {
  readonly id: number;
  readonly form: SnakeForm;
  readonly group: Group;
  readonly spinner: Group;
  prevX: number;
  prevZ: number;
  x: number;
  z: number;
  dx: number;
  dz: number;
  lastWorldPos: Vector3;
}

/**
 * Renders the 4 magical projectile archetypes and smoothly interpolates them
 * between projectile steps using `projectileAlpha` (0..1).
 */
export class ProjectilesView {
  private readonly root = new Group();

  private readonly sphereCoreGeo = new SphereGeometry(0.22, 12, 10);
  private readonly tailConeGeo = new ConeGeometry(0.16, 0.72, 10);
  private readonly iceCrystalGeo = new OctahedronGeometry(0.27, 0);
  private readonly iceHaloGeo = new TorusGeometry(0.32, 0.025, 6, 18);
  private readonly starBoltGeo = createStarBoltGeometry();
  private readonly seedPodGeo = new SphereGeometry(0.2, 10, 8);
  private readonly seedPetalGeo = new SphereGeometry(0.11, 8, 6);

  private readonly formMaterials: Record<SnakeForm, MeshStandardMaterial>;
  private readonly tailMaterial = new MeshBasicMaterial({
    color: 0xff9ee2,
    transparent: true,
    opacity: 0.65,
  });
  private readonly spiritPetalMaterial = new MeshStandardMaterial({
    color: 0xffa6df,
    emissive: 0xff6ec7,
    emissiveIntensity: 0.75,
    roughness: 0.25,
  });

  private readonly active = new Map<number, ActiveProjectile>();

  constructor(
    private readonly scene: Scene,
    private readonly half: number,
  ) {
    this.formMaterials = {
      dragon: this.makeMat(FORM_METADATA.dragon.hexColor, 1.1),
      phoenix: this.makeMat(FORM_METADATA.phoenix.hexColor, 1.05),
      unicorn: this.makeMat(FORM_METADATA.unicorn.hexColor, 1.15),
      spirit: this.makeMat(FORM_METADATA.spirit.hexColor, 0.95),
    };
    this.scene.add(this.root);
  }

  /**
   * Synchronize active projectile visuals with `state.projectiles`.
   * Returns world positions of any Spirit seeds that vanished (for 3×3 bloom).
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

    return vanishedSpiritPositions;
  }

  /** Interpolate projectile positions at 60fps and animate form spin/tails. */
  draw(projectileAlpha: number, elapsed: number, delta: number): void {
    const a = Math.max(0, Math.min(1, projectileAlpha));

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

      const yaw = Math.atan2(entry.dx, entry.dz);
      entry.group.rotation.y = yaw;

      switch (entry.form) {
        case 'dragon':
          entry.spinner.rotation.z += delta * 10;
          entry.spinner.scale.setScalar(1 + Math.sin(elapsed * 20) * 0.12);
          break;
        case 'phoenix':
          entry.spinner.rotation.z += delta * 14;
          entry.spinner.rotation.x += delta * 7;
          break;
        case 'unicorn':
          entry.spinner.rotation.y += delta * 15;
          entry.spinner.rotation.z += delta * 12;
          entry.spinner.scale.setScalar(1 + Math.sin(elapsed * 24) * 0.14);
          break;
        case 'spirit':
          entry.spinner.rotation.y += delta * 11;
          break;
      }
    }
  }

  dispose(): void {
    for (const entry of this.active.values()) {
      this.root.remove(entry.group);
    }
    this.active.clear();
    this.scene.remove(this.root);

    this.sphereCoreGeo.dispose();
    this.tailConeGeo.dispose();
    this.iceCrystalGeo.dispose();
    this.iceHaloGeo.dispose();
    this.starBoltGeo.dispose();
    this.seedPodGeo.dispose();
    this.seedPetalGeo.dispose();

    for (const mat of Object.values(this.formMaterials)) {
      mat.dispose();
    }
    this.tailMaterial.dispose();
    this.spiritPetalMaterial.dispose();
  }

  private makeMat(hex: number, emissiveIntensity: number): MeshStandardMaterial {
    return new MeshStandardMaterial({
      color: hex,
      emissive: hex,
      emissiveIntensity,
      metalness: 0.2,
      roughness: 0.18,
    });
  }

  private createProjectileVisual(p: Projectile): ActiveProjectile {
    const group = new Group();
    const spinner = new Group();
    const mat = this.formMaterials[p.form];

    if (p.form === 'dragon') {
      // Pink shooting star + glowing comet tail pointing backward (-Z in local space).
      const star = new Mesh(this.starBoltGeo, mat);
      star.rotation.x = Math.PI / 2;
      spinner.add(star);

      const core = new Mesh(this.sphereCoreGeo, mat);
      core.scale.setScalar(0.85);
      spinner.add(core);

      const tail = new Mesh(this.tailConeGeo, this.tailMaterial);
      tail.rotation.x = -Math.PI / 2;
      tail.position.z = -0.4;
      group.add(tail);
    } else if (p.form === 'phoenix') {
      // Fast-spinning elongated cyan ice crystal + frosty ring.
      const crystal = new Mesh(this.iceCrystalGeo, mat);
      crystal.scale.set(0.75, 0.75, 1.45);
      spinner.add(crystal);

      const halo = new Mesh(this.iceHaloGeo, mat);
      spinner.add(halo);
    } else if (p.form === 'unicorn') {
      // Dazzling golden star-lightning spinning rapidly.
      const star = new Mesh(this.starBoltGeo, mat);
      star.rotation.x = Math.PI / 2;
      star.scale.setScalar(1.22);
      spinner.add(star);

      const spark = new Mesh(this.iceCrystalGeo, mat);
      spark.scale.set(0.55, 0.55, 1.35);
      spinner.add(spark);
    } else {
      // Spirit spinning emerald flower-seed bomb.
      const pod = new Mesh(this.seedPodGeo, mat);
      spinner.add(pod);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        const petal = new Mesh(this.seedPetalGeo, this.spiritPetalMaterial);
        petal.scale.set(1.2, 0.45, 0.85);
        petal.position.set(Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22);
        petal.rotation.y = -a;
        spinner.add(petal);
      }
    }

    group.add(spinner);
    const startPos = lerpGridToWorld(p.prevX, p.prevZ, p.x, p.z, 1, this.half);
    startPos.y = 0.16;
    group.position.copy(startPos);
    group.rotation.y = Math.atan2(p.dx, p.dz);
    this.root.add(group);

    return {
      id: p.id,
      form: p.form,
      group,
      spinner,
      prevX: p.prevX,
      prevZ: p.prevZ,
      x: p.x,
      z: p.z,
      dx: p.dx,
      dz: p.dz,
      lastWorldPos: startPos.clone(),
    };
  }
}
