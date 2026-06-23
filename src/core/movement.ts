import type { Direction, GameState } from './types';
import { isOpposite } from './direction';

/**
 * Buffer a requested turn against the current input queue.
 *
 * Mirrors the original feel: validate against the *last queued* direction (or
 * the live direction when the queue is empty), reject 180° reversals and
 * no-op repeats, and cap the buffer at two so a fast double-tap registers but
 * input can never run away.
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
