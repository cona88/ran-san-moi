import { el } from './dom';

const INSTRUCTIONS_HTML =
  'Use <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to move<br>' +
  'Eat the orbs and grow — avoid the walls and yourself<br>' +
  'Press <kbd>P</kbd> to pause';

/**
 * The full-screen overlay shown on the ready, paused and game-over screens.
 * A click anywhere triggers the primary action (start / restart).
 */
export class Overlay {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly subtitleEl: HTMLElement;
  private readonly instructionsEl: HTMLElement;
  private readonly finalScoreEl: HTMLElement;
  private readonly ctaEl: HTMLElement;

  constructor(parent: HTMLElement, onPrimary: () => void) {
    this.titleEl = el('div', { className: 'title', text: 'NEON SNAKE' });
    this.subtitleEl = el('div', { className: 'subtitle', text: '3D' });
    this.instructionsEl = el('div', {
      id: 'instructions',
      className: 'panel',
      html: INSTRUCTIONS_HTML,
    });
    this.finalScoreEl = el('div', { id: 'finalScore' });
    this.finalScoreEl.style.display = 'none';
    this.ctaEl = el('div', { id: 'cta', className: 'cta', text: 'Press SPACE to start' });

    this.root = el(
      'div',
      { id: 'overlay' },
      this.titleEl,
      this.subtitleEl,
      this.instructionsEl,
      this.finalScoreEl,
      this.ctaEl,
    );
    this.root.addEventListener('click', onPrimary);
    parent.appendChild(this.root);
  }

  showReady(): void {
    this.setScreen({ title: 'NEON SNAKE', subtitle: true, instructions: true });
    this.finalScoreEl.style.display = 'none';
    this.ctaEl.textContent = 'Press SPACE to start';
    this.reveal();
  }

  showPaused(): void {
    this.setScreen({ title: 'PAUSED', subtitle: false, instructions: false });
    this.finalScoreEl.style.display = 'none';
    this.ctaEl.textContent = 'Press P to resume';
    this.reveal();
  }

  showGameOver(score: number, isNewBest: boolean, isWin: boolean): void {
    this.setScreen({
      title: isWin ? 'YOU WIN' : 'GAME OVER',
      subtitle: false,
      instructions: false,
    });
    const plural = score === 1 ? '' : 's';
    const banner = isWin
      ? '<div class="newbest">★ YOU FILLED THE BOARD ★</div>'
      : isNewBest
        ? '<div class="newbest">★ NEW RECORD ★</div>'
        : '';
    this.finalScoreEl.innerHTML = `You scored <b>${String(score)}</b> point${plural}${banner}`;
    this.finalScoreEl.style.display = 'block';
    this.ctaEl.textContent = 'Press SPACE to play again';
    this.reveal();
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  private setScreen(opts: { title: string; subtitle: boolean; instructions: boolean }): void {
    this.titleEl.textContent = opts.title;
    this.subtitleEl.style.display = opts.subtitle ? '' : 'none';
    this.instructionsEl.style.display = opts.instructions ? '' : 'none';
  }

  private reveal(): void {
    this.root.classList.remove('hidden');
  }
}
