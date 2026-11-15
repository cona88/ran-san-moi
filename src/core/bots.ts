import type {
  AbsorbedBotPower,
  BotSkin,
  BotSnake,
  GameConfig,
  GameState,
  LeaderboardEntry,
  RngState,
  SnakeForm,
  Vec2,
  WorldOrb,
} from './types';
import { advanceSpineFollowLeader, buildStraightSpine, matchSpineLength } from './movement';
import { appendEvents, grantBoosterCharge, type EventDraft } from './quests';
import { nextFloat, nextInt } from './rng';
import { angleDiff, clamp, euclideanDistance, normalizeAngle } from './systems/arena';
import { minDistanceToChain } from './systems/collision';
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
      return 'Hấp thụ: Bắn Siêu Tốc x2 🌸';
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
    head: params.head,
    prevHead: params.head,
    heading: params.heading,
    spine,
    prevSpine: spine.map((p) => ({ ...p })),
    frozenTicks: 0,
    powerForm: powerFormForSkin(params.skin),
  };
}

/** Spawn the initial set of AI bots around the open world (`>= 10` units from player). */
export function createInitialBots(params: {
  readonly config: GameConfig;
  readonly playerHead: Vec2;
  readonly playerLevel: number;
  readonly rng: RngState;
}): { bots: BotSnake[]; rng: RngState } {
  const count = params.config.botCount;
  let rng = params.rng;
  const bots: BotSnake[] = [];
  const nearLowCount = Math.min(4, Math.max(2, Math.floor(count / 3)));

  for (let i = 0; i < count; i++) {
    const id = i + 1;
    const isNearLow = i < nearLowCount;

    const ring = sampleRingPos({
      center: params.playerHead,
      minDist: isNearLow ? 10.5 : 13,
      maxDist: isNearLow ? 18.5 : Math.max(22, params.config.worldRadius - 3),
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
      if (tier.value < 0.6) {
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
    const ring = sampleRingPos({
      center: params.playerHead,
      minDist,
      maxDist: Math.max(minDist + 8, params.config.worldRadius - 3),
      config: params.config,
      rng,
    });
    rng = ring.rng;

    const tier = nextFloat(rng);
    const sub = nextFloat(tier.next);
    rng = sub.next;

    let level: number;
    if (tier.value < 0.6) {
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
  const nextSpine = advanceSpineFollowLeader(
    bot.spine,
    nextHead,
    nextHeading,
    targetBotSpineLength(nextLevel, bot.isBoss),
  );
  return {
    ...bot,
    level: nextLevel,
    head: nextHead,
    prevHead: nextHead,
    heading: nextHeading,
    spine: nextSpine,
    prevSpine: nextSpine.map((p) => ({ ...p })),
  };
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

  // 2. Threat avoidance (stronger snakes nearby)
  let threatPoint: Vec2 | null = null;
  let threatDist = 9.5;
  const playerHead = playerSnake[0];
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
    const nextFrozenTicks = isFrozen ? frozenTicks - 1 : 0;

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

    const baseBotSpeed = params.config.baseSpeed * (bot.isBoss ? 0.92 : 0.88);
    const speed = isFrozen ? baseBotSpeed * 0.25 : baseBotSpeed;

    const nextHead: Vec2 = {
      x: clamp(bot.head.x + Math.cos(nextHeading) * speed, -worldBound, worldBound),
      z: clamp(bot.head.z + Math.sin(nextHeading) * speed, -worldBound, worldBound),
    };

    const targetLen = targetBotSpineLength(bot.level, bot.isBoss);
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
    return { ...bot, level: nextLevel };
  });

  let nextOrbs =
    eatenOrbIds.size > 0 ? params.orbs.filter((o) => !eatenOrbIds.has(o.id)) : [...params.orbs];

  // 3. Bot-vs-Bot elimination (stronger bot eats weaker non-boss bot)
  const defeatedIds = new Set<number>();
  const levelBoostByBot = new Map<number, number>();

  for (let i = 0; i < botsAfterOrbs.length; i++) {
    const a = botsAfterOrbs[i]!;
    if (defeatedIds.has(a.id)) continue;

    for (let j = i + 1; j < botsAfterOrbs.length; j++) {
      const b = botsAfterOrbs[j]!;
      if (defeatedIds.has(b.id)) continue;
      if (a.level === b.level) continue;

      const stronger = a.level > b.level ? a : b;
      const weaker = a.level > b.level ? b : a;
      if (weaker.isBoss) continue;

      const hitRadius = botCollisionRadius(weaker.level, weaker.isBoss);
      const strongerHitsWeaker = minDistanceToChain(stronger.head, weaker.spine) < hitRadius;
      const weakerHitsStronger =
        minDistanceToChain(weaker.head, stronger.spine) <
        botCollisionRadius(stronger.level, stronger.isBoss);

      if (strongerHitsWeaker || weakerHitsStronger) {
        defeatedIds.add(weaker.id);
        const gain = Math.max(1, Math.ceil(weaker.level * 0.25));
        levelBoostByBot.set(stronger.id, (levelBoostByBot.get(stronger.id) ?? 0) + gain);

        const scattered = scatterLootOrbs({
          orbs: nextOrbs,
          spine: weaker.spine,
          count: 5,
          value: 3,
          config: params.config,
          rng,
        });
        nextOrbs = scattered.orbs;
        rng = scattered.rng;
      }
    }
  }

  const survivingBots: BotSnake[] = [];
  for (const bot of botsAfterOrbs) {
    if (defeatedIds.has(bot.id)) continue;
    const boost = levelBoostByBot.get(bot.id) ?? 0;
    if (boost > 0) {
      survivingBots.push({ ...bot, level: Math.min(250, bot.level + boost) });
    } else {
      survivingBots.push(bot);
    }
  }

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

/**
 * Reward the player when a bot (or Boss) is eaten or destroyed by projectiles:
 * scatter loot orbs, boost level/score, grant absorbedPower, advance Boss progress & boosters.
 */
export function resolveBotDefeated(state: GameState, bot: BotSnake, hitPos?: Vec2): GameState {
  const lootCount = clamp(Math.floor(bot.spine.length * 0.65), 8, 16);
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
