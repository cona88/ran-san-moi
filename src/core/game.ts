import {
  SNAKE_FORMS,
  type AgeProfile,
  type BoosterKind,
  type BoostersState,
  type Difficulty,
  type GameAction,
  type GameConfig,
  type GameMode,
  type GamePhase,
  type GameState,
  type Vec2,
} from './types';
import {
  DEFAULT_CONFIG,
  FORM_METADATA,
  configFor,
  difficultyTuningFor,
  getSessionTotalTicks,
} from './config';
import { createRng } from './rng';
import {
  angleDiff,
  angleToDirection,
  clamp,
  directionToAngle,
  normalizeAngle,
} from './systems/arena';
import { minDistanceToChain } from './systems/collision';
import { nearestOrbPos, replenishWorldOrbs } from './systems/food';
import {
  advanceSpineFollowLeader,
  buildStraightSpine,
  matchSpineLength,
  targetPlayerLength,
} from './movement';
import { maybeSpawnHazard, stepHazards } from './hazards';
import {
  appendEvents,
  applyQuestOrbHit,
  applyXpAndScore,
  maybeSpawnQuest,
  spawnQuest,
  spawnStarterQuest,
  tickQuest,
  type EventDraft,
} from './quests';
import {
  SPRAY_ACTIVE_TICKS,
  shootCooldownForForm,
  spawnProjectilesForForm,
  stepProjectiles,
  stepSilkWebs,
} from './projectiles';
import {
  botCollisionRadius,
  chompBotByPlayer,
  computeLeaderboard,
  createInitialBots,
  repelBotFrom,
  replenishBots,
  spawnBossBot,
  stepBots,
} from './bots';
import { castFairySkill, setButterflyHold, stepFairyMagic } from './fairyMagic';
import { createInitialGuardianFairy, stepGuardianFairy } from './guardianFairy';
import {
  applyBotShelterFlee,
  createInitialMonsterEvent,
  createInitialRoamingMonsters,
  createInitialShelters,
  findCurrentShelter,
  resolveMonsterCalamityStrike,
  SHELTER_DISCOVERY_SCORE,
  stepMonsterEvent,
  stepRoamingMonsters,
} from './shelter';

const TURN_SPEED_RAD = 0.34;
const WORLD_EDGE_PAD = 0.8;
const INITIAL_PLAYER_LEVEL = 5;
const INITIAL_BOSS_TARGET_LEVEL = 25;

export interface NewGameOptions {
  readonly config?: GameConfig;
  readonly difficulty?: Difficulty;
  readonly mode?: GameMode;
  readonly playerName?: string;
  readonly best?: number;
  readonly seed?: number;
  readonly ageProfile?: AgeProfile;
}

/** Create fresh booster slots for the start of a run (`level: 1`, `speed: 2`, `magnet: 2`). */
export function createInitialBoosters(): BoostersState {
  return {
    level: { charges: 1, activeTicks: 0, maxTicks: 1 },
    speed: { charges: 2, activeTicks: 0, maxTicks: 160 },
    magnet: { charges: 2, activeTicks: 0, maxTicks: 200 },
  };
}

const FAIRY_COOLDOWN_KEYS = [
  'flowerCooldownTicks',
  'thunderCooldownTicks',
  'fireCooldownTicks',
  'waterCooldownTicks',
  'arcaneCooldownTicks',
] as const;

const RECOVERY_COOLDOWN_KEYS = ['shieldCooldownTicks', ...FAIRY_COOLDOWN_KEYS] as const;

function withStarterQuest(state: GameState): GameState {
  if (state.mode !== 'adventure' && state.difficulty !== 'easy' && state.difficulty !== 'normal') {
    return state;
  }
  const starter = spawnStarterQuest(state, state.rng);
  return {
    ...state,
    quest: starter.quest,
    rng: starter.rng,
  };
}

function scaleNewlyStartedFairyCooldowns(
  prev: GameState,
  next: GameState,
  scale: number,
): GameState {
  if (scale >= 1) return next;
  let patched: GameState | null = null;
  for (const key of FAIRY_COOLDOWN_KEYS) {
    if (prev[key] === 0 && next[key] > 0) {
      patched = {
        ...(patched ?? next),
        [key]: Math.max(1, Math.ceil(next[key] * scale)),
      };
    }
  }
  return patched ?? next;
}

function applyDifficultyMagicRecovery(state: GameState): GameState {
  const tuning = difficultyTuningFor(state.difficulty);
  const rec = tuning.fairyCooldownBonusRecovery;
  const bonusCharge = state.butterflyStage === 'caterpillar' ? tuning.butterflyChargeBonusRegen : 0;
  if (rec <= 0 && bonusCharge <= 0) return state;

  let patched: GameState = state;
  if (bonusCharge > 0) {
    patched = {
      ...patched,
      butterflyCharge: Math.min(100, Number((patched.butterflyCharge + bonusCharge).toFixed(2))),
    };
  }
  if (rec > 0) {
    for (const key of RECOVERY_COOLDOWN_KEYS) {
      if (patched[key] > 0) {
        patched = { ...patched, [key]: Math.max(0, patched[key] - rec) };
      }
    }
  }
  return patched;
}

/** Current orb magnet pickup radius for the player snake. */
export function getMagnetRadius(state: GameState): number {
  let radius = state.ageProfile === 'age6' ? 2.05 : 1.45;
  if (state.butterflyStage === 'butterfly') {
    radius = Math.max(radius, 6.8);
  }
  if (state.form === 'unicorn') {
    radius = Math.max(radius, 3.2);
  }
  if (state.absorbedPower?.form === 'unicorn' && state.absorbedPower.ticksRemaining > 0) {
    radius = Math.max(radius, 7.5);
  }
  if (state.boosters.magnet.activeTicks > 0) {
    radius = Math.max(radius, 10.5);
  }
  return radius;
}

function normalizePlayerName(name?: string): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'Bé Tiên';
}

