import type { AchievementDef } from '../platform/achievements';
import { el } from './dom';

const REMOVE_MS = 3700;

/** Slide-in banner announcing a newly unlocked achievement. */
export class AchievementToast {
  private readonly layer: HTMLElement;

  constructor(root: HTMLElement) {
    this.layer = el('div', { id: 'achievement-toasts' });
    root.appendChild(this.layer);
  }

  show(def: AchievementDef): void {
    const node = el(
      'div',
      { className: 'achievement-toast' },
      el('div', { className: 'achievement-toast-title', text: 'Achievement unlocked' }),
      el('div', { className: 'achievement-toast-name', text: def.name }),
    );
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), REMOVE_MS);
    this.layer.appendChild(node);
  }
}
