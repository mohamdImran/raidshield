import { Devvit } from '@devvit/public-api';
import { KEYS, SHINGLE_SIZE } from './constants.js';
import { loadConfig } from './config.js';
import {
  isLockdownActive,
  recordAndCountVelocity,
  recordClusterHit,
} from './redis.js';
import { fingerprintText, generateShingles } from './shingling.js';
import { quarantineContent, tripCircuitBreaker, type AnyContext } from './mitigation.js';


interface ContentEvent {
  contentId: string;
  contentType: 'post' | 'comment';
  authorId: string;
  subredditId: string;
  text: string;
  authorCreatedAtMs?: number;
}

async function runDetectionPipeline(
  event: ContentEvent,
  context: AnyContext
): Promise<void> {
  const { contentId, contentType, authorId, subredditId, text, authorCreatedAtMs } = event;

  const cfg = await loadConfig(context.redis, subredditId);

  const lockdown = await isLockdownActive(context.redis, subredditId);
  if (lockdown) {
    if (cfg.autoQuarantine) {
      await quarantineContent(context, contentId, contentType, 'Active lockdown — circuit breaker engaged');
    }
    return;
  }

  if (cfg.velocityEnabled) {
    const velocityKey = contentType === 'post'
      ? KEYS.velocityPosts(subredditId)
      : KEYS.velocityComments(subredditId);

    const windowMs = cfg.velocityWindowSec * 1000;
    const activeCount = await recordAndCountVelocity(context.redis, velocityKey, authorId, windowMs);

    if (activeCount > cfg.velocityThreshold) {
      await tripCircuitBreaker(
        context,
        subredditId,
        `Velocity threshold breached: ${activeCount} ${contentType}s/${cfg.velocityWindowSec}s (limit: ${cfg.velocityThreshold})`,
        contentId,
        cfg
      );
      if (cfg.autoQuarantine) {
        await quarantineContent(context, contentId, contentType, 'Velocity threshold exceeded');
      }
      return;
    }
  }

  if (cfg.swarmEnabled && authorCreatedAtMs !== undefined) {
    const accountAgeDays = (Date.now() - authorCreatedAtMs) / 86_400_000;

    if (accountAgeDays < cfg.newAccountAgeDays) {
      const newAcctKey = KEYS.newAccountVelocity(subredditId);
      const windowMs = cfg.velocityWindowSec * 1000;

      const velocityKey = contentType === 'post'
        ? KEYS.velocityPosts(subredditId)
        : KEYS.velocityComments(subredditId);

      const [newAcctCount, totalCount] = await Promise.all([
        recordAndCountVelocity(context.redis, newAcctKey, authorId, windowMs),
        recordAndCountVelocity(context.redis, velocityKey, authorId, windowMs),
      ]);

      if (totalCount > 0) {
        const newAcctRatio = newAcctCount / totalCount;
        const halfThreshold = cfg.velocityThreshold * 0.5;

        if (newAcctRatio >= cfg.newAccountRatioThreshold && totalCount > halfThreshold) {
          await tripCircuitBreaker(
            context,
            subredditId,
            `New-account swarm: ${newAcctCount} submissions from accounts <${cfg.newAccountAgeDays}d old (${Math.round(newAcctRatio * 100)}% of traffic)`,
            contentId,
            cfg
          );
          if (cfg.autoQuarantine) {
            await quarantineContent(context, contentId, contentType, 'New-account swarm spike');
          }
          return;
        }
      }
    }
  }

  if (cfg.clusterEnabled && text && text.length > 10) {
    const fingerprint = fingerprintText(text);
    const clusterWindowMs = cfg.clusterWindowSec * 1000;
    const clusterCount = await recordClusterHit(
      context.redis,
      subredditId,
      fingerprint,
      authorId,
      clusterWindowMs
    );

    if (clusterCount >= cfg.clusterThreshold) {
      await tripCircuitBreaker(
        context,
        subredditId,
        `Text cluster threshold breached: ${clusterCount} accounts posted identical content within ${cfg.clusterWindowSec}s`,
        contentId,
        cfg
      );
      if (cfg.autoQuarantine) {
        await quarantineContent(context, contentId, contentType, 'Coordinated identical content cluster');
      }
      return;
    }

    if (clusterCount >= Math.floor(cfg.clusterThreshold * 0.6)) {
      const shingles = generateShingles(text, SHINGLE_SIZE);
      console.warn(
        `[RaidShield] Near-cluster warning: ${clusterCount}/${cfg.clusterThreshold} accounts, ` +
        `fingerprint=${fingerprint}, shingles=${shingles.size}`
      );
    }
  }
}


Devvit.addTrigger({
  event: 'PostCreate',
  onEvent: async (event, context) => {
    const authorId = event.author?.id;
    const subredditId = event.subreddit?.id;
    const postId = event.post?.id;
    if (!authorId || !subredditId || !postId) return;

    const text = [event.post?.title ?? '', event.post?.selftext ?? ''].join(' ').trim();

    let authorCreatedAtMs: number | undefined;
    try {
      const author = await context.reddit.getUserById(authorId);
      authorCreatedAtMs = author?.createdAt?.getTime();
    } catch { /* non-fatal */ }

    await runDetectionPipeline(
      { contentId: postId, contentType: 'post', authorId, subredditId, text, authorCreatedAtMs },
      context
    );
  },
});


Devvit.addTrigger({
  event: 'CommentCreate',
  onEvent: async (event, context) => {
    const authorId = event.author?.id;
    const subredditId = event.subreddit?.id;
    const commentId = event.comment?.id;
    if (!authorId || !subredditId || !commentId) return;

    const text = event.comment?.body ?? '';

    let authorCreatedAtMs: number | undefined;
    try {
      const author = await context.reddit.getUserById(authorId);
      authorCreatedAtMs = author?.createdAt?.getTime();
    } catch { /* non-fatal */ }

    await runDetectionPipeline(
      { contentId: commentId, contentType: 'comment', authorId, subredditId, text, authorCreatedAtMs },
      context
    );
  },
});
