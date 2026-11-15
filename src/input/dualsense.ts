import { FORM_METADATA, angleDiff } from '../core';
import type {
  Direction,
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
const AUTO_FIRE_INTERVAL_MS = 190;

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

const RUMBLE_PRESETS: Readonly<Partial<Record<GameEventKind, RumbleSpec>>> = {
  shoot: { duration: 55, weakMagnitude: 0.35, strongMagnitude: 0.15 },
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
};

const LIGHTBAR_EVENT_KINDS = new Set<GameEventKind>(['morph', 'shield_activate', 'quest_complete']);

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
  private dashActive = false;
  private lastStickAngle: number | null = null;
  private lastDpadAngle: number | null = null;
  private prevPhase: GamePhase | null = null;
  private lastCameraX = 0;
  private lastCameraY = 0;
  private vibrationEnabled = true;
  private lastGamepad: Gamepad | null = null;

  private hidDevice: HIDDeviceLike | null = null;
  private hidDisconnectListener: ((event: HIDConnectionEventLike) => void) | null = null;
  private btSeq = 0;
  private disposed = false;

  constructor(handlers: ControlHandlers) {
    this.handlers = handlers;
  }

  /** Poll connected gamepads each animation frame and return live HUD status. */
  poll(dtMs: number, state: GameState): ControllerStatus {
    if (this.disposed) {
      return this.disconnectedStatus();
    }

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
    this.handleSteering(rawLx, rawLy, isPressed, justPressed, phaseResumedPlaying);

    // 3. Right Stick smooth 3D camera look (deadzone 0.15)
    const rawRx = clamp(axes[2] ?? 0, -1, 1);
    const rawRy = clamp(axes[3] ?? 0, -1, 1);
    const rightStick = normalizeStick(rawRx, rawRy, RIGHT_STICK_DEADZONE);
    if (rightStick.x !== this.lastCameraX || rightStick.y !== this.lastCameraY) {
      this.lastCameraX = rightStick.x;
      this.lastCameraY = rightStick.y;
      this.handlers.cameraLook(rightStick.x, rightStick.y);
    }

    // 4. Shoot (R2 or Square) with 190ms auto-fire while held during 'playing'
    const shootPressed = isPressed(BTN_R2) || isPressed(BTN_SQUARE);
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

    // 5. Morph forms (Triangle / R1 / Touchpad click -> next, L1 -> prev)
    if (justPressed(BTN_TRIANGLE) || justPressed(BTN_R1) || justPressed(BTN_TOUCHPAD)) {
      this.handlers.morphNext();
    }
    if (justPressed(BTN_L1)) {
      this.handlers.morphPrev();
    }

    // 6. Bubble Shield (Circle)
    if (justPressed(BTN_CIRCLE)) {
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

    if (this.vibrationEnabled) {
      const preset = RUMBLE_PRESETS[event.kind];
      if (preset) {
        this.triggerRumble(preset);
      }
    }

    if (this.isWebHidConnected() && LIGHTBAR_EVENT_KINDS.has(event.kind)) {
      void this.sendLightbarRgb(FORM_METADATA[state.form].lightbarRgb);
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
  ): void {
    const dpadDx = (isPressed(BTN_DPAD_RIGHT) ? 1 : 0) - (isPressed(BTN_DPAD_LEFT) ? 1 : 0);
    const dpadDz = (isPressed(BTN_DPAD_DOWN) ? 1 : 0) - (isPressed(BTN_DPAD_UP) ? 1 : 0);
    const dpadActive = dpadDx !== 0 || dpadDz !== 0;
    const dpadAngle = dpadActive ? Math.atan2(dpadDz, dpadDx) : null;

    const mag = Math.hypot(rawLx, rawLy);
    const stickAngle = mag >= LEFT_STICK_DEADZONE ? Math.atan2(rawLy, rawLx) : null;

    if (stickAngle === null && dpadActive && (dpadDx === 0 || dpadDz === 0)) {
      const cardinalDir = this.cardinalDpadDirection(dpadDx, dpadDz, justPressed);
      if (cardinalDir) {
        this.handlers.turn(cardinalDir);
      }
    }

    if (stickAngle !== null) {
      this.lastDpadAngle = dpadAngle;
      if (
        this.lastStickAngle === null ||
        Math.abs(angleDiff(this.lastStickAngle, stickAngle)) > LEFT_STICK_ANGLE_EPSILON ||
        phaseResumedPlaying
      ) {
        this.lastStickAngle = stickAngle;
        this.handlers.steer(stickAngle);
      }
      return;
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
      return;
    }

    const dpadJustReleased = this.lastDpadAngle !== null;
    this.lastDpadAngle = null;
    if (stickJustReleased || dpadJustReleased) {
      this.handlers.steer(null);
    }
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
    this.prevPhase = null;
    if (this.lastStickAngle !== null || this.lastDpadAngle !== null) {
      this.lastStickAngle = null;
      this.lastDpadAngle = null;
      this.handlers.steer(null);
    }
    if (this.dashActive) {
      this.dashActive = false;
      this.handlers.setDash(false);
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
