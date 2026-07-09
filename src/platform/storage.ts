import type { Difficulty } from '../core/types';

/** Player-tunable options persisted between sessions. */
export interface Settings {
  readonly sound: boolean;
  readonly difficulty: Difficulty;
}

export const DEFAULT_SETTINGS: Settings = { sound: true, difficulty: 'normal' };

const BEST_KEY = 'neonSnakeBest'; // kept from the original for backward compatibility
const SETTINGS_KEY = 'neonSnakeSettings';
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** Read a key, swallowing the SecurityError thrown in private-mode browsers. */
function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — best-effort only */
  }
}

export function loadBest(): number {
  const value = Number(safeGet(BEST_KEY));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function saveBest(best: number): void {
  safeSet(BEST_KEY, String(best));
}

export function loadSettings(): Settings {
  const raw = safeGet(SETTINGS_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const difficulty =
      typeof parsed.difficulty === 'string' && DIFFICULTIES.includes(parsed.difficulty)
        ? parsed.difficulty
        : DEFAULT_SETTINGS.difficulty;
    const sound = typeof parsed.sound === 'boolean' ? parsed.sound : DEFAULT_SETTINGS.sound;
    return { sound, difficulty };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  safeSet(SETTINGS_KEY, JSON.stringify(settings));
}

const PLAYER_ID_KEY = 'neonSnakePlayerId';
const NICKNAME_KEY = 'neonSnakeNickname';
const NICKNAME_MAX = 16;

export function loadPlayerId(): string {
  const existing = safeGet(PLAYER_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  safeSet(PLAYER_ID_KEY, id);
  return id;
}

export function loadNickname(): string | null {
  return safeGet(NICKNAME_KEY);
}

export function saveNickname(nickname: string): void {
  safeSet(NICKNAME_KEY, nickname.slice(0, NICKNAME_MAX));
}

/** The player's nickname, generating and persisting a default if none is set. */
export function loadOrCreateNickname(): string {
  const existing = loadNickname();
  if (existing) return existing;
  const suffix = loadPlayerId().slice(0, 4);
  const generated = `Snake-${suffix}`;
  saveNickname(generated);
  return generated;
}
