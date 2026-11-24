import type {
  BotSnake,
  GameConfig,
  GameState,
  MonsterEventState,
  RoamingMonster,
  RoamingMonsterKind,
  ShelterHouse,
  Vec2,
} from './types';
import {
  DEFAULT_MONSTER_INTERVAL_TICKS,
  DEFAULT_MONSTER_STRIKE_TICKS,
  DEFAULT_MONSTER_WARNING_TICKS,
  DEFAULT_SHELTER_RADIUS,
} from './config';
import { angleDiff, clamp, normalizeAngle } from './systems/arena';
import { advanceSpineFollowLeader, matchSpineLength } from './movement';
import { appendEvents, applyXpAndScore, type EventDraft } from './quests';
import { scatterLootOrbs } from './systems/food';
import { nextFloat } from './rng';

/**
 * 11 Sanctuary Fairy Houses & Palaces distributed across the 560x560 arena (-280 .. +280):
 * - 1 Central Royal Castle (Radius 16)
 * - 4 Regional Cardinal Sanctuaries (Radius 14: North & South Mushrooms, East & West Crystals)
 * - 2 Regional Diagonal Sanctuaries (Radius 13: NW Mushroom & SE Crystal)
 * - 4 Wonder Exploration Palaces for girls (Radius 14-15: Mermaid Palace, Candy Castle, Blossom Sanctuary, Starlight Palace)
 */
export const DEFAULT_SHELTERS: readonly ShelterHouse[] = [
  {
    id: 'shelter-castle-center',
    kind: 'castle',
    x: 0,
    z: 0,
    radius: 16,
    nameVi: '🏰 Lâu Đài Phép Thuật Trung Tâm',
    colorHex: 0xffd700,
  },
  {
    id: 'shelter-mushroom-north',
    kind: 'mushroom',
    x: 0,
    z: -160,
    radius: DEFAULT_SHELTER_RADIUS,
    nameVi: '🍄 Nhà Nấm Phương Bắc',
    colorHex: 0xff69b4,
  },
  {
    id: 'shelter-mushroom-south',
    kind: 'mushroom',
    x: 0,
    z: 160,
    radius: DEFAULT_SHELTER_RADIUS,
    nameVi: '🍄 Nhà Nấm Phương Nam',
    colorHex: 0xff7f50,
  },
  {
    id: 'shelter-crystal-east',
    kind: 'crystal',
    x: 160,
    z: 0,
    radius: DEFAULT_SHELTER_RADIUS,
    nameVi: '💎 Thánh Điện Pha Lê Đông',
    colorHex: 0x00ffff,
  },
  {
    id: 'shelter-crystal-west',
    kind: 'crystal',
    x: -160,
    z: 0,
    radius: DEFAULT_SHELTER_RADIUS,
    nameVi: '💎 Thánh Điện Pha Lê Tây',
    colorHex: 0x7b68ee,
  },
  {
    id: 'shelter-mushroom-nw',
    kind: 'mushroom',
    x: -140,
    z: -140,
    radius: 13,
    nameVi: '🍄 Nhà Nấm Thần Tiên Tây Bắc',
    colorHex: 0xffb6c1,
  },
  {
    id: 'shelter-crystal-se',
    kind: 'crystal',
    x: 140,
    z: 140,
    radius: 13,
    nameVi: '💎 Thánh Điện Pha Lê Đông Nam',
    colorHex: 0x98fb98,
  },
  {
    id: 'shelter-mermaid-sw',
    kind: 'mermaid',
    x: -180,
    z: 120,
    radius: 15,
    nameVi: '🧜‍♀️ Cung Điện Nàng Tiên Cá Đại Dương',
    colorHex: 0x00e5ff,
  },
  {
    id: 'shelter-candy-ne',
    kind: 'candy',
    x: 180,
    z: -120,
    radius: 15,
    nameVi: '🍭 Lâu Đài Kẹo Ngọt Cầu Vồng',
    colorHex: 0xff69b4,
  },
  {
    id: 'shelter-blossom-nw',
    kind: 'blossom',
    x: -120,
    z: -180,
    radius: 14,
    nameVi: '🌸 Lâu Đài Hoa Tiên Bướm',
    colorHex: 0xff85c0,
  },
  {
    id: 'shelter-starlight-se',
    kind: 'starlight',
    x: 120,
    z: 180,
    radius: 14,
    nameVi: '⭐ Cung Điện Tinh Tú Ánh Sao',
    colorHex: 0xb388ff,
  },
];

