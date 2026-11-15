import type { BoosterKind, GameState } from '../core/types';
import { el } from './dom';
import type { GameUICallbacks } from './types';

interface BoosterSpec {
  readonly kind: BoosterKind;
  readonly symbol: string;
  readonly caption: string;
  readonly hotkey: string;
  readonly title: string;
}

const BOOSTER_SPECS: readonly BoosterSpec[] = [
  {
    kind: 'level',
    symbol: 'Lv +10',
    caption: 'TĂNG CẤP',
    hotkey: 'Z / L3',
    title: 'Tăng ngay +10 Cấp độ cho rắn (Phím Z hoặc L3)',
  },
  {
    kind: 'speed',
    symbol: '⚡',
    caption: 'TỐC ĐỘ',
    hotkey: 'X / Share',
    title: 'Siêu tốc độ & khiên lướt miễn nhiễm va chạm (Phím X hoặc Create/Share)',
  },
  {
    kind: 'magnet',
    symbol: '🧲',
    caption: 'NAM CHÂM',
    hotkey: 'C / R3',
    title: 'Nam châm khổng lồ hút ngọc vàng từ xa (Phím C hoặc R3)',
  },
];

interface BoosterElements {
  readonly btn: HTMLButtonElement;
  readonly orb: HTMLElement;
  readonly symbol: HTMLElement;
  readonly timer: HTMLElement;
  readonly charges: HTMLElement;
}

/**
 * Middle-right vertical stack of 3 glossy 3D circular booster buttons
 * (`Lv +10`, `⚡ TỐC ĐỘ`, `🧲 NAM CHÂM`) with kid-friendly free charge counts
 * and live active countdown rings.
 */
export class BoosterButtons {
  private readonly rootEl: HTMLElement;
  private readonly items = new Map<BoosterKind, BoosterElements>();
  private lastKey = '';

  constructor(
    parent: HTMLElement,
    private readonly callbacks: GameUICallbacks,
  ) {
    this.rootEl = el('aside', {
      id: 'booster-buttons',
      ariaLabel: '3 Nút Sức Mạnh Phép Thuật',
    });

    for (const spec of BOOSTER_SPECS) {
      const symbolEl = el('span', { className: 'booster-symbol', text: spec.symbol });
      const timerEl = el('span', { className: 'booster-timer hidden' });
      const orbEl = el('div', { className: 'booster-orb' }, symbolEl, timerEl);
      const chargesEl = el('span', { className: 'booster-charges', text: 'x1' });
      const labelEl = el('span', { className: 'booster-caption', text: spec.caption });
      const hotkeyEl = el('span', { className: 'booster-hotkey', text: spec.hotkey });

      const btn = el(
        'button',
        {
          className: `booster-btn booster-${spec.kind}`,
          type: 'button',
          title: spec.title,
          ariaLabel: `${spec.caption} (${spec.hotkey})`,
        },
        orbEl,
        chargesEl,
        labelEl,
        hotkeyEl,
      );
      btn.dataset['booster'] = spec.kind;
      btn.addEventListener('click', () => {
        this.callbacks.onActivateBooster(spec.kind);
      });

      this.items.set(spec.kind, {
        btn,
        orb: orbEl,
        symbol: symbolEl,
        timer: timerEl,
        charges: chargesEl,
      });
      this.rootEl.appendChild(btn);
    }

    parent.appendChild(this.rootEl);
  }

  syncState(state: GameState): void {
    const keyParts: string[] = [state.phase];
    for (const spec of BOOSTER_SPECS) {
      const slot = state.boosters[spec.kind];
      const secs =
        slot.activeTicks > 0
          ? Math.max(1, Math.ceil((slot.activeTicks * state.config.baseTick) / 1000))
          : 0;
      const pct =
        slot.activeTicks > 0 && slot.maxTicks > 0
          ? Math.round((slot.activeTicks / slot.maxTicks) * 100)
          : 0;
      keyParts.push(`${spec.kind}:${slot.charges}:${secs}:${pct}`);
    }

    const key = keyParts.join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;

    for (const spec of BOOSTER_SPECS) {
      const els = this.items.get(spec.kind);
      if (!els) continue;

      const slot = state.boosters[spec.kind];
      const isActive = slot.activeTicks > 0;
      const isDepleted = slot.charges <= 0 && !isActive;

      els.charges.textContent = `x${slot.charges}`;
      els.charges.classList.toggle('empty', slot.charges <= 0);
      els.btn.classList.toggle('active', isActive);
      els.btn.classList.toggle('depleted', isDepleted);

      if (isActive) {
        const secs = Math.max(1, Math.ceil((slot.activeTicks * state.config.baseTick) / 1000));
        const pct =
          slot.maxTicks > 0
            ? Math.max(0, Math.min(100, (slot.activeTicks / slot.maxTicks) * 100))
            : 0;
        els.orb.style.setProperty('--booster-pct', `${pct.toFixed(1)}%`);
        els.timer.textContent = `${secs}s`;
        els.timer.classList.remove('hidden');
      } else {
        els.orb.style.removeProperty('--booster-pct');
        els.timer.classList.add('hidden');
      }
    }
  }

  dispose(): void {
    this.rootEl.remove();
  }
}
