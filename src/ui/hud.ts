import { el } from './dom';

/** Score / best read-out in the top corners. */
export class Hud {
  private readonly scoreValue: HTMLElement;
  private readonly bestValue: HTMLElement;

  constructor(root: HTMLElement) {
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

    root.appendChild(el('div', { id: 'hud' }, score, best));
  }

  setScore(score: number): void {
    this.scoreValue.textContent = String(score);
  }

  setBest(best: number): void {
    this.bestValue.textContent = String(best);
  }
}
