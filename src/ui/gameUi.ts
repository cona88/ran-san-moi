import { ADVENTURE_REGIONS, CASTLE_ROYAL_SETS, DEFAULT_LANDMARKS } from '../core';
import { FORM_METADATA } from '../core/config';
import type {
  AgeProfile,
  BoosterKind,
  Difficulty,
  FairySkillKind,
  GameEvent,
  GameMode,
  GamePhase,
  GameState,
  SnakeForm,
  VisualTheme,
} from '../core/types';
import type { ControllerStatus } from '../input/controls';
import { AbsorbedPowerBanner } from './absorbedPower';
import { AchievementToast } from './achievementToast';
import { BoosterButtons } from './boosters';
import { BossBar } from './bossBar';
import { CastleInteriorUI } from './castleInteriorUi';
import { CrownRadarArrow } from './crownArrow';
import { el } from './dom';
import { FairySkillButtons } from './fairySkills';
import { HudBar } from './hud';
import { LeaderboardPanel } from './leaderboard';
import { MagicBar } from './magicBar';
import { GameOverlay } from './overlay';
import { ScorePopups } from './popups';
import { PrincessButton } from './princessButton';
import { QuestBanner } from './questBanner';
import { SurvivalFx, type WorldProjector } from './survivalFx';
import { themeLabelVi, type GameUICallbacks, type InitialUISettings } from './types';

export type ControlFeedbackKind =
  'steer' | 'shoot' | 'morph' | 'dash' | 'shield' | 'booster' | 'skill' | 'princess';

const BOOSTER_PILL_MAP: Readonly<Record<BoosterKind, string>> = {
  level: 'L3',
  speed: 'Create',
  magnet: 'R3',
};

const SKILL_PILLS_MAP: Readonly<Record<FairySkillKind, readonly string[]>> = {
  flower: ['□'],
  butterfly: ['R1'],
  thunder: ['L1'],
  fire: ['L2', '□'],
  water: ['L2', '○'],
  arcane: ['L2', '△'],
};

const SPRAY_HIT_POPUP: Readonly<
  Record<SnakeForm, { readonly label: string; readonly color: string }>
> = {
  dragon: { label: '🔥 Cháy Rực!', color: '#ff7043' },
  phoenix: { label: '❄️ Đóng Băng!', color: '#38f6ff' },
  unicorn: { label: '🌊 Xối Nước!', color: '#29d8ff' },
  spirit: { label: '🕸️ Trói Tơ!', color: '#4dff9a' },
};

