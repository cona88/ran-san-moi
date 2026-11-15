import type { GameState } from '../core/types';
import { el } from './dom';

const SHOW_ARROW_DISTANCE = 8;

function createArrowSvg(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('crown-arrow-svg');

  const path = document.createElementNS(ns, 'path');
  path.setAttribute(
    'd',
    'M4 12h11.5l-4.2-4.2a1.2 1.2 0 0 1 1.7-1.7l6.3 6.3a1.2 1.2 0 0 1 0 1.7l-6.3 6.3a1.2 1.2 0 1 1-1.7-1.7l4.2-4.2H4a1.25 1.25 0 0 1 0-2.5z',
  );
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

/**
 * Bottom-right Crown Radar badge:
 * - Points toward `state.crownTarget` (#1 Bot or active Boss) when further than 8 units.
 * - Celebrates `👑 Bé Đang Hạng 1!` when the player holds #1 with no Boss active.
 */
export class CrownRadarArrow {
  private readonly rootEl: HTMLElement;
  private readonly crownEl: HTMLElement;
  private readonly arrowWrapEl: HTMLElement;
  private readonly textEl: HTMLElement;

  private lastKey = '';

  constructor(parent: HTMLElement) {
    this.crownEl = el('span', { className: 'crown-radar-icon', text: '👑' });
    this.arrowWrapEl = el('span', { className: 'crown-radar-arrow' }, createArrowSvg());
    this.textEl = el('span', { className: 'crown-radar-text', text: '' });

    this.rootEl = el(
      'div',
      {
        id: 'crown-radar',
        className: 'hidden',
        ariaLabel: 'La bàn chỉ hướng Vương Miện và Boss',
      },
      this.crownEl,
      this.arrowWrapEl,
      this.textEl,
    );
    parent.appendChild(this.rootEl);
  }

  syncState(state: GameState): void {
    if (state.phase !== 'playing') {
      if (this.lastKey !== 'hidden') {
        this.lastKey = 'hidden';
        this.rootEl.classList.add('hidden');
      }
      return;
    }

    const target = state.crownTarget;
    const head = state.snake[0];

    if (target !== null && head !== undefined) {
      const dx = target.x - head.x;
      const dz = target.z - head.z;
      const dist = Math.hypot(dx, dz);

      if (dist > SHOW_ARROW_DISTANCE) {
        const angleRad = Math.atan2(dz, dx);
        const angleRounded = Number(angleRad.toFixed(2));
        const distRounded = Math.round(dist);
        const isBoss = state.activeBossId !== null;
        const key = `target|${isBoss ? 1 : 0}|${angleRounded}|${distRounded}`;

        if (key !== this.lastKey) {
          this.lastKey = key;
          this.rootEl.classList.remove('hidden', 'rank-first');
          this.rootEl.classList.add('has-target');
          this.rootEl.classList.toggle('boss-target', isBoss);
          this.crownEl.classList.remove('hidden');
          this.arrowWrapEl.classList.remove('hidden');
          this.arrowWrapEl.style.transform = `rotate(${angleRad.toFixed(3)}rad)`;
          this.crownEl.textContent = isBoss ? '👹' : '👑';
          this.textEl.textContent = isBoss ? `Boss • ${distRounded}m` : `Top 1 • ${distRounded}m`;
        }
        return;
      }

      if (this.lastKey !== 'hidden') {
        this.lastKey = 'hidden';
        this.rootEl.classList.add('hidden');
      }
      return;
    }

    if (state.playerRank === 1 && state.activeBossId === null) {
      if (this.lastKey !== 'rank1') {
        this.lastKey = 'rank1';
        this.rootEl.classList.remove('hidden', 'has-target', 'boss-target');
        this.rootEl.classList.add('rank-first');
        this.crownEl.classList.add('hidden');
        this.arrowWrapEl.classList.add('hidden');
        this.textEl.textContent = '👑 Bé Đang Hạng 1!';
      }
      return;
    }

    if (this.lastKey !== 'hidden') {
      this.lastKey = 'hidden';
      this.rootEl.classList.add('hidden');
    }
  }

  dispose(): void {
    this.rootEl.remove();
  }
}
