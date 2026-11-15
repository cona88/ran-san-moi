import type {
  BotSnake,
  BrainQuest,
  Cell,
  GameConfig,
  Hazard,
  RngState,
  Vec2,
  WorldOrb,
} from '../types';
import { nextFloat, nextInt } from '../rng';
import { clamp, innerBounds } from './arena';

/** Golden palette for regular open-world energy orbs. */
export const WORLD_ORB_COLORS: readonly number[] = [0xffd43b, 0xffc024, 0xffe066, 0xffaa2b];

/** Vibrant jewel palette for loot orbs dropped by defeated bots. */
export const LOOT_ORB_COLORS: readonly number[] = [0xff6be0, 0x4ff5ff, 0xffe65c, 0x7bff8f];

/**
 * Every integer spawnable point inside `innerBounds` not currently occupied.
 *
 * Primarily used by grid-based helper tests and small arenas.
 */
export function freeCells(
  config: GameConfig,
  margin: number,
  occupiedCells: readonly Cell[],
): Cell[] {
  const { lo, hi } = innerBounds(config, margin);
  const occupied = new Set(occupiedCells.map((s) => `${Math.round(s.x)},${Math.round(s.z)}`));
  const cells: Cell[] = [];
  for (let x = Math.ceil(lo); x <= Math.floor(hi); x++) {
    for (let z = Math.ceil(lo); z <= Math.floor(hi); z++) {
      if (!occupied.has(`${x},${z}`)) {
        cells.push({ x, z });
      }
    }
  }
  return cells;
}

/** Collect all currently occupied board coordinates. */
export function collectOccupiedCells(params: {
  readonly snake: readonly Cell[];
  readonly food?: Cell | null;
  readonly bonusFood?: Cell | null;
  readonly hazards?: readonly Hazard[];
  readonly quest?: BrainQuest | null;
}): Cell[] {
  const cells: Cell[] = [...params.snake];
  if (params.food) cells.push(params.food);
  if (params.bonusFood) cells.push(params.bonusFood);
  if (params.hazards) {
    for (const h of params.hazards) cells.push(h.cell);
  }
  if (params.quest) {
    for (const o of params.quest.orbs) {
      if (!o.collected) cells.push(o.cell);
    }
  }
  return cells;
}

/** Pick a uniformly random free cell, returning it with the advanced RNG. */
export function pickFood(cells: readonly Cell[], rng: RngState): { food: Cell; rng: RngState } {
  const { value, next } = nextInt(rng, cells.length);
  const food = cells[value];
  if (food === undefined) {
    throw new Error('pickFood called with no free cells');
  }
  return { food, rng: next };
}

/** Safely pick a random free cell, returning `null` if none are available. */
export function pickOptionalCell(
  cells: readonly Cell[],
  rng: RngState,
): { cell: Cell | null; rng: RngState } {
  if (cells.length === 0) {
    return { cell: null, rng };
  }
  const { food, rng: next } = pickFood(cells, rng);
  return { cell: food, rng: next };
}

/** Sample a continuous 2D point safely inside `[-worldRadius + pad, +worldRadius - pad]`. */
export function sampleWorldPos(
  config: GameConfig,
  rng: RngState,
  pad = 2,
): { pos: Vec2; rng: RngState } {
  const bound = Math.max(2, config.worldRadius - pad);
  const rx = nextFloat(rng);
  const rz = nextFloat(rx.next);
  const x = Number(((rx.value * 2 - 1) * bound).toFixed(2));
  const z = Number(((rz.value * 2 - 1) * bound).toFixed(2));
  return { pos: { x, z }, rng: rz.next };
}

/** Top up world orbs until `config.orbTargetCount` is reached. */
export function replenishWorldOrbs(params: {
  readonly orbs: readonly WorldOrb[];
  readonly config: GameConfig;
  readonly playerHead: Vec2;
  readonly minHeadDist?: number;
  readonly rng: RngState;
}): { orbs: WorldOrb[]; rng: RngState } {
  const target = params.config.orbTargetCount;
  if (params.orbs.length >= target) {
    return { orbs: [...params.orbs], rng: params.rng };
  }

  let rng = params.rng;
  let nextId = params.orbs.reduce((m, o) => (o.id > m ? o.id : m), 0) + 1;
  const result: WorldOrb[] = [...params.orbs];
  const minDist = params.minHeadDist ?? 3.0;
  const minDistSq = minDist * minDist;

  while (result.length < target) {
    let chosen: Vec2 = { x: 0, z: 0 };
    for (let attempt = 0; attempt < 8; attempt++) {
      const sampled = sampleWorldPos(params.config, rng, 2.2);
      rng = sampled.rng;
      chosen = sampled.pos;
      const dx = chosen.x - params.playerHead.x;
      const dz = chosen.z - params.playerHead.z;
      if (dx * dx + dz * dz >= minDistSq) break;
    }

    const cDraw = nextInt(rng, WORLD_ORB_COLORS.length);
    rng = cDraw.next;
    const colorHex = WORLD_ORB_COLORS[cDraw.value] ?? 0xffd43b;

    result.push({
      id: nextId++,
      x: chosen.x,
      z: chosen.z,
      value: 1,
      colorHex,
      isLoot: false,
    });
  }

  return { orbs: result, rng };
}

/** Scatter larger high-value loot orbs along a defeated bot's spine. */
export function scatterLootOrbs(params: {
  readonly orbs: readonly WorldOrb[];
  readonly spine: readonly Vec2[];
  readonly count: number;
  readonly value?: number;
  readonly config: GameConfig;
  readonly rng: RngState;
}): { orbs: WorldOrb[]; rng: RngState } {
  if (params.spine.length === 0 || params.count <= 0) {
    return { orbs: [...params.orbs], rng: params.rng };
  }

  let rng = params.rng;
  let nextId = params.orbs.reduce((m, o) => (o.id > m ? o.id : m), 0) + 1;
  const result: WorldOrb[] = [...params.orbs];
  const bound = Math.max(1, params.config.worldRadius - 1.5);
  const orbValue = params.value ?? 3;

  for (let i = 0; i < params.count; i++) {
    const segIdx = Math.min(
      params.spine.length - 1,
      Math.floor((i * params.spine.length) / Math.max(1, params.count)),
    );
    const seg = params.spine[segIdx] ?? params.spine[0]!;
    const jx = nextFloat(rng);
    const jz = nextFloat(jx.next);
    const cd = nextInt(jz.next, LOOT_ORB_COLORS.length);
    rng = cd.next;

    const x = Number(clamp(seg.x + (jx.value - 0.5) * 1.4, -bound, bound).toFixed(2));
    const z = Number(clamp(seg.z + (jz.value - 0.5) * 1.4, -bound, bound).toFixed(2));

    result.push({
      id: nextId++,
      x,
      z,
      value: orbValue,
      colorHex: LOOT_ORB_COLORS[cd.value] ?? 0xff6be0,
      isLoot: true,
    });
  }

  return { orbs: result, rng };
}

/** Pick the nearest orb position to `pos` for compatibility `state.food` tracking. */
export function nearestOrbPos(
  orbs: readonly WorldOrb[],
  pos: Vec2,
  bots: readonly BotSnake[] = [],
): Vec2 {
  if (orbs.length > 0) {
    let best = orbs[0]!;
    let bestSq = Infinity;
    for (const o of orbs) {
      const dx = o.x - pos.x;
      const dz = o.z - pos.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestSq) {
        bestSq = dSq;
        best = o;
      }
    }
    return { x: best.x, z: best.z };
  }
  if (bots.length > 0) {
    return bots[0]!.head;
  }
  return { x: 0, z: 0 };
}
