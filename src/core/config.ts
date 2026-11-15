import type { Difficulty, FormMetadata, GameConfig, GameMode, SnakeForm } from './types';

/** Metadata for the 4 tactical magical snake forms. */
export const FORM_METADATA: Record<SnakeForm, FormMetadata> = {
  dragon: {
    id: 'dragon',
    nameVi: '🌸 Rồng Tinh Tú',
    emoji: '🌸',
    weaponNameVi: 'Đạn Sao Băng',
    perkVi: 'Bắn Đạn Sao Băng mạnh mẽ hạ cấp Bot & quái phía trước!',
    hexColor: 0xff5ec4,
    cssColor: '#ff5ec4',
    lightbarRgb: [255, 94, 196],
  },
  phoenix: {
    id: 'phoenix',
    nameVi: '🦋 Phượng Hoàng Băng',
    emoji: '🦋',
    weaponNameVi: 'Sóng Băng 3 Tia',
    perkVi: 'Phóng 3 tia băng hình quạt làm đóng băng Bot & quái vật!',
    hexColor: 0x38f6ff,
    cssColor: '#38f6ff',
    lightbarRgb: [56, 246, 255],
  },
  unicorn: {
    id: 'unicorn',
    nameVi: '⚡ Kỳ Lân Ánh Sáng',
    emoji: '⚡',
    weaponNameVi: 'Tia Chớp Tự Tìm',
    perkVi: 'Tia Chớp xuyên thấu tự tìm mục tiêu & nam châm hút ngọc rộng!',
    hexColor: 0xffd447,
    cssColor: '#ffd447',
    lightbarRgb: [255, 212, 71],
  },
  spirit: {
    id: 'spirit',
    nameVi: '🍀 Tinh Linh Rừng Xanh',
    emoji: '🍀',
    weaponNameVi: 'Bom Hoa Nở Vùng Rộng',
    perkVi: 'Hạt giống nổ vùng rộng phá cụm quái, trừ cấp Bot & nở kẹo thưởng!',
    hexColor: 0x4dff9a,
    cssColor: '#4dff9a',
    lightbarRgb: [77, 255, 154],
  },
};

/** Normal difficulty in adventure mode — open-world 112x112 Snake Clash ruleset. */
const BASE: GameConfig = {
  worldRadius: 56,
  maxGrid: 112,
  startMargin: 0,
  maxMargin: 0,
  shrinkEvery: 20,
  baseTick: 50,
  minTick: 50,
  tickStep: 0,
  baseSpeed: 0.42,
  botCount: 15,
  orbTargetCount: 170,
  initialLength: 10,
  wrapWalls: false,
  initialHearts: 3,
  maxHearts: 5,
};

const PRESETS: Record<Difficulty, GameConfig> = {
  easy: {
    ...BASE,
    baseSpeed: 0.38,
    botCount: 14,
    initialHearts: 4,
    maxHearts: 5,
  },
  normal: { ...BASE },
  hard: {
    ...BASE,
    baseSpeed: 0.48,
    botCount: 16,
    initialHearts: 3,
    maxHearts: 4,
  },
};

/** The default ruleset (normal difficulty, adventure mode). */
export const DEFAULT_CONFIG: GameConfig = PRESETS.normal;

/** Resolve the ruleset for a difficulty preset and optional game mode. */
export function configFor(difficulty: Difficulty, mode: GameMode = 'adventure'): GameConfig {
  const preset = PRESETS[difficulty];
  switch (mode) {
    case 'adventure':
      return preset;
    case 'cozy':
      return {
        ...preset,
        wrapWalls: true,
        baseSpeed: Number((preset.baseSpeed * 0.88).toFixed(3)),
        botCount: 10,
        orbTargetCount: 185,
        initialHearts: Math.max(preset.initialHearts, 4),
        maxHearts: 5,
      };
    case 'reflex':
      return {
        ...preset,
        wrapWalls: false,
        baseSpeed: Number((preset.baseSpeed * 1.16).toFixed(3)),
        botCount: 16,
        orbTargetCount: 170,
      };
  }
}
