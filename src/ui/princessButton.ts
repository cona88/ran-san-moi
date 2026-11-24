import type { GameState } from '../core/types';
import { canTransformToPrincess } from '../core/princess';
import { el } from './dom';
import type { GameUICallbacks } from './types';

/**
 * Left-edge "👸 Tiên Nữ" button: transforms the snake into a flying Fairy
 * Princess to tour the castles, or returns her to snake form.
 * DualSense: L1+R1 (or L2+R1 / L2+Touchpad / PS) • Keyboard: T.
 */
export class PrincessButton {
  private readonly rootEl: HTMLButtonElement;
  private readonly emojiEl: HTMLElement;
  private readonly labelEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private lastKey = '';

  constructor(parent: HTMLElement, callbacks: GameUICallbacks) {
    this.emojiEl = el('span', { className: 'princess-btn-emoji', text: '👸' });
    this.labelEl = el('span', { className: 'princess-btn-label', text: 'TIÊN NỮ' });
    this.hintEl = el('span', { className: 'princess-btn-hint', text: 'L1+R1 • T' });
    const textWrap = el('span', { className: 'princess-btn-text' }, this.labelEl, this.hintEl);
    this.rootEl = el(
      'button',
      {
        id: 'princess-btn',
        className: 'princess-transform-btn hidden',
        type: 'button',
        title:
          'Hóa Tiên Nữ bay tham quan lâu đài (DualSense: L1+R1, L2+R1 hoặc L2+Touchpad • Phím: T)',
        ariaLabel: 'Hóa Tiên Nữ bay tham quan lâu đài',
      },
      this.emojiEl,
      textWrap,
    );
    this.rootEl.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onTogglePrincess?.();
    });
    parent.appendChild(this.rootEl);
  }

  syncState(state: GameState): void {
    const visible = state.phase === 'playing';
    const stage = state.princessStage ?? 'snake';
    const available = stage === 'princess' || canTransformToPrincess(state);
    const key = `${visible ? 1 : 0}|${stage}|${available ? 1 : 0}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.rootEl.classList.toggle('hidden', !visible);
    this.rootEl.classList.toggle('is-active', stage === 'princess');
    this.rootEl.classList.toggle(
      'is-transforming',
      stage === 'transforming' || stage === 'returning',
    );
    this.rootEl.classList.toggle('is-locked', !available && stage === 'snake');
    this.rootEl.setAttribute('aria-pressed', String(stage !== 'snake'));

    switch (stage) {
      case 'princess':
        this.emojiEl.textContent = '🐍';
        this.labelEl.textContent = 'TRỞ VỀ';
        this.hintEl.textContent = 'L1+R1 • Pad';
        this.rootEl.title =
          'Hóa lại thành Rắn Tiên (DualSense: L1+R1, Touchpad hoặc L2+R1 • Phím: T)';
        break;
      case 'transforming':
        this.emojiEl.textContent = '✨';
        this.labelEl.textContent = 'BIẾN…';
        this.hintEl.textContent = 'PHÉP MÀU';
        break;
      case 'returning':
        this.emojiEl.textContent = '✨';
        this.labelEl.textContent = 'HẠ CÁNH';
        this.hintEl.textContent = 'VỀ RẮN';
        break;
      default:
        this.emojiEl.textContent = '👸';
        this.labelEl.textContent = 'TIÊN NỮ';
        this.hintEl.textContent = 'L1+R1 • T';
        this.rootEl.title = available
          ? 'Hóa Tiên Nữ bay tham quan lâu đài (DualSense: L1+R1, L2+R1 hoặc L2+Touchpad • Phím: T)'
          : 'Chưa thể hóa Tiên Nữ lúc này (đang có quái vật, đang bay bướm hoặc đang hồi phép)';
        break;
    }
  }

  dispose(): void {
    this.rootEl.remove();
  }
}
