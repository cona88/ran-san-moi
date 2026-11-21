import type {
  AbsorbedBotPower,
  BotSkin,
  BotSnake,
  Difficulty,
  GameConfig,
  GameState,
  LeaderboardEntry,
  RngState,
  SnakeForm,
  Vec2,
  WorldOrb,
} from './types';
import { difficultyTuningFor } from './config';
import { advanceSpineFollowLeader, buildStraightSpine, matchSpineLength } from './movement';
import { appendEvents, applyXpAndScore, grantBoosterCharge, type EventDraft } from './quests';
import { nextFloat, nextInt } from './rng';
import { angleDiff, clamp, euclideanDistance, normalizeAngle } from './systems/arena';
import { distancePointToSegment, minDistanceToChain } from './systems/collision';
import { scatterLootOrbs } from './systems/food';

export const BOT_NAMES: readonly string[] = [
  'Soyster',
  'GaoBay',
  'VemPraKOD',
  'TaMptrax',
  'Mèo Tinh Tú',
  'Rồng Hoàng Kim',
  'Kẹo Bông Hồng',
  'Tia Chớp Nhí',
  'Cáo Ngân Hà',
  'Bánh Dâu Tây',
  'Phượng Hoàng Tuyết',
  'Ngôi Sao Nhỏ',
  'Kỳ Lân Bạc',
  'Thỏ Ngọc Xanh',
  'Sóc Phép Thuật',
  'Bướm Pha Lê',
  'Rùa Tia Sáng',
  'Cún Ngân Hà',
];

export const BOT_SKINS: readonly BotSkin[] = [
  'gold_armor',
  'ruby_flame',
  'lime_viper',
  'dragon',
  'phoenix',
  'unicorn',
  'spirit',
];

/** Global bot movement speed multiplier (-20% speed for friendlier pacing). */
export const BOT_SPEED_SCALE = 0.8;

/** Map a bot's visual skin to the magical {@link SnakeForm} power absorbed when defeated. */
export function powerFormForSkin(skin: BotSkin): SnakeForm {
  switch (skin) {
    case 'dragon':
    case 'gold_armor':
      return 'dragon';
    case 'phoenix':
    case 'ruby_flame':
      return 'phoenix';
    case 'unicorn':
      return 'unicorn';
    case 'spirit':
    case 'lime_viper':
      return 'spirit';
  }
}

/** Friendly Vietnamese title for an {@link AbsorbedBotPower}. */
export function absorbedPowerTitle(form: SnakeForm): string {
  switch (form) {
    case 'dragon':
      return 'Hấp thụ: Phun Lửa Siêu Tốc x2 🌸';
    case 'phoenix':
      return 'Hấp thụ: Đóng Băng Xung Quanh 🦋';
    case 'unicorn':
      return 'Hấp thụ: Siêu Nam Châm ⚡';
    case 'spirit':
      return 'Hấp thụ: Khiên Hồi Phục 🍀';
  }
}

/** Segment count for a bot snake given its level. */
export function targetBotSpineLength(level: number, isBoss = false): number {
  const safeLevel = Math.max(1, level);
  if (isBoss) {
    return clamp(22 + Math.floor(Math.sqrt(safeLevel) * 3), 22, 46);
  }
  return clamp(7 + Math.floor(Math.sqrt(safeLevel) * 3.2), 7, 36);
}

/** Effective target spine length accounting for segments already bitten off. */
export function effectiveBotSpineLength(bot: BotSnake): number {
  return Math.max(
    1,
    targetBotSpineLength(bot.maxLevel ?? bot.level, bot.isBoss) - (bot.bittenSegments ?? 0),
  );
}

/** Collision radius of a bot snake (~0.85..1.35, slightly larger for Boss). */
export function botCollisionRadius(level: number, isBoss = false): number {
  const base = 0.85 + Math.min(0.45, Math.sqrt(Math.max(1, level)) * 0.045);
  return isBoss ? Math.min(1.45, base + 0.12) : Math.min(1.35, base);
}

function nextBotId(bots: readonly BotSnake[]): number {
  let maxId = 0;
  for (const b of bots) {
    if (b.id > maxId) maxId = b.id;
  }
  return maxId + 1;
}

function sampleRingPos(params: {
  readonly center: Vec2;
  readonly minDist: number;
  readonly maxDist: number;
  readonly config: GameConfig;
  readonly rng: RngState;
}): { pos: Vec2; rng: RngState } {
  const bound = Math.max(4, params.config.worldRadius - 3.5);
  const safeMin = Math.min(params.minDist, bound * 0.8);
  const safeMax = Math.max(safeMin + 2, Math.min(params.maxDist, bound * 1.4));
  let rng = params.rng;

  for (let attempt = 0; attempt < 12; attempt++) {
    const aDraw = nextFloat(rng);
    const rDraw = nextFloat(aDraw.next);
    rng = rDraw.next;
    const angle = aDraw.value * Math.PI * 2;
    const dist = safeMin + rDraw.value * (safeMax - safeMin);
    const x = Number(clamp(params.center.x + Math.cos(angle) * dist, -bound, bound).toFixed(2));
    const z = Number(clamp(params.center.z + Math.sin(angle) * dist, -bound, bound).toFixed(2));
    if (Math.hypot(x - params.center.x, z - params.center.z) >= safeMin * 0.9) {
      return { pos: { x, z }, rng };
    }
  }

  const fallbackAngle = nextFloat(rng);
  rng = fallbackAngle.next;
  const x = Number(
    clamp(
      params.center.x + Math.cos(fallbackAngle.value * Math.PI * 2) * safeMin,
      -bound,
      bound,
    ).toFixed(2),
  );
  const z = Number(
    clamp(
      params.center.z + Math.sin(fallbackAngle.value * Math.PI * 2) * safeMin,
      -bound,
      bound,
    ).toFixed(2),
  );
  return { pos: { x, z }, rng };
}

