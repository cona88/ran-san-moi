import { describe, expect, it } from 'vitest';
import type { Direction, GameState } from '../../src/core/types';
import { DEFAULT_CONFIG } from '../../src/core/config';
import { createInitialState, reduce } from '../../src/core/game';

function start(options?: Parameters<typeof createInitialState>[0]): GameState {
  return reduce(createInitialState(options), { type: 'start' });
}

/** Drop food directly in front of the head and tick, forcing a growth. */
function eatAhead(state: GameState): GameState {
  const dir = state.queue[0] ?? state.direction;
  const head = state.snake[0]!;
  const step = { up: -1, down: 1 } as const;
  const ahead =
    dir === 'left' || dir === 'right'
      ? { x: head.x + (dir === 'right' ? 1 : -1), z: head.z }
      : { x: head.x, z: head.z + step[dir] };
  return reduce({ ...state, food: ahead }, { type: 'tick' });
}

const head = (s: GameState) => s.snake[0]!;

describe('lifecycle', () => {
  it('starts in ready and transitions to playing', () => {
    const ready = createInitialState({ seed: 1 });
    expect(ready.phase).toBe('ready');
    expect(reduce(ready, { type: 'start' }).phase).toBe('playing');
  });

  it('does not tick while ready', () => {
    const ready = createInitialState({ seed: 1 });
    expect(reduce(ready, { type: 'tick' })).toBe(ready);
  });

  it('does not restart an in-progress game on start', () => {
    const playing = start({ seed: 1 });
    expect(reduce(playing, { type: 'start' })).toBe(playing);
  });

  it('pauses and resumes', () => {
    const playing = start({ seed: 1 });
    const paused = reduce(playing, { type: 'pause' });
    expect(paused.phase).toBe('paused');
    expect(reduce(paused, { type: 'tick' })).toBe(paused); // frozen
    expect(reduce(paused, { type: 'resume' }).phase).toBe('playing');
  });

  it('ignores turns unless playing', () => {
    const ready = createInitialState({ seed: 1 });
    expect(reduce(ready, { type: 'turn', direction: 'up' })).toBe(ready);
  });

  it('reset returns to a fresh ready board, keeping best', () => {
    let s = start({ seed: 1, best: 9 });
    s = eatAhead(s);
    const reset = reduce(s, { type: 'reset' });
    expect(reset.phase).toBe('ready');
    expect(reset.score).toBe(0);
    expect(reset.best).toBe(9);
  });
});

describe('movement', () => {
  it('advances the head by one cell per tick', () => {
    const s = start({ seed: 1 });
    const before = head(s);
    const after = reduce({ ...s, food: { x: 0, z: 0 } }, { type: 'tick' });
    expect(head(after)).toEqual({ x: before.x + 1, z: before.z });
  });

  it('keeps the body length constant when not eating', () => {
    const s = start({ seed: 1 });
    const after = reduce({ ...s, food: { x: 0, z: 0 } }, { type: 'tick' });
    expect(after.snake).toHaveLength(s.snake.length);
  });

  it('consumes one queued turn per tick', () => {
    let s = start({ seed: 1 });
    s = reduce(s, { type: 'turn', direction: 'up' });
    expect(s.queue).toEqual(['up']);
    s = reduce({ ...s, food: { x: 0, z: 0 } }, { type: 'tick' });
    expect(s.direction).toBe('up');
    expect(s.queue).toEqual([]);
  });
});

describe('eating', () => {
  it('grows the snake and increments the score', () => {
    const s = start({ seed: 1 });
    const grown = eatAhead(s);
    expect(grown.score).toBe(1);
    expect(grown.snake).toHaveLength(s.snake.length + 1);
  });

  it('tracks the best score', () => {
    const s = start({ seed: 1, best: 0 });
    expect(eatAhead(s).best).toBe(1);
  });

  it('speeds up by tickStep per food, with a floor at minTick', () => {
    const config = { ...DEFAULT_CONFIG, baseTick: 84, minTick: 80, tickStep: 4 };
    let s = start({ seed: 1, config });
    expect(s.tickInterval).toBe(84);
    s = eatAhead(s);
    expect(s.tickInterval).toBe(80); // 84 - 4
    s = eatAhead(s);
    expect(s.tickInterval).toBe(80); // 84 - 8 floored
  });

  it('spawns the next food on a free cell', () => {
    const s = start({ seed: 1 });
    const grown = eatAhead(s);
    expect(grown.snake).not.toContainEqual(grown.food);
  });
});

