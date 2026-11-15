import type { BotSnake, Cell, GameState, Hazard, Projectile, SnakeForm, Vec2 } from './types';
import { FORM_METADATA } from './config';
import { nextFloat } from './rng';
import { angleDiff, clamp, euclideanDistance, normalizeAngle } from './systems/arena';
import { distancePointToSegment, hitsWall } from './systems/collision';
import { sampleWorldPos } from './systems/food';
import { appendEvents, applyQuestOrbHit, applyScoreGain, type EventDraft } from './quests';
import { botCollisionRadius, computeLeaderboard, resolveBotDefeated } from './bots';

/** Continuous projectile travel distance per `projectile_step`. */
export const PROJECTILE_STEP_DIST = 1.15;
/** AoE blast radius for Spirit flower bombs. */
export const SPIRIT_EXPLOSION_RADIUS = 4.2;

const SHOOT_COOLDOWN_MS: Record<SnakeForm, number> = {
  dragon: 220,
  phoenix: 280,
  unicorn: 250,
  spirit: 320,
};

const BOT_DAMAGE_BY_FORM: Record<SnakeForm, number> = {
  dragon: 4,
  phoenix: 2,
  unicorn: 3,
  spirit: 3,
};

/** Shooting cooldown in milliseconds for the given magical form. */
export function shootCooldownForForm(form: SnakeForm, dragonRapidFire = false): number {
  const base = SHOOT_COOLDOWN_MS[form];
  return dragonRapidFire ? Math.round(base * 0.5) : base;
}

/** Spawn continuous-angle projectiles for the snake's current form and `heading`. */
export function spawnProjectilesForForm(state: GameState, eventId: number): readonly Projectile[] {
  const head = state.snake[0];
  if (!head) return [];

  const baseId = eventId * 100;
  const heading = state.heading;

  if (state.form === 'phoenix') {
    const offsets = [0, -0.28, 0.28];
    return offsets.map((off, idx) => {
      const a = normalizeAngle(heading + off);
      return {
        id: baseId + idx + 1,
        x: head.x,
        z: head.z,
        prevX: head.x,
        prevZ: head.z,
        dx: Math.cos(a),
        dz: Math.sin(a),
        form: 'phoenix',
        piercing: false,
        ttl: 18,
      };
    });
  }

  return [
    {
      id: baseId + 1,
      x: head.x,
      z: head.z,
      prevX: head.x,
      prevZ: head.z,
      dx: Math.cos(heading),
      dz: Math.sin(heading),
      form: state.form,
      piercing: state.form === 'unicorn',
      ttl: state.form === 'spirit' ? 10 : 24,
    },
  ];
}

/** Gently steer a Unicorn homing bolt toward the nearest nearby Bot or active Hazard. */
function steerUnicorn(
  p: Projectile,
  bots: readonly BotSnake[],
  hazards: readonly Hazard[],
): { dx: number; dz: number } {
  let targetPos: Vec2 | null = null;
  let bestDist = 14;

  for (const b of bots) {
    const vx = b.head.x - p.x;
    const vz = b.head.z - p.z;
    const dist = Math.hypot(vx, vz);
    if (dist < 0.2 || dist > bestDist) continue;
    const dot = (vx / dist) * p.dx + (vz / dist) * p.dz;
    if (dot < -0.2) continue;
    bestDist = dist;
    targetPos = b.head;
  }

  for (const h of hazards) {
    if (h.warningTicks > 0) continue;
    const vx = h.cell.x - p.x;
    const vz = h.cell.z - p.z;
    const dist = Math.hypot(vx, vz);
    if (dist < 0.2 || dist > bestDist) continue;
    const dot = (vx / dist) * p.dx + (vz / dist) * p.dz;
    if (dot < -0.2) continue;
    bestDist = dist;
    targetPos = h.cell;
  }

  if (!targetPos) {
    return { dx: p.dx, dz: p.dz };
  }

  const currentAngle = Math.atan2(p.dz, p.dx);
  const desiredAngle = Math.atan2(targetPos.z - p.z, targetPos.x - p.x);
  const turn = clamp(angleDiff(currentAngle, desiredAngle), -0.26, 0.26);
  const nextAngle = normalizeAngle(currentAngle + turn);
  return { dx: Math.cos(nextAngle), dz: Math.sin(nextAngle) };
}