function buildBotEntity(params: {
  readonly id: number;
  readonly name: string;
  readonly skin: BotSkin;
  readonly isBoss: boolean;
  readonly level: number;
  readonly head: Vec2;
  readonly heading: number;
}): BotSnake {
  const len = targetBotSpineLength(params.level, params.isBoss);
  const spine = buildStraightSpine(params.head, params.heading, len);
  return {
    id: params.id,
    name: params.name,
    skin: params.skin,
    isBoss: params.isBoss,
    level: params.level,
    maxLevel: params.level,
    chompedTicks: 0,
    bittenSegments: 0,
    head: params.head,
    prevHead: params.head,
    heading: params.heading,
    spine,
    prevSpine: spine.map((p) => ({ ...p })),
    frozenTicks: 0,
    powerForm: powerFormForSkin(params.skin),
  };
}

/** Spawn the initial set of AI bots around the open world with safe spawn clearance. */
export function createInitialBots(params: {
  readonly config: GameConfig;
  readonly playerHead: Vec2;
  readonly playerLevel: number;
  readonly difficulty?: Difficulty;
  readonly rng: RngState;
}): { bots: BotSnake[]; rng: RngState } {
  const count = params.config.botCount;
  let rng = params.rng;
  const bots: BotSnake[] = [];
  const tuning = difficultyTuningFor(params.difficulty ?? 'normal');
  const nearLowCount = Math.min(count, tuning.nearLowBotCount);

  for (let i = 0; i < count; i++) {
    const id = i + 1;
    const isNearLow = i < nearLowCount;

    const maxAmbientDist =
      !isNearLow && params.config.worldRadius > 100 && i % 2 === 0
        ? Math.min(params.config.worldRadius - 3, 95)
        : Math.max(22, params.config.worldRadius - 3);
    const ring = sampleRingPos({
      center: params.playerHead,
      minDist: isNearLow ? tuning.nearLowMinDist : 16,
      maxDist: isNearLow ? tuning.nearLowMaxDist : maxAmbientDist,
      config: params.config,
      rng,
    });
    rng = ring.rng;

    let level: number;
    if (isNearLow) {
      const lv = nextInt(rng, 4);
      rng = lv.next;
      level = 1 + lv.value; // Lv.1..4 right nearby for early hunting
    } else {
      const tier = nextFloat(rng);
      const sub = nextInt(tier.next, 100);
      rng = sub.next;
      if (tier.value < 0.7) {
        level = 1 + (sub.value % Math.max(1, params.playerLevel - 1));
      } else if (tier.value < 0.85) {
        level = params.playerLevel + 1 + (sub.value % 6);
      } else {
        level = params.playerLevel + 8 + (sub.value % 18);
      }
    }

    const nameIdx = nextInt(rng, BOT_NAMES.length);
    const skinIdx = nextInt(nameIdx.next, BOT_SKINS.length);
    const headAngle = nextFloat(skinIdx.next);
    rng = headAngle.next;

    const name = BOT_NAMES[(nameIdx.value + i) % BOT_NAMES.length] ?? `Bot-${id}`;
    const skin = BOT_SKINS[skinIdx.value] ?? 'lime_viper';
    const heading = normalizeAngle(headAngle.value * Math.PI * 2);

    bots.push(
      buildBotEntity({
        id,
        name,
        skin,
        isBoss: false,
        level,
        head: ring.pos,
        heading,
      }),
    );
  }

  return { bots, rng };
}

/** Replenish missing non-boss bots at `> 22` units from the player. */
export function replenishBots(params: {
  readonly bots: readonly BotSnake[];
  readonly config: GameConfig;
  readonly playerHead: Vec2;
  readonly playerLevel: number;
  readonly rng: RngState;
}): { bots: BotSnake[]; rng: RngState } {
  const nonBossCount = params.bots.filter((b) => !b.isBoss).length;
  if (nonBossCount >= params.config.botCount) {
    return { bots: [...params.bots], rng: params.rng };
  }

  let rng = params.rng;
  const result: BotSnake[] = [...params.bots];
  let idCounter = nextBotId(result);
  const needed = params.config.botCount - nonBossCount;
  const minDist = Math.min(22.5, Math.max(11, params.config.worldRadius * 0.65));

  for (let i = 0; i < needed; i++) {
    const fullMaxDist = Math.max(minDist + 8, params.config.worldRadius - 3);
    const maxDist =
      params.config.worldRadius > 100 && i % 2 === 0
        ? Math.max(minDist + 8, Math.min(fullMaxDist, 95))
        : fullMaxDist;
    const ring = sampleRingPos({
      center: params.playerHead,
      minDist,
      maxDist,
      config: params.config,
      rng,
    });
    rng = ring.rng;

    const tier = nextFloat(rng);
    const sub = nextFloat(tier.next);
    rng = sub.next;

    let level: number;
    if (tier.value < 0.7) {
      const maxLow = Math.max(1, params.playerLevel - 1);
      level = Math.max(
        1,
        Math.min(maxLow, Math.round(params.playerLevel * (0.3 + sub.value * 0.6))),
      );
    } else if (tier.value < 0.85) {
      level = params.playerLevel + 1 + Math.floor(sub.value * 6);
    } else {
      level = params.playerLevel + 8 + Math.floor(sub.value * 18);
    }

    const nameIdx = nextInt(rng, BOT_NAMES.length);
    const skinIdx = nextInt(nameIdx.next, BOT_SKINS.length);
    const headAngle = nextFloat(skinIdx.next);
    rng = headAngle.next;

    const name = BOT_NAMES[nameIdx.value] ?? `Bot-${idCounter}`;
    const skin = BOT_SKINS[skinIdx.value] ?? 'ruby_flame';
    const heading = normalizeAngle(headAngle.value * Math.PI * 2);

    result.push(
      buildBotEntity({
        id: idCounter++,
        name,
        skin,
        isBoss: false,
        level,
        head: ring.pos,
        heading,
      }),
    );
  }

  return { bots: result, rng };
}

