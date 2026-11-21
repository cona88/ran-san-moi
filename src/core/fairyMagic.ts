/**
 * Fairy Magic System — pure deterministic module.
 *
 * Six fairy skills: Flower Garden, High-Altitude Butterfly Flight & Landing,
 * and 4 Elemental 360° AoE Skills (Thunder, Fire, Water, Arcane).
 * All state transitions are pure, deterministic, and side-effect free.
 */

import type {
  AoeBlast,
  AoeElement,
  BotSnake,
  ButterflyStage,
  FairySkillKind,
  FrostZone,
  GameEventKind,
  GameState,
  GardenFlower,
  SkyLightningBolt,
  Vec2,
} from './types';
import { nextFloat, nextInt } from './rng';
import { clamp } from './systems/arena';
import { scatterLootOrbs } from './systems/food';
import { appendEvents, applyXpAndScore, type EventDraft } from './quests';
import { computeLeaderboard, shrinkOrEliminateHelper } from './bots';
import { advanceSpineFollowLeader, matchSpineLength, targetPlayerLength } from './movement';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const COCOON_DURATION_TICKS = 18;
export const BUTTERFLY_DURATION_TICKS = 220;
export const LANDING_DURATION_TICKS = 14;
export const BUTTERFLY_FROST_RADIUS = 7.5;
export const FROST_ZONE_RADIUS = 3.6;
export const FROST_ZONE_DURATION_TICKS = 46;
export const MAX_FROST_ZONES = 24;
export const FLOWER_COOLDOWN_TICKS = 10;
export const FLOWER_LIFETIME_TICKS = 280;
export const MAX_GARDEN_FLOWERS = 28;
export const LIGHTNING_TTL_TICKS = 9;
export const AOE_BLAST_TTL = 16;

export const FIRE_COOLDOWN_TICKS_AGE6 = 40;
export const FIRE_COOLDOWN_TICKS_AGE9 = 55;
export const WATER_COOLDOWN_TICKS_AGE6 = 42;
export const WATER_COOLDOWN_TICKS_AGE9 = 56;
export const ARCANE_COOLDOWN_TICKS_AGE6 = 48;
export const ARCANE_COOLDOWN_TICKS_AGE9 = 62;

const LIGHTNING_COLORS: readonly number[] = [0xffe45e, 0x7ef8ff, 0xff7ae0];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nextEntityId(
  flowers: readonly GardenFlower[],
  bolts: readonly SkyLightningBolt[],
  blasts: readonly AoeBlast[],
  frostZones: readonly FrostZone[] = [],
): number {
  let maxId = 0;
  for (const f of flowers) if (f.id > maxId) maxId = f.id;
  for (const b of bolts) if (b.id > maxId) maxId = b.id;
  for (const a of blasts) if (a.id > maxId) maxId = a.id;
  for (const z of frostZones) if (z.id > maxId) maxId = z.id;
  return maxId + 1;
}

function appendFrostZone(state: GameState, pos: Vec2): FrostZone[] {
  const id = nextEntityId(
    state.gardenFlowers,
    state.lightningBolts,
    state.aoeBlasts,
    state.frostZones,
  );
  const zone: FrostZone = {
    id,
    x: pos.x,
    z: pos.z,
    radius: FROST_ZONE_RADIUS,
    ticksRemaining: FROST_ZONE_DURATION_TICKS,
    maxTicks: FROST_ZONE_DURATION_TICKS,
  };
  const all = [...state.frostZones, zone];
  return all.length > MAX_FROST_ZONES ? all.slice(all.length - MAX_FROST_ZONES) : all;
}

