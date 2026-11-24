/**
 * Fairy Princess Transformation — pure deterministic module.
 *
 * The player's snake can transform into a beautiful flying Fairy Princess to
 * peacefully fly around the kingdom and tour (orbit) the grand castles. While
 * transformed she flies above every danger, cannot chomp bots, and gently
 * auto-circles any castle she is visiting when the player is not steering.
 */

import type { EventDraft } from './quests';
import { appendEvents, applyXpAndScore } from './quests';
import { computeLeaderboard } from './bots';
import { angleDiff, clamp, normalizeAngle } from './systems/arena';
import type { GameState, ShelterHouse, Vec2 } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Transformation (snake → princess) animation length: 1.6s. */
export const PRINCESS_TRANSFORM_TICKS = 32;
/** Return (princess → snake) animation length: 1.2s. */
export const PRINCESS_RETURN_TICKS = 24;
/** Cooldown after returning to snake form: 3s. */
export const PRINCESS_COOLDOWN_TICKS = 60;
/** Extra distance beyond a castle's dome radius within which she tours it. */
export const PRINCESS_TOUR_RANGE = 22;
/** Score reward for each completed sightseeing lap around a castle. */
export const PRINCESS_TOUR_LAP_SCORE = 100;
/** XP reward for each completed sightseeing lap around a castle. */
export const PRINCESS_TOUR_LAP_XP = 5;
/** Free-flight speed multiplier while transformed. */
export const PRINCESS_FLY_SPEED_MULT = 1.3;
/** Gentle sightseeing speed multiplier while touring a castle. */
export const PRINCESS_TOUR_SPEED_MULT = 1.1;
/** Slow drift speed multiplier during the transformation magic. */
export const PRINCESS_MORPH_SPEED_MULT = 0.35;
/** Max auto-tour heading turn per tick (radians). */
const PRINCESS_TOUR_TURN_RAD = 0.14;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** True whenever the snake is not in plain snake form (transforming, princess, or returning). */
export function isPrincessActive(state: GameState): boolean {
  return (state.princessStage ?? 'snake') !== 'snake';
}

/** Whether the snake may begin the Fairy Princess transformation right now. */
export function canTransformToPrincess(state: GameState): boolean {
  return (
    state.phase === 'playing' &&
    (state.princessStage ?? 'snake') === 'snake' &&
    (state.princessCooldownTicks ?? 0) <= 0 &&
    state.butterflyStage === 'caterpillar' &&
    state.monsterEvent.phase === 'idle'
  );
}

/** Radius at which the princess circles a castle during her sightseeing tour. */
export function princessOrbitRadius(shelter: ShelterHouse): number {
  return Math.max(7, shelter.radius * 0.93);
}