/** Spawn the Boss snake (`Đại Vương Rồng`) away from the player. */
export function spawnBossBot(params: {
  readonly bots: readonly BotSnake[];
  readonly config: GameConfig;
  readonly playerHead: Vec2;
  readonly playerLevel: number;
  readonly bossTargetLevel: number;
  readonly rng: RngState;
}): { boss: BotSnake; bots: BotSnake[]; rng: RngState } {
  const id = nextBotId(params.bots);
  const ring = sampleRingPos({
    center: params.playerHead,
    minDist: Math.min(20, Math.max(10, params.config.worldRadius * 0.5)),
    maxDist: Math.max(28, params.config.worldRadius - 4),
    config: params.config,
    rng: params.rng,
  });
  const level = Math.max(params.bossTargetLevel, Math.round(params.playerLevel * 1.35));
  const toPlayerHeading = Math.atan2(
    params.playerHead.z - ring.pos.z,
    params.playerHead.x - ring.pos.x,
  );
  const boss = buildBotEntity({
    id,
    name: 'Đại Vương Rồng',
    skin: 'gold_armor',
    isBoss: true,
    level,
    head: ring.pos,
    heading: normalizeAngle(toPlayerHeading),
  });
  return {
    boss,
    bots: [...params.bots, boss],
    rng: ring.rng,
  };
}

/** Push a bot's head and spine away from `fromPos` to at least `minDist` (used on shield block). */
export function repelBotFrom(
  bot: BotSnake,
  fromPos: Vec2,
  minDist: number,
  worldRadius: number,
  levelPenalty = 2,
): BotSnake {
  const dx = bot.head.x - fromPos.x;
  const dz = bot.head.z - fromPos.z;
  const dist = Math.hypot(dx, dz);
  const nx = dist > 1e-4 ? dx / dist : Math.cos(bot.heading + Math.PI);
  const nz = dist > 1e-4 ? dz / dist : Math.sin(bot.heading + Math.PI);
  const bound = Math.max(2, worldRadius - 1.5);
  const nextHead: Vec2 = {
    x: clamp(fromPos.x + nx * minDist, -bound, bound),
    z: clamp(fromPos.z + nz * minDist, -bound, bound),
  };
  const nextHeading = normalizeAngle(Math.atan2(nz, nx));
  const nextLevel = Math.max(1, bot.level - levelPenalty);
  const nextMaxLevel = Math.max(1, (bot.maxLevel ?? bot.level) - levelPenalty);
  const nextLen = Math.max(
    1,
    Math.min(
      bot.spine.length,
      targetBotSpineLength(nextMaxLevel, bot.isBoss) - (bot.bittenSegments ?? 0),
    ),
  );
  const nextSpine = advanceSpineFollowLeader(bot.spine, nextHead, nextHeading, nextLen);
  return {
    ...bot,
    level: nextLevel,
    maxLevel: nextMaxLevel,
    head: nextHead,
    prevHead: nextHead,
    heading: nextHeading,
    spine: nextSpine,
    prevSpine: nextSpine.map((p) => ({ ...p })),
  };
}

/**
 * Evaluate an AoE strike against a single bot: either eliminate weaker non-boss bots
 * outright, or slash level/maxLevel/spine consistently, stun, and optionally repel.
 */
export function shrinkOrEliminateHelper(
  bot: BotSnake,
  opts: {
    readonly playerLevel: number;
    readonly killMargin: number;
    readonly levelDamage: number;
    readonly stunTicks: number;
    readonly center: Vec2;
    readonly knockbackDist?: number;
    readonly worldRadius: number;
  },
): { readonly eliminated: boolean; readonly bot: BotSnake } {
  if (
    !bot.isBoss &&
    (bot.level <= opts.playerLevel + opts.killMargin || bot.level - opts.levelDamage <= 1)
  ) {
    return { eliminated: true, bot };
  }

  const nextLevel = Math.max(1, bot.level - opts.levelDamage);
  const nextMaxLevel = Math.max(1, (bot.maxLevel ?? bot.level) - opts.levelDamage);
  const trimmedLen = Math.min(
    bot.spine.length,
    Math.max(1, targetBotSpineLength(nextMaxLevel, bot.isBoss) - (bot.bittenSegments ?? 0)),
  );
  const trimmedSpine = matchSpineLength(bot.spine, trimmedLen);
  const prevSource = bot.prevSpine.length > 0 ? bot.prevSpine : trimmedSpine;
  const trimmedPrevSpine = matchSpineLength(prevSource, trimmedLen);

  let updated: BotSnake = {
    ...bot,
    level: nextLevel,
    maxLevel: nextMaxLevel,
    frozenTicks: Math.max(bot.frozenTicks, opts.stunTicks),
    spine: trimmedSpine,
    prevSpine: trimmedPrevSpine,
  };

  const knockback = opts.knockbackDist ?? 0;
  if (knockback > 0) {
    const dist = Math.hypot(updated.head.x - opts.center.x, updated.head.z - opts.center.z);
    const targetDist = Math.max(dist + knockback, knockback);
    updated = repelBotFrom(updated, opts.center, targetDist, opts.worldRadius, 0);
  }

  return { eliminated: false, bot: updated };
}

