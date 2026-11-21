import { FORM_METADATA, angleDiff } from '../core';
import type {
  Direction,
  FairySkillKind,
  GameEvent,
  GameEventKind,
  GamePhase,
  GameState,
  SnakeForm,
} from '../core/types';
import type { ControlHandlers, ControllerStatus } from './controls';

const LEFT_STICK_DEADZONE = 0.22;
const LEFT_STICK_ANGLE_EPSILON = 0.03;
const RIGHT_STICK_DEADZONE = 0.15;
const TRIGGER_THRESHOLD = 0.35;
const AUTO_FIRE_INTERVAL_MS = 155;
const FLOWER_AUTO_PLANT_INTERVAL_MS = 320;

const SONY_VENDOR_ID = 0x054c;
const DUALSENSE_PRODUCT_ID = 0x0ce6;
const DUALSENSE_EDGE_PRODUCT_ID = 0x0df2;
const DUALSENSE_ID_MARKERS = ['054c', '0ce6', '0df2', 'dualsense', 'wireless controller'] as const;

// Standard Gamepad button indices on macOS Chrome / Safari for DualSense.
const BTN_CROSS = 0;
const BTN_CIRCLE = 1;
const BTN_SQUARE = 2;
const BTN_TRIANGLE = 3;
const BTN_L1 = 4;
const BTN_R1 = 5;
const BTN_L2 = 6;
const BTN_R2 = 7;
const BTN_CREATE = 8;
const BTN_OPTIONS = 9;
const BTN_L3 = 10;
const BTN_R3 = 11;
const BTN_DPAD_UP = 12;
const BTN_DPAD_DOWN = 13;
const BTN_DPAD_LEFT = 14;
const BTN_DPAD_RIGHT = 15;
const BTN_TOUCHPAD = 17;

interface DualRumbleParams {
  readonly startDelay: number;
  readonly duration: number;
  readonly weakMagnitude: number;
  readonly strongMagnitude: number;
}

interface HIDCollectionInfoLike {
  readonly outputReports?: ReadonlyArray<{ readonly reportId?: number }>;
}

interface HIDDeviceLike {
  readonly opened: boolean;
  readonly vendorId?: number;
  readonly productId?: number;
  readonly productName?: string;
  readonly collections?: readonly HIDCollectionInfoLike[];
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
}

interface HIDConnectionEventLike {
  readonly device?: HIDDeviceLike;
}

interface HIDLike {
  requestDevice(options: {
    filters: ReadonlyArray<{ vendorId: number; productId?: number }>;
  }): Promise<HIDDeviceLike[]>;
  addEventListener?(type: string, listener: (event: HIDConnectionEventLike) => void): void;
  removeEventListener?(type: string, listener: (event: HIDConnectionEventLike) => void): void;
}

interface NavigatorWithHid {
  readonly hid?: HIDLike;
}

type RumbleSpec = Omit<DualRumbleParams, 'startDelay'>;

const SHOOT_RUMBLE_PRESETS: Readonly<Record<SnakeForm, RumbleSpec>> = {
  dragon: { duration: 65, weakMagnitude: 0.42, strongMagnitude: 0.34 }, // Roaring flame kick
  phoenix: { duration: 48, weakMagnitude: 0.52, strongMagnitude: 0.08 }, // Crisp arctic crystal shimmer
  unicorn: { duration: 60, weakMagnitude: 0.46, strongMagnitude: 0.24 }, // Pressurized hydro-jet pulse
  spirit: { duration: 42, weakMagnitude: 0.38, strongMagnitude: 0.14 }, // Snappy elastic silk flick
};

const RUMBLE_PRESETS: Readonly<Partial<Record<GameEventKind, RumbleSpec>>> = {
  shoot: SHOOT_RUMBLE_PRESETS.dragon,
  morph: { duration: 90, weakMagnitude: 0.45, strongMagnitude: 0.2 },
  eat_food: { duration: 70, weakMagnitude: 0.3, strongMagnitude: 0.15 },
  eat_bonus: { duration: 70, weakMagnitude: 0.3, strongMagnitude: 0.15 },
  hazard_destroyed: { duration: 160, weakMagnitude: 0.65, strongMagnitude: 0.45 },
  quest_complete: { duration: 160, weakMagnitude: 0.65, strongMagnitude: 0.45 },
  shield_block: { duration: 210, weakMagnitude: 0.5, strongMagnitude: 0.75 },
  heart_lost: { duration: 210, weakMagnitude: 0.5, strongMagnitude: 0.75 },
  bot_hit: { duration: 60, weakMagnitude: 0.4, strongMagnitude: 0.2 },
  bot_eaten: { duration: 190, weakMagnitude: 0.75, strongMagnitude: 0.55 },
  boss_spawn: { duration: 240, weakMagnitude: 0.65, strongMagnitude: 0.8 },
  boss_defeated: { duration: 300, weakMagnitude: 0.9, strongMagnitude: 0.75 },
  eaten_by_bot: { duration: 230, weakMagnitude: 0.5, strongMagnitude: 0.85 },
  booster_activate: { duration: 110, weakMagnitude: 0.55, strongMagnitude: 0.3 },
  flower_bloom: { duration: 80, weakMagnitude: 0.35, strongMagnitude: 0.15 },
  flower_charm: { duration: 80, weakMagnitude: 0.35, strongMagnitude: 0.15 },
  cocoon_start: { duration: 150, weakMagnitude: 0.5, strongMagnitude: 0.35 },
  butterfly_emerge: { duration: 220, weakMagnitude: 0.7, strongMagnitude: 0.5 },
  butterfly_land: { duration: 120, weakMagnitude: 0.45, strongMagnitude: 0.3 },
  butterfly_frost: { duration: 28, weakMagnitude: 0.34, strongMagnitude: 0.06 },
  sky_thunder: { duration: 200, weakMagnitude: 0.8, strongMagnitude: 0.65 },
  aoe_fire: { duration: 220, weakMagnitude: 0.85, strongMagnitude: 0.7 },
  aoe_water: { duration: 210, weakMagnitude: 0.78, strongMagnitude: 0.65 },
  aoe_arcane: { duration: 230, weakMagnitude: 0.88, strongMagnitude: 0.72 },
};

const CHOMP_RUMBLE_DURATION_MS = 38;
const CHOMP_WEAK_MIN = 0.38;
const CHOMP_WEAK_MAX = 0.85;
const CHOMP_STRONG_MIN = 0.18;
const CHOMP_STRONG_MAX = 0.65;
const CHOMP_STREAK_RAMP_STEPS = 12;

