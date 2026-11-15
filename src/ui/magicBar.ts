import { FORM_METADATA } from '../core/config';
import { SNAKE_FORMS, type GameState, type SnakeForm } from '../core/types';
import { el } from './dom';
import type { GameUICallbacks } from './types';

const FORM_SHORT_NAMES: Record<SnakeForm, string> = {
  dragon: 'Rồng',
  phoenix: 'Phượng Hoàng',
  unicorn: 'Kỳ Lân',
  spirit: 'Tinh Linh',
};

const FORM_WEAPON_SHORT: Record<SnakeForm, string> = {
  dragon: 'Đạn Sao Băng',
  phoenix: 'Sóng Băng 3 Tia',
  unicorn: 'Tia Chớp Tự Tìm',
  spirit: 'Bom Hoa Nở',
};

/**
 * Compact bottom translucent dock containing the 4 clickable magical snake form
 * cards (`🌸 Rồng`, `🦋 Phượng Hoàng`, `⚡ Kỳ Lân`, `🍀 Tinh Linh`), the Dash
 * energy bar, and Bubble Shield (`○`) status.
 */
export class MagicBar {
  private readonly rootEl: HTMLElement;
  private readonly formButtons = new Map<SnakeForm, HTMLButtonElement>();
  private readonly dashFill: HTMLElement;
  private readonly dashValue: HTMLElement;
  private readonly dashBox: HTMLElement;
  private readonly shieldBox: HTMLElement;
  private readonly shieldText: HTMLElement;

  private lastForm: SnakeForm | null = null;
  private lastDashKey = '';
  private lastShieldKey = '';

  constructor(
    parent: HTMLElement,
    private readonly callbacks: GameUICallbacks,
  ) {
    const cardsRow = el('div', { className: 'magic-forms-row' });

    SNAKE_FORMS.forEach((form, index) => {
      const meta = FORM_METADATA[form];
      const keyLabel = `${index + 1}`;
      const btn = el(
        'button',
        {
          className: 'magic-form-card',
          type: 'button',
          title: `${meta.nameVi} — ${meta.weaponNameVi}: ${meta.perkVi}`,
          ariaLabel: `Biến hình ${meta.nameVi} (${meta.weaponNameVi})`,
        },
        el('span', { className: 'form-key-badge', text: keyLabel }),
        el('span', { className: 'form-emoji', text: meta.emoji }),
        el(
          'div',
          { className: 'form-info' },
          el('div', { className: 'form-name', text: FORM_SHORT_NAMES[form] }),
          el('div', { className: 'form-weapon', text: FORM_WEAPON_SHORT[form] }),
        ),
      );
      btn.style.setProperty('--form-color', meta.cssColor);
      btn.addEventListener('click', () => {
        this.callbacks.onSelectForm(form);
      });
      this.formButtons.set(form, btn);
      cardsRow.appendChild(btn);
    });

    // Dash Energy + Shield Status Meter
    this.dashValue = el('span', { className: 'meter-value', text: '100%' });
    this.dashFill = el('div', { className: 'dash-energy-fill' });
    this.dashFill.style.width = '100%';
    this.dashBox = el(
      'div',
      {
        className: 'magic-meter dash-meter',
        title: 'Giữ ✕ / L2 (hoặc Shift) để Lướt Nhanh',
      },
      el(
        'div',
        { className: 'meter-top' },
        el('span', { className: 'meter-label', text: '💨 Lướt (✕ / L2)' }),
        this.dashValue,
      ),
      el('div', { className: 'dash-energy-track' }, this.dashFill),
    );

    this.shieldText = el('span', { className: 'shield-status-text', text: 'Sẵn sàng' });
    this.shieldBox = el(
      'div',
      {
        className: 'magic-meter shield-meter ready',
        title: 'Nhấn ○ (hoặc phím F) để bật Khiên Bong Bóng bảo vệ',
      },
      el('span', { className: 'meter-label', text: '🫧 Khiên (○)' }),
      this.shieldText,
    );

    const metersCol = el('div', { className: 'magic-meters-col' }, this.dashBox, this.shieldBox);
    const mainRow = el('div', { className: 'magic-main-row' }, cardsRow, metersCol);

    this.rootEl = el('footer', { id: 'magic-bar' }, mainRow);
    parent.appendChild(this.rootEl);
  }

  syncState(state: GameState): void {
    if (state.form !== this.lastForm) {
      this.lastForm = state.form;
      for (const [form, btn] of this.formButtons) {
        const active = form === state.form;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
      }
    }

    const energyRounded = Math.round(state.dashEnergy);
    const dashKey = `${energyRounded}/${state.isDashing ? 1 : 0}`;
    if (dashKey !== this.lastDashKey) {
      this.lastDashKey = dashKey;
      this.dashFill.style.width = `${Math.max(0, Math.min(100, energyRounded))}%`;
      this.dashValue.textContent = `${energyRounded}%`;
      this.dashBox.classList.toggle('dashing', state.isDashing);
    }

    const shieldKey = `${state.shieldTicks}/${state.shieldCooldownTicks}`;
    if (shieldKey !== this.lastShieldKey) {
      this.lastShieldKey = shieldKey;
      this.shieldBox.classList.remove('active', 'cooldown', 'ready');
      if (state.shieldTicks > 0) {
        this.shieldBox.classList.add('active');
        this.shieldText.textContent = `Bật (${state.shieldTicks})`;
      } else if (state.shieldCooldownTicks > 0) {
        this.shieldBox.classList.add('cooldown');
        this.shieldText.textContent = `Hồi (${state.shieldCooldownTicks})`;
      } else {
        this.shieldBox.classList.add('ready');
        this.shieldText.textContent = 'Sẵn sàng ✨';
      }
    }
  }

  dispose(): void {
    this.rootEl.remove();
  }
}