function dist2d(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function clampToArena(x: number, z: number, halfW: number, halfD: number): Vec2 {
  return {
    x: clamp(x, -(halfW - 1.5), halfW - 1.5),
    z: clamp(z, -(halfD - 1.5), halfD - 1.5),
  };
}

// ---------------------------------------------------------------------------
// castFairySkill
// ---------------------------------------------------------------------------

export function castFairySkill(state: GameState, skill: FairySkillKind): GameState {
  if (state.phase !== 'playing') return state;

  switch (skill) {
    case 'flower':
      return castFlower(state);
    case 'butterfly':
      return castButterfly(state);
    case 'thunder':
      return castThunder(state);
    case 'fire':
      return castFire(state);
    case 'water':
      return castWater(state);
    case 'arcane':
      return castArcane(state);
  }
}

// ---------------------------------------------------------------------------
// Flower skill
// ---------------------------------------------------------------------------

function castFlower(state: GameState): GameState {
  if (state.flowerCooldownTicks > 0) return state;

  const head = state.snake[0];
  if (!head) return state;

  const halfW = state.config.worldRadius;
  const halfD = state.config.worldRadius;
  let rng = state.rng;
  let idCounter = nextEntityId(state.gardenFlowers, state.lightningBolts, state.aoeBlasts);

  // Anchor point: tail if available, else head
  const tail = state.snake[state.snake.length - 1] ?? head;
  const anchor = tail;

  const newFlowers: GardenFlower[] = [];

  // Main blossom at anchor
  const cv0 = nextInt(rng, 4);
  rng = cv0.next;
  const clamped0 = clampToArena(anchor.x, anchor.z, halfW, halfD);
  newFlowers.push({
    id: idCounter++,
    x: clamped0.x,
    z: clamped0.z,
    colorVariant: cv0.value as 0 | 1 | 2 | 3,
    scale: 1.15,
    ticksRemaining: FLOWER_LIFETIME_TICKS,
    maxTicks: FLOWER_LIFETIME_TICKS,
  });

  // 2 offset buds within ±1.35 units
  for (let i = 0; i < 2; i++) {
    const ox = nextFloat(rng);
    const oz = nextFloat(ox.next);
    const cv = nextInt(oz.next, 4);
    rng = cv.next;

    const bx = anchor.x + (ox.value - 0.5) * 2.7; // ±1.35
    const bz = anchor.z + (oz.value - 0.5) * 2.7;
    const clamped = clampToArena(bx, bz, halfW, halfD);

    newFlowers.push({
      id: idCounter++,
      x: clamped.x,
      z: clamped.z,
      colorVariant: cv.value as 0 | 1 | 2 | 3,
      scale: 0.84,
      ticksRemaining: FLOWER_LIFETIME_TICKS,
      maxTicks: FLOWER_LIFETIME_TICKS,
    });
  }

  // Merge and cap at MAX_GARDEN_FLOWERS (keep newest)
  let allFlowers = [...state.gardenFlowers, ...newFlowers];
  if (allFlowers.length > MAX_GARDEN_FLOWERS) {
    allFlowers = allFlowers.slice(allFlowers.length - MAX_GARDEN_FLOWERS);
  }

  const nextCharge = Math.min(100, state.butterflyCharge + 12);
  const nextScore = state.score + 10;
  const nextBest = Math.max(state.best, nextScore);

  const anchorCell: Vec2 = { x: clamped0.x, z: clamped0.z };
  const ev = appendEvents(state.events, state.eventSeq, [
    {
      kind: 'flower_bloom',
      cell: anchorCell,
      points: 3,
      messageVi: '🌸 Thả Hoa Nở!',
    },
  ]);

  return {
    ...state,
    flowerCooldownTicks: FLOWER_COOLDOWN_TICKS,
    gardenFlowers: allFlowers,
    butterflyCharge: nextCharge,
    score: nextScore,
    best: nextBest,
    rng,
    events: ev.events,
    eventSeq: ev.eventSeq,
  };
}

// ---------------------------------------------------------------------------
// Butterfly skill (Takeoff & Early Landing Toggle)
// ---------------------------------------------------------------------------

function castButterfly(state: GameState): GameState {
  if (state.butterflyStage === 'caterpillar' && state.butterflyCharge >= 100) {
    const head = state.snake[0];
    const headCell: Vec2 = head ?? { x: 0, z: 0 };

    const ev = appendEvents(state.events, state.eventSeq, [
      {
        kind: 'cocoon_start',
        cell: headCell,
        messageVi: '🥚 Kén Pha Lê...',
      },
    ]);

    return {
      ...state,
      butterflyStage: 'cocoon',
      butterflyTicks: COCOON_DURATION_TICKS,
      butterflyCharge: 100,
      butterflyAltitude: 0.25,
      butterflyLanding: false,
      butterflyHold: false,
      butterflyLandingFromHold: false,
      events: ev.events,
      eventSeq: ev.eventSeq,
    };
  }

  // Manual Landing toggle while flying
  if (state.butterflyStage === 'butterfly' && !state.butterflyLanding && !state.butterflyHold) {
    return {
      ...state,
      butterflyLanding: true,
      butterflyLandingFromHold: false,
      butterflyTicks: Math.min(state.butterflyTicks, LANDING_DURATION_TICKS),
    };
  }

  return state;
}

/**
 * Press-and-hold Butterfly skill: holding (`active: true`) transforms immediately
 * into high-altitude Frost Butterfly regardless of charge; releasing (`active: false`)
 * smoothly lands back to caterpillar within 4 ticks with charge preserved at 100.
 */
export function setButterflyHold(state: GameState, active: boolean): GameState {
  if (state.phase !== 'playing') return state;

  const head = state.snake[0];
  const headCell: Vec2 = head ?? { x: 0, z: 0 };

  if (active) {
    if (
      state.butterflyHold &&
      state.butterflyStage === 'butterfly' &&
      !state.butterflyLanding &&
      state.butterflyTicks === BUTTERFLY_DURATION_TICKS &&
      state.butterflyCharge === 100
    ) {
      return state;
    }

    const wasButterfly = state.butterflyStage === 'butterfly';
    let events = state.events;
    let eventSeq = state.eventSeq;
    let frostZones = state.frostZones;

    if (!wasButterfly) {
      const ev = appendEvents(events, eventSeq, [
        {
          kind: 'butterfly_emerge',
          cell: headCell,
          messageVi: '🦋 Bướm Hồng Băng Giá!',
        },
      ]);
      events = ev.events;
      eventSeq = ev.eventSeq;
      if (head) {
        frostZones = appendFrostZone(state, head);
      }
    }

    return {
      ...state,
      butterflyHold: true,
      butterflyStage: 'butterfly',
      butterflyLanding: false,
      butterflyLandingFromHold: false,
      butterflyTicks: BUTTERFLY_DURATION_TICKS,
      butterflyAltitude: Math.max(0.78, state.butterflyAltitude),
      butterflyCharge: 100,
      frostZones,
      events,
      eventSeq,
    };
  }

  if (state.butterflyStage === 'butterfly') {
    return {
      ...state,
      butterflyHold: false,
      butterflyLanding: true,
      butterflyLandingFromHold: true,
      butterflyTicks: Math.min(state.butterflyTicks, 4),
      butterflyCharge: 100,
    };
  }

  if (state.butterflyStage === 'cocoon') {
    return {
      ...state,
      butterflyHold: false,
      butterflyStage: 'caterpillar',
      butterflyTicks: 0,
      butterflyAltitude: 0,
      butterflyLanding: false,
      butterflyLandingFromHold: false,
      butterflyCharge: 100,
    };
  }

  if (!state.butterflyHold && !state.butterflyLanding && !state.butterflyLandingFromHold) {
    return state;
  }

  return {
    ...state,
    butterflyHold: false,
    butterflyLanding: false,
    butterflyLandingFromHold: false,
  };
}

// ---------------------------------------------------------------------------
// Shared 360° Elemental AoE Strike Engine
// ---------------------------------------------------------------------------

export interface AoeStrikeOptions {
  readonly element: AoeElement;
  readonly aoeRadius: number;
  readonly killMargin: number;
  readonly levelDamage: number;
  readonly stunTicks: number;
  readonly knockbackDist?: number;
  readonly butterflyChargeGain: number;
  readonly eventKind: GameEventKind;
  readonly messageVi: string;
  readonly spawnBolts?: boolean;
  readonly minBolts?: number;
  readonly maxBolts?: number;
  readonly pullOrbsRadius?: number;
  readonly pullOrbsFactor?: number;
  readonly diamondFlowerRadius?: number;
}

export function executeAoeStrike(state: GameState, opts: AoeStrikeOptions): GameState {
  const head = state.snake[0];
  if (!head) return state;

  const halfW = state.config.worldRadius;
  let rng = state.rng;
  let nextOrbs = [...state.orbs];
  let idCounter = nextEntityId(state.gardenFlowers, state.lightningBolts, state.aoeBlasts);

  const survivingBots: BotSnake[] = [];
  const eliminatedBots: BotSnake[] = [];
  const struckPositions: Vec2[] = [];
  let survivedStruckCount = 0;

  for (const bot of state.bots) {
    if (dist2d(head, bot.head) > opts.aoeRadius) {
      survivingBots.push(bot);
      continue;
    }

    struckPositions.push(bot.head);
    const res = shrinkOrEliminateHelper(bot, {
      playerLevel: state.level,
      killMargin: opts.killMargin,
      levelDamage: opts.levelDamage,
      stunTicks: opts.stunTicks,
      center: head,
      knockbackDist: opts.knockbackDist ?? 0,
      worldRadius: halfW,
    });

    if (res.eliminated) {
      eliminatedBots.push(bot);
      const scattered = scatterLootOrbs({
        orbs: nextOrbs,
        spine: bot.spine,
        count: 8,
        value: 3,
        config: state.config,
        rng,
      });
      nextOrbs = scattered.orbs;
      rng = scattered.rng;
    } else {
      survivedStruckCount += 1;
      survivingBots.push(res.bot);
      const scattered = scatterLootOrbs({
        orbs: nextOrbs,
        spine: [bot.head],
        count: 4,
        value: 2,
        config: state.config,
        rng,
      });
      nextOrbs = scattered.orbs;
      rng = scattered.rng;
    }
  }

  // Vaporize ALL hazards within aoeRadius
  const remainingHazards = [];
  const vaporizedHazardCells: Vec2[] = [];
  for (const h of state.hazards) {
    if (dist2d(head, h.cell) <= opts.aoeRadius) {
      vaporizedHazardCells.push(h.cell);
    } else {
      remainingHazards.push(h);
    }
  }

  // Arcane orb magnet pull (pull world orbs within pullOrbsRadius closer to head)
  if (opts.pullOrbsRadius !== undefined && opts.pullOrbsFactor !== undefined) {
    const pullRadius = opts.pullOrbsRadius;
    const pullFactor = opts.pullOrbsFactor;
    nextOrbs = nextOrbs.map((o) => {
      const d = Math.hypot(o.x - head.x, o.z - head.z);
      if (d <= pullRadius && d > 1e-5) {
        return {
          ...o,
          x: Number((o.x + (head.x - o.x) * pullFactor).toFixed(2)),
          z: Number((o.z + (head.z - o.z) * pullFactor).toFixed(2)),
        };
      }
      return o;
    });
  }

  // Arcane diamond flowers around head
  let allFlowers = [...state.gardenFlowers];
  if (opts.diamondFlowerRadius !== undefined && opts.diamondFlowerRadius > 0) {
    const r = opts.diamondFlowerRadius;
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const clamped = clampToArena(
        head.x + Math.cos(angle) * r,
        head.z + Math.sin(angle) * r,
        halfW,
        halfW,
      );
      const cv = nextInt(rng, 4);
      rng = cv.next;
      allFlowers.push({
        id: idCounter++,
        x: clamped.x,
        z: clamped.z,
        colorVariant: cv.value as 0 | 1 | 2 | 3,
        scale: 1.0,
        ticksRemaining: FLOWER_LIFETIME_TICKS,
        maxTicks: FLOWER_LIFETIME_TICKS,
      });
    }
    if (allFlowers.length > MAX_GARDEN_FLOWERS) {
      allFlowers = allFlowers.slice(allFlowers.length - MAX_GARDEN_FLOWERS);
    }
  }

  // Spawn lightning bolts for thunder skill / quest
  const bolts: SkyLightningBolt[] = [];
  if (opts.spawnBolts) {
    const minBolts = opts.minBolts ?? 6;
    const maxBolts = opts.maxBolts ?? 8;
    let colorIdx = 0;

    for (const pos of struckPositions) {
      if (bolts.length >= maxBolts) break;
      bolts.push({
        id: idCounter++,
        x: pos.x,
        z: pos.z,
        colorHex: LIGHTNING_COLORS[colorIdx % LIGHTNING_COLORS.length]!,
        ttl: LIGHTNING_TTL_TICKS,
        maxTtl: LIGHTNING_TTL_TICKS,
      });
      colorIdx++;
    }

    for (const pos of vaporizedHazardCells) {
      if (bolts.length >= maxBolts) break;
      bolts.push({
        id: idCounter++,
        x: pos.x,
        z: pos.z,
        colorHex: LIGHTNING_COLORS[colorIdx % LIGHTNING_COLORS.length]!,
        ttl: LIGHTNING_TTL_TICKS,
        maxTtl: LIGHTNING_TTL_TICKS,
      });
      colorIdx++;
    }

    const missing = minBolts - bolts.length;
    for (let i = 0; i < missing; i++) {
      const angle = state.heading + (i / Math.max(1, missing)) * Math.PI * 2;
      const clamped = clampToArena(
        head.x + Math.cos(angle) * 6.5,
        head.z + Math.sin(angle) * 6.5,
        halfW,
        halfW,
      );
      bolts.push({
        id: idCounter++,
        x: clamped.x,
        z: clamped.z,
        colorHex: LIGHTNING_COLORS[colorIdx % LIGHTNING_COLORS.length]!,
        ttl: LIGHTNING_TTL_TICKS,
        maxTtl: LIGHTNING_TTL_TICKS,
      });
      colorIdx++;
    }
  }

  // Create AoeBlast visual ring
  const blast: AoeBlast = {
    id: idCounter++,
    element: opts.element,
    x: head.x,
    z: head.z,
    radius: opts.aoeRadius,
    ttl: AOE_BLAST_TTL,
    maxTtl: AOE_BLAST_TTL,
  };

  const firstBoltCell = bolts[0] ? { x: bolts[0].x, z: bolts[0].z } : head;
  let events = state.events;
  let eventSeq = state.eventSeq;

  const evSkill = appendEvents(events, eventSeq, [
    {
      kind: opts.eventKind,
      cell: firstBoltCell,
      points: opts.spawnBolts ? bolts.length : Math.round(opts.aoeRadius),
      messageVi: opts.messageVi,
    },
  ]);
  events = evSkill.events;
  eventSeq = evSkill.eventSeq;

  // Base score for cast + survivors struck + hazards cleared
  let score = state.score + 20 + survivedStruckCount * 25 + vaporizedHazardCells.length * 10;
  let best = Math.max(state.best, score);
  let level = state.level;
  let xp = state.xp;

  // Apply elimination rewards (bot_eaten + XP + score + level_up)
  for (const elim of eliminatedBots) {
    const pts = 80 + elim.level * 12;
    const gainXp = Math.max(4, Math.ceil(elim.level * 1.2));
    const evElim = appendEvents(events, eventSeq, [
      {
        kind: 'bot_eaten',
        cell: elim.head,
        form: elim.powerForm,
        points: pts,
        messageVi: '💥 Hạ Gục Bot!',
      },
    ]);
    const xpRes = applyXpAndScore({
      score,
      best,
      level,
      xp,
      gainXp,
      points: pts,
      events: evElim.events,
      eventSeq: evElim.eventSeq,
      cell: elim.head,
    });
    score = xpRes.score;
    best = xpRes.best;
    level = xpRes.level;
    xp = xpRes.xp;
    events = xpRes.events;
    eventSeq = xpRes.eventSeq;
  }

  const botsEaten = state.botsEaten + eliminatedBots.length;
  const enemiesDefeated = state.enemiesDefeated + eliminatedBots.length;
  const bossProgress = Math.min(100, state.bossProgress + eliminatedBots.length * 10);
  const nextCharge = Math.min(100, state.butterflyCharge + opts.butterflyChargeGain);

  // Sync snake length if player leveled up
  let nextSnake = state.snake;
  let nextPrevSnake = state.prevSnake;
  const targetLen = targetPlayerLength(level, state.config.initialLength);
  if (nextSnake.length !== targetLen) {
    nextSnake = advanceSpineFollowLeader(nextSnake, head, state.heading, targetLen);
    nextPrevSnake = matchSpineLength(nextPrevSnake, targetLen);
  }

  const board = computeLeaderboard({
    playerName: state.playerName,
    playerLevel: level,
    bots: survivingBots,
    activeBossId: state.activeBossId,
  });

  return {
    ...state,
    snake: nextSnake,
    prevSnake: nextPrevSnake,
    bots: survivingBots,
    botsEaten,
    enemiesDefeated,
    bossProgress,
    hazards: remainingHazards,
    gardenFlowers: allFlowers,
    lightningBolts: [...state.lightningBolts, ...bolts],
    aoeBlasts: [...state.aoeBlasts, blast],
    orbs: nextOrbs,
    butterflyCharge: nextCharge,
    score,
    best,
    level,
    xp,
    leaderboard: board.leaderboard,
    playerRank: board.playerRank,
    crownTarget: board.crownTarget,
    rng,
    events,
    eventSeq,
  };
}