const CHOMP_LIGHTBAR_THROTTLE_MS = 95;
const CHOMP_LIGHTBAR_PRIMARY_RGB: readonly [number, number, number] = [255, 224, 92];
const CHOMP_LIGHTBAR_ALT_RGB: readonly [number, number, number] = [255, 192, 56];

const LIGHTBAR_MIN_PACKET_GAP_MS = 28;
const LIGHTBAR_HOLD_PULSE_MS = 140;
const PRACTICE_RUMBLE_HOLD_GAP_MS = 125;
const STEER_DETENT_GAP_MS = 145;
const STEER_SHARP_TURN_RAD = 0.75;

type RgbColor = readonly [number, number, number];

interface LightbarFlashSpec {
  readonly rgb: RgbColor;
  readonly durationMs: number;
}

const BUTTERFLY_PINK_ICE_RGB: RgbColor = [255, 134, 224];
const BUTTERFLY_ICE_CYAN_RGB: RgbColor = [138, 246, 255];

const SPRAY_LIGHTBAR_COLORS: Readonly<Record<SnakeForm, RgbColor>> = {
  dragon: [255, 92, 32],
  phoenix: [115, 252, 255],
  unicorn: [64, 218, 255],
  spirit: [108, 255, 178],
};

const TOUCHPAD_PRISM_COLORS: readonly RgbColor[] = [
  [255, 108, 225],
  [88, 234, 255],
  [255, 224, 72],
  [108, 255, 176],
];

const BUTTON_PRACTICE_RUMBLE: Readonly<Partial<Record<number, RumbleSpec>>> = {
  [BTN_CROSS]: { duration: 36, weakMagnitude: 0.38, strongMagnitude: 0.16 },
  [BTN_CIRCLE]: { duration: 38, weakMagnitude: 0.42, strongMagnitude: 0.18 },
  [BTN_SQUARE]: { duration: 36, weakMagnitude: 0.4, strongMagnitude: 0.16 },
  [BTN_TRIANGLE]: { duration: 40, weakMagnitude: 0.44, strongMagnitude: 0.2 },
  [BTN_L1]: { duration: 38, weakMagnitude: 0.44, strongMagnitude: 0.16 },
  [BTN_R1]: { duration: 38, weakMagnitude: 0.46, strongMagnitude: 0.14 },
  [BTN_L2]: { duration: 44, weakMagnitude: 0.36, strongMagnitude: 0.26 },
  [BTN_R2]: { duration: 40, weakMagnitude: 0.46, strongMagnitude: 0.2 },
  [BTN_L3]: { duration: 48, weakMagnitude: 0.48, strongMagnitude: 0.28 },
  [BTN_R3]: { duration: 48, weakMagnitude: 0.46, strongMagnitude: 0.26 },
  [BTN_CREATE]: { duration: 34, weakMagnitude: 0.34, strongMagnitude: 0.14 },
  [BTN_OPTIONS]: { duration: 32, weakMagnitude: 0.32, strongMagnitude: 0.12 },
  [BTN_TOUCHPAD]: { duration: 46, weakMagnitude: 0.54, strongMagnitude: 0.22 },
};

const BUTTON_LIGHTBAR_COLORS: Readonly<Partial<Record<number, RgbColor>>> = {
  [BTN_CROSS]: [48, 162, 255],
  [BTN_CIRCLE]: [255, 76, 136],
  [BTN_SQUARE]: [255, 112, 224],
  [BTN_TRIANGLE]: [58, 255, 172],
  [BTN_L1]: [255, 232, 64],
  [BTN_R1]: BUTTERFLY_PINK_ICE_RGB,
  [BTN_L2]: [110, 186, 255],
  [BTN_L3]: [255, 214, 42],
  [BTN_R3]: [188, 118, 255],
  [BTN_CREATE]: [72, 245, 255],
  [BTN_OPTIONS]: [220, 236, 255],
};

const LIGHTBAR_EVENT_FLASHES: Readonly<Partial<Record<GameEventKind, LightbarFlashSpec>>> = {
  aoe_fire: { rgb: [255, 95, 30], durationMs: 460 },
  aoe_water: { rgb: [30, 220, 255], durationMs: 460 },
  aoe_arcane: { rgb: [210, 95, 255], durationMs: 460 },
  sky_thunder: { rgb: [255, 242, 64], durationMs: 380 },
  flower_bloom: { rgb: [255, 134, 220], durationMs: 280 },
  flower_charm: { rgb: [255, 148, 232], durationMs: 280 },
  cocoon_start: { rgb: [255, 198, 104], durationMs: 380 },
  butterfly_emerge: { rgb: [255, 138, 255], durationMs: 520 },
  butterfly_land: { rgb: [135, 246, 255], durationMs: 300 },
  butterfly_frost: { rgb: BUTTERFLY_ICE_CYAN_RGB, durationMs: 210 },
  quest_complete: { rgb: [255, 228, 68], durationMs: 460 },
  level_up: { rgb: [115, 255, 188], durationMs: 420 },
  bot_eaten: { rgb: [255, 202, 62], durationMs: 400 },
  shield_activate: { rgb: [82, 226, 255], durationMs: 320 },
  heart_gained: { rgb: [255, 104, 168], durationMs: 360 },
  booster_activate: { rgb: [255, 220, 74], durationMs: 340 },
  dash: { rgb: [96, 212, 255], durationMs: 220 },
  eat_bonus: { rgb: [255, 216, 84], durationMs: 220 },
};

const LIGHTBAR_EVENT_COLORS: Readonly<Partial<Record<GameEventKind, RgbColor>>> = {
  aoe_fire: [255, 95, 30],
  aoe_water: [30, 220, 255],
  aoe_arcane: [210, 95, 255],
};

const LIGHTBAR_EVENT_KINDS = new Set<GameEventKind>(['morph']);

