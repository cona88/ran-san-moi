import type {
  BotSnake,
  Cell,
  GameState,
  Hazard,
  Projectile,
  SilkWebZone,
  SnakeForm,
  Vec2,
} from './types';
import { FORM_METADATA, sprayKindForForm } from './config';
import { nextFloat } from './rng';
import { angleDiff, clamp, euclideanDistance, normalizeAngle } from './systems/arena';
import { distancePointToSegment, hitsWall } from './systems/collision';
import { sampleWorldPos } from './systems/food';
import { appendEvents, applyQuestOrbHit, applyScoreGain, type EventDraft } from './quests';
import { botCollisionRadius, computeLeaderboard, resolveBotDefeated } from './bots';

/** Continuous projectile travel distance per `projectile_step`. */
export const PROJECTILE_STEP_DIST = 1.15;
/** AoE blast radius for Spirit silk web / flower bombs. */
export const SPIRIT_EXPLOSION_RADIUS = 4.2;
/** Duration in simulation ticks that the elemental spray stream remains visibly active after shooting. */
export const SPRAY_ACTIVE_TICKS = 7;
/** Lifetime in simulation ticks of a persistent SilkWebZone created by Spirit silk spray. */
export const SILK_WEB_DURATION_TICKS = 90;
/** Maximum number of active SilkWebZone areas retained at once. */
export const MAX_SILK_WEBS = 10;

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

/** Spawn continuous-angle elemental spray streams for the snake's current form and `heading`. */
export function spawnProjectilesForForm(state: GameState, eventId: number): readonly Projectile[] {
  const head = state.snake[0];
  if (!head) return [];

  const baseId = eventId * 100;
  const heading = state.heading;
  const sprayKind = sprayKindForForm(state.form);

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
        sprayKind,
        piercing: false,
        ttl: 18,
        maxTtl: 18,
        hitBotIds: undefined,
      };
    });
  }

  const maxTtl = state.form === 'spirit' ? 10 : 24;
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
      sprayKind,
      piercing: state.form === 'unicorn',
      ttl: maxTtl,
      maxTtl,
      hitBotIds: state.form === 'unicorn' ? [] : undefined,
    },
  ];
}

