import { Vector3 } from 'three';
import { FORM_METADATA } from '../core/config';
import { activeSize } from '../core/systems/arena';
import type { Cell, GameConfig, GameEvent, GameState, VisualTheme } from '../core/types';
import { Board } from './board';
import { BotsView } from './bots';
import { FoodView } from './food';
import { BadgeTextureCache, CrownResources, Labels3DView } from './labels3d';
import { ObstaclesView } from './obstacles';
import { THEMES } from './palette';
import { ParticleSystem } from './particles';
import { ProjectilesView } from './projectiles';
import { SceneRig } from './scene';
import { SnakeView } from './snake';
import { cellToWorld, halfOf } from './world';

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
  private readonly headCamPos = new Vector3();
  private readonly recentSpiritBlooms: Vector3[] = [];
  private dashSparkAcc = 0;

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
  }

  /** Trigger magical 3D particle & wave effects in response to a `GameEvent`. */
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

    switch (event.kind) {
      case 'eat_food':
        this.particles.burstStars(this.eventPos, themePalette.foodColor, 12, 3.6, 0.85, false);
        this.particles.expandingWave(this.eventPos, themePalette.bonusColor, 1.15, 0.3);
        break;
      case 'eat_bonus':
        this.particles.burstStars(this.eventPos, themePalette.bonusColor, 24, 5.0, 1.15, true);
        this.particles.expandingWave(this.eventPos, 0xffe266, 2.1, 0.45);
        break;
      case 'shoot':
        this.particles.burstStars(this.eventPos, formHex, 7, 3.0, 0.75, false);
        break;
      case 'morph':
        this.particles.expandingWave(this.eventPos, formHex, 2.3, 0.48);
        this.particles.burstStars(this.eventPos, formHex, 16, 4.0, 1.0, false);
        break;
      case 'dash':
        this.particles.expandingWave(this.eventPos, formHex, 1.6, 0.34);
        break;
      case 'shield_activate':
        this.particles.expandingWave(this.eventPos, 0x72f6ff, 2.4, 0.55);
        this.particles.burstStars(this.eventPos, 0xaaf5ff, 18, 3.8, 0.95, true);
        break;
      case 'shield_block':
        this.particles.expandingWave(this.eventPos, 0xff9ee6, 2.4, 0.45);
        this.particles.burstStars(this.eventPos, 0x72f6ff, 16, 4.4, 0.95, false);
        break;
      case 'hazard_hit':
        if (event.form === 'spirit') {
          this.recentSpiritBlooms.push(this.eventPos.clone());
          this.particles.spiritBloomExplosion(this.eventPos);
        } else {
          this.particles.burstStars(this.eventPos, formHex, 10, 3.5, 0.85, false);
        }
        break;
      case 'hazard_destroyed':
        if (event.form === 'spirit') {
          this.recentSpiritBlooms.push(this.eventPos.clone());
          this.particles.spiritBloomExplosion(this.eventPos);
        } else {
          this.particles.burstStars(this.eventPos, formHex, 22, 4.8, 1.1, false);
          this.particles.expandingWave(this.eventPos, formHex, 1.8, 0.42);
        }
        break;
      case 'bot_hit':
        if (event.form === 'spirit') {
          this.recentSpiritBlooms.push(this.eventPos.clone());
          this.particles.spiritBloomExplosion(this.eventPos);
        } else {
          this.particles.burstStars(this.eventPos, formHex, 14, 4.0, 0.95, false);
          this.particles.expandingWave(this.eventPos, formHex, 1.55, 0.34);
        }
        break;
      case 'bot_eaten':
        this.particles.burstStars(this.eventPos, formHex, 34, 6.0, 1.35, true);
        this.particles.expandingWave(this.eventPos, formHex, 3.2, 0.55);
        this.particles.expandingWave(this.eventPos, 0xffe478, 2.2, 0.42);
        break;
      case 'eaten_by_bot':
        this.particles.expandingWave(this.eventPos, 0xff4d4f, 3.0, 0.52);
        this.particles.burstStars(this.eventPos, 0xff7a45, 22, 4.8, 1.15, false);
        break;
      case 'boss_spawn':
        this.particles.expandingWave(this.eventPos, 0xff2a4b, 6.5, 0.85, 0.5);
        this.particles.expandingWave(this.eventPos, 0xffd447, 4.6, 0.68, 0.35);
        this.particles.burstStars(this.eventPos, 0xffd447, 36, 6.5, 1.4, false);
        break;
      case 'boss_defeated':
        this.particles.fireworks(this.eventPos);
        this.particles.expandingWave(this.eventPos, 0xffd447, 5.2, 0.75, 0.4);
        break;
      case 'booster_activate':
        this.particles.expandingWave(this.eventPos, 0x38f6ff, 3.0, 0.52);
        this.particles.expandingWave(this.eventPos, 0xffd447, 2.2, 0.4);
        this.particles.burstStars(this.eventPos, 0xffe478, 28, 5.4, 1.25, true);
        break;
      case 'quest_spawn':
        if (state.quest) {
          for (const orb of state.quest.orbs) {
            cellToWorld(orb.cell.x, orb.cell.z, this.half, this.eventPos);
            this.particles.expandingWave(this.eventPos, 0xc79dff, 1.35, 0.45);
          }
        }
        break;
      case 'quest_progress':
        this.particles.burstStars(this.eventPos, 0xffd447, 16, 4.2, 1.0, false);
        this.particles.expandingWave(this.eventPos, 0xffe478, 1.65, 0.42);
        break;
      case 'quest_complete':
        this.particles.fireworks(this.eventPos);
        break;
      case 'quest_wrong':
        this.particles.expandingWave(this.eventPos, 0xffa8d8, 1.25, 0.38);
        break;
      case 'heart_lost':
        this.particles.expandingWave(this.eventPos, 0xff7aa8, 1.9, 0.45);
        this.particles.burstStars(this.eventPos, 0xff94b8, 12, 3.6, 0.9, false);
        break;
      case 'heart_gained':
        this.particles.burstStars(this.eventPos, 0xff75c3, 24, 4.6, 1.15, true);
        this.particles.expandingWave(this.eventPos, 0xff80cc, 2.2, 0.52);
        break;
      case 'level_up':
        this.particles.fireworks(this.eventPos);
        break;
      case 'gameover':
        if (state.won) {
          this.particles.fireworks(this.eventPos);
        } else {
          this.particles.burstStars(this.eventPos, 0xc99eff, 20, 3.4, 1.0, true);
        }
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

  /** Render one interpolated 60fps frame with player-following camera & level zoom. */
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

    this.rig.update(elapsed, delta, this.headCamPos.x, this.headCamPos.z, state.level);

    const speedActive = state.isDashing || state.boosters.speed.activeTicks > 0;
    if (speedActive && state.phase === 'playing') {
      this.dashSparkAcc += Math.max(0, delta);
      if (this.dashSparkAcc >= 0.032) {
        this.dashSparkAcc = 0;
        this.snakeView.getHeadWorldPosition(this.headSparkPos);
        const sparkColor =
          state.boosters.speed.activeTicks > 0 ? 0xffd447 : FORM_METADATA[state.form].hexColor;
        this.particles.dashSpark(
          this.headSparkPos,
          Math.cos(state.heading),
          Math.sin(state.heading),
          sparkColor,
        );
      }
    } else {
      this.dashSparkAcc = 0;
    }

    this.botsView.draw(alpha, elapsed, delta, state);
    this.foodView.animate(elapsed, delta, state);
    this.projectilesView.draw(projectileAlpha, elapsed, delta);
    this.obstaclesView.draw(alpha, elapsed, delta);
    this.labels3dView.animate(elapsed, delta, state);
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
    this.badgeCache.dispose();
    this.crownResources.dispose();
    this.board.dispose();
    this.rig.dispose();
  }
}
