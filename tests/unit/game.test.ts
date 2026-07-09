import { describe, expect, it } from 'vitest';
import type { Direction, GameState } from '../../src/core/types';
import { DEFAULT_CONFIG } from '../../src/core/config';
import { createInitialState, reduce } from '../../src/core/game';
import { innerBounds } from '../../src/core/systems/arena';

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

  it('never self-collides when the buffer holds a turn opposite the live direction', () => {
    // facing right; queue 'up' then 'left' (left is valid vs the queued 'up')
    let s = start({ seed: 1 });
    s = reduce(s, { type: 'turn', direction: 'up' });
    s = reduce(s, { type: 'turn', direction: 'left' });
    expect(s.queue).toEqual(['up', 'left']);

    const length = s.snake.length;
    s = reduce({ ...s, food: { x: 0, z: 0 } }, { type: 'tick' }); // consume 'up'
    s = reduce({ ...s, food: { x: 0, z: 0 } }, { type: 'tick' }); // consume 'left'
    expect(s.phase).toBe('playing');
    expect(s.snake).toHaveLength(length);
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
  const config = {
    ...DEFAULT_CONFIG,
    maxGrid: 11,
    startMargin: 1,
    maxMargin: 3,
    shrinkEvery: 2,
    initialLength: 3,
  };

  it('arms a pending shrink at the threshold instead of closing instantly', () => {
    let s = start({ seed: 1, config });
    expect(s.arenaMargin).toBe(1);
    s = eatAhead(s);
    expect(s.pendingShrink).toBe(false); // score 1
    s = eatAhead(s);
    expect(s.score).toBe(2); // threshold reached
    expect(s.arenaMargin).toBe(1); // walls have not moved yet
    expect(s.pendingShrink).toBe(true);
  });

  it('commits the shrink once the whole snake fits the tighter bounds', () => {
    let s = start({ seed: 1, config });
    s = eatAhead(s);
    s = eatAhead(s); // armed; the snake already sits inside the future walls
    s = reduce({ ...s, food: { x: 0, z: 0 } }, { type: 'tick' });
    expect(s.arenaMargin).toBe(2);
    expect(s.pendingShrink).toBe(false);
  });

  it('waits while any segment still sits in the closing band', () => {
    const base = start({ seed: 1, config });
    const snake = [
      { x: 3, z: 5 }, // head
      { x: 2, z: 5 },
      { x: 1, z: 5 }, // inside the old walls, outside the future ones
      { x: 1, z: 4 },
    ];
    const s: GameState = {
      ...base,
      snake,
      direction: 'right',
      queue: [],
      food: { x: 0, z: 0 },
      arenaMargin: 1,
      pendingShrink: true,
    };
    const next = reduce(s, { type: 'tick' });
    expect(next.phase).toBe('playing');
    expect(next.arenaMargin).toBe(1);
    expect(next.pendingShrink).toBe(true);
  });

  it('never kills the snake in the closing band while the shrink is pending', () => {
    const base = start({ seed: 1, config });
    const snake = [
      { x: 8, z: 5 }, // head; next cell (9) is legal for margin 1, illegal for margin 2
      { x: 7, z: 5 },
      { x: 6, z: 5 },
    ];
    const s: GameState = {
      ...base,
      snake,
      direction: 'right',
      queue: [],
      food: { x: 0, z: 0 },
      arenaMargin: 1,
      pendingShrink: true,
    };
    const next = reduce(s, { type: 'tick' });
    expect(next.phase).toBe('playing');
    expect(next.arenaMargin).toBe(1);
    expect(next.pendingShrink).toBe(true);
  });

  it('spawns food inside the future inner bounds while pending', () => {
    let s = start({ seed: 1, config });
    s = eatAhead(s);
    s = eatAhead(s); // armed
    expect(s.pendingShrink).toBe(true);
    const { lo, hi } = innerBounds(config, s.arenaMargin + 1);
    expect(s.food.x).toBeGreaterThanOrEqual(lo);
    expect(s.food.x).toBeLessThanOrEqual(hi);
    expect(s.food.z).toBeGreaterThanOrEqual(lo);
    expect(s.food.z).toBeLessThanOrEqual(hi);
  });

  it('absorbs a second threshold while one shrink is pending', () => {
    const cfg = { ...config, shrinkEvery: 1 };
    const base = start({ seed: 1, config: cfg });
    const snake = [
      { x: 3, z: 5 }, // head
      { x: 2, z: 5 },
      { x: 1, z: 5 }, // this column keeps the snake in the band for a while
      { x: 1, z: 4 },
      { x: 1, z: 3 },
    ];
    let s: GameState = {
      ...base,
      snake,
      direction: 'right',
      queue: [],
      food: { x: 0, z: 0 },
      arenaMargin: 1,
      pendingShrink: false,
      score: 0,
    };
    s = eatAhead(s); // score 1 -> arms
    expect(s.pendingShrink).toBe(true);
    s = eatAhead(s); // score 2 -> another threshold, absorbed by the pending flag
    expect(s.pendingShrink).toBe(true);
    expect(s.arenaMargin).toBe(1);
    // walk the tail out of the band; the single pending shrink then commits
    s = reduce({ ...s, food: { x: 0, z: 0 } }, { type: 'tick' });
    s = reduce({ ...s, food: { x: 0, z: 0 } }, { type: 'tick' });
    s = reduce({ ...s, food: { x: 0, z: 0 } }, { type: 'tick' });
    expect(s.arenaMargin).toBe(2); // rose by exactly one despite two thresholds
    expect(s.pendingShrink).toBe(false);
  });

  it('does not arm beyond maxMargin', () => {
    const base = start({ seed: 1, config });
    const snake = [
      { x: 5, z: 5 },
      { x: 4, z: 5 },
      { x: 3, z: 5 },
    ];
    const s: GameState = {
      ...base,
      snake,
      direction: 'right',
      queue: [],
      food: { x: 0, z: 0 },
      arenaMargin: config.maxMargin,
      pendingShrink: false,
      score: 1,
    };
    const next = eatAhead(s); // score 2 hits the threshold, but the arena is as tight as it gets
    expect(next.score).toBe(2);
    expect(next.pendingShrink).toBe(false);
    expect(next.arenaMargin).toBe(config.maxMargin);
  });

  it('start and reset clear a pending shrink', () => {
    let s = start({ seed: 1, config });
    s = eatAhead(s);
    s = eatAhead(s); // armed
    expect(s.pendingShrink).toBe(true);
    const reset = reduce(s, { type: 'reset' });
    expect(reset.pendingShrink).toBe(false);
    expect(reset.arenaMargin).toBe(config.startMargin);
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
    expect(won.best).toBe(1); // best updates even on the winning tick

    // restarting clears the win flag and resets the board, keeping best
    const restarted = reduce(won, { type: 'start' });
    expect(restarted.phase).toBe('playing');
    expect(restarted.won).toBe(false);
    expect(restarted.score).toBe(0);
    expect(restarted.best).toBe(1);
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
