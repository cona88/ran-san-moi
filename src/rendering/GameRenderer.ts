import { Vector3 } from 'three';
import { FORM_METADATA } from '../core/config';
import { activeSize } from '../core/systems/arena';
import type { Cell, GameConfig, GameEvent, GameState, SnakeForm, VisualTheme } from '../core/types';
import { Board } from './board';
import { BotsView } from './bots';
import { FairyMagicView } from './fairyMagic3d';
import { FoodView } from './food';
import { BadgeTextureCache, CrownResources, Labels3DView } from './labels3d';
import { ObstaclesView } from './obstacles';
import { THEMES } from './palette';
import { ParticleSystem } from './particles';
import { ProjectilesView } from './projectiles';
import { SceneRig } from './scene';
import { RoamingMonstersView, Shelter3DView } from './shelter3d';
import { SnakeView } from './snake';
import { cellToWorld, halfOf } from './world';

function sprayWaveHex(form: SnakeForm): number {
  switch (form) {
    case 'dragon':
      return 0xff6e30;
    case 'phoenix':
      return 0x38f6ff;
    case 'unicorn':
      return 0x25b8ff;
    case 'spirit':
      return 0x4dff9a;
  }
}

/**
 * Facade over the 3D rendering layer.
 * Nothing here mutates game state — it strictly reflects `GameState` and `GameEvent`s.
 */
export class GameRenderer {
  private readonly rig: SceneRig;
  private readonly board = new Board();
  private readonly badgeCache = new BadgeTextureCache();
  private readonly crownResources = new CrownResources();
  private readonly snakeView: SnakeView;
  private readonly botsView: BotsView;
  private readonly foodView: FoodView;
  private readonly projectilesView: ProjectilesView;
  private readonly obstaclesView: ObstaclesView;
  private readonly labels3dView: Labels3DView;
  private readonly particles: ParticleSystem;
  private readonly fairyMagic: FairyMagicView;
  private readonly shelterView: Shelter3DView;
  private readonly roamingMonstersView: RoamingMonstersView;

  private readonly half: number;
  private renderedMargin = -1;
  private renderedWorldRadius = -1;
  private renderedWrapWalls = false;
  private renderedPending = false;
  private hasSyncedCamera = false;
  private currentTheme: VisualTheme = 'honeycomb_arena';

  private readonly projected = new Vector3();
  private readonly eventPos = new Vector3();
  private readonly headSparkPos = new Vector3();
  private readonly bodyTrailPos = new Vector3();
  private readonly boltBurstPos = new Vector3();
  private readonly flowerBurstPos = new Vector3();
  private readonly sprayMuzzlePos = new Vector3();
  private readonly headCamPos = new Vector3();
  private readonly recentSpiritBlooms: Vector3[] = [];
  private dashSparkAcc = 0;
  private bodyTrailAcc = 0;
  private bodyTrailIndex = 0;
  private wingDustAcc = 0;
  private fallingIceAcc = 0;
  private cocoonSparkAcc = 0;
  private sprayStreamAcc = 0;
  private aerialCamAltitude = 0;

  constructor(container: HTMLElement, config: GameConfig) {
    this.half = halfOf(config.maxGrid);
    this.rig = new SceneRig(container, 11.5);
    this.rig.scene.add(this.board.group);

    this.snakeView = new SnakeView(this.rig.scene, this.half, this.badgeCache, this.crownResources);
    this.botsView = new BotsView(this.rig.scene, this.half, this.badgeCache, this.crownResources);
    this.foodView = new FoodView(this.rig.scene, this.half);
    this.projectilesView = new ProjectilesView(this.rig.scene, this.half);
    this.obstaclesView = new ObstaclesView(this.rig.scene, this.half, this.badgeCache);
    this.labels3dView = new Labels3DView(this.rig.scene, this.half, this.badgeCache);
    this.particles = new ParticleSystem(this.rig.scene);
    this.fairyMagic = new FairyMagicView(this.rig.scene, config.maxGrid);
    this.shelterView = new Shelter3DView(this.rig.scene, config.maxGrid);
    this.roamingMonstersView = new RoamingMonstersView(this.rig.scene);

    this.setTheme(this.currentTheme);
  }

