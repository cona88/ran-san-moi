import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Scene,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FORM_METADATA } from '../core/config';
import type { GameState, Hazard, SnakeForm } from '../core/types';
import type { BadgeTextureCache } from './labels3d';
import { cellToWorld, lerpGridToWorld } from './world';

const SHORT_FORM_NAME: Record<SnakeForm, string> = {
  dragon: 'Rồng',
  phoenix: 'Phượng',
  unicorn: 'Kỳ Lân',
  spirit: 'Tinh Linh',
};

interface HazardVisual {
  readonly id: number;
  readonly group: Group;
  hazard: Hazard;
  // Slime parts
  slimeBodyGroup?: Group;
  iceBlock?: Mesh;
  // Crystal parts
  crystalGroup?: Group;
  // Gate parts
  gateCore?: Mesh;
  gateSprite?: Sprite;
  gateSpriteMat?: SpriteMaterial;
  // Meteor parts
  warningGroup?: Group;
  warningRingMat?: MeshBasicMaterial;
  warningFillMat?: MeshBasicMaterial;
  meteorShadow?: Mesh;
  meteorRock?: Mesh;
  // Per-instance disposable materials
  readonly ownMaterials: { dispose(): void }[];
}

/**
 * Renders all arena hazards (`slime` with frozen ice-cube state, spiky violet
 * `crystal`, `element_gate` with 3D form badge sprite, and `meteor` with
 * ground warning circle before impact).
 */
export class ObstaclesView {
  private readonly root = new Group();

  // Shared geometries
  private readonly slimeDomeGeo = new SphereGeometry(0.38, 18, 14);
  private readonly slimeEyeWhiteGeo = new SphereGeometry(0.11, 10, 8);
  private readonly slimePupilGeo = new SphereGeometry(0.06, 8, 6);
  private readonly iceCubeGeo = new RoundedBoxGeometry(0.88, 0.88, 0.88, 2, 0.1);
  private readonly iceRimGeo = new RoundedBoxGeometry(0.92, 0.92, 0.92, 1, 0.08);

  private readonly crystalMainGeo = new ConeGeometry(0.28, 0.95, 6);
  private readonly crystalShardGeo = new ConeGeometry(0.15, 0.56, 5);

  private readonly gatePillarGeo = new BoxGeometry(0.16, 0.9, 0.16);
  private readonly gateBeamGeo = new BoxGeometry(0.88, 0.15, 0.18);
  private readonly gateCoreGeo = new OctahedronGeometry(0.24, 0);

  private readonly warningRingGeo = new RingGeometry(0.36, 0.5, 28);
  private readonly warningFillGeo = new CircleGeometry(0.36, 24);
  private readonly meteorRockGeo = new DodecahedronGeometry(0.42, 0);
  private readonly meteorShadowGeo = new SphereGeometry(0.2, 10, 8);

  // Shared materials
  private readonly slimeBodyMat = new MeshStandardMaterial({
    color: 0x6236a8,
    emissive: 0x4b1f8c,
    emissiveIntensity: 0.55,
    metalness: 0.15,
    roughness: 0.25,
  });
  private readonly eyeWhiteMat = new MeshBasicMaterial({ color: 0xffffff });
  private readonly slimePupilMat = new MeshBasicMaterial({ color: 0xff6ee0 });
  private readonly iceCubeMat = new MeshStandardMaterial({
    color: 0x8ef9ff,
    emissive: 0x38e8ff,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.56,
    metalness: 0.12,
    roughness: 0.1,
    depthWrite: false,
  });
  private readonly iceWireMat = new MeshBasicMaterial({
    color: 0xe0feff,
    wireframe: true,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });

  private readonly crystalMat = new MeshStandardMaterial({
    color: 0xc25eff,
    emissive: 0x8f33ff,
    emissiveIntensity: 0.72,
    metalness: 0.3,
    roughness: 0.2,
  });
  private readonly crystalTipMat = new MeshStandardMaterial({
    color: 0xff8ce6,
    emissive: 0xd948c7,
    emissiveIntensity: 0.75,
    metalness: 0.25,
    roughness: 0.2,
  });

  private readonly meteorRockMat = new MeshStandardMaterial({
    color: 0xff7043,
    emissive: 0xff4518,
    emissiveIntensity: 0.85,
    metalness: 0.25,
    roughness: 0.35,
  });
  private readonly meteorShadowMat = new MeshBasicMaterial({
    color: 0xffa63b,
    transparent: true,
    opacity: 0.78,
  });

