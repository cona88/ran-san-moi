import { FORM_METADATA } from '../core/config';
import type { GameState, SnakeForm, VisualTheme } from '../core/types';
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

function formatMatchClock(elapsedTicks: number, baseTickMs: number): string {
  const totalSeconds = Math.max(0, Math.floor((elapsedTicks * baseTickMs) / 1000));
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
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

    // Top-left: Match Clock + Bots Eaten pill directly below
    this.timerPill = el('div', {
      className: 'hud-timer-pill',
      text: '⏱️ 00:00',
      title: 'Thời gian trận đấu',
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
    const levelPill = el(
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
      levelPill,
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

    const actionsGroup = el(
      'div',
      { className: 'hud-group hud-actions-group' },
      this.soundBtn,
      this.musicBtn,
      this.vibrationBtn,
      this.themeBtn,
      this.pauseBtn,
    );

    this.rightColEl = el('div', { className: 'hud-right-col' }, actionsGroup);

    this.rootEl = el('header', { id: 'hud-top' }, leftColEl, this.rightColEl);
    parent.appendChild(this.rootEl);
    this.renderToggles();
  }

  getRightDock(): HTMLElement {
    return this.rightColEl;
  }

  setTheme(theme: VisualTheme): void {
    this.activeTheme = theme;
    this.renderToggles();
  }

  syncState(state: GameState): void {
    this.activeForm = state.form;

    const clockText = formatMatchClock(state.elapsedTicks, state.config.baseTick);
    if (clockText !== this.lastClockText) {
      this.lastClockText = clockText;
      this.timerPill.textContent = `⏱️ ${clockText}`;
    }

    if (state.botsEaten !== this.lastBotsEaten) {
      this.lastBotsEaten = state.botsEaten;
      this.botsEatenPill.textContent = `🐍 x${state.botsEaten}`;
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

    if (state.level !== this.lastLevel) {
      this.lastLevel = state.level;
      this.levelValue.textContent = `Lv.${state.level}`;
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
      this.lastCombo = state.combo;
      this.comboPill.textContent = `🔥 x${state.combo}`;
      this.comboPill.classList.toggle('hot', state.combo >= 2);
    }
    if (state.phase !== this.lastPhase) {
      this.lastPhase = state.phase;
      const canPause = state.phase === 'playing' || state.phase === 'paused';
      this.pauseBtn.disabled = !canPause;
      this.pauseBtn.textContent = state.phase === 'paused' ? '▶' : '⏸';
    }

    if (this.webHidBtn.classList.contains('connected')) {
      this.webHidBtn.style.setProperty('--hid-glow', FORM_METADATA[this.activeForm].cssColor);
    }
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
    } else {
      const label = status.isDualSense
        ? '🎮 DualSense đã kết nối!'
        : `🎮 ${status.controllerName || 'Tay cầm đã kết nối!'}`;
      this.controllerText.textContent = label;
      this.controllerText.title = status.controllerName;
      this.buttonStrip.style.display = 'flex';
      this.stickDot.classList.toggle('lit', stickMoving);

      for (const [btnLabel, pill] of this.buttonPills) {
        pill.classList.toggle('lit', status.pressedLabels.includes(btnLabel));
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

  dispose(): void {
    this.rootEl.remove();
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