// ---------------------------------------------------------------------------
// 4 Elemental 360° AoE Skills
// ---------------------------------------------------------------------------

function castThunder(state: GameState): GameState {
  if (state.thunderCooldownTicks > 0) return state;

  const thunderCooldown = state.ageProfile === 'age6' ? 50 : 65;
  const struck = executeAoeStrike(state, {
    element: 'thunder',
    aoeRadius: 16,
    killMargin: 6,
    levelDamage: 6,
    stunTicks: 55,
    knockbackDist: 0,
    butterflyChargeGain: 15,
    eventKind: 'sky_thunder',
    messageVi: '⚡ Bão Sấm Sét AoE!',
    spawnBolts: true,
    minBolts: 6,
    maxBolts: 8,
  });

  return { ...struck, thunderCooldownTicks: thunderCooldown };
}

function castFire(state: GameState): GameState {
  if (state.fireCooldownTicks > 0) return state;

  const fireCooldown =
    state.ageProfile === 'age6' ? FIRE_COOLDOWN_TICKS_AGE6 : FIRE_COOLDOWN_TICKS_AGE9;
  const struck = executeAoeStrike(state, {
    element: 'fire',
    aoeRadius: 14,
    killMargin: 9,
    levelDamage: 8,
    stunTicks: 35,
    knockbackDist: 9,
    butterflyChargeGain: 18,
    eventKind: 'aoe_fire',
    messageVi: '🔥 Phun Lửa Hủy Diệt!',
  });

  return { ...struck, fireCooldownTicks: fireCooldown };
}

