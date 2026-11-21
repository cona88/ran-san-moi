import {
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  type Scene,
} from 'three';
import { FORM_METADATA } from '../core/config';
import type { BrainQuest, GameState, QuestOrb } from '../core/types';
import { cellToWorld } from './world';

export interface BadgeOptions {
  readonly label: string;
  readonly borderColor: string;
  readonly textColor?: string;
  readonly subLabel?: string;
}

export type NameplateTier = 'player' | 'prey' | 'danger' | 'boss';

export interface NameplateOptions {
  readonly name: string;
  readonly level: number;
  readonly tier: NameplateTier;
}

function traceRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const safeR = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeR, y);
  ctx.arcTo(x + w, y, x + w, y + h, safeR);
  ctx.arcTo(x + w, y + h, x, y + h, safeR);
  ctx.arcTo(x, y + h, x, y, safeR);
  ctx.arcTo(x, y, x + w, y, safeR);
  ctx.closePath();
}

/**
 * Shared CanvasTexture cache for crisp 3D floating badges (BrainQuest &
 * ElementGate) and high-DPI snake level/name pill labels.
 * Disposes textures cleanly on eviction or when `dispose()` is called.
 */
export class BadgeTextureCache {
  private readonly textures = new Map<string, CanvasTexture>();
  private readonly nameplates = new Map<string, CanvasTexture>();

  getOrCreate(options: BadgeOptions): CanvasTexture {
    const key = `${options.label}|${options.borderColor}|${options.textColor ?? ''}|${options.subLabel ?? ''}`;
    const existing = this.textures.get(key);
    if (existing) return existing;

    if (this.textures.size >= 64) {
      const oldestKey = this.textures.keys().next().value;
      if (oldestKey !== undefined) {
        const oldTex = this.textures.get(oldestKey);
        oldTex?.dispose();
        this.textures.delete(oldestKey);
      }
    }

    const texture = this.renderBadgeTexture(options);
    this.textures.set(key, texture);
    return texture;
  }

  /**
   * Cached nameplate texture keyed strictly by `${name}|${level}|${tier}` so
   * nameplates are never re-rendered every frame.
   */
  getOrCreateNameplate(options: NameplateOptions): CanvasTexture {
    const key = `${options.name}|${options.level}|${options.tier}`;
    const existing = this.nameplates.get(key);
    if (existing) return existing;

    if (this.nameplates.size >= 128) {
      const oldestKey = this.nameplates.keys().next().value;
      if (oldestKey !== undefined) {
        const oldTex = this.nameplates.get(oldestKey);
        oldTex?.dispose();
        this.nameplates.delete(oldestKey);
      }
    }

    const texture = this.renderNameplateTexture(options);
    this.nameplates.set(key, texture);
    return texture;
  }

  dispose(): void {
    for (const tex of this.textures.values()) {
      tex.dispose();
    }
    this.textures.clear();
    for (const tex of this.nameplates.values()) {
      tex.dispose();
    }
    this.nameplates.clear();
  }