function applyBotProjectileHit(
  state: GameState,
  botId: number,
  form: SnakeForm,
  hitPos: Vec2,
): GameState {
  const bot = state.bots.find((b) => b.id === botId);
  if (!bot) return state;

  const dmg = BOT_DAMAGE_BY_FORM[form];
  const remainingLevel = bot.level - dmg;

  if (remainingLevel <= 0) {
    return resolveBotDefeated(state, bot, hitPos);
  }

  const nextFrozen = form === 'phoenix' ? Math.max(bot.frozenTicks, 12) : bot.frozenTicks;
  const bots = state.bots.map((b) =>
    b.id === botId ? { ...b, level: remainingLevel, frozenTicks: nextFrozen } : b,
  );
  const points = 15;
  const ev = appendEvents(state.events, state.eventSeq, [
    {
      kind: 'bot_hit',
      cell: hitPos,
      form,
      points,
      messageVi: `Trúng ${bot.name}! Còn Lv.${remainingLevel} 💥`,
    },
  ]);
  const scored = applyScoreGain({
    score: state.score,
    best: state.best,
    level: state.level,
    points,
    events: ev.events,
    eventSeq: ev.eventSeq,
    cell: hitPos,
  });
  const board = computeLeaderboard({
    playerName: state.playerName,
    playerLevel: scored.level,
    bots,
    activeBossId: state.activeBossId,
  });

  return {
    ...state,
    bots,
    score: scored.score,
    best: scored.best,
    leaderboard: board.leaderboard,
    playerRank: board.playerRank,
    crownTarget: board.crownTarget,
    events: scored.events,
    eventSeq: scored.eventSeq,
  };
}

function applyHazardHit(state: GameState, hazardId: number, form: SnakeForm): GameState {
  const target = state.hazards.find((h) => h.id === hazardId && h.warningTicks === 0);
  if (!target) return state;

  let dmg = form === 'dragon' ? 2 : 1;
  let points = 20;
  let hintMessage: string | undefined;

  if (target.kind === 'element_gate' && target.requiredForm !== undefined) {
    if (target.requiredForm === form) {
      dmg = target.hp;
      points = 50;
    } else {
      dmg = 1;
      const needed = FORM_METADATA[target.requiredForm].nameVi;
      hintMessage = `Đổi sang ${needed} để phá Cổng ngay!`;
    }
  }

  const remainingHp = target.hp - dmg;
  if (remainingHp <= 0) {
    const hazards = state.hazards.filter((h) => h.id !== hazardId);
    const enemiesDefeated = state.enemiesDefeated + 1;
    const bossProgress = Math.min(100, state.bossProgress + 6);
    const destroyMsg =
      target.kind === 'element_gate' && target.requiredForm === form
        ? 'Phá Cổng Nguyên Tố! ✨'
        : undefined;
    const ev = appendEvents(state.events, state.eventSeq, [
      {
        kind: 'hazard_destroyed',
        cell: target.cell,
        form,
        points,
        messageVi: destroyMsg,
      },
    ]);
    const scored = applyScoreGain({
      score: state.score,
      best: state.best,
      level: state.level,
      points,
      events: ev.events,
      eventSeq: ev.eventSeq,
      cell: target.cell,
    });
    return {
      ...state,
      hazards,
      enemiesDefeated,
      bossProgress,
      score: scored.score,
      best: scored.best,
      events: scored.events,
      eventSeq: scored.eventSeq,
    };
  }

  const nextFrozen = form === 'phoenix' ? 16 : target.frozenTicks;
  const hazards = state.hazards.map((h) =>
    h.id === hazardId ? { ...h, hp: remainingHp, frozenTicks: nextFrozen } : h,
  );
  const ev = appendEvents(state.events, state.eventSeq, [
    {
      kind: 'hazard_hit',
      cell: target.cell,
      form,
      messageVi: hintMessage,
    },
  ]);
  return {
    ...state,
    hazards,
    events: ev.events,
    eventSeq: ev.eventSeq,
  };
}

