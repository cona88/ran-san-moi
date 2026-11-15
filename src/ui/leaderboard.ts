import type { GameState } from '../core/types';
import { el } from './dom';

function formatOrdinalRank(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

/**
 * Top-right rounded live Leaderboard panel (Snake Clash! style).
 * Highlights rank #1 with a golden crown and highlights the player's own row
 * in a vivid indigo-violet pill so it is recognizable at a glance.
 */
export class LeaderboardPanel {
  private readonly rootEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private lastKey = '';

  constructor(parent: HTMLElement) {
    const headerEl = el('div', { className: 'lb-header', text: '🏆 Bảng Xếp Hạng' });
    this.listEl = el('div', { className: 'lb-list' });
    this.rootEl = el(
      'aside',
      { id: 'leaderboard-panel', ariaLabel: 'Bảng xếp hạng trực tiếp' },
      headerEl,
      this.listEl,
    );
    parent.appendChild(this.rootEl);
  }

  syncState(state: GameState): void {
    const key = state.leaderboard
      .map(
        (e) => `${e.id}:${e.rank}:${e.name}:${e.level}:${e.isPlayer ? 1 : 0}:${e.isBoss ? 1 : 0}`,
      )
      .join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.listEl.textContent = '';
    for (let i = 0; i < state.leaderboard.length; i++) {
      const entry = state.leaderboard[i];
      if (!entry) continue;

      const prev = i > 0 ? state.leaderboard[i - 1] : undefined;
      const hasGap = prev !== undefined && entry.rank - prev.rank > 1;

      const classes = ['lb-row'];
      if (entry.rank === 1) classes.push('is-first');
      if (entry.isPlayer) classes.push('is-player');
      if (entry.isBoss) classes.push('is-boss');
      if (hasGap) classes.push('has-gap');

      const rankText =
        entry.rank === 1 ? `👑 ${formatOrdinalRank(entry.rank)}` : formatOrdinalRank(entry.rank);
      const nameText = entry.isBoss ? `👹 ${entry.name}` : entry.name;

      const row = el(
        'div',
        { className: classes.join(' ') },
        el('span', { className: 'lb-rank', text: rankText }),
        el('span', { className: 'lb-name', text: nameText, title: entry.name }),
        el('span', { className: 'lb-level', text: String(entry.level) }),
      );
      this.listEl.appendChild(row);
    }
  }

  dispose(): void {
    this.rootEl.remove();
  }
}