function steerAlongBoundary(raw: Vec2, heading: number, safeRadius: number): number {
  const hitX = Math.abs(raw.x) > safeRadius;
  const hitZ = Math.abs(raw.z) > safeRadius;
  if (hitX && hitZ) {
    return normalizeAngle(Math.atan2(-raw.z, -raw.x));
  }
  let vx = Math.cos(heading);
  let vz = Math.sin(heading);
  if (hitX) {
    vx = raw.x > 0 ? -0.18 : 0.18;
    if (Math.abs(vz) < 0.25) vz = raw.z >= 0 ? -0.92 : 0.92;
  }
  if (hitZ) {
    vz = raw.z > 0 ? -0.18 : 0.18;
    if (Math.abs(vx) < 0.25) vx = raw.x >= 0 ? -0.92 : 0.92;
  }
  return normalizeAngle(Math.atan2(vz, vx));
}

function wrapWorldPos(raw: Vec2, safeRadius: number): Vec2 {
  const span = Math.max(2, safeRadius * 2);
  const wrapAxis = (v: number): number => {
    if (v >= -safeRadius && v <= safeRadius) return v;
    return -safeRadius + ((((v + safeRadius) % span) + span) % span);
  };
  return { x: wrapAxis(raw.x), z: wrapAxis(raw.z) };
}

function pushSnakeAwayFrom(
  snake: readonly Vec2[],
  threatPos: Vec2,
  minDist: number,
  safeRadius: number,
  heading: number,
): { snake: Vec2[]; heading: number } {
  const head = snake[0];
  if (!head) return { snake: [...snake], heading };
  const dx = head.x - threatPos.x;
  const dz = head.z - threatPos.z;
  const dist = Math.hypot(dx, dz);
  const nx = dist > 1e-4 ? dx / dist : -Math.cos(heading);
  const nz = dist > 1e-4 ? dz / dist : -Math.sin(heading);
  const newHead: Vec2 = {
    x: clamp(threatPos.x + nx * minDist, -safeRadius, safeRadius),
    z: clamp(threatPos.z + nz * minDist, -safeRadius, safeRadius),
  };
  const shiftX = newHead.x - head.x;
  const shiftZ = newHead.z - head.z;
  const nextHeading = normalizeAngle(Math.atan2(nz, nx));
  const shifted = snake.map((p) => ({
    x: clamp(p.x + shiftX, -safeRadius, safeRadius),
    z: clamp(p.z + shiftZ, -safeRadius, safeRadius),
  }));
  return { snake: shifted, heading: nextHeading };
}

function syncSnakeLengthToLevel(state: GameState): GameState {
  const targetLen = targetPlayerLength(state.level, state.config.initialLength);
  if (state.snake.length === targetLen) return state;
  const head = state.snake[0];
  if (!head) return state;
  const extended = advanceSpineFollowLeader(state.snake, head, state.heading, targetLen);
  const prevExtended = matchSpineLength(state.prevSnake, targetLen);
  return { ...state, snake: extended, prevSnake: prevExtended };
}

/** Build a fresh open-world board while preserving `best`, `eventSeq`, and advancing `rng`. */
function freshBoard(
  state: GameState,
  phase: GamePhase,
  modeOverride?: GameMode,
  difficultyOverride?: Difficulty,
  playerNameOverride?: string,
  ageProfileOverride?: AgeProfile,
): GameState {
  const mode = modeOverride ?? state.mode;
  const difficulty = difficultyOverride ?? state.difficulty;
  const ageProfile = ageProfileOverride ?? state.ageProfile;
  const playerName =
    playerNameOverride !== undefined ? normalizePlayerName(playerNameOverride) : state.playerName;
  const config =
    modeOverride !== undefined || difficultyOverride !== undefined
      ? configFor(difficulty, mode)
      : state.config;

  const head: Vec2 = { x: 0, z: 0 };
  const snake = buildStraightSpine(head, 0, config.initialLength);
  const prevSnake = snake.map((p) => ({ ...p }));

  const orbRes = replenishWorldOrbs({
    orbs: [],
    config,
    playerHead: head,
    minHeadDist: 1.8,
    rng: state.rng,
  });
  const botRes = createInitialBots({
    config,
    playerHead: head,
    playerLevel: INITIAL_PLAYER_LEVEL,
    difficulty,
    rng: orbRes.rng,
  });
  const food = nearestOrbPos(orbRes.orbs, head, botRes.bots);
  const board = computeLeaderboard({
    playerName,
    playerLevel: INITIAL_PLAYER_LEVEL,
    bots: botRes.bots,
    activeBossId: null,
  });

  return withStarterQuest({
    phase,
    mode,
    difficulty,
    ageProfile,
    playerName,
    snake,
    prevSnake,
    heading: 0,
    targetHeading: null,
    direction: 'right',
    queue: [],
    orbs: orbRes.orbs,
    food,
    bonusFood: null,
    bonusTicks: 0,
    bots: botRes.bots,
    botsEaten: 0,
    chompStreak: 0,
    chompStreakTicks: 0,
    eatenByBotName: null,
    bossProgress: 0,
    bossTargetLevel: INITIAL_BOSS_TARGET_LEVEL,
    activeBossId: null,
    leaderboard: board.leaderboard,
    playerRank: board.playerRank,
    crownTarget: board.crownTarget,
    boosters: createInitialBoosters(),
    absorbedPower: null,
    elapsedTicks: 0,
    form: 'dragon',
    hearts: config.initialHearts,
    maxHearts: config.maxHearts,
    invulnerableTicks: 0,
    shieldTicks: 0,
    shieldCooldownTicks: 0,
    isDashing: false,
    dashEnergy: 100,
    shootCooldownMs: 0,
    sprayActiveTicks: 0,
    score: 0,
    best: state.best,
    combo: 0,
    level: INITIAL_PLAYER_LEVEL,
    xp: 0,
    questsSolved: 0,
    enemiesDefeated: 0,
    projectiles: [],
    silkWebs: [],
    hazards: [],
    quest: null,
    arenaMargin: config.startMargin,
    pendingShrink: false,
    tickInterval: config.baseTick,
    won: false,
    events: [],
    eventSeq: state.eventSeq,
    rng: botRes.rng,
    config,
    butterflyStage: 'caterpillar',
    butterflyCharge: 100,
    butterflyTicks: 0,
    butterflyAltitude: 0,
    butterflyLanding: false,
    butterflyHold: false,
    flowerCooldownTicks: 0,
    thunderCooldownTicks: 0,
    fireCooldownTicks: 0,
    waterCooldownTicks: 0,
    arcaneCooldownTicks: 0,
    gardenFlowers: [],
    lightningBolts: [],
    aoeBlasts: [],
    frostZones: [],
    shelters: state.shelters ?? createInitialShelters(config.worldRadius),
    discoveredShelterIds: state.discoveredShelterIds ?? ['shelter-castle-center'],
    roamingMonsters:
      state.roamingMonsters && state.roamingMonsters.length > 0
        ? state.roamingMonsters
        : createInitialRoamingMonsters(5, config.worldRadius),
    monsterEvent: createInitialMonsterEvent(config),
    inShelter: false,
    currentShelterId: null,
    shelteredTicks: 0,
    shelterHealUsedId: null,
    guardianFairy: createInitialGuardianFairy(),
  });
}

