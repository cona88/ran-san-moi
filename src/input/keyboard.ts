import type { BoosterKind, FairySkillKind, SnakeForm } from '../core/types';
import type { ControlHandlers } from './controls';

const DIRECTION_CODES = new Set([
  'ArrowUp',
  'KeyW',
  'ArrowDown',
  'KeyS',
  'ArrowLeft',
  'KeyA',
  'ArrowRight',
  'KeyD',
]);

const KEY_TO_FORM: Readonly<Record<string, SnakeForm>> = {
  Digit1: 'dragon',
  Digit2: 'phoenix',
  Digit3: 'unicorn',
  Digit4: 'spirit',
};

const KEY_TO_BOOSTER: Readonly<Record<string, BoosterKind>> = {
  KeyZ: 'level',
  KeyX: 'speed',
  KeyC: 'magnet',
};

const KEY_TO_FAIRY_SKILL: Readonly<Record<string, FairySkillKind>> = {
  KeyV: 'flower',
  Digit5: 'flower',
  KeyN: 'thunder',
  Digit7: 'thunder',
  KeyG: 'fire',
  Digit8: 'fire',
  KeyH: 'water',
  Digit9: 'water',
  KeyJ: 'arcane',
  Digit0: 'arcane',
  KeyM: 'arcane',
};

const BUTTERFLY_HOLD_CODES = new Set(['KeyB', 'Digit6']);
const DASH_CODES = new Set(['ShiftLeft', 'ShiftRight', 'KeyK']);
const HOLD_SPRAY_INTERVAL_MS = 150;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** Wire macOS-friendly 8-way keyboard controls to the semantic handlers. Returns a disposer. */
export function attachKeyboard(handlers: ControlHandlers): () => void {
  const pressedDashKeys = new Set<string>();
  const pressedButterflyKeys = new Set<string>();
  const pressedDirectionKeys = new Set<string>();
  let lastSteerAngle: number | null = null;
  let sprayInterval: ReturnType<typeof setInterval> | null = null;

  const stopSpray = (): void => {
    if (sprayInterval !== null) {
      clearInterval(sprayInterval);
      sprayInterval = null;
    }
  };

  const startSpray = (): void => {
    if (sprayInterval !== null) return;
    handlers.shoot();
    sprayInterval = setInterval(() => {
      handlers.shoot();
    }, HOLD_SPRAY_INTERVAL_MS);
  };

  const syncDirectionSteer = (): void => {
    let dx = 0;
    let dz = 0;
    if (pressedDirectionKeys.has('KeyW') || pressedDirectionKeys.has('ArrowUp')) dz -= 1;
    if (pressedDirectionKeys.has('KeyS') || pressedDirectionKeys.has('ArrowDown')) dz += 1;
    if (pressedDirectionKeys.has('KeyA') || pressedDirectionKeys.has('ArrowLeft')) dx -= 1;
    if (pressedDirectionKeys.has('KeyD') || pressedDirectionKeys.has('ArrowRight')) dx += 1;

    const nextAngle = dx !== 0 || dz !== 0 ? Math.atan2(dz, dx) : null;
    if (nextAngle !== lastSteerAngle) {
      lastSteerAngle = nextAngle;
      handlers.steer(nextAngle);
    }
  };

  const releaseDirections = (): void => {
    if (pressedDirectionKeys.size === 0 && lastSteerAngle === null) return;
    pressedDirectionKeys.clear();
    if (lastSteerAngle !== null) {
      lastSteerAngle = null;
      handlers.steer(null);
    }
  };

  const releaseDash = (): void => {
    if (pressedDashKeys.size === 0) return;
    pressedDashKeys.clear();
    handlers.setDash(false);
  };

  const releaseButterflyHold = (): void => {
    if (pressedButterflyKeys.size === 0) return;
    pressedButterflyKeys.clear();
    handlers.setButterflyHold(false);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) return;
    // Preserve macOS system/browser shortcuts such as Cmd+R, Cmd+W, Cmd+Q.
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const { code } = event;

    if (DIRECTION_CODES.has(code)) {
      event.preventDefault();
      if (!pressedDirectionKeys.has(code)) {
        pressedDirectionKeys.add(code);
        syncDirectionSteer();
      }
      return;
    }

    if (DASH_CODES.has(code)) {
      event.preventDefault();
      if (!pressedDashKeys.has(code)) {
        const wasEmpty = pressedDashKeys.size === 0;
        pressedDashKeys.add(code);
        if (wasEmpty) handlers.setDash(true);
      }
      return;
    }

    if (BUTTERFLY_HOLD_CODES.has(code)) {
      event.preventDefault();
      if (!event.repeat && !pressedButterflyKeys.has(code)) {
        const wasEmpty = pressedButterflyKeys.size === 0;
        pressedButterflyKeys.add(code);
        if (wasEmpty) handlers.setButterflyHold(true);
      }
      return;
    }

    if (code === 'Enter') {
      event.preventDefault();
      if (!event.repeat) handlers.primary();
      return;
    }

    if (code === 'Space') {
      event.preventDefault();
      if (!event.repeat) startSpray();
      return;
    }

    if (code === 'KeyP' || code === 'Escape') {
      event.preventDefault();
      if (!event.repeat) handlers.togglePause();
      return;
    }

    if (code === 'KeyQ') {
      event.preventDefault();
      if (!event.repeat) handlers.morphPrev();
      return;
    }

    if (code === 'KeyE') {
      event.preventDefault();
      if (!event.repeat) handlers.morphNext();
      return;
    }

    if (code === 'KeyF' || code === 'KeyL') {
      event.preventDefault();
      if (!event.repeat) handlers.shield();
      return;
    }

    if (code === 'KeyT') {
      event.preventDefault();
      if (!event.repeat) handlers.togglePrincess();
      return;
    }

    const booster = KEY_TO_BOOSTER[code];
    if (booster) {
      event.preventDefault();
      if (!event.repeat) handlers.activateBooster(booster);
      return;
    }

    const fairySkill = KEY_TO_FAIRY_SKILL[code];
    if (fairySkill) {
      event.preventDefault();
      if (!event.repeat) handlers.castFairySkill(fairySkill);
      return;
    }

    const form = KEY_TO_FORM[code];
    if (form) {
      event.preventDefault();
      if (!event.repeat) handlers.morphTo(form);
    }
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    const { code } = event;

    if (code === 'Space') {
      stopSpray();
      return;
    }

    if (pressedDirectionKeys.delete(code)) {
      syncDirectionSteer();
    }

    if (pressedDashKeys.delete(code) && pressedDashKeys.size === 0) {
      handlers.setDash(false);
    }

    if (pressedButterflyKeys.delete(code) && pressedButterflyKeys.size === 0) {
      handlers.setButterflyHold(false);
    }
  };

  const onBlur = (): void => {
    releaseDirections();
    releaseDash();
    releaseButterflyHold();
    stopSpray();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    releaseDirections();
    releaseDash();
    releaseButterflyHold();
    stopSpray();
  };
}
