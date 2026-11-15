import { FORM_METADATA } from '../core/config';
import type { GameState } from '../core/types';
import { el } from './dom';

/**
 * Compact top-center badge rendered directly inside `#top-hud-stack` whenever
 * the player snake is channeling an absorbed Bot power.
 */
export class AbsorbedPowerBanner {
  private readonly rootEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly barFillEl: HTMLElement;

  private lastKey = '';

  constructor(parent: HTMLElement) {
    this.titleEl = el('span', { className: 'absorbed-power-title' });
    this.timerEl = el('span', { className: 'absorbed-power-timer' });
    this.barFillEl = el('div', { className: 'absorbed-power-fill' });

    const topRow = el('div', { className: 'absorbed-power-row' }, this.titleEl, this.timerEl);
    const track = el('div', { className: 'absorbed-power-track' }, this.barFillEl);

    this.rootEl = el(
      'div',
      {
        id: 'absorbed-power-banner',
        className: 'hidden',
        ariaLabel: 'Sức mạnh Bot đang hấp thụ',
      },
      topRow,
      track,
    );
    parent.appendChild(this.rootEl);
  }

  syncState(state: GameState): void {
    const power = state.phase === 'playing' ? state.absorbedPower : null;
    if (!power || power.ticksRemaining <= 0) {
      if (this.lastKey !== 'hidden') {
        this.lastKey = 'hidden';
        this.rootEl.classList.add('hidden');
      }
      return;
    }

    const secs = Math.max(1, Math.ceil((power.ticksRemaining * state.config.baseTick) / 1000));
    const pct =
      power.maxTicks > 0
        ? Math.max(0, Math.min(100, (power.ticksRemaining / power.maxTicks) * 100))
        : 0;
    const key = `${power.form}|${power.titleVi}|${secs}|${Math.round(pct)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.rootEl.classList.remove('hidden');
    this.rootEl.style.setProperty('--power-color', FORM_METADATA[power.form].cssColor);
    this.titleEl.textContent = power.titleVi;
    this.timerEl.textContent = `${secs}s`;
    this.barFillEl.style.width = `${pct.toFixed(1)}%`;
  }

  dispose(): void {
    this.rootEl.remove();
  }
}