/** Create a fresh copy of the default sanctuary shelter houses. */
export function createInitialShelters(worldRadius?: number): ShelterHouse[] {
  if (!worldRadius || Math.abs(worldRadius - 280) < 1) {
    return DEFAULT_SHELTERS.map((s) => ({ ...s }));
  }
  const scale = worldRadius / 280;
  return DEFAULT_SHELTERS.map((s) => ({
    ...s,
    x: Math.round(s.x * scale),
    z: Math.round(s.z * scale),
    radius: Math.max(8, Math.round(s.radius * Math.min(1.2, Math.max(0.7, scale)))),
  }));
}

export const DEFAULT_MONSTER_SPEED = 0.55;
export const MONSTER_SPAWN_DISTANCE = 25;
export const MONSTER_SHIELD_BARRIER_MARGIN = 1.8;

/** Create the initial idle state for the periodic Monster Calamity event. */
export function createInitialMonsterEvent(config?: GameConfig): MonsterEventState {
  const interval = config?.monsterEventIntervalTicks ?? DEFAULT_MONSTER_INTERVAL_TICKS;
  return {
    phase: 'idle',
    ticksRemaining: interval,
    maxTicks: interval,
    countdownSec: Math.max(0, Math.ceil(interval / 20)),
    progress: 0,
    monsterPos: { x: 0, z: -100 },
    monsterHeading: 0,
    monsterSpeed: 0,
    distanceToPlayer: 999,
    isChasing: false,
    isBlockedByShelter: false,
    targetShelterId: null,
  };
}

/** Check whether a continuous coordinate is within a shelter's protective dome. */
export function isInsideShelter(pos: Vec2, shelter: ShelterHouse, margin = 0): boolean {
  const dx = pos.x - shelter.x;
  const dz = pos.z - shelter.z;
  return Math.hypot(dx, dz) <= shelter.radius + margin;
}

/** Find the shelter house currently covering `pos`, if any. */
export function findCurrentShelter(
  pos: Vec2,
  shelters: readonly ShelterHouse[],
  margin = 0,
): ShelterHouse | null {
  for (const shelter of shelters) {
    if (isInsideShelter(pos, shelter, margin)) {
      return shelter;
    }
  }
  return null;
}

