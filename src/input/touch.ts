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
    button.className = className;
    button.textContent = glyph;
    button.setAttribute('aria-label', direction);
    button.addEventListener('click', () => handlers.turn(direction));
    pad.appendChild(button);
  }

  parent.appendChild(pad);
  return () => pad.remove();
}

/** Minimum finger travel (px) to count as a swipe rather than a tap. */
const SWIPE_THRESHOLD = 24;

/**
 * Turn the snake by swiping anywhere on the board — the most natural mobile
 * control, complementing the d-pad. Taps (below the threshold) are ignored so
 * they still fall through to start/restart. Returns a disposer.
 */
export function attachSwipe(target: HTMLElement, handlers: ControlHandlers): () => void {
  let startX = 0;
  let startY = 0;
  // Track one gesture by its touch identifier so extra fingers can't hijack it.
  let activeId: number | null = null;

  const findTouch = (list: TouchList, id: number): Touch | null => {
    for (let i = 0; i < list.length; i++) {
      const touch = list[i];
      if (touch && touch.identifier === id) return touch;
    }
    return null;
  };

  const onStart = (event: TouchEvent): void => {
    if (activeId !== null) return; // already tracking a gesture
    const touch = event.changedTouches[0];
    if (!touch) return;
    activeId = touch.identifier;
    startX = touch.clientX;
    startY = touch.clientY;
  };

  const onEnd = (event: TouchEvent): void => {
    if (activeId === null) return;
    const touch = findTouch(event.changedTouches, activeId);
    if (!touch) return; // a different finger lifted — keep waiting for ours
    activeId = null;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      handlers.turn(dx > 0 ? 'right' : 'left');
    } else {
      handlers.turn(dy > 0 ? 'down' : 'up');
    }
  };

  const onCancel = (): void => {
    activeId = null;
  };

  target.addEventListener('touchstart', onStart, { passive: true });
  target.addEventListener('touchend', onEnd, { passive: true });
  target.addEventListener('touchcancel', onCancel, { passive: true });
  return () => {
    target.removeEventListener('touchstart', onStart);
    target.removeEventListener('touchend', onEnd);
    target.removeEventListener('touchcancel', onCancel);
  };
}