function castWater(state: GameState): GameState {
  if (state.waterCooldownTicks > 0) return state;

  const waterCooldown =
    state.ageProfile === 'age6' ? WATER_COOLDOWN_TICKS_AGE6 : WATER_COOLDOWN_TICKS_AGE9;
  const struck = executeAoeStrike(state, {
    element: 'water',
    aoeRadius: 15,
    killMargin: 5,
    levelDamage: 5,
    stunTicks: 70,
    knockbackDist: 12,
    butterflyChargeGain: 16,
    eventKind: 'aoe_water',
    messageVi: '🌊 Sóng Thần Phun Nước!',
  });

  return { ...struck, waterCooldownTicks: waterCooldown };
}

function castArcane(state: GameState): GameState {
  if (state.arcaneCooldownTicks > 0) return state;

  const arcaneCooldown =
    state.ageProfile === 'age6' ? ARCANE_COOLDOWN_TICKS_AGE6 : ARCANE_COOLDOWN_TICKS_AGE9;
  const struck = executeAoeStrike(state, {
    element: 'arcane',
    aoeRadius: 15.5,
    killMargin: 7,
    levelDamage: 7,
    stunTicks: 50,
    knockbackDist: 0,
    butterflyChargeGain: 20,
    eventKind: 'aoe_arcane',
    messageVi: '🔮 Bùng Nổ Ma Thuật!',
    pullOrbsRadius: 18,
    pullOrbsFactor: 0.55,
    diamondFlowerRadius: 3.2,
  });

  return { ...struck, arcaneCooldownTicks: arcaneCooldown };
}

