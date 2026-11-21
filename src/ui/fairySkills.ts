import type { FairySkillKind, GameState } from '../core/types';
import { el } from './dom';
import type { GameUICallbacks } from './types';

interface SkillDef {
  readonly skill: FairySkillKind;
  readonly emoji: string;
  readonly label: string;
  readonly color: string;
}

const SKILL_DEFS: readonly SkillDef[] = [
  { skill: 'flower', emoji: '🌸', label: 'HOA', color: '#ff7ac6' },
  { skill: 'butterfly', emoji: '🦋', label: 'GIỮ', color: '#ff6ec7' },
  { skill: 'thunder', emoji: '⚡', label: 'SÉT', color: '#5cf6ff' },
  { skill: 'fire', emoji: '🔥', label: 'LỬA', color: '#ff6e42' },
  { skill: 'water', emoji: '🌊', label: 'NƯỚC', color: '#1ee3ff' },
  { skill: 'arcane', emoji: '🔮', label: 'PHÉP', color: '#d96bff' },
];

/**
 * Left-edge compact 2×3 Fairy Magic candy dock. Visible only during 'playing' phase.
 */
export class FairySkillButtons {
  private readonly rootEl: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly cleanupHoldListeners: () => void;
  private readonly releaseButterflyHold: () => void;
  private visible = false;
  private holdingButterfly = false;
  private activeButterflyPointerId: number | null = null;

