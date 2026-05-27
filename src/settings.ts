import { Devvit } from '@devvit/public-api';
import { patchConfig, loadConfig, saveConfig } from './config.js';

Devvit.addSettings([
  {
    type: 'group',
    label: 'Velocity Monitor',
    fields: [
      {
        name: 'velocityThreshold',
        type: 'number',
        label: 'Submission rate limit (per minute)',
        helpText: 'Max total posts+comments per 60-second window before lockdown triggers. Default: 30.',
        defaultValue: 30,
      },
      {
        name: 'velocityEnabled',
        type: 'boolean',
        label: 'Enable velocity monitor',
        helpText: 'Disable to turn off rate-based detection entirely.',
        defaultValue: true,
      },
    ],
  },


  {
    type: 'group',
    label: 'New-Account Swarm Detector',
    fields: [
      {
        name: 'newAccountAgeDays',
        type: 'number',
        label: 'New account age threshold (days)',
        helpText: 'Accounts younger than this are tracked separately for swarm detection. Default: 30.',
        defaultValue: 30,
      },
      {
        name: 'swarmEnabled',
        type: 'boolean',
        label: 'Enable new-account swarm detector',
        defaultValue: true,
      },
    ],
  },


  {
    type: 'group',
    label: 'Text Cluster Detector',
    fields: [
      {
        name: 'clusterThreshold',
        type: 'number',
        label: 'Cluster threshold (unique accounts)',
        helpText: 'How many different accounts must post identical content within 3 minutes to trigger lockdown. Default: 50.',
        defaultValue: 50,
      },
      {
        name: 'clusterEnabled',
        type: 'boolean',
        label: 'Enable text cluster detector',
        defaultValue: true,
      },
    ],
  },

  {
    type: 'group',
    label: 'Lockdown Behaviour',
    fields: [
      {
        name: 'autoLockdownMinutes',
        type: 'number',
        label: 'Auto-lockdown duration (minutes)',
        helpText: 'How long the circuit breaker holds when triggered automatically. Default: 30.',
        defaultValue: 30,
      },
      {
        name: 'manualLockdownMinutes',
        type: 'number',
        label: 'Manual lockdown duration (minutes)',
        helpText: 'How long the emergency lockdown lasts when a mod presses the button. Default: 60.',
        defaultValue: 60,
      },
      {
        name: 'autoQuarantine',
        type: 'boolean',
        label: 'Auto-quarantine flagged content',
        helpText: 'When enabled, flagged posts/comments are silently removed to the mod queue. Disable to log-only mode.',
        defaultValue: true,
      },
    ],
  },
]);


Devvit.addTrigger({
  event: 'AppInstall',
  async onEvent(event, context) {
    const subredditId = event.subreddit?.id;
    if (!subredditId) return;

    try {
      const settings = await context.settings.getAll();

      await patchConfig(context.redis, subredditId, {
        velocityThreshold: Number(settings['velocityThreshold'] ?? 30),
        velocityEnabled: Boolean(settings['velocityEnabled'] ?? true),
        newAccountAgeDays: Number(settings['newAccountAgeDays'] ?? 30),
        swarmEnabled: Boolean(settings['swarmEnabled'] ?? true),
        clusterThreshold: Number(settings['clusterThreshold'] ?? 50),
        clusterEnabled: Boolean(settings['clusterEnabled'] ?? true),
        autoLockdownMinutes: Number(settings['autoLockdownMinutes'] ?? 30),
        manualLockdownMinutes: Number(settings['manualLockdownMinutes'] ?? 60),
        autoQuarantine: Boolean(settings['autoQuarantine'] ?? true),
      });

      console.log(`[RaidShield] Config seeded from install settings for subreddit ${subredditId}`);
    } catch (err) {
      console.error('[RaidShield] Failed to seed config on install:', err);
    }
  },
});


Devvit.addTrigger({
  event: 'AppUpgrade',
  async onEvent(event, context) {
    const subredditId = event.subreddit?.id;
    if (!subredditId) return;

    try {
      const current = await loadConfig(context.redis, subredditId);
      await saveConfig(context.redis, subredditId, current);
      console.log(`[RaidShield] Config migrated on upgrade for subreddit ${subredditId}`);
    } catch (err) {
      console.error('[RaidShield] Failed to migrate config on upgrade:', err);
    }
  },
});
