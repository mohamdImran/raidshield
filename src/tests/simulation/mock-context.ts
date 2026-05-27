import type { SimulatedUser } from './types.js';

type ZMember = { score: number; member: string };

export function createMockRedis() {
  const store = new Map<string, string>();
  const zsets = new Map<string, ZMember[]>();

  return {
    _store: store,
    _zsets: zsets,

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
      zsets.set(key, zsets.get(key)!.filter((m) => m.score < min || m.score > max));
    },
    async zRemRangeByRank(key: string, start: number, stop: number) {
      if (!zsets.has(key)) return;
      zsets.get(key)!.splice(start, stop - start + 1);
    },
    async zCard(key: string) { return zsets.get(key)?.length ?? 0; },
    async zRange(key: string, start: number, stop: number, opts?: { reverse?: boolean }) {
      const set = zsets.get(key) ?? [];
      const ordered = opts?.reverse ? [...set].reverse() : set;
      const end = stop < 0 ? set.length + stop + 1 : stop + 1;
      return ordered.slice(start, end).map((m) => m.member);
    },
  };
}

export interface QuarantineRecord {
  contentId: string;
  reason: string;
  ts: number;
}

export function createMockRedditApi(users: SimulatedUser[]) {
  const userMap = new Map(users.map((u) => [u.id, u]));
  const removed = new Set<string>();

  return {
    _removed: removed,

    async getUserById(id: string) {
      const u = userMap.get(id);
      if (!u) return null;
      const createdAt = new Date(Date.now() - u.accountAgeDays * 86_400_000);
      return { username: u.name, createdAt };
    },

    async remove(contentId: string, _spam: boolean) {
      removed.add(contentId);
    },
  };
}

export function createMockContext(users: SimulatedUser[]) {
  const redis = createMockRedis();
  const reddit = createMockRedditApi(users);
  const quarantined: QuarantineRecord[] = [];
  const originalRemove = reddit.remove.bind(reddit);
  reddit.remove = async (contentId: string, spam: boolean) => {
    await originalRemove(contentId, spam);

    quarantined.push({ contentId, reason: '', ts: Date.now() });
  };

  return {
    redis,
    reddit,
    subredditId: 'test_subreddit_001',
    quarantined,
    ui: { showToast: () => {} },
    modLog: { add: async () => {} },
  };
}

export type MockContext = ReturnType<typeof createMockContext>;