  constructor(parent: HTMLElement, callbacks: GameUICallbacks) {
    this.rootEl = el('aside', { id: 'fairy-skills', className: 'fairy-skills hidden' });
    let butterflyBtnEl: HTMLButtonElement | null = null;

    for (const def of SKILL_DEFS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'fairy-skill-btn';
      btn.dataset['skill'] = def.skill;
      btn.title =
        def.skill === 'butterfly'
          ? 'Giữ để hóa Bướm Hồng Băng Giá & thả mưa băng (giữ nút, B hoặc R1)'
          : `${def.label} (${def.emoji})`;
      btn.innerHTML = `<span class="fairy-skill-emoji">${def.emoji}</span><span class="fairy-skill-label">${def.label}</span>`;
      if (def.skill === 'butterfly') {
        butterflyBtnEl = btn;
        btn.setAttribute('aria-label', 'Giữ để hóa Bướm Hồng Băng Giá');
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (callbacks.onButterflyHold) return;
          callbacks.onCastFairySkill(def.skill);
        });
      } else {
        btn.addEventListener('click', () => {
          callbacks.onCastFairySkill(def.skill);
        });
      }
      this.buttons.push(btn);
      this.rootEl.appendChild(btn);
    }

    const endHold = (pointerId?: number, force = false): void => {
      if (
        !force &&
        pointerId !== undefined &&
        this.activeButterflyPointerId !== null &&
        pointerId !== this.activeButterflyPointerId
      ) {
        return;
      }
      if (butterflyBtnEl && pointerId !== undefined) {
        try {
          if (
            typeof butterflyBtnEl.hasPointerCapture === 'function' &&
            butterflyBtnEl.hasPointerCapture(pointerId)
          ) {
            butterflyBtnEl.releasePointerCapture(pointerId);
          }
        } catch {
          // Ignore when pointer capture was already released.
        }
      }
      this.activeButterflyPointerId = null;
      if (!this.holdingButterfly) return;
      this.holdingButterfly = false;
      butterflyBtnEl?.classList.remove('is-holding');
      callbacks.onButterflyHold?.(false);
    };

    this.releaseButterflyHold = () => endHold(undefined, true);

    if (butterflyBtnEl) {
      const onPointerDown = (e: PointerEvent): void => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        if (typeof butterflyBtnEl.setPointerCapture === 'function') {
          try {
            butterflyBtnEl.setPointerCapture(e.pointerId);
          } catch {
            // Synthetic PointerEvent in tests may not have an active pointerId.
          }
        }
        this.activeButterflyPointerId = e.pointerId;
        if (!this.holdingButterfly) {
          this.holdingButterfly = true;
          butterflyBtnEl.classList.add('is-holding');
          callbacks.onButterflyHold?.(true);
        }
      };

      const onPointerEnd = (e: PointerEvent): void => {
        e.stopPropagation();
        endHold(e.pointerId);
      };

      const onLostCapture = (): void => {
        endHold(undefined, true);
      };

      const onWindowBlur = (): void => {
        endHold(undefined, true);
      };

      const onWindowPointerEnd = (e: PointerEvent): void => {
        if (this.holdingButterfly) {
          endHold(e.pointerId);
        }
      };

      butterflyBtnEl.addEventListener('pointerdown', onPointerDown);
      butterflyBtnEl.addEventListener('pointerup', onPointerEnd);
      butterflyBtnEl.addEventListener('pointercancel', onPointerEnd);
      butterflyBtnEl.addEventListener('lostpointercapture', onLostCapture);
      window.addEventListener('pointerup', onWindowPointerEnd);
      window.addEventListener('pointercancel', onWindowPointerEnd);
      window.addEventListener('blur', onWindowBlur);

      this.cleanupHoldListeners = () => {
        butterflyBtnEl.removeEventListener('pointerdown', onPointerDown);
        butterflyBtnEl.removeEventListener('pointerup', onPointerEnd);
        butterflyBtnEl.removeEventListener('pointercancel', onPointerEnd);
        butterflyBtnEl.removeEventListener('lostpointercapture', onLostCapture);
        window.removeEventListener('pointerup', onWindowPointerEnd);
        window.removeEventListener('pointercancel', onWindowPointerEnd);
        window.removeEventListener('blur', onWindowBlur);
      };
    } else {
      this.cleanupHoldListeners = () => {};
    }

    parent.appendChild(this.rootEl);
  }

  syncState(state: GameState): void {
    const shouldShow = state.phase === 'playing';
    if (!shouldShow && this.holdingButterfly) {
      this.releaseButterflyHold();
    }
    if (shouldShow !== this.visible) {
      this.visible = shouldShow;
      this.rootEl.classList.toggle('hidden', !shouldShow);
    }

    // Update butterfly button emoji, label & aerial hold state
    const butterflyBtn = this.buttons[1];
    if (butterflyBtn) {
      const emoji = butterflyBtn.querySelector('.fairy-skill-emoji');
      const label = butterflyBtn.querySelector('.fairy-skill-label');
      const isFlying = state.butterflyStage === 'butterfly';
      const isHolding = this.holdingButterfly || (shouldShow && state.butterflyHold);
      if (emoji && label) {
        if (state.butterflyStage === 'caterpillar') {
          emoji.textContent = '🦋';
          label.textContent = 'GIỮ';
        } else if (state.butterflyStage === 'cocoon') {
          emoji.textContent = '🥚';
          label.textContent = 'KÉN';
        } else if (state.butterflyHold || this.holdingButterfly) {
          emoji.textContent = '🦋';
          label.textContent = 'BAY';
        } else {
          emoji.textContent = '🦋↓';
          label.textContent = 'ĐÁP';
        }
      }
      butterflyBtn.classList.toggle('is-active', isFlying);
      butterflyBtn.classList.toggle('is-flying', isFlying);
      butterflyBtn.classList.toggle('is-holding', isHolding);
      butterflyBtn.classList.toggle('is-landing', state.butterflyLanding);
      butterflyBtn.setAttribute('aria-pressed', String(isHolding || isFlying));
    }

    // Update cooldown states
    this.buttons[0]?.classList.toggle('is-cooldown', state.flowerCooldownTicks > 0);
    this.buttons[2]?.classList.toggle('is-cooldown', state.thunderCooldownTicks > 0);
    this.buttons[3]?.classList.toggle('is-cooldown', state.fireCooldownTicks > 0);
    this.buttons[4]?.classList.toggle('is-cooldown', state.waterCooldownTicks > 0);
    this.buttons[5]?.classList.toggle('is-cooldown', state.arcaneCooldownTicks > 0);
  }

  dispose(): void {
    this.releaseButterflyHold();
    this.cleanupHoldListeners();
    this.rootEl.remove();
  }
}
