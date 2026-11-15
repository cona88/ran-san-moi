import { FORM_METADATA } from '../core/config';
import type {
  Difficulty,
  GameEvent,
  GameMode,
  GamePhase,
  GameState,
  VisualTheme,
} from '../core/types';
import type { ControllerStatus } from '../input/controls';
import { AbsorbedPowerBanner } from './absorbedPower';
import { AchievementToast } from './achievementToast';
import { BoosterButtons } from './boosters';
import { BossBar } from './bossBar';
import { CrownRadarArrow } from './crownArrow';
import { el } from './dom';
import { HudBar } from './hud';
import { LeaderboardPanel } from './leaderboard';
import { MagicBar } from './magicBar';
import { GameOverlay } from './overlay';
import { ScorePopups } from './popups';
import { QuestBanner } from './questBanner';
import { themeLabelVi, type GameUICallbacks, type InitialUISettings } from './types';

/**
 * Top-level UI facade connecting the Snake-Clash-style BossBar, AbsorbedPower
 * badge, Smart Quest Banner, corner HUD & Live Leaderboard, 3 circular
 * Boosters, Crown Radar Arrow, Magic Bar, phase overlays, floating score
 * popups, and celebratory toasts.
 */
export class GameUI {
  private readonly shellEl: HTMLElement;
  private readonly topStackEl: HTMLElement;
  private readonly hud: HudBar;
  private readonly bossBar: BossBar;
  private readonly absorbedPower: AbsorbedPowerBanner;
  private readonly questBanner: QuestBanner;
  private readonly leaderboard: LeaderboardPanel;
  private readonly boosters: BoosterButtons;
  private readonly crownArrow: CrownRadarArrow;
  private readonly magicBar: MagicBar;
  private readonly overlay: GameOverlay;
  private readonly popups: ScorePopups;
  private readonly toasts: AchievementToast;

  private lastPhase: GamePhase | '' = '';
  private bestAtRunStart = 0;
  private wasControllerConnected = false;

  constructor(uiRoot: HTMLElement, callbacks: GameUICallbacks, initialSettings: InitialUISettings) {
    this.shellEl = el('div', { className: 'magic-ui-shell' });
    this.topStackEl = el('div', { id: 'top-hud-stack' });

    this.hud = new HudBar(this.shellEl, callbacks, initialSettings, {
      onWebHidResult: (ok) => {
        if (ok) {
          this.showToast(
            'Đèn LED DualSense đã bật!',
            'Màu đèn tay cầm sẽ tự đổi theo hình dạng phép thuật ✨',
            '💡',
          );
        } else {
          this.showToast(
            'Chưa bật được Đèn LED',
            'Bé hãy cắm cáp USB-C hoặc chọn DualSense trong Chrome nhé (chơi vẫn mượt bình thường!).',
            '🎮',
          );
        }
      },
      onThemeChanged: (theme) => {
        this.applyTheme(theme);
        this.overlay.setTheme(theme);
        this.showToast('Đổi thế giới 3D!', themeLabelVi(theme), '🎨');
      },
    });

    this.shellEl.appendChild(this.topStackEl);
    uiRoot.appendChild(this.shellEl);
    this.applyTheme(initialSettings.theme);

    this.bossBar = new BossBar(this.topStackEl);
    this.absorbedPower = new AbsorbedPowerBanner(this.topStackEl);
    this.questBanner = new QuestBanner(this.topStackEl);
    this.leaderboard = new LeaderboardPanel(this.hud.getRightDock());
    this.boosters = new BoosterButtons(this.shellEl, callbacks);
    this.crownArrow = new CrownRadarArrow(this.shellEl);
    this.magicBar = new MagicBar(this.shellEl, callbacks);

    this.overlay = new GameOverlay(this.shellEl, callbacks, initialSettings, {
      onThemeChanged: (theme) => {
        this.applyTheme(theme);
        this.hud.setTheme(theme);
      },
    });

    this.popups = new ScorePopups(uiRoot);
    this.toasts = new AchievementToast(uiRoot);
  }

  getSelectedMode(): GameMode {
    return this.overlay.getSelectedMode();
  }

  getSelectedDifficulty(): Difficulty {
    return this.overlay.getSelectedDifficulty();
  }

  getSelectedPlayerName(): string {
    return this.overlay.getSelectedPlayerName();
  }

