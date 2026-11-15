/**
 * Pure domain types for "Vương Quốc Rắn Phép Thuật 3D" — Open-World Bot Hunt.
 *
 * Nothing in `src/core` may import from the browser, the DOM or Three.js —
 * the entire simulation is deterministic and headless so it can be unit-tested
 * in milliseconds.
 */

/** Tọa độ thực liên tục trên mặt phẳng thế giới mở X/Z (`-worldRadius .. +worldRadius`). */
export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

/** Giữ alias `Cell = Vec2` để tương thích hoàn toàn với `projectCell(pos: Cell)` và các sự kiện. */
export type Cell = Vec2;

export type Direction = 'up' | 'down' | 'left' | 'right';
export type GamePhase = 'ready' | 'playing' | 'paused' | 'gameover';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type GameMode = 'adventure' | 'reflex' | 'cozy';
export type VisualTheme =
  'honeycomb_arena' | 'crystal_garden' | 'starlight_galaxy' | 'candy_island';

/** 4 Hình dạng phép thuật để bé biến hình chiến thuật */
export type SnakeForm = 'dragon' | 'phoenix' | 'unicorn' | 'spirit';
export const SNAKE_FORMS: readonly SnakeForm[] = ['dragon', 'phoenix', 'unicorn', 'spirit'];

export interface FormMetadata {
  readonly id: SnakeForm;
  readonly nameVi: string;
  readonly emoji: string;
  readonly weaponNameVi: string;
  readonly perkVi: string;
  readonly hexColor: number;
  readonly cssColor: string;
  readonly lightbarRgb: readonly [number, number, number];
}

export type BotSkin =
  'gold_armor' | 'ruby_flame' | 'lime_viper' | 'dragon' | 'phoenix' | 'unicorn' | 'spirit';

export type BoosterKind = 'level' | 'speed' | 'magnet';

export interface BoosterSlot {
  readonly charges: number; // 0..3
  readonly activeTicks: number; // >0 khi đang kích hoạt (speed/magnet)
  readonly maxTicks: number;
}

export type BoostersState = Readonly<Record<BoosterKind, BoosterSlot>>;

export interface AbsorbedBotPower {
  readonly form: SnakeForm;
  readonly titleVi: string;
  readonly ticksRemaining: number;
  readonly maxTicks: number;
}

export interface WorldOrb {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly value: number;
  readonly colorHex: number;
  readonly isLoot: boolean;
}

export interface BotSnake {
  readonly id: number;
  readonly name: string;
  readonly skin: BotSkin;
  readonly isBoss: boolean;
  readonly level: number;
  readonly head: Vec2;
  readonly prevHead: Vec2;
  readonly heading: number; // góc radian Math.atan2(dz, dx)
  readonly spine: readonly Vec2[];
  readonly prevSpine: readonly Vec2[];
  readonly frozenTicks: number;
  readonly powerForm: SnakeForm;
}

export interface LeaderboardEntry {
  readonly id: string; // 'player' hoặc `bot-${id}`
  readonly rank: number; // 1, 2, 3...
  readonly name: string;
  readonly level: number;
  readonly isPlayer: boolean;
  readonly isBoss: boolean;
}

export interface Projectile {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly prevX: number;
  readonly prevZ: number;
  readonly dx: number; // cos(angle)
  readonly dz: number; // sin(angle)
  readonly form: SnakeForm;
  readonly piercing: boolean;
  readonly ttl: number;
}

export type HazardKind = 'slime' | 'crystal' | 'meteor' | 'element_gate';
export interface Hazard {
  readonly id: number;
  readonly cell: Vec2;
  readonly prevCell: Vec2;
  readonly kind: HazardKind;
  readonly hp: number;
  readonly maxHp: number;
  readonly requiredForm?: SnakeForm;
  readonly frozenTicks: number;
  readonly warningTicks: number;
}

export type QuestKind = 'math' | 'element_match' | 'sequence';
export interface QuestOrb {
  readonly id: number;
  readonly cell: Vec2;
  readonly label: string;
  readonly formColor?: SnakeForm;
  readonly isCorrect: boolean;
  readonly sequenceOrder?: number;
  readonly collected: boolean;
}

export interface BrainQuest {
  readonly id: number;
  readonly kind: QuestKind;
  readonly promptVi: string;
  readonly hintVi: string;
  readonly orbs: readonly QuestOrb[];
  readonly nextSequenceIndex: number;
  readonly targetForm?: SnakeForm;
  readonly rewardScore: number;
  readonly rewardLevels: number; // +8 đến +12 cấp khi giải đúng!
  readonly ticksRemaining: number;
  readonly maxTicks: number;
}

