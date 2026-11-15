import type { Difficulty, GameMode, VisualTheme } from '../core/types';

/** Player-tunable options persisted between offline macOS sessions. */
export interface Settings {
  readonly mode: GameMode;
  readonly difficulty: Difficulty;
  readonly theme: VisualTheme;
  readonly sound: boolean;
  readonly music: boolean;
  readonly vibration: boolean;
  readonly playerName?: string;
}

export const DEFAULT_PLAYER_NAME = 'Bé Tiên';

export const VALID_THEMES: readonly VisualTheme[] = [
  'honeycomb_arena',
  'crystal_garden',
  'starlight_galaxy',
  'candy_island',
];

export const DEFAULT_SETTINGS: Settings = {
  mode: 'adventure',
  difficulty: 'normal',
  theme: 'honeycomb_arena',
  sound: true,
  music: true,
  vibration: true,
  playerName: DEFAULT_PLAYER_NAME,
};

const BEST_KEY = 'neonSnakeBest';
const SETTINGS_KEY = 'neonSnakeSettings';
const PLAYER_ID_KEY = 'neonSnakePlayerId';
const NICKNAME_KEY = 'neonSnakeNickname';
const NICKNAME_MAX = 16;

const MODES: readonly GameMode[] = ['adventure', 'reflex', 'cozy'];
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

export function loadBest(): number {
  const raw = safeGet(BEST_KEY);
  if (raw === null) return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function saveBest(best: number): void {
  const sanitized = Number.isFinite(best) && best > 0 ? Math.floor(best) : 0;
  safeSet(BEST_KEY, String(sanitized));
}

function sanitizePlayerName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_PLAYER_NAME;
  const trimmed = raw.trim().slice(0, NICKNAME_MAX);
  return trimmed.length > 0 ? trimmed : DEFAULT_PLAYER_NAME;
}

/**
 * Load settings with graceful migration from older `{ sound, difficulty }`
 * records and safe fallbacks if any field is missing or corrupted.
 */
export function loadSettings(): Settings {
  const raw = safeGet(SETTINGS_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecord(parsed)) return DEFAULT_SETTINGS;

    const mode = isOneOf(parsed['mode'], MODES) ? parsed['mode'] : DEFAULT_SETTINGS.mode;
    const difficulty = isOneOf(parsed['difficulty'], DIFFICULTIES)
      ? parsed['difficulty']
      : DEFAULT_SETTINGS.difficulty;
    const theme = isOneOf(parsed['theme'], VALID_THEMES) ? parsed['theme'] : DEFAULT_SETTINGS.theme;
    const sound = typeof parsed['sound'] === 'boolean' ? parsed['sound'] : DEFAULT_SETTINGS.sound;
    const music = typeof parsed['music'] === 'boolean' ? parsed['music'] : DEFAULT_SETTINGS.music;
    const vibration =
      typeof parsed['vibration'] === 'boolean' ? parsed['vibration'] : DEFAULT_SETTINGS.vibration;
    const playerName = sanitizePlayerName(parsed['playerName']);

    return { mode, difficulty, theme, sound, music, vibration, playerName };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  const sanitized: Settings = {
    mode: isOneOf(settings.mode, MODES) ? settings.mode : DEFAULT_SETTINGS.mode,
    difficulty: isOneOf(settings.difficulty, DIFFICULTIES)
      ? settings.difficulty
      : DEFAULT_SETTINGS.difficulty,
    theme: isOneOf(settings.theme, VALID_THEMES) ? settings.theme : DEFAULT_SETTINGS.theme,
    sound: typeof settings.sound === 'boolean' ? settings.sound : DEFAULT_SETTINGS.sound,
    music: typeof settings.music === 'boolean' ? settings.music : DEFAULT_SETTINGS.music,
    vibration:
      typeof settings.vibration === 'boolean' ? settings.vibration : DEFAULT_SETTINGS.vibration,
    playerName: sanitizePlayerName(settings.playerName),
  };
  safeSet(SETTINGS_KEY, JSON.stringify(sanitized));
}

function generateFallbackUuid(): string {
  const hex = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-8${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

export function loadPlayerId(): string {
  const existing = safeGet(PLAYER_ID_KEY);
  if (existing) return existing;
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : generateFallbackUuid();
  safeSet(PLAYER_ID_KEY, id);
  return id;
}

export function loadNickname(): string | null {
  const raw = safeGet(NICKNAME_KEY);
  if (raw === null) return null;
  const trimmed = raw.trim().slice(0, NICKNAME_MAX);
  return trimmed.length > 0 ? trimmed : null;
}

export function saveNickname(nickname: string): void {
  safeSet(NICKNAME_KEY, sanitizePlayerName(nickname));
}

/** The player's local nickname, defaulting to `'Bé Tiên'` if none is set yet. */
export function loadOrCreateNickname(): string {
  const existing = loadNickname();
  if (existing) return existing;
  saveNickname(DEFAULT_PLAYER_NAME);
  return DEFAULT_PLAYER_NAME;
}