  syncState(state: GameState): void {
    this.hud.syncState(state);
    this.bossBar.syncState(state);
    this.absorbedPower.syncState(state);
    this.questBanner.syncState(state);
    this.leaderboard.syncState(state);
    this.boosters.syncState(state);
    this.crownArrow.syncState(state);
    this.magicBar.syncState(state);

    if (state.phase !== this.lastPhase) {
      if (
        state.phase === 'playing' &&
        (this.lastPhase === 'ready' || this.lastPhase === 'gameover' || this.lastPhase === '')
      ) {
        this.bestAtRunStart = state.best;
      }
      this.lastPhase = state.phase;

      switch (state.phase) {
        case 'ready':
          this.overlay.showReady();
          break;
        case 'playing':
          this.overlay.hide();
          break;
        case 'paused':
          this.overlay.showPaused(state);
          break;
        case 'gameover': {
          const isNewBest = state.score > 0 && state.score > this.bestAtRunStart;
          this.overlay.showGameOver(state, isNewBest);
          break;
        }
      }
    }
  }

  syncController(status: ControllerStatus): void {
    this.hud.syncController(status);
    this.overlay.syncController(status);

    if (!this.wasControllerConnected && status.connected) {
      this.wasControllerConnected = true;
      this.showToast(
        'Tay cầm đã kết nối!',
        status.isDualSense
          ? 'DualSense đã sẵn sàng phiêu lưu cùng bé ✨'
          : `${status.controllerName || 'Tay cầm'} đã sẵn sàng!`,
        '🎮',
      );
    } else if (this.wasControllerConnected && !status.connected) {
      this.wasControllerConnected = false;
    }
  }