function detonateSpirit(state: GameState, center: Cell): GameState {
  const affected: Hazard[] = [];
  const untouched: Hazard[] = [];

  for (const h of state.hazards) {
    if (h.warningTicks === 0 && euclideanDistance(h.cell, center) <= SPIRIT_EXPLOSION_RADIUS) {
      affected.push(h);
    } else {
      untouched.push(h);
    }
  }

  const surviving: Hazard[] = [];
  const drafts: EventDraft[] = [];
  let totalPoints = 0;
  let defeated = 0;

  for (const h of affected) {
    let dmg = 2;
    let pts = 20;
    if (h.kind === 'element_gate' && h.requiredForm !== undefined) {
      if (h.requiredForm === 'spirit') {
        dmg = h.hp;
        pts = 50;
      } else {
        dmg = 1;
      }
    }

    const hp = h.hp - dmg;
    if (hp <= 0) {
      defeated += 1;
      totalPoints += pts;
      drafts.push({
        kind: 'hazard_destroyed',
        cell: h.cell,
        form: 'spirit',
        points: pts,
      });
    } else {
      surviving.push({ ...h, hp });
      drafts.push({
        kind: 'hazard_hit',
        cell: h.cell,
        form: 'spirit',
      });
    }
  }

  let nextState: GameState = {
    ...state,
    hazards: [...untouched, ...surviving],
    enemiesDefeated: state.enemiesDefeated + defeated,
    bossProgress: Math.min(100, state.bossProgress + defeated * 6),
  };

  if (drafts.length > 0) {
    const ev = appendEvents(nextState.events, nextState.eventSeq, drafts);
    nextState = { ...nextState, events: ev.events, eventSeq: ev.eventSeq };
  }

  if (totalPoints > 0) {
    const scored = applyScoreGain({
      score: nextState.score,
      best: nextState.best,
      level: nextState.level,
      points: totalPoints,
      events: nextState.events,
      eventSeq: nextState.eventSeq,
      cell: center,
    });
    nextState = {
      ...nextState,
      score: scored.score,
      best: scored.best,
      events: scored.events,
      eventSeq: scored.eventSeq,
    };
  }

  // Also blast any bots within SPIRIT_EXPLOSION_RADIUS (4.2)
  const botsInBlast = nextState.bots.filter((b) =>
    b.spine.some((seg) => euclideanDistance(seg, center) <= SPIRIT_EXPLOSION_RADIUS),
  );
  for (const bot of botsInBlast) {
    nextState = applyBotProjectileHit(nextState, bot.id, 'spirit', center);
  }

  // Spirit bloom has a chance to sprout bonusFood nearby
  if (nextState.bonusFood === null) {
    const roll = nextFloat(nextState.rng);
    let rng = roll.next;
    const chance = defeated > 0 || botsInBlast.length > 0 ? 0.75 : 0.35;
    if (roll.value < chance) {
      const bound = Math.max(2, nextState.config.worldRadius - 2);
      const sampled = sampleWorldPos(nextState.config, rng, 2);
      rng = sampled.rng;
      const candidate: Vec2 = {
        x: Number(clamp(center.x + (sampled.pos.x % 2), -bound, bound).toFixed(2)),
        z: Number(clamp(center.z + (sampled.pos.z % 2), -bound, bound).toFixed(2)),
      };
      nextState = {
        ...nextState,
        bonusFood: candidate,
        bonusTicks: 120,
        rng,
      };
    } else {
      nextState = { ...nextState, rng };
    }
  }

  return nextState;
}

