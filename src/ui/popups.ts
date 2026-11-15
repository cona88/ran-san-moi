import { el } from './dom';

/** Belt-and-braces removal for when CSS animations are disabled (reduced motion). */
const FALLBACK_REMOVE_MS = 1400;

/**
 * Floating score & event popups ("+10", "Băng Giá!") anchored to viewport
 * pixel positions. Each popup animates and removes itself automatically.
 */
export class ScorePopups {
  private readonly layer: HTMLElement;

  constructor(root: HTMLElement) {
    this.layer = el('div', { id: 'popups' });
    root.appendChild(this.layer);
  }

  spawn(x: number, y: number, label = '+1', color?: string): void {
    const node = el('div', { className: 'score-popup', text: label });
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    if (color) {
      node.style.color = color;
      node.style.textShadow = `0 2px 12px ${color}, 0 0 18px rgba(255, 255, 255, 0.72)`;
    }
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), FALLBACK_REMOVE_MS);
    this.layer.appendChild(node);
  }

  dispose(): void {
    this.layer.remove();
  }
}