interface SteeringFeedback {
  readonly stickEngaged: boolean;
  readonly dpadEngaged: boolean;
  readonly sharpTurn: boolean;
  readonly isSteering: boolean;
  readonly steerAngle: number | null;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32DualSenseBt(reportId: number, payloadWithoutCrc: Uint8Array): number {
  let crc = 0xffffffff;
  // Sony DualSense Bluetooth output report CRC32 is seeded with [0xa2, reportId].
  for (const byte of [0xa2, reportId]) {
    crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  for (let i = 0; i < payloadWithoutCrc.length; i++) {
    const byte = payloadWithoutCrc[i] ?? 0;
    crc = (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampByte(value: number): number {
  return clamp(Math.round(value), 0, 255);
}

function getNavigatorHid(): HIDLike | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as NavigatorWithHid;
  return nav.hid && typeof nav.hid.requestDevice === 'function' ? nav.hid : null;
}

function readGamepads(): readonly (Gamepad | null)[] {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
    return [];
  }
  try {
    return navigator.getGamepads() ?? [];
  } catch {
    return [];
  }
}

function isDualSenseGamepad(gamepad: Gamepad): boolean {
  const id = (gamepad.id ?? '').toLowerCase();
  return DUALSENSE_ID_MARKERS.some((marker) => id.includes(marker));
}

function isDigitalPressed(buttons: readonly GamepadButton[], index: number): boolean {
  const btn = buttons[index];
  return Boolean(btn?.pressed);
}

function isTriggerPressed(buttons: readonly GamepadButton[], index: number): boolean {
  const btn = buttons[index];
  return Boolean(btn && (btn.value > TRIGGER_THRESHOLD || btn.pressed));
}

function normalizeStick(
  rawX: number,
  rawY: number,
  deadzone: number,
): { readonly x: number; readonly y: number } {
  const mag = Math.hypot(rawX, rawY);
  if (mag < deadzone || mag === 0) {
    return { x: 0, y: 0 };
  }
  const scaled = Math.min(1, (mag - deadzone) / (1 - deadzone));
  return {
    x: clamp((rawX / mag) * scaled, -1, 1),
    y: clamp((rawY / mag) * scaled, -1, 1),
  };
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function buildChompRumbleSpec(streakInput: number): RumbleSpec {
  const streak = Number.isFinite(streakInput) ? Math.max(1, streakInput) : 1;
  const progress = clamp((streak - 1) / (CHOMP_STREAK_RAMP_STEPS - 1), 0, 1);
  return {
    duration: CHOMP_RUMBLE_DURATION_MS,
    weakMagnitude: Number(
      clamp(
        CHOMP_WEAK_MIN + progress * (CHOMP_WEAK_MAX - CHOMP_WEAK_MIN),
        CHOMP_WEAK_MIN,
        CHOMP_WEAK_MAX,
      ).toFixed(3),
    ),
    strongMagnitude: Number(
      clamp(
        CHOMP_STRONG_MIN + progress * (CHOMP_STRONG_MAX - CHOMP_STRONG_MIN),
        CHOMP_STRONG_MIN,
        CHOMP_STRONG_MAX,
      ).toFixed(3),
    ),
  };
}

/**
 * DualSense & standard Gamepad API manager for macOS browsers (Chrome & Safari),
 * including smooth 360° analog steering, 8-way D-Pad, 3 booster triggers,
 * auto-fire, dual-rumble haptics, and optional browser-native WebHID RGB lightbar sync.
 */
export class DualSenseManager {
  private readonly handlers: ControlHandlers;
  private prevButtons: boolean[] = [];
  private prevShootPressed = false;
  private shootHoldMs = 0;
  private prevFlowerPressed = false;
  private flowerHoldMs = 0;
  private dashActive = false;
  private butterflyHoldActive = false;
  private lastStickAngle: number | null = null;
  private lastDpadAngle: number | null = null;
  private lastDetentAngle: number | null = null;
  private lastSteerDetentMs = -Infinity;
  private prevPhase: GamePhase | null = null;
  private lastCameraX = 0;
  private lastCameraY = 0;
  private vibrationEnabled = true;
  private lastGamepad: Gamepad | null = null;
  private eventRumbleUntilMs = -Infinity;
  private lastPracticeRumbleMs = -Infinity;
  private lastHoldRumbleMs = -Infinity;

  private hidDevice: HIDDeviceLike | null = null;
  private hidDisconnectListener: ((event: HIDConnectionEventLike) => void) | null = null;
  private btSeq = 0;
  private lastLightbarPacketMs = -Infinity;
  private lightbarFlashUntilMs = -Infinity;
  private lightbarFlashActive = false;
  private lightbarFlashPriority = 0;
  private holdLightbarPhase = 0;
  private lastHoldLightbarMs = -Infinity;
  private touchpadPrismIndex = 0;
  private lastKnownForm: SnakeForm | null = null;
  private chompLightbarPhase = 0;
  private chompLightbarActive = false;
  private disposed = false;

  constructor(handlers: ControlHandlers) {
    this.handlers = handlers;
  }

  /** Poll connected gamepads each animation frame and return live HUD status. */
  poll(dtMs: number, state: GameState): ControllerStatus {
    if (this.disposed) {
      return this.disconnectedStatus();
    }

    const now = nowMs();
    this.syncPeriodicLightbar(state, now);

    const gamepad = this.pickGamepad();
    this.lastGamepad = gamepad;

    if (!gamepad) {
      this.resetInputOnDisconnect();
      return this.disconnectedStatus();
    }

    const buttons = gamepad.buttons ?? [];
    const axes = gamepad.axes ?? [];
    const isDualSense = isDualSenseGamepad(gamepad);
    const controllerName =
      gamepad.id.trim() || (isDualSense ? 'DualSense Wireless Controller' : 'Gamepad');

    // Snapshot digital/trigger button states so all edge checks share a clean frame view.
    const currButtons: boolean[] = [];
    const buttonCount = Math.max(buttons.length, BTN_TOUCHPAD + 1);
    for (let i = 0; i < buttonCount; i++) {
      if (i === BTN_L2 || i === BTN_R2) {
        currButtons[i] = isTriggerPressed(buttons, i);
      } else {
        currButtons[i] = isDigitalPressed(buttons, i);
      }
    }

    const isPressed = (idx: number): boolean => Boolean(currButtons[idx]);
    const justPressed = (idx: number): boolean =>
      Boolean(currButtons[idx]) && !this.prevButtons[idx];

    const phaseResumedPlaying =
      this.prevPhase !== null && this.prevPhase !== 'playing' && state.phase === 'playing';
    this.prevPhase = state.phase;

    // 1 & 2. Smooth 360° Left Stick steering + 8-way D-Pad steering
    const rawLx = clamp(axes[0] ?? 0, -1, 1);
    const rawLy = clamp(axes[1] ?? 0, -1, 1);
    const leftStick = normalizeStick(rawLx, rawLy, LEFT_STICK_DEADZONE);
    const steerFeedback = this.handleSteering(
      rawLx,
      rawLy,
      isPressed,
      justPressed,
      phaseResumedPlaying,
      now,
    );

    // 3. Right Stick smooth 3D camera look (deadzone 0.15)
    const rawRx = clamp(axes[2] ?? 0, -1, 1);
    const rawRy = clamp(axes[3] ?? 0, -1, 1);
    const rightStick = normalizeStick(rawRx, rawRy, RIGHT_STICK_DEADZONE);
    if (rightStick.x !== this.lastCameraX || rightStick.y !== this.lastCameraY) {
      this.lastCameraX = rightStick.x;
      this.lastCameraY = rightStick.y;
      this.handlers.cameraLook(rightStick.x, rightStick.y);
    }

    // 4. Spray (R2 only) with 155ms auto-spray while held during 'playing'
    const shootPressed = isPressed(BTN_R2);
    if (shootPressed && !this.prevShootPressed) {
      this.shootHoldMs = 0;
      this.handlers.shoot();
    } else if (shootPressed && this.prevShootPressed) {
      if (state.phase === 'playing') {
        this.shootHoldMs += Math.max(0, dtMs);
        if (this.shootHoldMs >= AUTO_FIRE_INTERVAL_MS) {
          this.shootHoldMs -= AUTO_FIRE_INTERVAL_MS;
          if (this.shootHoldMs >= AUTO_FIRE_INTERVAL_MS) {
            this.shootHoldMs = 0;
          }
          this.handlers.shoot();
        }
      }
    } else {
      this.shootHoldMs = 0;
    }
    this.prevShootPressed = shootPressed;

    // 5. L2 + Face Button 360° Elemental AoE combos during 'playing'
    const l2HeldDuringPlay = state.phase === 'playing' && isPressed(BTN_L2);
    let suppressSquareNormal = false;
    let suppressCircleNormal = false;
    let suppressTriangleNormal = false;

    if (l2HeldDuringPlay) {
      if (justPressed(BTN_SQUARE)) {
        suppressSquareNormal = true;
        this.handlers.castFairySkill('fire');
      }
      if (justPressed(BTN_CIRCLE)) {
        suppressCircleNormal = true;
        this.handlers.castFairySkill('water');
      }
      if (justPressed(BTN_TRIANGLE)) {
        suppressTriangleNormal = true;
        this.handlers.castFairySkill('arcane');
      }
      if (justPressed(BTN_CROSS)) {
        this.handlers.castFairySkill('thunder');
      }
    }

    // 5b. Morph forms (Triangle -> next, suppressed when L2 + Triangle casts AoE)
    if (!suppressTriangleNormal && justPressed(BTN_TRIANGLE)) {
      this.handlers.morphNext();
    }

    // 6. Fairy Magic skills (Square w/o L2 -> flower w/ 320ms auto-plant, R1 -> hold butterfly, L1 -> thunder, Touchpad -> smart off-cooldown AoE)
    const rawSquarePressed = isPressed(BTN_SQUARE);
    if (!l2HeldDuringPlay) {
      if (rawSquarePressed && !this.prevFlowerPressed && !suppressSquareNormal) {
        this.flowerHoldMs = 0;
        this.handlers.castFairySkill('flower');
      } else if (rawSquarePressed && this.prevFlowerPressed) {
        if (state.phase === 'playing') {
          this.flowerHoldMs += Math.max(0, dtMs);
          if (this.flowerHoldMs >= FLOWER_AUTO_PLANT_INTERVAL_MS) {
            this.flowerHoldMs -= FLOWER_AUTO_PLANT_INTERVAL_MS;
            if (this.flowerHoldMs >= FLOWER_AUTO_PLANT_INTERVAL_MS) {
              this.flowerHoldMs = 0;
            }
            this.handlers.castFairySkill('flower');
          }
        }
      } else {
        this.flowerHoldMs = 0;
      }
    } else {
      this.flowerHoldMs = 0;
    }
    this.prevFlowerPressed = rawSquarePressed;

    if (state.phase !== 'playing') {
      if (this.butterflyHoldActive) {
        this.butterflyHoldActive = false;
        this.handlers.setButterflyHold(false);
      }
    } else {
      const r1Pressed = isPressed(BTN_R1);
      if (r1Pressed && !this.butterflyHoldActive) {
        this.butterflyHoldActive = true;
        this.handlers.setButterflyHold(true);
        this.triggerPracticeRumble(
          { duration: 68, weakMagnitude: 0.62, strongMagnitude: 0.24 },
          16,
          now,
        );
        if (this.isWebHidConnected()) {
          this.triggerLightbarFlash(BUTTERFLY_PINK_ICE_RGB, 280, 2, now);
        }
      } else if (!r1Pressed && this.butterflyHoldActive) {
        this.butterflyHoldActive = false;
        this.handlers.setButterflyHold(false);
      }
    }
    if (justPressed(BTN_L1)) {
      this.handlers.castFairySkill('thunder');
    }
    if (state.phase === 'playing' && justPressed(BTN_TOUCHPAD)) {
      const smartAoe: FairySkillKind | null =
        state.fireCooldownTicks === 0
          ? 'fire'
          : state.waterCooldownTicks === 0
            ? 'water'
            : state.arcaneCooldownTicks === 0
              ? 'arcane'
              : state.thunderCooldownTicks === 0
                ? 'thunder'
                : null;
      if (smartAoe) {
        this.handlers.castFairySkill(smartAoe);
      }
    }

    // 6b. Bubble Shield (Circle, suppressed when L2 + Circle casts AoE)
    if (!suppressCircleNormal && justPressed(BTN_CIRCLE)) {
      this.handlers.shield();
    }

    // 7. Three Magical Boosters (L3 -> +10 Level, Create/Share -> Speed, R3 -> Magnet)
    if (justPressed(BTN_L3)) {
      this.handlers.activateBooster('level');
    }
    if (justPressed(BTN_CREATE)) {
      this.handlers.activateBooster('speed');
    }
    if (justPressed(BTN_R3)) {
      this.handlers.activateBooster('magnet');
    }

    // 8. Pause toggle (Options)
    if (justPressed(BTN_OPTIONS)) {
      this.handlers.togglePause();
    }

    // 9. Primary confirm (non-playing Cross) or Dash hold (playing Cross / L2)
    if (state.phase !== 'playing') {
      if (this.dashActive) {
        this.dashActive = false;
        this.handlers.setDash(false);
      }
      if (justPressed(BTN_CROSS)) {
        this.handlers.primary();
      }
    } else {
      const nextDash = isPressed(BTN_CROSS) || isPressed(BTN_L2);
      if (nextDash !== this.dashActive) {
        this.dashActive = nextDash;
        this.handlers.setDash(nextDash);
      }
    }

    // 10. Tactile DualSense practice micro-rumble + vibrant lightbar color flashes
    this.applyPracticeFeedback(state, currButtons, justPressed, steerFeedback, now);

    this.prevButtons = currButtons;

    return {
      connected: true,
      isDualSense,
      controllerName,
      webHidConnected: this.isWebHidConnected(),
      webHidSupported: this.isWebHidSupported(),
      pressedLabels: this.collectPressedLabels(currButtons),
      leftStick,
      rightStick,
    };
  }

  /** Trigger gamepad rumble haptics and WebHID lightbar updates in response to game events. */
  onEvent(event: GameEvent, state: GameState): void {
    if (this.disposed) return;

    const now = nowMs();
    if (this.vibrationEnabled) {
      if (event.kind === 'bot_chomp') {
        const streak = Math.max(1, event.chompStreak ?? state.chompStreak);
        this.triggerEventRumble(buildChompRumbleSpec(streak), now);
      } else if (event.kind === 'shoot') {
        this.triggerEventRumble(SHOOT_RUMBLE_PRESETS[event.form ?? state.form], now);
      } else if (event.kind === 'dash') {
        this.triggerEventRumble({ duration: 48, weakMagnitude: 0.4, strongMagnitude: 0.22 }, now);
      } else {
        const preset = RUMBLE_PRESETS[event.kind];
        if (preset) {
          this.triggerEventRumble(preset, now);
        }
      }
    }

    if (this.isWebHidConnected()) {
      this.lastKnownForm = state.form;
      const eventRgb = LIGHTBAR_EVENT_COLORS[event.kind];
      const eventFlash = LIGHTBAR_EVENT_FLASHES[event.kind];
      if (eventFlash) {
        this.resetLightbarChompState();
        this.triggerLightbarFlash(eventFlash.rgb, eventFlash.durationMs, 3, now);
      } else if (eventRgb) {
        this.resetLightbarChompState();
        this.triggerLightbarFlash(eventRgb, 440, 3, now);
      } else if (event.kind === 'shoot') {
        const sprayRgb = SPRAY_LIGHTBAR_COLORS[event.form ?? state.form];
        this.triggerLightbarFlash(sprayRgb, 170, 2, now);
      } else if (LIGHTBAR_EVENT_KINDS.has(event.kind)) {
        this.restoreFormLightbar(state.form);
      } else if (event.kind === 'bot_chomp') {
        if (now - this.lastLightbarPacketMs >= CHOMP_LIGHTBAR_THROTTLE_MS) {
          const rgb =
            this.chompLightbarPhase === 0 ? CHOMP_LIGHTBAR_PRIMARY_RGB : CHOMP_LIGHTBAR_ALT_RGB;
          this.chompLightbarPhase = this.chompLightbarPhase === 0 ? 1 : 0;
          this.lastLightbarPacketMs = now;
          this.chompLightbarActive = true;
          void this.sendLightbarRgb(rgb);
        }
      }
    }
  }

  /** Connect to a Sony DualSense via browser-native WebHID to control the RGB lightbar. */
  async connectWebHid(initialForm: SnakeForm): Promise<boolean> {
    if (this.disposed) return false;
    const hid = getNavigatorHid();
    if (!hid) return false;

    try {
      const devices = await hid.requestDevice({
        filters: [
          { vendorId: SONY_VENDOR_ID, productId: DUALSENSE_PRODUCT_ID },
          { vendorId: SONY_VENDOR_ID, productId: DUALSENSE_EDGE_PRODUCT_ID },
        ],
      });
      const device = devices[0];
      if (!device) return false;

      if (this.hidDevice && this.hidDevice !== device && this.hidDevice.opened) {
        try {
          await this.hidDevice.close();
        } catch {
          // Ignore close errors when replacing an older HID handle.
        }
      }

      if (!device.opened) {
        await device.open();
      }
      if (!device.opened) return false;

      this.hidDevice = device;
      this.resetLightbarChompState();
      this.lastKnownForm = initialForm;
      this.attachHidDisconnectListener(hid);
      await this.sendLightbarRgb(FORM_METADATA[initialForm].lightbarRgb);
      return Boolean(this.hidDevice?.opened);
    } catch {
      return false;
    }
  }

  /** Enable or disable DualSense rumble feedback. */
  setVibrationEnabled(enabled: boolean): void {
    this.vibrationEnabled = enabled;
  }

  /** Clean up active dash/camera state, WebHID handles, and listeners. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resetInputOnDisconnect();
    this.lastGamepad = null;
    this.resetLightbarChompState();

    const hid = getNavigatorHid();
    if (hid && this.hidDisconnectListener && hid.removeEventListener) {
      hid.removeEventListener('disconnect', this.hidDisconnectListener);
    }
    this.hidDisconnectListener = null;

    const device = this.hidDevice;
    this.hidDevice = null;
    if (device?.opened) {
      try {
        void device.close().catch(() => {});
      } catch {
        // Ignore synchronous close failures during teardown.
      }
    }
  }

  private resetLightbarChompState(): void {
    this.lastLightbarPacketMs = -Infinity;
    this.lightbarFlashUntilMs = -Infinity;
    this.lightbarFlashActive = false;
    this.lightbarFlashPriority = 0;
    this.chompLightbarPhase = 0;
    this.chompLightbarActive = false;
  }

  private restoreFormLightbar(form: SnakeForm): void {
    this.chompLightbarActive = false;
    this.chompLightbarPhase = 0;
    this.lightbarFlashActive = false;
    this.lightbarFlashUntilMs = -Infinity;
    this.lightbarFlashPriority = 0;
    this.lastKnownForm = form;
    this.lastLightbarPacketMs = nowMs();
    void this.sendLightbarRgb(FORM_METADATA[form].lightbarRgb);
  }

  private syncPeriodicLightbar(state: GameState, now: number): void {
    if (!this.isWebHidConnected()) return;

    if (this.lastKnownForm === null) {
      this.lastKnownForm = state.form;
    } else if (state.form !== this.lastKnownForm) {
      this.lastKnownForm = state.form;
      if (!this.lightbarFlashActive && !this.chompLightbarActive) {
        this.restoreFormLightbar(state.form);
        return;
      }
    }

    if (
      this.chompLightbarActive &&
      (state.chompStreakTicks === 0 || state.phase !== 'playing') &&
      now - this.lastLightbarPacketMs >= CHOMP_LIGHTBAR_THROTTLE_MS
    ) {
      this.restoreFormLightbar(state.form);
      return;
    }

    if (this.lightbarFlashActive && now >= this.lightbarFlashUntilMs) {
      this.restoreFormLightbar(state.form);
    }
  }

  private triggerLightbarFlash(
    rgb: RgbColor,
    durationMs: number,
    priority: number,
    now = nowMs(),
  ): void {
    if (!this.isWebHidConnected() || this.disposed) return;
    if (
      this.lightbarFlashActive &&
      now < this.lightbarFlashUntilMs &&
      priority < this.lightbarFlashPriority
    ) {
      return;
    }
    if (priority <= 1 && now - this.lastLightbarPacketMs < LIGHTBAR_MIN_PACKET_GAP_MS) {
      return;
    }

    this.lightbarFlashActive = true;
    this.lightbarFlashPriority = priority;
    this.lightbarFlashUntilMs = now + durationMs;
    this.lastLightbarPacketMs = now;
    void this.sendLightbarRgb(rgb);
  }

  private triggerEventRumble(spec: RumbleSpec, now = nowMs()): void {
    this.eventRumbleUntilMs = Math.max(
      this.eventRumbleUntilMs,
      now + Math.min(240, spec.duration * 0.72),
    );
    this.triggerRumble(spec);
  }

  private triggerPracticeRumble(spec: RumbleSpec, minGapMs = 18, now = nowMs()): void {
    if (!this.vibrationEnabled || this.disposed) return;
    if (now < this.eventRumbleUntilMs) return;
    if (now - this.lastPracticeRumbleMs < minGapMs) return;
    this.lastPracticeRumbleMs = now;
    this.triggerRumble(spec);
  }

  private applyPracticeFeedback(
    state: GameState,
    currButtons: readonly boolean[],
    justPressed: (idx: number) => boolean,
    steer: SteeringFeedback,
    now: number,
  ): void {
    // 1. Crisp micro-rumble + vibrant RGB lightbar flash on any newly pressed button
    const practiceButtons = [
      BTN_TOUCHPAD,
      BTN_L1,
      BTN_R1,
      BTN_L2,
      BTN_R2,
      BTN_L3,
      BTN_R3,
      BTN_TRIANGLE,
      BTN_CIRCLE,
      BTN_SQUARE,
      BTN_CROSS,
      BTN_CREATE,
      BTN_OPTIONS,
    ] as const;

    let handledJustPressed = false;
    for (const btnIdx of practiceButtons) {
      if (!justPressed(btnIdx)) continue;
      if (btnIdx === BTN_R1 && this.butterflyHoldActive) {
        handledJustPressed = true;
        break;
      }
      const spec = BUTTON_PRACTICE_RUMBLE[btnIdx];
      if (spec) {
        this.triggerPracticeRumble(spec, 16, now);
      }

      if (this.isWebHidConnected()) {
        if (btnIdx === BTN_TOUCHPAD) {
          const prism =
            TOUCHPAD_PRISM_COLORS[this.touchpadPrismIndex % TOUCHPAD_PRISM_COLORS.length] ??
            TOUCHPAD_PRISM_COLORS[0]!;
          this.touchpadPrismIndex = (this.touchpadPrismIndex + 1) % TOUCHPAD_PRISM_COLORS.length;
          this.triggerLightbarFlash(prism, 300, 2, now);
        } else if (btnIdx === BTN_R2) {
          this.triggerLightbarFlash(SPRAY_LIGHTBAR_COLORS[state.form], 200, 2, now);
        } else {
          const btnRgb = BUTTON_LIGHTBAR_COLORS[btnIdx];
          if (btnRgb) {
            this.triggerLightbarFlash(btnRgb, 240, 2, now);
          }
        }
      }
      handledJustPressed = true;
      break;
    }

    // 2. D-Pad / Analog stick initial engagement & sharp turn tactile detent
    if (!handledJustPressed) {
      if (steer.stickEngaged || steer.dpadEngaged) {
        this.triggerPracticeRumble(
          { duration: 24, weakMagnitude: 0.24, strongMagnitude: 0.08 },
          24,
          now,
        );
        if (this.isWebHidConnected() && steer.steerAngle !== null) {
          this.triggerSteerShimmer(state.form, steer.steerAngle, now);
        }
      } else if (steer.sharpTurn) {
        this.triggerPracticeRumble(
          { duration: 20, weakMagnitude: 0.18, strongMagnitude: 0.06 },
          STEER_DETENT_GAP_MS,
          now,
        );
      }
    }

    // 3. Joyful continuous hold feedback while spraying (R2), flying butterfly (R1), dashing (L2/Cross), or steering
    const r2Held = Boolean(currButtons[BTN_R2]);
    const r1HeldButterfly =
      state.phase === 'playing' && Boolean(currButtons[BTN_R1]) && this.butterflyHoldActive;
    const l2Held = Boolean(currButtons[BTN_L2]);
    const crossHeld = Boolean(currButtons[BTN_CROSS]);
    const holdingDash = state.phase === 'playing' && (l2Held || crossHeld) && this.dashActive;

    if (r2Held) {
      if (now - this.lastHoldRumbleMs >= PRACTICE_RUMBLE_HOLD_GAP_MS) {
        this.lastHoldRumbleMs = now;
        this.triggerPracticeRumble(
          { duration: 30, weakMagnitude: 0.28, strongMagnitude: 0.12 },
          PRACTICE_RUMBLE_HOLD_GAP_MS,
          now,
        );
      }
      if (this.isWebHidConnected() && now - this.lastHoldLightbarMs >= LIGHTBAR_HOLD_PULSE_MS) {
        this.lastHoldLightbarMs = now;
        this.holdLightbarPhase = this.holdLightbarPhase === 0 ? 1 : 0;
        const pulseRgb =
          this.holdLightbarPhase === 0
            ? SPRAY_LIGHTBAR_COLORS[state.form]
            : FORM_METADATA[state.form].lightbarRgb;
        this.triggerLightbarFlash(pulseRgb, 160, 1, now);
      }
    } else if (r1HeldButterfly) {
      if (now - this.lastHoldRumbleMs >= PRACTICE_RUMBLE_HOLD_GAP_MS + 30) {
        this.lastHoldRumbleMs = now;
        this.triggerPracticeRumble(
          { duration: 24, weakMagnitude: 0.34, strongMagnitude: 0.08 },
          PRACTICE_RUMBLE_HOLD_GAP_MS,
          now,
        );
      }
      if (this.isWebHidConnected() && now - this.lastHoldLightbarMs >= LIGHTBAR_HOLD_PULSE_MS) {
        this.lastHoldLightbarMs = now;
        this.holdLightbarPhase = this.holdLightbarPhase === 0 ? 1 : 0;
        const butterflyRgb =
          this.holdLightbarPhase === 0 ? BUTTERFLY_PINK_ICE_RGB : BUTTERFLY_ICE_CYAN_RGB;
        this.triggerLightbarFlash(butterflyRgb, 170, 1, now);
      }
    } else if (holdingDash) {
      if (now - this.lastHoldRumbleMs >= PRACTICE_RUMBLE_HOLD_GAP_MS + 20) {
        this.lastHoldRumbleMs = now;
        this.triggerPracticeRumble(
          { duration: 26, weakMagnitude: 0.2, strongMagnitude: 0.1 },
          PRACTICE_RUMBLE_HOLD_GAP_MS,
          now,
        );
      }
      if (this.isWebHidConnected() && now - this.lastHoldLightbarMs >= LIGHTBAR_HOLD_PULSE_MS) {
        this.lastHoldLightbarMs = now;
        this.holdLightbarPhase = this.holdLightbarPhase === 0 ? 1 : 0;
        const dashRgb: RgbColor =
          this.holdLightbarPhase === 0 ? [96, 212, 255] : FORM_METADATA[state.form].lightbarRgb;
        this.triggerLightbarFlash(dashRgb, 160, 1, now);
      }
    } else if (
      steer.isSteering &&
      this.isWebHidConnected() &&
      steer.steerAngle !== null &&
      now - this.lastHoldLightbarMs >= 210
    ) {
      this.lastHoldLightbarMs = now;
      this.triggerSteerShimmer(state.form, steer.steerAngle, now);
    }
  }

  private triggerSteerShimmer(form: SnakeForm, angle: number, now: number): void {
    const [br, bg, bb] = FORM_METADATA[form].lightbarRgb;
    const wave = 0.5 + 0.5 * Math.cos(angle);
    const r = clampByte(br * 0.72 + wave * 72);
    const g = clampByte(bg * 0.72 + (1 - wave) * 72);
    const b = clampByte(bb * 0.72 + 52);
    this.triggerLightbarFlash([r, g, b], 170, 1, now);
  }

  private pickGamepad(): Gamepad | null {
    const gamepads = readGamepads();
    let fallback: Gamepad | null = null;
    for (const gp of gamepads) {
      if (!gp || !gp.connected) continue;
      if (isDualSenseGamepad(gp)) return gp;
      if (!fallback) fallback = gp;
    }
    return fallback;
  }

  private cardinalDpadDirection(
    dpadDx: number,
    dpadDz: number,
    justPressed: (idx: number) => boolean,
  ): Direction | null {
    if (dpadDz === -1 && justPressed(BTN_DPAD_UP)) return 'up';
    if (dpadDz === 1 && justPressed(BTN_DPAD_DOWN)) return 'down';
    if (dpadDx === -1 && justPressed(BTN_DPAD_LEFT)) return 'left';
    if (dpadDx === 1 && justPressed(BTN_DPAD_RIGHT)) return 'right';
    return null;
  }

  private handleSteering(
    rawLx: number,
    rawLy: number,
    isPressed: (idx: number) => boolean,
    justPressed: (idx: number) => boolean,
    phaseResumedPlaying: boolean,
    now: number,
  ): SteeringFeedback {
    const dpadDx = (isPressed(BTN_DPAD_RIGHT) ? 1 : 0) - (isPressed(BTN_DPAD_LEFT) ? 1 : 0);
    const dpadDz = (isPressed(BTN_DPAD_DOWN) ? 1 : 0) - (isPressed(BTN_DPAD_UP) ? 1 : 0);
    const dpadActive = dpadDx !== 0 || dpadDz !== 0;
    const dpadAngle = dpadActive ? Math.atan2(dpadDz, dpadDx) : null;
    const dpadEngaged = this.lastDpadAngle === null && dpadAngle !== null;

    const mag = Math.hypot(rawLx, rawLy);
    const stickAngle = mag >= LEFT_STICK_DEADZONE ? Math.atan2(rawLy, rawLx) : null;
    const stickEngaged = this.lastStickAngle === null && stickAngle !== null;

    if (stickAngle === null && dpadActive && (dpadDx === 0 || dpadDz === 0)) {
      const cardinalDir = this.cardinalDpadDirection(dpadDx, dpadDz, justPressed);
      if (cardinalDir) {
        this.handlers.turn(cardinalDir);
      }
    }

    if (stickAngle !== null) {
      this.lastDpadAngle = dpadAngle;
      let sharpTurn = false;
      if (
        this.lastDetentAngle === null ||
        (Math.abs(angleDiff(this.lastDetentAngle, stickAngle)) >= STEER_SHARP_TURN_RAD &&
          now - this.lastSteerDetentMs >= STEER_DETENT_GAP_MS)
      ) {
        sharpTurn = this.lastDetentAngle !== null;
        this.lastDetentAngle = stickAngle;
        if (sharpTurn) {
          this.lastSteerDetentMs = now;
        }
      }
      if (
        this.lastStickAngle === null ||
        Math.abs(angleDiff(this.lastStickAngle, stickAngle)) > LEFT_STICK_ANGLE_EPSILON ||
        phaseResumedPlaying
      ) {
        this.lastStickAngle = stickAngle;
        this.handlers.steer(stickAngle);
      }
      return {
        stickEngaged,
        dpadEngaged,
        sharpTurn,
        isSteering: true,
        steerAngle: stickAngle,
      };
    }

    const stickJustReleased = this.lastStickAngle !== null;
    this.lastStickAngle = null;

    if (dpadAngle !== null) {
      if (
        this.lastDpadAngle === null ||
        Math.abs(angleDiff(this.lastDpadAngle, dpadAngle)) > 1e-6 ||
        stickJustReleased ||
        phaseResumedPlaying
      ) {
        this.lastDpadAngle = dpadAngle;
        this.handlers.steer(dpadAngle);
      }
      this.lastDetentAngle = dpadAngle;
      return {
        stickEngaged: false,
        dpadEngaged,
        sharpTurn: false,
        isSteering: true,
        steerAngle: dpadAngle,
      };
    }

    const dpadJustReleased = this.lastDpadAngle !== null;
    this.lastDpadAngle = null;
    this.lastDetentAngle = null;
    if (stickJustReleased || dpadJustReleased) {
      this.handlers.steer(null);
    }
    return {
      stickEngaged: false,
      dpadEngaged: false,
      sharpTurn: false,
      isSteering: false,
      steerAngle: null,
    };
  }

  private collectPressedLabels(currButtons: readonly boolean[]): readonly string[] {
    const labels: string[] = [];
    if (currButtons[BTN_CROSS]) labels.push('✕');
    if (currButtons[BTN_CIRCLE]) labels.push('○');
    if (currButtons[BTN_SQUARE]) labels.push('□');
    if (currButtons[BTN_TRIANGLE]) labels.push('△');
    if (currButtons[BTN_L1]) labels.push('L1');
    if (currButtons[BTN_R1]) labels.push('R1');
    if (currButtons[BTN_L2]) labels.push('L2');
    if (currButtons[BTN_R2]) labels.push('R2');
    if (currButtons[BTN_L3]) labels.push('L3');
    if (currButtons[BTN_R3]) labels.push('R3');
    if (
      currButtons[BTN_DPAD_UP] ||
      currButtons[BTN_DPAD_DOWN] ||
      currButtons[BTN_DPAD_LEFT] ||
      currButtons[BTN_DPAD_RIGHT]
    ) {
      labels.push('D-Pad');
    }
    if (currButtons[BTN_TOUCHPAD]) labels.push('Touchpad');
    if (currButtons[BTN_CREATE]) labels.push('Create');
    if (currButtons[BTN_OPTIONS]) labels.push('Options');
    return labels;
  }

  private triggerRumble(spec: RumbleSpec): void {
    const gamepad = this.lastGamepad ?? this.pickGamepad();
    const actuator = (
      gamepad as { readonly vibrationActuator?: Partial<GamepadHapticActuator> } | null
    )?.vibrationActuator;
    if (!actuator || typeof actuator.playEffect !== 'function') return;

    try {
      const result = actuator.playEffect('dual-rumble', {
        startDelay: 0,
        duration: spec.duration,
        weakMagnitude: spec.weakMagnitude,
        strongMagnitude: spec.strongMagnitude,
      });
      if (
        result &&
        typeof result === 'object' &&
        'catch' in result &&
        typeof (result as Promise<unknown>).catch === 'function'
      ) {
        (result as Promise<unknown>).catch(() => {});
      }
    } catch {
      // Ignore browsers/controllers where dual-rumble is unsupported.
    }
  }

  private attachHidDisconnectListener(hid: HIDLike): void {
    if (this.hidDisconnectListener || !hid.addEventListener) return;
    this.hidDisconnectListener = (event: HIDConnectionEventLike) => {
      if (event.device && event.device === this.hidDevice) {
        this.hidDevice = null;
        this.resetLightbarChompState();
      }
    };
    hid.addEventListener('disconnect', this.hidDisconnectListener);
  }

  private isWebHidSupported(): boolean {
    return getNavigatorHid() !== null;
  }

  private isWebHidConnected(): boolean {
    return Boolean(this.hidDevice?.opened);
  }

  private isBluetoothHidDevice(device: HIDDeviceLike): boolean {
    const collections = device.collections;
    if (!collections || collections.length === 0) return false;
    let hasUsb02 = false;
    let hasBt31 = false;
    for (const col of collections) {
      for (const rep of col.outputReports ?? []) {
        if (rep.reportId === 0x02) hasUsb02 = true;
        if (rep.reportId === 0x31) hasBt31 = true;
      }
    }
    return hasBt31 && !hasUsb02;
  }

  private async sendLightbarRgb(rgb: readonly [number, number, number]): Promise<boolean> {
    const device = this.hidDevice;
    if (!device || !device.opened) return false;

    const [r, g, b] = rgb;
    const common = new Uint8Array(47);
    common[1] = 0x04; // DS_OUTPUT_VALID_FLAG1_LIGHTBAR_CONTROL_ENABLE
    common[44] = clampByte(r);
    common[45] = clampByte(g);
    common[46] = clampByte(b);

    if (!this.isBluetoothHidDevice(device)) {
      try {
        await device.sendReport(0x02, common);
        return true;
      } catch {
        // Fall back to DualSense Bluetooth output report 0x31 below.
      }
    }

    try {
      const bt = new Uint8Array(77);
      bt[0] = (this.btSeq++ & 0x0f) << 4;
      bt[1] = 0x10; // DS_OUTPUT_TAG
      bt.set(common, 2);
      const crc = crc32DualSenseBt(0x31, bt.subarray(0, 73));
      const view = new DataView(bt.buffer);
      view.setUint32(73, crc, true);
      await device.sendReport(0x31, bt);
      return true;
    } catch {
      return false;
    }
  }

  private resetInputOnDisconnect(): void {
    this.prevButtons = [];
    this.prevShootPressed = false;
    this.shootHoldMs = 0;
    this.prevFlowerPressed = false;
    this.flowerHoldMs = 0;
    this.prevPhase = null;
    this.lastDetentAngle = null;
    this.lastSteerDetentMs = -Infinity;
    this.eventRumbleUntilMs = -Infinity;
    this.lastPracticeRumbleMs = -Infinity;
    this.lastHoldRumbleMs = -Infinity;
    this.lastHoldLightbarMs = -Infinity;
    if (this.lastStickAngle !== null || this.lastDpadAngle !== null) {
      this.lastStickAngle = null;
      this.lastDpadAngle = null;
      this.handlers.steer(null);
    }
    if (this.dashActive) {
      this.dashActive = false;
      this.handlers.setDash(false);
    }
    if (this.butterflyHoldActive) {
      this.butterflyHoldActive = false;
      this.handlers.setButterflyHold(false);
    }
    if (this.lastCameraX !== 0 || this.lastCameraY !== 0) {
      this.lastCameraX = 0;
      this.lastCameraY = 0;
      this.handlers.cameraLook(0, 0);
    }
  }

  private disconnectedStatus(): ControllerStatus {
    return {
      connected: false,
      isDualSense: false,
      controllerName: '',
      webHidConnected: this.isWebHidConnected(),
      webHidSupported: this.isWebHidSupported(),
      pressedLabels: [],
      leftStick: { x: 0, y: 0 },
      rightStick: { x: 0, y: 0 },
    };
  }
}
