import { BoxGeometry, Mesh, MeshStandardMaterial, Vector3, type Scene } from 'three';
import type { GameState } from '../core/types';
import { delta } from '../core/direction';
import { COLORS } from './palette';
import { cellToWorld } from './world';

interface Segment {
  readonly mesh: Mesh<BoxGeometry, MeshStandardMaterial>;
  readonly from: Vector3;
  readonly to: Vector3;
}

/** Snap (don't interpolate) when a segment jumps further than this — resets,
 *  restarts and arena rebuilds teleport the snake rather than slide it. */
const TELEPORT_THRESHOLD_SQ = 1.5 * 1.5;

/**
 * Renders the snake and smoothly interpolates it between logic ticks.
 *
 * Each segment remembers where it is heading (`to`); on the next tick its old
 * target becomes the new `from`. Because segment *i* always inherits the cell
 * the segment ahead just vacated, this "follow your own previous target" rule
 * yields correct trailing motion with no special-casing for the head.
 */
export class SnakeView {
  private readonly geometry = new BoxGeometry(0.55, 0.55, 0.55);
  private readonly bodyMaterial = new MeshStandardMaterial({
    color: COLORS.cyan,
    emissive: COLORS.cyan,
    emissiveIntensity: 1.1,
    metalness: 0.3,
    roughness: 0.35,
  });
  private readonly headMaterial = new MeshStandardMaterial({
    color: COLORS.head,
    emissive: COLORS.cyan,
    emissiveIntensity: 1.6,
    metalness: 0.2,
    roughness: 0.25,
  });
  private segments: Segment[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly half: number,
  ) {}

  /** Reconcile mesh count and interpolation targets with a new game state. */
  onTick(state: GameState): void {
    const length = state.snake.length;
    const previousCount = this.segments.length;

    while (this.segments.length < length) {
      const mesh = new Mesh(this.geometry, this.bodyMaterial);
      this.scene.add(mesh);
      this.segments.push({ mesh, from: new Vector3(), to: new Vector3() });
    }
    while (this.segments.length > length) {
      const removed = this.segments.pop();
      if (removed) this.scene.remove(removed.mesh);
    }

    const gameover = state.phase === 'gameover';
    for (let i = 0; i < length; i++) {
      const cell = state.snake[i];
      const segment = this.segments[i];
      if (!cell || !segment) continue;

      const target = cellToWorld(cell.x, cell.z, this.half);
      if (i >= previousCount) {
        segment.from.copy(target); // brand-new segment spawns in place
      } else {
        segment.from.copy(segment.to);
        if (segment.from.distanceToSquared(target) > TELEPORT_THRESHOLD_SQ) {
          segment.from.copy(target);
        }
      }
      segment.to.copy(target);

      const isHead = i === 0;
      segment.mesh.material = isHead && !gameover ? this.headMaterial : this.bodyMaterial;
      segment.mesh.scale.setScalar(isHead ? 1.25 : 1);
    }

    if (gameover) {
      for (const segment of this.segments) {
        segment.mesh.material = this.headMaterial;
      }
    }
  }

  /** Interpolate every segment between its `from` and `to` by `alpha` (0..1). */
  draw(alpha: number, state: GameState): void {
    for (const segment of this.segments) {
      segment.mesh.position.lerpVectors(segment.from, segment.to, alpha);
      segment.mesh.position.y = 0;
    }
    const head = this.segments[0];
    if (head) {
      const d = delta(state.direction);
      head.mesh.rotation.y = Math.atan2(d.x, d.z);
    }
  }

  dispose(): void {
    for (const segment of this.segments) {
      this.scene.remove(segment.mesh);
    }
    this.segments = [];
    this.geometry.dispose();
    this.bodyMaterial.dispose();
    this.headMaterial.dispose();
  }
}
