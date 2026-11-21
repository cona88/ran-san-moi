import { DEFAULT_SESSION_DURATION_MS, FORM_METADATA } from '../core/config';
import type {
  AgeProfile,
  GameConfig,
  GameState,
  ShelterHouse,
  SnakeForm,
  VisualTheme,
} from '../core/types';
import type { ControllerStatus } from '../input/controls';
import { el } from './dom';
import {
  nextThemeAfter,
  themeLabelVi,
  type GameUICallbacks,
  type InitialUISettings,
} from './types';

const LIVE_BUTTONS = ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'L3', 'R3', 'Create'] as const;

export interface HudNotifyHandler {
  onWebHidResult(connected: boolean): void;
  onThemeChanged(theme: VisualTheme): void;
}

function remainingSessionSeconds(elapsedTicks: number, config: GameConfig): number {
  const durationMs = config.sessionDurationMs ?? DEFAULT_SESSION_DURATION_MS;
  const elapsedMs = Math.max(0, elapsedTicks) * config.baseTick;
  const remainingMs = Math.max(0, durationMs - elapsedMs);
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

function formatMatchClock(elapsedTicks: number, config: GameConfig): string {
  const remainingSeconds = remainingSessionSeconds(elapsedTicks, config);
  const mm = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
  const ss = String(remainingSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function shelterRadarInfo(kind: string): { icon: string; shortName: string } {
  switch (kind) {
    case 'mermaid':
      return { icon: '🧜‍♀️', shortName: 'Cung Điện Tiên Cá' };
    case 'candy':
      return { icon: '🍭', shortName: 'Lâu Đài Kẹo Ngọt' };
    case 'blossom':
      return { icon: '🌸', shortName: 'Lâu Đài Hoa Tiên' };
    case 'starlight':
      return { icon: '⭐', shortName: 'Cung Điện Ánh Sao' };
    case 'castle':
      return { icon: '🏰', shortName: 'Lâu Đài' };
    case 'crystal':
      return { icon: '💎', shortName: 'Thánh Điện' };
    case 'mushroom':
    default:
      return { icon: '🍄', shortName: 'Nhà Nấm' };
  }
}

function formatDiscoveryToast(kind: string, nameVi: string): string {
  switch (kind) {
    case 'mermaid':
      return '✨ KHÁM PHÁ CUNG ĐIỆN MỚI! 🧜‍♀️ Cung Điện Nàng Tiên Cá! (+150đ) ✨';
    case 'candy':
      return '✨ KHÁM PHÁ CUNG ĐIỆN MỚI! 🍭 Lâu Đài Kẹo Ngọt! (+150đ) ✨';
    case 'blossom':
      return '✨ KHÁM PHÁ CUNG ĐIỆN MỚI! 🌸 Lâu Đài Hoa Tiên! (+150đ) ✨';
    case 'starlight':
      return '✨ KHÁM PHÁ CUNG ĐIỆN MỚI! ⭐ Cung Điện Ánh Sao! (+150đ) ✨';
    case 'castle':
      return '✨ KHÁM PHÁ CUNG ĐIỆN MỚI! 🏰 Lâu Đài Phép Thuật! (+150đ) ✨';
    case 'crystal':
      return '✨ KHÁM PHÁ CUNG ĐIỆN MỚI! 💎 Điện Pha Lê! (+150đ) ✨';
    case 'mushroom':
      return '✨ KHÁM PHÁ CUNG ĐIỆN MỚI! 🍄 Nhà Nấm Thần Tiên! (+150đ) ✨';
    default:
      return nameVi
        ? `✨ KHÁM PHÁ CUNG ĐIỆN MỚI! ${nameVi}! (+150đ) ✨`
        : '✨ KHÁM PHÁ CUNG ĐIỆN MỚI! (+150đ) ✨';
  }
}

function createShelterArrowSvg(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('shelter-arrow-svg');

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
 * Corner HUD docks leaving the top-center completely open for `BossBar` and
 * `QuestBanner`:
 * - Top-left: Match clock (`01:16`) + `🐍 xBots` pill directly beneath it,
 *   magic hearts, current level (`Lv.5`), shield pill, compact score/combo, and
 *   DualSense Live badge (`🎮` illuminated buttons + `✨ Bật Đèn LED DualSense`).
 * - Top-right: Compact quick toggles (sound, music, vibration, theme, pause),
 *   hosting the `LeaderboardPanel` cleanly underneath.
 */
export class HudBar {
  private readonly rootEl: HTMLElement;
  private readonly rightColEl: HTMLElement;

  private readonly timerPill: HTMLElement;
  private readonly botsEatenPill: HTMLElement;
  private readonly heartsRow: HTMLElement;
  private readonly shieldPill: HTMLElement;
  private readonly levelPill: HTMLElement;
  private readonly scoreValue: HTMLElement;
  private readonly bestValue: HTMLElement;
  private readonly comboPill: HTMLElement;
  private readonly levelValue: HTMLElement;

  private readonly controllerBadge: HTMLElement;
  private readonly controllerText: HTMLElement;
  private readonly buttonStrip: HTMLElement;
  private readonly stickDot: HTMLElement;
  private readonly buttonPills = new Map<string, HTMLElement>();
  private readonly webHidBtn: HTMLButtonElement;
  private readonly flashTimers = new Map<
    HTMLElement,
    { readonly cls: string; readonly timer: ReturnType<typeof setTimeout> }
  >();
  private readonly pressedLabels = new Set<string>();
  private stickLit = false;

  private readonly soundBtn: HTMLButtonElement;
  private readonly musicBtn: HTMLButtonElement;
  private readonly vibrationBtn: HTMLButtonElement;
  private readonly themeBtn: HTMLButtonElement;
  private readonly pauseBtn: HTMLButtonElement;

  private soundEnabled: boolean;
  private musicEnabled: boolean;
  private vibrationEnabled: boolean;
  private activeTheme: VisualTheme;
  private activeForm: SnakeForm = 'dragon';
  private activeAgeProfile: AgeProfile = 'age6';
  private connectingHid = false;

  private lastClockText = '';
  private lastBotsEaten = -1;
  private lastHeartsKey = '';
  private lastShieldKey = '';
  private lastScore = -1;
  private lastBest = -1;
  private lastCombo = -1;
  private lastLevel = -1;
  private lastPhase = '';
  private lastControllerKey = '';
  private lastShieldActive = false;
  private lastSpraying = false;
  private lastFlying = false;
  private lastHoldingButterfly = false;

  private readonly alertsContainer: HTMLElement;
  private readonly castleDiscoveryToastEl: HTMLElement;
  private readonly castleDiscoveryToastText: HTMLElement;
  private readonly monsterAlertEl: HTMLElement;
  private readonly monsterAlertText: HTMLElement;
  private readonly safeShelterEl: HTMLElement;
  private readonly safeShelterText: HTMLElement;

  private readonly shelterRadarEl: HTMLElement;
  private readonly shelterRadarIcon: HTMLElement;
  private readonly shelterRadarArrow: HTMLElement;
  private readonly shelterRadarText: HTMLElement;
  private readonly shelterRadarProgress: HTMLElement;

  private lastMonsterAlertKey = '';
  private lastSafeShelterKey = '';
  private lastShelterRadarKey = '';
  private lastDiscoveredCount = -1;
  private lastKnownDiscoveredIds = new Set<string>();
  private castleDiscoveryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    parent: HTMLElement,
    private readonly callbacks: GameUICallbacks,
    initialSettings: InitialUISettings,
    private readonly notify: HudNotifyHandler,
  ) {
    this.soundEnabled = initialSettings.sound;
    this.musicEnabled = initialSettings.music;
    this.vibrationEnabled = initialSettings.vibration;
    this.activeTheme = initialSettings.theme;
    this.activeAgeProfile = initialSettings.ageProfile ?? 'age6';

    // Top-left: 5-minute Countdown Clock + Bots Eaten pill directly below
    this.timerPill = el('div', {
      className: 'hud-timer-pill',
      text: '⏱️ 05:00',
      title: 'Thời gian phiên chơi (5 phút)',
    });
    this.botsEatenPill = el('div', {
      className: 'hud-bots-pill',
      text: '🐍 x0',
      title: 'Số rắn Bot bé đã ăn',
    });
    const clockAndBotsCol = el(
      'div',
      { className: 'hud-clock-bots' },
      this.timerPill,
      this.botsEatenPill,
    );

    // Top-left vitals: Hearts, Shield, Level, compact Score / Best / Combo
    this.heartsRow = el('div', {
      className: 'hud-hearts',
      title: 'Tim phép thuật của bé',
      ariaLabel: 'Tim phép thuật',
    });
    this.shieldPill = el('div', {
      className: 'hud-shield-pill ready',
      text: '🫧 Sẵn',
      title: 'Trạng thái Khiên Bong Bóng (○ hoặc phím F)',
    });
    this.levelValue = el('span', { className: 'hud-stat-value level', text: 'Lv.5' });
    this.levelPill = el(
      'div',
      { className: 'hud-level-pill', title: 'Cấp độ hiện tại của rắn' },
      this.levelValue,
    );

    this.scoreValue = el('span', { className: 'hud-stat-value score', text: '0' });
    this.bestValue = el('span', { className: 'hud-stat-value best', text: '0' });
    this.comboPill = el('div', { className: 'hud-combo', text: '🔥 x0' });

    const vitalsRow = el(
      'div',
      { className: 'hud-vitals' },
      this.levelPill,
      this.heartsRow,
      this.shieldPill,
    );
    const miniMetricsRow = el(
      'div',
      { className: 'hud-metrics' },
      this.makeMiniMetric('✨', this.scoreValue, 'Điểm'),
      this.makeMiniMetric('🏆', this.bestValue, 'Kỷ lục'),
      this.comboPill,
    );
    const vitalsStack = el('div', { className: 'hud-vitals-stack' }, vitalsRow, miniMetricsRow);

    const statsCard = el(
      'div',
      { className: 'hud-group hud-stats-group' },
      clockAndBotsCol,
      vitalsStack,
    );

    // Top-left (row 2): Live DualSense badge + WebHID LED button
    this.controllerText = el('span', {
      className: 'controller-status-text',
      text: '🎮 Cắm/Bluetooth DualSense & bấm nút (hoặc Phím)',
    });
    this.stickDot = el('span', {
      className: 'controller-btn-pill stick-pill',
      text: '🕹️',
      title: 'Left Stick 360° / D-Pad',
    });
    this.buttonStrip = el('div', { className: 'controller-btn-strip' }, this.stickDot);
    for (const label of LIVE_BUTTONS) {
      const pill = el('span', { className: 'controller-btn-pill', text: label });
      this.buttonPills.set(label, pill);
      this.buttonStrip.appendChild(pill);
    }
    this.buttonStrip.style.display = 'none';

    this.webHidBtn = el('button', {
      className: 'hud-hid-btn',
      text: '✨ Bật Đèn LED DualSense',
      type: 'button',
      title: 'Kết nối WebHID để đồng bộ đèn LED tay cầm DualSense theo màu phép thuật',
    });
    this.webHidBtn.style.display = 'none';
    this.webHidBtn.addEventListener('click', () => {
      void this.handleConnectWebHid();
    });

    this.controllerBadge = el(
      'div',
      { className: 'hud-group hud-controller-badge disconnected' },
      this.controllerText,
      this.buttonStrip,
      this.webHidBtn,
    );

    const leftColEl = el('div', { className: 'hud-left-col' }, statsCard, this.controllerBadge);

    // Top-right: Quick toggles (above LeaderboardPanel)
    this.soundBtn = el('button', {
      className: 'hud-icon-btn',
      type: 'button',
      ariaLabel: 'Bật hoặc tắt âm thanh hiệu ứng',
    });
    this.soundBtn.addEventListener('click', () => {
      this.soundEnabled = !this.soundEnabled;
      this.renderToggles();
      this.callbacks.onToggleSound(this.soundEnabled);
    });

    this.musicBtn = el('button', {
      className: 'hud-icon-btn',
      type: 'button',
      ariaLabel: 'Bật hoặc tắt nhạc nền phép thuật',
    });
    this.musicBtn.addEventListener('click', () => {
      this.musicEnabled = !this.musicEnabled;
      this.renderToggles();
      this.callbacks.onToggleMusic(this.musicEnabled);
    });

    this.vibrationBtn = el('button', {
      className: 'hud-icon-btn',
      type: 'button',
      ariaLabel: 'Bật hoặc tắt rung tay cầm DualSense',
    });
    this.vibrationBtn.addEventListener('click', () => {
      this.vibrationEnabled = !this.vibrationEnabled;
      this.renderToggles();
      this.callbacks.onToggleVibration(this.vibrationEnabled);
    });

    this.themeBtn = el('button', {
      className: 'hud-icon-btn hud-theme-btn',
      type: 'button',
      text: '🎨',
      ariaLabel: 'Đổi chủ đề thế giới 3D',
    });
    this.themeBtn.addEventListener('click', () => {
      const next = nextThemeAfter(this.activeTheme);
      this.setTheme(next);
      this.callbacks.onSelectTheme(next);
      this.notify.onThemeChanged(next);
    });

    this.pauseBtn = el('button', {
      className: 'hud-icon-btn hud-pause-btn',
      type: 'button',
      text: '⏸',
      title: 'Tạm dừng / Tiếp tục (Options hoặc P)',
      ariaLabel: 'Tạm dừng hoặc tiếp tục trò chơi',
    });
    this.pauseBtn.addEventListener('click', () => {
      this.callbacks.onTogglePause();
    });

    const agePill = el('button', {
      className: 'hud-pill hud-age-pill',
      type: 'button',
      text: this.activeAgeProfile === 'age6' ? '🐣 6T' : '🚀 9T',
      ariaLabel: 'Chuyển đổi lứa tuổi',
    });
    agePill.dataset['action'] = 'age-profile';
    agePill.addEventListener('click', () => {
      const next: AgeProfile = this.activeAgeProfile === 'age6' ? 'age9' : 'age6';
      this.activeAgeProfile = next;
      agePill.textContent = next === 'age6' ? '🐣 6T' : '🚀 9T';
      this.callbacks.onSelectAgeProfile(next);
    });

    const actionsGroup = el(
      'div',
      { className: 'hud-group hud-actions-group' },
      agePill,
      this.soundBtn,
      this.musicBtn,
      this.vibrationBtn,
      this.themeBtn,
      this.pauseBtn,
    );

    this.rightColEl = el('div', { className: 'hud-right-col' }, actionsGroup);

    this.rootEl = el('header', { id: 'hud-top' }, leftColEl, this.rightColEl);
    parent.appendChild(this.rootEl);

    // Alerts container (Castle Discovery Toast + Monster Alert Banner + Safe Shelter Indicator)
    this.castleDiscoveryToastText = el('span', {
      className: 'castle-discovery-toast-text',
      text: '',
    });
    this.castleDiscoveryToastEl = el(
      'div',
      {
        id: 'castle-discovery-toast',
        className: 'castle-discovery-toast hidden',
        ariaLabel: 'Khám phá cung điện mới',
      },
      this.castleDiscoveryToastText,
    );
    this.castleDiscoveryToastEl.setAttribute('role', 'status');

    this.monsterAlertText = el('span', { className: 'monster-alert-text', text: '' });
    this.monsterAlertEl = el(
      'div',
      {
        id: 'monster-alert-banner',
        className: 'monster-alert-banner hidden',
        ariaLabel: 'Cảnh báo Quái Vật Bão Táp',
      },
      this.monsterAlertText,
    );
    this.monsterAlertEl.setAttribute('role', 'alert');

    this.safeShelterText = el('span', {
      className: 'shelter-safe-text',
      text: '🏡 ĐÃ TRÚ ẨN AN TOÀN TRONG NHÀ NẤM ✨',
    });
    this.safeShelterEl = el(
      'div',
      {
        id: 'shelter-safe-indicator',
        className: 'shelter-safe-indicator hidden',
        ariaLabel: 'Đã trú ẩn an toàn',
      },
      this.safeShelterText,
    );
    this.safeShelterEl.setAttribute('role', 'status');

    this.alertsContainer = el(
      'div',
      { id: 'shelter-alerts-container', className: 'shelter-alerts-container' },
      this.castleDiscoveryToastEl,
      this.monsterAlertEl,
      this.safeShelterEl,
    );
    parent.appendChild(this.alertsContainer);

    // Bottom-right Shelter Compass / Radar Arrow pointing to nearest shelter house
    this.shelterRadarIcon = el('span', { className: 'shelter-radar-icon', text: '🏡' });
    this.shelterRadarArrow = el(
      'span',
      { className: 'shelter-radar-arrow' },
      createShelterArrowSvg(),
    );
    this.shelterRadarText = el('span', { className: 'shelter-radar-text', text: '' });
    this.shelterRadarProgress = el('span', {
      className: 'shelter-radar-progress',
      text: '',
      title: 'Tiến trình khám phá các lâu đài phép thuật',
    });
    this.shelterRadarEl = el(
      'div',
      {
        id: 'shelter-radar',
        className: 'shelter-radar hidden',
        ariaLabel: 'La bàn chỉ hướng nhà trú ẩn an toàn gần nhất',
      },
      this.shelterRadarProgress,
      this.shelterRadarIcon,
      this.shelterRadarArrow,
      this.shelterRadarText,
    );
    parent.appendChild(this.shelterRadarEl);

    if (typeof window !== 'undefined') {
      (window as unknown as { __hudForTest?: HudBar }).__hudForTest = this;
    }

    this.renderToggles();
  }

  getRightDock(): HTMLElement {
    return this.rightColEl;
  }

  setTheme(theme: VisualTheme): void {
    this.activeTheme = theme;
    this.renderToggles();
  }

  private testStateOverride: Partial<GameState> | null = null;

  setTestStateOverride(override: Partial<GameState> | null): void {
    this.testStateOverride = override;
  }

  syncState(rawState: GameState): void {
    const state = this.testStateOverride
      ? ({ ...rawState, ...this.testStateOverride } as GameState)
      : rawState;
    this.activeForm = state.form;

    // Sync age profile pill
    if (state.ageProfile !== this.activeAgeProfile) {
      this.activeAgeProfile = state.ageProfile;
      const agePill = this.rootEl.querySelector<HTMLElement>('.hud-age-pill');
      if (agePill) {
        agePill.textContent = state.ageProfile === 'age6' ? '🐣 6T' : '🚀 9T';
      }
    }

    const clockText = formatMatchClock(state.elapsedTicks, state.config);
    if (clockText !== this.lastClockText) {
      this.lastClockText = clockText;
      this.timerPill.textContent = `⏱️ ${clockText}`;
    }
    const remainingSec = remainingSessionSeconds(state.elapsedTicks, state.config);
    this.timerPill.classList.toggle('urgent', state.phase === 'playing' && remainingSec <= 30);

    if (state.botsEaten !== this.lastBotsEaten) {
      const gainedBot = this.lastBotsEaten !== -1 && state.botsEaten > this.lastBotsEaten;
      this.lastBotsEaten = state.botsEaten;
      this.botsEatenPill.textContent = `🐍 x${state.botsEaten}`;
      if (gainedBot) {
        this.flashClass(this.botsEatenPill, 'hud-pop', 380);
      }
    }

    const heartsKey = `${state.hearts}/${state.maxHearts}/${state.invulnerableTicks > 0 ? 1 : 0}`;
    if (heartsKey !== this.lastHeartsKey) {
      this.lastHeartsKey = heartsKey;
      this.renderHearts(state.hearts, state.maxHearts, state.invulnerableTicks > 0);
    }

    const shieldKey = `${state.shieldTicks}/${state.shieldCooldownTicks}`;
    if (shieldKey !== this.lastShieldKey) {
      this.lastShieldKey = shieldKey;
      this.renderShield(state.shieldTicks, state.shieldCooldownTicks);
    }
    const shieldActive = state.shieldTicks > 0;
    if (shieldActive && !this.lastShieldActive) {
      this.flashClass(this.shieldPill, 'hud-pop', 340);
    }
    this.lastShieldActive = shieldActive;

    if (state.level !== this.lastLevel) {
      const leveledUp = this.lastLevel !== -1 && state.level > this.lastLevel;
      this.lastLevel = state.level;
      this.levelValue.textContent = `Lv.${state.level}`;
      if (leveledUp) {
        this.flashClass(this.levelPill, 'hud-pop', 420);
      }
    }

    if (state.score !== this.lastScore) {
      this.lastScore = state.score;
      this.scoreValue.textContent = String(state.score);
    }
    if (state.best !== this.lastBest) {
      this.lastBest = state.best;
      this.bestValue.textContent = String(state.best);
    }
    if (state.combo !== this.lastCombo) {
      const roseHot = this.lastCombo !== -1 && state.combo > this.lastCombo && state.combo >= 2;
      this.lastCombo = state.combo;
      this.comboPill.textContent = `🔥 x${state.combo}`;
      this.comboPill.classList.toggle('hot', state.combo >= 2);
      if (roseHot) {
        this.flashClass(this.comboPill, 'hud-pop', 320);
      }
    }
    if (state.phase !== this.lastPhase) {
      this.lastPhase = state.phase;
      const canPause = state.phase === 'playing' || state.phase === 'paused';
      this.pauseBtn.disabled = !canPause;
      this.pauseBtn.textContent = state.phase === 'paused' ? '▶' : '⏸';
    }

    const spraying = state.sprayActiveTicks > 0 && state.phase === 'playing';
    if (spraying !== this.lastSpraying) {
      this.lastSpraying = spraying;
      this.rootEl.classList.toggle('spraying', spraying);
    }
    const flying = state.butterflyStage === 'butterfly' && state.phase === 'playing';
    if (flying !== this.lastFlying) {
      this.lastFlying = flying;
      this.rootEl.classList.toggle('butterfly-flying', flying);
    }
    const holdingButterfly = state.butterflyHold && state.phase === 'playing';
    if (holdingButterfly !== this.lastHoldingButterfly) {
      this.lastHoldingButterfly = holdingButterfly;
      this.rootEl.classList.toggle('is-holding', holdingButterfly);
    }

    if (this.webHidBtn.classList.contains('connected')) {
      this.webHidBtn.style.setProperty('--hid-glow', FORM_METADATA[this.activeForm].cssColor);
    }

    this.syncSheltersAndMonster(state);
  }

  /** Pulse a DualSense button pill (and badge) for crisp practice feedback. */
  flashControllerPill(label: string): void {
    this.flashClass(this.controllerBadge, 'practice-pulse', 240);
    if (this.buttonStrip.style.display === 'none') return;
    if (label === '🕹️') {
      this.flashClass(this.stickDot, 'just-lit', 260);
      return;
    }
    const pill = this.buttonPills.get(label);
    if (pill) {
      this.flashClass(pill, 'just-lit', 280);
    }
  }

  /** Pulse the HUD shield pill when Bubble Shield is triggered. */
  flashShieldPill(): void {
    this.flashClass(this.shieldPill, 'hud-pop', 320);
  }

  syncController(status: ControllerStatus): void {
    const stickMoving =
      Math.hypot(status.leftStick.x, status.leftStick.y) > 0.22 ||
      status.pressedLabels.includes('D-Pad');
    const key = [
      status.connected ? '1' : '0',
      status.isDualSense ? '1' : '0',
      status.controllerName,
      status.webHidConnected ? '1' : '0',
      status.webHidSupported ? '1' : '0',
      stickMoving ? '1' : '0',
      status.pressedLabels.join(','),
    ].join('|');

    if (key === this.lastControllerKey) return;
    this.lastControllerKey = key;

    this.controllerBadge.classList.toggle('connected', status.connected);
    this.controllerBadge.classList.toggle('disconnected', !status.connected);

    if (!status.connected) {
      this.controllerText.textContent = '🎮 Cắm/Bluetooth DualSense & bấm nút (hoặc Phím)';
      this.controllerText.title = '';
      this.buttonStrip.style.display = 'none';
      this.stickLit = false;
      this.pressedLabels.clear();
      this.stickDot.classList.remove('lit', 'just-lit');
      for (const pill of this.buttonPills.values()) {
        pill.classList.remove('lit', 'just-lit');
      }
    } else {
      const label = status.isDualSense
        ? '🎮 DualSense đã kết nối!'
        : `🎮 ${status.controllerName || 'Tay cầm đã kết nối!'}`;
      this.controllerText.textContent = label;
      this.controllerText.title = status.controllerName;
      this.buttonStrip.style.display = 'flex';
      this.stickDot.classList.toggle('lit', stickMoving);
      if (stickMoving && !this.stickLit) {
        this.flashClass(this.stickDot, 'just-lit', 260);
      }
      this.stickLit = stickMoving;

      let anyFreshPress = false;
      for (const [btnLabel, pill] of this.buttonPills) {
        const isLit = status.pressedLabels.includes(btnLabel);
        pill.classList.toggle('lit', isLit);
        if (isLit && !this.pressedLabels.has(btnLabel)) {
          this.flashClass(pill, 'just-lit', 280);
          anyFreshPress = true;
        }
      }
      if (anyFreshPress) {
        this.flashClass(this.controllerBadge, 'practice-pulse', 240);
      }
      this.pressedLabels.clear();
      for (const btnLabel of status.pressedLabels) {
        this.pressedLabels.add(btnLabel);
      }
    }

    if (status.webHidConnected) {
      this.webHidBtn.style.display = 'inline-flex';
      this.webHidBtn.classList.add('connected');
      this.webHidBtn.disabled = false;
      this.webHidBtn.textContent = '💡 LED Đồng Bộ Màu';
      this.webHidBtn.style.setProperty('--hid-glow', FORM_METADATA[this.activeForm].cssColor);
    } else if (status.webHidSupported) {
      this.webHidBtn.style.display = 'inline-flex';
      this.webHidBtn.classList.remove('connected');
      if (!this.connectingHid) {
        this.webHidBtn.disabled = false;
        this.webHidBtn.textContent = '✨ Bật Đèn LED DualSense';
      }
    } else {
      this.webHidBtn.style.display = 'none';
    }
  }

  /**
   * Display a celebratory popup toast when player discovers a new palace / castle:
   * e.g. '✨ KHÁM PHÁ CUNG ĐIỆN MỚI! 🧜‍♀️ Cung Điện Nàng Tiên Cá! (+150đ) ✨'
   */
  showDiscoveryToast(text: string, durationMs = 3800): void {
    if (this.castleDiscoveryTimer) {
      clearTimeout(this.castleDiscoveryTimer);
      this.castleDiscoveryTimer = null;
    }
    this.castleDiscoveryToastText.textContent = text;
    this.castleDiscoveryToastEl.classList.remove('hidden');
    void this.castleDiscoveryToastEl.offsetWidth;
    this.castleDiscoveryToastEl.classList.add('pop');

    this.castleDiscoveryTimer = setTimeout(() => {
      this.castleDiscoveryToastEl.classList.add('hidden');
      this.castleDiscoveryToastEl.classList.remove('pop');
      this.castleDiscoveryTimer = null;
    }, durationMs);
  }

  dispose(): void {
    this.testStateOverride = null;
    if (typeof window !== 'undefined') {
      delete (window as unknown as { __hudForTest?: HudBar }).__hudForTest;
    }
    if (this.castleDiscoveryTimer) {
      clearTimeout(this.castleDiscoveryTimer);
      this.castleDiscoveryTimer = null;
    }
    for (const entry of this.flashTimers.values()) {
      clearTimeout(entry.timer);
    }
    this.flashTimers.clear();
    this.alertsContainer.remove();
    this.shelterRadarEl.remove();
    this.rootEl.remove();
  }

  private syncSheltersAndMonster(state: GameState): void {
    if (state.phase !== 'playing') {
      if (this.castleDiscoveryTimer) {
        clearTimeout(this.castleDiscoveryTimer);
        this.castleDiscoveryTimer = null;
      }
      this.castleDiscoveryToastEl.classList.add('hidden');
      if (this.lastMonsterAlertKey !== 'hidden') {
        this.lastMonsterAlertKey = 'hidden';
        this.monsterAlertEl.classList.add('hidden');
      }
      if (this.lastSafeShelterKey !== 'hidden') {
        this.lastSafeShelterKey = 'hidden';
        this.safeShelterEl.classList.add('hidden');
      }
      if (this.lastShelterRadarKey !== 'hidden') {
        this.lastShelterRadarKey = 'hidden';
        this.shelterRadarEl.classList.add('hidden');
      }
      return;
    }

    // 0. Castle Discovery Toast Check
    const discovered =
      (state as { discoveredShelterIds?: readonly string[] }).discoveredShelterIds ?? [];
    if (this.lastDiscoveredCount === -1) {
      this.lastDiscoveredCount = discovered.length;
      this.lastKnownDiscoveredIds = new Set(discovered);
    } else if (discovered.length > this.lastDiscoveredCount) {
      for (const id of discovered) {
        if (!this.lastKnownDiscoveredIds.has(id)) {
          this.lastKnownDiscoveredIds.add(id);
          const s = (state.shelters ?? []).find((h) => h.id === id);
          const toast = formatDiscoveryToast(s?.kind ?? '', s?.nameVi ?? '');
          this.showDiscoveryToast(toast);
        }
      }
      this.lastDiscoveredCount = discovered.length;
    }

    // 1. Monster Alert Banner
    const monster = state.monsterEvent;
    const isWarning = monster?.phase === 'warning';
    const isStrike = monster?.phase === 'strike';
    const countdown =
      monster?.countdownSec ?? (monster ? Math.ceil(monster.ticksRemaining / 20) : 0);
    const inShelter = Boolean(state.inShelter);
    const isBlocked = Boolean(
      inShelter &&
      (monster?.isBlockedByShelter ||
        (monster as { isBlockedByShelter?: boolean })?.isBlockedByShelter),
    );
    const hasDist =
      monster?.distanceToPlayer != null &&
      Number.isFinite(monster.distanceToPlayer) &&
      monster.distanceToPlayer < 900;
    const monsterDist = hasDist ? Math.max(0, Math.round(monster.distanceToPlayer)) : -1;
    const alertKey = `${monster?.phase ?? 'none'}|${countdown}|${monsterDist}|${isBlocked ? 1 : 0}`;

    if (alertKey !== this.lastMonsterAlertKey) {
      this.lastMonsterAlertKey = alertKey;
      if (isWarning || isStrike) {
        if (isBlocked) {
          // When player is inside shelter and monster is blocked
          this.monsterAlertText.textContent =
            '🛡️ QUÁI VẬT BỊ CHẶN BỞI KHIÊN BẢO HỘ! BÉ ĐÃ AN TOÀN! ✨';
          this.monsterAlertEl.classList.remove('hidden', 'warning', 'strike');
          this.monsterAlertEl.classList.add('blocked');
        } else if (isWarning) {
          const secStr = String(Math.max(0, countdown)).padStart(2, '0');
          if (hasDist) {
            this.monsterAlertText.textContent = `⚠️ QUÁI VẬT ĐANG ĐUỔI BẮT! Cách: ${monsterDist}m • VÀO NHÀ MAU! (${secStr}s) 🐲⚡`;
          } else {
            this.monsterAlertText.textContent = `⚠️ QUÁI VẬT BÃO TÁP ĐANG ĐẾN! VÀO NHÀ MAU! (${secStr}s)`;
          }
          this.monsterAlertEl.classList.remove('hidden', 'strike', 'blocked');
          this.monsterAlertEl.classList.add('warning');
        } else {
          // isStrike
          if (hasDist) {
            this.monsterAlertText.textContent = `⚡ QUÁI VẬT ĐANG ĐUỔI BẮT! Cách: ${monsterDist}m • VÀO NHÀ MAU! 🐲⚡`;
          } else {
            this.monsterAlertText.textContent = '⚡ BÃO TÁP QUÁI VẬT ĐANG HOÀNH HÀNH! ⚡';
          }
          this.monsterAlertEl.classList.remove('hidden', 'warning', 'blocked');
          this.monsterAlertEl.classList.add('strike');
        }
      } else {
        this.monsterAlertEl.classList.add('hidden');
        this.monsterAlertEl.classList.remove('warning', 'strike', 'blocked');
      }
    }

    // 2. Safe Shelter Indicator
    const currentId = state.currentShelterId ?? '';
    const safeKey = `${inShelter ? 1 : 0}|${currentId}`;

    if (safeKey !== this.lastSafeShelterKey) {
      this.lastSafeShelterKey = safeKey;
      if (inShelter) {
        const currentHouse = (state.shelters ?? []).find((s) => s.id === currentId);
        const k = (currentHouse?.kind as string) ?? '';
        switch (k) {
          case 'mermaid':
            this.safeShelterText.textContent = '🧜‍♀️ ĐÃ TRÚ ẨN AN TOÀN TRONG CUNG ĐIỆN TIÊN CÁ ✨';
            break;
          case 'candy':
            this.safeShelterText.textContent = '🍭 ĐÃ TRÚ ẨN AN TOÀN TRONG LÂU ĐÀI KẸO NGỌT ✨';
            break;
          case 'blossom':
            this.safeShelterText.textContent = '🌸 ĐÃ TRÚ ẨN AN TOÀN TRONG LÂU ĐÀI HOA TIÊN ✨';
            break;
          case 'starlight':
            this.safeShelterText.textContent = '⭐ ĐÃ TRÚ ẨN AN TOÀN TRONG CUNG ĐIỆN ÁNH SAO ✨';
            break;
          case 'castle':
            this.safeShelterText.textContent = '🏰 ĐÃ TRÚ ẨN AN TOÀN TRONG LÂU ĐÀI ✨';
            break;
          case 'crystal':
            this.safeShelterText.textContent = '💎 ĐÃ TRÚ ẨN AN TOÀN TRONG ĐIỆN PHA LÊ ✨';
            break;
          case 'mushroom':
          default:
            this.safeShelterText.textContent = '🏡 ĐÃ TRÚ ẨN AN TOÀN TRONG NHÀ NẤM ✨';
            break;
        }
        this.safeShelterEl.classList.remove('hidden');
      } else {
        this.safeShelterEl.classList.add('hidden');
      }
    }

    // 3. Shelter Compass / Radar Arrow pointing to nearest shelter
    const head = state.snake[0];
    const shelters = state.shelters ?? [];
    if (!head || shelters.length === 0) {
      if (this.lastShelterRadarKey !== 'hidden') {
        this.lastShelterRadarKey = 'hidden';
        this.shelterRadarEl.classList.add('hidden');
      }
      return;
    }

    let nearest: ShelterHouse = shelters[0]!;
    let minDist = Math.hypot(nearest.x - head.x, nearest.z - head.z);
    for (let i = 1; i < shelters.length; i++) {
      const s = shelters[i]!;
      const d = Math.hypot(s.x - head.x, s.z - head.z);
      if (d < minDist) {
        minDist = d;
        nearest = s;
      }
    }

    const distRounded = Math.round(minDist);
    const dx = nearest.x - head.x;
    const dz = nearest.z - head.z;
    const angleRad = Math.atan2(dz, dx);
    const angleRounded = Number(angleRad.toFixed(2));
    const isDanger = (isWarning || isStrike) && !inShelter;
    const totalShelters = shelters.length;
    const discoveredCount =
      (state as { discoveredShelterIds?: readonly string[] }).discoveredShelterIds?.length ??
      (inShelter ? 1 : 0);
    const radarKey = `${inShelter ? 1 : 0}|${isDanger ? 1 : 0}|${nearest.id}|${distRounded}|${angleRounded}|${discoveredCount}/${totalShelters}`;

    if (radarKey !== this.lastShelterRadarKey) {
      this.lastShelterRadarKey = radarKey;
      this.shelterRadarEl.classList.remove('hidden');
      this.shelterRadarEl.classList.toggle('urgent', isDanger);
      this.shelterRadarEl.classList.toggle('safe', inShelter);

      this.shelterRadarProgress.textContent = `🏰 ${discoveredCount}/${totalShelters} Lâu Đài Đã Khám Phá`;

      const info = shelterRadarInfo(nearest.kind);
      if (inShelter) {
        this.shelterRadarIcon.textContent = info.icon || '🏡';
        this.shelterRadarArrow.classList.add('hidden');
        this.shelterRadarText.textContent = '✨ Đã Trú Ẩn An Toàn!';
      } else {
        this.shelterRadarIcon.textContent = info.icon;
        this.shelterRadarArrow.classList.remove('hidden');
        this.shelterRadarArrow.style.transform = `rotate(${angleRad.toFixed(3)}rad)`;
        this.shelterRadarText.textContent = `${info.shortName} • ${distRounded}m`;
      }
    }
  }

  private flashClass(node: HTMLElement, className: string, durationMs: number): void {
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

  private makeMiniMetric(icon: string, valueEl: HTMLElement, title: string): HTMLElement {
    return el(
      'div',
      { className: 'hud-mini-metric', title },
      el('span', { className: 'hud-mini-icon', text: icon }),
      valueEl,
    );
  }

  private renderHearts(hearts: number, maxHearts: number, invuln: boolean): void {
    this.heartsRow.textContent = '';
    this.heartsRow.classList.toggle('invuln', invuln);
    for (let i = 0; i < maxHearts; i++) {
      const filled = i < hearts;
      const heart = el('span', {
        className: filled ? 'hud-heart filled' : 'hud-heart empty',
        text: filled ? '❤️' : '🤍',
      });
      this.heartsRow.appendChild(heart);
    }
  }

  private renderShield(shieldTicks: number, cooldownTicks: number): void {
    this.shieldPill.classList.remove('active', 'cooldown', 'ready');
    if (shieldTicks > 0) {
      this.shieldPill.classList.add('active');
      this.shieldPill.textContent = `🛡️ ${shieldTicks}`;
    } else if (cooldownTicks > 0) {
      this.shieldPill.classList.add('cooldown');
      this.shieldPill.textContent = `🫧 ${cooldownTicks}`;
    } else {
      this.shieldPill.classList.add('ready');
      this.shieldPill.textContent = '🫧 Sẵn';
    }
  }

  private renderToggles(): void {
    this.soundBtn.textContent = this.soundEnabled ? '🔊' : '🔇';
    this.soundBtn.classList.toggle('off', !this.soundEnabled);
    this.soundBtn.setAttribute('aria-pressed', String(this.soundEnabled));
    this.soundBtn.title = this.soundEnabled ? 'Âm thanh: Đang bật' : 'Âm thanh: Đang tắt';

    this.musicBtn.textContent = '🎵';
    this.musicBtn.classList.toggle('off', !this.musicEnabled);
    this.musicBtn.setAttribute('aria-pressed', String(this.musicEnabled));
    this.musicBtn.title = this.musicEnabled ? 'Nhạc nền: Đang bật' : 'Nhạc nền: Đang tắt';

    this.vibrationBtn.textContent = this.vibrationEnabled ? '📳' : '📴';
    this.vibrationBtn.classList.toggle('off', !this.vibrationEnabled);
    this.vibrationBtn.setAttribute('aria-pressed', String(this.vibrationEnabled));
    this.vibrationBtn.title = this.vibrationEnabled
      ? 'Rung tay cầm: Đang bật'
      : 'Rung tay cầm: Đang tắt';

    const label = themeLabelVi(this.activeTheme);
    this.themeBtn.title = `Đổi chủ đề 3D (Hiện tại: ${label})`;
  }

  private async handleConnectWebHid(): Promise<void> {
    if (this.connectingHid || this.webHidBtn.classList.contains('connected')) return;
    this.connectingHid = true;
    this.webHidBtn.disabled = true;
    this.webHidBtn.textContent = '⏳ Đang bật LED...';
    try {
      const ok = await this.callbacks.onConnectWebHid();
      this.connectingHid = false;
      this.lastControllerKey = '';
      if (!ok) {
        this.webHidBtn.disabled = false;
        this.webHidBtn.textContent = '✨ Bật Đèn LED DualSense';
      }
      this.notify.onWebHidResult(ok);
    } catch {
      this.connectingHid = false;
      this.lastControllerKey = '';
      this.webHidBtn.disabled = false;
      this.webHidBtn.textContent = '✨ Bật Đèn LED DualSense';
      this.notify.onWebHidResult(false);
    }
  }
}
