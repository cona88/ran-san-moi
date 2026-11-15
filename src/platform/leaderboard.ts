import type { Difficulty } from '../core/types';

export type LeaderboardMode = 'alltime' | 'daily';

export interface LeaderboardEntry {
  readonly rank: number;
  readonly playerId: string;
  readonly nickname: string;
  readonly score: number;
}

export interface SubmitResult {
  readonly rank: number | null;
}

interface StoredRecord {
  readonly playerId: string;
  readonly nickname: string;
  readonly score: number;
  readonly seq: number;
}

type LeaderboardStore = Record<string, StoredRecord[]>;

const LEADERBOARD_KEY = 'magicSnakeLocalLeaderboard';
const MAX_LOCAL_ENTRIES = 10;

function bucketKey(mode: LeaderboardMode, difficulty: Difficulty): string {
  return `${mode}:${difficulty}`;
}

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

function loadStore(): LeaderboardStore {
  const raw = safeGet(LEADERBOARD_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const store: LeaderboardStore = {};
    for (const [k, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      store[k] = list.filter(
        (item): item is StoredRecord =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as StoredRecord).playerId === 'string' &&
          typeof (item as StoredRecord).nickname === 'string' &&
          typeof (item as StoredRecord).score === 'number' &&
          Number.isFinite((item as StoredRecord).score),
      );
    }
    return store;
  } catch {
    return {};
  }
}

function sortRecords(records: readonly StoredRecord[]): StoredRecord[] {
  return [...records]
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : (a.seq ?? 0) - (b.seq ?? 0)))
    .slice(0, MAX_LOCAL_ENTRIES);
}

/**
 * Return local offline leaderboard records stored in `localStorage`.
 * Never performs any network request so offline macOS runs stay 100% error-free.
 */
export async function fetchLeaderboard(
  mode: LeaderboardMode,
  difficulty: Difficulty,
): Promise<LeaderboardEntry[]> {
  const store = loadStore();
  const records = sortRecords(store[bucketKey(mode, difficulty)] ?? []);
  return records.map((entry, idx) => ({
    rank: idx + 1,
    playerId: entry.playerId,
    nickname: entry.nickname,
    score: entry.score,
  }));
}

/**
 * Persist a personal score into the local offline leaderboard and return its
 * 1-based rank (or `null` if score is <= 0 or outside top 10).
 */
export async function submitScore(
  mode: LeaderboardMode,
  difficulty: Difficulty,
  score: number,
  player: { id: string; nickname: string },
): Promise<SubmitResult> {
  if (!Number.isFinite(score) || score <= 0) {
    return { rank: null };
  }

  const cleanScore = Math.floor(score);
  const cleanNickname = player.nickname.trim().slice(0, 16) || 'Bé Tiên';
  const store = loadStore();
  const key = bucketKey(mode, difficulty);
  const existing = store[key] ?? [];
  const nextSeq = existing.reduce((max, r) => Math.max(max, r.seq ?? 0), 0) + 1;
  const candidate: StoredRecord = {
    playerId: player.id,
    nickname: cleanNickname,
    score: cleanScore,
    seq: nextSeq,
  };

  const updated = sortRecords([...existing, candidate]);
  store[key] = updated;
  safeSet(LEADERBOARD_KEY, JSON.stringify(store));

  const index = updated.findIndex((r) => r.seq === nextSeq && r.playerId === player.id);
  return { rank: index >= 0 ? index + 1 : null };
}
