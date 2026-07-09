// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  loadBest,
  loadNickname,
  loadOrCreateNickname,
  loadPlayerId,
  loadSettings,
  saveBest,
  saveNickname,
  saveSettings,
} from '../../src/platform/storage';

afterEach(() => localStorage.clear());

describe('storage: best score', () => {
  it('defaults to zero and round-trips', () => {
    expect(loadBest()).toBe(0);
    saveBest(42);
    expect(loadBest()).toBe(42);
  });

  it('ignores non-numeric values', () => {
    localStorage.setItem('neonSnakeBest', 'not-a-number');
    expect(loadBest()).toBe(0);
  });
});

describe('storage: settings', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips a valid settings object', () => {
    saveSettings({ sound: false, difficulty: 'hard' });
    expect(loadSettings()).toEqual({ sound: false, difficulty: 'hard' });
  });

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem('neonSnakeSettings', '{ not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('sanitizes an unknown difficulty', () => {
    localStorage.setItem(
      'neonSnakeSettings',
      JSON.stringify({ sound: true, difficulty: 'extreme' }),
    );
    expect(loadSettings().difficulty).toBe('normal');
  });
});

describe('storage: player identity', () => {
  it('generates and persists a playerId on first call', () => {
    const id = loadPlayerId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(loadPlayerId()).toBe(id); // stable across calls
  });

  it('nickname defaults to null until set', () => {
    expect(loadNickname()).toBeNull();
  });

  it('round-trips a nickname, capped at 16 chars', () => {
    saveNickname('A Very Long Nickname Indeed');
    expect(loadNickname()).toBe('A Very Long Nick'.slice(0, 16));
  });

  it('loadOrCreateNickname persists a generated default when none is set', () => {
    const first = loadOrCreateNickname();
    expect(first.length).toBeGreaterThan(0);
    expect(loadNickname()).toBe(first); // was persisted
    expect(loadOrCreateNickname()).toBe(first); // stable across calls
  });

  it('loadOrCreateNickname returns the saved nickname if one exists', () => {
    saveNickname('Matheus');
    expect(loadOrCreateNickname()).toBe('Matheus');
  });
});