/** Create the initial open-world state for a fresh game, in the `ready` phase. */
export function createInitialState(options: NewGameOptions = {}): GameState {
  const difficulty = options.difficulty ?? 'normal';
  const mode = options.mode ?? 'adventure';
  const ageProfile = options.ageProfile ?? 'age6';
  const playerName = normalizePlayerName(options.playerName);
  const config =
    options.config ??
    (options.difficulty !== undefined || options.mode !== undefined
      ? configFor(difficulty, mode)
      : DEFAULT_CONFIG);
  const seed = options.seed ?? 1;

  const head: Vec2 = { x: 0, z: 0 };
  const snake = buildStraightSpine(head, 0, config.initialLength);
  const prevSnake = snake.map((p) => ({ ...p }));

  const orbRes = replenishWorldOrbs({
    orbs: [],
    config,
    playerHead: head,
    minHeadDist: 1.8,
    rng: createRng(seed),
  });
  const botRes = createInitialBots({
    config,
    playerHead: head,
    playerLevel: INITIAL_PLAYER_LEVEL,
    difficulty,
    rng: orbRes.rng,
  });
  const food = nearestOrbPos(orbRes.orbs, head, botRes.bots);
  const board = computeLeaderboard({
    playerName,
    playerLevel: INITIAL_PLAYER_LEVEL,
    bots: botRes.bots,
    activeBossId: null,
  });

  return withStarterQuest({
    phase: 'ready',
    mode,
    difficulty,
    ageProfile,
    playerName,
    snake,
    prevSnake,
    heading: 0,
    targetHeading: null,
    direction: 'right',
    queue: [],
    orbs: orbRes.orbs,
    food,
    bonusFood: null,
    bonusTicks: 0,
    bots: botRes.bots,
    botsEaten: 0,
    chompStreak: 0,
    chompStreakTicks: 0,
    eatenByBotName: null,
    bossProgress: 0,
    bossTargetLevel: INITIAL_BOSS_TARGET_LEVEL,
    activeBossId: null,
    leaderboard: board.leaderboard,
    playerRank: board.playerRank,
    crownTarget: board.crownTarget,
    boosters: createInitialBoosters(),
    absorbedPower: null,
    elapsedTicks: 0,
    form: 'dragon',
    hearts: config.initialHearts,
    maxHearts: config.maxHearts,
    invulnerableTicks: 0,
    shieldTicks: 0,
    shieldCooldownTicks: 0,
    isDashing: false,
    dashEnergy: 100,
    shootCooldownMs: 0,
    sprayActiveTicks: 0,
    score: 0,
    best: options.best ?? 0,
    combo: 0,
    level: INITIAL_PLAYER_LEVEL,
    xp: 0,
    questsSolved: 0,
    enemiesDefeated: 0,
    projectiles: [],
    silkWebs: [],
    hazards: [],
    quest: null,
    arenaMargin: config.startMargin,
    pendingShrink: false,
    tickInterval: config.baseTick,
    won: false,
    events: [],
    eventSeq: 0,
    rng: botRes.rng,
    config,
    butterflyStage: 'caterpillar',
    butterflyCharge: 100,
    butterflyTicks: 0,
    butterflyAltitude: 0,
    butterflyLanding: false,
    butterflyHold: false,
    flowerCooldownTicks: 0,
    thunderCooldownTicks: 0,
    fireCooldownTicks: 0,
    waterCooldownTicks: 0,
    arcaneCooldownTicks: 0,
    gardenFlowers: [],
    lightningBolts: [],
    aoeBlasts: [],
    frostZones: [],
    shelters: createInitialShelters(config.worldRadius),
    discoveredShelterIds: ['shelter-castle-center'],
    roamingMonsters: createInitialRoamingMonsters(5, config.worldRadius),
    monsterEvent: createInitialMonsterEvent(config),
    inShelter: false,
    currentShelterId: null,
    shelteredTicks: 0,
    shelterHealUsedId: null,
    guardianFairy: createInitialGuardianFairy(),
  });
}

