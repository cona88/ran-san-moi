import { Redis } from '@upstash/redis';

const DIFFICULTIES = new Set(['easy', 'normal', 'hard']);

interface LeaderboardEntry {
  rank: number;
  playerId: string;
  nickname: string;
  score: number;
}

function redisOrNull(): Redis | null {
  try {
    return Redis.fromEnv();
  } catch {
    return null;
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode');
  const difficulty = url.searchParams.get('difficulty') ?? 'normal';

  if (mode !== 'alltime' && mode !== 'daily') {
    return Response.json({ error: 'invalid mode' }, { status: 400 });
  }
  if (mode === 'alltime' && !DIFFICULTIES.has(difficulty)) {
    return Response.json({ error: 'invalid difficulty' }, { status: 400 });
  }

  const redis = redisOrNull();
  if (!redis) {
    return Response.json({ error: 'leaderboard offline' }, { status: 503 });
  }

  const key =
    mode === 'alltime' ? `leaderboard:alltime:${difficulty}` : `leaderboard:daily:${todayKey()}`;

  const raw = await redis.zrange<(string | number)[]>(key, 0, 9, { rev: true, withScores: true });
  const playerIds: string[] = [];
  const scores: number[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    playerIds.push(String(raw[i]));
    scores.push(Number(raw[i + 1]));
  }

  const nicknames =
    playerIds.length > 0 ? await redis.hmget<Record<string, string>>('players', ...playerIds) : {};

  const entries: LeaderboardEntry[] = playerIds.map((playerId, i) => ({
    rank: i + 1,
    playerId,
    nickname: nicknames?.[playerId] ?? 'anon',
    score: scores[i] ?? 0,
  }));

  return Response.json(entries);
}