  /** Reflect a logic tick or state transition into all 3D views. */
  sync(state: GameState): void {
    const wrapWalls = state.config.wrapWalls;
    const worldRadius = state.config.worldRadius;
    if (
      state.arenaMargin !== this.renderedMargin ||
      worldRadius !== this.renderedWorldRadius ||
      wrapWalls !== this.renderedWrapWalls
    ) {
      this.board.rebuild(activeSize(state.config, state.arenaMargin), wrapWalls, this.currentTheme);
      this.renderedMargin = state.arenaMargin;
      this.renderedWorldRadius = worldRadius;
      this.renderedWrapWalls = wrapWalls;
      this.renderedPending = false;
    }

    const pending = state.pendingShrink && state.phase !== 'gameover';
    if (pending !== this.renderedPending) {
      if (pending) {
        this.board.showShrinkPreview(activeSize(state.config, state.arenaMargin + 1));
      } else {
        this.board.hideShrinkPreview();
      }
      this.renderedPending = pending;
    }

    this.board.setGameOver(state.phase === 'gameover');
    this.snakeView.onTick(state);

    const head = state.snake[0];
    if (head && (!this.hasSyncedCamera || state.phase === 'ready')) {
      cellToWorld(head.x, head.z, this.half, this.headCamPos);
      this.rig.snapFollowTarget(this.headCamPos.x, this.headCamPos.z, state.level);
      this.hasSyncedCamera = true;
    }

    this.syncProjectiles(state);
    this.fairyMagic.sync(state);
    this.shelterView.sync(state);
    this.roamingMonstersView.sync(state);
  }

  /** Sync projectiles, bots, hazards, quest orbs & world orbs without disturbing snake interpolation. */
  syncProjectiles(state: GameState): void {
    this.foodView.sync(state);
    this.botsView.sync(state);
    this.obstaclesView.sync(state);
    this.labels3dView.sync(state);
    const vanishedSpirit = this.projectilesView.sync(state);
    for (const pos of vanishedSpirit) {
      const alreadyBloomed = this.recentSpiritBlooms.some((p) => p.distanceToSquared(pos) < 2.5);
      if (!alreadyBloomed) {
        this.particles.spiritBloomExplosion(pos);
      }
    }
    this.recentSpiritBlooms.length = 0;
    this.fairyMagic.sync(state);
    this.shelterView.sync(state);
    this.roamingMonstersView.sync(state);
  }

