import {
  SNAKE_FORMS,
  type BrainQuest,
  type Cell,
  type Direction,
  type GameConfig,
  type GameMode,
  type Hazard,
  type HazardKind,
  type RngState,
} from './types';
import { delta, perpendicularDirections } from './direction';
import { nextFloat, nextInt } from './rng';
import { clamp, euclideanDistance, innerBounds } from './systems/arena';
import { hitsBody, hitsWall } from './systems/collision';
import { collectOccupiedCells } from './systems/food';

const CARDINAL_STEPS: readonly Cell[] = [
  { x: 0, z: -1 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
  { x: 1, z: 0 },
];

/** Maximum simultaneous hazards permitted for the current mode and level. */
export function maxHazardsFor(mode: GameMode, level: number): number {
  switch (mode) {
    case 'cozy':
      return 2;
    case 'adventure':
      return Math.min(6, 2 + Math.floor(level / 3));
    case 'reflex':
      return Math.min(8, 3 + Math.floor(level / 3));
  }
}

function hazardSpawnChance(mode: GameMode, score: number): number {
  switch (mode) {
    case 'cozy':
      return 0.008;
    case 'adventure':
      return score > 0 ? 0.02 : 0.012;
    case 'reflex':
      return score > 0 ? 0.032 : 0.02;
  }
}

function pickHazardKind(mode: GameMode, rng: RngState): { kind: HazardKind; rng: RngState } {
  const { value, next } = nextFloat(rng);
  if (mode === 'cozy') {
    return { kind: value < 0.5 ? 'slime' : 'crystal', rng: next };
  }
  if (mode === 'reflex') {
    if (value < 0.5) return { kind: 'meteor', rng: next };
    if (value < 0.85) return { kind: 'slime', rng: next };
    return { kind: 'crystal', rng: next };
  }
  if (value < 0.3) return { kind: 'slime', rng: next };
  if (value < 0.55) return { kind: 'crystal', rng: next };
  if (value < 0.8) return { kind: 'meteor', rng: next };
  return { kind: 'element_gate', rng: next };
}

/** Create a deterministic hazard instance at `cell`. */
export function createHazard(
  kind: HazardKind,
  cell: Cell,
  rng: RngState,
  mode: GameMode,
): { hazard: Hazard; rng: RngState } {
  const idDraw = nextInt(rng, 0x3fffffff);
  const id = idDraw.value + 1;
  let nextRng = idDraw.next;

  if (kind === 'element_gate') {
    const formDraw = nextInt(nextRng, SNAKE_FORMS.length);
    nextRng = formDraw.next;
    const requiredForm = SNAKE_FORMS[formDraw.value] ?? 'dragon';
    return {
      hazard: {
        id,
        cell,
        prevCell: cell,
        kind,
        hp: 3,
        maxHp: 3,
        requiredForm,
        frozenTicks: 0,
        warningTicks: 0,
      },
      rng: nextRng,
    };
  }

  if (kind === 'crystal') {
    return {
      hazard: {
        id,
        cell,
        prevCell: cell,
        kind,
        hp: 3,
        maxHp: 3,
        frozenTicks: 0,
        warningTicks: 0,
      },
      rng: nextRng,
    };
  }

  if (kind === 'meteor') {
    return {
      hazard: {
        id,
        cell,
        prevCell: cell,
        kind,
        hp: 2,
        maxHp: 2,
        frozenTicks: 0,
        warningTicks: mode === 'reflex' ? 12 : 16,
      },
      rng: nextRng,
    };
  }

  return {
    hazard: {
      id,
      cell,
      prevCell: cell,
      kind: 'slime',
      hp: 2,
      maxHp: 2,
      frozenTicks: 0,
      warningTicks: 0,
    },
    rng: nextRng,
  };
}

/** Advance all active hazards by one tick (warning countdown, freeze thaw, slime patrol). */
export function stepHazards(params: {
  readonly hazards: readonly Hazard[];
  readonly config: GameConfig;
  readonly margin: number;
  readonly snake: readonly Cell[];
  readonly food: Cell;
  readonly bonusFood: Cell | null;
  readonly quest: BrainQuest | null;
  readonly mode: GameMode;
  readonly rng: RngState;
}): { hazards: Hazard[]; rng: RngState } {
  if (params.hazards.length === 0) {
    return { hazards: [], rng: params.rng };
  }

  const { lo, hi } = innerBounds(params.config, params.margin);
  const head = params.snake[0];
  const occupied = collectOccupiedCells({
    snake: params.snake,
    food: params.food,
    bonusFood: params.bonusFood,
    hazards: params.hazards,
    quest: params.quest,
  });

  const moveProb = params.mode === 'reflex' ? 0.65 : params.mode === 'cozy' ? 0.25 : 0.45;
  const patrolStep = 0.35;
  let rng = params.rng;
  const nextHazards: Hazard[] = [];

  for (const h of params.hazards) {
    // Prune hazards far away from the player in large open worlds so nearby encounters stay fresh
    if (head && params.config.worldRadius >= 30 && euclideanDistance(h.cell, head) > 42) {
      continue;
    }

    if (h.warningTicks > 0) {
      nextHazards.push({
        ...h,
        prevCell: h.cell,
        warningTicks: h.warningTicks - 1,
      });
      continue;
    }

    if (h.frozenTicks > 0) {
      nextHazards.push({
        ...h,
        prevCell: h.cell,
        frozenTicks: h.frozenTicks - 1,
      });
      continue;
    }

    if (h.kind !== 'slime') {
      nextHazards.push({ ...h, prevCell: h.cell });
      continue;
    }

    const roll = nextFloat(rng);
    rng = roll.next;
    if (roll.value >= moveProb) {
      nextHazards.push({ ...h, prevCell: h.cell });
      continue;
    }

    const neighbors: Cell[] = [];
    for (const step of CARDINAL_STEPS) {
      const nx = Number((h.cell.x + step.x * patrolStep).toFixed(2));
      const nz = Number((h.cell.z + step.z * patrolStep).toFixed(2));
      if (nx < lo || nx > hi || nz < lo || nz > hi) continue;
      const blocked = occupied.some(
        (c) =>
          (Math.abs(c.x - h.cell.x) > 0.05 || Math.abs(c.z - h.cell.z) > 0.05) &&
          Math.hypot(c.x - nx, c.z - nz) < 0.75,
      );
      if (!blocked) {
        neighbors.push({ x: nx, z: nz });
      }
    }

    if (neighbors.length === 0) {
      nextHazards.push({ ...h, prevCell: h.cell });
      continue;
    }

    const pick = nextInt(rng, neighbors.length);
    rng = pick.next;
    const nextCell = neighbors[pick.value];
    if (!nextCell) {
      nextHazards.push({ ...h, prevCell: h.cell });
      continue;
    }

    nextHazards.push({
      ...h,
      prevCell: h.cell,
      cell: nextCell,
    });
  }

  return { hazards: nextHazards, rng };
}

/** Attempt to spawn a new hazard in the active ring around the player's head. */
export function maybeSpawnHazard(params: {
  readonly hazards: readonly Hazard[];
  readonly config: GameConfig;
  readonly margin: number;
  readonly snake: readonly Cell[];
  readonly food: Cell;
  readonly bonusFood: Cell | null;
  readonly quest: BrainQuest | null;
  readonly mode: GameMode;
  readonly level: number;
  readonly score: number;
  readonly rng: RngState;
}): { hazards: readonly Hazard[]; rng: RngState } {
  if (params.hazards.length >= maxHazardsFor(params.mode, params.level)) {
    return { hazards: params.hazards, rng: params.rng };
  }

  const roll = nextFloat(params.rng);
  let rng = roll.next;
  if (roll.value >= hazardSpawnChance(params.mode, params.score)) {
    return { hazards: params.hazards, rng };
  }

  const head = params.snake[0];
  if (!head) return { hazards: params.hazards, rng };

  const { lo, hi } = innerBounds(params.config, params.margin);
  if (hi - lo < 4) return { hazards: params.hazards, rng };

  let candidate: Cell | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const aDraw = nextFloat(rng);
    const rDraw = nextFloat(aDraw.next);
    rng = rDraw.next;
    const angle = aDraw.value * Math.PI * 2;
    const radius = 8 + rDraw.value * 16;
    const x = Number(clamp(head.x + Math.cos(angle) * radius, lo, hi).toFixed(2));
    const z = Number(clamp(head.z + Math.sin(angle) * radius, lo, hi).toFixed(2));
    if (Math.hypot(x - head.x, z - head.z) < 5) continue;
    const tooCloseToOther = params.hazards.some(
      (h) => Math.hypot(h.cell.x - x, h.cell.z - z) < 2.2,
    );
    if (!tooCloseToOther) {
      candidate = { x, z };
      break;
    }
  }

  if (!candidate) {
    return { hazards: params.hazards, rng };
  }

  const kindPick = pickHazardKind(params.mode, rng);
  rng = kindPick.rng;
  const created = createHazard(kindPick.kind, candidate, rng, params.mode);
  return {
    hazards: [...params.hazards, created.hazard],
    rng: created.rng,
  };
}

