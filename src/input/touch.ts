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