export type GameEventKind =
  | 'eat_food'
  | 'eat_bonus'
  | 'shoot'
  | 'morph'
  | 'dash'
  | 'shield_activate'
  | 'shield_block'
  | 'hazard_hit'
  | 'hazard_destroyed'
  | 'bot_hit'
  | 'bot_eaten'
  | 'eaten_by_bot'
  | 'boss_spawn'
  | 'boss_defeated'
  | 'booster_activate'
  | 'quest_spawn'
  | 'quest_progress'
  | 'quest_complete'
  | 'quest_wrong'
  | 'heart_lost'
  | 'heart_gained'
  | 'level_up'
  | 'gameover';

export interface GameEvent {
  readonly id: number;
  readonly kind: GameEventKind;
  readonly cell?: Vec2;
  readonly form?: SnakeForm;
  readonly points?: number;
  readonly messageVi?: string;
}

export interface RngState {
  readonly seed: number;
}

export interface GameConfig {
  readonly worldRadius: number; // Mặc định 56 (thế giới mở 112x112!)
  readonly maxGrid: number; // = worldRadius * 2 (112)
  readonly startMargin: number; // 0
  readonly maxMargin: number; // 0
  readonly shrinkEvery: number;
  readonly baseTick: number; // 50 (50ms = 20Hz simulation)
  readonly minTick: number; // 50
  readonly tickStep: number;
  readonly baseSpeed: number; // ~0.42 đơn vị/tick
  readonly botCount: number; // 14..16 bot hoạt động cùng lúc
  readonly orbTargetCount: number; // ~170 viên ngọc vàng trên bản đồ
  readonly initialLength: number; // ~10 đốt
  readonly wrapWalls: boolean; // true ở chế độ 'cozy'
  readonly initialHearts: number;
  readonly maxHearts: number;
}

export interface GameState {
  readonly phase: GamePhase;
  readonly mode: GameMode;
  readonly difficulty: Difficulty;
  readonly playerName: string;
  readonly snake: readonly Vec2[];
  readonly prevSnake: readonly Vec2[];
  readonly heading: number;
  readonly targetHeading: number | null;
  readonly direction: Direction;
  readonly queue: readonly Direction[];
  readonly orbs: readonly WorldOrb[];
  readonly food: Vec2;
  readonly bonusFood: Vec2 | null;
  readonly bonusTicks: number;
  readonly bots: readonly BotSnake[];
  readonly botsEaten: number;
  readonly eatenByBotName: string | null;
  readonly bossProgress: number;
  readonly bossTargetLevel: number;
  readonly activeBossId: number | null;
  readonly leaderboard: readonly LeaderboardEntry[];
  readonly playerRank: number;
  readonly crownTarget: Vec2 | null;
  readonly boosters: BoostersState;
  readonly absorbedPower: AbsorbedBotPower | null;
  readonly elapsedTicks: number;
  readonly form: SnakeForm;
  readonly hearts: number;
  readonly maxHearts: number;
  readonly invulnerableTicks: number;
  readonly shieldTicks: number;
  readonly shieldCooldownTicks: number;
  readonly isDashing: boolean;
  readonly dashEnergy: number;
  readonly shootCooldownMs: number;
  readonly score: number;
  readonly best: number;
  readonly combo: number;
  readonly level: number;
  readonly xp: number;
  readonly questsSolved: number;
  readonly enemiesDefeated: number;
  readonly projectiles: readonly Projectile[];
  readonly hazards: readonly Hazard[];
  readonly quest: BrainQuest | null;
  readonly arenaMargin: number;
  readonly pendingShrink: boolean;
  readonly tickInterval: number;
  readonly won: boolean;
  readonly events: readonly GameEvent[];
  readonly eventSeq: number;
  readonly rng: RngState;
  readonly config: GameConfig;
}

export type GameAction =
  | {
      readonly type: 'start';
      readonly mode?: GameMode;
      readonly difficulty?: Difficulty;
      readonly playerName?: string;
    }
  | { readonly type: 'steer'; readonly angle: number | null }
  | { readonly type: 'turn'; readonly direction: Direction }
  | { readonly type: 'tick' }
  | { readonly type: 'projectile_step'; readonly dtMs?: number }
  | { readonly type: 'shoot' }
  | { readonly type: 'morph'; readonly form?: SnakeForm; readonly delta?: 1 | -1 }
  | { readonly type: 'dash'; readonly active: boolean }
  | { readonly type: 'shield' }
  | { readonly type: 'activate_booster'; readonly booster: BoosterKind }
  | { readonly type: 'pause' }
  | { readonly type: 'resume' }
  | {
      readonly type: 'reset';
      readonly mode?: GameMode;
      readonly difficulty?: Difficulty;
      readonly playerName?: string;
    };