/** Gently steer a Unicorn water stream toward the nearest unhit Bot or active Hazard. */
function steerUnicorn(
  p: Projectile,
  bots: readonly BotSnake[],
  hazards: readonly Hazard[],
): { dx: number; dz: number } {
  let targetPos: Vec2 | null = null;
  let bestDist = 14;
  const alreadyHit = p.hitBotIds ? new Set(p.hitBotIds) : null;

  for (const b of bots) {
    if (alreadyHit?.has(b.id)) continue;
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

/** Push a bot's head and every spine segment along `(dx, dz)` by `pushDist`, clamped within arena bounds. */
export function pushBotAlongSpray(
  bot: BotSnake,
  dx: number,
  dz: number,
  pushDist: number,
  worldRadius: number,
): BotSnake {
  const len = Math.hypot(dx, dz);
  if (len <= 1e-6 || pushDist <= 0) {
    return bot;
  }
  const bound = Math.max(2, worldRadius - 1.2);
  const shiftX = (dx / len) * pushDist;
  const shiftZ = (dz / len) * pushDist;
  const shiftPoint = (p: Vec2): Vec2 => ({
    x: clamp(p.x + shiftX, -bound, bound),
    z: clamp(p.z + shiftZ, -bound, bound),
  });

  return {
    ...bot,
    head: shiftPoint(bot.head),
    prevHead: bot.head,
    spine: bot.spine.map(shiftPoint),
    prevSpine: bot.spine,
  };
}

function applyBotProjectileHit(
  state: GameState,
  botId: number,
  form: SnakeForm,
  hitPos: Vec2,
  sprayDx = 0,
  sprayDz = 0,
): GameState {
  const bot = state.bots.find((b) => b.id === botId);
  if (!bot) return state;

  const dmg = BOT_DAMAGE_BY_FORM[form];
  const remainingLevel = bot.level - dmg;

  if (remainingLevel <= 0) {
    return resolveBotDefeated(state, { ...bot, level: bot.maxLevel ?? bot.level }, hitPos);
  }

  let updatedBot: BotSnake;
  let messageVi: string;

  switch (form) {
    case 'dragon': {
      const pushed = pushBotAlongSpray(bot, sprayDx, sprayDz, 0.85, state.config.worldRadius);
      updatedBot = {
        ...pushed,
        level: remainingLevel,
        chompedTicks: Math.max(bot.chompedTicks ?? 0, 12),
      };
      messageVi = `🔥 Thiêu ${bot.name}! Còn Lv.${remainingLevel}`;
      break;
    }
    case 'phoenix': {
      updatedBot = {
        ...bot,
        level: remainingLevel,
        frozenTicks: Math.max(bot.frozenTicks, 24),
      };
      messageVi = `❄️ Đóng băng ${bot.name}! Còn Lv.${remainingLevel}`;
      break;
    }
    case 'unicorn': {
      const pushed = pushBotAlongSpray(bot, sprayDx, sprayDz, 1.15, state.config.worldRadius);
      updatedBot = {
        ...pushed,
        level: remainingLevel,
        chompedTicks: Math.max(bot.chompedTicks ?? 0, 14),
      };
      messageVi = `🌊 Xối nước ${bot.name}! Còn Lv.${remainingLevel}`;
      break;
    }
    case 'spirit': {
      updatedBot = {
        ...bot,
        level: remainingLevel,
        frozenTicks: Math.max(bot.frozenTicks, 26),
        chompedTicks: Math.max(bot.chompedTicks ?? 0, 16),
      };
      messageVi = `🕸️ Trói tơ ${bot.name}! Còn Lv.${remainingLevel}`;
      break;
    }
  }

  const bots = state.bots.map((b) => (b.id === botId ? updatedBot : b));
  const points = 15;
  const ev = appendEvents(state.events, state.eventSeq, [
    {
      kind: 'bot_hit',
      cell: hitPos,
      form,
      points,
      messageVi,
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

  const nextFrozen =
    form === 'phoenix' || form === 'spirit' ? Math.max(target.frozenTicks, 24) : target.frozenTicks;
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
      surviving.push({ ...h, hp, frozenTicks: Math.max(h.frozenTicks, 24) });
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
    nextState = applyBotProjectileHit(nextState, bot.id, 'spirit', center, 0, 0);
  }

  // Leave a persistent sticky silk web zone at `center` (capped to newest MAX_SILK_WEBS)
  const nextWebId = Math.max(0, ...nextState.silkWebs.map((w) => w.id)) + 1;
  const newWeb: SilkWebZone = {
    id: nextWebId,
    x: center.x,
    z: center.z,
    radius: SPIRIT_EXPLOSION_RADIUS,
    ticksRemaining: SILK_WEB_DURATION_TICKS,
    maxTicks: SILK_WEB_DURATION_TICKS,
  };
  nextState = {
    ...nextState,
    silkWebs: [...nextState.silkWebs, newWeb].slice(-MAX_SILK_WEBS),
  };

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

/**
 * Advance persistent silk web zones: decrement `ticksRemaining` (dropping expired webs `<= 0`)
 * and apply sticky silk slow (`chompedTicks >= 8`) to bots whose head is inside a web.
 */
export function stepSilkWebs(state: GameState): GameState {
  if (state.silkWebs.length === 0) return state;

  const nextWebs = state.silkWebs
    .map((w) => ({ ...w, ticksRemaining: w.ticksRemaining - 1 }))
    .filter((w) => w.ticksRemaining > 0);

  if (nextWebs.length === 0 || state.bots.length === 0) {
    return { ...state, silkWebs: nextWebs };
  }

  let botsChanged = false;
  const nextBots = state.bots.map((bot) => {
    const insideWeb = nextWebs.some(
      (web) => Math.hypot(bot.head.x - web.x, bot.head.z - web.z) <= web.radius,
    );
    if (!insideWeb) return bot;
    const nextChomped = Math.max(bot.chompedTicks ?? 0, 8);
    if (nextChomped === bot.chompedTicks) return bot;
    botsChanged = true;
    return { ...bot, chompedTicks: nextChomped };
  });

  return {
    ...state,
    silkWebs: nextWebs,
    bots: botsChanged ? nextBots : state.bots,
  };
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

    // Check Bot hits (for piercing water streams, skip bots already recorded in `hitBotIds` so knockback never double-hits)
    const hitBot = working.bots.find((b) => {
      if (p.piercing && (p.hitBotIds?.includes(b.id) ?? false)) return false;
      const r = botCollisionRadius(b.level, b.isBoss) * 0.95;
      return b.spine.some((seg) => distancePointToSegment(seg, prevPos, nextPos) <= r);
    });
    if (hitBot) {
      if (p.form === 'spirit') {
        working = detonateSpirit(working, nextPos);
        continue;
      }
      working = applyBotProjectileHit(working, hitBot.id, p.form, nextPos, steered.dx, steered.dz);
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
          hitBotIds: [...(p.hitBotIds ?? []), hitBot.id],
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
    const questHitRadius = state.ageProfile === 'age6' ? 1.45 : 1.2;
    const hitOrb = working.quest?.orbs.find(
      (o) => !o.collected && distancePointToSegment(o.cell, prevPos, nextPos) <= questHitRadius,
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
