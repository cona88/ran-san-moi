import { describe, expect, it } from 'vitest';
import type { GameState, WorldOrb } from '../../src/core/types';
import { DEFAULT_CONFIG, SEGMENT_SPACING, createInitialState, reduce } from '../../src/core';

function start(options?: Parameters<typeof createInitialState>[0]): GameState {
  return reduce(createInitialState(options), { type: 'start' });
}

function makeOrbAhead(state: GameState, dist = 0.6, value = 1, isLoot = false): GameState {
  const head = state.snake[0]!;
  const orb: WorldOrb = {
    id: 99999 + state.orbs.length,
    x: head.x + Math.cos(state.heading) * dist,
    z: head.z + Math.sin(state.heading) * dist,
    value,
    colorHex: 0xffd43b,
    isLoot,
  };
  return reduce({ ...state, orbs: [...state.orbs, orb], bots: [] }, { type: 'tick' });
}

const head = (s: GameState) => s.snake[0]!;

describe('lifecycle & initialization', () => {
  it('starts centered at (0, 0) with 10 segments, level 5, default playerName, 850 orbs, and 60 bots', () => {
    const ready = createInitialState({ seed: 1 });
    expect(ready.phase).toBe('ready');
    expect(ready.playerName).toBe('Bé Tiên');
    expect(ready.level).toBe(5);
    expect(ready.xp).toBe(0);
    expect(ready.snake).toHaveLength(10);
    expect(ready.prevSnake).toHaveLength(10);
    expect(ready.snake[0]).toEqual({ x: 0, z: 0 });
    expect(ready.snake[1]!.x).toBeCloseTo(-SEGMENT_SPACING, 4);
    expect(ready.orbs).toHaveLength(DEFAULT_CONFIG.orbTargetCount);
    expect(ready.bots).toHaveLength(DEFAULT_CONFIG.botCount);
    expect(ready.boosters.level.charges).toBe(1);
    expect(ready.boosters.speed.charges).toBe(2);
    expect(ready.boosters.magnet.charges).toBe(2);

    const playing = reduce(ready, { type: 'start', playerName: 'Bông Hoa' });
    expect(playing.phase).toBe('playing');
    expect(playing.playerName).toBe('Bông Hoa');
  });

  it('does not tick while ready and does not restart mid-game', () => {
    const ready = createInitialState({ seed: 1 });
    expect(reduce(ready, { type: 'tick' })).toBe(ready);
    const playing = start({ seed: 1 });
    expect(reduce(playing, { type: 'start' })).toBe(playing);
  });

  it('pauses and resumes cleanly', () => {
    const playing = start({ seed: 1 });
    const paused = reduce(playing, { type: 'pause' });
    expect(paused.phase).toBe('paused');
    expect(reduce(paused, { type: 'tick' })).toBe(paused);
    expect(reduce(paused, { type: 'resume' }).phase).toBe('playing');
  });

  it('ignores steer and turn unless playing', () => {
    const ready = createInitialState({ seed: 1 });
    expect(reduce(ready, { type: 'steer', angle: 1.2 })).toBe(ready);
    expect(reduce(ready, { type: 'turn', direction: 'up' })).toBe(ready);
  });

  it('reset returns to ready while preserving best score and playerName', () => {
    let s = start({ seed: 1, best: 99, playerName: 'Miu' });
    s = makeOrbAhead(s, 0.5, 2);
    const reset = reduce(s, { type: 'reset' });
    expect(reset.phase).toBe('ready');
    expect(reset.score).toBe(0);
    expect(reset.best).toBe(99);
    expect(reset.level).toBe(5);
    expect(reset.playerName).toBe('Miu');
    expect(reset.hearts).toBe(reset.config.initialHearts);
  });
});