/** Advance the open-world simulation by one 50ms tick. Assumes `phase === 'playing'`. */
function step(state: GameState): GameState {
  const { config } = state;
  const head = state.snake[0];
  if (head === undefined) {
    const ev = appendEvents([], state.eventSeq, [{ kind: 'gameover' }]);
    return { ...state, phase: 'gameover', events: ev.events, eventSeq: ev.eventSeq };
  }

  // 1. Timers, boosters, absorbed power, and dash energy
  const isAirborne = state.butterflyStage === 'cocoon' || state.butterflyStage === 'butterfly';
  const wasProtected = state.shieldTicks > 0 || state.invulnerableTicks > 0 || isAirborne;
  const speedBoostActive = state.boosters.speed.activeTicks > 0;
  const nextInvuln = Math.max(0, state.invulnerableTicks - 1);
  const nextShield = Math.max(0, state.shieldTicks - 1);
  const nextShieldCooldown = Math.max(0, state.shieldCooldownTicks - 1);
  const nextSprayActiveTicks = Math.max(0, state.sprayActiveTicks - 1);
  const nextChompStreakTicks = Math.max(0, state.chompStreakTicks - 1);
  const nextChompStreak = nextChompStreakTicks === 0 ? 0 : state.chompStreak;

  const nextBoosters: BoostersState = {
    level: state.boosters.level,
    speed: {
      ...state.boosters.speed,
      activeTicks: Math.max(0, state.boosters.speed.activeTicks - 1),
    },
    magnet: {
      ...state.boosters.magnet,
      activeTicks: Math.max(0, state.boosters.magnet.activeTicks - 1),
    },
  };

  const nextAbsorbedPower =
    state.absorbedPower !== null && state.absorbedPower.ticksRemaining > 1
      ? { ...state.absorbedPower, ticksRemaining: state.absorbedPower.ticksRemaining - 1 }
      : null;

  let nextDashEnergy = state.dashEnergy;
  let nextIsDashing = state.isDashing;
  if (state.isDashing) {
    nextDashEnergy = Math.max(0, state.dashEnergy - 5);
    if (nextDashEnergy <= 0) {
      nextIsDashing = false;
    }
  } else {
    nextDashEnergy = Math.min(100, state.dashEnergy + 3);
  }

  let nextBonusFood = state.bonusFood;
  let nextBonusTicks = state.bonusTicks;
  if (nextBonusFood !== null) {
    if (nextBonusTicks <= 1) {
      nextBonusFood = null;
      nextBonusTicks = 0;
    } else {
      nextBonusTicks -= 1;
    }
  }

  // 2. Smooth 360° steering & movement
  let nextHeading = state.heading;
  if (state.targetHeading !== null) {
    const diff = angleDiff(state.heading, state.targetHeading);
    nextHeading = normalizeAngle(state.heading + clamp(diff, -TURN_SPEED_RAD, TURN_SPEED_RAD));
  }

  let moveSpeed = config.baseSpeed;
  if (speedBoostActive) {
    moveSpeed = config.baseSpeed * 1.85;
  } else if (state.isDashing && state.dashEnergy > 0) {
    moveSpeed = config.baseSpeed * 1.65;
  }
  if (state.butterflyStage === 'butterfly') {
    moveSpeed = Math.max(moveSpeed, config.baseSpeed * 1.45);
  }

  const safeRadius = Math.max(2, config.worldRadius - WORLD_EDGE_PAD);
  const rawNext: Vec2 = {
    x: head.x + Math.cos(nextHeading) * moveSpeed,
    z: head.z + Math.sin(nextHeading) * moveSpeed,
  };
  const outOfBounds = Math.abs(rawNext.x) > safeRadius || Math.abs(rawNext.z) > safeRadius;

  const targetLen = targetPlayerLength(state.level, config.initialLength);
  let nextHead: Vec2;
  let nextSnake: Vec2[];
  let prevSnake: Vec2[];

  if (config.wrapWalls && outOfBounds) {
    nextHead = wrapWorldPos(rawNext, safeRadius);
    const shiftX = nextHead.x - rawNext.x;
    const shiftZ = nextHead.z - rawNext.z;
    const shiftedOld = state.snake.map((p) => ({ x: p.x + shiftX, z: p.z + shiftZ }));
    nextSnake = advanceSpineFollowLeader(shiftedOld, nextHead, nextHeading, targetLen);
    prevSnake = nextSnake.map((p) => ({ ...p }));
  } else {
    nextHead = {
      x: clamp(rawNext.x, -safeRadius, safeRadius),
      z: clamp(rawNext.z, -safeRadius, safeRadius),
    };
    if (outOfBounds) {
      nextHeading = steerAlongBoundary(rawNext, nextHeading, safeRadius);
    }
    nextSnake = advanceSpineFollowLeader(state.snake, nextHead, nextHeading, targetLen);
    prevSnake = matchSpineLength(state.snake, nextSnake.length);
  }

  const nextDirection =
    state.targetHeading !== null
      ? angleToDirection(state.targetHeading)
      : angleToDirection(nextHeading);

  const currentShelter = findCurrentShelter(nextHead, state.shelters);
  const inShelter = currentShelter !== null;
  const currentShelterId = currentShelter ? currentShelter.id : null;
  const shelteredTicks = inShelter ? state.shelteredTicks + 1 : 0;
  const movedDist = Math.min(4, Math.hypot(nextHead.x - head.x, nextHead.z - head.z));

  const shelterDrafts: EventDraft[] = [];
  if (!state.inShelter && inShelter && currentShelter) {
    shelterDrafts.push({
      kind: 'shelter_enter',
      cell: nextHead,
      messageVi: `🏡 ĐÃ TRÚ ẨN AN TOÀN TRONG ${currentShelter.nameVi}! ✨`,
    });
  } else if (state.inShelter && !inShelter) {
    shelterDrafts.push({
      kind: 'shelter_exit',
      cell: nextHead,
      messageVi: 'Rời khỏi nhà trú ẩn!',
    });
  }

  const enteredShelter =
    currentShelter !== null && (!state.inShelter || state.currentShelterId !== currentShelter.id);
  let discoveredShelterIds = state.discoveredShelterIds ?? [];
  let discoveryBonus = 0;
  if (enteredShelter && currentShelter && !discoveredShelterIds.includes(currentShelter.id)) {
    discoveredShelterIds = [...discoveredShelterIds, currentShelter.id];
    discoveryBonus = SHELTER_DISCOVERY_SCORE;
    shelterDrafts.push({
      kind: 'shelter_discovered',
      cell: nextHead,
      points: SHELTER_DISCOVERY_SCORE,
      shelterId: currentShelter.id,
      messageVi: `✨ KHÁM PHÁ CUNG ĐIỆN MỚI! ${currentShelter.nameVi}! (+${SHELTER_DISCOVERY_SCORE}đ) ✨`,
    });
  }

  let nextHearts = state.hearts;
  let nextShelterHealUsedId = inShelter ? (state.shelterHealUsedId ?? null) : null;
  if (
    inShelter &&
    currentShelterId !== null &&
    shelteredTicks === 40 &&
    nextShelterHealUsedId !== currentShelterId
  ) {
    nextShelterHealUsedId = currentShelterId;
    if (nextHearts < state.maxHearts) {
      nextHearts = nextHearts + 1;
      shelterDrafts.push({
        kind: 'heart_gained',
        cell: nextHead,
        messageVi: '🏰 Ánh sáng Lâu Đài hồi tặng bé +1 Tim phép thuật! 💖',
      });
    }
  }

  const shelterDashEnergy =
    inShelter && shelteredTicks >= 10 && !state.isDashing
      ? Math.min(100, nextDashEnergy + 2)
      : nextDashEnergy;
  const shelterButterflyCharge =
    inShelter && shelteredTicks >= 10 && state.butterflyStage === 'caterpillar'
      ? Math.min(100, Number((state.butterflyCharge + 0.5).toFixed(2)))
      : state.butterflyCharge;

  const initialEv = appendEvents([], state.eventSeq, shelterDrafts);

  let working: GameState = {
    ...state,
    snake: nextSnake,
    prevSnake,
    heading: nextHeading,
    direction: nextDirection,
    queue: [],
    elapsedTicks: state.elapsedTicks + 1,
    chompStreak: nextChompStreak,
    chompStreakTicks: nextChompStreakTicks,
    hearts: nextHearts,
    invulnerableTicks: nextInvuln,
    shieldTicks: nextShield,
    shieldCooldownTicks: nextShieldCooldown,
    boosters: nextBoosters,
    absorbedPower: nextAbsorbedPower,
    isDashing: nextIsDashing,
    dashEnergy: shelterDashEnergy,
    butterflyCharge: shelterButterflyCharge,
    sprayActiveTicks: nextSprayActiveTicks,
    bonusFood: nextBonusFood,
    bonusTicks: nextBonusTicks,
    tickInterval: config.baseTick,
    inShelter,
    currentShelterId,
    shelteredTicks,
    shelterHealUsedId: nextShelterHealUsedId,
    discoveredShelterIds,
    roamingMonsters: state.roamingMonsters ?? createInitialRoamingMonsters(5, config.worldRadius),
    score: state.score + discoveryBonus,
    best: Math.max(state.best, state.score + discoveryBonus),
    events: initialEv.events,
    eventSeq: initialEv.eventSeq,
  };

  // 3. Magnet attraction & orb consumption
  const magnetRadius = getMagnetRadius(working);
  const orbDrafts: EventDraft[] = [];
  const remainingOrbs = [];
  let gainedXp = 0;
  let orbPoints = 0;
  let orbCombo = working.combo;
  let orbBossGain = 0;

  for (const orb of working.orbs) {
    const dx = nextHead.x - orb.x;
    const dz = nextHead.z - orb.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= magnetRadius) {
      const pull =
        dist > 1e-5 ? Math.min(dist, Math.max(0.9, (magnetRadius - dist) * 0.25 + 0.75)) : 0;
      const nx = dist > 1e-5 ? orb.x + (dx / dist) * pull : orb.x;
      const nz = dist > 1e-5 ? orb.z + (dz / dist) * pull : orb.z;
      const newDist = Math.hypot(nextHead.x - nx, nextHead.z - nz);

      if (newDist < 1.15 || dist < 1.15) {
        orbCombo += 1;
        const pts = orb.value * 10 + Math.min(20, (orbCombo - 1) * 2);
        orbPoints += pts;
        gainedXp += orb.value;
        orbBossGain += orb.isLoot ? 3 : 1;
        orbDrafts.push({
          kind: orb.isLoot ? 'eat_bonus' : 'eat_food',
          cell: { x: orb.x, z: orb.z },
          points: pts,
        });
        continue;
      }

      remainingOrbs.push({ ...orb, x: nx, z: nz });
      continue;
    }
    remainingOrbs.push(orb);
  }

  if (
    working.bonusFood !== null &&
    Math.hypot(working.bonusFood.x - nextHead.x, working.bonusFood.z - nextHead.z) <=
      Math.max(1.25, magnetRadius * 0.5)
  ) {
    orbCombo += 1;
    const pts = 30;
    orbPoints += pts;
    gainedXp += 3;
    orbBossGain += 3;
    orbDrafts.push({ kind: 'eat_bonus', cell: working.bonusFood, points: pts });
    working = { ...working, bonusFood: null, bonusTicks: 0 };
  }

  if (orbDrafts.length > 0) {
    const ev = appendEvents(working.events, working.eventSeq, orbDrafts);
    const xpRes = applyXpAndScore({
      score: working.score,
      best: working.best,
      level: working.level,
      xp: working.xp,
      gainXp: gainedXp,
      points: orbPoints,
      events: ev.events,
      eventSeq: ev.eventSeq,
      cell: nextHead,
    });
    working = {
      ...working,
      orbs: remainingOrbs,
      combo: orbCombo,
      score: xpRes.score,
      best: xpRes.best,
      level: xpRes.level,
      xp: xpRes.xp,
      bossProgress: Math.min(100, working.bossProgress + orbBossGain),
      events: xpRes.events,
      eventSeq: xpRes.eventSeq,
    };
    // Add butterfly charge per eaten orb when caterpillar
    if (working.butterflyStage === 'caterpillar' && orbDrafts.length > 0) {
      working = {
        ...working,
        butterflyCharge: Math.min(100, working.butterflyCharge + orbDrafts.length * 6),
      };
    }
  } else {
    working = { ...working, orbs: remainingOrbs };
  }

  // 4. BrainQuest orb touch & timer countdown
  if (working.quest !== null) {
    const questTouchRadius = working.ageProfile === 'age6' ? 1.6 : 1.25;
    const touchedOrb = working.quest.orbs.find(
      (o) =>
        !o.collected &&
        Math.hypot(o.cell.x - nextHead.x, o.cell.z - nextHead.z) <= questTouchRadius,
    );
    if (touchedOrb) {
      working = applyQuestOrbHit(working, touchedOrb.id);
    }
  }
  working = { ...working, quest: tickQuest(working.quest) };

  // 5. Step AI Bots (movement, freeze aura, orb eating, bot-vs-bot elimination)
  const botStep = stepBots({
    bots: working.bots,
    orbs: working.orbs,
    playerSnake: working.snake,
    playerLevel: working.level,
    playerProtected: wasProtected || speedBoostActive || isAirborne,
    playerPhoenixAura:
      working.absorbedPower?.form === 'phoenix' && working.absorbedPower.ticksRemaining > 0,
    config,
    difficulty: working.difficulty,
    rng: working.rng,
  });
  const botsAfterFlee = applyBotShelterFlee(
    botStep.bots,
    working.shelters,
    config.worldRadius,
    working.monsterEvent.phase === 'warning',
  );
  working = {
    ...working,
    bots: botsAfterFlee,
    orbs: botStep.orbs,
    rng: botStep.rng,
  };

  // 6. Player vs Bot collisions
  const isFlyingOverhead =
    working.butterflyStage === 'butterfly' && working.butterflyAltitude >= 0.4;
  const headAndNeck = working.snake.slice(0, 4);
  const isFast = state.isDashing || speedBoostActive;
  let tookBotHitThisTick = false;

  for (const bot of [...working.bots]) {
    if (bot.level <= working.level) {
      const prevHeadPos = config.wrapWalls && outOfBounds ? (working.snake[0] ?? nextHead) : head;
      const streakBefore = working.chompStreak;
      working = chompBotByPlayer(working, bot, prevHeadPos, working.snake[0] ?? nextHead, isFast);
      // Add butterfly charge per chomped bot segment when caterpillar
      const segmentsChomped = working.chompStreak - streakBefore;
      if (segmentsChomped > 0 && working.butterflyStage === 'caterpillar') {
        working = {
          ...working,
          butterflyCharge: Math.min(100, working.butterflyCharge + segmentsChomped * 8),
        };
      }
      continue;
    }

    // Flying high as butterfly avoids ground opponent collisions completely
    if (isFlyingOverhead) {
      continue;
    }

    const hitRadius = botCollisionRadius(bot.level, bot.isBoss);
    const playerHeadHitsBot = minDistanceToChain(nextHead, bot.spine) < hitRadius;
    const botHeadHitsPlayerNeck = minDistanceToChain(bot.head, headAndNeck) < hitRadius;

    if (
      !tookBotHitThisTick &&
      bot.level > working.level &&
      (playerHeadHitsBot || botHeadHitsPlayerNeck)
    ) {
      tookBotHitThisTick = true;

      if (wasProtected || speedBoostActive) {
        const repelled = repelBotFrom(bot, nextHead, 3.5, config.worldRadius, 2);
        const bots = working.bots.map((b) => (b.id === bot.id ? repelled : b));
        const ev = appendEvents(working.events, working.eventSeq, [
          {
            kind: 'shield_block',
            cell: bot.head,
            messageVi: `Khiên đẩy lùi ${bot.name} (-2 cấp)! 🛡️`,
          },
        ]);
        working = { ...working, bots, events: ev.events, eventSeq: ev.eventSeq };
        continue;
      }

      if (working.hearts > 1) {
        const hearts = working.hearts - 1;
        const pushed = pushSnakeAwayFrom(working.snake, bot.head, 4.0, safeRadius, working.heading);
        const ev = appendEvents(working.events, working.eventSeq, [
          {
            kind: 'eaten_by_bot',
            cell: bot.head,
            messageVi: `Rắn Lv.${bot.level} mạnh hơn! Bắn đạn giảm cấp nó trước nhé!`,
          },
          {
            kind: 'heart_lost',
            cell: nextHead,
            messageVi: `Ôi cẩn thận nhé! Bé còn ${hearts} tim 💖`,
          },
        ]);
        working = {
          ...working,
          snake: pushed.snake,
          prevSnake: pushed.snake.map((p) => ({ ...p })),
          heading: pushed.heading,
          hearts,
          combo: 0,
          invulnerableTicks: 45,
          events: ev.events,
          eventSeq: ev.eventSeq,
        };
        continue;
      }

      const eatenByBotName = `${bot.name} (Lv.${bot.level})`;
      const ev = appendEvents(working.events, working.eventSeq, [
        {
          kind: 'eaten_by_bot',
          cell: bot.head,
          messageVi: `Rắn Lv.${bot.level} mạnh hơn! Bắn đạn giảm cấp nó trước nhé!`,
        },
        {
          kind: 'gameover',
          cell: nextHead,
          messageVi: `Bị ${eatenByBotName} đánh bại rồi! Thử lại nhé ✨`,
        },
      ]);
      const board = computeLeaderboard({
        playerName: working.playerName,
        playerLevel: working.level,
        bots: working.bots,
        activeBossId: working.activeBossId,
      });
      return {
        ...working,
        hearts: 0,
        combo: 0,
        isDashing: false,
        eatenByBotName,
        phase: 'gameover',
        won: false,
        leaderboard: board.leaderboard,
        playerRank: board.playerRank,
        crownTarget: board.crownTarget,
        events: ev.events,
        eventSeq: ev.eventSeq,
      };
    }
  }

  // 7. Hazard collisions & hazard step/spawn
  const currentHead = working.snake[0] ?? nextHead;
  const hitHazard = isFlyingOverhead
    ? undefined
    : working.hazards.find(
        (h) =>
          h.warningTicks === 0 &&
          h.frozenTicks <= 0 &&
          Math.hypot(h.cell.x - currentHead.x, h.cell.z - currentHead.z) < 1.05,
      );
  if (hitHazard !== undefined) {
    if (wasProtected || speedBoostActive) {
      const remainingHazards = speedBoostActive
        ? working.hazards.filter((h) => h.id !== hitHazard.id)
        : working.hazards;
      const ev = appendEvents(working.events, working.eventSeq, [
        {
          kind: 'shield_block',
          cell: hitHazard.cell,
          messageVi: 'Khiên đã che chở an toàn! 🛡️',
        },
      ]);
      working = {
        ...working,
        hazards: remainingHazards,
        events: ev.events,
        eventSeq: ev.eventSeq,
      };
    } else if (working.hearts > 1) {
      const hearts = working.hearts - 1;
      const ev = appendEvents(working.events, working.eventSeq, [
        {
          kind: 'heart_lost',
          cell: hitHazard.cell,
          messageVi: `Ôi cẩn thận nhé! Bé còn ${hearts} tim 💖`,
        },
      ]);
      working = {
        ...working,
        hearts,
        combo: 0,
        invulnerableTicks: 45,
        events: ev.events,
        eventSeq: ev.eventSeq,
      };
    } else {
      const ev = appendEvents(working.events, working.eventSeq, [
        {
          kind: 'gameover',
          cell: hitHazard.cell,
          messageVi: 'Hết tim rồi! Bé thử lại ván mới nhé ✨',
        },
      ]);
      return {
        ...working,
        hearts: 0,
        combo: 0,
        isDashing: false,
        phase: 'gameover',
        won: false,
        events: ev.events,
        eventSeq: ev.eventSeq,
      };
    }
  }

  const steppedHazards = stepHazards({
    hazards: working.hazards,
    config,
    margin: working.arenaMargin,
    snake: working.snake,
    food: working.food,
    bonusFood: working.bonusFood,
    quest: working.quest,
    mode: working.mode,
    rng: working.rng,
  });

  const spawnedHazards = maybeSpawnHazard({
    hazards: steppedHazards.hazards,
    config,
    margin: working.arenaMargin,
    snake: working.snake,
    food: working.food,
    bonusFood: working.bonusFood,
    quest: working.quest,
    mode: working.mode,
    level: working.level,
    score: working.score,
    rng: steppedHazards.rng,
  });
  working = {
    ...working,
    hazards: spawnedHazards.hazards,
    rng: spawnedHazards.rng,
  };

  // 8. Replenish orbs & bots, trigger Boss spawn at 100%, maybe spawn BrainQuest
  const orbTopUp = replenishWorldOrbs({
    orbs: working.orbs,
    config,
    playerHead: currentHead,
    rng: working.rng,
  });
  const botTopUp = replenishBots({
    bots: working.bots,
    config,
    playerHead: currentHead,
    playerLevel: working.level,
    rng: orbTopUp.rng,
  });
  working = {
    ...working,
    orbs: orbTopUp.orbs,
    bots: botTopUp.bots,
    rng: botTopUp.rng,
  };

  if (working.bossProgress >= 100 && working.activeBossId === null) {
    const bossSpawned = spawnBossBot({
      bots: working.bots,
      config,
      playerHead: currentHead,
      playerLevel: working.level,
      bossTargetLevel: working.bossTargetLevel,
      rng: working.rng,
    });
    const ev = appendEvents(working.events, working.eventSeq, [
      {
        kind: 'boss_spawn',
        cell: bossSpawned.boss.head,
        messageVi: `👑 Boss Đại Vương Rồng (Lv.${bossSpawned.boss.level}) xuất hiện!`,
      },
    ]);
    working = {
      ...working,
      bots: bossSpawned.bots,
      activeBossId: bossSpawned.boss.id,
      rng: bossSpawned.rng,
      events: ev.events,
      eventSeq: ev.eventSeq,
    };
  }

  working = maybeSpawnQuest(working, working.rng);
  working = stepFairyMagic(working);
  working = stepGuardianFairy(working, movedDist);
  working = applyDifficultyMagicRecovery(working);
  working = stepSilkWebs(working);
  working = syncSnakeLengthToLevel(working);

  // 8b. Step Sky Monster Calamity Event & Calamity Strike
  const monsterRes = stepMonsterEvent(
    working.monsterEvent,
    config,
    currentHead,
    working.shelters,
    working.inShelter,
  );
  if (monsterRes.eventDrafts.length > 0) {
    const ev = appendEvents(working.events, working.eventSeq, monsterRes.eventDrafts);
    working = { ...working, events: ev.events, eventSeq: ev.eventSeq };
  }
  working = { ...working, monsterEvent: monsterRes.nextEvent };

  if (monsterRes.strikeTriggered) {
    working = resolveMonsterCalamityStrike({ state: working, config });
    if (working.phase === 'gameover') {
      return working;
    }
  }

  // 8c. Step Slow-Moving Roaming Monsters
  working = stepRoamingMonsters(working);
  if (working.phase === 'gameover') {
    return working;
  }

  const food = nearestOrbPos(working.orbs, currentHead, working.bots);
  const board = computeLeaderboard({
    playerName: working.playerName,
    playerLevel: working.level,
    bots: working.bots,
    activeBossId: working.activeBossId,
  });

  if (working.elapsedTicks >= getSessionTotalTicks(config)) {
    const completionBonus = 500 + working.level * 15;
    const finalScore = working.score + completionBonus;
    const finalBest = Math.max(working.best, finalScore);
    const ev = appendEvents(working.events, working.eventSeq, [
      {
        kind: 'gameover',
        cell: currentHead,
        points: completionBonus,
        messageVi: `⏰ Hoàn thành 5 Phút Phép Thuật! Hạng #${board.playerRank} • +${completionBonus}đ! 👑`,
      },
    ]);
    return {
      ...working,
      food,
      score: finalScore,
      best: finalBest,
      isDashing: false,
      phase: 'gameover',
      won: true,
      eatenByBotName: null,
      leaderboard: board.leaderboard,
      playerRank: board.playerRank,
      crownTarget: board.crownTarget,
      events: ev.events,
      eventSeq: ev.eventSeq,
    };
  }

  return {
    ...working,
    food,
    leaderboard: board.leaderboard,
    playerRank: board.playerRank,
    crownTarget: board.crownTarget,
  };
}

