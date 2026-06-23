import type { Direction } from '../core/types';

/** Semantic control events, decoupled from the device that produced them. */
export interface ControlHandlers {
  /** A directional turn (arrow / WASD / d-pad). */
  turn(direction: Direction): void;
  /** Primary action — start or restart (Space / Enter / overlay tap). */
  primary(): void;
  /** Toggle pause (P / Esc). */
  togglePause(): void;
}