  /** Trigger magical 3D particle bursts, camera shake & zoom pulses in response to a `GameEvent`. */
  onEvent(event: GameEvent, state: GameState): void {
    const cell = event.cell ?? state.snake[0];
    if (cell) {
      cellToWorld(cell.x, cell.z, this.half, this.eventPos);
    } else {
      this.eventPos.set(0, 0, 0);
    }

    const form = event.form ?? state.form;
    const formHex = FORM_METADATA[form].hexColor;
    const themePalette = THEMES[this.currentTheme];
    const aerialLift = state.butterflyAltitude * 2.65;

    switch (event.kind) {
      case 'eat_food':
        this.particles.burstStars(this.eventPos, themePalette.foodColor, 14, 3.8, 0.9, false);
        this.particles.expandingWave(this.eventPos, themePalette.bonusColor, 1.25, 0.32);
        break;
      case 'eat_bonus':
        this.particles.multiRingStarburst(
          this.eventPos,
          themePalette.bonusColor,
          0xffe478,
          14,
          5.0,
          1.05,
        );
        this.particles.burstStars(this.eventPos, themePalette.bonusColor, 24, 5.2, 1.15, true);
        this.rig.triggerZoomPulse(-0.018);
        break;
      case 'shoot': {
        const fx = Math.cos(state.heading);
        const fz = Math.sin(state.heading);
        const waveHex = sprayWaveHex(form);
        this.computeMuzzlePos(this.eventPos, fx, fz, state.butterflyAltitude, this.sprayMuzzlePos);
        this.particles.sprayStreamJet(this.sprayMuzzlePos, fx, fz, form);
        this.particles.burstStars(this.sprayMuzzlePos, waveHex, 8, 4.2, 0.78, false);
        this.particles.expandingWave(this.sprayMuzzlePos, waveHex, 1.65, 0.3, 0.24);
        this.rig.triggerShake(0.06, 0.12);
        this.rig.triggerZoomPulse(-0.012);
        break;
      }
      case 'morph':
        this.eventPos.y += aerialLift;
        this.snakeView.triggerMorphPulse();
        this.particles.multiRingStarburst(this.eventPos, formHex, 0xffe95c, 16, 4.8, 1.05);
        this.particles.expandingWave(this.eventPos, formHex, 2.6, 0.5);
        this.rig.triggerShake(0.11, 0.18);
        this.rig.triggerZoomPulse(-0.025);
        break;
      case 'dash':
        this.eventPos.y += aerialLift;
        this.particles.expandingWave(this.eventPos, formHex, 1.85, 0.34);
        this.particles.burstStars(this.eventPos, formHex, 10, 3.8, 0.85, false);
        this.rig.triggerZoomPulse(-0.015);
        break;
      case 'shield_activate':
        this.eventPos.y += aerialLift;
        this.particles.multiRingStarburst(this.eventPos, 0x72f6ff, 0xffb8f0, 14, 4.2, 0.95);
        this.particles.expandingWave(this.eventPos, 0x72f6ff, 2.6, 0.55);
        this.rig.triggerShake(0.09, 0.16);
        break;
      case 'shield_block':
        this.particles.multiRingStarburst(this.eventPos, 0xff9ee6, 0x72f6ff, 14, 4.6, 1.0);
        this.particles.expandingWave(this.eventPos, 0xff9ee6, 2.6, 0.45);
        this.rig.triggerShake(0.18, 0.2);
        this.rig.triggerZoomPulse(0.025);
        break;
      case 'hazard_hit':
        if (event.form === 'spirit') {
          this.recentSpiritBlooms.push(this.eventPos.clone());
          this.particles.spiritBloomExplosion(this.eventPos);
        }
        this.particles.sprayImpactBurst(this.eventPos, form);
        break;
      case 'hazard_destroyed':
        if (event.form === 'spirit') {
          this.recentSpiritBlooms.push(this.eventPos.clone());
          this.particles.spiritBloomExplosion(this.eventPos);
        }
        this.particles.sprayImpactBurst(this.eventPos, form);
        this.particles.burstStars(this.eventPos, formHex, 16, 5.0, 1.08, false);
        this.rig.triggerShake(0.08, 0.14);
        break;
      case 'bot_hit':
        if (event.form === 'spirit') {
          this.recentSpiritBlooms.push(this.eventPos.clone());
          this.particles.spiritBloomExplosion(this.eventPos);
        }
        this.particles.sprayImpactBurst(this.eventPos, form);
        this.rig.triggerShake(0.05, 0.1);
        break;
      case 'bot_chomp': {
        const chompStreak = event.chompStreak ?? state.chompStreak;
        const intensity = Math.min(1, Math.max(0, (chompStreak - 1) / 6));
        this.snakeView.triggerChomp(chompStreak);
        this.particles.chompBurst(this.eventPos, formHex, chompStreak);
        this.rig.triggerShake(0.12 + intensity * 0.14, 0.16 + intensity * 0.08);
        this.rig.triggerZoomPulse(-0.02 - intensity * 0.025);
        break;
      }
      case 'bot_eaten':
        this.snakeView.triggerChomp((state.chompStreak || 4) + 2);
        this.particles.chompBurst(this.eventPos, formHex, (state.chompStreak || 4) + 3);
        this.particles.multiRingStarburst(this.eventPos, formHex, 0xffe478, 22, 6.2, 1.25);
        this.particles.expandingWave(this.eventPos, formHex, 3.6, 0.58);
        this.particles.expandingWave(this.eventPos, 0xffe478, 2.5, 0.44);
        this.rig.triggerShake(0.28, 0.28);
        this.rig.triggerZoomPulse(-0.045);
        break;
      case 'eaten_by_bot':
        this.particles.expandingWave(this.eventPos, 0xff4d4f, 3.2, 0.52);
        this.particles.burstStars(this.eventPos, 0xff7a45, 26, 5.2, 1.2, false);
        this.rig.triggerShake(0.3, 0.3);
        this.rig.triggerZoomPulse(0.045);
        break;
      case 'boss_spawn':
        this.particles.multiRingStarburst(this.eventPos, 0xff2a4b, 0xffd447, 24, 6.5, 1.35);
        this.particles.expandingWave(this.eventPos, 0xff2a4b, 6.8, 0.85, 0.5);
        this.particles.expandingWave(this.eventPos, 0xffd447, 4.8, 0.68, 0.35);
        this.rig.triggerShake(0.36, 0.45);
        this.rig.triggerZoomPulse(0.06);
        break;
      case 'boss_defeated':
        this.particles.fireworks(this.eventPos);
        this.particles.multiRingStarburst(this.eventPos, 0xffd447, 0xff70d0, 26, 6.8, 1.4);
        this.particles.expandingWave(this.eventPos, 0xffd447, 5.6, 0.75, 0.4);
        this.rig.triggerShake(0.42, 0.48);
        this.rig.triggerZoomPulse(0.075);
        break;
      case 'booster_activate':
        this.eventPos.y += aerialLift;
        this.particles.multiRingStarburst(this.eventPos, 0x38f6ff, 0xffd447, 18, 5.2, 1.15);
        this.particles.expandingWave(this.eventPos, 0x38f6ff, 3.2, 0.52);
        this.rig.triggerShake(0.14, 0.2);
        this.rig.triggerZoomPulse(-0.03);
        break;
      case 'quest_spawn':
        if (state.quest) {
          for (const orb of state.quest.orbs) {
            cellToWorld(orb.cell.x, orb.cell.z, this.half, this.eventPos);
            this.particles.expandingWave(this.eventPos, 0xc79dff, 1.45, 0.45);
          }
        }
        break;
      case 'quest_progress':
        this.particles.multiRingStarburst(this.eventPos, 0xffd447, 0x5cf6ff, 14, 4.6, 1.0);
        this.particles.expandingWave(this.eventPos, 0xffe478, 1.9, 0.42);
        this.rig.triggerShake(0.12, 0.18);
        this.rig.triggerZoomPulse(-0.025);
        break;
      case 'quest_complete':
        this.particles.fireworks(this.eventPos);
        this.particles.multiRingStarburst(this.eventPos, 0xffe478, 0x5effa8, 22, 5.8, 1.25);
        this.rig.triggerShake(0.26, 0.32);
        this.rig.triggerZoomPulse(-0.05);
        break;
      case 'quest_wrong':
        this.particles.expandingWave(this.eventPos, 0xffa8d8, 1.25, 0.38);
        this.rig.triggerShake(0.09, 0.15);
        break;
      case 'heart_lost':
        this.particles.expandingWave(this.eventPos, 0xff7aa8, 2.1, 0.45);
        this.particles.burstStars(this.eventPos, 0xff94b8, 16, 4.0, 0.95, false);
        this.rig.triggerShake(0.24, 0.24);
        break;
      case 'heart_gained':
        this.particles.multiRingStarburst(this.eventPos, 0xff75c3, 0xffe478, 16, 4.8, 1.05);
        this.particles.expandingWave(this.eventPos, 0xff80cc, 2.4, 0.52);
        this.rig.triggerZoomPulse(-0.025);
        break;
      case 'level_up':
        this.eventPos.y += aerialLift;
        this.particles.fireworks(this.eventPos);
        this.particles.multiRingStarburst(this.eventPos, 0xffe478, 0xff70d0, 20, 5.6, 1.2);
        this.rig.triggerShake(0.22, 0.28);
        this.rig.triggerZoomPulse(-0.045);
        break;
      case 'gameover':
        if (state.won) {
          this.particles.fireworks(this.eventPos);
        } else {
          this.particles.burstStars(this.eventPos, 0xc99eff, 22, 3.6, 1.05, true);
        }
        break;
      case 'flower_bloom': {
        this.particles.flowerBloomBurst(this.eventPos, 0xff7ac6);
        let burstCount = 0;
        for (const flower of state.gardenFlowers) {
          if (flower.ticksRemaining === flower.maxTicks && burstCount < 3) {
            cellToWorld(flower.x, flower.z, this.half, this.flowerBurstPos);
            this.particles.burstStars(this.flowerBurstPos, 0xffd447, 10, 3.4, 0.85, true);
            burstCount++;
          }
        }
        this.rig.triggerShake(0.09, 0.16);
        this.rig.triggerZoomPulse(-0.018);
        break;
      }
      case 'flower_charm':
        this.particles.burstStars(this.eventPos, 0xffd447, 18, 4.2, 0.95, true);
        this.particles.expandingWave(this.eventPos, 0xff7ac6, 1.65, 0.38);
        break;
      case 'cocoon_start':
        this.eventPos.y += aerialLift;
        this.particles.multiRingStarburst(this.eventPos, 0xff9de6, 0xffd447, 16, 4.0, 1.0);
        this.particles.expandingWave(this.eventPos, 0xffd447, 2.2, 0.48);
        this.rig.triggerShake(0.1, 0.2);
        this.rig.triggerZoomPulse(-0.02);
        break;
      case 'butterfly_emerge':
        this.eventPos.y += aerialLift;
        this.particles.fireworks(this.eventPos);
        this.particles.multiRingStarburst(this.eventPos, 0xff6be6, 0x5cf6ff, 24, 6.0, 1.25);
        this.particles.expandingWave(this.eventPos, 0xff6be6, 3.8, 0.62);
        this.particles.expandingWave(this.eventPos, 0x5cf6ff, 2.7, 0.5);
        this.particles.fallingIceShower(this.eventPos, 3.6);
        this.rig.triggerShake(0.24, 0.32);
        this.rig.triggerZoomPulse(0.06);
        break;
      case 'butterfly_frost':
        this.particles.expandingWave(this.eventPos, 0x7ef8ff, 4.4, 0.56, 0.4);
        this.particles.expandingWave(this.eventPos, 0xe8feff, 2.9, 0.42, 0.25);
        this.eventPos.y += Math.max(1.8, aerialLift);
        this.particles.fallingIceShower(this.eventPos, 4.0);
        break;
      case 'sky_thunder': {
        let struckAny = false;
        for (const bolt of state.lightningBolts) {
          if (bolt.ttl === bolt.maxTtl) {
            cellToWorld(bolt.x, bolt.z, this.half, this.boltBurstPos);
            this.particles.thunderStrikeBurst(this.boltBurstPos, bolt.colorHex);
            struckAny = true;
          }
        }
        if (!struckAny) {
          this.particles.thunderStrikeBurst(this.eventPos, 0x5cf6ff);
        }
        this.particles.multiRingStarburst(this.eventPos, 0x5cf6ff, 0xffe066, 18, 5.8, 1.15);
        this.rig.triggerShake(0.4, 0.35);
        this.rig.triggerZoomPulse(0.055);
        break;
      }
      case 'butterfly_land':
        this.particles.butterflyLandBurst(this.eventPos);
        this.rig.triggerShake(0.32, 0.3);
        this.rig.triggerZoomPulse(-0.04);
        break;
      case 'aoe_fire':
        this.particles.aoeFireBurst(this.eventPos);
        this.rig.triggerShake(0.36, 0.36);
        this.rig.triggerZoomPulse(0.065);
        break;
      case 'aoe_water':
        this.particles.aoeWaterBurst(this.eventPos);
        this.rig.triggerShake(0.34, 0.36);
        this.rig.triggerZoomPulse(0.06);
        break;
      case 'aoe_arcane':
        this.particles.aoeArcaneBurst(this.eventPos);
        this.rig.triggerShake(0.38, 0.38);
        this.rig.triggerZoomPulse(0.07);
        break;
      case 'monster_warning':
        this.particles.multiRingStarburst(this.eventPos, 0x8a2be2, 0xff2a4b, 22, 6.2, 1.35);
        this.particles.expandingWave(this.eventPos, 0x8a2be2, 5.8, 0.8, 0.4);
        this.rig.triggerShake(0.32, 0.45);
        this.rig.triggerZoomPulse(0.045);
        break;
      case 'monster_strike':
        this.particles.thunderStrikeBurst(this.eventPos, 0x7b68ee);
        this.particles.expandingWave(this.eventPos, 0x9370db, 8.5, 0.95, 0.6);
        this.particles.expandingWave(this.eventPos, 0x00f0ff, 6.2, 0.75, 0.35);
        this.rig.triggerShake(0.55, 0.65);
        this.rig.triggerZoomPulse(0.08);
        break;
      case 'shelter_enter':
        this.particles.multiRingStarburst(this.eventPos, 0xffd700, 0x7ef8ff, 20, 5.0, 1.2);
        this.particles.expandingWave(this.eventPos, 0xffd700, 3.6, 0.58);
        this.particles.burstStars(this.eventPos, 0xffea78, 16, 4.2, 1.0, true);
        this.rig.triggerZoomPulse(-0.025);
        break;
      case 'shelter_exit':
        this.particles.expandingWave(this.eventPos, 0x7ef8ff, 2.2, 0.42);
        break;
      case 'shelter_discovered':
        this.particles.fireworks(this.eventPos);
        this.particles.multiRingStarburst(this.eventPos, 0xff70d0, 0x00e5ff, 26, 6.5, 1.35);
        this.particles.multiRingStarburst(this.eventPos, 0xffd700, 0xb388ff, 22, 5.2, 1.2);
        this.particles.burstStars(this.eventPos, 0xffeb3b, 28, 5.8, 1.3, true);
        this.particles.expandingWave(this.eventPos, 0x00e5ff, 5.2, 0.72, 0.4);
        this.particles.expandingWave(this.eventPos, 0xff85c0, 3.8, 0.58, 0.2);
        this.rig.triggerShake(0.2, 0.26);
        this.rig.triggerZoomPulse(-0.04);
        break;
    }
  }

