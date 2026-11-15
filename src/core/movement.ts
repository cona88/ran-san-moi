import type { Direction, GameState, Vec2 } from './types';
import { isOpposite } from './direction';
import { clamp } from './systems/arena';

/** Canonical spacing between adjacent spine segments in world units. */
export const SEGMENT_SPACING = 0.52;

/**
 * Buffer a requested turn against the current input queue.
 *
 * Validates against the last queued direction (or live direction when empty),
 * rejects 180° reversals and no-op repeats, and caps the buffer at two.
 */
export function enqueueTurn(state: GameState, direction: Direction): readonly Direction[] {
  const ref =
    state.queue.length > 0
      ? (state.queue[state.queue.length - 1] ?? state.direction)
      : state.direction;
  if (isOpposite(direction, ref)) return state.queue;
  if (direction === ref) return state.queue;
  if (state.queue.length >= 2) return state.queue;
  return [...state.queue, direction];
}

/** Target visual/collision segment count for the player snake at `level` (`10` at `Lv.5`, scaling up to `44`). */
export function targetPlayerLength(level: number, minLength = 10): number {
  const levelsAboveBase = Math.max(0, level - 5);
  return clamp(minLength + Math.floor(Math.sqrt(levelsAboveBase) * 4), minLength, 44);
}

/** Build a straight spine extending behind `head` opposite `heading`. */
export function buildStraightSpine(head: Vec2, heading: number, length: number): Vec2[] {
  const bx = -Math.cos(heading);
  const bz = -Math.sin(heading);
  const spine: Vec2[] = [];
  for (let i = 0; i < length; i++) {
    spine.push({
      x: head.x + bx * i * SEGMENT_SPACING,
      z: head.z + bz * i * SEGMENT_SPACING,
    });
  }
  return spine;
}

/**
 * Advance a spine via follow-the-leader constraints at {@link SEGMENT_SPACING}.
 * Supports seamless dynamic growth or shrinkage without segment bunching.
 */
export function advanceSpineFollowLeader(
  oldSpine: readonly Vec2[],
  newHead: Vec2,
  heading: number,
  targetLength: number,
): Vec2[] {
  const count = Math.max(1, targetLength);
  const next: Vec2[] = [{ x: newHead.x, z: newHead.z }];

  for (let i = 1; i < count; i++) {
    const anchor = next[i - 1]!;
    const prevSeg = i < oldSpine.length ? oldSpine[i] : undefined;

    if (prevSeg !== undefined) {
      const vx = prevSeg.x - anchor.x;
      const vz = prevSeg.z - anchor.z;
      const dist = Math.hypot(vx, vz);
      if (dist > 1e-5) {
        next.push({
          x: anchor.x + (vx / dist) * SEGMENT_SPACING,
          z: anchor.z + (vz / dist) * SEGMENT_SPACING,
        });
        continue;
      }
    }

    let dirX = -Math.cos(heading);
    let dirZ = -Math.sin(heading);
    if (i >= 2) {
      const ahead = next[i - 2]!;
      const ax = anchor.x - ahead.x;
      const az = anchor.z - ahead.z;
      const aDist = Math.hypot(ax, az);
      if (aDist > 1e-5) {
        dirX = ax / aDist;
        dirZ = az / aDist;
      }
    }
    next.push({
      x: anchor.x + dirX * SEGMENT_SPACING,
      z: anchor.z + dirZ * SEGMENT_SPACING,
    });
  }

  return next;
}

/** Match `prevSpine` length to `targetLength` so render interpolation never indexes out of bounds. */
export function matchSpineLength(spine: readonly Vec2[], targetLength: number): Vec2[] {
  const result = spine.slice(0, targetLength).map((p) => ({ x: p.x, z: p.z }));
  const tail = result[result.length - 1] ?? { x: 0, z: 0 };
  while (result.length < targetLength) {
    result.push({ x: tail.x, z: tail.z });
  }
  return result;
}