  private readonly visuals = new Map<number, HazardVisual>();
  private readonly scratchPos = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly half: number,
    private readonly badgeCache: BadgeTextureCache,
  ) {
    this.scene.add(this.root);
  }

  /** Reconcile hazard visuals with `state.hazards`. */
  sync(state: GameState): void {
    const seen = new Set<number>();

    for (const h of state.hazards) {
      seen.add(h.id);
      const existing = this.visuals.get(h.id);
      if (existing) {
        existing.hazard = h;
      } else {
        this.visuals.set(h.id, this.createHazardVisual(h));
      }
    }

    for (const [id, vis] of this.visuals) {
      if (!seen.has(id)) {
        this.disposeHazardVisual(vis);
        this.visuals.delete(id);
      }
    }
  }

  /** Interpolate moving slimes and animate ice blocks, gates, crystals & meteor warnings. */
  draw(alpha: number, elapsed: number, delta: number): void {
    const a = Math.max(0, Math.min(1, alpha));
    this.iceCubeMat.emissiveIntensity = 0.52 + 0.26 * Math.sin(elapsed * 6.0);

    for (const vis of this.visuals.values()) {
      const h = vis.hazard;
      const frozen = h.frozenTicks > 0;

      if (h.kind === 'slime') {
        const jumpSq =
          (h.cell.x - h.prevCell.x) * (h.cell.x - h.prevCell.x) +
          (h.cell.z - h.prevCell.z) * (h.cell.z - h.prevCell.z);
        lerpGridToWorld(
          h.prevCell.x,
          h.prevCell.z,
          h.cell.x,
          h.cell.z,
          jumpSq > 16 ? 1 : a,
          this.half,
          this.scratchPos,
        );
        vis.group.position.set(this.scratchPos.x, 0, this.scratchPos.z);

        if (vis.iceBlock) {
          vis.iceBlock.visible = frozen;
          if (frozen) vis.iceBlock.rotation.y = Math.sin(elapsed * 4.2 + h.id) * 0.05;
        }

        if (vis.slimeBodyGroup) {
          if (frozen) {
            vis.slimeBodyGroup.scale.set(1, 0.9, 1);
            vis.slimeBodyGroup.position.y = -0.05;
          } else {
            const hop = Math.abs(Math.sin(elapsed * 5.2 + h.id));
            const stretchY = 0.85 + hop * 0.28;
            const squashXZ = 1 / Math.sqrt(stretchY);
            vis.slimeBodyGroup.scale.set(squashXZ, stretchY, squashXZ);
            vis.slimeBodyGroup.position.y = -0.1 + hop * 0.18;

            const dx = h.cell.x - h.prevCell.x;
            const dz = h.cell.z - h.prevCell.z;
            if (dx !== 0 || dz !== 0) {
              vis.slimeBodyGroup.rotation.y = Math.atan2(dx, dz);
            }
          }
        }
        continue;
      }

      const world = cellToWorld(h.cell.x, h.cell.z, this.half, this.scratchPos);
      vis.group.position.set(world.x, 0, world.z);

      if (vis.iceBlock) {
        vis.iceBlock.visible = frozen;
        if (frozen) vis.iceBlock.rotation.y = Math.sin(elapsed * 4.2 + h.id) * 0.05;
      }

      if (h.kind === 'crystal' && vis.crystalGroup) {
        if (!frozen) {
          const damaged = h.hp < h.maxHp ? 0.88 + 0.08 * Math.sin(elapsed * 12) : 1;
          vis.crystalGroup.scale.setScalar(damaged);
          vis.crystalGroup.rotation.y = Math.sin(elapsed * 0.9 + h.id) * 0.08;
        }
      } else if (h.kind === 'element_gate') {
        if (vis.gateCore && !frozen) {
          vis.gateCore.rotation.y += delta * 2.2;
          vis.gateCore.position.y = 0.14 + Math.sin(elapsed * 3.5 + h.id) * 0.08;
        }
        if (vis.gateSprite) {
          vis.gateSprite.position.y = 1.48 + Math.sin(elapsed * 3 + h.id) * 0.07;
        }
      } else if (h.kind === 'meteor') {
        const isWarning = h.warningTicks > 0;
        if (vis.warningGroup) vis.warningGroup.visible = isWarning;
        if (vis.meteorRock) vis.meteorRock.visible = !isWarning;

        if (vis.iceBlock) {
          if (isWarning) {
            vis.iceBlock.position.y = -0.34;
            vis.iceBlock.scale.set(1.22, 0.34, 1.22);
          } else {
            vis.iceBlock.position.y = 0.06;
            vis.iceBlock.scale.set(1.12, 1.12, 1.12);
          }
        }

        if (isWarning) {
          const flashRate = h.warningTicks <= 1 ? 16 : 9;
          const flash = frozen ? 0.45 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(elapsed * flashRate));
          if (vis.warningRingMat) vis.warningRingMat.opacity = 0.5 + 0.45 * flash;
          if (vis.warningFillMat) vis.warningFillMat.opacity = 0.15 + 0.35 * flash;
          if (vis.warningGroup && !frozen) {
            const ringScale = 0.92 + 0.14 * Math.sin(elapsed * flashRate);
            vis.warningGroup.scale.set(ringScale, 1, ringScale);
          }
          if (vis.meteorShadow && !frozen) {
            vis.meteorShadow.position.y = 0.8 + h.warningTicks * 0.9;
            vis.meteorShadow.rotation.y += delta * 4;
          }
        } else if (vis.meteorRock && !frozen) {
          vis.meteorRock.rotation.y += delta * 1.2;
          vis.meteorRock.rotation.x += delta * 0.7;
          vis.meteorRock.position.y = 0.06 + Math.sin(elapsed * 4 + h.id) * 0.05;
        }
      }
    }
  }

  dispose(): void {
    for (const vis of this.visuals.values()) {
      this.disposeHazardVisual(vis);
    }
    this.visuals.clear();
    this.scene.remove(this.root);

    this.slimeDomeGeo.dispose();
    this.slimeEyeWhiteGeo.dispose();
    this.slimePupilGeo.dispose();
    this.iceCubeGeo.dispose();
    this.iceRimGeo.dispose();
    this.crystalMainGeo.dispose();
    this.crystalShardGeo.dispose();
    this.gatePillarGeo.dispose();
    this.gateBeamGeo.dispose();
    this.gateCoreGeo.dispose();
    this.warningRingGeo.dispose();
    this.warningFillGeo.dispose();
    this.meteorRockGeo.dispose();
    this.meteorShadowGeo.dispose();

    this.slimeBodyMat.dispose();
    this.eyeWhiteMat.dispose();
    this.slimePupilMat.dispose();
    this.iceCubeMat.dispose();
    this.iceWireMat.dispose();
    this.crystalMat.dispose();
    this.crystalTipMat.dispose();
    this.meteorRockMat.dispose();
    this.meteorShadowMat.dispose();
  }

  private createHazardVisual(h: Hazard): HazardVisual {
    const group = new Group();
    const pos = cellToWorld(h.cell.x, h.cell.z, this.half);
    group.position.set(pos.x, 0, pos.z);

    const vis: HazardVisual = { id: h.id, group, hazard: h, ownMaterials: [] };

    if (h.kind === 'slime') {
      const slimeBody = new Group();
      const dome = new Mesh(this.slimeDomeGeo, this.slimeBodyMat);
      dome.scale.set(1.05, 0.88, 1.05);
      slimeBody.add(dome);

      for (const xSign of [-1, 1] as const) {
        const white = new Mesh(this.slimeEyeWhiteGeo, this.eyeWhiteMat);
        white.position.set(xSign * 0.15, 0.1, 0.3);
        slimeBody.add(white);

        const pupil = new Mesh(this.slimePupilGeo, this.slimePupilMat);
        pupil.position.set(xSign * 0.15, 0.1, 0.37);
        slimeBody.add(pupil);
      }

      const iceBlock = this.makeIceBlock(h.frozenTicks > 0, 1, 1, 1, 0.02);
      group.add(slimeBody, iceBlock);
      vis.slimeBodyGroup = slimeBody;
      vis.iceBlock = iceBlock;
    } else if (h.kind === 'crystal') {
      const crystalGroup = new Group();
      const center = new Mesh(this.crystalMainGeo, this.crystalMat);
      center.position.y = 0.04;
      crystalGroup.add(center);

      const shards: readonly { x: number; z: number; rx: number; rz: number }[] = [
        { x: -0.22, z: 0.14, rx: 0.28, rz: 0.35 },
        { x: 0.24, z: 0.1, rx: 0.2, rz: -0.38 },
        { x: 0.0, z: -0.24, rx: -0.34, rz: 0.08 },
      ];
      for (const s of shards) {
        const shard = new Mesh(this.crystalShardGeo, this.crystalTipMat);
        shard.position.set(s.x, -0.14, s.z);
        shard.rotation.set(s.rx, 0, s.rz);
        crystalGroup.add(shard);
      }
      const iceBlock = this.makeIceBlock(h.frozenTicks > 0, 1.06, 1.22, 1.06, 0.06);
      group.add(crystalGroup, iceBlock);
      vis.crystalGroup = crystalGroup;
      vis.iceBlock = iceBlock;
    } else if (h.kind === 'element_gate') {
      const form = h.requiredForm ?? 'dragon';
      const meta = FORM_METADATA[form];
      const gateMat = new MeshStandardMaterial({
        color: meta.hexColor,
        emissive: meta.hexColor,
        emissiveIntensity: 0.82,
        metalness: 0.25,
        roughness: 0.22,
      });
      vis.ownMaterials.push(gateMat);

      const leftPillar = new Mesh(this.gatePillarGeo, gateMat);
      leftPillar.position.set(-0.36, 0.02, 0);
      const rightPillar = new Mesh(this.gatePillarGeo, gateMat);
      rightPillar.position.set(0.36, 0.02, 0);
      const beam = new Mesh(this.gateBeamGeo, gateMat);
      beam.position.set(0, 0.5, 0);
      const core = new Mesh(this.gateCoreGeo, gateMat);
      core.position.set(0, 0.14, 0);

      const tex = this.badgeCache.getOrCreate({
        label: meta.emoji,
        borderColor: meta.cssColor,
        subLabel: SHORT_FORM_NAME[form],
      });
      const spriteMat = new SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      vis.ownMaterials.push(spriteMat);

      const sprite = new Sprite(spriteMat);
      sprite.position.set(0, 1.48, 0);
      sprite.scale.set(1.36, 0.85, 1);
      sprite.renderOrder = 12;

      const iceBlock = this.makeIceBlock(h.frozenTicks > 0, 1.26, 1.24, 0.68, 0.12);
      group.add(leftPillar, rightPillar, beam, core, sprite, iceBlock);
      vis.gateCore = core;
      vis.gateSprite = sprite;
      vis.gateSpriteMat = spriteMat;
      vis.iceBlock = iceBlock;
    } else {
      // Meteor: floor warning circle during warningTicks > 0, rock after landing.
      const warningGroup = new Group();
      const warningRingMat = new MeshBasicMaterial({
        color: 0xff5a26,
        transparent: true,
        opacity: 0.85,
        side: DoubleSide,
        depthWrite: false,
      });
      const warningFillMat = new MeshBasicMaterial({
        color: 0xff9e38,
        transparent: true,
        opacity: 0.3,
        side: DoubleSide,
        depthWrite: false,
      });
      vis.ownMaterials.push(warningRingMat, warningFillMat);

      const ring = new Mesh(this.warningRingGeo, warningRingMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.45;
      const fill = new Mesh(this.warningFillGeo, warningFillMat);
      fill.rotation.x = -Math.PI / 2;
      fill.position.y = -0.46;

      const meteorShadow = new Mesh(this.meteorShadowGeo, this.meteorShadowMat);
      meteorShadow.position.y = 2.0;

      warningGroup.add(ring, fill, meteorShadow);

      const meteorRock = new Mesh(this.meteorRockGeo, this.meteorRockMat);
      meteorRock.position.y = 0.06;

      const isWarning = h.warningTicks > 0;
      warningGroup.visible = isWarning;
      meteorRock.visible = !isWarning;

      const iceBlock = isWarning
        ? this.makeIceBlock(h.frozenTicks > 0, 1.22, 0.34, 1.22, -0.34)
        : this.makeIceBlock(h.frozenTicks > 0, 1.12, 1.12, 1.12, 0.06);

      group.add(warningGroup, meteorRock, iceBlock);
      vis.warningGroup = warningGroup;
      vis.warningRingMat = warningRingMat;
      vis.warningFillMat = warningFillMat;
      vis.meteorShadow = meteorShadow;
      vis.meteorRock = meteorRock;
      vis.iceBlock = iceBlock;
    }

    this.root.add(group);
    return vis;
  }

  private makeIceBlock(visible: boolean, sx: number, sy: number, sz: number, y: number): Mesh {
    const block = new Mesh(this.iceCubeGeo, this.iceCubeMat);
    const rim = new Mesh(this.iceRimGeo, this.iceWireMat);
    block.add(rim);
    block.scale.set(sx, sy, sz);
    block.position.y = y;
    block.visible = visible;
    return block;
  }

  private disposeHazardVisual(vis: HazardVisual): void {
    this.root.remove(vis.group);
    for (const mat of vis.ownMaterials) {
      mat.dispose();
    }
  }
}
