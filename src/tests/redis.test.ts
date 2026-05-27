import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isLockdownActive,
  setLockdown,
  clearLockdown,
  recordAndCountVelocity,
  recordClusterHit,
  incrementIncidentCount,
  getIncidentCount,
} from '../redis.js';


type ZMember = { score: number; member: string };

function createRedisMock() {
  const store = new Map<string, string>();
  const zsets = new Map<string, ZMember[]>();

  return {
    async get(key: string) { return store.get(key) ?? null; },
    async set(key: string, value: string, _opts?: unknown) { store.set(key, value); },
    async del(key: string) { store.delete(key); zsets.delete(key); },


    async zAdd(key: string, member: ZMember) {
      if (!zsets.has(key)) zsets.set(key, []);
      const set = zsets.get(key)!;
      const idx = set.findIndex((m) => m.member === member.member);
      if (idx !== -1) set.splice(idx, 1);
      set.push(member);
      set.sort((a, b) => a.score - b.score);
    },
    async zRemRangeByScore(key: string, min: number, max: number) {
      if (!zsets.has(key)) return;
      const set = zsets.get(key)!;
      const filtered = set.filter((m) => m.score < min || m.score > max);
      zsets.set(key, filtered);
    },
    async zRemRangeByRank(key: string, start: number, stop: number) {
      if (!zsets.has(key)) return;
      const set = zsets.get(key)!;
      set.splice(start, stop - start + 1);
    },
    async zCard(key: string) {
      return zsets.get(key)?.length ?? 0;
    },
    async zRange(key: string, start: number, stop: number, opts?: { reverse?: boolean }) {
      const set = zsets.get(key) ?? [];
      const ordered = opts?.reverse ? [...set].reverse() : set;
      const end = stop < 0 ? set.length + stop + 1 : stop + 1;
      return ordered.slice(start, end).map((m) => m.member);
    },
  };
}

describe('lockdown state', () => {
  let redis: ReturnType<typeof createRedisMock>;

  beforeEach(() => { redis = createRedisMock(); });

  it('returns false when no lockdown is set', async () => {
    expect(await isLockdownActive(redis as any, 'sub1')).toBe(false);
  });

  it('returns true after setLockdown', async () => {
    await setLockdown(redis as any, 'sub1', true, 60_000, 'test reason', 'mod1');
    expect(await isLockdownActive(redis as any, 'sub1')).toBe(true);
  });

  it('returns false after clearLockdown', async () => {
    await setLockdown(redis as any, 'sub1', true, 60_000, 'test reason', 'mod1');
    await clearLockdown(redis as any, 'sub1');
    expect(await isLockdownActive(redis as any, 'sub1')).toBe(false);
  });
});

describe('recordAndCountVelocity (sliding window)', () => {
  let redis: ReturnType<typeof createRedisMock>;

  beforeEach(() => { redis = createRedisMock(); });

  it('counts events within the window', async () => {
    const key = 'test:velocity';
    const count1 = await recordAndCountVelocity(redis as any, key, 'user1', 60_000);
    const count2 = await recordAndCountVelocity(redis as any, key, 'user2', 60_000);
    const count3 = await recordAndCountVelocity(redis as any, key, 'user3', 60_000);
    expect(count1).toBe(1);
    expect(count2).toBe(2);
    expect(count3).toBe(3);
  });

  it('expires events outside the window', async () => {
    const key = 'test:velocity:expire';
    const oldTs = Date.now() - 120_000;
    await redis.zAdd(key, { score: oldTs, member: `olduser:${oldTs}` });
    const count = await recordAndCountVelocity(redis as any, key, 'newuser', 60_000);
    expect(count).toBe(1);
  });

  it('counts the same user multiple times when calls are spaced apart in time', async () => {

    vi.useFakeTimers();
    const key = 'test:velocity:sameuser';

    vi.setSystemTime(1_000_000);
    await recordAndCountVelocity(redis as any, key, 'user1', 60_000);

    vi.setSystemTime(1_001_000);
    await recordAndCountVelocity(redis as any, key, 'user1', 60_000);

    vi.setSystemTime(1_002_000); 
    const count = await recordAndCountVelocity(redis as any, key, 'user1', 60_000);

    expect(count).toBe(3);
    vi.useRealTimers();
  });
});

describe('recordClusterHit (text cluster tracking)', () => {
  let redis: ReturnType<typeof createRedisMock>;

  beforeEach(() => { redis = createRedisMock(); });

  it('counts unique authors per fingerprint', async () => {
    const count1 = await recordClusterHit(redis as any, 'sub1', 'fp_abc', 'author1');
    const count2 = await recordClusterHit(redis as any, 'sub1', 'fp_abc', 'author2');
    const count3 = await recordClusterHit(redis as any, 'sub1', 'fp_abc', 'author3');
    expect(count1).toBe(1);
    expect(count2).toBe(2);
    expect(count3).toBe(3);
  });

  it('deduplicates the same author posting the same content', async () => {
    await recordClusterHit(redis as any, 'sub1', 'fp_abc', 'author1');
    const count = await recordClusterHit(redis as any, 'sub1', 'fp_abc', 'author1');
    expect(count).toBe(1);
  });

  it('tracks different fingerprints independently', async () => {
    await recordClusterHit(redis as any, 'sub1', 'fp_aaa', 'author1');
    await recordClusterHit(redis as any, 'sub1', 'fp_aaa', 'author2');
    const countB = await recordClusterHit(redis as any, 'sub1', 'fp_bbb', 'author3');
    expect(countB).toBe(1); 
  });
});

describe('incident counter', () => {
  let redis: ReturnType<typeof createRedisMock>;

  beforeEach(() => { redis = createRedisMock(); });

  it('starts at 0', async () => {
    expect(await getIncidentCount(redis as any, 'sub1')).toBe(0);
  });

  it('increments correctly', async () => {
    await incrementIncidentCount(redis as any, 'sub1');
    await incrementIncidentCount(redis as any, 'sub1');
    expect(await getIncidentCount(redis as any, 'sub1')).toBe(2);
  });
});