/** Nearest castle/shelter the princess is currently touring, if any. */
export function findTourShelter(state: GameState, head: Vec2): ShelterHouse | null {
  if (state.princessStage !== 'princess') return null;
  let best: ShelterHouse | null = null;
  let bestDist = Infinity;
  for (const s of state.shelters ?? []) {
    const d = Math.hypot(head.x - s.x, head.z - s.z);
    if (d <= s.radius + PRINCESS_TOUR_RANGE && d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Auto-tour target heading: tangent around the toured castle plus a radial
 * correction toward the orbit radius. Returns `null` when not auto-touring
 * (player is steering, not transformed, or no castle nearby).
 */
export function princessTourHeading(state: GameState, head: Vec2): number | null {
  if (state.princessStage !== 'princess' || state.targetHeading !== null) return null;
  const shelter = findTourShelter(state, head);
  if (!shelter) return null;
  const dx = head.x - shelter.x;
  const dz = head.z - shelter.z;
  const dist = Math.hypot(dx, dz);
  const orbitR = princessOrbitRadius(shelter);
  const radialAngle = dist > 1e-4 ? Math.atan2(dz, dx) : state.heading - Math.PI / 2;
  const tangent = radialAngle + Math.PI / 2;
  // Positive correction steers toward the castle center (too far), negative steers outward.
  const correction = clamp(((dist - orbitR) / orbitR) * 1.2, -0.9, 0.9);
  return normalizeAngle(tangent + correction);
}

/** Next heading when auto-touring (turn-rate limited), or the unchanged heading. */
export function applyPrincessTourSteer(state: GameState, head: Vec2, heading: number): number {
  const target = princessTourHeading(state, head);
  if (target === null) return heading;
  const diff = angleDiff(heading, target);
  return normalizeAngle(heading + clamp(diff, -PRINCESS_TOUR_TURN_RAD, PRINCESS_TOUR_TURN_RAD));
}

/** Movement speed override while transformed (or `null` for normal snake speeds). */
export function princessMoveSpeed(state: GameState, baseSpeed: number, head: Vec2): number | null {
  switch (state.princessStage ?? 'snake') {
    case 'snake':
      return null;
    case 'transforming':
    case 'returning':
      return baseSpeed * PRINCESS_MORPH_SPEED_MULT;
    case 'princess':
      return findTourShelter(state, head) && state.targetHeading === null
        ? baseSpeed * PRINCESS_TOUR_SPEED_MULT
        : baseSpeed * PRINCESS_FLY_SPEED_MULT;
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Start the Fairy Princess transformation, or return to snake form if already a princess. */
export function togglePrincess(state: GameState): GameState {
  if (state.phase !== 'playing') return state;
  const head = state.snake[0];

  if (state.princessStage === 'princess') {
    const ev = appendEvents(state.events, state.eventSeq, [
      {
        kind: 'princess_return',
        cell: head,
        messageVi: '✨ Tiên Nữ hạ cánh và hóa lại thành Rắn Tiên! 🐍',
      },
    ]);
    return {
      ...state,
      princessStage: 'returning',
      princessTicks: PRINCESS_RETURN_TICKS,
      princessMaxTicks: PRINCESS_RETURN_TICKS,
      princessTourShelterId: null,
      princessTourAngle: 0,
      events: ev.events,
      eventSeq: ev.eventSeq,
    };
  }

  if (!canTransformToPrincess(state)) return state;

  const ev = appendEvents(state.events, state.eventSeq, [
    {
      kind: 'princess_transform',
      cell: head,
      messageVi: '🌟 Phép màu biến hình! Rắn Tiên đang hóa thành Tiên Nữ... ✨',
    },
  ]);
  return {
    ...state,
    princessStage: 'transforming',
    princessTicks: PRINCESS_TRANSFORM_TICKS,
    princessMaxTicks: PRINCESS_TRANSFORM_TICKS,
    princessTourShelterId: null,
    princessTourAngle: 0,
    princessTourLaps: 0,
    isDashing: false,
    sprayActiveTicks: 0,
    events: ev.events,
    eventSeq: ev.eventSeq,
  };
}

// ---------------------------------------------------------------------------
// Per-tick simulation
// ---------------------------------------------------------------------------

/**
 * Advance princess transformation timers, altitude, auto-return on monster
 * warnings, and castle tour start / lap rewards. `prevHead` is the snake head
 * position before this tick's movement (used to accumulate orbit angle).
 */
export function stepPrincess(state: GameState, prevHead: Vec2): GameState {
  if (state.phase !== 'playing') return state;
  const head = state.snake[0];
  if (!head) return state;

  const stage = state.princessStage ?? 'snake';
  const cooldown = Math.max(0, (state.princessCooldownTicks ?? 0) - 1);

  if (stage === 'snake') {
    if (cooldown === state.princessCooldownTicks && state.princessAltitude === 0) return state;
    return { ...state, princessCooldownTicks: cooldown, princessAltitude: 0 };
  }

  if (stage === 'transforming') {
    if (state.monsterEvent.phase !== 'idle') {
      return beginMonsterReturn(state, head);
    }
    const rem = state.princessTicks - 1;
    if (rem <= 0) {
      const ev = appendEvents(state.events, state.eventSeq, [
        {
          kind: 'princess_reveal',
          cell: head,
          messageVi: '👸 Tiên Nữ xinh đẹp đã xuất hiện! Bay tới lâu đài để tham quan nhé! ✨',
        },
      ]);
      return {
        ...state,
        princessStage: 'princess',
        princessTicks: 0,
        princessAltitude: 1,
        events: ev.events,
        eventSeq: ev.eventSeq,
      };
    }
    const progress = 1 - rem / Math.max(1, state.princessMaxTicks);
    return {
      ...state,
      princessTicks: rem,
      princessAltitude: Number(progress.toFixed(3)),
    };
  }

  if (stage === 'returning') {
    const rem = state.princessTicks - 1;
    if (rem <= 0) {
      return {
        ...state,
        princessStage: 'snake',
        princessTicks: 0,
        princessAltitude: 0,
        princessCooldownTicks: PRINCESS_COOLDOWN_TICKS,
        princessTourShelterId: null,
        princessTourAngle: 0,
      };
    }
    const progress = 1 - rem / Math.max(1, state.princessMaxTicks);
    return {
      ...state,
      princessTicks: rem,
      princessAltitude: Number((1 - progress).toFixed(3)),
    };
  }

  // stage === 'princess'
  if (state.monsterEvent.phase !== 'idle') {
    return beginMonsterReturn(state, head);
  }

  const shelter = findTourShelter(state, head);
  if (!shelter) {
    if (state.princessTourShelterId === null && state.princessTourAngle === 0) {
      return state.princessAltitude === 1 ? state : { ...state, princessAltitude: 1 };
    }
    return { ...state, princessAltitude: 1, princessTourShelterId: null, princessTourAngle: 0 };
  }

  if (shelter.id !== state.princessTourShelterId) {
    const ev = appendEvents(state.events, state.eventSeq, [
      {
        kind: 'princess_tour_start',
        cell: { x: shelter.x, z: shelter.z },
        shelterId: shelter.id,
        messageVi: `👸 Tiên Nữ đang tham quan ${shelter.nameVi}! ✨`,
      },
    ]);
    return {
      ...state,
      princessAltitude: 1,
      princessTourShelterId: shelter.id,
      princessTourAngle: 0,
      events: ev.events,
      eventSeq: ev.eventSeq,
    };
  }

  const prevAngle = Math.atan2(prevHead.z - shelter.z, prevHead.x - shelter.x);
  const nextAngle = Math.atan2(head.z - shelter.z, head.x - shelter.x);
  let tourAngle = state.princessTourAngle + Math.abs(angleDiff(prevAngle, nextAngle));
  if (tourAngle < Math.PI * 2) {
    return { ...state, princessAltitude: 1, princessTourAngle: tourAngle };
  }

  tourAngle -= Math.PI * 2;
  const laps = state.princessTourLaps + 1;
  const drafts: EventDraft[] = [
    {
      kind: 'princess_tour_lap',
      cell: head,
      points: PRINCESS_TOUR_LAP_SCORE,
      shelterId: shelter.id,
      messageVi: `🎀 Hoàn thành vòng tham quan ${shelter.nameVi}! +${PRINCESS_TOUR_LAP_SCORE}đ ✨`,
    },
  ];
  const ev = appendEvents(state.events, state.eventSeq, drafts);
  const xpRes = applyXpAndScore({
    score: state.score,
    best: state.best,
    level: state.level,
    xp: state.xp,
    gainXp: PRINCESS_TOUR_LAP_XP,
    points: PRINCESS_TOUR_LAP_SCORE,
    events: ev.events,
    eventSeq: ev.eventSeq,
    cell: head,
  });
  const board =
    xpRes.level !== state.level
      ? computeLeaderboard({
          playerName: state.playerName,
          playerLevel: xpRes.level,
          bots: state.bots,
          activeBossId: state.activeBossId,
        })
      : null;

  return {
    ...state,
    princessAltitude: 1,
    princessTourAngle: tourAngle,
    princessTourLaps: laps,
    score: xpRes.score,
    best: xpRes.best,
    level: xpRes.level,
    xp: xpRes.xp,
    events: xpRes.events,
    eventSeq: xpRes.eventSeq,
    leaderboard: board ? board.leaderboard : state.leaderboard,
    playerRank: board ? board.playerRank : state.playerRank,
    crownTarget: board ? board.crownTarget : state.crownTarget,
  };
}

function beginMonsterReturn(state: GameState, head: Vec2): GameState {
  const ev = appendEvents(state.events, state.eventSeq, [
    {
      kind: 'princess_return',
      cell: head,
      messageVi: '⚠️ Quái vật sắp đến! Tiên Nữ hạ cánh — bé hãy vào lâu đài trú ẩn nhé! 🏰',
    },
  ]);
  // Resume the reverse animation from the current altitude (smooth even mid-transform).
  const startTicks = Math.max(
    1,
    Math.round(PRINCESS_RETURN_TICKS * clamp(state.princessAltitude ?? 1, 0, 1)),
  );
  return {
    ...state,
    princessStage: 'returning',
    princessTicks: startTicks,
    princessMaxTicks: PRINCESS_RETURN_TICKS,

    princessTourShelterId: null,
    princessTourAngle: 0,
    events: ev.events,
    eventSeq: ev.eventSeq,
  };
}
