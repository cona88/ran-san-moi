import { Redis } from '@upstash/redis';
// `api/*.ts` isn't bundled the way `vite build` bundles the client — Vercel's
// Node.js Functions build transpiles each file individually and leaves
// relative imports for native Node ESM to resolve at runtime (this project
// is `"type": "module"`). That resolver requires the exact file, extension
// included: neither a directory import (`'../src/core'`, ERR_UNSUPPORTED_DIR_IMPORT)
// nor an extensionless file path (`'../src/core/config'`, ERR_MODULE_NOT_FOUND)
// works — only the fully-qualified `.js` specifier does, confirmed by hitting
// both errors in production before landing on this.
import { configFor } from '../src/core/config.js';
import type { Difficulty } from '../src/core/types.js';

const NICKNAME_MAX = 16;
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

interface ScoreSubmission {
  playerId: string;
  nickname: string;
  score: number;
  difficulty: Difficulty;
  mode: 'alltime' | 'daily';
}

function maxAchievableScore(difficulty: Difficulty): number {
  const config = configFor(difficulty);
  const tightest = config.maxGrid - 2 * config.maxMargin;
  return tightest * tightest - config.initialLength;
}

function isValidSubmission(body: unknown): body is ScoreSubmission {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.playerId !== 'string' || b.playerId.length === 0 || b.playerId.length > 64)
    return false;
  if (typeof b.nickname !== 'string' || b.nickname.length === 0) return false;
  if (typeof b.score !== 'number' || !Number.isInteger(b.score) || b.score < 0) return false;
  if (typeof b.difficulty !== 'string' || !DIFFICULTIES.includes(b.difficulty as Difficulty))
    return false;
  if (b.mode !== 'alltime' && b.mode !== 'daily') return false;
  return b.score <= maxAchievableScore(b.difficulty as Difficulty);
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

// A named `POST` export, not `export default` — see the comment in
// api/leaderboard.ts for why (a default export silently swallows the
// Response we return under this runtime's routing).
export async function POST(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!isValidSubmission(body)) {
    return Response.json({ error: 'invalid submission' }, { status: 400 });
  }

  const redis = redisOrNull();
  if (!redis) {
    return Response.json({ error: 'leaderboard offline' }, { status: 503 });
  }

  const limited = await redis.set(`ratelimit:${body.playerId}`, 1, { nx: true, ex: 3 });
  if (limited === null) {
    return Response.json({ error: 'rate limited' }, { status: 429 });
  }

  const nickname = body.nickname.slice(0, NICKNAME_MAX);
  await redis.hset('players', { [body.playerId]: nickname });

  // Daily mode always targets today's board regardless of the client-sent
  // difficulty: the daily challenge is fixed to 'normal', and trusting a
  // client-sent difficulty here would let a submission dodge the shared board.
  const key =
    body.mode === 'daily'
      ? `leaderboard:daily:${todayKey()}`
      : `leaderboard:alltime:${body.difficulty}`;

  await redis.zadd(key, { gt: true }, { score: body.score, member: body.playerId });
  if (body.mode === 'daily') {
    await redis.expire(key, 60 * 60 * 24 * 4);
  }

  const rank = await redis.zrevrank(key, body.playerId);
  return Response.json({ rank: rank === null ? null : rank + 1 });
}
