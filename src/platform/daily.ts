/** Deterministic 32-bit seed for a UTC calendar day (FNV-1a over "YYYY-MM-DD"). */
export function dailySeed(date: Date): number {
  const key = date.toISOString().slice(0, 10);
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const STREAK_KEY = 'neonSnakeStreak';

export interface StreakState {
  readonly count: number;
  readonly lastPlayedDate: string | null;
}

const EMPTY_STREAK: StreakState = { count: 0, lastPlayedDate: null };

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

function loadStreak(): StreakState {
  const raw = safeGet(STREAK_KEY);
  if (!raw) return EMPTY_STREAK;
  try {
    const parsed = JSON.parse(raw) as Partial<StreakState>;
    return typeof parsed.count === 'number' && typeof parsed.lastPlayedDate === 'string'
      ? { count: parsed.count, lastPlayedDate: parsed.lastPlayedDate }
      : EMPTY_STREAK;
  } catch {
    return EMPTY_STREAK;
  }
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isYesterday(lastPlayedDate: string, today: Date): boolean {
  const yesterday = new Date(today.getTime() - 86_400_000);
  return lastPlayedDate === dayKey(yesterday);
}

/** Streak as of now — 0 if the last daily play wasn't today or yesterday. */
export function currentStreak(today: Date = new Date()): number {
  const s = loadStreak();
  if (!s.lastPlayedDate) return 0;
  const key = dayKey(today);
  if (s.lastPlayedDate === key || isYesterday(s.lastPlayedDate, today)) return s.count;
  return 0;
}

/** Record a completed daily-challenge run; increments, resets or no-ops the streak. */
export function recordDailyPlay(today: Date = new Date()): StreakState {
  const key = dayKey(today);
  const prev = loadStreak();
  if (prev.lastPlayedDate === key) return prev; // already recorded today
  const count = prev.lastPlayedDate && isYesterday(prev.lastPlayedDate, today) ? prev.count + 1 : 1;
  const next: StreakState = { count, lastPlayedDate: key };
  safeSet(STREAK_KEY, JSON.stringify(next));
  return next;
}