describe('arena shrink', () => {
  it('closes the walls every shrinkEvery foods', () => {
    const config = {
      ...DEFAULT_CONFIG,
      maxGrid: 11,
      startMargin: 1,
      maxMargin: 3,
      shrinkEvery: 2,
      initialLength: 3,
    };
    let s = start({ seed: 1, config });
    expect(s.arenaMargin).toBe(1);
    s = eatAhead(s);
    expect(s.arenaMargin).toBe(1); // score 1
    s = eatAhead(s);
    expect(s.arenaMargin).toBe(2); // score 2 -> shrink
  });
});

describe('collisions', () => {
  it('ends the game when the head leaves the walls', () => {
    let s = start({ seed: 1 }); // facing right, food parked off-path
    for (let i = 0; i < 40 && s.phase === 'playing'; i++) {
      s = reduce({ ...s, food: { x: 0, z: 0 } }, { type: 'tick' });
    }
    expect(s.phase).toBe('gameover');
    expect(s.won).toBe(false);
  });

  it('ends the game when the head hits the body', () => {
    const base = start({ seed: 1 });
    const snake = [
      { x: 12, z: 12 }, // head
      { x: 13, z: 12 },
      { x: 13, z: 11 },
      { x: 12, z: 11 }, // moving up walks the head into this segment
      { x: 11, z: 11 },
    ];
    const s: GameState = { ...base, snake, direction: 'up', queue: [], food: { x: 0, z: 0 } };
    expect(reduce(s, { type: 'tick' }).phase).toBe('gameover');
  });

  it('lets the head follow the vacating tail', () => {
    const base = start({ seed: 1 });
    // tail is at {12,12}; turning up moves the head into the cell the tail leaves
    const snake = [
      { x: 12, z: 11 }, // head
      { x: 13, z: 11 },
      { x: 13, z: 12 },
      { x: 12, z: 12 }, // tail — vacates this tick
    ];
    const s: GameState = { ...base, snake, direction: 'down', queue: [], food: { x: 0, z: 0 } };
    expect(reduce(s, { type: 'tick' }).phase).toBe('playing');
  });
});

describe('winning', () => {
  it('ends the game as a win when the snake fills the board', () => {
    const config = {
      ...DEFAULT_CONFIG,
      maxGrid: 6,
      startMargin: 1,
      maxMargin: 1,
      shrinkEvery: 100,
      initialLength: 3,
    };
    const base = start({ seed: 1, config });
    // 2x2 inner area [2,3]²; snake holds three cells, food sits in the last one
    const snake = [
      { x: 2, z: 3 }, // head, moving up into the final free cell
      { x: 3, z: 3 },
      { x: 3, z: 2 },
    ];
    const s: GameState = { ...base, snake, direction: 'up', queue: [], food: { x: 2, z: 2 } };
    const won = reduce(s, { type: 'tick' });
    expect(won.phase).toBe('gameover');
    expect(won.won).toBe(true);
    expect(won.score).toBe(1);
  });
});

describe('difficulty', () => {
  it('applies the chosen config', () => {
    const easy = createInitialState({ seed: 1, config: { ...DEFAULT_CONFIG, baseTick: 360 } });
    expect(easy.tickInterval).toBe(360);
  });
});

describe('determinism', () => {
  const directions: Direction[] = ['down', 'right', 'up', 'right', 'down'];

  function playout(seed: number): GameState {
    let s = start({ seed });
    for (const direction of directions) {
      s = reduce(s, { type: 'turn', direction });
      s = reduce(s, { type: 'tick' });
    }
    return s;
  }

  it('is reproducible for a given seed', () => {
    expect(playout(42)).toEqual(playout(42));
  });

  it('diverges across seeds', () => {
    const foods = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) {
      const f = playout(seed).food;
      foods.add(`${f.x},${f.z}`);
    }
    expect(foods.size).toBeGreaterThan(1);
  });
});
