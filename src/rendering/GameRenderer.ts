import { Vector3 } from 'three';
import type { Cell, GameConfig, GameState } from '../core/types';
import { activeSize } from '../core/systems/arena';
import { Board } from './board';
import { FoodView } from './food';
import { COLORS } from './palette';
import { SceneRig } from './scene';
import { SnakeView } from './snake';
import { cellToWorld, halfOf } from './world';

/**
 * Facade over the rendering layer. The app calls {@link sync} once per logic
 * tick (state changed) and {@link draw} every animation frame (interpolation).
 * Nothing here mutates game state — it only reflects it.
 */
export class GameRenderer {
  private readonly rig: SceneRig;
  private readonly board = new Board();
  private readonly snakeView: SnakeView;
  private readonly foodView: FoodView;
  private readonly half: number;
  private renderedMargin = -1;
  private renderedPending = false;
  private readonly projected = new Vector3(); // scratch for projectCell

  constructor(
    container: HTMLElement,
    private readonly config: GameConfig,
  ) {
    this.half = halfOf(config.maxGrid);
    // Fit the camera to the largest board the game ever shows (the start size),
    // with a small margin, so framing stays constant as the arena shrinks.
    const maxHalfExtent = (activeSize(config, config.startMargin) / 2) * 1.08;
    this.rig = new SceneRig(container, maxHalfExtent);
    this.rig.scene.add(this.board.group);
    this.snakeView = new SnakeView(this.rig.scene, this.half);
    this.foodView = new FoodView(this.rig.scene, this.half);
  }

  /** Reflect a new game state into the scene (rebuilds the arena if it shrank). */
  sync(state: GameState): void {
    if (state.arenaMargin !== this.renderedMargin) {
      this.board.rebuild(activeSize(this.config, state.arenaMargin));
      this.renderedMargin = state.arenaMargin;
      this.renderedPending = false; // rebuild disposes any preview frame
    }
    const pending = state.pendingShrink && state.phase !== 'gameover';
    if (pending !== this.renderedPending) {
      if (pending) {
        this.board.showShrinkPreview(activeSize(this.config, state.arenaMargin + 1));
      } else {
        this.board.hideShrinkPreview();
      }
      this.renderedPending = pending;
    }
    this.snakeView.onTick(state);
    this.foodView.setCell(state.food);
    if (state.phase === 'gameover') {
      this.board.setFrameColor(COLORS.magenta);
    }
  }

  /** Draw one frame; `alpha` is progress (0..1) through the current tick. */
  draw(alpha: number, elapsed: number, delta: number, state: GameState): void {
    this.snakeView.draw(alpha, state);
    this.foodView.animate(elapsed, delta);
    if (state.phase !== 'gameover') {
      this.board.animate(elapsed);
    }
    this.rig.render();
  }

  /** Project a grid cell to viewport pixels; null when behind the camera. */
  projectCell(cell: Cell): { x: number; y: number } | null {
    cellToWorld(cell.x, cell.z, this.half, this.projected);
    this.projected.project(this.rig.camera);
    if (this.projected.z > 1) return null;
    return {
      x: (this.projected.x * 0.5 + 0.5) * window.innerWidth,
      y: (-this.projected.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  resize(): void {
    this.rig.resize();
  }

  dispose(): void {
    this.snakeView.dispose();
    this.foodView.dispose();
    this.board.dispose();
    this.rig.dispose();
  }
}
