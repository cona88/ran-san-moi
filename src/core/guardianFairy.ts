/**
 * Guardian Fairy Visitor System — pure deterministic module.
 *
 * Friendly Guardian Fairies periodically descend from the sky while the player
 * explores the kingdom, escorting and protecting her with a fairy barrier,
 * repelling dangerous enemies, and gifting blossoms, starlight orbs, frost
 * wards, or rainbow speed boosts.
 */

import type {
  BotSnake,
  GameEventKind,
  GameState,
  GardenFlower,
  GuardianFairyKind,
  GuardianFairyState,
  RoamingMonster,
  Vec2,
} from './types';
import { nextFloat, nextInt } from './rng';
import { clamp, normalizeAngle } from './systems/arena';
import { scatterLootOrbs } from './systems/food';
import { appendEvents, applyXpAndScore, type EventDraft } from './quests';
import { computeLeaderboard, repelBotFrom } from './bots';
import { FLOWER_LIFETIME_TICKS, MAX_GARDEN_FLOWERS } from './fairyMagic';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FAIRY_FIRST_VISIT_TICKS = 220;
export const FAIRY_VISIT_INTERVAL_MIN_TICKS = 420;
export const FAIRY_VISIT_INTERVAL_MAX_TICKS = 620;
export const FAIRY_MIN_MOVE_DISTANCE = 40;
export const FAIRY_ARRIVE_TICKS = 24;
export const FAIRY_ESCORT_TICKS = 180;
export const FAIRY_DEPART_TICKS = 24;
export const FAIRY_PULSE_INTERVAL_TICKS = 36;
export const FAIRY_PROTECT_RADIUS = 11.5;

export interface GuardianFairyMeta {
  readonly kind: GuardianFairyKind;
  readonly emoji: string;
  readonly nameVi: string;
  readonly blessingVi: string;
  readonly colorHex: number;
  readonly accentHex: number;
}

export const GUARDIAN_FAIRY_KINDS: readonly GuardianFairyKind[] = [
  'blossom',
  'starlight',
  'crystal',
  'rainbow',
];