function activateBooster(state: GameState, booster: BoosterKind): GameState {
  if (state.phase !== 'playing') return state;
  const slot = state.boosters[booster];
  if (slot.charges <= 0) return state;

  const head = state.snake[0];
  if (booster === 'level') {
    const nextLevel = state.level + 10;
    const nextBoosters: BoostersState = {
      ...state.boosters,
      level: { ...slot, charges: slot.charges - 1 },
    };
    const ev = appendEvents([], state.eventSeq, [
      {
        kind: 'booster_activate',
        cell: head,
        messageVi: '⚡ Tăng Tức +10 Cấp!',
      },
      {
        kind: 'level_up',
        cell: head,
        messageVi: `Chúc mừng! Bé lên Cấp ${nextLevel}! 🎉`,
      },
    ]);
    const board = computeLeaderboard({
      playerName: state.playerName,
      playerLevel: nextLevel,
      bots: state.bots,
      activeBossId: state.activeBossId,
    });
    return syncSnakeLengthToLevel({
      ...state,
      level: nextLevel,
      boosters: nextBoosters,
      leaderboard: board.leaderboard,
      playerRank: board.playerRank,
      crownTarget: board.crownTarget,
      events: ev.events,
      eventSeq: ev.eventSeq,
    });
  }

  const nextBoosters: BoostersState = {
    ...state.boosters,
    [booster]: {
      ...slot,
      charges: slot.charges - 1,
      activeTicks: slot.maxTicks,
    },
  };
  const messageVi = booster === 'speed' ? '🚀 Siêu Tốc Độ & Khiên Lướt!' : '🧲 Nam Châm Khổng Lồ!';
  const ev = appendEvents([], state.eventSeq, [
    { kind: 'booster_activate', cell: head, messageVi },
  ]);

  return {
    ...state,
    boosters: nextBoosters,
    events: ev.events,
    eventSeq: ev.eventSeq,
  };
}

