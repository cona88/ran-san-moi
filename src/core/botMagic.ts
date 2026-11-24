/**
 * "Thử Thách Sinh Tồn" — survival challenge.
 *
 * Active only for ageProfile === 'age9' AND difficulty === 'hard'. Bots telegraph then
 * shoot / cast projectiles at the player; the player has 10 hearts. Fully deterministic
 * (seeded `state.rng` only) and dodgeable: every projectile is slower than a dash.
 */
import { computeLeaderboard } from './bots';
import { nextFloat } from './rng';
import { appendEvents, type EventDraft } from './quests';
import { isInsideShelter } from './shelter';
import type {
  BotMagicKind,
  BotSnake,
  GameConfig,
  GameState,
  HostileProjectile,
  RngState,
} from './types';

export const SURVIVAL_HEARTS = 10;
export const BOT_MAGIC_RANGE = 26;
export const MAX_HOSTILE_PROJECTILES = 24;
/** Max bots telegraphing simultaneously (keeps volleys readable). */
export const MAX_CONCURRENT_WARNINGS = 4;
export const MAGIC_WARNING_TICKS = 9;
export const BOSS_MAGIC_WARNING_TICKS = 11;
export const MAGIC_HIT_RADIUS = 0.95;
export const MAGIC_INVULNERABLE_TICKS = 45;
export const FROST_SLOW_TICKS = 35;
export const FROST_SLOW_MULT = 0.8;

export interface MagicKindSpec {
  readonly speed: number;
  readonly ttl: number;
  readonly homingTurn: number;
}
export const MAGIC_SPECS: Readonly<Record<BotMagicKind, MagicKindSpec>> = {
  bolt: { speed: 0.55, ttl: 50, homingTurn: 0 },
  fire_spread: { speed: 0.46, ttl: 55, homingTurn: 0 },
  frost_orb: { speed: 0.4, ttl: 60, homingTurn: 0 },
  arcane_homing: { speed: 0.38, ttl: 90, homingTurn: 0.035 },
};

export function isSurvivalChallenge(state: Pick<GameState, 'ageProfile' | 'difficulty'>): boolean {
  return state.ageProfile === 'age9' && state.difficulty === 'hard';
}

/** Returns the config with 10 hearts when the challenge applies (otherwise `base`). */
export function applySurvivalConfig(
  base: GameConfig,
  state: Pick<GameState, 'ageProfile' | 'difficulty'>,
): GameConfig {
  return isSurvivalChallenge(state)
    ? { ...base, initialHearts: SURVIVAL_HEARTS, maxHearts: SURVIVAL_HEARTS }
    : base;
}

function pickSpell(bot: BotSnake, playerLevel: number, roll: number): BotMagicKind {
  if (bot.isBoss) {
    if (roll < 0.3) return 'bolt';
    if (roll < 0.6) return 'fire_spread';
    if (roll < 0.8) return 'arcane_homing';
    return 'frost_orb';
  }
  if (bot.level > playerLevel) return roll < 0.6 ? 'bolt' : 'frost_orb';
  return 'bolt';
}

function baseCooldown(bot: BotSnake): number {
  if (bot.isBoss) return 40;
  return 105 - Math.min(30, Math.floor(bot.level * 1.5));
}

function initialCooldown(bot: BotSnake): number {
  return 30 + ((bot.id * 7) % 40);
}

function inAnyShelter(pos: { x: number; z: number }, state: GameState): boolean {
  return state.shelters.some((s) => isInsideShelter(pos, s));
}

function normalizeDir(x: number, z: number): { dx: number; dz: number } {
  const d = Math.hypot(x, z);
  return d > 1e-6 ? { dx: x / d, dz: z / d } : { dx: 1, dz: 0 };
}

function rotateToward(
  dx: number,
  dz: number,
  tx: number,
  tz: number,
  maxTurn: number,
): { dx: number; dz: number } {
  const cur = Math.atan2(dz, dx);
  const want = Math.atan2(tz, tx);
  let diff = want - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const a = cur + Math.max(-maxTurn, Math.min(maxTurn, diff));
  return { dx: Math.cos(a), dz: Math.sin(a) };
}