  private renderBadgeTexture(options: BadgeOptions): CanvasTexture {
    const width = 256;
    const height = options.subLabel ? 160 : 128;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      const pad = 10;
      const radius = 34;
      const rw = width - pad * 2;
      const rh = height - pad * 2;

      ctx.clearRect(0, 0, width, height);

      traceRoundRect(ctx, pad, pad, rw, rh, radius);
      ctx.fillStyle = 'rgba(20, 10, 44, 0.9)';
      ctx.fill();

      ctx.save();
      ctx.clip();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fillRect(pad, pad, rw, rh * 0.42);
      ctx.restore();

      traceRoundRect(ctx, pad, pad, rw, rh, radius);
      ctx.lineWidth = 8;
      ctx.strokeStyle = options.borderColor;
      ctx.stroke();

      const textColor = options.textColor ?? '#f7f2ff';
      const charCount = [...options.label].length;
      const fontSize = options.subLabel ? 58 : charCount >= 4 ? 48 : charCount === 3 ? 56 : 66;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${fontSize}px "Nunito", "Quicksand", "SF Pro Rounded", -apple-system, BlinkMacSystemFont, sans-serif`;

      const mainY = options.subLabel ? height * 0.41 : height * 0.52;
      ctx.lineJoin = 'round';
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#140826';
      ctx.strokeText(options.label, width / 2, mainY);
      ctx.fillStyle = textColor;
      ctx.fillText(options.label, width / 2, mainY);

      if (options.subLabel) {
        ctx.font =
          '700 28px "Nunito", "Quicksand", "SF Pro Rounded", -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.lineWidth = 5;
        ctx.strokeText(options.subLabel, width / 2, height * 0.74);
        ctx.fillStyle = options.borderColor;
        ctx.fillText(options.subLabel, width / 2, height * 0.74);
      }
    }

    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  private renderNameplateTexture(options: NameplateOptions): CanvasTexture {
    const width = 448;
    const height = 104;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      ctx.clearRect(0, 0, width, height);

      const safeName = options.name.length > 16 ? `${options.name.slice(0, 15)}…` : options.name;
      let labelText: string;
      let bgTop: string;
      let bgBottom: string;
      let borderColor: string;
      let textColor: string;
      let strokeColor: string;

      if (options.tier === 'player') {
        labelText = `Lv${options.level} ${safeName}`;
        bgTop = 'rgba(79, 70, 229, 0.94)';
        bgBottom = 'rgba(109, 40, 217, 0.94)';
        borderColor = '#fde047';
        textColor = '#ffffff';
        strokeColor = '#1e1b4b';
      } else if (options.tier === 'prey') {
        labelText = `Lv${options.level} ${safeName}`;
        bgTop = 'rgba(240, 253, 250, 0.95)';
        bgBottom = 'rgba(204, 251, 241, 0.95)';
        borderColor = '#10b981';
        textColor = '#064e3b';
        strokeColor = 'rgba(255, 255, 255, 0.75)';
      } else if (options.tier === 'boss') {
        labelText = `👹 Lv${options.level} ${safeName}`;
        bgTop = 'rgba(153, 27, 27, 0.96)';
        bgBottom = 'rgba(220, 38, 38, 0.96)';
        borderColor = '#fbbf24';
        textColor = '#fef08a';
        strokeColor = '#450a0a';
      } else {
        labelText = `⚠️ Lv${options.level} ${safeName}`;
        bgTop = 'rgba(239, 68, 68, 0.95)';
        bgBottom = 'rgba(234, 88, 12, 0.95)';
        borderColor = '#fef08a';
        textColor = '#ffffff';
        strokeColor = '#450a0a';
      }

      const fontSpec =
        '800 38px "Nunito", "Quicksand", "SF Pro Rounded", -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.font = fontSpec;
      const measured = ctx.measureText(labelText).width;
      const pillW = Math.min(width - 16, Math.max(180, measured + 56));
      const pillH = 74;
      const px = (width - pillW) / 2;
      const py = (height - pillH) / 2;
      const radius = pillH / 2;

      // Soft drop shadow
      ctx.save();
      ctx.shadowColor = 'rgba(15, 23, 42, 0.35)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 4;
      traceRoundRect(ctx, px, py, pillW, pillH, radius);
      const grad = ctx.createLinearGradient(0, py, 0, py + pillH);
      grad.addColorStop(0, bgTop);
      grad.addColorStop(1, bgBottom);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();

      // Gloss strip
      ctx.save();
      traceRoundRect(ctx, px, py, pillW, pillH, radius);
      ctx.clip();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.fillRect(px, py, pillW, pillH * 0.44);
      ctx.restore();

      // Border
      traceRoundRect(ctx, px, py, pillW, pillH, radius);
      ctx.lineWidth = 6;
      ctx.strokeStyle = borderColor;
      ctx.stroke();

      // Text
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = fontSpec;
      ctx.lineJoin = 'round';
      ctx.lineWidth = options.tier === 'prey' ? 4 : 6;
      ctx.strokeStyle = strokeColor;
      const maxTextW = pillW - 30;
      ctx.strokeText(labelText, width / 2, height / 2 + 1, maxTextW);
      ctx.fillStyle = textColor;
      ctx.fillText(labelText, width / 2, height / 2 + 1, maxTextW);
    }

    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }
}

/**
 * Shared 3D Golden Crown (`👑`) geometries & materials so both the player snake
 * and the #1 Bot can wear the royal crown with minimal draw overhead.
 */
export class CrownResources {
  private readonly bandGeo = new CylinderGeometry(0.24, 0.2, 0.14, 12);
  private readonly spikeGeo = new ConeGeometry(0.068, 0.22, 6);
  private readonly jewelGeo = new SphereGeometry(0.048, 8, 6);

  private readonly goldMat = new MeshStandardMaterial({
    color: 0xffd700,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.48,
    metalness: 0.65,
    roughness: 0.2,
  });
  private readonly rubyMat = new MeshStandardMaterial({
    color: 0xff3b7f,
    emissive: 0xe11d48,
    emissiveIntensity: 0.6,
    metalness: 0.2,
    roughness: 0.18,
  });
  private readonly emeraldMat = new MeshStandardMaterial({
    color: 0x34d399,
    emissive: 0x059669,
    emissiveIntensity: 0.55,
    metalness: 0.2,
    roughness: 0.18,
  });

  createCrownGroup(): Group {
    const group = new Group();
    const band = new Mesh(this.bandGeo, this.goldMat);
    group.add(band);

    const points = 5;
    for (let i = 0; i < points; i++) {
      const a = (i * Math.PI * 2) / points;
      const r = 0.2;
      const spike = new Mesh(this.spikeGeo, this.goldMat);
      spike.position.set(Math.cos(a) * r, 0.15, Math.sin(a) * r);
      spike.rotation.z = -Math.cos(a) * 0.18;
      spike.rotation.x = Math.sin(a) * 0.18;
      group.add(spike);

      const jewel = new Mesh(this.jewelGeo, i % 2 === 0 ? this.rubyMat : this.emeraldMat);
      jewel.position.set(Math.cos(a) * (r * 1.06), 0.26, Math.sin(a) * (r * 1.06));
      group.add(jewel);
    }

    return group;
  }

  dispose(): void {
    this.bandGeo.dispose();
    this.spikeGeo.dispose();
    this.jewelGeo.dispose();
    this.goldMat.dispose();
    this.rubyMat.dispose();
    this.emeraldMat.dispose();
  }
}

interface OrbVisual {
  readonly id: number;
  readonly orb: QuestOrb;
  readonly group: Group;
  readonly core: Mesh<IcosahedronGeometry, MeshStandardMaterial>;
  readonly halo: Mesh<TorusGeometry, MeshStandardMaterial>;
  readonly floorRing: Mesh<RingGeometry, MeshBasicMaterial>;
  readonly sprite: Sprite;
  readonly spriteMaterial: SpriteMaterial;
}

/**
 * Renders floating magical BrainQuest orbs and crisp CanvasTexture 3D label
 * sprites above each uncollected orb.
 */
export class Labels3DView {
  private readonly root = new Group();
  private readonly coreGeometry = new IcosahedronGeometry(0.32, 0);
  private readonly haloGeometry = new TorusGeometry(0.45, 0.036, 8, 28);
  private readonly floorRingGeometry = new RingGeometry(0.35, 0.48, 24);
  private readonly visuals = new Map<number, OrbVisual>();
  private syncedQuestId = -1;

  constructor(
    private readonly scene: Scene,
    private readonly half: number,
    private readonly badgeCache: BadgeTextureCache,
  ) {
    this.scene.add(this.root);
  }

  /** Reconcile 3D orbs & floating number/element labels with `state.quest`. */
  sync(state: GameState): void {
    const quest = state.quest;
    if (!quest || state.phase === 'gameover') {
      this.clearAll();
      this.syncedQuestId = -1;
      return;
    }

    if (quest.id !== this.syncedQuestId) {
      this.clearAll();
      this.syncedQuestId = quest.id;
    }

    const activeIds = new Set<number>();
    for (const orb of quest.orbs) {
      if (orb.collected) continue;
      activeIds.add(orb.id);
      if (!this.visuals.has(orb.id)) {
        this.visuals.set(orb.id, this.createOrbVisual(orb, quest));
      }
    }

    for (const [id, vis] of this.visuals) {
      if (!activeIds.has(id)) {
        this.disposeOrbVisual(vis);
        this.visuals.delete(id);
      }
    }
  }

  /** Animate floating orbs, halos and readable label sprites at 60fps. */
  animate(elapsed: number, delta: number, state: GameState): void {
    const quest = state.quest;
    let index = 0;
    for (const vis of this.visuals.values()) {
      const phase = index * 1.3;
      index += 1;

      const bob = Math.sin(elapsed * 3.2 + phase) * 0.1;
      vis.core.position.y = 0.2 + bob;
      vis.core.rotation.y += delta * 1.9;
      vis.core.rotation.x = Math.sin(elapsed * 1.8 + phase) * 0.25;

      vis.halo.position.y = 0.2 + bob;
      vis.halo.rotation.z += delta * 2.2;
      vis.halo.rotation.x = Math.PI * 0.36 + Math.sin(elapsed * 2 + phase) * 0.18;

      vis.sprite.position.y = 1.12 + bob * 0.7;

      const isNextSeq =
        quest?.kind === 'sequence' && vis.orb.sequenceOrder === quest.nextSequenceIndex;
      const isLetterNextSeq =
        quest?.kind === 'word_spell' && vis.orb.sequenceOrder === quest.nextSequenceIndex;
      const isActiveOrb = isNextSeq || isLetterNextSeq;
      const pulse = isActiveOrb
        ? 1 + 0.14 * Math.sin(elapsed * 6.5)
        : 1 + 0.05 * Math.sin(elapsed * 3 + phase);
      vis.core.scale.setScalar(pulse);
      vis.floorRing.material.opacity = isActiveOrb ? 0.55 + 0.35 * Math.sin(elapsed * 6.5) : 0.42;
    }
  }

  dispose(): void {
    this.clearAll();
    this.scene.remove(this.root);
    this.coreGeometry.dispose();
    this.haloGeometry.dispose();
    this.floorRingGeometry.dispose();
  }

  private createOrbVisual(orb: QuestOrb, quest: BrainQuest): OrbVisual {
    const formMeta = orb.formColor ? FORM_METADATA[orb.formColor] : undefined;
    const isLetterQuest = quest.kind === 'letter_match' || quest.kind === 'word_spell';
    const hexColor = formMeta
      ? formMeta.hexColor
      : isLetterQuest
        ? 0xc79dff
        : quest.kind === 'sequence'
          ? 0xffd447
          : 0x9b7dff;
    const cssColor = formMeta
      ? formMeta.cssColor
      : isLetterQuest
        ? '#c79dff'
        : quest.kind === 'sequence'
          ? '#ffd447'
          : '#c79dff';

    const group = new Group();
    const pos = cellToWorld(orb.cell.x, orb.cell.z, this.half);
    group.position.set(pos.x, 0, pos.z);

    // Slightly larger base scale for letter quests
    const baseScale = isLetterQuest ? 1.62 : 1.0;

    const core = new Mesh(
      this.coreGeometry,
      new MeshStandardMaterial({
        color: hexColor,
        emissive: hexColor,
        emissiveIntensity: 0.72,
        metalness: 0.2,
        roughness: 0.22,
      }),
    );
    core.position.y = 0.2;
    core.scale.setScalar(baseScale);
    group.add(core);

    const halo = new Mesh(
      this.haloGeometry,
      new MeshStandardMaterial({
        color: 0xffffff,
        emissive: hexColor,
        emissiveIntensity: 0.58,
        metalness: 0.15,
        roughness: 0.25,
      }),
    );
    halo.position.y = 0.2;
    group.add(halo);

    const floorRing = new Mesh(
      this.floorRingGeometry,
      new MeshBasicMaterial({
        color: hexColor,
        transparent: true,
        opacity: 0.45,
        side: DoubleSide,
        depthWrite: false,
      }),
    );
    floorRing.rotation.x = -Math.PI / 2;
    floorRing.position.y = -0.47;
    group.add(floorRing);

    const tex = this.badgeCache.getOrCreate({
      label: orb.label,
      borderColor: cssColor,
      subLabel: orb.subLabel,
    });
    const spriteMaterial = new SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new Sprite(spriteMaterial);
    sprite.position.set(0, 1.12, 0);
    const spriteScale = isLetterQuest ? 1.48 : 1.22;
    const spriteHeight = orb.subLabel ? 0.92 : 0.61;
    sprite.scale.set(spriteScale, spriteHeight, 1);
    sprite.renderOrder = 12;
    group.add(sprite);

    this.root.add(group);
    return { id: orb.id, orb, group, core, halo, floorRing, sprite, spriteMaterial };
  }

  private clearAll(): void {
    for (const vis of this.visuals.values()) {
      this.disposeOrbVisual(vis);
    }
    this.visuals.clear();
  }

  private disposeOrbVisual(vis: OrbVisual): void {
    this.root.remove(vis.group);
    vis.core.material.dispose();
    vis.halo.material.dispose();
    vis.floorRing.material.dispose();
    vis.spriteMaterial.dispose();
  }
}