  /** Switch between the 4 world visual themes. */
  setTheme(theme: VisualTheme): void {
    this.currentTheme = theme;
    this.rig.setTheme(theme);
    this.board.setTheme(theme);
    this.foodView.setTheme(theme);
  }

  /** Smoothly tilt the 3D camera view from normalized Right Stick input (-1..1). */
  setCameraLook(nx: number, ny: number): void {
    this.rig.setCameraLook(nx, ny);
  }

  /** Render one interpolated 60fps frame with player-following camera, trails & level zoom. */
  draw(
    alpha: number,
    projectileAlpha: number,
    elapsed: number,
    delta: number,
    state: GameState,
  ): void {
    this.board.animate(elapsed);
    this.snakeView.draw(alpha, elapsed, delta, state);
    this.snakeView.getHeadWorldPosition(this.headCamPos);

    const camDt = Math.min(Math.max(delta, 0), 0.1);
    const targetAltitude =
      state.phase === 'ready' ? 0 : state.butterflyAltitude > 0.05 ? state.butterflyAltitude : 0;
    const camSmooth = state.phase === 'ready' ? 1 : 1 - Math.exp(-7 * camDt);
    this.aerialCamAltitude += (targetAltitude - this.aerialCamAltitude) * camSmooth;

    this.rig.update(
      elapsed,
      delta,
      this.headCamPos.x,
      this.headCamPos.z,
      state.level,
      this.aerialCamAltitude,
    );

    if (state.phase === 'playing') {
      const formHex = FORM_METADATA[state.form].hexColor;
      const segCount = this.snakeView.getSegmentCount();
      const speedActive = state.isDashing || state.boosters.speed.activeTicks > 0;
      const isButterfly = state.butterflyStage === 'butterfly';
      const trailHex = isButterfly
        ? this.bodyTrailIndex % 2 === 0
          ? 0xff7ae0
          : 0xffb8eb
        : formHex;
      const isRainbowTrail =
        !isButterfly && (state.boosters.speed.activeTicks > 0 || state.chompStreak >= 3);

      // Continuous glowing body / tail particle trail
      this.bodyTrailAcc += camDt;
      if (this.bodyTrailAcc >= 0.055 && segCount > 0) {
        this.bodyTrailAcc %= 0.055;
        this.bodyTrailIndex = (this.bodyTrailIndex + 3) % segCount;
        if (this.snakeView.getSegmentWorldPosition(this.bodyTrailIndex, this.bodyTrailPos)) {
          this.particles.bodyTrailSpark(this.bodyTrailPos, trailHex, 0.72, isRainbowTrail);
        }
        if (
          segCount > 3 &&
          this.snakeView.getSegmentWorldPosition(segCount - 1, this.bodyTrailPos)
        ) {
          this.particles.bodyTrailSpark(this.bodyTrailPos, trailHex, 0.64, isRainbowTrail);
        }
      }

      // Continuous dash / speed booster sparks
      if (speedActive) {
        this.dashSparkAcc += camDt;
        if (this.dashSparkAcc >= 0.024) {
          this.dashSparkAcc %= 0.024;
          this.snakeView.getHeadWorldPosition(this.headSparkPos);
          this.headSparkPos.y += state.butterflyAltitude * 2.65;
          const sparkColor = isButterfly
            ? 0xff7ae0
            : state.boosters.speed.activeTicks > 0
              ? 0xffd447
              : formHex;
          const dirX = Math.cos(state.heading);
          const dirZ = Math.sin(state.heading);
          this.particles.dashSpark(this.headSparkPos, dirX, dirZ, sparkColor);
          if (
            segCount > 2 &&
            this.snakeView.getSegmentWorldPosition(segCount - 1, this.bodyTrailPos)
          ) {
            this.particles.dashSpark(this.bodyTrailPos, dirX, dirZ, sparkColor);
          }
        }
      } else {
        this.dashSparkAcc = 0;
      }

      // Continuous shimmering pink butterfly wing-dust & falling ice shower (and cocoon sparkles)
      if (isButterfly) {
        this.wingDustAcc += camDt;
        if (this.wingDustAcc >= 0.028) {
          this.wingDustAcc %= 0.028;
          this.snakeView.getHeadWorldPosition(this.headSparkPos);
          this.headSparkPos.y += state.butterflyAltitude * 2.65;
          this.particles.butterflyWingDust(this.headSparkPos, state.heading, 1.15);
        }
        if (!state.butterflyLanding) {
          this.fallingIceAcc += camDt;
          if (this.fallingIceAcc >= 0.045) {
            this.fallingIceAcc %= 0.045;
            this.snakeView.getHeadWorldPosition(this.headSparkPos);
            this.headSparkPos.y += state.butterflyAltitude * 2.65;
            this.particles.fallingIceShower(this.headSparkPos, 3.2);
          }
        } else {
          this.fallingIceAcc = 0;
        }
        this.cocoonSparkAcc = 0;
      } else if (state.butterflyStage === 'cocoon') {
        this.cocoonSparkAcc += camDt;
        if (this.cocoonSparkAcc >= 0.055) {
          this.cocoonSparkAcc %= 0.055;
          this.snakeView.getHeadWorldPosition(this.headSparkPos);
          this.headSparkPos.y += state.butterflyAltitude * 2.65;
          this.particles.cocoonSparkle(this.headSparkPos);
        }
        this.wingDustAcc = 0;
        this.fallingIceAcc = 0;
      } else {
        this.wingDustAcc = 0;
        this.fallingIceAcc = 0;
        this.cocoonSparkAcc = 0;
      }

      // Continuous 60fps elemental breath particle stream from the snake's mouth
      if (state.sprayActiveTicks > 0) {
        this.sprayStreamAcc += camDt;
        if (this.sprayStreamAcc >= 0.028) {
          this.sprayStreamAcc %= 0.028;
          this.snakeView.getHeadWorldPosition(this.headSparkPos);
          const fx = Math.cos(state.heading);
          const fz = Math.sin(state.heading);
          this.computeMuzzlePos(
            this.headSparkPos,
            fx,
            fz,
            state.butterflyAltitude,
            this.sprayMuzzlePos,
          );
          this.particles.sprayStreamJet(this.sprayMuzzlePos, fx, fz, state.form);
        }
      } else {
        this.sprayStreamAcc = 0;
      }
    } else {
      this.dashSparkAcc = 0;
      this.bodyTrailAcc = 0;
      this.wingDustAcc = 0;
      this.fallingIceAcc = 0;
      this.cocoonSparkAcc = 0;
      this.sprayStreamAcc = 0;
    }

    this.botsView.draw(alpha, elapsed, delta, state);
    this.foodView.animate(elapsed, delta, state);
    this.projectilesView.draw(projectileAlpha, elapsed, delta);
    this.obstaclesView.draw(alpha, elapsed, delta);
    this.labels3dView.animate(elapsed, delta, state);
    this.fairyMagic.draw(elapsed, state);
    this.shelterView.draw(elapsed, delta, state);
    this.roamingMonstersView.draw(elapsed, delta, state);
    this.particles.update(delta);
    this.rig.render();
  }

