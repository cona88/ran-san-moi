import {
  ConeGeometry,
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
  type BufferGeometry,
  type Scene,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FORM_METADATA } from '../core/config';
import { clamp } from '../core/systems/arena';
import type { BotSkin, BotSnake, GamePhase, GameState } from '../core/types';
import type { BadgeTextureCache, CrownResources, NameplateTier } from './labels3d';
import { cellToWorld } from './world';

const TELEPORT_THRESHOLD_SQ = 4.0 * 4.0;
const LABEL_VISIBLE_DIST_SQ = 32 * 32;

function computeBotThicknessScale(level: number, isBoss: boolean): number {
  const base = clamp(0.85 + Math.log2(Math.max(1, level) + 4) * 0.14, 0.95, 1.85);
  return isBoss ? base * 1.45 : base;
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

interface BotSegmentVisual {
  readonly mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  readonly dorsalGem?: Mesh<OctahedronGeometry, MeshStandardMaterial>;
  readonly from: Vector3;
  readonly to: Vector3;
}

interface BotVisual {
  readonly id: number;
  readonly skin: BotSkin;
  readonly isBoss: boolean;
  readonly root: Group;
  readonly headGroup: Group;
  readonly iceBlock: Mesh<RoundedBoxGeometry, MeshStandardMaterial>;
  readonly bossAura?: Mesh<RingGeometry, MeshBasicMaterial>;
  readonly crownGroup: Group;
  readonly nameSprite: Sprite;
  readonly nameSpriteMat: SpriteMaterial;
  readonly headFrom: Vector3;
  readonly headTo: Vector3;
  readonly headWorldPos: Vector3;
  segments: BotSegmentVisual[];
  bot: BotSnake;
  headHeadingY: number;
  currentThickness: number;
  lastLabelKey: string;
}

interface SkinStyle {
  readonly primaryMat: MeshStandardMaterial;
  readonly secondaryMat: MeshStandardMaterial;
  readonly headMat: MeshStandardMaterial;
  readonly bodyGeo: BufferGeometry;
}

/**
 * Renders all active AI Bot snakes and the Boss Dragon King at 60fps using
 * smooth `prevSpine -> spine` interpolation, 7 distinct skins (including the
 * Snake Clash golden-armor + emerald-gem style), #1 crown, freeze cube & smart
 * color-coded 3D nameplates.
 */
export class BotsView {
  private readonly root = new Group();
  private readonly visuals = new Map<number, BotVisual>();

  // Shared geometries
  private readonly sphereSegGeo = new SphereGeometry(0.36, 14, 12);
  private readonly octSegGeo = new OctahedronGeometry(0.37, 1);
  private readonly boxSegGeo = new RoundedBoxGeometry(0.6, 0.56, 0.6, 2, 0.15);
  private readonly diamondSegGeo = new OctahedronGeometry(0.38, 0);
  private readonly headGeo = new RoundedBoxGeometry(0.76, 0.68, 0.78, 3, 0.24);
  private readonly dorsalGemGeo = new OctahedronGeometry(0.18, 0);

  private readonly eyeWhiteGeo = new SphereGeometry(0.13, 10, 8);
  private readonly pupilGeo = new SphereGeometry(0.078, 10, 8);
  private readonly hornGeo = new ConeGeometry(0.095, 0.46, 6);
  private readonly crestFinGeo = new ConeGeometry(0.12, 0.48, 4);
  private readonly iceCubeGeo = new RoundedBoxGeometry(1.06, 1.02, 1.06, 2, 0.14);
  private readonly bossAuraGeo = new RingGeometry(0.7, 1.05, 28);

  // Shared face & status materials
  private readonly eyeWhiteMat = new MeshBasicMaterial({ color: 0xffffff });
  private readonly pupilMat = new MeshBasicMaterial({ color: 0x160a2e });
  private readonly tealEyeMat = new MeshBasicMaterial({ color: 0x00f5d4 });
  private readonly iceCubeMat = new MeshStandardMaterial({
    color: 0x8ef9ff,
    emissive: 0x38e8ff,
    emissiveIntensity: 0.45,
    transparent: true,
    opacity: 0.5,
    metalness: 0.1,
    roughness: 0.14,
    depthWrite: false,
  });

  // Skin-specific materials
  private readonly goldArmorGemMat = new MeshStandardMaterial({
    color: 0x10e8b8,
    emissive: 0x059669,
    emissiveIntensity: 0.65,
    metalness: 0.25,
    roughness: 0.15,
  });
  private readonly bossHornMat = new MeshStandardMaterial({
    color: 0xff2a4b,
    emissive: 0xd97706,
    emissiveIntensity: 0.78,
    metalness: 0.4,
    roughness: 0.2,
  });
  private readonly bossAuraMat = new MeshBasicMaterial({
    color: 0xff3b30,
    transparent: true,
    opacity: 0.55,
    side: DoubleSide,
    depthWrite: false,
  });

  private readonly skinStyles: Record<BotSkin, SkinStyle>;
  private readonly scratchForward = new Vector3();
  private readonly scratchPerp = new Vector3();
  private readonly playerFocus = new Vector3();

  private lastBotsRef: readonly BotSnake[] | null = null;
  private lastPlayerLevel = -1;
  private lastPlayerRank = -1;
  private lastTopLeaderId = '';
  private lastPhase: GamePhase | null = null;
  private topBotId: number | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly half: number,
    private readonly badgeCache: BadgeTextureCache,
    private readonly crownResources: CrownResources,
  ) {
    this.skinStyles = {
      gold_armor: {
        primaryMat: new MeshStandardMaterial({
          color: 0xf5b942,
          emissive: 0xb45309,
          emissiveIntensity: 0.26,
          metalness: 0.58,
          roughness: 0.22,
        }),
        secondaryMat: new MeshStandardMaterial({
          color: 0xfcd34d,
          emissive: 0xd97706,
          emissiveIntensity: 0.3,
          metalness: 0.62,
          roughness: 0.2,
        }),
        headMat: new MeshStandardMaterial({
          color: 0xfbbf24,
          emissive: 0x92400e,
          emissiveIntensity: 0.28,
          metalness: 0.64,
          roughness: 0.2,
        }),
        bodyGeo: this.sphereSegGeo,
      },
      ruby_flame: {
        primaryMat: new MeshStandardMaterial({
          color: 0xe11d48,
          emissive: 0x9f1239,
          emissiveIntensity: 0.38,
          metalness: 0.3,
          roughness: 0.24,
        }),
        secondaryMat: new MeshStandardMaterial({
          color: 0x3b0a1a,
          emissive: 0x881337,
          emissiveIntensity: 0.28,
          metalness: 0.35,
          roughness: 0.3,
        }),
        headMat: new MeshStandardMaterial({
          color: 0xf43f5e,
          emissive: 0xbe123c,
          emissiveIntensity: 0.45,
          metalness: 0.32,
          roughness: 0.22,
        }),
        bodyGeo: this.sphereSegGeo,
      },
      lime_viper: {
        primaryMat: new MeshStandardMaterial({
          color: 0x84cc16,
          emissive: 0x4d7c0f,
          emissiveIntensity: 0.32,
          metalness: 0.2,
          roughness: 0.28,
        }),
        secondaryMat: new MeshStandardMaterial({
          color: 0x15803d,
          emissive: 0x166534,
          emissiveIntensity: 0.28,
          metalness: 0.25,
          roughness: 0.3,
        }),
        headMat: new MeshStandardMaterial({
          color: 0xa3e635,
          emissive: 0x3f6212,
          emissiveIntensity: 0.35,
          metalness: 0.22,
          roughness: 0.24,
        }),
        bodyGeo: this.diamondSegGeo,
      },
      dragon: {
        primaryMat: this.makeFormMat(FORM_METADATA.dragon.hexColor, 0.38),
        secondaryMat: this.makeFormMat(0xff94d9, 0.34),
        headMat: this.makeFormMat(0xffb8e6, 0.42),
        bodyGeo: this.sphereSegGeo,
      },
      phoenix: {
        primaryMat: this.makeFormMat(FORM_METADATA.phoenix.hexColor, 0.42),
        secondaryMat: this.makeFormMat(0x0ea5e9, 0.35),
        headMat: this.makeFormMat(0x99f6ff, 0.46),
        bodyGeo: this.octSegGeo,
      },
      unicorn: {
        primaryMat: this.makeFormMat(FORM_METADATA.unicorn.hexColor, 0.4),
        secondaryMat: this.makeFormMat(0xfef08a, 0.35),
        headMat: this.makeFormMat(0xffe885, 0.44),
        bodyGeo: this.sphereSegGeo,
      },
      spirit: {
        primaryMat: this.makeFormMat(FORM_METADATA.spirit.hexColor, 0.36),
        secondaryMat: this.makeFormMat(0x10b981, 0.32),
        headMat: this.makeFormMat(0x86efac, 0.4),
        bodyGeo: this.boxSegGeo,
      },
    };

    this.scene.add(this.root);
  }

  /** Reconcile active bot visuals & leaderboard crown target with `state`. */
  sync(state: GameState): void {
    const topLeaderId = state.leaderboard[0]?.id ?? '';
    if (
      state.bots === this.lastBotsRef &&
      state.level === this.lastPlayerLevel &&
      state.playerRank === this.lastPlayerRank &&
      topLeaderId === this.lastTopLeaderId &&
      state.phase === this.lastPhase
    ) {
      return;
    }

    this.lastBotsRef = state.bots;
    this.lastPlayerLevel = state.level;
    this.lastPlayerRank = state.playerRank;
    this.lastTopLeaderId = topLeaderId;
    this.lastPhase = state.phase;

    if (state.playerRank !== 1 && topLeaderId.startsWith('bot-')) {
      const parsed = Number(topLeaderId.slice(4));
      this.topBotId = Number.isFinite(parsed) ? parsed : null;
    } else {
      this.topBotId = null;
    }

    const seen = new Set<number>();
    for (const bot of state.bots) {
      seen.add(bot.id);
      let vis = this.visuals.get(bot.id);
      if (!vis) {
        vis = this.createBotVisual(bot);
        this.visuals.set(bot.id, vis);
      } else {
        vis.bot = bot;
      }
      this.syncBotSegmentsAndLabel(vis, bot, state.level);
    }

    for (const [id, vis] of this.visuals) {
      if (!seen.has(id)) {
        this.disposeBotVisual(vis);
        this.visuals.delete(id);
      }
    }
  }

  /** Interpolate all active bots at 60fps and animate crowns, boss auras & labels. */
  draw(alpha: number, elapsed: number, delta: number, state: GameState): void {
    this.sync(state);

    const dt = Math.min(Math.max(delta, 0), 0.1);
    const a = Math.max(0, Math.min(1, alpha));
    const gameover = state.phase === 'gameover';

    const playerHead = state.snake[0];
    if (playerHead) {
      cellToWorld(playerHead.x, playerHead.z, this.half, this.playerFocus);
    } else {
      this.playerFocus.set(0, 0, 0);
    }

    for (const vis of this.visuals.values()) {
      const bot = vis.bot;
      const targetThickness = computeBotThicknessScale(bot.level, bot.isBoss);
      vis.currentThickness += (targetThickness - vis.currentThickness) * Math.min(1, dt * 8);

      // 1. Head interpolation + rotation
      vis.headWorldPos.lerpVectors(vis.headFrom, vis.headTo, a);
      const headScale = vis.currentThickness * 0.96;
      const headBaseY = Math.max(0.08, 0.35 * headScale - 0.42);
      const headBob = gameover ? 0 : Math.sin(elapsed * 4.2 + bot.id) * 0.04;
      vis.headGroup.scale.setScalar(headScale);
      vis.headGroup.position.set(vis.headWorldPos.x, headBaseY + headBob, vis.headWorldPos.z);

      const targetYaw = headingToYaw(bot.heading);
      const headingDiff = normalizeAngleDiff(targetYaw, vis.headHeadingY);
      vis.headHeadingY += headingDiff * Math.min(1, dt * 15);
      vis.headGroup.rotation.y = vis.headHeadingY;

      vis.iceBlock.visible = bot.frozenTicks > 0;

      if (vis.bossAura) {
        vis.bossAura.position.set(vis.headWorldPos.x, -0.46, vis.headWorldPos.z);
        const auraPulse = (1.25 + Math.sin(elapsed * 5.2) * 0.16) * (vis.currentThickness * 0.72);
        vis.bossAura.scale.setScalar(auraPulse);
      }

      // 2. Tapered body interpolation
      const count = vis.segments.length;
      const fx = Math.cos(bot.heading);
      const fz = Math.sin(bot.heading);

      for (let i = 0; i < count; i++) {
        const seg = vis.segments[i];
        if (!seg) continue;

        const taper = 1.0 - 0.64 * (i / Math.max(1, count - 1));
        const segScale = vis.currentThickness * taper;
        seg.mesh.scale.setScalar(segScale);
        seg.mesh.position.lerpVectors(seg.from, seg.to, a);

        this.scratchForward.subVectors(seg.to, seg.from);
        if (this.scratchForward.lengthSq() < 1e-4) {
          this.scratchForward.set(fx, 0, fz);
        } else {
          this.scratchForward.normalize();
        }
        this.scratchPerp.set(-this.scratchForward.z, 0, this.scratchForward.x);

        const waveAmp = gameover ? 0 : 0.036 * taper * Math.min(1, (i + 1) / 3);
        const wave = Math.sin(elapsed * 5.8 - (i + 1) * 0.7 + bot.id) * waveAmp;
        const baseSegY = Math.max(0, 0.36 * segScale - 0.44);
        const bob = gameover ? 0 : Math.sin(elapsed * 4.2 - (i + 1) * 0.65 + bot.id) * 0.03;
        seg.mesh.position.addScaledVector(this.scratchPerp, wave);
        seg.mesh.position.y = baseSegY + bob;
        seg.mesh.rotation.y = Math.atan2(this.scratchForward.x, this.scratchForward.z);

        if (seg.dorsalGem) {
          seg.dorsalGem.rotation.y = elapsed * 2.1 + i * 0.4;
        }
      }

      // 3. #1 Crown
      const hasCrown = this.topBotId === bot.id && !gameover;
      vis.crownGroup.visible = hasCrown;
      if (hasCrown) {
        const crownScale = Math.max(1.0, vis.currentThickness * 0.88);
        vis.crownGroup.scale.setScalar(crownScale);
        vis.crownGroup.position.set(
          vis.headWorldPos.x,
          headBaseY + headScale * 0.9 + Math.sin(elapsed * 3.4 + bot.id) * 0.05,
          vis.headWorldPos.z,
        );
        vis.crownGroup.rotation.y += dt * 1.5;
      }

      // 4. Smart 3D Nameplate within camera range (dist < 32)
      const dx = vis.headWorldPos.x - this.playerFocus.x;
      const dz = vis.headWorldPos.z - this.playerFocus.z;
      const inRange = dx * dx + dz * dz < LABEL_VISIBLE_DIST_SQ;
      vis.nameSprite.visible = inRange && !gameover;
      if (vis.nameSprite.visible) {
        const labelY = headBaseY + headScale * (hasCrown ? 1.58 : 1.12);
        vis.nameSprite.position.set(vis.headWorldPos.x, labelY, vis.headWorldPos.z);
        const baseW = bot.isBoss ? 3.7 : 3.05;
        const baseH = bot.isBoss ? 0.88 : 0.72;
        vis.nameSprite.scale.set(baseW, baseH, 1);
      }
    }
  }

  dispose(): void {
    for (const vis of this.visuals.values()) {
      this.disposeBotVisual(vis);
    }
    this.visuals.clear();
    this.scene.remove(this.root);

    this.sphereSegGeo.dispose();
    this.octSegGeo.dispose();
    this.boxSegGeo.dispose();
    this.diamondSegGeo.dispose();
    this.headGeo.dispose();
    this.dorsalGemGeo.dispose();
    this.eyeWhiteGeo.dispose();
    this.pupilGeo.dispose();
    this.hornGeo.dispose();
    this.crestFinGeo.dispose();
    this.iceCubeGeo.dispose();
    this.bossAuraGeo.dispose();

    this.eyeWhiteMat.dispose();
    this.pupilMat.dispose();
    this.tealEyeMat.dispose();
    this.iceCubeMat.dispose();
    this.goldArmorGemMat.dispose();
    this.bossHornMat.dispose();
    this.bossAuraMat.dispose();

    for (const style of Object.values(this.skinStyles)) {
      style.primaryMat.dispose();
      style.secondaryMat.dispose();
      style.headMat.dispose();
    }
  }

  private makeFormMat(hex: number, emissiveIntensity: number): MeshStandardMaterial {
    return new MeshStandardMaterial({
      color: hex,
      emissive: hex,
      emissiveIntensity,
      metalness: 0.22,
      roughness: 0.25,
    });
  }

  private createBotVisual(bot: BotSnake): BotVisual {
    const style = this.skinStyles[bot.skin];
    const root = new Group();
    const headGroup = new Group();

    const headMesh = new Mesh(this.headGeo, style.headMat);
    headGroup.add(headMesh);

    // Cute expressive bot eyes
    for (const xSign of [-1, 1] as const) {
      const white = new Mesh(this.eyeWhiteGeo, this.eyeWhiteMat);
      white.position.set(xSign * 0.2, 0.16, 0.34);
      white.scale.set(0.95, 1.08, 0.72);
      headGroup.add(white);

      const pupilMat = bot.skin === 'gold_armor' ? this.tealEyeMat : this.pupilMat;
      const pupil = new Mesh(this.pupilGeo, pupilMat);
      pupil.position.set(xSign * 0.2, 0.16, 0.41);
      headGroup.add(pupil);
    }

    // Skin-specific head armor / horns / crest
    this.attachSkinHeadDetail(headGroup, bot.skin, bot.isBoss, style);

    const iceBlock = new Mesh(this.iceCubeGeo, this.iceCubeMat);
    iceBlock.position.y = 0.05;
    iceBlock.visible = bot.frozenTicks > 0;
    headGroup.add(iceBlock);

    root.add(headGroup);

    let bossAura: Mesh<RingGeometry, MeshBasicMaterial> | undefined;
    if (bot.isBoss) {
      bossAura = new Mesh(this.bossAuraGeo, this.bossAuraMat);
      bossAura.rotation.x = -Math.PI / 2;
      bossAura.position.y = -0.46;
      root.add(bossAura);
    }

    const crownGroup = this.crownResources.createCrownGroup();
    crownGroup.visible = false;
    root.add(crownGroup);

    const nameSpriteMat = new SpriteMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const nameSprite = new Sprite(nameSpriteMat);
    nameSprite.renderOrder = 10;
    root.add(nameSprite);

    const headFrom = new Vector3();
    const headTo = new Vector3();
    const prevHead = bot.prevHead ?? bot.head;
    cellToWorld(prevHead.x, prevHead.z, this.half, headFrom);
    cellToWorld(bot.head.x, bot.head.z, this.half, headTo);

    this.root.add(root);

    return {
      id: bot.id,
      skin: bot.skin,
      isBoss: bot.isBoss,
      root,
      headGroup,
      iceBlock,
      bossAura,
      crownGroup,
      nameSprite,
      nameSpriteMat,
      headFrom,
      headTo,
      headWorldPos: headTo.clone(),
      segments: [],
      bot,
      headHeadingY: headingToYaw(bot.heading),
      currentThickness: computeBotThicknessScale(bot.level, bot.isBoss),
      lastLabelKey: '',
    };
  }

  private attachSkinHeadDetail(
    headGroup: Group,
    skin: BotSkin,
    isBoss: boolean,
    style: SkinStyle,
  ): void {
    if (isBoss) {
      // Imposing crimson-gold Dragon King Boss horns & central brow crest.
      for (const xSign of [-1, 1] as const) {
        const bigHorn = new Mesh(this.hornGeo, this.bossHornMat);
        bigHorn.scale.set(1.35, 1.55, 1.35);
        bigHorn.position.set(xSign * 0.24, 0.52, -0.04);
        bigHorn.rotation.set(-0.42, 0, -xSign * 0.36);
        headGroup.add(bigHorn);
      }
      const centerGem = new Mesh(this.dorsalGemGeo, style.secondaryMat);
      centerGem.position.set(0, 0.38, 0.22);
      centerGem.scale.setScalar(1.3);
      headGroup.add(centerGem);
      return;
    }

    if (skin === 'gold_armor') {
      // Warrior gold helmet crest + glowing emerald brow jewel
      const crest = new Mesh(this.crestFinGeo, style.secondaryMat);
      crest.position.set(0, 0.44, -0.05);
      crest.rotation.x = -0.35;
      headGroup.add(crest);

      const browGem = new Mesh(this.dorsalGemGeo, this.goldArmorGemMat);
      browGem.position.set(0, 0.36, 0.24);
      browGem.scale.set(1.1, 1.1, 0.85);
      headGroup.add(browGem);
    } else if (skin === 'ruby_flame' || skin === 'dragon') {
      for (const xSign of [-1, 1] as const) {
        const horn = new Mesh(this.hornGeo, style.primaryMat);
        horn.position.set(xSign * 0.19, 0.44, -0.06);
        horn.rotation.set(-0.48, 0, -xSign * 0.28);
        headGroup.add(horn);
      }
    } else if (skin === 'phoenix') {
      const plume = new Mesh(this.crestFinGeo, style.headMat);
      plume.position.set(0, 0.46, -0.08);
      plume.rotation.x = -0.55;
      headGroup.add(plume);
    } else if (skin === 'unicorn') {
      const horn = new Mesh(this.hornGeo, style.primaryMat);
      horn.scale.set(0.95, 1.3, 0.95);
      horn.position.set(0, 0.48, 0.16);
      horn.rotation.x = 0.34;
      headGroup.add(horn);
    } else {
      // lime_viper & spirit: sleek emerald brow ridges / crown
      for (const xSign of [-1, 1] as const) {
        const ridge = new Mesh(this.crestFinGeo, style.secondaryMat);
        ridge.scale.set(0.7, 0.75, 0.7);
        ridge.position.set(xSign * 0.18, 0.38, 0.04);
        ridge.rotation.set(-0.2, 0, -xSign * 0.42);
        headGroup.add(ridge);
      }
    }
  }

  private syncBotSegmentsAndLabel(vis: BotVisual, bot: BotSnake, playerLevel: number): void {
    const style = this.skinStyles[bot.skin];

    const prevHead = bot.prevHead ?? bot.head;
    cellToWorld(prevHead.x, prevHead.z, this.half, vis.headFrom);
    cellToWorld(bot.head.x, bot.head.z, this.half, vis.headTo);
    if (vis.headFrom.distanceToSquared(vis.headTo) > TELEPORT_THRESHOLD_SQ) {
      vis.headFrom.copy(vis.headTo);
    }

    const bodyCount = Math.max(0, bot.spine.length - 1);
    while (vis.segments.length < bodyCount) {
      const idx = vis.segments.length;
      const useSecondary = idx % 2 === 1;
      const mat = useSecondary ? style.secondaryMat : style.primaryMat;
      const mesh = new Mesh(style.bodyGeo, mat);

      let dorsalGem: Mesh<OctahedronGeometry, MeshStandardMaterial> | undefined;
      if (bot.skin === 'gold_armor' && idx % 2 === 0) {
        dorsalGem = new Mesh(this.dorsalGemGeo, this.goldArmorGemMat);
        dorsalGem.position.set(0, 0.3, 0);
        dorsalGem.scale.set(1.05, 0.85, 1.25);
        mesh.add(dorsalGem);
      }

      vis.root.add(mesh);
      vis.segments.push({ mesh, dorsalGem, from: new Vector3(), to: new Vector3() });
    }
    while (vis.segments.length > bodyCount) {
      const removed = vis.segments.pop();
      if (removed) {
        vis.root.remove(removed.mesh);
      }
    }

    for (let i = 0; i < bodyCount; i++) {
      const cur = bot.spine[i + 1];
      const seg = vis.segments[i];
      if (!cur || !seg) continue;

      const prev = bot.prevSpine[i + 1] ?? cur;
      cellToWorld(prev.x, prev.z, this.half, seg.from);
      cellToWorld(cur.x, cur.z, this.half, seg.to);
      if (seg.from.distanceToSquared(seg.to) > TELEPORT_THRESHOLD_SQ) {
        seg.from.copy(seg.to);
      }
    }

    const tier: NameplateTier = bot.isBoss ? 'boss' : bot.level <= playerLevel ? 'prey' : 'danger';
    const labelKey = `${bot.name}|${bot.level}|${tier}`;
    if (labelKey !== vis.lastLabelKey) {
      vis.lastLabelKey = labelKey;
      vis.nameSpriteMat.map = this.badgeCache.getOrCreateNameplate({
        name: bot.name,
        level: bot.level,
        tier,
      });
      vis.nameSpriteMat.needsUpdate = true;
    }
  }

  private disposeBotVisual(vis: BotVisual): void {
    this.root.remove(vis.root);
    vis.nameSpriteMat.dispose();
    vis.segments = [];
  }
}