// ---------------------------------------------------------------------------
// stepFairyMagic — called every tick
// ---------------------------------------------------------------------------

export function stepFairyMagic(state: GameState): GameState {
  const head = state.snake[0];
  if (!head) return state;

  // Decrement cooldowns
  const nextFlowerCooldown = Math.max(0, state.flowerCooldownTicks - 1);
  const nextThunderCooldown = Math.max(0, state.thunderCooldownTicks - 1);
  const nextFireCooldown = Math.max(0, state.fireCooldownTicks - 1);
  const nextWaterCooldown = Math.max(0, state.waterCooldownTicks - 1);
  const nextArcaneCooldown = Math.max(0, state.arcaneCooldownTicks - 1);

  // Decrement lightning bolt ttl, filter out expired
  const nextBolts = state.lightningBolts
    .map((b) => ({ ...b, ttl: b.ttl - 1 }))
    .filter((b) => b.ttl > 0);

  // Decrement AoE blast ttl, filter out expired
  const nextBlasts = state.aoeBlasts
    .map((b) => ({ ...b, ttl: b.ttl - 1 }))
    .filter((b) => b.ttl > 0);

  // Decrement flower ticksRemaining, filter out expired
  const nextFlowers = state.gardenFlowers
    .map((f) => ({ ...f, ticksRemaining: f.ticksRemaining - 1 }))
    .filter((f) => f.ticksRemaining > 0);

  // Decrement frostZone ticksRemaining, filter out expired
  const nextFrostZones = state.frostZones
    .map((fz) => ({ ...fz, ticksRemaining: fz.ticksRemaining - 1 }))
    .filter((fz) => fz.ticksRemaining > 0);

  let working: GameState = {
    ...state,
    flowerCooldownTicks: nextFlowerCooldown,
    thunderCooldownTicks: nextThunderCooldown,
    fireCooldownTicks: nextFireCooldown,
    waterCooldownTicks: nextWaterCooldown,
    arcaneCooldownTicks: nextArcaneCooldown,
    lightningBolts: nextBolts,
    aoeBlasts: nextBlasts,
    gardenFlowers: nextFlowers,
    frostZones: nextFrostZones,
  };

  // Advance butterfly stage
  working = advanceButterflyStage(working);

  // Check bot vs GardenFlower charm collisions
  working = checkFlowerCharmCollisions(working);

  return working;
}

