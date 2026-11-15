import type { Difficulty, GameMode, GameState, VisualTheme } from '../core/types';
import type { ControllerStatus } from '../input/controls';
import { el } from './dom';
import {
  DIFFICULTY_OPTIONS,
  MODE_OPTIONS,
  THEME_OPTIONS,
  type GameUICallbacks,
  type InitialUISettings,
  type OptionMeta,
} from './types';

interface DualSenseGuideItem {
  readonly buttons: string;
  readonly action: string;
}

const DUALSENSE_MAP: readonly DualSenseGuideItem[] = [
  { buttons: 'Left Stick / D-Pad', action: 'Lái 360° (WASD / Mũi tên)' },
  { buttons: 'R2 / □', action: 'Bắn phép giảm cấp Bot (Space / J)' },
  { buttons: '△ / R1 / L1', action: 'Biến hình 4 hệ (Q / E / 1-4)' },
  { buttons: '✕ / L2', action: 'Lướt nhanh (Shift / K)' },
  { buttons: '○', action: 'Khiên Bong Bóng (F / L)' },
  { buttons: 'L3 / Create / R3', action: '3 Boosters: +10 Cấp (Z) • Tốc Độ (X) • Nam Châm (C)' },
  { buttons: 'Right Stick', action: 'Nghiêng góc nhìn 3D' },
  { buttons: 'Options', action: 'Tạm dừng (P / Esc)' },
];

const DEFAULT_PLAYER_NAME = 'Bé Tiên';

export interface OverlayThemeSync {
  onThemeChanged(theme: VisualTheme): void;
}

/**
 * Full-viewport pastel glassmorphism overlay for `ready`, `paused`, and
 * `gameover` phases. Handles nickname input (`Biệt Danh Rắn Tiên`), mode,
 * difficulty, and 3D theme selection, Open-World Bot Hunt guide + DualSense
 * button map, and encouraging Vietnamese game-over stats.
 */
export class GameOverlay {
  private readonly rootEl: HTMLElement;
  private readonly cardEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly subtitleEl: HTMLElement;
  private readonly praiseEl: HTMLElement;
  private readonly eatenByBannerEl: HTMLElement;
  private readonly newBestBadge: HTMLElement;
  private readonly controllerLine: HTMLElement;
  private readonly huntTipEl: HTMLElement;

  private readonly nicknameRow: HTMLElement;
  private readonly playerNameInput: HTMLInputElement;
  private readonly setupSection: HTMLElement;
  private readonly guideSection: HTMLElement;
  private readonly statsGrid: HTMLElement;
  private readonly scoreSublineEl: HTMLElement;
  private readonly rankValEl: HTMLElement;
  private readonly levelValEl: HTMLElement;
  private readonly botsValEl: HTMLElement;
  private readonly questsValEl: HTMLElement;

  private readonly primaryBtn: HTMLButtonElement;
  private readonly secondaryBtn: HTMLButtonElement;
  private readonly ctaHintEl: HTMLElement;

  private readonly modeButtons = new Map<GameMode, HTMLButtonElement>();
  private readonly diffButtons = new Map<Difficulty, HTMLButtonElement>();
  private readonly themeButtons = new Map<VisualTheme, HTMLButtonElement>();

  private selectedMode: GameMode;
  private selectedDifficulty: Difficulty;
  private selectedTheme: VisualTheme;
  private currentPhase: GameState['phase'] = 'ready';
  private stateMode: GameMode = 'adventure';
  private stateDifficulty: Difficulty = 'normal';
  private statePlayerName = DEFAULT_PLAYER_NAME;