  onEvent(event: GameEvent, state: GameState, screenPos: { x: number; y: number } | null): void {
    switch (event.kind) {
      case 'eat_food': {
        if (screenPos) {
          const pts = event.points ?? 10;
          const label = state.combo >= 3 ? `+${pts} 🔥` : `+${pts}`;
          const color = state.combo >= 3 ? '#ff9ce6' : '#ffe24b';
          this.popups.spawn(screenPos.x, screenPos.y, label, color);
        }
        break;
      }

      case 'eat_bonus': {
        if (screenPos) {
          this.popups.spawn(screenPos.x, screenPos.y, `⭐ +${event.points ?? 30}!`, '#ffd447');
        }
        break;
      }

      case 'morph': {
        const meta = FORM_METADATA[event.form ?? state.form];
        if (screenPos) {
          this.popups.spawn(screenPos.x, screenPos.y, meta.nameVi, meta.cssColor);
        }
        break;
      }

      case 'shield_activate': {
        if (screenPos) {
          this.popups.spawn(screenPos.x, screenPos.y, '🫧 Khiên Bật!', '#38f6ff');
        }
        break;
      }

      case 'shield_block': {
        if (screenPos) {
          this.popups.spawn(screenPos.x, screenPos.y, '🛡️ Khiên Chặn!', '#38f6ff');
        }
        this.showToast(
          'Khiên Bong Bóng bảo vệ!',
          event.messageVi ?? 'Khiên đã che chở bé an toàn!',
          '🛡️',
        );
        break;
      }

      case 'hazard_hit': {
        if (event.messageVi) {
          this.showToast('Mẹo phép thuật!', event.messageVi, '🔮');
        }
        if (screenPos) {
          if (event.form === 'phoenix') {
            this.popups.spawn(screenPos.x, screenPos.y, '❄️ Băng Giá!', '#38f6ff');
          } else {
            this.popups.spawn(screenPos.x, screenPos.y, '💥 Trúng!', '#ffd447');
          }
        }
        break;
      }

      case 'hazard_destroyed': {
        if (screenPos) {
          this.popups.spawn(screenPos.x, screenPos.y, `+${event.points ?? 20} ✨`, '#4dff9a');
        }
        if (event.messageVi) {
          this.showToast('Siêu Phép Thuật!', event.messageVi, '✨');
        }
        break;
      }

      case 'bot_hit': {
        if (screenPos) {
          this.popups.spawn(
            screenPos.x,
            screenPos.y,
            event.messageVi ?? '💥 Hạ cấp Bot!',
            '#ff9f43',
          );
        }
        break;
      }

      case 'bot_eaten': {
        const color = FORM_METADATA[event.form ?? state.form].cssColor;
        if (screenPos) {
          this.popups.spawn(screenPos.x, screenPos.y, `🐍 Chén gọn! +${event.points ?? 80}`, color);
        }
        this.showToast(
          'Hấp thụ sức mạnh Bot!',
          event.messageVi ?? 'Bé vừa nuốt chửng rắn Bot và lên cấp!',
          '🐍',
        );
        break;
      }

      case 'eaten_by_bot': {
        if (screenPos) {
          this.popups.spawn(screenPos.x, screenPos.y, '⚠️ Rắn mạnh hơn!', '#ff6b8b');
        }
        this.showToast(
          'Cẩn thận Bot cấp cao!',
          event.messageVi ?? 'Rắn mạnh hơn! Bắn đạn giảm cấp nó trước nhé!',
          '⚠️',
        );
        break;
      }

      case 'boss_spawn': {
        if (screenPos) {
          this.popups.spawn(screenPos.x, screenPos.y, '👹 BOSS XUẤT HIỆN!', '#ff5252');
        }
        this.showToast(
          '👹 ĐẠI VƯƠNG RỒNG XUẤT HIỆN!',
          event.messageVi ?? 'Bắn đạn giảm cấp Boss rồi nuốt chửng nhé!',
          '👹',
        );
        break;
      }

      case 'boss_defeated': {
        if (screenPos) {
          this.popups.spawn(
            screenPos.x,
            screenPos.y,
            `👑 HẠ BOSS +${event.points ?? 500}!`,
            '#ffd447',
          );
        }
        this.showToast(
          'Chiến Công Hiển Hách!',
          event.messageVi ?? '👑 Hạ gục Boss Đại Vương Rồng! +15 Cấp!',
          '👑',
        );
        break;
      }

      case 'booster_activate': {
        if (screenPos) {
          this.popups.spawn(
            screenPos.x,
            screenPos.y,
            event.messageVi ?? '⚡ Siêu Năng Lượng!',
            '#56f0ff',
          );
        }
        this.showToast(
          'Kích Hoạt Phép Thuật!',
          event.messageVi ?? 'Booster đã bùng nổ sức mạnh!',
          '⚡',
        );
        break;
      }

      case 'quest_spawn': {
        this.showToast(
          'Nhiệm vụ thông minh mới!',
          event.messageVi ?? state.quest?.promptVi ?? '',
          '🧠',
        );
        break;
      }

      case 'quest_progress': {
        if (screenPos) {
          this.popups.spawn(screenPos.x, screenPos.y, `⭐ +${event.points ?? 20}!`, '#4dff9a');
        }
        break;
      }

      case 'quest_complete': {
        const pts = event.points ?? 100;
        const lvlLabel = event.messageVi?.match(/\+\d+\s*Cấp/)?.[0] ?? '+10 Cấp';
        if (screenPos) {
          this.popups.spawn(screenPos.x, screenPos.y, `Giải Đố ${lvlLabel}!`, '#4dff9a');
        }
        this.showToast(
          'Tuyệt vời! Bé giải đúng rồi!',
          event.messageVi ?? `${lvlLabel} & +${pts} điểm thưởng 🌟`,
          '🌟',
        );
        break;
      }

      case 'quest_wrong': {
        this.questBanner.showHint(state.quest, event.messageVi);
        if (screenPos) {
          this.popups.spawn(screenPos.x, screenPos.y, '💡 Thử viên khác nhé!', '#ffb3e6');
        }
        break;
      }

      case 'heart_lost': {
        if (screenPos) {
          this.popups.spawn(screenPos.x, screenPos.y, '💔 -1 Tim', '#ff7597');
        }
        this.showToast(
          'Ôi cẩn thận nhé!',
          event.messageVi ?? `Bé còn ${state.hearts} tim 💖`,
          '💖',
        );
        break;
      }

      case 'heart_gained': {
        if (screenPos) {
          this.popups.spawn(screenPos.x, screenPos.y, '❤️ +1 Tim!', '#ff5ec4');
        }
        this.showToast('Tim Phép Thuật!', event.messageVi ?? 'Thưởng +1 Tim phép thuật! 💖', '💖');
        break;
      }

      case 'level_up': {
        if (screenPos) {
          this.popups.spawn(screenPos.x, screenPos.y, `👑 Cấp ${state.level}!`, '#ffd447');
        }
        this.showToast(
          'Lên Cấp Mới!',
          event.messageVi ?? `Chúc mừng! Bé lên Cấp ${state.level}! 🎉`,
          '👑',
        );
        break;
      }

      case 'shoot':
      case 'dash':
      case 'gameover':
        break;
    }
  }

  showToast(title: string, subtitle: string, icon = '✨'): void {
    this.toasts.showToast(title, subtitle, icon);
  }

  dispose(): void {
    this.hud.dispose();
    this.bossBar.dispose();
    this.absorbedPower.dispose();
    this.questBanner.dispose();
    this.leaderboard.dispose();
    this.boosters.dispose();
    this.crownArrow.dispose();
    this.magicBar.dispose();
    this.overlay.dispose();
    this.popups.dispose();
    this.toasts.dispose();
    this.topStackEl.remove();
    this.shellEl.remove();
  }

  private applyTheme(theme: VisualTheme): void {
    document.documentElement.dataset['theme'] = theme;
    this.shellEl.dataset['theme'] = theme;
  }
}