/** Compute desired steering heading for a single bot AI. */
function chooseBotHeading(params: {
  readonly bot: BotSnake;
  readonly allBots: readonly BotSnake[];
  readonly orbs: readonly WorldOrb[];
  readonly playerSnake: readonly Vec2[];
  readonly playerLevel: number;
  readonly playerProtected: boolean;
  readonly config: GameConfig;
  readonly rng: RngState;
}): { heading: number; rng: RngState } {
  const { bot, allBots, orbs, playerSnake, playerLevel, playerProtected, config } = params;
  const wallLimit = Math.max(4, config.worldRadius - 5.5);

  // 1. Boundary avoidance
  if (Math.abs(bot.head.x) > wallLimit || Math.abs(bot.head.z) > wallLimit) {
    return { heading: Math.atan2(-bot.head.z, -bot.head.x), rng: params.rng };
  }

  // 1b. Active-chomp evasion: veer away from playerHead within 5.0 units while stunned
  const playerHead = playerSnake[0];
  if ((bot.chompedTicks ?? 0) > 0 && playerHead !== undefined) {
    const chompDist = euclideanDistance(bot.head, playerHead);
    if (chompDist <= 5.0) {
      return {
        heading: normalizeAngle(Math.atan2(bot.head.z - playerHead.z, bot.head.x - playerHead.x)),
        rng: params.rng,
      };
    }
  }

  // 2. Threat avoidance (stronger snakes nearby)
  let threatPoint: Vec2 | null = null;
  let threatDist = 9.5;
  if (playerHead && playerLevel > bot.level) {
    const d = euclideanDistance(bot.head, playerHead);
    if (d < threatDist) {
      threatDist = d;
      threatPoint = playerHead;
    }
  }
  for (const other of allBots) {
    if (other.id === bot.id || other.level <= bot.level) continue;
    const d = euclideanDistance(bot.head, other.head);
    if (d < threatDist) {
      threatDist = d;
      threatPoint = other.head;
    }
  }
  if (threatPoint !== null) {
    return {
      heading: Math.atan2(bot.head.z - threatPoint.z, bot.head.x - threatPoint.x),
      rng: params.rng,
    };
  }

  // 3. Prey hunting (weaker snakes nearby)
  let preyHead: Vec2 | null = null;
  let preyDist = bot.isBoss ? 18 : 12.5;
  if (playerHead && !playerProtected && bot.level > playerLevel) {
    const d = euclideanDistance(bot.head, playerHead);
    if (d < preyDist) {
      preyDist = d;
      preyHead = playerHead;
    }
  }
  for (const other of allBots) {
    if (other.id === bot.id || other.isBoss || other.level >= bot.level) continue;
    const d = euclideanDistance(bot.head, other.head);
    if (d < preyDist) {
      preyDist = d;
      preyHead = other.head;
    }
  }
  if (preyHead !== null) {
    return {
      heading: Math.atan2(preyHead.z - bot.head.z, preyHead.x - bot.head.x),
      rng: params.rng,
    };
  }

  // 4. Orb foraging (prefer loot orbs)
  let bestOrb: WorldOrb | null = null;
  let bestScore = 20;
  for (const o of orbs) {
    const d = Math.hypot(o.x - bot.head.x, o.z - bot.head.z);
    const weighted = o.isLoot ? d * 0.45 : d;
    if (d < 20 && weighted < bestScore) {
      bestScore = weighted;
      bestOrb = o;
    }
  }
  if (bestOrb !== null) {
    return {
      heading: Math.atan2(bestOrb.z - bot.head.z, bestOrb.x - bot.head.x),
      rng: params.rng,
    };
  }

  // 5. Gentle wander
  const wobble = nextFloat(params.rng);
  return {
    heading: normalizeAngle(bot.heading + (wobble.value - 0.5) * 0.35),
    rng: wobble.next,
  };
}