/**
 * Pick a safe direction (preferring perpendicular turns inside walls) when the snake
 * survives an impact, preventing consecutive trap deaths.
 */
export function pickSafeDirection(
  snake: readonly Cell[],
  currentDirection: Direction,
  config: GameConfig,
  margin: number,
  hazards: readonly Hazard[],
): Direction {
  const head = snake[0];
  if (!head) return currentDirection;

  const perps = perpendicularDirections(currentDirection);
  const allDirs: readonly Direction[] = ['up', 'down', 'left', 'right'];
  const nonOpposite = allDirs.filter((d) => {
    const step = delta(d);
    const cur = delta(currentDirection);
    return !(step.x === -cur.x && step.z === -cur.z);
  });

  const nextCellFor = (dir: Direction): Cell => {
    const d = delta(dir);
    return { x: head.x + d.x, z: head.z + d.z };
  };

  const isInside = (cell: Cell): boolean => config.wrapWalls || !hitsWall(cell, config, margin);
  const bodyWithoutTail = snake.slice(0, -1);
  const hasActiveHazard = (cell: Cell): boolean =>
    hazards.some(
      (h) => h.warningTicks === 0 && Math.hypot(h.cell.x - cell.x, h.cell.z - cell.z) < 0.8,
    );

  for (const dir of perps) {
    const c = nextCellFor(dir);
    if (isInside(c) && !hitsBody(c, bodyWithoutTail) && !hasActiveHazard(c)) return dir;
  }
  for (const dir of perps) {
    const c = nextCellFor(dir);
    if (isInside(c) && !hitsBody(c, bodyWithoutTail)) return dir;
  }
  for (const dir of perps) {
    const c = nextCellFor(dir);
    if (isInside(c)) return dir;
  }
  for (const dir of nonOpposite) {
    const c = nextCellFor(dir);
    if (isInside(c) && !hitsBody(c, bodyWithoutTail) && !hasActiveHazard(c)) return dir;
  }
  for (const dir of allDirs) {
    const c = nextCellFor(dir);
    if (isInside(c)) return dir;
  }
  return currentDirection;
}