function chompPopupStyle(streak: number, points: number): { label: string; color: string } {
  if (streak >= 8) {
    return { label: `ĐẠI TIỆC x${streak}! 👑`, color: '#ffd447' };
  }
  if (streak >= 5) {
    return { label: `Rốp rốp! x${streak} ⚡`, color: '#38f6ff' };
  }
  if (streak >= 3) {
    return { label: `Măm măm! x${streak} 🔥`, color: '#ff7ae0' };
  }
  return { label: `Ngoạm! +${points}`, color: '#ffe24b' };
}

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
  private readonly fairySkills: FairySkillButtons;
  private readonly princessButton: PrincessButton;
  private readonly castleInteriorUi: CastleInteriorUI;
  private readonly survivalFx: SurvivalFx;

  private readonly adventureCrestEl: HTMLElement;
  private readonly adventureCrestKicker: HTMLElement;
  private readonly adventureCrestTitle: HTMLElement;
  private readonly adventureCrestSub: HTMLElement;
  private adventureCrestTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLandmarkCrestTitle = '';
  private lastLandmarkCrestAtMs = -Infinity;

  private lastPhase: GamePhase | '' = '';
  private bestAtRunStart = 0;
  private wasControllerConnected = false;
  private lastButterflyKey = '';
  private lastEffectsKey = '';
  private lastFrostPopupMs = -Infinity;
  private readonly flashTimers = new Map<
    HTMLElement,
    { readonly cls: string; readonly timer: ReturnType<typeof setTimeout> }
  >();

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
    this.questBanner = new QuestBanner(this.topStackEl, callbacks);
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
    this.fairySkills = new FairySkillButtons(this.shellEl, callbacks);
    this.princessButton = new PrincessButton(this.shellEl, callbacks);
    this.castleInteriorUi = new CastleInteriorUI(this.shellEl, callbacks);
    this.survivalFx = new SurvivalFx(this.shellEl);

    this.adventureCrestKicker = el('span', { className: 'adventure-crest-kicker', text: '' });
    this.adventureCrestTitle = el('div', { className: 'adventure-crest-title', text: '' });
    this.adventureCrestSub = el('div', { className: 'adventure-crest-sub', text: '' });
    this.adventureCrestEl = el(
      'div',
      { id: 'adventure-crest', className: 'adventure-crest hidden' },
      el(
        'div',
        { className: 'adventure-crest-divider top' },
        el('span', { className: 'adventure-crest-line' }),
        this.adventureCrestKicker,
        el('span', { className: 'adventure-crest-line' }),
      ),
      this.adventureCrestTitle,
      this.adventureCrestSub,
      el(
        'div',
        { className: 'adventure-crest-divider bottom' },
        el('span', { className: 'adventure-crest-line' }),
        el('span', { className: 'adventure-crest-diamond', text: '◆' }),
        el('span', { className: 'adventure-crest-line' }),
      ),
    );
    this.adventureCrestEl.setAttribute('aria-hidden', 'true');
    this.shellEl.appendChild(this.adventureCrestEl);
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

  getSelectedAgeProfile(): AgeProfile {
    return this.overlay.getSelectedAgeProfile();
  }

  getOverlay(): GameOverlay {
    return this.overlay;
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
    this.fairySkills.syncState(state);
    this.princessButton.syncState(state);
    this.castleInteriorUi.syncState(state);
    this.survivalFx.syncState(state);

    const inCastleInterior = state.phase === 'playing' && state.castleInterior !== null;
    const isFlying = state.butterflyStage === 'butterfly' && state.phase === 'playing';
    const isSpraying = state.sprayActiveTicks > 0 && state.phase === 'playing';
    const effectsKey = `${isFlying ? 1 : 0}/${isSpraying ? 1 : 0}/${inCastleInterior ? 1 : 0}`;
    if (effectsKey !== this.lastEffectsKey) {
      this.lastEffectsKey = effectsKey;
      this.shellEl.classList.toggle('in-castle-interior', inCastleInterior);
      this.shellEl.classList.toggle('butterfly-flying', isFlying);
      this.shellEl.classList.toggle('spraying', isSpraying);
      const fairyDock = this.shellEl.querySelector<HTMLElement>('#fairy-skills');
      fairyDock?.classList.toggle('butterfly-flying', isFlying);
    }

    const butterflyKey = `${state.butterflyStage}/${state.butterflyCharge >= 100 ? 1 : 0}`;
    if (butterflyKey !== this.lastButterflyKey) {
      this.lastButterflyKey = butterflyKey;
      const butterflyBtn = this.shellEl.querySelector<HTMLElement>(
        '#fairy-skills [data-skill="butterfly"]',
      );
      if (butterflyBtn) {
        butterflyBtn.classList.toggle(
          'is-butterfly-ready',
          state.butterflyStage === 'caterpillar' && state.butterflyCharge >= 100,
        );
        butterflyBtn.classList.toggle('is-cocoon', state.butterflyStage === 'cocoon');
      }
    }

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
          this.hideAdventureCrest();
          this.overlay.showReady();
          break;
        case 'playing':
          this.overlay.hide();
          break;
        case 'paused':
          this.hideAdventureCrest();
          this.overlay.showPaused(state);
          break;
        case 'gameover': {
          this.hideAdventureCrest();
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

  /** Per-frame: edge arrows toward off-screen incoming fire (Thử Thách Sinh Tồn only). */
  updateSurvivalThreats(state: GameState, project: WorldProjector): void {
    this.survivalFx.updateThreats(state, project);
  }

  onEvent(event: GameEvent, state: GameState, screenPos: { x: number; y: number } | null): void {
    this.survivalFx.onEvent(event);
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
          const style = SPRAY_HIT_POPUP[event.form ?? state.form];
          this.popups.spawn(screenPos.x, screenPos.y, style.label, style.color);
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
          const style = SPRAY_HIT_POPUP[event.form ?? state.form];
          this.popups.spawn(screenPos.x, screenPos.y, style.label, style.color);
        }
        break;
      }

      case 'bot_chomp': {
        if (screenPos !== null) {
          const streak = Math.max(1, event.chompStreak ?? state.chompStreak);
          const pts = event.points ?? 12;
          const { label, color } = chompPopupStyle(streak, pts);
          this.popups.spawnChomp(screenPos.x, screenPos.y, label, color, streak);
        }
        break;
      }

      case 'bot_eaten': {
        const color = FORM_METADATA[event.form ?? state.form].cssColor;
        if (screenPos) {
          this.popups.spawnCelebration(
            screenPos.x,
            screenPos.y,
            `🐍 Chén gọn! +${event.points ?? 80}`,
            color,
          );
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
        const strongBotTip = (
          event.messageVi ?? 'Rắn mạnh hơn! Giữ Space/R2 phun phép giảm cấp nó trước nhé!'
        ).replace('Bắn đạn', 'Giữ Space/R2 phun phép');
        this.showToast('Cẩn thận Bot cấp cao!', strongBotTip, '⚠️');
        break;
      }

      case 'boss_spawn': {
        if (screenPos) {
          this.popups.spawnCelebration(screenPos.x, screenPos.y, '👹 BOSS XUẤT HIỆN!', '#ff5252');
        }
        const bossTip = event.messageVi
          ? `${event.messageVi} Giữ Space/R2 phun phép giảm cấp Boss nhé!`
          : 'Giữ Space/R2 phun Lửa/Băng/Nước/Tơ giảm cấp Boss rồi nuốt chửng nhé!';
        this.showToast('👹 ĐẠI VƯƠNG RỒNG XUẤT HIỆN!', bossTip, '👹');
        break;
      }

      case 'boss_defeated': {
        if (screenPos) {
          this.popups.spawnCelebration(
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
          this.popups.spawnCelebration(
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
          '🔍 Nhiệm Vụ Mới!',
          event.messageVi ?? state.quest?.promptVi ?? '',
          state.quest?.iconEmoji ?? '🧠',
        );
        break;
      }

      case 'quest_progress': {
        if (screenPos) {
          this.popups.spawnCelebration(
            screenPos.x,
            screenPos.y,
            event.messageVi ? `${event.messageVi} ⭐` : `⭐ +${event.points ?? 20}!`,
            '#4dff9a',
          );
        }
        break;
      }

      case 'quest_complete': {
        const pts = event.points ?? 100;
        const lvlLabel = event.messageVi?.match(/\+\d+\s*Cấp/)?.[0] ?? '+10 Cấp';
        if (screenPos) {
          this.popups.spawnCelebration(screenPos.x, screenPos.y, `🎉 ${lvlLabel}!`, '#4dff9a');
        }
        this.showToast(
          '🎉 Đúng Rồi!',
          event.messageVi ?? `${lvlLabel} • +${pts}⭐`,
          state.quest?.iconEmoji ?? '🌟',
        );
        break;
      }

      case 'quest_wrong': {
        this.questBanner.showHint(state.quest, event.messageVi);
        if (screenPos) {
          this.popups.spawn(screenPos.x, screenPos.y, '💡 Thử Lại!', '#ffb3e6');
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
          this.popups.spawnCelebration(screenPos.x, screenPos.y, '❤️ +1 Tim!', '#ff5ec4');
        }
        // Repeated shelter regen heals are quiet (popup only) so toasts never spam.
        if (event.messageVi || !state.currentShelterId) {
          this.showToast(
            'Tim Phép Thuật!',
            event.messageVi ?? 'Thưởng +1 Tim phép thuật! 💖',
            '💖',
          );
        }
        break;
      }

      case 'level_up': {
        if (screenPos) {
          this.popups.spawnCelebration(
            screenPos.x,
            screenPos.y,
            `👑 Cấp ${state.level}!`,
            '#ffd447',
          );
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

      case 'flower_bloom': {
        if (screenPos) {
          this.popups.spawnCelebration(screenPos.x, screenPos.y, '🌸 Nở Hoa!', '#ff7ac6');
        }
        break;
      }

      case 'flower_charm': {
        if (screenPos) {
          this.popups.spawnCelebration(screenPos.x, screenPos.y, '✨ Quyến Rũ!', '#ffd447');
        }
        break;
      }

      case 'cocoon_start': {
        if (screenPos) {
          this.popups.spawnCelebration(screenPos.x, screenPos.y, '🥚 Kén Pha Lê!', '#ff9de6');
        }
        this.showToast('Kén Pha Lê Bao Bọc!', 'Chuẩn bị hoá bướm tiên!', '🥚');
        break;
      }

      case 'butterfly_emerge': {
        this.lastFrostPopupMs = performance.now();
        if (screenPos) {
          this.popups.spawnCelebration(
            screenPos.x,
            screenPos.y,
            '🦋 Bướm Hồng Băng Giá!',
            '#ff6ec7',
          );
        }
        this.showToast(
          '🦋 Bướm Hồng Băng Giá!',
          'Cánh bướm hồng tỏa sáng & thả mưa băng đóng băng mọi thứ!',
          '🦋',
        );
        break;
      }

      case 'butterfly_frost': {
        const now = performance.now();
        if (screenPos && now - this.lastFrostPopupMs >= 1600) {
          this.lastFrostPopupMs = now;
          this.popups.spawnFrost(screenPos.x, screenPos.y, '❄️ Băng Rơi!');
        }
        break;
      }

      case 'sky_thunder': {
        if (screenPos) {
          this.popups.spawnCelebration(screenPos.x, screenPos.y, '⚡ Sấm Sét!', '#5cf6ff');
        }
        this.showToast('Sấm Sét Phép Thuật!', 'Tia chớp chiếu sáng bầu trời!', '⚡');
        break;
      }

      case 'butterfly_land': {
        if (screenPos) {
          this.popups.spawnCelebration(screenPos.x, screenPos.y, '🦋 Đáp Xuống!', '#5cf6ff');
        }
        break;
      }

      case 'aoe_fire': {
        if (screenPos) {
          this.popups.spawnCelebration(screenPos.x, screenPos.y, '🔥 Phun Lửa AoE!', '#ff6e42');
        }
        this.showToast('Phun Lửa 360°!', 'Ngọn lửa rồng quét sạch xung quanh!', '🔥');
        break;
      }

      case 'aoe_water': {
        if (screenPos) {
          this.popups.spawnCelebration(screenPos.x, screenPos.y, '🌊 Sóng Thần AoE!', '#1ee3ff');
        }
        this.showToast('Sóng Thần Thủy Triều!', 'Xoáy nước 360° cuốn trôi đối thủ!', '🌊');
        break;
      }

      case 'aoe_arcane': {
        if (screenPos) {
          this.popups.spawnCelebration(screenPos.x, screenPos.y, '🔮 Ma Thuật AoE!', '#d96bff');
        }
        this.showToast('Bùng Nổ Ma Thuật!', 'Ánh sao siêu tân tinh tỏa sáng 360°!', '🔮');
        break;
      }

      case 'fairy_visit_start': {
        const fairy = state.guardianFairy;
        if (screenPos && fairy) {
          this.popups.spawnCelebration(
            screenPos.x,
            screenPos.y,
            `✨ ${fairy.emoji} ${fairy.nameVi}!`,
            '#ff85c0',
          );
        }
        if (fairy) {
          this.showToast(
            `${fairy.emoji} ${fairy.nameVi} Ghé Thăm!`,
            `${fairy.blessingVi} • Bảo vệ bé suốt hành trình ✨`,
            fairy.emoji,
          );
        }
        break;
      }

      case 'fairy_blessing': {
        if (screenPos) {
          this.popups.spawnCelebration(screenPos.x, screenPos.y, '✨ Phép Tiên!', '#ffe66d');
        }
        break;
      }

      case 'fairy_visit_end': {
        if (screenPos) {
          this.popups.spawn(screenPos.x, screenPos.y, '💖 Hẹn gặp lại!', '#ffc2e8');
        }
        break;
      }

      case 'princess_transform': {
        if (screenPos) {
          this.popups.spawnCelebration(screenPos.x, screenPos.y, '🌟 Biến Hình!', '#ff9de6');
        }
        break;
      }

      case 'princess_reveal': {
        if (screenPos) {
          this.popups.spawnCelebration(screenPos.x, screenPos.y, '👸 Tiên Nữ Xinh Đẹp!', '#ffd447');
        }
        this.showToast(
          '👸 Tiên Nữ Xinh Đẹp!',
          'Bay tới gần lâu đài, thả tay lái để Tiên Nữ tự bay vòng tham quan ✨',
          '👸',
        );
        break;
      }

      case 'princess_return': {
        if (screenPos) {
          this.popups.spawn(screenPos.x, screenPos.y, '🐍 Trở về Rắn Tiên', '#d9b8ff');
        }
        if (event.messageVi?.startsWith('⚠️')) {
          this.showToast('Tiên Nữ hạ cánh!', event.messageVi, '⚠️');
        }
        break;
      }

      case 'princess_tour_start': {
        const shelter = state.shelters.find((s) => s.id === event.shelterId);
        this.showToast(
          '🏰 Tham Quan Lâu Đài!',
          shelter
            ? `Tiên Nữ đang bay vòng quanh ${shelter.nameVi} ✨`
            : 'Tiên Nữ đang tham quan ✨',
          '👸',
        );
        break;
      }

      case 'princess_tour_lap': {
        if (screenPos) {
          this.popups.spawnCelebration(
            screenPos.x,
            screenPos.y,
            `🎀 Vòng Tham Quan +${event.points ?? 100}!`,
            '#ffd447',
          );
        }
        break;
      }

      case 'region_discovered': {
        const reg = event.regionId ? ADVENTURE_REGIONS[event.regionId] : null;
        if (screenPos) {
          this.popups.spawn(
            screenPos.x,
            screenPos.y,
            reg ? `${reg.icon} Vùng Đất Mới!` : '🗺️ Vùng Đất Mới!',
            '#7ef8ff',
          );
        }
        this.showToast(
          '🗺️ Vùng Đất Mới!',
          event.messageVi ??
            (reg ? `🗺️ Khám phá vùng đất mới: ${reg.nameVi}! ✨` : 'Khám phá vùng đất mới! ✨'),
          '🧭',
        );
        if (state.phase === 'playing') {
          this.showAdventureCrest(
            'region',
            '✦ VÙNG ĐẤT MỚI ✦',
            reg?.nameVi ?? '🗺️ Vùng Đất Huyền Thoại',
            'Khám phá vùng đất mới của Vương Quốc ✨',
          );
        }
        break;
      }

      case 'landmark_discovered': {
        const landmarks = state.landmarks ?? DEFAULT_LANDMARKS;
        const lm = event.landmarkId ? landmarks.find((l) => l.id === event.landmarkId) : null;
        const pts = event.points ?? 200;
        const lmTitle = lm?.nameVi ?? '🌟 Kỳ Quan Khổng Lồ';
        if (screenPos) {
          this.popups.spawnCelebration(screenPos.x, screenPos.y, `+${pts} ✨`, '#ffd447');
        }
        this.showToast(
          '🌟 Khám Phá Kỳ Quan!',
          event.messageVi ?? `✨ Khám phá ${lmTitle}! (+${pts}đ) 🌟`,
          '🏛️',
        );
        if (state.phase === 'playing') {
          this.lastLandmarkCrestTitle = lmTitle;
          this.lastLandmarkCrestAtMs = performance.now();
          this.showAdventureCrest(
            'landmark',
            '✦ KỲ QUAN HUYỀN THOẠI ✦',
            lmTitle,
            `+${pts}đ • Hồi đầy Lướt ✨`,
          );
        }
        break;
      }

      case 'chapter_complete': {
        const ch = event.chapter ?? state.adventureChapter;
        const pts = event.points ?? 250;
        if (screenPos) {
          this.popups.spawnCelebration(
            screenPos.x,
            screenPos.y,
            `🌈 Chương ${ch}! +${pts} ✨`,
            '#ffd447',
          );
        }
        this.showToast(
          '👑 Hoàn Thành Chương Phiêu Lưu!',
          event.messageVi ?? 'Chúc mừng bé chinh phục cột mốc phiêu lưu mới! 🏆',
          '🏆',
        );
        if (state.phase === 'playing') {
          const sameTickAsLandmark =
            this.lastLandmarkCrestTitle.length > 0 &&
            performance.now() - this.lastLandmarkCrestAtMs < 120;
          if (sameTickAsLandmark) {
            this.showAdventureCrest(
              'chapter',
              `✦ KỲ QUAN HUYỀN THOẠI • CHƯƠNG ${ch} ✦`,
              this.lastLandmarkCrestTitle,
              `+200đ • Hồi đầy Lướt • Hoàn thành Chương ${ch} (+${pts}đ) 🏆`,
            );
          } else {
            const chapterHeadline =
              event.messageVi?.replace(/^[^C]*?(Chương\s+\d+:[^!(]+).*$/u, '$1').trim() ||
              `Chương ${ch}: Huyền Thoại Vương Quốc`;
            this.showAdventureCrest(
              'chapter',
              '✦ HOÀN THÀNH CHƯƠNG ✦',
              `👑 ${chapterHeadline}`,
              `+${pts}đ • +15 XP 🏆`,
            );
          }
        }
        break;
      }

      case 'castle_enter_interior': {
        const interior = state.castleInterior;
        const set = interior ? CASTLE_ROYAL_SETS[interior.shelterKind] : null;
        this.showToast(
          interior?.shelterNameVi ?? '🏰 Chào Mừng Vào Lâu Đài!',
          event.messageVi ?? set?.interiorSubtitleVi ?? 'Khám phá Tủ Đồ Hoàng Gia lộng lẫy ✨',
          set?.outfitEmoji ?? '🏰',
        );
        break;
      }

      case 'castle_exit_interior': {
        this.showToast(
          '🚪 Quay Ra Vương Quốc!',
          event.messageVi ?? 'Trang phục & vũ khí hoàng gia vẫn đồng hành cùng bé ✨',
          '🌟',
        );
        break;
      }

      case 'castle_item_equipped': {
        const kind = event.shelterKind ?? null;
        const set = kind ? CASTLE_ROYAL_SETS[kind] : null;
        const slot = event.cosmeticSlot ?? 'outfit';
        const label =
          set === null
            ? '✨ Về Mặc Định'
            : slot === 'outfit'
              ? `${set.outfitEmoji} ${set.outfitNameVi}`
              : slot === 'makeup'
                ? `${set.makeupEmoji} ${set.makeupNameVi}`
                : `${set.weaponEmoji} ${set.weaponNameVi}`;
        if (screenPos) {
          this.popups.spawnCelebration(screenPos.x, screenPos.y, label, '#ffd447');
        }
        this.showToast(
          '✨ Thay Đồ Hoàng Gia!',
          event.messageVi ?? `${label} lấp lánh tuyệt đẹp!`,
          set?.outfitEmoji ?? '👑',
        );
        break;
      }
    }
  }

  /** Trigger crisp HUD / DualSense button-press highlight feedback across controls. */
  flashControlFeedback(kind: ControlFeedbackKind, detail?: string): void {
    switch (kind) {
      case 'steer':
        this.hud.flashControllerPill('🕹️');
        break;
      case 'shoot':
        this.magicBar.flashSpray(detail as SnakeForm | undefined);
        this.hud.flashControllerPill('R2');
        break;
      case 'morph':
        this.magicBar.flashForm(detail as SnakeForm | undefined);
        this.hud.flashControllerPill('△');
        break;
      case 'dash':
        this.magicBar.flashDash();
        this.hud.flashControllerPill('✕');
        break;
      case 'shield':
        this.magicBar.flashShield();
        this.hud.flashShieldPill();
        this.hud.flashControllerPill('○');
        break;
      case 'booster': {
        const booster = detail as BoosterKind | undefined;
        if (booster) {
          this.flashSelector(`#booster-buttons [data-booster="${booster}"]`, 'just-triggered', 360);
          this.hud.flashControllerPill(BOOSTER_PILL_MAP[booster]);
        }
        break;
      }
      case 'skill': {
        const skill = detail as FairySkillKind | undefined;
        if (skill) {
          this.flashSelector(`#fairy-skills [data-skill="${skill}"]`, 'just-pressed', 340);
          for (const pillLabel of SKILL_PILLS_MAP[skill]) {
            this.hud.flashControllerPill(pillLabel);
          }
        }
        break;
      }
      case 'princess':
        this.flashSelector('#princess-btn', 'just-pressed', 380);
        this.hud.flashControllerPill('L1');
        this.hud.flashControllerPill('R1');
        break;
    }
  }

  showToast(title: string, subtitle: string, icon = '✨'): void {
    this.toasts.showToast(title, subtitle, icon);
  }

  /** Sync visual active glow on the HUD Panoramic Vista (`🔭`) button. */
  setPanoramicActive(active: boolean): void {
    this.hud.setPanoramicActive(active);
  }

  private showAdventureCrest(
    variant: 'region' | 'landmark' | 'chapter',
    kicker: string,
    title: string,
    subtitle: string,
  ): void {
    if (this.adventureCrestTimer !== null) {
      clearTimeout(this.adventureCrestTimer);
      this.adventureCrestTimer = null;
    }
    this.adventureCrestKicker.textContent = kicker;
    this.adventureCrestTitle.textContent = title;
    this.adventureCrestSub.textContent = subtitle;
    this.adventureCrestEl.classList.remove(
      'hidden',
      'crest-region',
      'crest-landmark',
      'crest-chapter',
      'crest-active',
    );
    this.adventureCrestEl.classList.add(`crest-${variant}`);
    void this.adventureCrestEl.offsetWidth;
    this.adventureCrestEl.classList.add('crest-active');

    this.adventureCrestTimer = setTimeout(() => {
      this.hideAdventureCrest();
    }, 2600);
  }

  private hideAdventureCrest(): void {
    if (this.adventureCrestTimer !== null) {
      clearTimeout(this.adventureCrestTimer);
      this.adventureCrestTimer = null;
    }
    this.adventureCrestEl.classList.remove('crest-active');
    this.adventureCrestEl.classList.add('hidden');
  }

  dispose(): void {
    this.hideAdventureCrest();
    for (const entry of this.flashTimers.values()) {
      clearTimeout(entry.timer);
    }
    this.flashTimers.clear();
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
    this.fairySkills.dispose();
    this.princessButton.dispose();
    this.castleInteriorUi.dispose();
    this.survivalFx.dispose();
    this.adventureCrestEl.remove();
    this.topStackEl.remove();
    this.shellEl.remove();
  }

  private flashSelector(selector: string, className: string, durationMs: number): void {
    const node = this.shellEl.querySelector<HTMLElement>(selector);
    if (!node) return;
    const prev = this.flashTimers.get(node);
    if (prev) {
      clearTimeout(prev.timer);
      node.classList.remove(prev.cls);
    }
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
    const timer = setTimeout(() => {
      node.classList.remove(className);
      this.flashTimers.delete(node);
    }, durationMs);
    this.flashTimers.set(node, { cls: className, timer });
  }

  private applyTheme(theme: VisualTheme): void {
    document.documentElement.dataset['theme'] = theme;
    this.shellEl.dataset['theme'] = theme;
  }
}
