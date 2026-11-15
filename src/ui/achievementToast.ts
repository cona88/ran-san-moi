import type { AchievementDef } from '../platform/achievements';
import { el } from './dom';

const REMOVE_MS = 3700;
const MAX_VISIBLE_TOASTS = 3;

/** Slide-in pastel crystal toast banner announcing achievements or magic events. */
export class AchievementToast {
  private readonly layer: HTMLElement;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(root: HTMLElement) {
    this.layer = el('div', { id: 'achievement-toasts' });
    root.appendChild(this.layer);
  }

  show(def: AchievementDef): void {
    this.showToast('Thành tựu mới!', def.name, '🏆');
  }

  showToast(title: string, subtitle: string, icon = '✨'): void {
    while (this.layer.childElementCount >= MAX_VISIBLE_TOASTS && this.layer.firstElementChild) {
      this.layer.firstElementChild.remove();
    }

    const iconEl = el('div', { className: 'achievement-toast-icon', text: icon });
    const bodyEl = el(
      'div',
      { className: 'achievement-toast-body' },
      el('div', { className: 'achievement-toast-title', text: title }),
      ...(subtitle ? [el('div', { className: 'achievement-toast-name', text: subtitle })] : []),
    );

    const node = el('div', { className: 'achievement-toast' }, iconEl, bodyEl);
    const cleanup = (): void => {
      node.remove();
      this.timers.delete(timer);
    };
    const timer = setTimeout(cleanup, REMOVE_MS);
    this.timers.add(timer);
    node.addEventListener('animationend', cleanup, { once: true });
    this.layer.appendChild(node);
  }

  dispose(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.layer.remove();
  }
}