// ---------------------------------------------------------------------------
// Butterfly stage advancement (Altitude, Flight & Touchdown Shockwave)
// ---------------------------------------------------------------------------

function applyButterflyFallingIce(state: GameState, head: Vec2, cadenceTick: number): GameState {
  let nextFrostZones = state.frostZones;
  if (nextFrostZones.length === 0 || cadenceTick % 3 === 0) {
    nextFrostZones = appendFrostZone({ ...state, frostZones: nextFrostZones }, head);
  }

  const inFrostArea = (pos: Vec2): boolean =>
    dist2d(head, pos) <= BUTTERFLY_FROST_RADIUS ||
    nextFrostZones.some((fz) => dist2d(pos, fz) <= fz.radius);

  const frozenBots = state.bots.map((bot) =>
    inFrostArea(bot.head) ? { ...bot, frozenTicks: Math.max(bot.frozenTicks, 45) } : bot,
  );
  const frozenHazards = state.hazards.map((h) =>
    inFrostArea(h.cell) ? { ...h, frozenTicks: Math.max(h.frozenTicks, 45) } : h,
  );

  let events = state.events;
  let eventSeq = state.eventSeq;
  if (cadenceTick % 5 === 0) {
    const ev = appendEvents(events, eventSeq, [{ kind: 'butterfly_frost', cell: head }]);
    events = ev.events;
    eventSeq = ev.eventSeq;
  }

  return {
    ...state,
    frostZones: nextFrostZones,
    bots: frozenBots,
    hazards: frozenHazards,
    events,
    eventSeq,
  };
}

function advanceButterflyStage(state: GameState): GameState {
  const head = state.snake[0];
  if (!head) return state;

  switch (state.butterflyStage) {
    case 'caterpillar': {
      const chargeRate = state.ageProfile === 'age6' ? 1.2 : 0.8;
      const nextCharge = Math.min(100, state.butterflyCharge + chargeRate);
      return {
        ...state,
        butterflyCharge: nextCharge,
        butterflyAltitude: 0,
        butterflyLanding: false,
      };
    }

    case 'cocoon': {
      const nextTicks = state.butterflyTicks - 1;
      if (nextTicks <= 0) {
        // Emerge as butterfly high into the air!
        let rng = state.rng;
        const scattered = scatterLootOrbs({
          orbs: [...state.orbs],
          spine: [head, head, head, head, head],
          count: 5,
          value: 2,
          config: state.config,
          rng,
        });
        rng = scattered.rng;

        const nextScore = state.score + 35;
        const nextBest = Math.max(state.best, nextScore);

        const ev = appendEvents(state.events, state.eventSeq, [
          {
            kind: 'butterfly_emerge',
            cell: head,
            messageVi: '🦋 Hóa Bướm Tiên!',
          },
        ]);

        return {
          ...state,
          butterflyStage: 'butterfly',
          butterflyTicks: BUTTERFLY_DURATION_TICKS,
          butterflyAltitude: 0.7,
          butterflyLanding: false,
          butterflyLandingFromHold: false,
          frostZones: appendFrostZone(state, head),
          orbs: scattered.orbs,
          score: nextScore,
          best: nextBest,
          rng,
          events: ev.events,
          eventSeq: ev.eventSeq,
        };
      }
      const nextAltitude = 0.25 + 0.3 * (1 - nextTicks / COCOON_DURATION_TICKS);
      return {
        ...state,
        butterflyTicks: nextTicks,
        butterflyAltitude: nextAltitude,
        butterflyLanding: false,
      };
    }

    case 'butterfly': {
      const isHolding = state.butterflyHold;
      const nextTicks = isHolding ? BUTTERFLY_DURATION_TICKS : state.butterflyTicks - 1;
      const nextLanding = isHolding
        ? false
        : state.butterflyLanding || nextTicks <= LANDING_DURATION_TICKS;
      let working: GameState = {
        ...state,
        butterflyTicks: nextTicks,
        butterflyLanding: nextLanding,
      };

      // Touchdown!
      if (!isHolding && nextTicks <= 0) {
        const halfW = state.config.worldRadius;
        let rng = working.rng;
        let idCounter = nextEntityId(
          working.gardenFlowers,
          working.lightningBolts,
          working.aoeBlasts,
        );

        // Landing Petal Shockwave: stun bots within 7.5 units
        const stunnedBots = working.bots.map((bot) =>
          dist2d(head, bot.head) <= 7.5
            ? { ...bot, frozenTicks: Math.max(bot.frozenTicks, 36) }
            : bot,
        );

        // Plant 4 GardenFlowers around head
        const landingFlowers: GardenFlower[] = [];
        for (let i = 0; i < 4; i++) {
          const angle = (i / 4) * Math.PI * 2;
          const clamped = clampToArena(
            head.x + Math.cos(angle) * 2.6,
            head.z + Math.sin(angle) * 2.6,
            halfW,
            halfW,
          );
          const cv = nextInt(rng, 4);
          rng = cv.next;
          landingFlowers.push({
            id: idCounter++,
            x: clamped.x,
            z: clamped.z,
            colorVariant: cv.value as 0 | 1 | 2 | 3,
            scale: 1.0,
            ticksRemaining: FLOWER_LIFETIME_TICKS,
            maxTicks: FLOWER_LIFETIME_TICKS,
          });
        }
        let allFlowers = [...working.gardenFlowers, ...landingFlowers];
        if (allFlowers.length > MAX_GARDEN_FLOWERS) {
          allFlowers = allFlowers.slice(allFlowers.length - MAX_GARDEN_FLOWERS);
        }

        const ev = appendEvents(working.events, working.eventSeq, [
          {
            kind: 'butterfly_land',
            cell: head,
            messageVi: '🦋 Đáp Xuống An Toàn!',
          },
        ]);

        return {
          ...working,
          butterflyStage: 'caterpillar' as ButterflyStage,
          butterflyTicks: 0,
          butterflyAltitude: 0,
          butterflyLanding: false,
          butterflyLandingFromHold: false,
          butterflyCharge: working.butterflyLandingFromHold ? 100 : 35,
          invulnerableTicks: Math.max(working.invulnerableTicks, 30),
          bots: stunnedBots,
          gardenFlowers: allFlowers,
          rng,
          events: ev.events,
          eventSeq: ev.eventSeq,
        };
      }

      let nextAltitude: number;
      if (!nextLanding) {
        nextAltitude = Math.min(1, working.butterflyAltitude + 0.12);
      } else {
        nextAltitude = Math.max(0, nextTicks / LANDING_DURATION_TICKS);
      }

      working = { ...working, butterflyAltitude: nextAltitude };

      // Fly safely overhead when butterflyAltitude >= 0.5; only brush ground bots when low (< 0.5)
      if (nextAltitude < 0.5) {
        const updatedBots = working.bots.map((bot) => {
          if (dist2d(head, bot.head) > 2.4) return bot;
          const nextFrozen = Math.max(bot.frozenTicks, 22);
          const nextLevel = bot.frozenTicks === 0 ? Math.max(1, bot.level - 2) : bot.level;
          return { ...bot, frozenTicks: nextFrozen, level: nextLevel };
        });
        working = { ...working, bots: updatedBots };
      }

      if (!nextLanding) {
        const cadenceTick = isHolding ? working.elapsedTicks : nextTicks;

        // Auto-plant flower every 14 ticks
        if (cadenceTick > 0 && cadenceTick % 14 === 0) {
          const tail = state.snake[state.snake.length - 1] ?? head;
          const halfW = state.config.worldRadius;
          let rng = working.rng;
          const cv = nextInt(rng, 4);
          rng = cv.next;
          let idCounter = nextEntityId(
            working.gardenFlowers,
            working.lightningBolts,
            working.aoeBlasts,
          );
          const clamped = clampToArena(tail.x, tail.z, halfW, halfW);

          const newFlower: GardenFlower = {
            id: idCounter++,
            x: clamped.x,
            z: clamped.z,
            colorVariant: cv.value as 0 | 1 | 2 | 3,
            scale: 0.95,
            ticksRemaining: FLOWER_LIFETIME_TICKS,
            maxTicks: FLOWER_LIFETIME_TICKS,
          };

          let allFlowers = [...working.gardenFlowers, newFlower];
          if (allFlowers.length > MAX_GARDEN_FLOWERS) {
            allFlowers = allFlowers.slice(allFlowers.length - MAX_GARDEN_FLOWERS);
          }
          working = { ...working, gardenFlowers: allFlowers, rng };
        }

        working = applyButterflyFallingIce(working, head, cadenceTick);
      }

      return working;
    }
  }
}

