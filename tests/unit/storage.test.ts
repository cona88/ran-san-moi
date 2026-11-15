// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYER_NAME,
  DEFAULT_SETTINGS,
  VALID_THEMES,
  loadBest,
  loadNickname,
  loadOrCreateNickname,
  loadPlayerId,
  loadSettings,
  saveBest,
  saveNickname,
  saveSettings,
} from '../../src/platform/storage';
import { fetchLeaderboard, submitScore } from '../../src/platform/leaderboard';

afterEach(() => localStorage.clear());

describe('storage: best score', () => {
  it('defaults to zero and round-trips', () => {
    expect(loadBest()).toBe(0);
    saveBest(42);
    expect(loadBest()).toBe(42);
  });

  it('ignores non-numeric or negative values', () => {
    localStorage.setItem('neonSnakeBest', 'not-a-number');
    expect(loadBest()).toBe(0);
    saveBest(-15);
    expect(loadBest()).toBe(0);
  });
});

describe('storage: settings', () => {
  it('exposes all 4 valid themes with honeycomb_arena as default', () => {
    expect(VALID_THEMES).toEqual([
      'honeycomb_arena',
      'crystal_garden',
      'starlight_galaxy',
      'candy_island',
    ]);
    expect(DEFAULT_SETTINGS.theme).toBe('honeycomb_arena');
    expect(DEFAULT_SETTINGS.playerName).toBe('Bé Tiên');
  });

  it('returns defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({
      mode: 'adventure',
      difficulty: 'normal',
      theme: 'honeycomb_arena',
      sound: true,
      music: true,
      vibration: true,
      playerName: DEFAULT_PLAYER_NAME,
    });
  });

  it('round-trips a full settings object including honeycomb_arena and playerName', () => {
    const custom = {
      mode: 'cozy' as const,
      difficulty: 'hard' as const,
      theme: 'candy_island' as const,
      sound: false,
      music: false,
      vibration: false,
      playerName: 'Công Chúa Bông',
    };
    saveSettings(custom);
    expect(loadSettings()).toEqual(custom);
  });

  it('smoothly migrates legacy { sound, difficulty } records with new defaults', () => {
    localStorage.setItem('neonSnakeSettings', JSON.stringify({ sound: false, difficulty: 'hard' }));
    expect(loadSettings()).toEqual({
      mode: 'adventure',
      difficulty: 'hard',
      theme: 'honeycomb_arena',
      sound: false,
      music: true,
      vibration: true,
      playerName: DEFAULT_PLAYER_NAME,
    });
  });

  it('falls back to defaults on corrupt or non-object JSON', () => {
    localStorage.setItem('neonSnakeSettings', '{ not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);

    localStorage.setItem('neonSnakeSettings', 'null');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);

    localStorage.setItem('neonSnakeSettings', '[]');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('sanitizes unknown mode, difficulty, theme, and blank playerName values', () => {
    localStorage.setItem(
      'neonSnakeSettings',
      JSON.stringify({
        mode: 'ultra',
        difficulty: 'extreme',
        theme: 'cyberpunk',
        sound: true,
        music: 'yes',
        vibration: 1,
        playerName: '   ',
      }),
    );
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('storage: player identity', () => {
  it('generates and persists a playerId on first call', () => {
    const id = loadPlayerId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(loadPlayerId()).toBe(id);
  });

  it('nickname defaults to null until set', () => {
    expect(loadNickname()).toBeNull();
  });

  it('round-trips a nickname, capped at 16 chars', () => {
    saveNickname('A Very Long Nickname Indeed');
    expect(loadNickname()).toBe('A Very Long Nick'.slice(0, 16));
  });

  it('loadOrCreateNickname persists default Bé Tiên when none is set', () => {
    const first = loadOrCreateNickname();
    expect(first).toBe('Bé Tiên');
    expect(loadNickname()).toBe('Bé Tiên');
    expect(loadOrCreateNickname()).toBe('Bé Tiên');
  });

  it('loadOrCreateNickname returns the saved nickname if one exists', () => {
    saveNickname('Linh Chi');
    expect(loadOrCreateNickname()).toBe('Linh Chi');
  });
});

describe('offline local leaderboard', () => {
  it('stores and ranks personal records in localStorage without network calls', async () => {
    const player = { id: 'p1', nickname: 'RắnTiên-1234' };
    expect(await fetchLeaderboard('alltime', 'normal')).toEqual([]);
    expect(await submitScore('alltime', 'normal', 0, player)).toEqual({ rank: null });

    const r1 = await submitScore('alltime', 'normal', 120, player);
    const r2 = await submitScore('alltime', 'normal', 250, player);
    const r3 = await submitScore('alltime', 'normal', 80, player);

    expect(r1.rank).toBe(1);
    expect(r2.rank).toBe(1);
    expect(r3.rank).toBe(3);

    const board = await fetchLeaderboard('alltime', 'normal');
    expect(board.map((e) => e.score)).toEqual([250, 120, 80]);
    expect(board.map((e) => e.rank)).toEqual([1, 2, 3]);
  });
});
