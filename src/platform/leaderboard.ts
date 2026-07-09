import type { Difficulty } from '../core/types';

export type LeaderboardMode = 'alltime' | 'daily';

export interface LeaderboardEntry {
  readonly rank: number;
  readonly playerId: string;
  readonly nickname: string;
  readonly score: number;
}

export async function fetchLeaderboard(
  mode: LeaderboardMode,
  difficulty: Difficulty,
): Promise<LeaderboardEntry[] | null> {
  try {
    const params = new URLSearchParams({ mode, difficulty });
    const res = await fetch(`/api/leaderboard?${params.toString()}`);
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return Array.isArray(data) ? (data as LeaderboardEntry[]) : null;
  } catch {
    return null;
  }
}

export interface SubmitResult {
  readonly rank: number | null;
}

export async function submitScore(
  mode: LeaderboardMode,
  difficulty: Difficulty,
  score: number,
  player: { id: string; nickname: string },
): Promise<SubmitResult> {
  try {
    const res = await fetch('/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: player.id,
        nickname: player.nickname,
        score,
        difficulty,
        mode,
      }),
    });
    if (!res.ok) return { rank: null };
    const data: unknown = await res.json();
    const rank =
      data && typeof (data as { rank?: unknown }).rank === 'number'
        ? (data as { rank: number }).rank
        : null;
    return { rank };
  } catch {
    return { rank: null };
  }
}
