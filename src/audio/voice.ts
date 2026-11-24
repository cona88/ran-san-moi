import type { BrainQuest, GameEvent, GameState } from '../core/types';

/**
 * Offline Vietnamese voice helper using the browser-native
 * `window.speechSynthesis` API — 100% offline, ZERO network requests.
 *
 * Gracefully degrades in headless/test environments where `speechSynthesis`
 * or `SpeechSynthesisUtterance` is unavailable.
 */
export class VoiceHelper {
  private enabled = true;
  private lastDodgeHintMs = -Infinity;

  /** Feature-check: is speech synthesis available at all? */
  private get supported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      typeof SpeechSynthesisUtterance !== 'undefined'
    );
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.cancel();
    }
  }

  speak(text: string): void {
    if (!this.enabled || !this.supported || !text.trim()) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'vi-VN';
      utterance.rate = 1.0;
      utterance.pitch = 1.1;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Silently ignore — never block or throw
    }
  }

  cancel(): void {
    if (!this.supported) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Silently ignore
    }
  }

  /** React to game events to speak contextual Vietnamese audio. */
  onEvent(event: GameEvent, state: GameState): void {
    if (!this.enabled || !this.supported) return;

    switch (event.kind) {
      case 'quest_spawn':
        this.speak(state.quest?.speechVi ?? state.quest?.promptVi ?? '');
        break;
      case 'quest_progress':
        if (state.quest?.kind === 'word_spell' && event.messageVi) {
          this.speak(event.messageVi);
        }
        break;
      case 'quest_complete': {
        const reward = state.quest?.rewardIconVi;
        const praise = reward && reward.length < 20 ? `Giỏi quá! ${reward}` : 'Giỏi quá!';
        this.speak(praise);
        break;
      }
      case 'butterfly_emerge':
        this.speak('Hóa Bướm Tiên!');
        break;
      case 'sky_thunder':
        this.speak('Sấm Sét!');
        break;
      case 'butterfly_land':
        this.speak('Đáp xuống!');
        break;
      case 'butterfly_frost':
        // Intentionally silent in TTS — frost chimes emit continuously while flying
        break;
      case 'aoe_fire':
        this.speak('Phun Lửa!');
        break;
      case 'aoe_water':
        this.speak('Phun Nước!');
        break;
      case 'aoe_arcane':
        this.speak('Bùng Nổ Ma Thuật!');
        break;
      case 'fairy_visit_start':
        this.speak(event.messageVi ?? 'Nàng Tiên ghé thăm bảo vệ bé!');
        break;
      case 'shelter_discovered':
        this.speak('Khám phá lâu đài tuyệt đẹp!');
        break;
      case 'princess_reveal':
        this.speak('Biến hình! Tiên nữ xinh đẹp!');
        break;
      case 'princess_tour_start': {
        const shelter = state.shelters?.find((s) => s.id === event.shelterId);
        const name = shelter ? shelter.nameVi.replace(/^\S+\s/u, '') : 'lâu đài';
        this.speak(`Tham quan ${name}`);
        break;
      }
      case 'player_hit_by_magic': {
        // Encouraging, rate-limited so it never nags the player.
        const nowMs = Date.now();
        if (nowMs - this.lastDodgeHintMs > 9000) {
          this.lastDodgeHintMs = nowMs;
          this.speak(event.spell === 'frost_orb' ? 'Lạnh quá! Cố lên!' : 'Né đạn đi!');
        }
        break;
      }
      default:
        break;
    }
  }

  /** Speak the current quest prompt on demand (🔊 replay button). */
  speakQuest(quest: BrainQuest | null): void {
    if (!quest) return;
    this.speak(quest.speechVi ?? quest.promptVi);
  }
}