/** Find the nearest shelter house from `pos` and its Euclidean distance. */
export function findNearestShelter(
  pos: Vec2,
  shelters: readonly ShelterHouse[],
): { shelter: ShelterHouse; distance: number } | null {
  if (shelters.length === 0) return null;
  let best = shelters[0]!;
  let bestDist = Math.hypot(pos.x - best.x, pos.z - best.z);
  for (let i = 1; i < shelters.length; i++) {
    const s = shelters[i]!;
    const d = Math.hypot(pos.x - s.x, pos.z - s.z);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return { shelter: best, distance: bestDist };
}

export interface StepMonsterResult {
  readonly nextEvent: MonsterEventState;
  readonly eventDrafts: EventDraft[];
  readonly strikeTriggered: boolean;
}

/**
 * Advance the periodic Sky Monster Calamity state machine:
 * `idle` (50s-60s) -> `warning` (8s) -> `strike` (1s) -> `idle`
 */
export function stepMonsterEvent(
  current: MonsterEventState,
  config: GameConfig,
  playerHead: Vec2 = { x: 0, z: 0 },
  shelters: readonly ShelterHouse[] = [],
  inShelter = false,
): StepMonsterResult {
  const warningTicks = config.monsterWarningTicks ?? DEFAULT_MONSTER_WARNING_TICKS;
  const strikeTicks = config.monsterStrikeTicks ?? DEFAULT_MONSTER_STRIKE_TICKS;
  const intervalTicks = config.monsterEventIntervalTicks ?? DEFAULT_MONSTER_INTERVAL_TICKS;
  const speed = DEFAULT_MONSTER_SPEED;

  if (current.phase === 'idle') {
    if (current.ticksRemaining <= 1) {
      // Spawn monster ~25 units behind/near the player so it immediately appears in the area
      const spawnOffset = { x: -20, z: -15 };
      let monsterX = playerHead.x + spawnOffset.x;
      let monsterZ = playerHead.z + spawnOffset.z;
      const toPlayerX = playerHead.x - monsterX;
      const toPlayerZ = playerHead.z - monsterZ;
      const monsterHeading = Math.atan2(toPlayerZ, toPlayerX);
      let isBlocked = false;
      let targetShelterId: string | null = null;

      if (inShelter && shelters.length > 0) {
        const shelter =
          findCurrentShelter(playerHead, shelters) ??
          findNearestShelter(playerHead, shelters)?.shelter;
        if (shelter) {
          targetShelterId = shelter.id;
          const toCx = monsterX - shelter.x;
          const toCz = monsterZ - shelter.z;
          const distToCenter = Math.hypot(toCx, toCz);
          const shieldPerimeter = shelter.radius + MONSTER_SHIELD_BARRIER_MARGIN;
          if (distToCenter <= shieldPerimeter) {
            isBlocked = true;
            const angle = distToCenter > 0.001 ? Math.atan2(toCz, toCx) : 0;
            monsterX = shelter.x + Math.cos(angle) * shieldPerimeter;
            monsterZ = shelter.z + Math.sin(angle) * shieldPerimeter;
          }
        }
      }

      const distanceToPlayer = Number(
        Math.hypot(monsterX - playerHead.x, monsterZ - playerHead.z).toFixed(2),
      );

      return {
        nextEvent: {
          phase: 'warning',
          ticksRemaining: warningTicks,
          maxTicks: warningTicks,
          countdownSec: Math.ceil(warningTicks / 20),
          progress: 0,
          monsterPos: { x: monsterX, z: monsterZ },
          monsterHeading,
          monsterSpeed: speed,
          distanceToPlayer,
          isChasing: true,
          isBlockedByShelter: isBlocked,
          targetShelterId,
        },
        eventDrafts: [
          {
            kind: 'monster_warning',
            messageVi: '⚠️ QUÁI VẬT BÃO TÁP ĐANG ĐẾN! VÀO NHÀ MAU! (08s)',
          },
        ],
        strikeTriggered: false,
      };
    }
    const rem = current.ticksRemaining - 1;
    const idlePos = current.monsterPos ?? { x: 0, z: -100 };
    return {
      nextEvent: {
        phase: 'idle',
        ticksRemaining: rem,
        maxTicks: current.maxTicks,
        countdownSec: Math.max(0, Math.ceil(rem / 20)),
        progress: Number((1 - rem / Math.max(1, current.maxTicks)).toFixed(3)),
        monsterPos: idlePos,
        monsterHeading: current.monsterHeading ?? 0,
        monsterSpeed: 0,
        distanceToPlayer: current.distanceToPlayer ?? 999,
        isChasing: false,
        isBlockedByShelter: false,
        targetShelterId: null,
      },
      eventDrafts: [],
      strikeTriggered: false,
    };
  }

  if (current.phase === 'warning') {
    const prevPos = current.monsterPos ?? { x: playerHead.x - 20, z: playerHead.z - 15 };
    const toPlayerX = playerHead.x - prevPos.x;
    const toPlayerZ = playerHead.z - prevPos.z;
    const dist = Math.hypot(toPlayerX, toPlayerZ);

    let nextX = prevPos.x + (dist > 0.001 ? (toPlayerX / dist) * Math.min(speed, dist) : 0);
    let nextZ = prevPos.z + (dist > 0.001 ? (toPlayerZ / dist) * Math.min(speed, dist) : 0);
    let nextHeading =
      dist > 0.001 ? Math.atan2(toPlayerZ, toPlayerX) : (current.monsterHeading ?? 0);
    let isBlocked = false;
    let targetShelterId: string | null = null;

    if (inShelter && shelters.length > 0) {
      const shelter =
        findCurrentShelter(playerHead, shelters) ??
        findNearestShelter(playerHead, shelters)?.shelter;
      if (shelter) {
        targetShelterId = shelter.id;
        const toCx = nextX - shelter.x;
        const toCz = nextZ - shelter.z;
        const distToCenter = Math.hypot(toCx, toCz);
        const shieldPerimeter = shelter.radius + MONSTER_SHIELD_BARRIER_MARGIN;

        if (distToCenter <= shieldPerimeter) {
          isBlocked = true;
          // Clamp outside shield perimeter and orbit around dome
          const currentAngle = distToCenter > 0.0001 ? Math.atan2(toCz, toCx) : nextHeading;
          const orbitAngle = currentAngle + speed / shieldPerimeter;
          nextX = shelter.x + Math.cos(orbitAngle) * shieldPerimeter;
          nextZ = shelter.z + Math.sin(orbitAngle) * shieldPerimeter;
          nextHeading = Math.atan2(playerHead.z - nextZ, playerHead.x - nextX);
        }
      }
    }
    const distanceToPlayer = Number(
      Math.hypot(nextX - playerHead.x, nextZ - playerHead.z).toFixed(2),
    );

    if (current.ticksRemaining <= 1) {
      return {
        nextEvent: {
          phase: 'strike',
          ticksRemaining: strikeTicks,
          maxTicks: strikeTicks,
          countdownSec: Math.ceil(strikeTicks / 20),
          progress: 0,
          monsterPos: { x: nextX, z: nextZ },
          monsterHeading: nextHeading,
          monsterSpeed: speed,
          distanceToPlayer,
          isChasing: true,
          isBlockedByShelter: isBlocked,
          targetShelterId,
        },
        eventDrafts: [
          {
            kind: 'monster_strike',
            messageVi: '⚡ BÃO TÁP QUÁI VẬT GIÁNG XUỐNG! ⚡',
          },
        ],
        strikeTriggered: true,
      };
    }
    const rem = current.ticksRemaining - 1;
    return {
      nextEvent: {
        phase: 'warning',
        ticksRemaining: rem,
        maxTicks: current.maxTicks,
        countdownSec: Math.max(0, Math.ceil(rem / 20)),
        progress: Number((1 - rem / Math.max(1, current.maxTicks)).toFixed(3)),
        monsterPos: { x: nextX, z: nextZ },
        monsterHeading: nextHeading,
        monsterSpeed: speed,
        distanceToPlayer,
        isChasing: true,
        isBlockedByShelter: isBlocked,
        targetShelterId,
      },
      eventDrafts: [],
      strikeTriggered: false,
    };
  }

  // Phase: 'strike'
  if (current.ticksRemaining <= 1) {
    return {
      nextEvent: {
        phase: 'idle',
        ticksRemaining: intervalTicks,
        maxTicks: intervalTicks,
        countdownSec: Math.ceil(intervalTicks / 20),
        progress: 0,
        monsterPos: { x: 0, z: -100 },
        monsterHeading: 0,
        monsterSpeed: 0,
        distanceToPlayer: 999,
        isChasing: false,
        isBlockedByShelter: false,
        targetShelterId: null,
      },
      eventDrafts: [],
      strikeTriggered: false,
    };
  }
  const rem = current.ticksRemaining - 1;
  return {
    nextEvent: {
      phase: 'strike',
      ticksRemaining: rem,
      maxTicks: current.maxTicks,
      countdownSec: Math.max(0, Math.ceil(rem / 20)),
      progress: Number((1 - rem / Math.max(1, current.maxTicks)).toFixed(3)),
      monsterPos: current.monsterPos ?? { x: 0, z: 0 },
      monsterHeading: current.monsterHeading ?? 0,
      monsterSpeed: current.monsterSpeed ?? 0,
      distanceToPlayer: current.distanceToPlayer ?? 0,
      isChasing: current.isChasing ?? true,
      isBlockedByShelter: current.isBlockedByShelter ?? false,
      targetShelterId: current.targetShelterId ?? null,
    },
    eventDrafts: [],
    strikeTriggered: false,
  };
}

/**
 * Steer AI bots toward their nearest shelter house when monster warning is active.
 * Bots already deep inside shelter stay protected; bots outside flee at sprint speed.
 */
export function applyBotShelterFlee(
  bots: readonly BotSnake[],
  shelters: readonly ShelterHouse[],
  worldRadius: number,
  isWarning: boolean,
): BotSnake[] {
  if (!isWarning || bots.length === 0 || shelters.length === 0) {
    return [...bots];
  }

  const bound = Math.max(2, worldRadius - 1.2);

  return bots.map((bot) => {
    // If bot is deep frozen or stunned, it cannot flee effectively
    if (bot.frozenTicks >= 20) {
      return bot;
    }

    const nearest = findNearestShelter(bot.head, shelters);
    if (!nearest) return bot;

    const insideThreshold = nearest.shelter.radius * 0.75;
    if (nearest.distance <= insideThreshold) {
      // Already inside shelter: keep bot safely circling or resting inside
      return bot;
    }

    // Outside shelter: calculate heading towards shelter center
    const targetAngle = Math.atan2(nearest.shelter.z - bot.head.z, nearest.shelter.x - bot.head.x);
    const turnRate = bot.isBoss ? 0.35 : 0.42;
    const diff = clamp(angleDiff(bot.heading, targetAngle), -turnRate, turnRate);
    const nextHeading = normalizeAngle(bot.heading + diff);

    // Give bot extra fleeing speed toward safety
    const fleeSpeed = 0.55;
    const nextHead: Vec2 = {
      x: clamp(bot.head.x + Math.cos(nextHeading) * fleeSpeed, -bound, bound),
      z: clamp(bot.head.z + Math.sin(nextHeading) * fleeSpeed, -bound, bound),
    };
    const nextSpine = advanceSpineFollowLeader(bot.spine, nextHead, nextHeading, bot.spine.length);
    const prevSpine = matchSpineLength(bot.spine, nextSpine.length);

    return {
      ...bot,
      head: nextHead,
      prevHead: bot.head,
      heading: nextHeading,
      spine: nextSpine,
      prevSpine,
    };
  });
}

/** Survival bonus awarded to player when safely protected inside shelter during strike. */
export const SHELTER_SURVIVAL_SCORE = 300;
export const SHELTER_SURVIVAL_XP = 15;

/**
 * Resolve the lethal strike of the Sky Monster:
 * - Inside shelter: safe, earns survival score/xp bonus and celebratory event.
 * - Outside shelter: loses all hearts, gameover.
 * - Bots outside shelter are eliminated and scatter loot orbs; bots inside survive.
 */
export function resolveMonsterCalamityStrike(params: {
  readonly state: GameState;
  readonly config: GameConfig;
}): GameState {
  const { state, config } = params;
  const playerHead = state.snake[0] ?? { x: 0, z: 0 };
  const currentShelter = findCurrentShelter(playerHead, state.shelters);
  const isSheltered = currentShelter !== null;

  // 1. Player check
  if (!isSheltered) {
    // Player caught outside in the storm!
    const ev = appendEvents(state.events, state.eventSeq, [
      {
        kind: 'monster_strike',
        cell: playerHead,
        messageVi: '⚡ BÃO TÁP QUÁI VẬT ĐÃ GIÁNG XUỐNG! ⚡',
      },
      {
        kind: 'gameover',
        cell: playerHead,
        messageVi: '⚡ Bão sét Quái Vật đã cuốn trôi! Lần sau hãy chạy vào Nhà Nấm trú ẩn nhé! ⚡',
      },
    ]);
    return {
      ...state,
      hearts: 0,
      combo: 0,
      isDashing: false,
      phase: 'gameover',
      won: false,
      events: ev.events,
      eventSeq: ev.eventSeq,
    };
  }

  // Player is safely sheltered!
  const survivingBots: BotSnake[] = [];
  let orbs = [...state.orbs];
  let rng = state.rng;
  let botsDefeatedByCalamity = 0;

  for (const bot of state.bots) {
    const botShelter = findCurrentShelter(bot.head, state.shelters);
    if (botShelter !== null) {
      // Bot survived inside shelter!
      survivingBots.push(bot);
    } else {
      // Bot struck down outside shelter
      botsDefeatedByCalamity++;
      const scattered = scatterLootOrbs({
        orbs,
        spine: bot.spine,
        count: Math.min(4, Math.max(2, Math.floor(bot.level / 4))),
        value: 3,
        config,
        rng,
      });
      orbs = scattered.orbs;
      rng = scattered.rng;
    }
  }

  // Award survival bonus to player
  const ev = appendEvents(state.events, state.eventSeq, [
    {
      kind: 'monster_strike',
      cell: playerHead,
      messageVi: '⚡ BÃO TÁP QUÁI VẬT GIÁNG XUỐNG NGOÀI KIA! ⚡',
    },
    {
      kind: 'shelter_enter',
      cell: playerHead,
      points: SHELTER_SURVIVAL_SCORE,
      messageVi: `✨ TRÚ ẨN THÀNH CÔNG! Bé đã an toàn trong ${currentShelter.nameVi}! +${SHELTER_SURVIVAL_SCORE}đ ✨`,
    },
  ]);

  const xpRes = applyXpAndScore({
    score: state.score,
    best: state.best,
    level: state.level,
    xp: state.xp,
    gainXp: SHELTER_SURVIVAL_XP,
    points: SHELTER_SURVIVAL_SCORE,
    events: ev.events,
    eventSeq: ev.eventSeq,
    cell: playerHead,
  });

  return {
    ...state,
    score: xpRes.score,
    best: xpRes.best,
    level: xpRes.level,
    xp: xpRes.xp,
    bots: survivingBots,
    orbs,
    rng,
    enemiesDefeated: state.enemiesDefeated + botsDefeatedByCalamity,
    events: xpRes.events,
    eventSeq: xpRes.eventSeq,
  };
}

export const ROAMING_MONSTER_COUNT_MIN = 4;
export const ROAMING_MONSTER_COUNT_TARGET = 5;
export const ROAMING_MONSTER_COUNT_MAX = 6;
export const ROAMING_MONSTER_SPEED_MIN = 0.18;
export const ROAMING_MONSTER_SPEED_MAX = 0.24;
export const ROAMING_MONSTER_AGGRO_RADIUS = 22;
export const ROAMING_MONSTER_TOUCH_RADIUS = 2.2;
export const ROAMING_MONSTER_SHIELD_MARGIN = 1.5;
export const SHELTER_DISCOVERY_SCORE = 150;

export function roamingMonsterNameVi(kind: RoamingMonsterKind): string {
  switch (kind) {
    case 'sea_beast':
      return 'Quái Thú Biển Sâu';
    case 'forest_golem':
      return 'Người Đá Rừng Xanh';
    case 'candy_troll':
      return 'Khổng Lồ Kẹo Ngọt';
  }
}

export const DEFAULT_ROAMING_MONSTERS: readonly RoamingMonster[] = [
  {
    id: 1,
    kind: 'sea_beast',
    x: -90,
    z: 90,
    heading: 0.8,
    speed: 0.2,
    hp: 2,
    frozenTicks: 0,
  },
  {
    id: 2,
    kind: 'candy_troll',
    x: 90,
    z: -90,
    heading: -1.4,
    speed: 0.22,
    hp: 2,
    frozenTicks: 0,
  },
  {
    id: 3,
    kind: 'forest_golem',
    x: -90,
    z: -90,
    heading: 2.2,
    speed: 0.19,
    hp: 3,
    frozenTicks: 0,
  },
  {
    id: 4,
    kind: 'sea_beast',
    x: 100,
    z: 100,
    heading: -2.3,
    speed: 0.21,
    hp: 2,
    frozenTicks: 0,
  },
  {
    id: 5,
    kind: 'forest_golem',
    x: 10,
    z: 200,
    heading: 1.1,
    speed: 0.18,
    hp: 3,
    frozenTicks: 0,
  },
];

/** Create the initial roaming monsters spread across the arena. */
export function createInitialRoamingMonsters(
  count: number = ROAMING_MONSTER_COUNT_TARGET,
  worldRadius: number = 280,
): RoamingMonster[] {
  const scale = worldRadius / 280;
  return DEFAULT_ROAMING_MONSTERS.slice(0, count).map((m) => ({
    ...m,
    x: Math.round(m.x * scale),
    z: Math.round(m.z * scale),
  }));
}

/**
 * Move a roaming monster by one simulation tick.
 * - Wanders peacefully at slow speed (0.18..0.24 units/tick)
 * - If player is within 22 units outside shelter, gently steers towards player
 * - Completely blocked by shelter forcefields and clamps outside
 */
export function moveRoamingMonster(params: {
  readonly monster: RoamingMonster;
  readonly playerHead: Vec2;
  readonly playerInShelter: boolean;
  readonly shelters: readonly ShelterHouse[];
  readonly worldRadius: number;
  readonly elapsedTicks: number;
}): RoamingMonster {
  const { monster, playerHead, playerInShelter, shelters, worldRadius, elapsedTicks } = params;

  if (monster.frozenTicks > 0) {
    return {
      ...monster,
      frozenTicks: monster.frozenTicks - 1,
    };
  }

  const toPlayerX = playerHead.x - monster.x;
  const toPlayerZ = playerHead.z - monster.z;
  const distToPlayer = Math.hypot(toPlayerX, toPlayerZ);

  let nextHeading = monster.heading;

  // Aggro chase when within 22 units AND player is outside shelter
  if (distToPlayer <= ROAMING_MONSTER_AGGRO_RADIUS && !playerInShelter && distToPlayer > 0.01) {
    const targetAngle = Math.atan2(toPlayerZ, toPlayerX);
    const turnRate = 0.09;
    const diff = clamp(angleDiff(monster.heading, targetAngle), -turnRate, turnRate);
    nextHeading = normalizeAngle(monster.heading + diff);
  } else {
    // Peaceful wander: steer away from world edge or drift gently
    const bound = Math.max(10, worldRadius - 20);
    if (Math.abs(monster.x) > bound || Math.abs(monster.z) > bound) {
      nextHeading = normalizeAngle(Math.atan2(-monster.z, -monster.x));
    } else {
      const drift = Math.sin(monster.id * 19.3 + elapsedTicks * 0.04) * 0.035;
      nextHeading = normalizeAngle(monster.heading + drift);
    }
  }

  let nextX = monster.x + Math.cos(nextHeading) * monster.speed;
  let nextZ = monster.z + Math.sin(nextHeading) * monster.speed;

  // Clamp within world arena bounds
  const arenaBound = Math.max(2, worldRadius - 2);
  nextX = clamp(nextX, -arenaBound, arenaBound);
  nextZ = clamp(nextZ, -arenaBound, arenaBound);

  // Shelter forcefield barrier: roaming monsters can NEVER enter any shelter
  for (const shelter of shelters) {
    const toCx = nextX - shelter.x;
    const toCz = nextZ - shelter.z;
    const distToCenter = Math.hypot(toCx, toCz);
    const shieldPerimeter = shelter.radius + ROAMING_MONSTER_SHIELD_MARGIN;
    if (distToCenter <= shieldPerimeter) {
      const angle = distToCenter > 0.001 ? Math.atan2(toCz, toCx) : nextHeading;
      nextX = shelter.x + Math.cos(angle) * shieldPerimeter;
      nextZ = shelter.z + Math.sin(angle) * shieldPerimeter;
      nextHeading = normalizeAngle(angle + Math.PI * 0.5);
    }
  }

  return {
    ...monster,
    x: nextX,
    z: nextZ,
    heading: nextHeading,
  };
}

/**
 * Step the roaming monsters across the world arena:
 * - Maintains 4–6 roaming creatures
 * - Steps movement & respects shelter forcefield barriers
 * - Interacts with fairy magic, attacks, and player touches
 */
export function stepRoamingMonsters(state: GameState): GameState {
  if (state.phase !== 'playing') {
    return state;
  }

  const worldRadius = state.config.worldRadius ?? 280;
  const playerHead = state.snake[0] ?? { x: 0, z: 0 };
  const playerInShelter =
    state.inShelter || findCurrentShelter(playerHead, state.shelters) !== null;

  const roaming = [...(state.roamingMonsters ?? createInitialRoamingMonsters(5, worldRadius))];
  let rng = state.rng;

  // 1. Maintain 4-6 roaming monsters in the arena
  if (roaming.length < ROAMING_MONSTER_COUNT_MIN) {
    let nextId = roaming.reduce((max, m) => Math.max(max, m.id), 0) + 1;
    while (roaming.length < ROAMING_MONSTER_COUNT_TARGET) {
      const f1 = nextFloat(rng);
      const f2 = nextFloat(f1.next);
      const f3 = nextFloat(f2.next);
      const f4 = nextFloat(f3.next);
      rng = f4.next;

      const kinds: readonly RoamingMonsterKind[] = ['sea_beast', 'forest_golem', 'candy_troll'];
      const kind = kinds[Math.floor(f1.value * kinds.length)] ?? 'sea_beast';

      let spawnX = (f2.value * 2 - 1) * (worldRadius - 40);
      let spawnZ = (f3.value * 2 - 1) * (worldRadius - 40);

      if (Math.hypot(spawnX - playerHead.x, spawnZ - playerHead.z) < 35) {
        spawnX += spawnX >= 0 ? 40 : -40;
        spawnZ += spawnZ >= 0 ? 40 : -40;
      }

      for (const s of state.shelters) {
        if (isInsideShelter({ x: spawnX, z: spawnZ }, s, 4)) {
          const angle = Math.atan2(spawnZ - s.z, spawnX - s.x);
          spawnX = s.x + Math.cos(angle) * (s.radius + 6);
          spawnZ = s.z + Math.sin(angle) * (s.radius + 6);
        }
      }

      const speed = Number(
        (
          ROAMING_MONSTER_SPEED_MIN +
          f4.value * (ROAMING_MONSTER_SPEED_MAX - ROAMING_MONSTER_SPEED_MIN)
        ).toFixed(3),
      );

      roaming.push({
        id: nextId++,
        kind,
        x: spawnX,
        z: spawnZ,
        heading: f1.value * Math.PI * 2 - Math.PI,
        speed,
        hp: kind === 'forest_golem' ? 3 : 2,
        frozenTicks: 0,
      });
    }
  }

  // 2. Advance movement & barrier clamping for each monster
  const movedMonsters = roaming.map((m) =>
    moveRoamingMonster({
      monster: m,
      playerHead,
      playerInShelter,
      shelters: state.shelters,
      worldRadius,
      elapsedTicks: state.elapsedTicks,
    }),
  );

  // 3. Process combat, magic skills, sprays, player dash, and player damage
  const isAirborne =
    state.butterflyStage === 'butterfly' ||
    state.butterflyStage === 'cocoon' ||
    (state.princessStage ?? 'snake') !== 'snake';
  const isDashing = state.isDashing;
  const hasSpray = state.sprayActiveTicks > 0;
  const hasShield = state.shieldTicks > 0;

  let currentHearts = state.hearts;
  let invulnTicks = state.invulnerableTicks;
  let scoreGain = 0;
  let enemiesDefeatedGain = 0;
  let orbs = [...state.orbs];
  const newEventDrafts: EventDraft[] = [];
  const survivingMonsters: RoamingMonster[] = [];
  let isGameOver = false;

  for (let m of movedMonsters) {
    let hp = m.hp;
    let frozenTicks = m.frozenTicks;

    // A. Check AoE blasts
    for (const blast of state.aoeBlasts) {
      if (Math.hypot(m.x - blast.x, m.z - blast.z) <= blast.radius) {
        hp -= blast.element === 'fire' ? 3 : 2;
      }
    }

    // B. Check Frost zones
    for (const fz of state.frostZones) {
      if (Math.hypot(m.x - fz.x, m.z - fz.z) <= fz.radius) {
        frozenTicks = Math.max(frozenTicks, 45);
      }
    }

    // C. Check Projectiles
    for (const p of state.projectiles) {
      if (Math.hypot(m.x - p.x, m.z - p.z) <= 2.0) {
        hp -= p.form === 'dragon' ? 2 : 1;
      }
    }

    // D. Player physical collision check
    const touchDist = Math.hypot(playerHead.x - m.x, playerHead.z - m.z);
    if (touchDist <= ROAMING_MONSTER_TOUCH_RADIUS) {
      if (playerInShelter) {
        // Player safely inside shelter sanctuary — completely protected!
      } else if (isDashing || hasSpray) {
        // Player attacks with dashing speed or magical breath spray — monster defeated!
        hp = 0;
        newEventDrafts.push({
          kind: 'hazard_destroyed',
          cell: { x: m.x, z: m.z },
          points: 50,
          messageVi: `💥 Đã đánh bại ${roamingMonsterNameVi(m.kind)}! +50đ ✨`,
        });
      } else if (hasShield) {
        // Shield absorbs blow and repels monster
        newEventDrafts.push({
          kind: 'shield_block',
          cell: { x: m.x, z: m.z },
          messageVi: `🛡️ Khiên Phép Thuật bảo vệ trước ${roamingMonsterNameVi(m.kind)}!`,
        });
        const repAngle = Math.atan2(m.z - playerHead.z, m.x - playerHead.x);
        m = {
          ...m,
          x: m.x + Math.cos(repAngle) * 3.5,
          z: m.z + Math.sin(repAngle) * 3.5,
        };
      } else if (isAirborne) {
        // Airborne butterfly form flies safely above ground monsters
      } else if (invulnTicks > 0) {
        // Currently invulnerable from recent hit
      } else {
        // Takes 1 heart damage with brief invulnerability window
        currentHearts = Math.max(0, currentHearts - 1);
        invulnTicks = 30; // 1.5 seconds invulnerability at 20Hz
        newEventDrafts.push({
          kind: 'heart_lost',
          cell: playerHead,
          messageVi: `💔 Bị ${roamingMonsterNameVi(m.kind)} va trúng! Mất 1 trái tim!`,
        });
        if (currentHearts <= 0) {
          isGameOver = true;
          newEventDrafts.push({
            kind: 'gameover',
            cell: playerHead,
            messageVi: 'Hết tim! Hãy cẩn thận né tránh quái thú lang thang nhé! 💔',
          });
        }
      }
    }

    if (hp <= 0) {
      // Monster defeated: scatter bonus orbs
      enemiesDefeatedGain += 1;
      scoreGain += 50;
      const scattered = scatterLootOrbs({
        orbs,
        spine: [{ x: m.x, z: m.z }],
        count: 2,
        value: 2,
        config: state.config,
        rng,
      });
      orbs = scattered.orbs;
      rng = scattered.rng;
    } else {
      survivingMonsters.push({
        ...m,
        hp,
        frozenTicks,
      });
    }
  }

  const ev = appendEvents(state.events, state.eventSeq, newEventDrafts);
  const nextScore = state.score + scoreGain;

  return {
    ...state,
    roamingMonsters: survivingMonsters,
    hearts: currentHearts,
    invulnerableTicks: invulnTicks,
    score: nextScore,
    best: Math.max(state.best, nextScore),
    enemiesDefeated: state.enemiesDefeated + enemiesDefeatedGain,
    orbs,
    rng,
    phase: isGameOver ? 'gameover' : state.phase,
    events: ev.events,
    eventSeq: ev.eventSeq,
  };
}
