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

export type SprayKind = 'fire' | 'ice' | 'water' | 'silk';

export interface FormMetadata {
  readonly id: SnakeForm;
  readonly sprayKind: SprayKind;
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

export type FairySkillKind = 'flower' | 'butterfly' | 'thunder' | 'fire' | 'water' | 'arcane';
export type AoeElement = 'thunder' | 'fire' | 'water' | 'arcane';
export type ButterflyStage = 'caterpillar' | 'cocoon' | 'butterfly';

export interface AoeBlast {
  readonly id: number;
  readonly element: AoeElement;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly ttl: number;
  readonly maxTtl: number;
}

export interface GardenFlower {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly colorVariant: 0 | 1 | 2 | 3;
  readonly scale: number;
  readonly ticksRemaining: number;
  readonly maxTicks: number;
}

export interface SkyLightningBolt {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly colorHex: number;
  readonly ttl: number;
  readonly maxTtl: number;
}

export interface FrostZone {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly ticksRemaining: number;
  readonly maxTicks: number;
}

export type ShelterKind =
  'castle' | 'mushroom' | 'crystal' | 'mermaid' | 'candy' | 'blossom' | 'starlight';

/** Fairy Princess transformation stages (snake ↔ beautiful flying fairy princess). */
export type PrincessStage = 'snake' | 'transforming' | 'princess' | 'returning';

export type GuardianFairyKind = 'blossom' | 'starlight' | 'crystal' | 'rainbow';
export type GuardianFairyPhase = 'idle' | 'arriving' | 'escorting' | 'departing';

export interface GuardianFairyState {
  readonly phase: GuardianFairyPhase;
  readonly kind: GuardianFairyKind;
  readonly nameVi: string;
  readonly emoji: string;
  readonly blessingVi: string;
  readonly colorHex: number;
  readonly accentHex: number;
  readonly pos: Vec2;
  readonly altitude: number;
  readonly heading: number;
  readonly ticksRemaining: number;
  readonly maxTicks: number;
  readonly ticksUntilNextVisit: number;
  readonly distanceTraveled: number;
  readonly visitCount: number;
  readonly blessingPulseTick: number;
}

export interface ShelterHouse {
  readonly id: string;
  readonly kind: ShelterKind;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly nameVi: string;
  readonly colorHex: number;
}

export type MonsterEventPhase = 'idle' | 'warning' | 'strike';

export interface MonsterEventState {
  readonly phase: MonsterEventPhase;
  readonly ticksRemaining: number;
  readonly maxTicks: number;
  readonly countdownSec: number;
  readonly progress: number;
  readonly monsterPos: Vec2;
  readonly monsterHeading: number;
  readonly monsterSpeed: number;
  readonly distanceToPlayer: number;
  readonly isChasing: boolean;
  readonly isBlockedByShelter: boolean;
  readonly targetShelterId: string | null;
}

export type RoamingMonsterKind = 'sea_beast' | 'forest_golem' | 'candy_troll';

export interface RoamingMonster {
  readonly id: number;
  readonly kind: RoamingMonsterKind;
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
  readonly hp: number;
  readonly frozenTicks: number;
}

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
  readonly maxLevel?: number;
  readonly chompedTicks?: number;
  readonly bittenSegments?: number;
  readonly head: Vec2;
  readonly prevHead: Vec2;
  readonly heading: number; // góc radian Math.atan2(dz, dx)
  readonly spine: readonly Vec2[];
  readonly prevSpine: readonly Vec2[];
  readonly frozenTicks: number;
  readonly powerForm: SnakeForm;
  /** Thử Thách Sinh Tồn: ticks until the bot may cast again. */
  readonly magicCooldownTicks?: number;
  /** >0 = telegraphing a spell (player can react). */
  readonly magicWarningTicks?: number;
  readonly magicSpell?: BotMagicKind;
}

export type BotMagicKind = 'bolt' | 'fire_spread' | 'frost_orb' | 'arcane_homing';

export interface HostileProjectile {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly prevX: number;
  readonly prevZ: number;
  readonly dx: number;
  readonly dz: number;
  readonly kind: BotMagicKind;
  readonly ownerBotId: number;
  readonly ttl: number;
  readonly maxTtl: number;
}

export interface LeaderboardEntry {
  readonly id: string; // 'player' hoặc `bot-${id}`
  readonly rank: number; // 1, 2, 3...
  readonly name: string;
  readonly level: number;
  readonly isPlayer: boolean;
  readonly isBoss: boolean;
}