describe('continuous 360° movement & boundaries', () => {
  it('advances smoothly along heading and stores prevSnake', () => {
    const s = start({ seed: 1 });
    const before = head(s);
    const after = reduce({ ...s, bots: [], orbs: [] }, { type: 'tick' });
    expect(head(after).x).toBeCloseTo(before.x + s.config.baseSpeed, 5);
    expect(head(after).z).toBeCloseTo(before.z, 5);
    expect(after.prevSnake[0]).toEqual(before);
    expect(after.snake).toHaveLength(s.snake.length);
  });

  it('steers smoothly with steer(angle) and turn(dir) and syncs nearest cardinal direction', () => {
    let s = start({ seed: 1 });
    s = reduce(s, { type: 'steer', angle: Math.PI / 2 });
    expect(s.targetHeading).toBeCloseTo(Math.PI / 2, 5);
    expect(s.direction).toBe('down');

    s = reduce({ ...s, bots: [] }, { type: 'tick' });
    expect(s.heading).toBeCloseTo(0.34, 5);
    expect(s.snake[0]!.z).toBeGreaterThan(0);

    s = reduce(s, { type: 'turn', direction: 'left' });
    expect(s.targetHeading).toBeCloseTo(Math.PI, 5);
    expect(s.direction).toBe('left');
  });

  it('never dies on self-intersection even when making tight 180-degree loops', () => {
    let s = start({ seed: 1 });
    s = reduce({ ...s, bots: [], orbs: [] }, { type: 'turn', direction: 'left' });
    for (let i = 0; i < 20; i++) {
      s = reduce({ ...s, bots: [], orbs: [] }, { type: 'tick' });
    }
    expect(s.phase).toBe('playing');
    expect(s.hearts).toBe(s.config.initialHearts);
    expect(s.heading).toBeCloseTo(Math.PI, 2);
  });

  it('glides softly along world borders instead of dying in adventure/reflex modes', () => {
    const s = start({ seed: 1, mode: 'adventure' });
    const nearWall = {
      ...s,
      bots: [],
      orbs: [],
      snake: [
        { x: s.config.worldRadius - 0.85, z: 4 },
        { x: s.config.worldRadius - 1.37, z: 4 },
        { x: s.config.worldRadius - 1.89, z: 4 },
      ],
      heading: 0,
      targetHeading: 0,
    };
    const after = reduce(nearWall, { type: 'tick' });
    expect(after.phase).toBe('playing');
    expect(after.hearts).toBe(nearWall.hearts);
    expect(Math.abs(after.snake[0]!.x)).toBeLessThanOrEqual(s.config.worldRadius - 0.8 + 1e-6);
    expect(after.heading).not.toBe(0); // steered along border
  });

  it('wraps smoothly across borders in cozy mode and resets prevSnake to avoid stretch', () => {
    let s = start({ seed: 1, mode: 'cozy' });
    const safeR = s.config.worldRadius - 0.8;
    s = {
      ...s,
      bots: [],
      orbs: [],
      snake: [
        { x: safeR - 0.05, z: 2 },
        { x: safeR - 0.57, z: 2 },
        { x: safeR - 1.09, z: 2 },
      ],
      heading: 0,
      targetHeading: null,
    };
    const after = reduce(s, { type: 'tick' });
    expect(after.phase).toBe('playing');
    expect(after.snake[0]!.x).toBeLessThan(0);
    expect(after.prevSnake[0]).toEqual(after.snake[0]);
  });
});

describe('eating orbs & xp progression', () => {
  it('eats nearby orb, increases score, combo, xp, best, and emits eat_food', () => {
    const s = start({ seed: 1, best: 0 });
    const after = makeOrbAhead(s, 0.5, 1, false);
    expect(after.score).toBeGreaterThan(0);
    expect(after.best).toBe(after.score);
    expect(after.combo).toBe(1);
    expect(after.xp).toBe(1);
    expect(after.events.some((e) => e.kind === 'eat_food')).toBe(true);
  });
});

describe('determinism across seeds', () => {
  function playout(seed: number): GameState {
    let s = start({ seed });
    const angles = [0.2, 0.9, -0.5, 1.4, -1.2];
    for (const angle of angles) {
      s = reduce(s, { type: 'steer', angle });
      s = reduce(s, { type: 'tick' });
    }
    return s;
  }

  it('is reproducible for a given seed and diverges across seeds', () => {
    expect(playout(42)).toEqual(playout(42));
    const heads = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) {
      const b = playout(seed).bots[0]!.head;
      heads.add(`${b.x.toFixed(2)},${b.z.toFixed(2)}`);
    }
    expect(heads.size).toBeGreaterThan(1);
  });
});

describe('5-minute play session & 5x world completion', () => {
  it('completes cleanly with won=true when elapsedTicks reaches 5 minutes (6000 ticks)', () => {
    const base = start({ seed: 7 });
    expect(base.config.worldRadius).toBe(280);
    expect(base.config.maxGrid).toBe(560);
    expect(base.config.sessionDurationMs).toBe(300_000);

    const beforeEnd = {
      ...base,
      bots: [],
      hazards: [],
      elapsedTicks: 5999,
      score: 1200,
      best: 1200,
    };
    const ended = reduce(beforeEnd, { type: 'tick' });
    expect(ended.elapsedTicks).toBe(6000);
    expect(ended.phase).toBe('gameover');
    expect(ended.won).toBe(true);
    expect(ended.eatenByBotName).toBeNull();
    expect(ended.score).toBeGreaterThan(1200);
    expect(ended.best).toBe(ended.score);
    const goEvent = ended.events.find((e) => e.kind === 'gameover');
    expect(goEvent?.messageVi).toContain('5 Phút');
  });

  it('respects custom sessionDurationMs tick-by-tick without ending early', () => {
    let s = start({
      seed: 3,
      config: { ...DEFAULT_CONFIG, sessionDurationMs: 250 }, // 5 ticks at 50ms
    });
    s = { ...s, bots: [], hazards: [] };

    for (let t = 0; t < 4; t++) {
      s = reduce(s, { type: 'tick' });
      expect(s.phase).toBe('playing');
      expect(s.won).toBe(false);
    }

    s = reduce(s, { type: 'tick' });
    expect(s.elapsedTicks).toBe(5);
    expect(s.phase).toBe('gameover');
    expect(s.won).toBe(true);
  });
});
