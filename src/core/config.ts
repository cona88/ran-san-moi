import type { Difficulty, FormMetadata, GameConfig, GameMode, SnakeForm, SprayKind } from './types';

/** Map each magical snake form to its elemental spray/breath power. */
export function sprayKindForForm(form: SnakeForm): SprayKind {
  switch (form) {
    case 'dragon':
      return 'fire';
    case 'phoenix':
      return 'ice';
    case 'unicorn':
      return 'water';
    case 'spirit':
      return 'silk';
  }
}

/** Metadata for the 4 tactical magical snake forms. */
export const FORM_METADATA: Record<SnakeForm, FormMetadata> = {
  dragon: {
    id: 'dragon',
    sprayKind: 'fire',
    nameVi: '🌸 Rồng Tinh Tú',
    emoji: '🌸',
    weaponNameVi: '🔥 Phun Lửa Rồng',
    perkVi: 'Phun luồng lửa rồng rực cháy thiêu đốt & đẩy lùi Bot phía trước!',
    hexColor: 0xff5ec4,
    cssColor: '#ff5ec4',
    lightbarRgb: [255, 94, 196],
  },
  phoenix: {
    id: 'phoenix',
    sprayKind: 'ice',
    nameVi: '🦋 Phượng Hoàng Băng',
    emoji: '🦋',
    weaponNameVi: '❄️ Phun Băng Giá',
    perkVi: 'Phun bão băng 3 luồng đóng băng cứng Bot & quái vật!',
    hexColor: 0x38f6ff,
    cssColor: '#38f6ff',
    lightbarRgb: [56, 246, 255],
  },
  unicorn: {
    id: 'unicorn',
    sprayKind: 'water',
    nameVi: '⚡ Kỳ Lân Ánh Sáng',
    emoji: '⚡',
    weaponNameVi: '🌊 Phun Nước Xoáy',
    perkVi: 'Phun vòi rồng nước xoáy xuyên thấu đẩy lùi Bot & hút ngọc rộng!',
    hexColor: 0xffd447,
    cssColor: '#ffd447',
    lightbarRgb: [255, 212, 71],
  },
  spirit: {
    id: 'spirit',
    sprayKind: 'silk',
    nameVi: '🍀 Tinh Linh Rừng Xanh',
    emoji: '🍀',
    weaponNameVi: '🕸️ Phun Tơ Phép',
    perkVi: 'Phun tơ nhện óng ánh giăng lưới trói chân Bot, phá quái & bọc kẹo thưởng!',
    hexColor: 0x4dff9a,
    cssColor: '#4dff9a',
    lightbarRgb: [77, 255, 154],
  },
};

/** Default play session length: 5 minutes (300,000 ms). */
export const DEFAULT_SESSION_DURATION_MS = 5 * 60 * 1000;

/** Default radius for fairy sanctuary shelter houses (~14 units). */
export const DEFAULT_SHELTER_RADIUS = 14;

/** Interval between monster calamity events: ~55s (1100 ticks @ 20Hz). */
export const DEFAULT_MONSTER_INTERVAL_TICKS = 1100;

/** Warning phase before monster calamity strike: 8s (160 ticks @ 20Hz). */
export const DEFAULT_MONSTER_WARNING_TICKS = 160;

/** Duration of the calamity strike phase: 1s (20 ticks @ 20Hz). */
export const DEFAULT_MONSTER_STRIKE_TICKS = 20;

/** Total simulation ticks in a play session for `config`. */
export function getSessionTotalTicks(config: GameConfig): number {
  const durationMs = config.sessionDurationMs ?? DEFAULT_SESSION_DURATION_MS;
  return Math.max(1, Math.round(durationMs / Math.max(1, config.baseTick)));
}

/** Normal difficulty in adventure mode — open-world 560x560 (5x) Snake Clash ruleset, 5-minute session. */
const BASE: GameConfig = {
  worldRadius: 280,
  maxGrid: 560,
  startMargin: 0,
  maxMargin: 0,
  shrinkEvery: 20,
  baseTick: 50,
  minTick: 50,
  tickStep: 0,
  baseSpeed: 0.42,
  botCount: 60,
  orbTargetCount: 850,
  initialLength: 10,
  wrapWalls: false,
  initialHearts: 3,
  maxHearts: 5,
  sessionDurationMs: DEFAULT_SESSION_DURATION_MS,
  shelterRadius: DEFAULT_SHELTER_RADIUS,
  monsterEventIntervalTicks: DEFAULT_MONSTER_INTERVAL_TICKS,
  monsterWarningTicks: DEFAULT_MONSTER_WARNING_TICKS,
  monsterStrikeTicks: DEFAULT_MONSTER_STRIKE_TICKS,
};

const PRESETS: Record<Difficulty, GameConfig> = {
  easy: {
    ...BASE,
    baseSpeed: 0.38,
    botCount: 55,
    orbTargetCount: 975,
    initialHearts: 4,
    maxHearts: 5,
  },
  normal: { ...BASE },
  hard: {
    ...BASE,
    baseSpeed: 0.48,
    botCount: 65,
    initialHearts: 3,
    maxHearts: 4,
  },
};

/** Pacing, bot speed, and fairy-skill responsiveness tuned per difficulty. */
export interface DifficultyTuning {
  readonly botSpeedScale: number;
  readonly fairyCooldownScale: number;
  readonly fairyCooldownBonusRecovery: number;
  readonly butterflyChargeBonusRegen: number;
  readonly nearLowBotCount: number;
  readonly nearLowMinDist: number;
  readonly nearLowMaxDist: number;
}

const DIFFICULTY_TUNING: Record<Difficulty, DifficultyTuning> = {
  easy: {
    botSpeedScale: 0.7,
    fairyCooldownScale: 0.55,
    fairyCooldownBonusRecovery: 1,
    butterflyChargeBonusRegen: 1.2,
    nearLowBotCount: 10,
    nearLowMinDist: 9.5,
    nearLowMaxDist: 17.5,
  },
  normal: {
    botSpeedScale: 0.92,
    fairyCooldownScale: 1,
    fairyCooldownBonusRecovery: 0,
    butterflyChargeBonusRegen: 0,
    nearLowBotCount: 8,
    nearLowMinDist: 9.5,
    nearLowMaxDist: 18.0,
  },
  hard: {
    botSpeedScale: 1,
    fairyCooldownScale: 1,
    fairyCooldownBonusRecovery: 0,
    butterflyChargeBonusRegen: 0,
    nearLowBotCount: 6,
    nearLowMinDist: 10.5,
    nearLowMaxDist: 20.0,
  },
};

/** Resolve extra difficulty pacing values beyond the core GameConfig shape. */
export function difficultyTuningFor(difficulty: Difficulty): DifficultyTuning {
  return DIFFICULTY_TUNING[difficulty];
}

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
        botCount: 45,
        orbTargetCount: 925,
        initialHearts: Math.max(preset.initialHearts, 4),
        maxHearts: 5,
      };
    case 'reflex':
      return {
        ...preset,
        wrapWalls: false,
        baseSpeed: Number((preset.baseSpeed * 1.16).toFixed(3)),
        botCount: 65,
        orbTargetCount: 850,
      };
  }
}
