import type { RedisClient } from '@devvit/public-api';
import {
  KEYS,
  VELOCITY_WINDOW_MS,
  MAX_VELOCITY_MEMBERS,
  CLUSTER_WINDOW_MS,
} from './constants.js';


export async function isLockdownActive(
  redis: RedisClient,
  subredditId: string
): Promise<boolean> {
  const val = await redis.get(KEYS.lockdown(subredditId));
  return val === 'true';
}

export async function setLockdown(
  redis: RedisClient,
  subredditId: string,
  active: boolean,
  durationMs: number,
  reason: string,
  triggeredBy: string = 'system'
): Promise<void> {
  const expiry = new Date(Date.now() + durationMs);
  await Promise.all([
    redis.set(KEYS.lockdown(subredditId), String(active), { expiration: expiry }),
    redis.set(KEYS.lockdownReason(subredditId), reason, { expiration: expiry }),
    redis.set(KEYS.lockdownTriggeredBy(subredditId), triggeredBy, { expiration: expiry }),
  ]);
}

export async function clearLockdown(
  redis: RedisClient,
  subredditId: string
): Promise<void> {
  await Promise.all([
    redis.del(KEYS.lockdown(subredditId)),
    redis.del(KEYS.lockdownReason(subredditId)),
    redis.del(KEYS.lockdownTriggeredBy(subredditId)),
  ]);
}

export async function getLockdownMeta(
  redis: RedisClient,
  subredditId: string
): Promise<{ reason: string; triggeredBy: string }> {
  const [reason, triggeredBy] = await Promise.all([
    redis.get(KEYS.lockdownReason(subredditId)),
    redis.get(KEYS.lockdownTriggeredBy(subredditId)),
  ]);
  return {
    reason: reason ?? 'Unknown',
    triggeredBy: triggeredBy ?? 'system',
  };
}

export async function recordAndCountVelocity(
  redis: RedisClient,
  key: string,
  memberId: string,
  windowMs: number = VELOCITY_WINDOW_MS
): Promise<number> {
  const now = Date.now();
  const windowStart = now - windowMs;

  await redis.zAdd(key, { score: now, member: `${memberId}:${now}` });
  await redis.zRemRangeByScore(key, 0, windowStart);

  
  const count = await redis.zCard(key);
  if (count > MAX_VELOCITY_MEMBERS) {
    await redis.zRemRangeByRank(key, 0, count - MAX_VELOCITY_MEMBERS - 1);
  }

  return Math.min(count, MAX_VELOCITY_MEMBERS);
}

export async function recordClusterHit(
  redis: RedisClient,
  subredditId: string,
  fingerprint: string,
  authorId: string,
  windowMs: number = CLUSTER_WINDOW_MS
): Promise<number> {
  const key = KEYS.clusterHash(subredditId, fingerprint);
  const now = Date.now();
  const windowStart = now - windowMs;

  await redis.zAdd(key, { score: now, member: authorId });
  await redis.zRemRangeByScore(key, 0, windowStart);

  const count = await redis.zCard(key);


  return count;
}


export async function incrementIncidentCount(
  redis: RedisClient,
  subredditId: string
): Promise<number> {
  const key = KEYS.incidentCount(subredditId);
  const current = await redis.get(key);
  const next = (parseInt(current ?? '0', 10) + 1);

  await redis.set(key, String(next), { expiration: new Date(Date.now() + 86_400_000) });
  return next;
}

export async function getIncidentCount(
  redis: RedisClient,
  subredditId: string
): Promise<number> {
  const val = await redis.get(KEYS.incidentCount(subredditId));
  return parseInt(val ?? '0', 10);
}

export interface IncidentEntry {
  ts: number;
  type: 'velocity' | 'cluster' | 'manual';
  reason: string;
  itemId?: string;
}

export async function logIncident(
  redis: RedisClient,
  subredditId: string,
  entry: IncidentEntry
): Promise<void> {
  const key = KEYS.incidentLog(subredditId);
  const now = Date.now();
  await redis.zAdd(key, { score: now, member: JSON.stringify(entry) });

  const count = await redis.zCard(key);
  if (count > 100) {
    await redis.zRemRangeByRank(key, 0, count - 101);
  }
}

export async function getRecentIncidents(
  redis: RedisClient,
  subredditId: string,
  limit: number = 10
): Promise<IncidentEntry[]> {
  const key = KEYS.incidentLog(subredditId);
  const members = await redis.zRange(key, 0, limit - 1, {
    reverse: true,
    by: 'score'
  });
  return members
    .map((m) => {
      try {
        return JSON.parse(typeof m === 'string' ? m : (m as { member: string }).member) as IncidentEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is IncidentEntry => e !== null);
}


export async function getDashboardPostId(
  redis: RedisClient,
  subredditId: string
): Promise<string | undefined> {
  return redis.get(KEYS.dashboardPostId(subredditId));
}

export async function setDashboardPostId(
  redis: RedisClient,
  subredditId: string,
  postId: string
): Promise<void> {
  await redis.set(KEYS.dashboardPostId(subredditId), postId);
}