/** Advance all active projectiles by `1.15` units along their direction and decrement `shootCooldownMs`. */
export function stepProjectiles(state: GameState, dtMs = 55): GameState {
  const shootCooldownMs = Math.max(0, state.shootCooldownMs - Math.max(0, dtMs));

  if (state.projectiles.length === 0) {
    if (shootCooldownMs === state.shootCooldownMs && state.events.length === 0) {
      return state;
    }
    return { ...state, shootCooldownMs, events: [] };
  }

  let working: GameState = { ...state, shootCooldownMs, events: [] };
  const survivingProjectiles: Projectile[] = [];

  for (const p of state.projectiles) {
    const prevX = p.x;
    const prevZ = p.z;

    const steered =
      p.form === 'unicorn'
        ? steerUnicorn(p, working.bots, working.hazards)
        : { dx: p.dx, dz: p.dz };
    const nx = p.x + steered.dx * PROJECTILE_STEP_DIST;
    const nz = p.z + steered.dz * PROJECTILE_STEP_DIST;
    const ttl = p.ttl - 1;
    const prevPos: Vec2 = { x: prevX, z: prevZ };
    const nextPos: Vec2 = { x: nx, z: nz };

    if (hitsWall(nextPos, working.config, working.arenaMargin)) {
      if (p.form === 'spirit' && !hitsWall(prevPos, working.config, working.arenaMargin)) {
        working = detonateSpirit(working, prevPos);
      }
      continue;
    }

    // Check Bot hits (for piercing bolts, require entry from outside radius so 1 shot doesn't double-tap the same segment)
    const hitBot = working.bots.find((b) => {
      const r = botCollisionRadius(b.level, b.isBoss) * 0.95;
      const entered = b.spine.some((seg) => distancePointToSegment(seg, prevPos, nextPos) <= r);
      if (!entered) return false;
      if (!p.piercing) return true;
      return b.spine.every((seg) => euclideanDistance(seg, prevPos) > r);
    });
    if (hitBot) {
      if (p.form === 'spirit') {
        working = detonateSpirit(working, nextPos);
        continue;
      }
      working = applyBotProjectileHit(working, hitBot.id, p.form, nextPos);
      if (p.piercing && ttl > 0) {
        survivingProjectiles.push({
          ...p,
          x: nx,
          z: nz,
          prevX,
          prevZ,
          dx: steered.dx,
          dz: steered.dz,
          ttl,
        });
      }
      continue;
    }

    // Check Hazard hits
    const hitHazard = working.hazards.find((h) => {
      if (h.warningTicks !== 0) return false;
      if (distancePointToSegment(h.cell, prevPos, nextPos) > 1.05) return false;
      if (!p.piercing) return true;
      return euclideanDistance(h.cell, prevPos) > 1.05;
    });
    if (hitHazard) {
      if (p.form === 'spirit') {
        working = detonateSpirit(working, nextPos);
        continue;
      }
      working = applyHazardHit(working, hitHazard.id, p.form);
      if (p.piercing && ttl > 0) {
        survivingProjectiles.push({
          ...p,
          x: nx,
          z: nz,
          prevX,
          prevZ,
          dx: steered.dx,
          dz: steered.dz,
          ttl,
        });
      }
      continue;
    }

    // Check QuestOrb hits
    const hitOrb = working.quest?.orbs.find(
      (o) => !o.collected && distancePointToSegment(o.cell, prevPos, nextPos) <= 1.25,
    );
    if (hitOrb) {
      working = applyQuestOrbHit(working, hitOrb.id);
      continue;
    }

    if (ttl <= 0) {
      if (p.form === 'spirit') {
        working = detonateSpirit(working, nextPos);
      }
      continue;
    }

    survivingProjectiles.push({
      ...p,
      x: nx,
      z: nz,
      prevX,
      prevZ,
      dx: steered.dx,
      dz: steered.dz,
      ttl,
    });
  }

  return {
    ...working,
    projectiles: survivingProjectiles,
  };
}