/** Advance all AI bots: movement, freeze aura, orb foraging, and bot-vs-bot elimination. */
export function stepBots(params: {
  readonly bots: readonly BotSnake[];
  readonly orbs: readonly WorldOrb[];
  readonly playerSnake: readonly Vec2[];
  readonly playerLevel: number;
  readonly playerProtected: boolean;
  readonly playerPhoenixAura: boolean;
  readonly config: GameConfig;
  readonly difficulty?: Difficulty;
  readonly rng: RngState;
}): { bots: BotSnake[]; orbs: WorldOrb[]; rng: RngState } {
  if (params.bots.length === 0) {
    return { bots: [], orbs: [...params.orbs], rng: params.rng };
  }

  let rng = params.rng;
  const playerHead = params.playerSnake[0];
  const worldBound = Math.max(2, params.config.worldRadius - 1.2);
  const movedBots: BotSnake[] = [];

  // 1. Move each bot
  for (const bot of params.bots) {
    let frozenTicks = bot.frozenTicks;
    if (
      params.playerPhoenixAura &&
      playerHead !== undefined &&
      euclideanDistance(bot.head, playerHead) <= 4.0
    ) {
      frozenTicks = Math.max(frozenTicks, 4);
    }

    const isFrozen = frozenTicks > 0;
    const isDeepFrozen = frozenTicks >= 25;
    const nextFrozenTicks = isFrozen ? frozenTicks - 1 : 0;
    const isChomped = (bot.chompedTicks ?? 0) > 0;
    const nextChompedTicks = Math.max(0, (bot.chompedTicks ?? 0) - 1);

    const steered = chooseBotHeading({
      bot,
      allBots: params.bots,
      orbs: params.orbs,
      playerSnake: params.playerSnake,
      playerLevel: params.playerLevel,
      playerProtected: params.playerProtected,
      config: params.config,
      rng,
    });
    rng = steered.rng;

    const turnRate = bot.isBoss ? 0.2 : 0.24;
    const deltaAngle = clamp(angleDiff(bot.heading, steered.heading), -turnRate, turnRate);
    const nextHeading = normalizeAngle(bot.heading + deltaAngle);

    const diffSpeedScale = params.difficulty
      ? difficultyTuningFor(params.difficulty).botSpeedScale
      : 1;
    const baseBotSpeed =
      params.config.baseSpeed * (bot.isBoss ? 0.92 : 0.88) * BOT_SPEED_SCALE * diffSpeedScale;
    const speed = isDeepFrozen
      ? baseBotSpeed * 0.08
      : isFrozen
        ? baseBotSpeed * 0.25
        : isChomped
          ? baseBotSpeed * 0.22
          : baseBotSpeed;

    const nextHead: Vec2 = {
      x: clamp(bot.head.x + Math.cos(nextHeading) * speed, -worldBound, worldBound),
      z: clamp(bot.head.z + Math.sin(nextHeading) * speed, -worldBound, worldBound),
    };

    const targetLen = Math.min(effectiveBotSpineLength(bot), Math.max(1, bot.spine.length));
    const nextSpine = advanceSpineFollowLeader(bot.spine, nextHead, nextHeading, targetLen);
    const prevSpine = matchSpineLength(bot.spine, nextSpine.length);

    movedBots.push({
      ...bot,
      head: nextHead,
      prevHead: bot.head,
      heading: nextHeading,
      spine: nextSpine,
      prevSpine,
      frozenTicks: nextFrozenTicks,
      chompedTicks: nextChompedTicks,
    });
  }

  // 2. Bots consume nearby orbs
  const eatenOrbIds = new Set<number>();
  const botsAfterOrbs = movedBots.map((bot) => {
    const eatRadius = bot.isBoss ? 1.55 : 1.25;
    let levelGain = 0;
    for (const o of params.orbs) {
      if (eatenOrbIds.has(o.id)) continue;
      if (Math.hypot(o.x - bot.head.x, o.z - bot.head.z) <= eatRadius) {
        eatenOrbIds.add(o.id);
        if (o.isLoot || o.id % 6 === 0) {
          levelGain += 1;
        }
      }
    }
    if (levelGain === 0) return bot;
    const nextLevel = Math.min(250, bot.level + levelGain);
    const nextMaxLevel = Math.max(bot.maxLevel ?? bot.level, nextLevel);
    const rawNextBitten = Math.max(0, (bot.bittenSegments ?? 0) - levelGain * 2);
    const targetMaxLen = targetBotSpineLength(nextMaxLevel, bot.isBoss);
    const maxAllowedLen = Math.max(1, targetMaxLen - rawNextBitten);
    const nextLen = Math.min(maxAllowedLen, bot.spine.length + 1);
    const nextBitten =
      (bot.bittenSegments ?? 0) > 0
        ? Math.max(rawNextBitten, Math.max(0, targetMaxLen - nextLen))
        : 0;
    if (nextLen > bot.spine.length) {
      const nextSpine = advanceSpineFollowLeader(bot.spine, bot.head, bot.heading, nextLen);
      const nextPrevSpine = matchSpineLength(bot.prevSpine, nextSpine.length);
      return {
        ...bot,
        level: nextLevel,
        maxLevel: nextMaxLevel,
        bittenSegments: nextBitten,
        spine: nextSpine,
        prevSpine: nextPrevSpine,
      };
    }
    return {
      ...bot,
      level: nextLevel,
      maxLevel: nextMaxLevel,
      bittenSegments: nextBitten,
    };
  });

  let nextOrbs =
    eatenOrbIds.size > 0 ? params.orbs.filter((o) => !eatenOrbIds.has(o.id)) : [...params.orbs];

  // 3. Bot-vs-Bot progressive chomping (stronger bot bites up to 2 segments/tick)
  const workingBots = [...botsAfterOrbs];
  const defeatedIds = new Set<number>();

  for (let i = 0; i < workingBots.length; i++) {
    if (defeatedIds.has(workingBots[i]!.id)) continue;

    for (let j = i + 1; j < workingBots.length; j++) {
      const a = workingBots[i]!;
      const b = workingBots[j]!;
      if (defeatedIds.has(a.id)) break;
      if (defeatedIds.has(b.id)) continue;
      if (a.level === b.level) continue;

      const aIsStronger = a.level > b.level;
      const strongerIdx = aIsStronger ? i : j;
      const weakerIdx = aIsStronger ? j : i;
      const stronger = workingBots[strongerIdx]!;
      const weaker = workingBots[weakerIdx]!;
      if (weaker.isBoss || weaker.spine.length === 0) continue;

      const hitRadius = botCollisionRadius(weaker.level, weaker.isBoss);
      const candidates: { idx: number; dist: number }[] = [];
      for (let idx = 0; idx < weaker.spine.length; idx++) {
        const seg = weaker.spine[idx]!;
        if (distancePointToSegment(seg, stronger.prevHead, stronger.head) < hitRadius) {
          candidates.push({ idx, dist: euclideanDistance(seg, stronger.head) });
        }
      }
      candidates.sort((x, y) => x.dist - y.dist || x.idx - y.idx);
      let eatenIndices = candidates.slice(0, 2).map((c) => c.idx);

      if (eatenIndices.length === 0) {
        const weakerHitsStronger =
          minDistanceToChain(weaker.head, stronger.spine) <
          botCollisionRadius(stronger.level, stronger.isBoss);
        if (weakerHitsStronger) {
          eatenIndices = weaker.spine.length >= 3 ? [0, 1] : [0];
        }
      }

      if (eatenIndices.length === 0) continue;

      if (eatenIndices.length >= weaker.spine.length) {
        defeatedIds.add(weaker.id);
        const gain = Math.max(1, Math.ceil((weaker.maxLevel ?? weaker.level) * 0.25));
        const nextStrongerLevel = Math.min(250, stronger.level + gain);
        workingBots[strongerIdx] = {
          ...stronger,
          level: nextStrongerLevel,
          maxLevel: Math.max(stronger.maxLevel ?? stronger.level, nextStrongerLevel),
        };
        const scattered = scatterLootOrbs({
          orbs: nextOrbs,
          spine: weaker.spine,
          count: eatenIndices.length,
          value: 3,
          config: params.config,
          rng,
        });
        nextOrbs = scattered.orbs;
        rng = scattered.rng;
      } else {
        const chomped = applyPartialBotChomp(weaker, eatenIndices, 10);
        workingBots[weakerIdx] = chomped.bot;
        const scattered = scatterLootOrbs({
          orbs: nextOrbs,
          spine: chomped.eatenCells,
          count: eatenIndices.length,
          value: 3,
          config: params.config,
          rng,
        });
        nextOrbs = scattered.orbs;
        rng = scattered.rng;
      }
    }
  }

  const survivingBots = workingBots.filter((bot) => !defeatedIds.has(bot.id));

  return { bots: survivingBots, orbs: nextOrbs, rng };
}

