import type { GameState } from '../core/types';
import { el } from './dom';

/**
 * Giant top-center Boss progression bar (Snake Clash! style).
 * Fills smoothly from 0% to 100% with `state.bossProgress` and switches to a
 * blazing active-boss alert while `state.activeBossId !== null`.
 */
export class BossBar {
  private readonly rootEl: HTMLElement;
  private readonly fillEl: HTMLElement;
  private readonly labelEl: HTMLElement;
  private readonly badgeIconEl: HTMLElement;
  private readonly badgeLevelEl: HTMLElement;

  private lastKey = '';

  constructor(parent: HTMLElement) {
    this.fillEl = el('div', { className: 'boss-bar-fill' });
    this.labelEl = el('div', { className: 'boss-bar-label', text: '⚔️ BOSS RỒNG • 0%' });

    const trackEl = el('div', { className: 'boss-bar-track' }, this.fillEl, this.labelEl);

    this.badgeIconEl = el('span', { className: 'boss-dragon-icon', text: '🐉' });
    this.badgeLevelEl = el('span', { className: 'boss-level-tag', text: 'Lv.25' });
    const dragonBadge = el(
      'div',
      {
        className: 'boss-dragon-badge',
        title: 'Cấp độ Boss Đại Vương Rồng tiếp theo',
      },
      this.badgeIconEl,
      this.badgeLevelEl,
    );

    this.rootEl = el(
      'section',
      { id: 'boss-bar', ariaLabel: 'Thanh tiến trình Boss Đại Vương Rồng' },
      trackEl,
      dragonBadge,
    );
    parent.appendChild(this.rootEl);
  }

  syncState(state: GameState): void {
    const activeBoss =
      state.activeBossId !== null
        ? state.bots.find((b) => b.id === state.activeBossId || b.isBoss)
        : undefined;
    const isBossActive = state.activeBossId !== null;
    const displayLevel = isBossActive
      ? (activeBoss?.level ?? state.bossTargetLevel)
      : state.bossTargetLevel;
    const progress = isBossActive
      ? 100
      : Math.max(0, Math.min(100, Math.round(state.bossProgress)));

    const key = `${isBossActive ? 1 : 0}|${progress}|${displayLevel}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.rootEl.classList.toggle('boss-active', isBossActive);
    this.fillEl.style.width = `${progress}%`;

    if (isBossActive) {
      this.labelEl.textContent = `👹 ĐẠI VƯƠNG RỒNG Lv.${displayLevel}`;
      this.badgeIconEl.textContent = '👹';
      this.badgeLevelEl.textContent = `Lv.${displayLevel}`;
    } else {
      this.labelEl.textContent = `⚔️ Tiến Trình Boss • ${progress}%`;
      this.badgeIconEl.textContent = '🐉';
      this.badgeLevelEl.textContent = `Lv.${displayLevel}`;
    }
  }

  dispose(): void {
    this.rootEl.remove();
  }
}
