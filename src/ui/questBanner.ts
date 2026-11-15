import type { BrainQuest, GameState, QuestKind } from '../core/types';
import { el } from './dom';

const QUEST_KIND_LABELS: Record<QuestKind, string> = {
  math: '🧠 Toán Thần Tốc',
  element_match: '🔮 Biến Hình Phép Thuật',
  sequence: '⭐ Thứ Tự Ánh Sao',
};

/**
 * Floating top-center Smart Quest card shown inside `#top-hud-stack` whenever a
 * {@link BrainQuest} is active during gameplay. Highlights the `+10 Cấp` level
 * reward, time progress bar, sequence steps, and gentle encouraging hints.
 */
export class QuestBanner {
  private readonly rootEl: HTMLElement;
  private readonly kindBadge: HTMLElement;
  private readonly rewardBadge: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly sequenceRow: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly hintEl: HTMLElement;

  private lastQuestId = -1;
  private lastTicks = -1;
  private lastNextSeq = -1;
  private lastVisible = false;
  private hintActiveForQuestId = -1;

  constructor(parent: HTMLElement) {
    this.kindBadge = el('span', { className: 'quest-kind-badge' });
    this.rewardBadge = el('span', { className: 'quest-reward-badge' });
    this.promptEl = el('div', { className: 'quest-prompt' });
    this.sequenceRow = el('div', { className: 'quest-sequence-row' });
    this.progressFill = el('div', { className: 'quest-progress-fill' });
    this.hintEl = el('div', { className: 'quest-hint hidden' });

    const header = el('div', { className: 'quest-header' }, this.kindBadge, this.rewardBadge);
    const progressTrack = el('div', { className: 'quest-progress-track' }, this.progressFill);

    this.rootEl = el(
      'section',
      { id: 'quest-banner', className: 'hidden', ariaLabel: 'Nhiệm vụ thông minh' },
      header,
      this.promptEl,
      this.sequenceRow,
      progressTrack,
      this.hintEl,
    );
    parent.appendChild(this.rootEl);
  }

  syncState(state: GameState): void {
    const quest = state.phase === 'playing' ? state.quest : null;
    if (!quest) {
      if (this.lastVisible) {
        this.rootEl.classList.add('hidden');
        this.hintEl.classList.add('hidden');
        this.lastVisible = false;
        this.lastQuestId = -1;
        this.hintActiveForQuestId = -1;
      }
      return;
    }

    if (!this.lastVisible) {
      this.rootEl.classList.remove('hidden');
      this.lastVisible = true;
    }

    if (quest.id !== this.lastQuestId) {
      this.lastQuestId = quest.id;
      this.hintActiveForQuestId = -1;
      this.hintEl.classList.add('hidden');
      this.kindBadge.textContent = QUEST_KIND_LABELS[quest.kind];
      const levelText = quest.rewardLevels > 0 ? `+${quest.rewardLevels} Cấp • ` : '';
      this.rewardBadge.textContent = `🎁 ${levelText}+${quest.rewardScore}đ`;
      this.promptEl.textContent = quest.promptVi;
      this.lastNextSeq = -1;
    }

    if (quest.kind === 'sequence') {
      this.sequenceRow.style.display = 'flex';
      if (quest.nextSequenceIndex !== this.lastNextSeq) {
        this.lastNextSeq = quest.nextSequenceIndex;
        this.renderSequenceSteps(quest);
      }
    } else {
      this.sequenceRow.style.display = 'none';
    }

    if (quest.ticksRemaining !== this.lastTicks) {
      this.lastTicks = quest.ticksRemaining;
      const ratio =
        quest.maxTicks > 0 ? Math.max(0, Math.min(1, quest.ticksRemaining / quest.maxTicks)) : 0;
      this.progressFill.style.width = `${(ratio * 100).toFixed(1)}%`;
      this.rootEl.classList.toggle('urgent', ratio < 0.28);
    }
  }

  showHint(quest: BrainQuest | null, customMessage?: string): void {
    if (!quest) return;
    const text = customMessage ?? quest.hintVi;
    if (!text) return;
    this.hintActiveForQuestId = quest.id;
    this.hintEl.textContent = `💡 ${text}`;
    this.hintEl.classList.remove('hidden', 'nudge');
    // Force reflow so the gentle nudge animation replays on repeated hints
    void this.hintEl.offsetWidth;
    this.hintEl.classList.add('nudge');
  }

  hasActiveHint(questId: number): boolean {
    return this.hintActiveForQuestId === questId;
  }

  dispose(): void {
    this.rootEl.remove();
  }

  private renderSequenceSteps(quest: BrainQuest): void {
    this.sequenceRow.textContent = '';
    for (const step of [1, 2, 3]) {
      const done = step < quest.nextSequenceIndex;
      const current = step === quest.nextSequenceIndex;
      const pill = el('span', {
        className: `quest-seq-step${done ? ' done' : current ? ' current' : ''}`,
        text: done ? `✓ ${step}` : String(step),
      });
      this.sequenceRow.appendChild(pill);
    }
  }
}