/**
 * The single pure reducer. Every state change flows through here; actions are
 * safe no-ops outside the phases where they apply.
 */
export function reduce(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'start':
      return state.phase === 'ready' || state.phase === 'gameover'
        ? freshBoard(
            state,
            'playing',
            action.mode,
            action.difficulty,
            action.playerName,
            action.ageProfile,
          )
        : state;

    case 'steer': {
      if (state.phase !== 'playing') return state;
      if (action.angle === null || !Number.isFinite(action.angle)) {
        return state.targetHeading === null && state.events.length === 0
          ? state
          : { ...state, targetHeading: null, events: [] };
      }
      const norm = normalizeAngle(action.angle);
      const direction = angleToDirection(norm);
      return {
        ...state,
        targetHeading: norm,
        direction,
        queue: [],
        events: [],
      };
    }

    case 'turn': {
      if (state.phase !== 'playing') return state;
      const angle = directionToAngle(action.direction);
      return {
        ...state,
        targetHeading: angle,
        direction: action.direction,
        queue: [],
        events: [],
      };
    }

    case 'tick':
      return state.phase === 'playing' ? step(state) : state;

    case 'projectile_step':
      return state.phase === 'playing'
        ? syncSnakeLengthToLevel(stepProjectiles(state, action.dtMs))
        : state;

    case 'shoot': {
      if (state.phase !== 'playing' || state.shootCooldownMs > 0) return state;
      const head = state.snake[0];
      if (!head) return state;
      const ev = appendEvents([], state.eventSeq, [
        { kind: 'shoot', cell: head, form: state.form },
      ]);
      const spawned = spawnProjectilesForForm(state, ev.eventSeq);
      const hasDragonPower =
        state.absorbedPower?.form === 'dragon' && state.absorbedPower.ticksRemaining > 0;
      return {
        ...state,
        projectiles: [...state.projectiles, ...spawned],
        shootCooldownMs: shootCooldownForForm(state.form, hasDragonPower),
        sprayActiveTicks: SPRAY_ACTIVE_TICKS,
        events: ev.events,
        eventSeq: ev.eventSeq,
      };
    }

    case 'morph': {
      if (state.phase !== 'playing') return state;
      let nextForm = state.form;
      if (action.form !== undefined) {
        nextForm = action.form;
      } else {
        const stepDir = action.delta ?? 1;
        const idx = SNAKE_FORMS.indexOf(state.form);
        const nextIdx = (idx + stepDir + SNAKE_FORMS.length) % SNAKE_FORMS.length;
        nextForm = SNAKE_FORMS[nextIdx] ?? 'dragon';
      }
      if (nextForm === state.form) return state;
      const ev = appendEvents([], state.eventSeq, [
        {
          kind: 'morph',
          cell: state.snake[0],
          form: nextForm,
          messageVi: FORM_METADATA[nextForm].nameVi,
        },
      ]);
      return {
        ...state,
        form: nextForm,
        events: ev.events,
        eventSeq: ev.eventSeq,
      };
    }

    case 'dash': {
      if (state.phase !== 'playing') return state;
      if (action.active) {
        if (state.dashEnergy <= 0 || state.isDashing) return state;
        const ev = appendEvents([], state.eventSeq, [
          { kind: 'dash', cell: state.snake[0], form: state.form },
        ]);
        return {
          ...state,
          isDashing: true,
          events: ev.events,
          eventSeq: ev.eventSeq,
        };
      }
      if (!state.isDashing) return state;
      return {
        ...state,
        isDashing: false,
        events: [],
      };
    }

    case 'shield': {
      if (state.phase !== 'playing' || state.shieldCooldownTicks > 0) return state;
      const cdScale = difficultyTuningFor(state.difficulty).fairyCooldownScale;
      const shieldCooldownTicks = cdScale < 1 ? Math.max(1, Math.ceil(60 * cdScale)) : 60;
      const ev = appendEvents([], state.eventSeq, [
        {
          kind: 'shield_activate',
          cell: state.snake[0],
          messageVi: 'Khiên Phép Thuật! 🛡️',
        },
      ]);
      return {
        ...state,
        shieldTicks: 30,
        shieldCooldownTicks,
        events: ev.events,
        eventSeq: ev.eventSeq,
      };
    }

    case 'activate_booster':
      return activateBooster(state, action.booster);

    case 'pause':
      return state.phase === 'playing' ? { ...state, phase: 'paused', events: [] } : state;

    case 'resume':
      return state.phase === 'paused' ? { ...state, phase: 'playing', events: [] } : state;

    case 'reset':
      return freshBoard(
        state,
        'ready',
        action.mode,
        action.difficulty,
        action.playerName,
        action.ageProfile,
      );

    case 'set_age_profile': {
      if (state.ageProfile === action.ageProfile) return state;
      const next: GameState = { ...state, ageProfile: action.ageProfile, events: [] };
      if (state.phase === 'playing' && state.quest !== null) {
        // Refresh quest for the new age profile
        const spawned = spawnQuest(next, next.rng);
        if (spawned.quest) {
          const ev = appendEvents([], next.eventSeq, [
            { kind: 'quest_spawn', messageVi: spawned.quest.promptVi },
          ]);
          return {
            ...next,
            quest: spawned.quest,
            rng: spawned.rng,
            events: ev.events,
            eventSeq: ev.eventSeq,
          };
        }
        return { ...next, quest: null, rng: spawned.rng };
      }
      return next;
    }

    case 'cast_fairy_skill': {
      const next = castFairySkill(state, action.skill);
      const scale = difficultyTuningFor(state.difficulty).fairyCooldownScale;
      return scaleNewlyStartedFairyCooldowns(state, next, scale);
    }

    case 'set_butterfly_hold':
      return setButterflyHold(state, action.active);
  }
}
