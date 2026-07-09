import { el } from './dom';

/** Belt-and-braces removal for when CSS animations are disabled (reduced motion). */
const FALLBACK_REMOVE_MS = 1400;

/**
 * Floating score popups ("+1") anchored to viewport pixel positions. Each
 * popup animates and removes itself, so pausing or restarting the game never
 * needs to clean the layer up.
 */
export class ScorePopups {
  private readonly layer: HTMLElement;

  constructor(root: HTMLElement) {
    this.layer = el('div', { id: 'popups' });
    root.appendChild(this.layer);
  }

  spawn(x: number, y: number, text = '+1'): void {
    const node = el('div', { className: 'score-popup', text });
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), FALLBACK_REMOVE_MS);
    this.layer.appendChild(node);
  }
}