export interface SilkWebZone {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly ticksRemaining: number;
  readonly maxTicks: number;
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
  readonly sprayKind: SprayKind;
  readonly piercing: boolean;
  readonly ttl: number;
  readonly maxTtl: number;
  readonly hitBotIds?: readonly number[];
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

export type AgeProfile = 'age6' | 'age9';

export type QuestKind = 'letter_match' | 'word_spell' | 'math' | 'element_match' | 'sequence';

export type QuestRewardEffect =
  | 'form_dragon'
  | 'form_phoenix'
  | 'form_unicorn'
  | 'form_spirit'
  | 'item_shield'
  | 'item_magnet'
  | 'item_speed'
  | 'item_heart'
  | 'item_giant'
  | 'fairy_butterfly'
  | 'fairy_flower_garden'
  | 'fairy_thunder_storm'
  | 'aoe_fire_nova'
  | 'aoe_water_tsunami'
  | 'aoe_arcane_nova';
export interface QuestOrb {
  readonly id: number;
  readonly cell: Vec2;
  readonly label: string;
  readonly subLabel?: string;
  readonly spokenVi?: string;
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
  readonly iconEmoji?: string;
  readonly targetWord?: string;
  readonly wordSlots?: readonly string[];
  readonly rewardEffect?: QuestRewardEffect;
  readonly rewardIconVi?: string;
  readonly speechVi?: string;
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
  | 'bot_chomp'
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
  | 'gameover'
  | 'flower_bloom'
  | 'flower_charm'
  | 'cocoon_start'
  | 'butterfly_emerge'
  | 'butterfly_land'
  | 'butterfly_frost'
  | 'sky_thunder'
  | 'aoe_fire'
  | 'aoe_water'
  | 'aoe_arcane'
  | 'monster_warning'
  | 'monster_strike'
  | 'shelter_enter'
  | 'shelter_exit'
  | 'shelter_discovered'
  | 'fairy_visit_start'
  | 'fairy_blessing'
  | 'fairy_visit_end'
  | 'princess_transform'
  | 'princess_reveal'
  | 'princess_return'
  | 'princess_tour_start'
  | 'princess_tour_lap'
  | 'bot_shoot'
  | 'bot_spell_cast'
  | 'player_hit_by_magic';

export interface GameEvent {
  readonly id: number;
  readonly kind: GameEventKind;
  readonly cell?: Vec2;
  readonly form?: SnakeForm;
  readonly points?: number;
  readonly chompStreak?: number;
  readonly messageVi?: string;
  readonly shelterId?: string;
  readonly spell?: BotMagicKind;
}

export interface RngState {
  readonly seed: number;
}

export interface GameConfig {
  readonly worldRadius: number; // Mặc định 280 (thế giới mở 560x560 — gấp 5 lần!)
  readonly maxGrid: number; // = worldRadius * 2 (560)
  readonly startMargin: number; // 0
  readonly maxMargin: number; // 0
  readonly shrinkEvery: number;
  readonly baseTick: number; // 50 (50ms = 20Hz simulation)
  readonly minTick: number; // 50
  readonly tickStep: number;
  readonly baseSpeed: number; // ~0.42 đơn vị/tick
  readonly botCount: number; // 45..65 bot hoạt động cùng lúc
  readonly orbTargetCount: number; // ~850 viên ngọc vàng trên bản đồ 560x560
  readonly initialLength: number; // ~10 đốt
  readonly wrapWalls: boolean; // true ở chế độ 'cozy'
  readonly initialHearts: number;
  readonly maxHearts: number;
  readonly sessionDurationMs?: number; // Thời lượng 1 phiên chơi (mặc định 5 phút = 300_000 ms)
  readonly shelterRadius?: number; // Bán kính trú ẩn an toàn (~14 units)
  readonly monsterEventIntervalTicks?: number; // Chu kỳ quái vật (~50-60s = 1000..1200 ticks)
  readonly monsterWarningTicks?: number; // Thời gian cảnh báo quái vật (~8s = 160 ticks)
  readonly monsterStrikeTicks?: number; // Thời gian bão sét quái vật giáng (~1s = 20 ticks)
}

export interface GameState {
  readonly phase: GamePhase;
  readonly mode: GameMode;
  readonly difficulty: Difficulty;
  readonly ageProfile: AgeProfile;
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
  readonly chompStreak: number;
  readonly chompStreakTicks: number;
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
  readonly sprayActiveTicks: number;
  readonly score: number;
  readonly best: number;
  readonly combo: number;
  readonly level: number;
  readonly xp: number;
  readonly questsSolved: number;
  readonly enemiesDefeated: number;
  readonly projectiles: readonly Projectile[];
  readonly hostileProjectiles: readonly HostileProjectile[];
  readonly playerSlowTicks: number;
  readonly silkWebs: readonly SilkWebZone[];
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
  readonly butterflyStage: ButterflyStage;
  readonly butterflyCharge: number;
  readonly butterflyTicks: number;
  readonly butterflyAltitude: number;
  readonly butterflyLanding: boolean;
  readonly butterflyHold: boolean;
  readonly butterflyLandingFromHold?: boolean;
  readonly flowerCooldownTicks: number;
  readonly thunderCooldownTicks: number;
  readonly fireCooldownTicks: number;
  readonly waterCooldownTicks: number;
  readonly arcaneCooldownTicks: number;
  readonly gardenFlowers: readonly GardenFlower[];
  readonly lightningBolts: readonly SkyLightningBolt[];
  readonly aoeBlasts: readonly AoeBlast[];
  readonly frostZones: readonly FrostZone[];
  readonly shelters: readonly ShelterHouse[];
  readonly discoveredShelterIds: readonly string[];
  readonly roamingMonsters: readonly RoamingMonster[];
  readonly monsterEvent: MonsterEventState;
  readonly inShelter: boolean;
  readonly currentShelterId: string | null;
  readonly shelteredTicks: number;
  readonly shelterHealUsedId: string | null;
  readonly guardianFairy: GuardianFairyState;
  readonly princessStage: PrincessStage;
  readonly princessTicks: number;
  readonly princessMaxTicks: number;
  readonly princessAltitude: number;
  readonly princessCooldownTicks: number;
  readonly princessTourShelterId: string | null;
  readonly princessTourAngle: number;
  readonly princessTourLaps: number;
}

export type GameAction =
  | {
      readonly type: 'start';
      readonly mode?: GameMode;
      readonly difficulty?: Difficulty;
      readonly playerName?: string;
      readonly ageProfile?: AgeProfile;
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
      readonly ageProfile?: AgeProfile;
    }
  | { readonly type: 'set_age_profile'; readonly ageProfile: AgeProfile }
  | { readonly type: 'cast_fairy_skill'; readonly skill: FairySkillKind }
  | { readonly type: 'toggle_princess' }
  | { readonly type: 'set_butterfly_hold'; readonly active: boolean };