// ---------------------------------------------------------------------------
// Bot vs GardenFlower charm collisions
// ---------------------------------------------------------------------------

function checkFlowerCharmCollisions(state: GameState): GameState {
  const head = state.snake[0];
  if (!head) return state;
  if (state.gardenFlowers.length === 0) return state;

  const working = state;
  const consumedFlowerIds = new Set<number>();
  const updatedBots = [...working.bots];
  let nextOrbs = [...working.orbs];
  let rng = working.rng;
  let scoreGain = 0;
  const drafts: EventDraft[] = [];

  for (const flower of working.gardenFlowers) {
    if (consumedFlowerIds.has(flower.id)) continue;

    for (let bi = 0; bi < updatedBots.length; bi++) {
      const bot = updatedBots[bi]!;
      const d = Math.hypot(bot.head.x - flower.x, bot.head.z - flower.z);
      if (d < 2.2 && bot.frozenTicks < 10) {
        // Charm the bot
        updatedBots[bi] = {
          ...bot,
          frozenTicks: Math.max(bot.frozenTicks, 28),
          level: Math.max(1, bot.level - 1),
        };

        // Consume the flower
        consumedFlowerIds.add(flower.id);

        // Scatter 3 nectar loot orbs at flower position
        const scattered = scatterLootOrbs({
          orbs: nextOrbs,
          spine: [{ x: flower.x, z: flower.z }],
          count: 3,
          value: 2,
          config: working.config,
          rng,
        });
        nextOrbs = scattered.orbs;
        rng = scattered.rng;

        scoreGain += 25;

        drafts.push({
          kind: 'flower_charm',
          cell: { x: flower.x, z: flower.z },
          points: 25,
          messageVi: '🌸 Hoa Mê Hoặc Bot!',
        });

        break; // One bot per flower
      }
    }
  }

  if (consumedFlowerIds.size === 0) return state;

  const remainingFlowers = working.gardenFlowers.filter((f) => !consumedFlowerIds.has(f.id));
  const nextScore = working.score + scoreGain;
  const nextBest = Math.max(working.best, nextScore);

  const ev = appendEvents(working.events, working.eventSeq, drafts);

  return {
    ...working,
    bots: updatedBots,
    gardenFlowers: remainingFlowers,
    orbs: nextOrbs,
    score: nextScore,
    best: nextBest,
    rng,
    events: ev.events,
    eventSeq: ev.eventSeq,
  };
}

