import { el } from './dom';

export interface ToolbarHandlers {
  onLeaderboardClick(): void;
  onSettingsClick(): void;
}

/** Persistent top bar: score / best read-outs plus leaderboard + settings triggers. */
export class Toolbar {
  private readonly scoreValue: HTMLElement;
  private readonly bestValue: HTMLElement;

  constructor(root: HTMLElement, handlers: ToolbarHandlers) {
    this.scoreValue = el('div', { className: 'value', text: '0' });
    this.bestValue = el('div', { className: 'value', text: '0' });

    const score = el(
      'div',
      { id: 'score' },
      el('div', { className: 'stat', text: 'Score' }),
      this.scoreValue,
    );
    const best = el(
      'div',
      { id: 'best' },
      el('div', { className: 'stat', text: 'Best' }),
      this.bestValue,
    );

    const leaderboardBtn = el('button', { className: 'icon-btn', text: '🏆' });
    leaderboardBtn.setAttribute('aria-label', 'Leaderboard');
    leaderboardBtn.addEventListener('click', () => handlers.onLeaderboardClick());

    const settingsBtn = el('button', { className: 'icon-btn', text: '⚙' });
    settingsBtn.setAttribute('aria-label', 'Settings');
    settingsBtn.addEventListener('click', () => handlers.onSettingsClick());

    const icons = el('div', { className: 'toolbar-icons' }, leaderboardBtn, settingsBtn);

    root.appendChild(el('div', { id: 'toolbar' }, score, icons, best));
  }

  setScore(score: number): void {
    this.scoreValue.textContent = String(score);
  }

  setBest(best: number): void {
    this.bestValue.textContent = String(best);
  }
}