/** Advance bot telegraphs, spell casting, hostile projectiles and player hits by one tick. */
export function stepBotMagic(state: GameState): GameState {
  if (!isSurvivalChallenge(state)) {
    return state.hostileProjectiles.length > 0 || state.playerSlowTicks > 0
      ? { ...state, hostileProjectiles: [], playerSlowTicks: 0 }
      : state;
  }
  const head = state.snake[0];
  if (head === undefined) return state;

  const drafts: EventDraft[] = [];
  const airborne =
    state.butterflyStage === 'cocoon' ||
    state.butterflyStage === 'butterfly' ||
    state.princessStage !== 'snake';
  let hearts = state.hearts;
  let invulnerableTicks = state.invulnerableTicks;
  let combo = state.combo;
  let slow = Math.max(0, state.playerSlowTicks - 1);
  let snakeKilledBy: string | null = null;

  // ---- 1. move projectiles + hit detection ----
  const survivors: HostileProjectile[] = [];
  const hitSegs = state.snake.slice(0, 3);
  for (const p of state.hostileProjectiles) {
    if (p.ttl <= 1) continue;
    const spec = MAGIC_SPECS[p.kind];
    let dx = p.dx;
    let dz = p.dz;
    if (spec.homingTurn > 0 && !state.inShelter && !airborne) {
      const toX = head.x - p.x;
      const toZ = head.z - p.z;
      if (Math.hypot(toX, toZ) > 3) {
        const r = rotateToward(dx, dz, toX, toZ, spec.homingTurn);
        dx = r.dx;
        dz = r.dz;
      }
    }
    const nx = p.x + dx * spec.speed;
    const nz = p.z + dz * spec.speed;
    const pos = { x: nx, z: nz };
    if (inAnyShelter(pos, state)) continue;
    if (Math.abs(nx) > state.config.worldRadius || Math.abs(nz) > state.config.worldRadius)
      continue;
    const moved: HostileProjectile = {
      ...p,
      prevX: p.x,
      prevZ: p.z,
      x: nx,
      z: nz,
      dx,
      dz,
      ttl: p.ttl - 1,
    };
    const touching =
      !state.inShelter &&
      !airborne &&
      hitSegs.some((s) => Math.hypot(s.x - nx, s.z - nz) < MAGIC_HIT_RADIUS);
    if (!touching || snakeKilledBy !== null) {
      survivors.push(moved);
      continue;
    }
    // Contact with the player.
    if (state.shieldTicks > 0 || state.boosters.speed.activeTicks > 0) {
      drafts.push({
        kind: 'shield_block',
        cell: pos,
        spell: p.kind,
        messageVi: 'Khiên đã chặn phép thuật! 🛡️',
      });
      continue;
    }
    if (invulnerableTicks > 0) {
      survivors.push(moved); // grace period: harmless pass-through
      continue;
    }
    drafts.push({ kind: 'player_hit_by_magic', cell: head, spell: p.kind });
    if (p.kind === 'frost_orb') slow = FROST_SLOW_TICKS;
    combo = 0;
    if (hearts > 1) {
      hearts -= 1;
      invulnerableTicks = MAGIC_INVULNERABLE_TICKS;
      drafts.push({
        kind: 'heart_lost',
        cell: head,
        spell: p.kind,
        messageVi: `Trúng phép thuật! Bé còn ${hearts} tim 💖`,
      });
    } else {
      hearts = 0;
      const owner = state.bots.find((b) => b.id === p.ownerBotId);
      snakeKilledBy = owner ? `${owner.name} (Lv.${owner.level})` : 'Rắn phép thuật';
    }
  }

  if (snakeKilledBy !== null) {
    drafts.push({
      kind: 'gameover',
      cell: head,
      messageVi: `Bị ${snakeKilledBy} bắn trúng rồi! Thử lại nhé ✨`,
    });
    const ev = appendEvents(state.events, state.eventSeq, drafts);
    const board = computeLeaderboard({
      playerName: state.playerName,
      playerLevel: state.level,
      bots: state.bots,
      activeBossId: state.activeBossId,
    });
    return {
      ...state,
      hearts: 0,
      combo: 0,
      isDashing: false,
      eatenByBotName: snakeKilledBy,
      phase: 'gameover',
      won: false,
      hostileProjectiles: [],
      playerSlowTicks: 0,
      leaderboard: board.leaderboard,
      playerRank: board.playerRank,
      crownTarget: board.crownTarget,
      events: ev.events,
      eventSeq: ev.eventSeq,
    };
  }

  // ---- 2. bots: cooldown → telegraph → cast ----
  let rng: RngState = state.rng;
  const spawned: HostileProjectile[] = [];
  let warningCount = state.bots.reduce((n, b) => n + ((b.magicWarningTicks ?? 0) > 0 ? 1 : 0), 0);
  let idCounter = 0;
  const playerTargetable = !state.inShelter && !airborne;
  const bots = state.bots.map((bot): BotSnake => {
    const cd = bot.magicCooldownTicks ?? initialCooldown(bot);
    const warn = bot.magicWarningTicks ?? 0;
    const dist = Math.hypot(bot.head.x - head.x, bot.head.z - head.z);
    const eligible =
      playerTargetable &&
      bot.frozenTicks <= 0 &&
      dist <= BOT_MAGIC_RANGE &&
      !inAnyShelter(bot.head, state);

    if (warn > 0) {
      if (!eligible) {
        warningCount -= 1;
        return { ...bot, magicWarningTicks: 0, magicCooldownTicks: 20 };
      }
      if (warn > 1) return { ...bot, magicWarningTicks: warn - 1, magicCooldownTicks: cd };
      // cast now
      warningCount -= 1;
      const spell = bot.magicSpell ?? 'bolt';
      const aim = normalizeDir(head.x - bot.head.x, head.z - bot.head.z);
      const baseAngle = Math.atan2(aim.dz, aim.dx);
      const offsets =
        spell === 'fire_spread' ? (bot.isBoss ? [-0.5, -0.25, 0, 0.25, 0.5] : [-0.3, 0, 0.3]) : [0];
      const spec = MAGIC_SPECS[spell];
      const muzzle = { x: bot.head.x + aim.dx * 1.2, z: bot.head.z + aim.dz * 1.2 };
      let any = false;
      for (const off of offsets) {
        if (survivors.length + spawned.length >= MAX_HOSTILE_PROJECTILES) break;
        const a = baseAngle + off;
        spawned.push({
          id: state.elapsedTicks * 64 + idCounter++,
          x: muzzle.x,
          z: muzzle.z,
          prevX: muzzle.x,
          prevZ: muzzle.z,
          dx: Math.cos(a),
          dz: Math.sin(a),
          kind: spell,
          ownerBotId: bot.id,
          ttl: spec.ttl,
          maxTtl: spec.ttl,
        });
        any = true;
      }
      const j = nextFloat(rng);
      rng = j.next;
      const cooldown = baseCooldown(bot) + Math.floor(j.value * 25);
      if (any) {
        drafts.push(
          spell === 'bolt'
            ? { kind: 'bot_shoot', cell: muzzle, spell }
            : { kind: 'bot_spell_cast', cell: bot.head, spell },
        );
      }
      return { ...bot, magicWarningTicks: 0, magicCooldownTicks: cooldown };
    }

    if (cd > 1) return { ...bot, magicCooldownTicks: cd - 1, magicWarningTicks: 0 };
    if (
      !eligible ||
      warningCount >= MAX_CONCURRENT_WARNINGS ||
      survivors.length + spawned.length >= MAX_HOSTILE_PROJECTILES
    ) {
      return bot.magicCooldownTicks === 0 ? bot : { ...bot, magicCooldownTicks: 0 };
    }
    const r = nextFloat(rng);
    rng = r.next;
    warningCount += 1;
    return {
      ...bot,
      magicSpell: pickSpell(bot, state.level, r.value),
      magicWarningTicks: bot.isBoss ? BOSS_MAGIC_WARNING_TICKS : MAGIC_WARNING_TICKS,
      magicCooldownTicks: 0,
    };
  });

  const ev = appendEvents(state.events, state.eventSeq, drafts);
  return {
    ...state,
    bots,
    rng,
    hearts,
    combo,
    invulnerableTicks,
    playerSlowTicks: slow,
    hostileProjectiles: [...survivors, ...spawned],
    events: ev.events,
    eventSeq: ev.eventSeq,
  };
}
