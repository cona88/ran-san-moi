import type { Direction } from '../core/types';
import type { ControlHandlers } from './controls';

const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

/** Wire keyboard controls to the handlers. Returns a disposer. */
export function attachKeyboard(handlers: ControlHandlers): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      handlers.primary();
      return;
    }
    if (event.code === 'KeyP' || event.code === 'Escape') {
      event.preventDefault();
      handlers.togglePause();
      return;
    }
    const direction = KEY_TO_DIRECTION[event.code];
    if (direction) {
      event.preventDefault();
      handlers.turn(direction);
    }
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