/** Build the sorted leaderboard, exact player rank, and crown target position. */
export function computeLeaderboard(params: {
  readonly playerName: string;
  readonly playerLevel: number;
  readonly bots: readonly BotSnake[];
  readonly activeBossId: number | null;
}): {
  readonly leaderboard: readonly LeaderboardEntry[];
  readonly playerRank: number;
  readonly crownTarget: Vec2 | null;
} {
  const raw: {
    readonly id: string;
    readonly name: string;
    readonly level: number;
    readonly isPlayer: boolean;
    readonly isBoss: boolean;
    readonly head: Vec2 | null;
  }[] = [
    {
      id: 'player',
      name: params.playerName,
      level: params.playerLevel,
      isPlayer: true,
      isBoss: false,
      head: null,
    },
    ...params.bots.map((b) => ({
      id: `bot-${b.id}`,
      name: b.name,
      level: b.level,
      isPlayer: false,
      isBoss: b.isBoss,
      head: b.head,
    })),
  ];

  raw.sort((a, b) => {
    if (b.level !== a.level) return b.level - a.level;
    if (a.isPlayer !== b.isPlayer) return a.isPlayer ? -1 : 1;
    if (a.isBoss !== b.isBoss) return a.isBoss ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  const ranked: LeaderboardEntry[] = raw.map((item, idx) => ({
    id: item.id,
    rank: idx + 1,
    name: item.name,
    level: item.level,
    isPlayer: item.isPlayer,
    isBoss: item.isBoss,
  }));

  const playerIdx = ranked.findIndex((e) => e.isPlayer);
  const playerRank = playerIdx >= 0 ? playerIdx + 1 : ranked.length;
  const playerEntry = ranked[playerIdx];

  let leaderboard: LeaderboardEntry[];
  if (playerRank <= 3) {
    leaderboard = ranked.slice(0, 3);
  } else if (playerRank === 4) {
    leaderboard = ranked.slice(0, 4);
  } else {
    leaderboard = playerEntry ? [...ranked.slice(0, 4), playerEntry] : ranked.slice(0, 4);
  }

  let crownTarget: Vec2 | null = null;
  if (params.activeBossId !== null) {
    const boss = params.bots.find((b) => b.id === params.activeBossId);
    if (boss) {
      crownTarget = { x: boss.head.x, z: boss.head.z };
    }
  }
  if (crownTarget === null && playerRank !== 1) {
    const top = raw[0];
    if (top && top.head !== null) {
      crownTarget = { x: top.head.x, z: top.head.z };
    }
  }

  return { leaderboard, playerRank, crownTarget };
}

/** Remove eaten segments from `bot.spine`, rejoin smoothly, and update chomp metadata. */
function applyPartialBotChomp(
  bot: BotSnake,
  eatenIndices: readonly number[],
  stunTicks: number,
): { readonly bot: BotSnake; readonly eatenCells: Vec2[] } {
  const eatenSet = new Set(eatenIndices);
  const rawRemaining: Vec2[] = [];
  for (let i = 0; i < bot.spine.length; i++) {
    if (!eatenSet.has(i)) {
      rawRemaining.push(bot.spine[i]!);
    }
  }
  const eatenCells = eatenIndices.map((idx) => bot.spine[idx] ?? bot.head);
  const newHead = rawRemaining[0]!;
  const nextBotSpine = advanceSpineFollowLeader(
    rawRemaining,
    newHead,
    bot.heading,
    rawRemaining.length,
  );
  const nextPrevSpine = matchSpineLength(rawRemaining, nextBotSpine.length);
  const peakLevel = bot.maxLevel ?? bot.level;
  const nextBitten = (bot.bittenSegments ?? 0) + eatenIndices.length;
  const computedLevel = Math.max(
    1,
    Math.ceil(peakLevel * (nextBotSpine.length / Math.max(1, nextBitten + nextBotSpine.length))),
  );
  const nextBotLevel = Math.min(bot.level, computedLevel);

  return {
    bot: {
      ...bot,
      level: nextBotLevel,
      maxLevel: peakLevel,
      bittenSegments: nextBitten,
      chompedTicks: Math.max(bot.chompedTicks ?? 0, stunTicks),
      head: nextBotSpine[0]!,
      prevHead: rawRemaining[0] ?? bot.head,
      spine: nextBotSpine,
      prevSpine: nextPrevSpine,
    },
    eatenCells,
  };
}

function chompMessageForStreak(streak: number): string {
  if (streak >= 8) return 'Đại Tiệc! 👑';
  if (streak >= 5) return 'Siêu Măm! ⚡';
  if (streak >= 3) return 'Rốp rốp! 🔥';
  return 'Ngoạm! 🐍';
}

/**
 * Progressively chomp `1..3` segments of a weaker/equal bot touched by the player,
 * only finishing via {@link resolveBotDefeated} when the final segment is eaten.
 */
export function chompBotByPlayer(
  state: GameState,
  bot: BotSnake,
  prevHead: Vec2,
  nextHead: Vec2,
  isFast: boolean,
): GameState {
  if (bot.level > state.level || bot.spine.length === 0) {
    return state;
  }

  const effectivePrevHead =
    Math.hypot(nextHead.x - prevHead.x, nextHead.z - prevHead.z) > 4 ? nextHead : prevHead;
  const biteRadius = Math.max(
    1.2,
    botCollisionRadius(bot.level, bot.isBoss) + (state.chompStreak > 0 ? 0.24 : 0.1),
  );

  const candidates: { idx: number; distToNextHead: number }[] = [];
  for (let idx = 0; idx < bot.spine.length; idx++) {
    const seg = bot.spine[idx]!;
    if (distancePointToSegment(seg, effectivePrevHead, nextHead) <= biteRadius) {
      candidates.push({
        idx,
        distToNextHead: euclideanDistance(seg, nextHead),
      });
    }
  }
  candidates.sort((a, b) => a.distToNextHead - b.distToNextHead || a.idx - b.idx);

  const fromHeadSweep = candidates.length > 0;
  let eatenCandidates = candidates.map((c) => c.idx);

  if (!fromHeadSweep) {
    if (minDistanceToChain(bot.head, state.snake) < botCollisionRadius(bot.level, bot.isBoss)) {
      eatenCandidates = bot.spine.length >= 3 ? [0, 1] : [0];
    }
  }

  if (eatenCandidates.length === 0) {
    return state;
  }

  const maxBites = isFast ? 3 : 2;
  const eatenIndices = eatenCandidates.slice(0, maxBites);
  const eatenCount = eatenIndices.length;
  const nextStreak = state.chompStreak + eatenCount;
  const chompStreakTicks = 16;
  const biteCell = bot.spine[eatenIndices[0]!] ?? bot.head;

  if (eatenCount >= bot.spine.length) {
    return resolveBotDefeated(
      { ...state, chompStreak: nextStreak, chompStreakTicks },
      { ...bot, level: bot.maxLevel ?? bot.level },
      biteCell,
    );
  }

  const chomped = applyPartialBotChomp(bot, eatenIndices, 14);
  const nextBots = state.bots.map((b) => (b.id === bot.id ? chomped.bot : b));
  const scattered = scatterLootOrbs({
    orbs: state.orbs,
    spine: chomped.eatenCells,
    count: eatenCount,
    value: 3,
    config: state.config,
    rng: state.rng,
  });

  const bitePoints = eatenCount * ((bot.isBoss ? 20 : 12) + Math.min(28, nextStreak * 3));
  const biteXp = eatenCount * (bot.isBoss ? 5 : 3);
  const ev = appendEvents(state.events, state.eventSeq, [
    {
      kind: 'bot_chomp',
      cell: biteCell,
      form: bot.powerForm,
      points: bitePoints,
      chompStreak: nextStreak,
      messageVi: chompMessageForStreak(nextStreak),
    },
  ]);
  const xpRes = applyXpAndScore({
    score: state.score,
    best: state.best,
    level: state.level,
    xp: state.xp,
    gainXp: biteXp,
    points: bitePoints,
    events: ev.events,
    eventSeq: ev.eventSeq,
    cell: biteCell,
  });

  const bossProgress = bot.isBoss
    ? state.bossProgress
    : Math.min(100, state.bossProgress + eatenCount * 2);
  const board = computeLeaderboard({
    playerName: state.playerName,
    playerLevel: xpRes.level,
    bots: nextBots,
    activeBossId: state.activeBossId,
  });

  // Feast-Assist Nudge: softly pull the player's head along the surviving bot body
  let nextSnake = state.snake;
  let nextPrevSnake = state.prevSnake;
  const playerHead = state.snake[0];
  if (fromHeadSweep && chomped.bot.spine.length > 0 && playerHead !== undefined) {
    let nearestSurviving: Vec2 | null = null;
    let nearestDist = Infinity;
    for (const seg of chomped.bot.spine) {
      const d = euclideanDistance(seg, nextHead);
      if (d < nearestDist) {
        nearestDist = d;
        nearestSurviving = seg;
      }
    }
    if (nearestSurviving !== null && nearestDist > 0.15 && nearestDist < 1.85) {
      const dx = nearestSurviving.x - playerHead.x;
      const dz = nearestSurviving.z - playerHead.z;
      const dHead = Math.hypot(dx, dz);
      if (dHead > 0.15 && dHead < 1.85) {
        const safeRadius = Math.max(2, state.config.worldRadius - 0.8);
        const nudgedHead: Vec2 = {
          x: clamp(playerHead.x + (dx / dHead) * 0.14, -safeRadius, safeRadius),
          z: clamp(playerHead.z + (dz / dHead) * 0.14, -safeRadius, safeRadius),
        };
        nextSnake = advanceSpineFollowLeader(
          state.snake,
          nudgedHead,
          state.heading,
          state.snake.length,
        );
        nextPrevSnake = matchSpineLength(state.prevSnake, nextSnake.length);
      }
    }
  }

  return {
    ...state,
    snake: nextSnake,
    prevSnake: nextPrevSnake,
    bots: nextBots,
    orbs: scattered.orbs,
    rng: scattered.rng,
    chompStreak: nextStreak,
    chompStreakTicks,
    score: xpRes.score,
    best: xpRes.best,
    level: xpRes.level,
    xp: xpRes.xp,
    bossProgress,
    leaderboard: board.leaderboard,
    playerRank: board.playerRank,
    crownTarget: board.crownTarget,
    events: xpRes.events,
    eventSeq: xpRes.eventSeq,
  };
}

/**
 * Reward the player when a bot (or Boss) is eaten or destroyed by projectiles:
 * scatter loot orbs, boost level/score, grant absorbedPower, advance Boss progress & boosters.
 */
export function resolveBotDefeated(state: GameState, bot: BotSnake, hitPos?: Vec2): GameState {
  const lootCount = clamp(
    Math.floor(
      Math.max(bot.spine.length, (bot.bittenSegments ?? 0) * 0.45 + bot.spine.length) * 0.65,
    ),
    8,
    16,
  );
  const scattered = scatterLootOrbs({
    orbs: state.orbs,
    spine: bot.spine,
    count: lootCount,
    value: 3,
    config: state.config,
    rng: state.rng,
  });

  const remainingBots = state.bots.filter((b) => b.id !== bot.id);
  const botsEaten = state.botsEaten + 1;
  const enemiesDefeated = state.enemiesDefeated + 1;
  const combo = state.combo + 1;

  const levelGain = bot.isBoss ? 15 : Math.max(1, Math.ceil(Math.max(1, bot.level) * 0.35));
  const nextLevel = state.level + levelGain;
  const points = bot.isBoss ? 500 : 80 + Math.max(1, bot.level) * 12;
  const score = state.score + points;
  const best = Math.max(state.best, score);

  let bossProgress = bot.isBoss ? 0 : Math.min(100, state.bossProgress + 16);
  const activeBossId = bot.isBoss ? null : state.activeBossId;
  const bossTargetLevel = bot.isBoss
    ? Math.max(state.bossTargetLevel + 10, Math.round(state.bossTargetLevel * 1.6))
    : state.bossTargetLevel;

  const absorbedPower: AbsorbedBotPower = {
    form: bot.powerForm,
    titleVi: absorbedPowerTitle(bot.powerForm),
    ticksRemaining: 160,
    maxTicks: 160,
  };

  let hearts = state.hearts;
  let shieldTicks = state.shieldTicks;
  const drafts: EventDraft[] = [
    {
      kind: 'bot_eaten',
      cell: hitPos ?? bot.head,
      form: bot.powerForm,
      points,
      messageVi: `Chén gọn ${bot.name}! +${levelGain} Cấp ⚡`,
    },
  ];

  if (bot.powerForm === 'spirit') {
    if (hearts < state.maxHearts) {
      hearts += 1;
      drafts.push({
        kind: 'heart_gained',
        cell: state.snake[0],
        messageVi: 'Tinh Linh hồi +1 Tim! 💖',
      });
    }
    shieldTicks = Math.max(shieldTicks, 80);
  }

  let boosters = state.boosters;
  if (bot.isBoss) {
    if (hearts < state.maxHearts) {
      hearts += 1;
      drafts.push({
        kind: 'heart_gained',
        cell: state.snake[0],
        messageVi: 'Thưởng hạ Boss +1 Tim! 💖',
      });
    }
    boosters = grantBoosterCharge(boosters, botsEaten).boosters;
    drafts.push({
      kind: 'boss_defeated',
      cell: bot.head,
      points,
      messageVi: '👑 Hạ gục Boss Đại Vương Rồng! +15 Cấp!',
    });
    bossProgress = 0;
  }

  if (botsEaten % 3 === 0) {
    boosters = grantBoosterCharge(boosters, botsEaten + 1).boosters;
  }

  drafts.push({
    kind: 'level_up',
    cell: state.snake[0],
    messageVi: `Chúc mừng! Bé lên Cấp ${nextLevel}! 🎉`,
  });

  const ev = appendEvents(state.events, state.eventSeq, drafts);
  const board = computeLeaderboard({
    playerName: state.playerName,
    playerLevel: nextLevel,
    bots: remainingBots,
    activeBossId,
  });

  return {
    ...state,
    bots: remainingBots,
    orbs: scattered.orbs,
    rng: scattered.rng,
    botsEaten,
    enemiesDefeated,
    combo,
    level: nextLevel,
    score,
    best,
    bossProgress,
    activeBossId,
    bossTargetLevel,
    absorbedPower,
    hearts,
    shieldTicks,
    boosters,
    leaderboard: board.leaderboard,
    playerRank: board.playerRank,
    crownTarget: board.crownTarget,
    events: ev.events,
    eventSeq: ev.eventSeq,
  };
}
