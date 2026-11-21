import type { BrainQuest, GameState, QuestKind } from '../core/types';
import { el } from './dom';
import type { GameUICallbacks } from './types';

const KIND_BADGES: Record<QuestKind, string> = {
  letter_match: '🔤 Tìm Chữ',
  word_spell: '📝 Ghép Từ',
  math: '🧮 Toán Nhanh',
  element_match: '🔮 Biến Hình',
  sequence: '⭐ Thứ Tự',
};

/**
 * Floating top-center Smart Quest card shown inside `#top-hud-stack` whenever a
 * {@link BrainQuest} is active during gameplay. Highlights the `+10 Cấp` level
 * reward, time progress bar, letter tiles, and gentle encouraging hints.
 */
export class QuestBanner {
  private readonly rootEl: HTMLElement;
  private readonly leftCol: HTMLElement;
  private readonly iconEl: HTMLElement;
  private readonly speakBtn: HTMLButtonElement;
  private readonly centerCol: HTMLElement;
  private readonly letterSlotsRow: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly rewardBadge: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly hintEl: HTMLElement;

  private lastQuestId = -1;
  private lastTicks = -1;
  private lastNextSeq = -1;
  private lastVisible = false;
  private hintActiveForQuestId = -1;

  constructor(
    parent: HTMLElement,
    private readonly callbacks: GameUICallbacks,
  ) {
    // Left: icon + speak button
    this.iconEl = el('span', { className: 'quest-icon-emoji' });
    this.speakBtn = el('button', {
      className: 'quest-speak-btn',
      type: 'button',
      text: '🔊',
      ariaLabel: 'Nghe lại nhiệm vụ',
    });
    this.speakBtn.addEventListener('click', () => {
      this.callbacks.onSpeakQuest?.();
    });
    this.leftCol = el('div', { className: 'quest-left' }, this.iconEl, this.speakBtn);

    // Center: letter slots OR prompt text
    this.letterSlotsRow = el('div', { className: 'quest-letter-slots' });
    this.promptEl = el('div', { className: 'quest-prompt' });
    this.centerCol = el('div', { className: 'quest-center' }, this.letterSlotsRow, this.promptEl);

    // Right: reward badge
    this.rewardBadge = el('span', { className: 'quest-reward-badge' });

    const header = el(
      'div',
      { className: 'quest-header' },
      this.leftCol,
      this.centerCol,
      el('div', { className: 'quest-right' }, el('span', { text: '➔' }), this.rewardBadge),
    );

    this.progressFill = el('div', { className: 'quest-progress-fill' });
    this.hintEl = el('div', { className: 'quest-hint hidden' });

    const progressTrack = el('div', { className: 'quest-progress-track' }, this.progressFill);

    this.rootEl = el(
      'section',
      { id: 'quest-banner', className: 'hidden', ariaLabel: 'Nhiệm vụ thông minh' },
      header,
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

      // Icon
      this.iconEl.textContent = quest.iconEmoji ?? KIND_BADGES[quest.kind].charAt(0);

      // Reward badge: must contain `+10 Cấp`
      const levelText = quest.rewardLevels > 0 ? `+${quest.rewardLevels} Cấp` : '';
      this.rewardBadge.textContent = `${quest.rewardIconVi ? quest.rewardIconVi + ' ' : ''}${levelText}`;

      this.lastNextSeq = -1;

      // Decide whether to show letter slots or prompt text
      if (quest.wordSlots && quest.wordSlots.length > 0) {
        this.letterSlotsRow.style.display = 'flex';
        this.promptEl.style.display = 'none';
        this.renderLetterSlots(quest);
      } else {
        this.letterSlotsRow.style.display = 'none';
        this.promptEl.style.display = 'block';
        this.promptEl.textContent = quest.promptVi;
      }
    }

    // Update letter slots on progress
    if (
      quest.wordSlots &&
      quest.wordSlots.length > 0 &&
      quest.nextSequenceIndex !== this.lastNextSeq
    ) {
      this.lastNextSeq = quest.nextSequenceIndex;
      this.renderLetterSlots(quest);
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

  private renderLetterSlots(quest: BrainQuest): void {
    this.letterSlotsRow.textContent = '';
    if (!quest.wordSlots) return;

    for (let idx = 0; idx < quest.wordSlots.length; idx++) {
      const letter = quest.wordSlots[idx]!;
      const seqOrder = idx + 1; // sequenceOrder is 1-based

      let slotClass = 'quest-letter-slot';
      let slotText = letter;

      if (quest.kind === 'letter_match') {
        // For letter_match: single slot, always active
        slotClass += ' active';
      } else {
        // For word_spell: done / active / waiting
        if (seqOrder < quest.nextSequenceIndex) {
          slotClass += ' done';
          slotText = `✓ ${letter}`;
        } else if (seqOrder === quest.nextSequenceIndex) {
          slotClass += ' active';
        }
      }

      const slot = el('span', { className: slotClass, text: slotText });
      this.letterSlotsRow.appendChild(slot);
    }
  }
}
