import type { BoosterKind, Direction, FairySkillKind, SnakeForm } from '../core/types';

/** Semantic control events, decoupled from the device that produced them. */
export interface ControlHandlers {
  /** Smooth 360° open-world steering angle in radians (`Math.atan2(dz, dx)`), or `null` to coast straight. */
  steer(angle: number | null): void;
  /** A cardinal directional turn (arrow / WASD / d-pad / swipe). */
  turn(direction: Direction): void;
  /** Primary action — start, resume, or restart. */
  primary(): void;
  /** Toggle pause (P / Esc / Options). */
  togglePause(): void;
  /** Fire magic projectile for the active snake form. */
  shoot(): void;
  /** Cycle to the next magical snake form. */
  morphNext(): void;
  /** Cycle to the previous magical snake form. */
  morphPrev(): void;
  /** Morph directly to a specific snake form. */
  morphTo(form: SnakeForm): void;
  /** Activate or deactivate dash boost while held. */
  setDash(active: boolean): void;
  /** Activate bubble shield. */
  shield(): void;
  /** Activate a magical booster (`level`, `speed`, `magnet`). */
  activateBooster(booster: BoosterKind): void;
  /** Cast a Fairy Magic skill (`flower`, `butterfly`, `thunder`). */
  castFairySkill(skill: FairySkillKind): void;
  /** Activate or release press-and-hold Pink Frost Butterfly transformation. */
  setButterflyHold(active: boolean): void;
  /** Transform into the flying Fairy Princess (or return to snake form). */
  togglePrincess(): void;
  /** Smooth 3D camera look offset (-1..1 on X/Y from Right Stick). */
  cameraLook(nx: number, ny: number): void;
}

/** Live snapshot of connected gamepad / DualSense & WebHID LED status for HUD display. */
export interface ControllerStatus {
  readonly connected: boolean;
  readonly isDualSense: boolean;
  readonly controllerName: string;
  readonly webHidConnected: boolean;
  readonly webHidSupported: boolean;
  readonly pressedLabels: readonly string[];
  readonly leftStick: { readonly x: number; readonly y: number };
  readonly rightStick: { readonly x: number; readonly y: number };
}
