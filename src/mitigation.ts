import type { Devvit, TriggerContext } from '@devvit/public-api';
import type { RaidShieldConfig } from './config.js';

export type AnyContext = Devvit.Context | TriggerContext;
import { DEFAULT_CONFIG } from './config.js';
import {
  setLockdown,
  clearLockdown,
  incrementIncidentCount,
  logIncident,
  type IncidentEntry,
} from './redis.js';

export async function quarantineContent(
  context: AnyContext,
  contentId: string,
  contentType: 'post' | 'comment',
  reason: string
): Promise<void> {
  try {
    await context.reddit.remove(contentId, true);
    console.log(`[RaidShield] Quarantined ${contentType} ${contentId} — ${reason}`);
  } catch (err) {
    console.error(`[RaidShield] Failed to quarantine ${contentType} ${contentId}:`, err);
  }
}

export async function tripCircuitBreaker(
  context: AnyContext,
  subredditId: string,
  reason: string,
  itemId?: string,
  cfg: RaidShieldConfig = DEFAULT_CONFIG
): Promise<void> {
  const durationMs = cfg.autoLockdownMinutes * 60_000;

  await setLockdown(context.redis, subredditId, true, durationMs, reason, 'auto-detector');

  const incidentEntry: IncidentEntry = {
    ts: Date.now(),
    type: reason.toLowerCase().includes('cluster') ? 'cluster'
        : reason.toLowerCase().includes('swarm') ? 'velocity'
        : 'velocity',
    reason,
    itemId,
  };

  await Promise.all([
    incrementIncidentCount(context.redis, subredditId),
    logIncident(context.redis, subredditId, incidentEntry),
  ]);

  try {
    const subreddit = await context.reddit.getSubredditById(subredditId);
    if (subreddit) {
      await context.reddit.sendPrivateMessage({
        to: `/r/${subreddit.name}`,
        subject: `🛡️ RaidShield: Automatic Lockdown Activated`,
        text: [
          `**RaidShield has automatically locked down r/${subreddit.name}.**`,
          ``,
          `**Reason:** ${reason}`,
          ``,
          `**Duration:** ${cfg.autoLockdownMinutes} minutes`,
          `**Triggered at:** ${new Date().toUTCString()}`,
          itemId ? `**Content ID:** ${itemId}` : '',
          ``,
          `All new submissions from non-approved users are being held in the mod queue.`,
          ``,
          `To lift the lockdown early, open the RaidShield Dashboard and tap **Lift Emergency Lockdown**.`,
        ].filter(Boolean).join('\n'),
      });
    }
  } catch (err) {
    console.error('[RaidShield] Failed to send modmail notification:', err);
  }

  console.warn(`[RaidShield] ⚡ Circuit breaker TRIPPED (${cfg.autoLockdownMinutes}min) — ${reason}`);
}

export async function activateManualLockdown(
  context: AnyContext,
  subredditId: string,
  modUsername: string,
  cfg: RaidShieldConfig = DEFAULT_CONFIG
): Promise<void> {
  const durationMs = cfg.manualLockdownMinutes * 60_000;

  await setLockdown(
    context.redis,
    subredditId,
    true,
    durationMs,
    `Manual emergency lockdown (${cfg.manualLockdownMinutes}min)`,
    modUsername
  );

  await logIncident(context.redis, subredditId, {
    ts: Date.now(),
    type: 'manual',
    reason: `Manual lockdown by u/${modUsername} (${cfg.manualLockdownMinutes}min)`,
  });

  console.warn(`[RaidShield] 🔴 Manual lockdown activated by u/${modUsername} for ${cfg.manualLockdownMinutes}min`);
}


export async function liftLockdown(
  context: AnyContext,
  subredditId: string,
  modUsername: string
): Promise<void> {
  await clearLockdown(context.redis, subredditId);
  console.log(`[RaidShield] ✅ Lockdown lifted by u/${modUsername}`);
}
