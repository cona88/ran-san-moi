import type { Difficulty } from '../core/types';
import type { Settings } from '../platform/storage';
import { loadOrCreateNickname, saveNickname } from '../platform/storage';
import { el } from './dom';

export interface SettingsHandlers {
  /** Fired whenever sound or difficulty changes. */
  onChange(settings: Settings): void;
  /** Fired when the panel opens (true) or closes (false). */
  onVisibilityChange(open: boolean): void;
}

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** Gear button plus the modal settings panel (sound toggle + difficulty). */
export class SettingsPanel {
  private settings: Settings;
  private readonly panel: HTMLElement;
  private readonly soundToggle: HTMLButtonElement;
  private readonly difficultyButtons = new Map<Difficulty, HTMLButtonElement>();

  constructor(
    parent: HTMLElement,
    initial: Settings,
    private readonly handlers: SettingsHandlers,
  ) {
    this.settings = initial;

    this.soundToggle = el('button', { className: 'toggle' }) as HTMLButtonElement;
    this.soundToggle.addEventListener('click', () => {
      this.update({ sound: !this.settings.sound });
    });

    const seg = el('div', { className: 'seg' });
    for (const difficulty of DIFFICULTIES) {
      const button = el('button', { text: difficulty }) as HTMLButtonElement;
      button.addEventListener('click', () => this.update({ difficulty }));
      this.difficultyButtons.set(difficulty, button);
      seg.appendChild(button);
    }

    const nicknameInput = el('input', { className: 'nickname-input' }) as HTMLInputElement;
    nicknameInput.type = 'text';
    nicknameInput.maxLength = 16;
    nicknameInput.value = loadOrCreateNickname();
    nicknameInput.addEventListener('change', () => {
      const trimmed = nicknameInput.value.trim() || loadOrCreateNickname();
      nicknameInput.value = trimmed;
      saveNickname(trimmed);
    });

    const close = el('button', { className: 'close-btn', text: 'Close' });
    close.addEventListener('click', () => this.close());

    this.panel = el(
      'div',
      { id: 'settings-panel', className: 'hidden' },
      el('h2', { text: 'Settings' }),
      el('div', { className: 'setting-row' }, el('label', { text: 'Sound' }), this.soundToggle),
      el('div', { className: 'setting-row' }, el('label', { text: 'Difficulty' }), seg),
      el('div', { className: 'setting-row' }, el('label', { text: 'Nickname' }), nicknameInput),
      close,
    );

    parent.appendChild(this.panel);
    this.render();
  }

  open(): void {
    this.panel.classList.remove('hidden');
    this.handlers.onVisibilityChange(true);
  }

  close(): void {
    this.panel.classList.add('hidden');
    this.handlers.onVisibilityChange(false);
  }

  private update(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    this.render();
    this.handlers.onChange(this.settings);
  }

  private render(): void {
    this.soundToggle.textContent = this.settings.sound ? 'On' : 'Off';
    this.soundToggle.classList.toggle('on', this.settings.sound);
    for (const [difficulty, button] of this.difficultyButtons) {
      button.classList.toggle('active', difficulty === this.settings.difficulty);
    }
  }
}
