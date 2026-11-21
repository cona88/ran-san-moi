import type {
  AgeProfile,
  BoosterKind,
  Difficulty,
  FairySkillKind,
  GameMode,
  SnakeForm,
  VisualTheme,
} from '../core/types';

/** Callbacks invoked by {@link GameUI} when the player interacts with HUD or overlays. */
export interface GameUICallbacks {
  onStartGame(
    mode: GameMode,
    difficulty: Difficulty,
    playerName?: string,
    ageProfile?: AgeProfile,
  ): void;
  onResumeGame(): void;
  onRestartGame(): void;
  onTogglePause(): void;
  onSelectForm(form: SnakeForm): void;
  onActivateBooster(booster: BoosterKind): void;
  onSelectTheme(theme: VisualTheme): void;
  onToggleSound(enabled: boolean): void;
  onToggleMusic(enabled: boolean): void;
  onToggleVibration(enabled: boolean): void;
  onConnectWebHid(): Promise<boolean>;
  onSelectAgeProfile(ageProfile: AgeProfile): void;
  onCastFairySkill(skill: FairySkillKind): void;
  onButterflyHold?(active: boolean): void;
  onSpeakQuest?(): void;
}

/** Initial user preferences passed into {@link GameUI}. */
export interface InitialUISettings {
  readonly mode: GameMode;
  readonly difficulty: Difficulty;
  readonly theme: VisualTheme;
  readonly sound: boolean;
  readonly music: boolean;
  readonly vibration: boolean;
  readonly playerName?: string;
  readonly ageProfile: AgeProfile;
}

export interface OptionMeta<T extends string> {
  readonly id: T;
  readonly labelVi: string;
  readonly shortLabelVi: string;
  readonly emoji: string;
  readonly descVi: string;
}

export const MODE_OPTIONS: readonly OptionMeta<GameMode>[] = [
  {
    id: 'adventure',
    labelVi: 'Phiêu Lưu Thông Minh',
    shortLabelVi: '🌟 Phiêu Lưu',
    emoji: '🌟',
    descVi: 'Thế giới 560×560 rộng gấp 5 • 60 Bot AI • Phiên 5 phút',
  },
  {
    id: 'reflex',
    labelVi: 'Phản Xạ Siêu Tốc',
    shortLabelVi: '⚡ Siêu Tốc',
    emoji: '⚡',
    descVi: 'Nhịp độ cao, thiên thạch cảnh báo & nhiều Bot mạnh',
  },
  {
    id: 'cozy',
    labelVi: 'Thư Giãn Xuyên Tường',
    shortLabelVi: '🧘 Thư Giãn',
    emoji: '🧘',
    descVi: 'Đi xuyên biên cầu vồng, nhẹ nhàng săn ngọc & giải đố',
  },
];

export const DIFFICULTY_OPTIONS: readonly OptionMeta<Difficulty>[] = [
  {
    id: 'easy',
    labelVi: 'Dễ (Làm quen)',
    shortLabelVi: '🌱 Dễ',
    emoji: '🌱',
    descVi: 'Nhịp êm dịu, 4 tim phép thuật',
  },
  {
    id: 'normal',
    labelVi: 'Vừa (Thông minh)',
    shortLabelVi: '⭐ Vừa',
    emoji: '⭐',
    descVi: 'Cân bằng vui nhộn, 3 tim phép thuật',
  },
  {
    id: 'hard',
    labelVi: 'Siêu Anh Hùng Nhí',
    shortLabelVi: '👑 Khó',
    emoji: '👑',
    descVi: 'Nhanh nhạy hơn, thử thách cao thủ',
  },
];

export const THEME_OPTIONS: readonly OptionMeta<VisualTheme>[] = [
  {
    id: 'honeycomb_arena',
    labelVi: 'Tổ Ong Vàng',
    shortLabelVi: '🍯 Tổ Ong',
    emoji: '🍯',
    descVi: 'Đấu trường tổ ong vàng ấm rực rỡ phong cách Snake Clash',
  },
  {
    id: 'crystal_garden',
    labelVi: 'Vườn Pha Lê',
    shortLabelVi: '🌸 Pha Lê',
    emoji: '🌸',
    descVi: 'Pha lê tím hồng & đom đóm lung linh',
  },
  {
    id: 'starlight_galaxy',
    labelVi: 'Ngân Hà Ánh Sao',
    shortLabelVi: '🌌 Ngân Hà',
    emoji: '🌌',
    descVi: 'Bầu trời sao đêm & viền cầu vồng',
  },
  {
    id: 'candy_island',
    labelVi: 'Đảo Kẹo Ngọt',
    shortLabelVi: '🍭 Kẹo Ngọt',
    emoji: '🍭',
    descVi: 'Hồng đào bạc hà ngọt ngào tươi sáng',
  },
];

export function nextThemeAfter(current: VisualTheme): VisualTheme {
  const idx = THEME_OPTIONS.findIndex((t) => t.id === current);
  const next = THEME_OPTIONS[(idx + 1) % THEME_OPTIONS.length];
  return next ? next.id : 'honeycomb_arena';
}

export function themeLabelVi(theme: VisualTheme): string {
  return THEME_OPTIONS.find((t) => t.id === theme)?.labelVi ?? '🍯 Tổ Ong Vàng';
}