export const GUARDIAN_FAIRY_METADATA: Readonly<Record<GuardianFairyKind, GuardianFairyMeta>> = {
  blossom: {
    kind: 'blossom',
    emoji: '🌸',
    nameVi: 'Tiên Hoa Hồng',
    blessingVi: 'Khiên Cánh Hoa & Hồi Tim',
    colorHex: 0xff79c6,
    accentHex: 0xffe066,
  },
  starlight: {
    kind: 'starlight',
    emoji: '⭐',
    nameVi: 'Tiên Ánh Sao',
    blessingVi: 'Mưa Sao Vàng & Đầy Cánh Bướm',
    colorHex: 0xc792ff,
    accentHex: 0x7ef8ff,
  },
  crystal: {
    kind: 'crystal',
    emoji: '💎',
    nameVi: 'Tiên Pha Lê Băng',
    blessingVi: 'Kết Giới Đóng Băng Quái Thú',
    colorHex: 0x5ef6ff,
    accentHex: 0xe8feff,
  },
  rainbow: {
    kind: 'rainbow',
    emoji: '🌈',
    nameVi: 'Tiên Cầu Vồng',
    blessingVi: 'Phép Màu Cầu Vồng & Tốc Độ',
    colorHex: 0xffd447,
    accentHex: 0xff80cc,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampToWorld(x: number, z: number, worldRadius: number): Vec2 {
  const bound = Math.max(2, worldRadius - 1.5);
  return {
    x: clamp(x, -bound, bound),
    z: clamp(z, -bound, bound),
  };
}

function nextFlowerId(flowers: readonly GardenFlower[]): number {
  let maxId = 0;
  for (const f of flowers) {
    if (f.id > maxId) maxId = f.id;
  }
  return maxId + 1;
}

function appendFlowersCapped(
  existing: readonly GardenFlower[],
  added: readonly GardenFlower[],
): readonly GardenFlower[] {
  const merged = [...existing, ...added];
  return merged.length > MAX_GARDEN_FLOWERS
    ? merged.slice(merged.length - MAX_GARDEN_FLOWERS)
    : merged;
}

function escortTargetPos(
  head: Vec2,
  heading: number,
  elapsedTicks: number,
  worldRadius: number,
): Vec2 {
  const fx = Math.cos(heading);
  const fz = Math.sin(heading);
  const px = -fz;
  const pz = fx;
  const t = elapsedTicks * 0.14;
  const fwdOffset = 1.1 + Math.sin(t * 2) * 0.55;
  const sideOffset = Math.cos(t) * 2.7;
  return clampToWorld(
    head.x + fx * fwdOffset + px * sideOffset,
    head.z + fz * fwdOffset + pz * sideOffset,
    worldRadius,
  );
}

function arriveTargetPos(head: Vec2, heading: number, worldRadius: number): Vec2 {
  const fx = Math.cos(heading);
  const fz = Math.sin(heading);
  const px = -fz;
  const pz = fx;
  return clampToWorld(head.x + fx * 1.2 + px * 2.8, head.z + fz * 1.2 + pz * 2.8, worldRadius);
}

// ---------------------------------------------------------------------------
// Initialization & Manual/Automatic Spawn
// ---------------------------------------------------------------------------

/** Create the initial idle state for the periodic Guardian Fairy visitor. */
export function createInitialGuardianFairy(): GuardianFairyState {
  const meta = GUARDIAN_FAIRY_METADATA.blossom;
  return {
    phase: 'idle',
    kind: meta.kind,
    nameVi: meta.nameVi,
    emoji: meta.emoji,
    blessingVi: meta.blessingVi,
    colorHex: meta.colorHex,
    accentHex: meta.accentHex,
    pos: { x: 0, z: 0 },
    altitude: 2.5,
    heading: 0,
    ticksRemaining: 0,
    maxTicks: FAIRY_ARRIVE_TICKS,
    ticksUntilNextVisit: FAIRY_FIRST_VISIT_TICKS,
    distanceTraveled: 0,
    visitCount: 0,
    blessingPulseTick: 0,
  };
}

/**
 * Spawn a Guardian Fairy visitor right now in the `'arriving'` phase
 * beside the player's snake head and grant her initial welcome blessing.
 */
export function spawnGuardianFairyNow(
  state: GameState,
  kindOverride?: GuardianFairyKind,
): GameState {
  if (state.phase !== 'playing') return state;
  const head = state.snake[0];
  if (!head) return state;

  const worldRadius = state.config.worldRadius;
  let rng = state.rng;
  let chosenKind: GuardianFairyKind;

  if (kindOverride !== undefined) {
    chosenKind = kindOverride;
  } else {
    const prevKind = state.guardianFairy?.kind;
    const candidates = GUARDIAN_FAIRY_KINDS.filter((k) => k !== prevKind);
    const pick = nextInt(rng, candidates.length);
    rng = pick.next;
    chosenKind = candidates[pick.value] ?? 'blossom';
  }

  const meta = GUARDIAN_FAIRY_METADATA[chosenKind];
  const spawnAngle = state.heading + 0.55;
  const spawnPos = clampToWorld(
    head.x + Math.cos(spawnAngle) * 7.5,
    head.z + Math.sin(spawnAngle) * 7.5,
    worldRadius,
  );
  const faceHeading = normalizeAngle(Math.atan2(head.z - spawnPos.z, head.x - spawnPos.x));

  const nextVisitCount = (state.guardianFairy?.visitCount ?? 0) + 1;
  const nextFairy: GuardianFairyState = {
    phase: 'arriving',
    kind: meta.kind,
    nameVi: meta.nameVi,
    emoji: meta.emoji,
    blessingVi: meta.blessingVi,
    colorHex: meta.colorHex,
    accentHex: meta.accentHex,
    pos: spawnPos,
    altitude: 2.2,
    heading: faceHeading,
    ticksRemaining: FAIRY_ARRIVE_TICKS,
    maxTicks: FAIRY_ARRIVE_TICKS,
    ticksUntilNextVisit: 0,
    distanceTraveled: 0,
    visitCount: nextVisitCount,
    blessingPulseTick: 0,
  };

  let hearts = state.hearts;
  let score = state.score;
  let best = state.best;
  let level = state.level;
  let xp = state.xp;
  let butterflyCharge = state.butterflyCharge;
  let dashEnergy = state.dashEnergy;
  let invulnerableTicks = state.invulnerableTicks;
  const shieldTicks = Math.max(state.shieldTicks, 90);
  let boosters = state.boosters;
  let orbs = state.orbs;
  let bots = state.bots;
  let gardenFlowers = state.gardenFlowers;
  let roamingMonsters = state.roamingMonsters;
  let events = state.events;
  let eventSeq = state.eventSeq;

  const drafts: EventDraft[] = [
    {
      kind: 'fairy_visit_start',
      cell: spawnPos,
      messageVi: `${meta.emoji} ${meta.nameVi} ghé thăm bảo vệ bé! ✨`,
    },
  ];

  // Apply kind-specific welcome gift
  if (chosenKind === 'blossom') {
    if (hearts < state.maxHearts) {
      hearts = Math.min(state.maxHearts, hearts + 1);
      drafts.push({
        kind: 'heart_gained',
        cell: head,
        messageVi: '🌸 Tiên Hoa Hồng tặng bé +1 Tim phép thuật! 💖',
      });
    } else {
      score += 120;
      best = Math.max(best, score);
    }
    let flowerId = nextFlowerId(gardenFlowers);
    const bloomed: GardenFlower[] = [];
    for (let i = 0; i < 3; i++) {
      const a = state.heading + (i / 3) * Math.PI * 2;
      const fp = clampToWorld(head.x + Math.cos(a) * 2.4, head.z + Math.sin(a) * 2.4, worldRadius);
      const cv = nextInt(rng, 4);
      rng = cv.next;
      bloomed.push({
        id: flowerId++,
        x: fp.x,
        z: fp.z,
        colorVariant: cv.value as 0 | 1 | 2 | 3,
        scale: 1.05,
        ticksRemaining: FLOWER_LIFETIME_TICKS,
        maxTicks: FLOWER_LIFETIME_TICKS,
      });
    }
    gardenFlowers = appendFlowersCapped(gardenFlowers, bloomed);
  } else if (chosenKind === 'starlight') {
    butterflyCharge = 100;
    boosters = {
      ...boosters,
      magnet: {
        ...boosters.magnet,
        activeTicks: Math.max(boosters.magnet.activeTicks, 120),
      },
    };
    const scattered = scatterLootOrbs({
      orbs,
      spine: [head, spawnPos],
      count: 6,
      value: 2,
      config: state.config,
      rng,
    });
    orbs = scattered.orbs;
    rng = scattered.rng;
  } else if (chosenKind === 'crystal') {
    bots = bots.map((b) =>
      Math.hypot(b.head.x - head.x, b.head.z - head.z) <= 18
        ? { ...b, frozenTicks: Math.max(b.frozenTicks, 80) }
        : b,
    );
    roamingMonsters = roamingMonsters.map((m) =>
      Math.hypot(m.x - head.x, m.z - head.z) <= 18
        ? { ...m, frozenTicks: Math.max(m.frozenTicks, 80) }
        : m,
    );
    const evStart = appendEvents(events, eventSeq, drafts);
    const xpRes = applyXpAndScore({
      score,
      best,
      level,
      xp,
      gainXp: 5,
      points: 80,
      events: evStart.events,
      eventSeq: evStart.eventSeq,
      cell: head,
    });
    events = xpRes.events;
    eventSeq = xpRes.eventSeq;
    score = xpRes.score;
    best = xpRes.best;
    level = xpRes.level;
    xp = xpRes.xp;
    drafts.length = 0;
  } else {
    // rainbow
    dashEnergy = 100;
    invulnerableTicks = Math.max(invulnerableTicks, 70);
    bots = bots.map((b) =>
      b.level > level && Math.hypot(b.head.x - head.x, b.head.z - head.z) <= 12
        ? repelBotFrom(b, head, 14, worldRadius, 2)
        : b,
    );
    const evStart = appendEvents(events, eventSeq, drafts);
    const xpRes = applyXpAndScore({
      score,
      best,
      level,
      xp,
      gainXp: 6,
      points: 120,
      events: evStart.events,
      eventSeq: evStart.eventSeq,
      cell: head,
    });
    events = xpRes.events;
    eventSeq = xpRes.eventSeq;
    score = xpRes.score;
    best = xpRes.best;
    level = xpRes.level;
    xp = xpRes.xp;
    drafts.length = 0;
  }

  if (drafts.length > 0) {
    const ev = appendEvents(events, eventSeq, drafts);
    events = ev.events;
    eventSeq = ev.eventSeq;
  }

  const board =
    level !== state.level
      ? computeLeaderboard({
          playerName: state.playerName,
          playerLevel: level,
          bots,
          activeBossId: state.activeBossId,
        })
      : null;

  return {
    ...state,
    hearts,
    score,
    best,
    level,
    xp,
    butterflyCharge,
    dashEnergy,
    invulnerableTicks,
    shieldTicks,
    boosters,
    orbs,
    bots,
    gardenFlowers,
    roamingMonsters,
    guardianFairy: nextFairy,
    rng,
    events,
    eventSeq,
    leaderboard: board ? board.leaderboard : state.leaderboard,
    playerRank: board ? board.playerRank : state.playerRank,
    crownTarget: board ? board.crownTarget : state.crownTarget,
  };
}

// ---------------------------------------------------------------------------
// Per-Tick Simulation
// ---------------------------------------------------------------------------

function applyEscortProtection(
  head: Vec2,
  playerLevel: number,
  bots: readonly BotSnake[],
  roamingMonsters: readonly RoamingMonster[],
  worldRadius: number,
): { bots: readonly BotSnake[]; roamingMonsters: readonly RoamingMonster[] } {
  const pushTargetDist = FAIRY_PROTECT_RADIUS + 2.5;
  const bound = Math.max(2, worldRadius - 1.5);

  const nextBots = bots.map((b) => {
    if (b.level <= playerLevel) return b;
    const dist = Math.hypot(b.head.x - head.x, b.head.z - head.z);
    if (dist <= FAIRY_PROTECT_RADIUS) {
      return repelBotFrom(b, head, pushTargetDist, worldRadius, 1);
    }
    return b;
  });

  const nextMonsters = roamingMonsters.map((m) => {
    const dx = m.x - head.x;
    const dz = m.z - head.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= FAIRY_PROTECT_RADIUS) {
      const nx = dist > 1e-4 ? dx / dist : 1;
      const nz = dist > 1e-4 ? dz / dist : 0;
      return {
        ...m,
        x: clamp(head.x + nx * pushTargetDist, -bound, bound),
        z: clamp(head.z + nz * pushTargetDist, -bound, bound),
        frozenTicks: Math.max(m.frozenTicks, 45),
      };
    }
    return m;
  });

  return { bots: nextBots, roamingMonsters: nextMonsters };
}

function applyBlessingPulse(state: GameState, fairyPos: Vec2, kind: GuardianFairyKind): GameState {
  const head = state.snake[0];
  if (!head) return state;

  let rng = state.rng;
  let orbs = state.orbs;
  let gardenFlowers = state.gardenFlowers;
  let bots = state.bots;
  let roamingMonsters = state.roamingMonsters;
  let butterflyCharge = state.butterflyCharge;
  let dashEnergy = state.dashEnergy;
  let score = state.score;
  let best = state.best;
  let level = state.level;
  let xp = state.xp;
  let events = state.events;
  let eventSeq = state.eventSeq;

  const scattered = scatterLootOrbs({
    orbs,
    spine: [fairyPos],
    count: kind === 'starlight' ? 3 : 2,
    value: 2,
    config: state.config,
    rng,
  });
  orbs = scattered.orbs;
  rng = scattered.rng;

  const meta = GUARDIAN_FAIRY_METADATA[kind];
  const pulseEventKind: GameEventKind = 'fairy_blessing';
  const ev = appendEvents(events, eventSeq, [
    {
      kind: pulseEventKind,
      cell: fairyPos,
      messageVi: `${meta.emoji} Phép màu ${meta.nameVi}! ✨`,
    },
  ]);
  events = ev.events;
  eventSeq = ev.eventSeq;

  if (kind === 'blossom') {
    const cv = nextInt(rng, 4);
    rng = cv.next;
    const flower: GardenFlower = {
      id: nextFlowerId(gardenFlowers),
      x: fairyPos.x,
      z: fairyPos.z,
      colorVariant: cv.value as 0 | 1 | 2 | 3,
      scale: 0.98,
      ticksRemaining: FLOWER_LIFETIME_TICKS,
      maxTicks: FLOWER_LIFETIME_TICKS,
    };
    gardenFlowers = appendFlowersCapped(gardenFlowers, [flower]);
  } else if (kind === 'starlight') {
    butterflyCharge = Math.min(100, butterflyCharge + 25);
    const xpRes = applyXpAndScore({
      score,
      best,
      level,
      xp,
      gainXp: 3,
      points: 40,
      events,
      eventSeq,
      cell: fairyPos,
    });
    score = xpRes.score;
    best = xpRes.best;
    level = xpRes.level;
    xp = xpRes.xp;
    events = xpRes.events;
    eventSeq = xpRes.eventSeq;
  } else if (kind === 'crystal') {
    const chillRadius = 15;
    bots = bots.map((b) =>
      Math.hypot(b.head.x - head.x, b.head.z - head.z) <= chillRadius
        ? { ...b, frozenTicks: Math.max(b.frozenTicks, 50) }
        : b,
    );
    roamingMonsters = roamingMonsters.map((m) =>
      Math.hypot(m.x - head.x, m.z - head.z) <= chillRadius
        ? { ...m, frozenTicks: Math.max(m.frozenTicks, 50) }
        : m,
    );
  } else {
    // rainbow
    dashEnergy = 100;
    const xpRes = applyXpAndScore({
      score,
      best,
      level,
      xp,
      gainXp: 3,
      points: 40,
      events,
      eventSeq,
      cell: fairyPos,
    });
    score = xpRes.score;
    best = xpRes.best;
    level = xpRes.level;
    xp = xpRes.xp;
    events = xpRes.events;
    eventSeq = xpRes.eventSeq;
  }

  // Randomize small twinkle float to keep rng advancing smoothly
  const twinkle = nextFloat(rng);
  rng = twinkle.next;

  const board =
    level !== state.level
      ? computeLeaderboard({
          playerName: state.playerName,
          playerLevel: level,
          bots,
          activeBossId: state.activeBossId,
        })
      : null;

  return {
    ...state,
    orbs,
    gardenFlowers,
    bots,
    roamingMonsters,
    butterflyCharge,
    dashEnergy,
    score,
    best,
    level,
    xp,
    rng,
    events,
    eventSeq,
    leaderboard: board ? board.leaderboard : state.leaderboard,
    playerRank: board ? board.playerRank : state.playerRank,
    crownTarget: board ? board.crownTarget : state.crownTarget,
  };
}

/**
 * Step the Guardian Fairy state machine for one simulation tick.
 * Only advances while `state.phase === 'playing'`.
 */
export function stepGuardianFairy(state: GameState, movedDist: number): GameState {
  if (state.phase !== 'playing') return state;
  const head = state.snake[0];
  if (!head) return state;

  const fairy = state.guardianFairy ?? createInitialGuardianFairy();
  const worldRadius = state.config.worldRadius;

  if (fairy.phase === 'idle') {
    const distanceTraveled = fairy.distanceTraveled + Math.max(0, movedDist);
    const hurry =
      state.elapsedTicks >= 120 && (state.hearts === 1 || state.monsterEvent.phase === 'warning');
    const step = hurry ? 2 : 1;
    const nextTicks = Math.max(0, fairy.ticksUntilNextVisit - step);

    if (nextTicks <= 0 && distanceTraveled >= FAIRY_MIN_MOVE_DISTANCE) {
      return spawnGuardianFairyNow({
        ...state,
        guardianFairy: {
          ...fairy,
          ticksUntilNextVisit: 0,
          distanceTraveled,
        },
      });
    }

    return {
      ...state,
      guardianFairy: {
        ...fairy,
        ticksUntilNextVisit: nextTicks,
        distanceTraveled,
      },
    };
  }

  if (fairy.phase === 'arriving') {
    const target = arriveTargetPos(head, state.heading, worldRadius);
    const nextX = fairy.pos.x + (target.x - fairy.pos.x) * 0.25;
    const nextZ = fairy.pos.z + (target.z - fairy.pos.z) * 0.25;
    const clampedPos = clampToWorld(nextX, nextZ, worldRadius);
    const rem = fairy.ticksRemaining - 1;
    const nextHeading =
      Math.hypot(target.x - fairy.pos.x, target.z - fairy.pos.z) > 0.02
        ? normalizeAngle(Math.atan2(target.z - fairy.pos.z, target.x - fairy.pos.x))
        : state.heading;

    if (rem <= 0) {
      return {
        ...state,
        shieldTicks: Math.max(state.shieldTicks, 20),
        guardianFairy: {
          ...fairy,
          phase: 'escorting',
          pos: clampedPos,
          altitude: 1.0,
          heading: nextHeading,
          ticksRemaining: FAIRY_ESCORT_TICKS,
          maxTicks: FAIRY_ESCORT_TICKS,
          blessingPulseTick: 0,
        },
      };
    }

    return {
      ...state,
      shieldTicks: Math.max(state.shieldTicks, 20),
      guardianFairy: {
        ...fairy,
        pos: clampedPos,
        altitude: Number((1.0 + (rem / FAIRY_ARRIVE_TICKS) * 1.2).toFixed(3)),
        heading: nextHeading,
        ticksRemaining: rem,
      },
    };
  }

  if (fairy.phase === 'escorting') {
    const target = escortTargetPos(head, state.heading, state.elapsedTicks, worldRadius);
    const dx = target.x - fairy.pos.x;
    const dz = target.z - fairy.pos.z;
    const dist = Math.hypot(dx, dz);
    const blend = dist > 8 ? 0.45 : 0.32;
    const nextPos = clampToWorld(fairy.pos.x + dx * blend, fairy.pos.z + dz * blend, worldRadius);
    const nextHeading = dist > 0.02 ? normalizeAngle(Math.atan2(dz, dx)) : state.heading;

    const protectedEntities = applyEscortProtection(
      head,
      state.level,
      state.bots,
      state.roamingMonsters,
      worldRadius,
    );

    let working: GameState = {
      ...state,
      bots: protectedEntities.bots,
      roamingMonsters: protectedEntities.roamingMonsters,
      shieldTicks: Math.max(state.shieldTicks, 20),
    };

    const nextPulse = fairy.blessingPulseTick + 1;
    let pulseTickAfter = nextPulse;
    if (nextPulse >= FAIRY_PULSE_INTERVAL_TICKS) {
      pulseTickAfter = 0;
      working = applyBlessingPulse(working, nextPos, fairy.kind);
    }

    const rem = fairy.ticksRemaining - 1;
    if (rem <= 0) {
      const ev = appendEvents(working.events, working.eventSeq, [
        {
          kind: 'fairy_visit_end',
          cell: nextPos,
          messageVi: '✨ Nàng Tiên vẫy tay tạm biệt — hẹn gặp lại bé nhé! 💖',
        },
      ]);
      return {
        ...working,
        events: ev.events,
        eventSeq: ev.eventSeq,
        guardianFairy: {
          ...fairy,
          phase: 'departing',
          pos: nextPos,
          altitude: 1.0,
          heading: nextHeading,
          ticksRemaining: FAIRY_DEPART_TICKS,
          maxTicks: FAIRY_DEPART_TICKS,
          blessingPulseTick: 0,
        },
      };
    }

    return {
      ...working,
      guardianFairy: {
        ...fairy,
        pos: nextPos,
        altitude: 1.0,
        heading: nextHeading,
        ticksRemaining: rem,
        blessingPulseTick: pulseTickAfter,
      },
    };
  }

  // Phase: 'departing'
  const rem = fairy.ticksRemaining - 1;
  const spiralAngle = state.heading + (FAIRY_DEPART_TICKS - rem) * 0.22;
  const nextPos = clampToWorld(
    fairy.pos.x + Math.cos(spiralAngle) * 0.45,
    fairy.pos.z + Math.sin(spiralAngle) * 0.45,
    worldRadius,
  );
  const progress = 1 - Math.max(0, rem) / FAIRY_DEPART_TICKS;
  const nextAlt = Number((1.0 + progress * 1.8).toFixed(3));

  if (rem <= 0) {
    const span = FAIRY_VISIT_INTERVAL_MAX_TICKS - FAIRY_VISIT_INTERVAL_MIN_TICKS + 1;
    const waitRoll = nextInt(state.rng, span);
    const nextWait = FAIRY_VISIT_INTERVAL_MIN_TICKS + waitRoll.value;

    return {
      ...state,
      rng: waitRoll.next,
      guardianFairy: {
        ...fairy,
        phase: 'idle',
        pos: nextPos,
        altitude: 2.8,
        ticksRemaining: 0,
        maxTicks: FAIRY_ARRIVE_TICKS,
        ticksUntilNextVisit: nextWait,
        distanceTraveled: 0,
        blessingPulseTick: 0,
      },
    };
  }

  return {
    ...state,
    guardianFairy: {
      ...fairy,
      pos: nextPos,
      altitude: nextAlt,
      heading: normalizeAngle(spiralAngle),
      ticksRemaining: rem,
    },
  };
}
