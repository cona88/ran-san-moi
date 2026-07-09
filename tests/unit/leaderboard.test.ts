import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLeaderboard, submitScore } from '../../src/platform/leaderboard';

afterEach(() => vi.unstubAllGlobals());

describe('fetchLeaderboard', () => {
  it('returns the parsed array on success', async () => {
    const entries = [{ rank: 1, playerId: 'a', nickname: 'A', score: 42 }];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(entries) }),
    );
    expect(await fetchLeaderboard('alltime', 'normal')).toEqual(entries);
  });

  it('returns null on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }),
    );
    expect(await fetchLeaderboard('alltime', 'normal')).toBeNull();
  });

  it('returns null when fetch throws (offline)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await fetchLeaderboard('daily', 'normal')).toBeNull();
  });

  it('returns null on malformed JSON (not an array)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ oops: true }) }),
    );
    expect(await fetchLeaderboard('alltime', 'hard')).toBeNull();
  });
});

describe('submitScore', () => {
  it('posts the right payload and returns the rank', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ rank: 2 }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitScore('alltime', 'hard', 30, { id: 'p1', nickname: 'Foo' });

    expect(result).toEqual({ rank: 2 });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/scores',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: 'p1',
          nickname: 'Foo',
          score: 30,
          difficulty: 'hard',
          mode: 'alltime',
        }),
      }),
    );
  });

  it('returns a null rank on failure or network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }),
    );
    expect(await submitScore('daily', 'normal', 5, { id: 'p1', nickname: 'Foo' })).toEqual({
      rank: null,
    });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    expect(await submitScore('daily', 'normal', 5, { id: 'p1', nickname: 'Foo' })).toEqual({
      rank: null,
    });
  });
});
