import type { Difficulty } from '../core/types';
import { ACHIEVEMENTS, loadUnlockedAchievements } from '../platform/achievements';
import {
  fetchLeaderboard,
  type LeaderboardEntry,
  type LeaderboardMode,
} from '../platform/leaderboard';
import { el } from './dom';

export interface StatsPanelHandlers {
  onVisibilityChange(open: boolean): void;
}

type Tab = LeaderboardMode | 'achievements';
const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'daily', label: 'Today' },
  { id: 'alltime', label: 'All-Time' },
  { id: 'achievements', label: 'Achievements' },
];
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** Modal: leaderboard (today + all-time) and achievements, tabbed. */
export class StatsPanel {
  private readonly panel: HTMLElement;
  private readonly body: HTMLElement;
  private readonly difficultySeg: HTMLElement;
  private readonly tabButtons = new Map<Tab, HTMLButtonElement>();
  private readonly difficultyButtons = new Map<Difficulty, HTMLButtonElement>();
  private activeTab: Tab = 'daily';
  private playerId = '';

  constructor(
    parent: HTMLElement,
    private activeDifficulty: Difficulty,
    private readonly handlers: StatsPanelHandlers,
  ) {
    const tabRow = el('div', { className: 'seg' });
    for (const tab of TABS) {
      const button = el('button', { text: tab.label }) as HTMLButtonElement;
      button.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.render();
      });
      this.tabButtons.set(tab.id, button);
      tabRow.appendChild(button);
    }

    this.difficultySeg = el('div', { className: 'seg' });
    for (const difficulty of DIFFICULTIES) {
      const button = el('button', { text: difficulty }) as HTMLButtonElement;
      button.addEventListener('click', () => {
        this.activeDifficulty = difficulty;
        this.render();
      });
      this.difficultyButtons.set(difficulty, button);
      this.difficultySeg.appendChild(button);
    }

    this.body = el('div', { id: 'stats-body' });
    const close = el('button', { className: 'close-btn', text: 'Close' });
    close.addEventListener('click', () => this.close());

    this.panel = el(
      'div',
      { id: 'stats-panel', className: 'hidden' },
      el('h2', { text: 'Stats' }),
      tabRow,
      this.difficultySeg,
      this.body,
      close,
    );
    parent.appendChild(this.panel);
  }

  open(playerId: string): void {
    this.playerId = playerId;
    this.panel.classList.remove('hidden');
    this.handlers.onVisibilityChange(true);
    this.render();
  }

  close(): void {
    this.panel.classList.add('hidden');
    this.handlers.onVisibilityChange(false);
  }

  private render(): void {
    for (const [id, button] of this.tabButtons)
      button.classList.toggle('active', id === this.activeTab);
    for (const [id, button] of this.difficultyButtons) {
      button.classList.toggle('active', id === this.activeDifficulty);
    }
    this.difficultySeg.style.display = this.activeTab === 'alltime' ? 'flex' : 'none';

    if (this.activeTab === 'achievements') {
      this.renderAchievements();
      return;
    }
    this.body.textContent = 'Loading…';
    void fetchLeaderboard(this.activeTab, this.activeDifficulty).then((entries) => {
      this.renderLeaderboard(entries);
    });
  }

  private renderLeaderboard(entries: LeaderboardEntry[] | null): void {
    this.body.textContent = '';
    if (!entries) {
      this.body.appendChild(
        el('div', { className: 'stats-empty', text: 'Leaderboard offline — play on!' }),
      );
      return;
    }
    if (entries.length === 0) {
      this.body.appendChild(
        el('div', { className: 'stats-empty', text: 'No scores yet — be the first!' }),
      );
      return;
    }
    for (const entry of entries) {
      const row = el(
        'div',
        { className: 'stats-row' },
        el('span', { className: 'stats-rank', text: `#${String(entry.rank)}` }),
        el('span', { className: 'stats-name', text: entry.nickname }),
        el('span', { className: 'stats-score', text: String(entry.score) }),
      );
      if (entry.playerId === this.playerId) row.classList.add('me');
      this.body.appendChild(row);
    }
  }

  private renderAchievements(): void {
    this.body.textContent = '';
    const unlocked = loadUnlockedAchievements();
    for (const def of ACHIEVEMENTS) {
      const isUnlocked = unlocked.has(def.id);
      const row = el(
        'div',
        { className: `achievement-row${isUnlocked ? ' unlocked' : ''}` },
        el('span', { className: 'achievement-name', text: def.name }),
        el('span', { className: 'achievement-desc', text: def.description }),
      );
      this.body.appendChild(row);
    }
  }
}
