import { vi } from 'vitest';
import type { ScenarioConfig, EventResult, SimulationReport } from './types.js';
import { createMockContext } from './mock-context.js';
import {
  isLockdownActive,
  recordAndCountVelocity,
  recordClusterHit,
  getIncidentCount,
} from '../../redis.js';
import { fingerprintText } from '../../shingling.js';
import { quarantineContent, tripCircuitBreaker } from '../../mitigation.js';
import { DEFAULT_CONFIG } from '../../config.js';
import { KEYS } from '../../constants.js';

const { velocityThreshold: VELOCITY_THRESHOLD, clusterThreshold: CLUSTER_THRESHOLD, newAccountAgeDays: NEW_ACCOUNT_AGE_DAYS } = DEFAULT_CONFIG;


function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function processEvent(
  contentId: string,
  contentType: 'post' | 'comment',
  authorId: string,
  subredditId: string,
  text: string,
  authorCreatedAtMs: number | undefined,
  ctx: ReturnType<typeof createMockContext>
): Promise<{ quarantined: boolean; lockdownTripped: boolean; reason?: string }> {

  const lockdown = await isLockdownActive(ctx.redis as any, subredditId);
  if (lockdown) {
    await quarantineContent(ctx as any, contentId, contentType, 'Active lockdown');
    return { quarantined: true, lockdownTripped: true, reason: 'active-lockdown' };
  }


  const velocityKey = contentType === 'post'
    ? KEYS.velocityPosts(subredditId)
    : KEYS.velocityComments(subredditId);

  const activeCount = await recordAndCountVelocity(ctx.redis as any, velocityKey, authorId);

  if (activeCount > VELOCITY_THRESHOLD) {
    await tripCircuitBreaker(ctx as any, subredditId,
      `Velocity threshold breached: ${activeCount}/min`, contentId);
    await quarantineContent(ctx as any, contentId, contentType, 'Velocity exceeded');
    return { quarantined: true, lockdownTripped: true, reason: 'velocity' };
  }

  if (authorCreatedAtMs !== undefined) {
    const ageDays = (Date.now() - authorCreatedAtMs) / 86_400_000;
    if (ageDays < NEW_ACCOUNT_AGE_DAYS) {
      const newAcctKey = KEYS.newAccountVelocity(subredditId);
      const newAcctCount = await recordAndCountVelocity(ctx.redis as any, newAcctKey, authorId);
      if (activeCount > 0) {
        const ratio = newAcctCount / activeCount;
        if (ratio > 0.75 && activeCount > VELOCITY_THRESHOLD * 0.5) {
          await tripCircuitBreaker(ctx as any, subredditId,
            `New-account swarm: ${Math.round(ratio * 100)}% new-account traffic`, contentId);
          await quarantineContent(ctx as any, contentId, contentType, 'New-account swarm');
          return { quarantined: true, lockdownTripped: true, reason: 'swarm' };
        }
      }
    }
  }

  if (text.length > 10) {
    const fp = fingerprintText(text);
    const clusterCount = await recordClusterHit(ctx.redis as any, subredditId, fp, authorId);
    if (clusterCount >= CLUSTER_THRESHOLD) {
      await tripCircuitBreaker(ctx as any, subredditId,
        `Cluster threshold: ${clusterCount} accounts posted identical content`, contentId);
      await quarantineContent(ctx as any, contentId, contentType, 'Content cluster');
      return { quarantined: true, lockdownTripped: true, reason: 'cluster' };
    }
  }

  return { quarantined: false, lockdownTripped: false };
}

export async function runScenario(config: ScenarioConfig): Promise<SimulationReport> {
  const ctx = createMockContext(config.events.map((e) => e.user));
  const results: EventResult[] = [];
  const failures: string[] = [];
  const sorted = [...config.events].sort((a, b) => a.offsetMs - b.offsetMs);
  const startTime = 1_700_000_000_000; 
  vi.useFakeTimers();
  vi.setSystemTime(startTime);

  for (const evt of sorted) {
    
    vi.setSystemTime(startTime + evt.offsetMs);

    const user = evt.user;
    const authorCreatedAtMs = (startTime + evt.offsetMs) - user.accountAgeDays * 86_400_000;

    const t0 = performance.now();
    const outcome = await processEvent(
      evt.contentId,
      evt.contentType,
      user.id,
      config.subredditId,
      evt.text,
      authorCreatedAtMs,
      ctx
    );
    const latencyMs = performance.now() - t0;

    results.push({
      contentId: evt.contentId,
      quarantined: outcome.quarantined,
      lockdownTripped: outcome.lockdownTripped,
      latencyMs,
      reason: outcome.reason,
    });
  }

  vi.useRealTimers();

  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const quarantinedCount = results.filter((r) => r.quarantined).length;
  const lockdownTripped = results.some((r) => r.lockdownTripped);
  const incidentCount = await getIncidentCount(ctx.redis as any, config.subredditId);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const maxLatency = latencies[latencies.length - 1] ?? 0;

  if (lockdownTripped !== config.expectedLockdown) {
    failures.push(
      `Lockdown state mismatch: expected=${config.expectedLockdown}, got=${lockdownTripped}`
    );
  }
  if (incidentCount < config.expectedMinIncidents) {
    failures.push(
      `Incident count too low: expected>=${config.expectedMinIncidents}, got=${incidentCount}`
    );
  }
  if (maxLatency > config.maxLatencyMs) {
    failures.push(
      `Max latency exceeded: limit=${config.maxLatencyMs}ms, got=${maxLatency.toFixed(2)}ms`
    );
  }

  return {
    scenario: config.name,
    attackType: config.attackType,
    totalEvents: results.length,
    quarantinedCount,
    lockdownTripped,
    incidentCount,
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    p99LatencyMs: p99,
    maxLatencyMs: maxLatency,
    passed: failures.length === 0,
    failures,
  };
}