// ---------------------------------------------------------------------------
// Quest reward helpers (do NOT set manual skill cooldowns)
// ---------------------------------------------------------------------------

/** Instantly trigger butterfly metamorphosis (quest reward). */
export function triggerButterflyMetamorphosisInstant(state: GameState): GameState {
  const head = state.snake[0];
  const headCell: Vec2 = head ?? { x: 0, z: 0 };

  const ev = appendEvents(state.events, state.eventSeq, [
    {
      kind: 'cocoon_start',
      cell: headCell,
      messageVi: '🥚 Kén Pha Lê...',
    },
  ]);

  return {
    ...state,
    butterflyStage: 'cocoon',
    butterflyTicks: COCOON_DURATION_TICKS,
    butterflyCharge: 100,
    butterflyAltitude: 0.25,
    butterflyLanding: false,
    events: ev.events,
    eventSeq: ev.eventSeq,
  };
}

/** Spawn a ring of flowers around the player (quest reward). */
export function spawnFlowerRing(state: GameState, count = 6): GameState {
  const head = state.snake[0];
  if (!head) return state;

  const halfW = state.config.worldRadius;
  let rng = state.rng;
  let idCounter = nextEntityId(state.gardenFlowers, state.lightningBolts, state.aoeBlasts);
  const newFlowers: GardenFlower[] = [];

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const radius = 3.5;
    const fx = head.x + Math.cos(angle) * radius;
    const fz = head.z + Math.sin(angle) * radius;
    const clamped = clampToArena(fx, fz, halfW, halfW);

    const cv = nextInt(rng, 4);
    rng = cv.next;

    newFlowers.push({
      id: idCounter++,
      x: clamped.x,
      z: clamped.z,
      colorVariant: cv.value as 0 | 1 | 2 | 3,
      scale: 1.0,
      ticksRemaining: FLOWER_LIFETIME_TICKS,
      maxTicks: FLOWER_LIFETIME_TICKS,
    });
  }

  let allFlowers = [...state.gardenFlowers, ...newFlowers];
  if (allFlowers.length > MAX_GARDEN_FLOWERS) {
    allFlowers = allFlowers.slice(allFlowers.length - MAX_GARDEN_FLOWERS);
  }

  const ev = appendEvents(state.events, state.eventSeq, [
    {
      kind: 'flower_bloom',
      cell: head,
      points: count,
      messageVi: '🌸🌷 Vườn Hoa Nở Rộ!',
    },
  ]);

  return {
    ...state,
    gardenFlowers: allFlowers,
    rng,
    events: ev.events,
    eventSeq: ev.eventSeq,
  };
}

/** Spawn an enhanced Thunder AoE storm without setting thunderCooldownTicks (quest reward). */
export function spawnThunderStorm(state: GameState): GameState {
  return executeAoeStrike(state, {
    element: 'thunder',
    aoeRadius: 16,
    killMargin: 6,
    levelDamage: 6,
    stunTicks: 55,
    knockbackDist: 0,
    butterflyChargeGain: 0,
    eventKind: 'sky_thunder',
    messageVi: '⚡ Bão Sấm Sét AoE!',
    spawnBolts: true,
    minBolts: 5,
    maxBolts: 8,
  });
}

/** Spawn a Fire Nova AoE blast without setting fireCooldownTicks (quest reward). */
export function spawnFireNova(state: GameState): GameState {
  return executeAoeStrike(state, {
    element: 'fire',
    aoeRadius: 14,
    killMargin: 9,
    levelDamage: 8,
    stunTicks: 35,
    knockbackDist: 9,
    butterflyChargeGain: 0,
    eventKind: 'aoe_fire',
    messageVi: '🔥 Phun Lửa Hủy Diệt!',
  });
}

/** Spawn a Water Tsunami AoE blast without setting waterCooldownTicks (quest reward). */
export function spawnWaterTsunami(state: GameState): GameState {
  return executeAoeStrike(state, {
    element: 'water',
    aoeRadius: 15,
    killMargin: 5,
    levelDamage: 5,
    stunTicks: 70,
    knockbackDist: 12,
    butterflyChargeGain: 0,
    eventKind: 'aoe_water',
    messageVi: '🌊 Sóng Thần Phun Nước!',
  });
}

/** Spawn an Arcane Nova AoE blast without setting arcaneCooldownTicks (quest reward). */
export function spawnArcaneNova(state: GameState): GameState {
  return executeAoeStrike(state, {
    element: 'arcane',
    aoeRadius: 15.5,
    killMargin: 7,
    levelDamage: 7,
    stunTicks: 50,
    knockbackDist: 0,
    butterflyChargeGain: 0,
    eventKind: 'aoe_arcane',
    messageVi: '🔮 Bùng Nổ Ma Thuật!',
    pullOrbsRadius: 18,
    pullOrbsFactor: 0.55,
    diamondFlowerRadius: 3.2,
  });
}