  /** Project a world coordinate to viewport pixels; returns null when behind the camera. */
  projectCell(cell: Cell): { x: number; y: number } | null {
    cellToWorld(cell.x, cell.z, this.half, this.projected);
    this.projected.project(this.rig.camera);
    if (this.projected.z > 1) return null;
    const { width, height } = this.rig.getViewportSize();
    return {
      x: (this.projected.x * 0.5 + 0.5) * width,
      y: (-this.projected.y * 0.5 + 0.5) * height,
    };
  }

  resize(): void {
    this.rig.resize();
  }

  dispose(): void {
    this.snakeView.dispose();
    this.botsView.dispose();
    this.foodView.dispose();
    this.projectilesView.dispose();
    this.obstaclesView.dispose();
    this.labels3dView.dispose();
    this.particles.dispose();
    this.fairyMagic.dispose();
    this.shelterView.dispose();
    this.roamingMonstersView.dispose();
    this.badgeCache.dispose();
    this.crownResources.dispose();
    this.board.dispose();
    this.rig.dispose();
  }

  private computeMuzzlePos(
    basePos: Vector3,
    dirX: number,
    dirZ: number,
    butterflyAltitude: number,
    target: Vector3,
  ): Vector3 {
    return target.set(
      basePos.x + dirX * 0.72,
      basePos.y + 0.14 + butterflyAltitude * 2.65,
      basePos.z + dirZ * 0.72,
    );
  }
}
