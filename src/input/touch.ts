import { angleDiff } from '../core';
import type { Direction } from '../core/types';
import type { ControlHandlers } from './controls';

const BUTTONS: ReadonlyArray<{ direction: Direction; className: string; glyph: string }> = [
  { direction: 'up', className: 'tu', glyph: '▲' },
  { direction: 'left', className: 'tl', glyph: '◀' },
  { direction: 'down', className: 'td', glyph: '▼' },
  { direction: 'right', className: 'tr', glyph: '▶' },
];

/**
 * Build the on-screen d-pad (shown via CSS only on coarse pointers) and wire
 * each button to a turn. Returns a disposer that removes the element.
 */
export function createTouchControls(parent: HTMLElement, handlers: ControlHandlers): () => void {
  const pad = document.createElement('div');
  pad.id = 'touch';

  for (const { direction, className, glyph } of BUTTONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = glyph;
    button.setAttribute('aria-label', direction);
    button.addEventListener('click', () => handlers.turn(direction));
    pad.appendChild(button);
  }

  parent.appendChild(pad);
  return () => pad.remove();
}

/** Minimum finger/mouse drag distance (px) to engage continuous 360° steering. */
const DRAG_DEADZONE = 14;
/** Minimum finger travel (px) on a quick flick without move events to count as a swipe. */
const SWIPE_THRESHOLD = 24;
/** Minimum angle change (rad) before emitting another continuous steer update. */
const STEER_ANGLE_EPSILON = 0.03;

/**
 * Steer the snake smoothly in 360° by dragging anywhere on the board (touch or
 * mouse virtual joystick). Quick taps below the threshold are ignored so they
 * fall through to UI controls. Returns a disposer.
 */
export function attachSwipe(target: HTMLElement, handlers: ControlHandlers): () => void {
  let startX = 0;
  let startY = 0;
  // Track one touch gesture by its touch identifier so extra fingers can't hijack it.
  let activeId: number | null = null;
  let touchSteerAngle: number | null = null;
  let lastTouchTime = 0;

  let mouseActive = false;
  let mouseStartX = 0;
  let mouseStartY = 0;
  let mouseSteerAngle: number | null = null;

  const findTouch = (list: TouchList, id: number): Touch | null => {
    for (let i = 0; i < list.length; i++) {
      const touch = list[i];
      if (touch && touch.identifier === id) return touch;
    }
    return null;
  };

  const emitSteerIfChanged = (prev: number | null, dx: number, dy: number): number | null => {
    if (Math.hypot(dx, dy) < DRAG_DEADZONE) return prev;
    const nextAngle = Math.atan2(dy, dx);
    if (prev === null || Math.abs(angleDiff(prev, nextAngle)) > STEER_ANGLE_EPSILON) {
      handlers.steer(nextAngle);
      return nextAngle;
    }
    return prev;
  };

  const onTouchStart = (event: TouchEvent): void => {
    lastTouchTime = Date.now();
    if (activeId !== null) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    activeId = touch.identifier;
    startX = touch.clientX;
    startY = touch.clientY;
    touchSteerAngle = null;
  };

  const onTouchMove = (event: TouchEvent): void => {
    if (activeId === null) return;
    const touch = findTouch(event.changedTouches, activeId);
    if (!touch) return;
    touchSteerAngle = emitSteerIfChanged(
      touchSteerAngle,
      touch.clientX - startX,
      touch.clientY - startY,
    );
  };

  const onTouchEnd = (event: TouchEvent): void => {
    lastTouchTime = Date.now();
    if (activeId === null) return;
    const touch = findTouch(event.changedTouches, activeId);
    if (!touch) return;
    activeId = null;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (touchSteerAngle !== null) {
      touchSteerAngle = null;
      handlers.steer(null);
      return;
    }
    if (Math.hypot(dx, dy) >= SWIPE_THRESHOLD) {
      handlers.steer(Math.atan2(dy, dx));
    }
  };

  const onTouchCancel = (): void => {
    activeId = null;
    if (touchSteerAngle !== null) {
      touchSteerAngle = null;
      handlers.steer(null);
    }
  };

  const onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    if (activeId !== null || Date.now() - lastTouchTime < 500) return;
    mouseActive = true;
    mouseStartX = event.clientX;
    mouseStartY = event.clientY;
    mouseSteerAngle = null;
  };

  const onMouseMove = (event: MouseEvent): void => {
    if (!mouseActive) return;
    mouseSteerAngle = emitSteerIfChanged(
      mouseSteerAngle,
      event.clientX - mouseStartX,
      event.clientY - mouseStartY,
    );
  };

  const releaseMouse = (): void => {
    if (!mouseActive) return;
    mouseActive = false;
    if (mouseSteerAngle !== null) {
      mouseSteerAngle = null;
      handlers.steer(null);
    }
  };

  target.addEventListener('touchstart', onTouchStart, { passive: true });
  target.addEventListener('touchmove', onTouchMove, { passive: true });
  target.addEventListener('touchend', onTouchEnd, { passive: true });
  target.addEventListener('touchcancel', onTouchCancel, { passive: true });
  target.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', releaseMouse);
  window.addEventListener('blur', releaseMouse);

  return () => {
    target.removeEventListener('touchstart', onTouchStart);
    target.removeEventListener('touchmove', onTouchMove);
    target.removeEventListener('touchend', onTouchEnd);
    target.removeEventListener('touchcancel', onTouchCancel);
    target.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', releaseMouse);
    window.removeEventListener('blur', releaseMouse);
    onTouchCancel();
    releaseMouse();
  };
}