  constructor(
    parent: HTMLElement,
    private readonly callbacks: GameUICallbacks,
    initialSettings: InitialUISettings,
    private readonly themeSync: OverlayThemeSync,
  ) {
    this.selectedMode = initialSettings.mode;
    this.selectedDifficulty = initialSettings.difficulty;
    this.selectedTheme = initialSettings.theme;

    this.titleEl = el('h1', {
      className: 'overlay-title',
      text: '✨ Vương Quốc Rắn Phép Thuật 3D',
    });
    this.subtitleEl = el('p', {
      className: 'overlay-subtitle',
      text: 'Thế Giới Mở Săn Bot 360° cùng tay cầm DualSense trên macOS',
    });
    this.praiseEl = el('p', { className: 'overlay-praise hidden' });
    this.eatenByBannerEl = el('p', { className: 'overlay-eaten-banner hidden' });
    this.newBestBadge = el('div', {
      className: 'overlay-newbest hidden',
      text: '★ KỶ LỤC MỚI TUYỆT VỜI! ★',
    });
    this.controllerLine = el('div', {
      className: 'overlay-controller-pill disconnected',
      text: '🎮 Cắm USB hoặc kết nối Bluetooth DualSense rồi bấm nút bất kỳ (hoặc chơi bằng Phím)',
    });
    this.huntTipEl = el('div', {
      className: 'overlay-hunt-tip',
      text: '⚔️ Ăn Bot Lv thấp hơn để cướp sức mạnh — Bắn đạn giảm cấp Bot Lv cao hơn!',
    });

    // Cute compact Nickname input
    const initialName = initialSettings.playerName?.trim() || DEFAULT_PLAYER_NAME;
    this.playerNameInput = el('input', {
      id: 'player-name-input',
      className: 'player-name-input',
      ariaLabel: 'Biệt Danh Rắn Tiên',
    });
    this.playerNameInput.type = 'text';
    this.playerNameInput.maxLength = 16;
    this.playerNameInput.placeholder = DEFAULT_PLAYER_NAME;
    this.playerNameInput.value = initialName;
    this.playerNameInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this.playerNameInput.blur();
        this.handlePrimaryClick();
      }
    });

    this.nicknameRow = el(
      'div',
      { className: 'nickname-row' },
      el('label', {
        className: 'setup-label',
        text: '🏷️ Biệt Danh Rắn Tiên',
      }),
      this.playerNameInput,
    );
    const labelNode = this.nicknameRow.querySelector('label');
    if (labelNode) {
      labelNode.htmlFor = 'player-name-input';
    }

    // Setup selectors (Mode, Difficulty, 3D Theme)
    const modeRow = this.buildOptionGroup('Chế độ chơi', MODE_OPTIONS, this.modeButtons, (mode) => {
      this.selectedMode = mode;
      this.renderSelections();
    });
    const diffRow = this.buildOptionGroup(
      'Độ khó',
      DIFFICULTY_OPTIONS,
      this.diffButtons,
      (difficulty) => {
        this.selectedDifficulty = difficulty;
        this.renderSelections();
      },
    );
    const themeRow = this.buildOptionGroup(
      'Chủ đề 3D',
      THEME_OPTIONS,
      this.themeButtons,
      (theme) => {
        this.selectedTheme = theme;
        this.renderSelections();
        this.callbacks.onSelectTheme(theme);
        this.themeSync.onThemeChanged(theme);
      },
    );
    this.setupSection = el(
      'div',
      { className: 'overlay-setup' },
      this.nicknameRow,
      modeRow,
      diffRow,
      themeRow,
    );

    // Visual DualSense control map
    const guideGrid = el('div', { className: 'dualsense-map-grid' });
    for (const item of DUALSENSE_MAP) {
      guideGrid.appendChild(
        el(
          'div',
          { className: 'dualsense-map-item' },
          el('span', { className: 'ds-keycap', text: item.buttons }),
          el('span', { className: 'ds-action', text: item.action }),
        ),
      );
    }
    this.guideSection = el(
      'div',
      { className: 'overlay-guide' },
      el('div', { className: 'overlay-section-label', text: '🎮 Sơ đồ nút DualSense & Bàn phím' }),
      guideGrid,
    );

    // Game Over stats grid
    this.rankValEl = el('div', { className: 'go-stat-val', text: '#1' });
    this.levelValEl = el('div', { className: 'go-stat-val', text: 'Lv.5' });
    this.botsValEl = el('div', { className: 'go-stat-val', text: '🐍 x0' });
    this.questsValEl = el('div', { className: 'go-stat-val', text: '0' });
    this.statsGrid = el(
      'div',
      { className: 'gameover-stats-grid hidden' },
      this.makeStatCard('🏆 Hạng đạt được', this.rankValEl),
      this.makeStatCard('👑 Cấp độ đạt được', this.levelValEl),
      this.makeStatCard('🐍 Số Bot đã ăn', this.botsValEl),
      this.makeStatCard('🧠 Câu đố đã giải', this.questsValEl),
    );
    this.scoreSublineEl = el('div', { className: 'go-score-subline hidden', text: '' });

    // Primary & secondary CTA buttons
    this.primaryBtn = el('button', {
      id: 'cta',
      className: 'overlay-cta-btn',
      type: 'button',
      text: '✨ Bắt Đầu Phiêu Lưu!',
    });
    this.primaryBtn.addEventListener('click', () => this.handlePrimaryClick());

    this.secondaryBtn = el('button', {
      className: 'overlay-secondary-btn hidden',
      type: 'button',
      text: '🔄 Chơi Lại Từ Đầu',
    });
    this.secondaryBtn.addEventListener('click', () => {
      this.callbacks.onRestartGame();
    });

    this.ctaHintEl = el('div', {
      className: 'overlay-cta-hint',
      text: 'Bấm nút ✕ trên DualSense hoặc Enter để bắt đầu',
    });

    const actionsRow = el(
      'div',
      { className: 'overlay-actions' },
      this.primaryBtn,
      this.secondaryBtn,
    );

    this.cardEl = el(
      'div',
      { className: 'overlay-card' },
      this.titleEl,
      this.subtitleEl,
      this.newBestBadge,
      this.praiseEl,
      this.eatenByBannerEl,
      this.statsGrid,
      this.scoreSublineEl,
      this.controllerLine,
      this.huntTipEl,
      this.setupSection,
      this.guideSection,
      actionsRow,
      this.ctaHintEl,
    );

    this.rootEl = el('div', { id: 'overlay' }, this.cardEl);
    parent.appendChild(this.rootEl);
    this.renderSelections();
  }

  getSelectedMode(): GameMode {
    return this.selectedMode;
  }

  getSelectedDifficulty(): Difficulty {
    return this.selectedDifficulty;
  }

  getSelectedPlayerName(): string {
    const trimmed = this.playerNameInput.value.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 16) : DEFAULT_PLAYER_NAME;
  }

  setTheme(theme: VisualTheme): void {
    this.selectedTheme = theme;
    this.renderSelections();
  }

  syncController(status: ControllerStatus): void {
    this.controllerLine.classList.toggle('connected', status.connected);
    this.controllerLine.classList.toggle('disconnected', !status.connected);
    this.controllerLine.textContent = status.connected
      ? status.isDualSense
        ? '🎮 DualSense đã sẵn sàng! Bé có thể bấm ✕ để bắt đầu ngay.'
        : `🎮 ${status.controllerName || 'Tay cầm'} đã kết nối! Bấm ✕ để bắt đầu.`
      : '🎮 Cắm/Bluetooth DualSense & bấm nút bất kỳ (hoặc dùng Phím)';
  }

  showReady(): void {
    this.currentPhase = 'ready';
    this.rootEl.dataset['mode'] = this.selectedMode;
    this.rootEl.dataset['difficulty'] = this.selectedDifficulty;
    this.titleEl.textContent = '✨ Vương Quốc Rắn Phép Thuật 3D';
    this.subtitleEl.textContent = 'Thế Giới Mở Săn Bot 360° cùng tay cầm DualSense trên macOS';
    this.subtitleEl.classList.remove('hidden');
    this.praiseEl.classList.add('hidden');
    this.eatenByBannerEl.classList.add('hidden');
    this.newBestBadge.classList.add('hidden');
    this.statsGrid.classList.add('hidden');
    this.scoreSublineEl.classList.add('hidden');
    this.controllerLine.classList.remove('hidden');
    this.huntTipEl.classList.remove('hidden');
    this.nicknameRow.classList.remove('hidden');
    this.setupSection.classList.remove('hidden');
    this.guideSection.classList.remove('hidden');
    this.secondaryBtn.classList.add('hidden');
    this.primaryBtn.textContent = '✨ Bắt Đầu Phiêu Lưu!';
    this.ctaHintEl.textContent = 'Bấm ✕ trên DualSense hoặc Enter để bắt đầu ngay!';
    this.renderSelections();
    this.rootEl.classList.remove('hidden');
  }

  showPaused(state: GameState): void {
    this.currentPhase = 'paused';
    this.stateMode = state.mode;
    this.stateDifficulty = state.difficulty;
    this.statePlayerName = state.playerName;
    this.titleEl.textContent = '⏸ Tạm Dừng Phiêu Lưu';
    this.subtitleEl.classList.add('hidden');
    this.newBestBadge.classList.add('hidden');
    this.eatenByBannerEl.classList.add('hidden');
    this.statsGrid.classList.add('hidden');
    this.scoreSublineEl.classList.add('hidden');
    this.controllerLine.classList.add('hidden');
    this.huntTipEl.classList.add('hidden');
    this.setupSection.classList.add('hidden');
    this.guideSection.classList.add('hidden');
    this.praiseEl.textContent = `${state.playerName} đang ở Hạng #${state.playerRank} (Lv.${state.level} • 🐍 x${state.botsEaten}) — Nghỉ tay một chút nhé ✨`;
    this.praiseEl.classList.remove('hidden');
    this.primaryBtn.textContent = '▶ Tiếp Tục Chơi (✕ / P)';
    this.secondaryBtn.textContent = '🔄 Chơi Lại Từ Đầu';
    this.secondaryBtn.classList.remove('hidden');
    this.ctaHintEl.textContent = 'Bấm Options / P / Esc hoặc ✕ để tiếp tục';
    this.rootEl.classList.remove('hidden');
  }

  showGameOver(state: GameState, isNewBest: boolean): void {
    this.currentPhase = 'gameover';
    this.stateMode = state.mode;
    this.stateDifficulty = state.difficulty;
    this.statePlayerName = state.playerName;
    this.selectedMode = state.mode;
    this.selectedDifficulty = state.difficulty;

    if (state.won) {
      this.titleEl.textContent = '👑 Chiến Thắng Vương Quốc!';
      this.praiseEl.textContent =
        'Tuyệt đỉnh! Bé đã chinh phục toàn bộ đấu trường Vương Quốc Rắn Phép Thuật 3D!';
    } else if (isNewBest) {
      this.titleEl.textContent = '🌟 Kỷ Lục Mới Tuyệt Vời!';
      this.praiseEl.textContent = 'Bé vừa vượt qua kỷ lục của chính mình đó — siêu xuất sắc!';
    } else {
      this.titleEl.textContent = '🌈 Hành Trình Tuyệt Đẹp!';
      this.praiseEl.textContent = this.encouragingLine(state);
    }

    if (state.eatenByBotName !== null) {
      this.eatenByBannerEl.textContent = '';
      this.eatenByBannerEl.append(
        'Ôi! Bé vừa bị ',
        el('strong', { text: state.eatenByBotName }),
        ' nuốt mất rồi — Lần sau bắn đạn giảm cấp nó trước rồi xử đẹp nhé!',
      );
      this.eatenByBannerEl.classList.remove('hidden');
    } else {
      this.eatenByBannerEl.classList.add('hidden');
    }

    this.subtitleEl.classList.add('hidden');
    this.newBestBadge.classList.toggle('hidden', !isNewBest && !state.won);
    this.newBestBadge.textContent = state.won
      ? '👑 CHIẾN THẮNG TOÀN BỘ SÂN CHƠI! 👑'
      : '★ KỶ LỤC MỚI CỦA BÉ! ★';

    this.rankValEl.textContent = `#${state.playerRank}`;
    this.levelValEl.textContent = `Lv.${state.level}`;
    this.botsValEl.textContent = `🐍 x${state.botsEaten}`;
    this.questsValEl.textContent = String(state.questsSolved);
    this.scoreSublineEl.textContent = `✨ Điểm: ${state.score} • 🏆 Kỷ lục: ${state.best}`;

    this.statsGrid.classList.remove('hidden');
    this.scoreSublineEl.classList.remove('hidden');
    this.praiseEl.classList.remove('hidden');
    this.controllerLine.classList.add('hidden');
    this.huntTipEl.classList.add('hidden');
    this.nicknameRow.classList.remove('hidden');
    this.setupSection.classList.remove('hidden');
    this.guideSection.classList.add('hidden');
    this.secondaryBtn.classList.add('hidden');
    this.primaryBtn.textContent = '🔄 Chơi Lại Ngay (✕)';
    this.ctaHintEl.textContent = 'Bấm ✕ trên DualSense hoặc Enter để chơi ván mới!';
    this.renderSelections();
    this.rootEl.classList.remove('hidden');
  }

  hide(): void {
    this.currentPhase = 'playing';
    this.rootEl.classList.add('hidden');
  }

  dispose(): void {
    this.rootEl.remove();
  }

  private handlePrimaryClick(): void {
    if (this.currentPhase === 'paused') {
      this.callbacks.onResumeGame();
      return;
    }
    const playerName = this.getSelectedPlayerName();
    if (
      this.currentPhase === 'gameover' &&
      this.selectedMode === this.stateMode &&
      this.selectedDifficulty === this.stateDifficulty &&
      playerName === this.statePlayerName
    ) {
      this.callbacks.onRestartGame();
      return;
    }
    this.callbacks.onStartGame(this.selectedMode, this.selectedDifficulty, playerName);
  }

  private buildOptionGroup<T extends string>(
    label: string,
    options: readonly OptionMeta<T>[],
    map: Map<T, HTMLButtonElement>,
    onPick: (value: T) => void,
  ): HTMLElement {
    const seg = el('div', { className: 'option-pills' });
    for (const opt of options) {
      const btn = el('button', {
        className: 'option-pill',
        type: 'button',
        text: opt.labelVi,
        title: opt.descVi,
      });
      btn.addEventListener('click', () => {
        onPick(opt.id);
      });
      map.set(opt.id, btn);
      seg.appendChild(btn);
    }
    return el(
      'div',
      { className: 'setup-row' },
      el('div', { className: 'setup-label', text: label }),
      seg,
    );
  }

  private makeStatCard(label: string, valEl: HTMLElement): HTMLElement {
    return el(
      'div',
      { className: 'go-stat-card' },
      el('div', { className: 'go-stat-label', text: label }),
      valEl,
    );
  }

  private renderSelections(): void {
    this.rootEl.dataset['mode'] = this.selectedMode;
    this.rootEl.dataset['difficulty'] = this.selectedDifficulty;
    for (const [id, btn] of this.modeButtons) {
      btn.classList.toggle('active', id === this.selectedMode);
    }
    for (const [id, btn] of this.diffButtons) {
      btn.classList.toggle('active', id === this.selectedDifficulty);
    }
    for (const [id, btn] of this.themeButtons) {
      btn.classList.toggle('active', id === this.selectedTheme);
    }
  }

  private encouragingLine(state: GameState): string {
    if (state.playerRank <= 3) {
      return `Xuất sắc! Bé đạt Hạng #${state.playerRank} với Lv.${state.level} trên bảng xếp hạng! 🏆`;
    }
    if (state.botsEaten >= 5) {
      return `Thợ săn Bot siêu đỉnh! Bé đã nuốt gọn ${state.botsEaten} rắn Bot trong trận vừa rồi! 🐍`;
    }
    if (state.questsSolved >= 2) {
      return 'Trí tuệ siêu phàm! Bé đã giải xuất sắc rất nhiều câu đố +10 Cấp! 🧠';
    }
    if (state.score >= 50) {
      return 'Bé điều khiển rắn 360° khéo lắm! Thử thêm ván nữa để lên Top 1 nhé! 💖';
    }
    return 'Cố lên nhé! Bắn đạn giảm cấp Bot mạnh rồi săn ngọc vàng để lên cấp thật nhanh! 🌸';
  }
}
