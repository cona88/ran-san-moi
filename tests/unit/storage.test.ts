// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  loadBest,
  loadSettings,
  saveBest,
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
