import { Devvit, useState, useForm, useInterval } from '@devvit/public-api';
import {
  isLockdownActive,
  getLockdownMeta,
  getIncidentCount,
  getRecentIncidents,
  setDashboardPostId,
} from './redis.js';
import { activateManualLockdown, liftLockdown } from './mitigation.js';
import { loadConfig, patchConfig } from './config.js';


const POLL_INTERVAL_MS = 5000;

type Tab = 'status' | 'settings';


const TIPS = {
  velocityThreshold: 'Max submissions per window before lockdown triggers. Lower = more sensitive. Set to 1 to trip on a single post (demo mode).',
  velocityWindow:    'Rolling time window in seconds for rate counting. 60s = 1 minute.',
  clusterThreshold:  'How many different accounts must post identical text to trigger lockdown. Set to 1 for single-account demo testing.',
  clusterWindow:     'How long (seconds) to track identical content across accounts.',
  newAccountDays:    'Accounts younger than this (days) are flagged as "new" for swarm detection.',
  autoLockdown:      'How long (minutes) the automatic circuit breaker holds after tripping.',
  manualLockdown:    'How long (minutes) the emergency lockdown button holds.',
  autoQuarantine:    'When ON, flagged content is silently moved to the mod queue. When OFF, detection logs only — nothing is removed.',
};

Devvit.addCustomPostType({
  name: 'RaidShield Dashboard',
  height: 'tall',
  render: (context) => {
    const subredditId = context.subredditId ?? '';

    
    const [isMod] = useState<boolean>(async () => {
      try {
        const user = await context.reddit.getCurrentUser();
        if (!user) return false;
        const sub = await context.reddit.getCurrentSubreddit();
        const perms = await user.getModPermissionsForSubreddit(sub.name);
        return perms.length > 0;
      } catch { return false; }
    });

    const [currentUsername] = useState<string>(async () => {
      try {
        const user = await context.reddit.getCurrentUser();
        return user?.username ?? '';
      } catch { return ''; }
    });

    
    const [activeTab, setActiveTab] = useState<Tab>('status');
    const [tooltip, setTooltip] = useState<string>('');

    
    const [lockdownActive, setLockdownActive] = useState<boolean>(async () =>
      isLockdownActive(context.redis, subredditId)
    );
    const [lockdownReason, setLockdownReason] = useState<string>(async () => {
      if (await isLockdownActive(context.redis, subredditId)) {
        return (await getLockdownMeta(context.redis, subredditId)).reason;
      }
      return '';
    });
    const [lockdownBy, setLockdownBy] = useState<string>(async () => {
      if (await isLockdownActive(context.redis, subredditId)) {
        return (await getLockdownMeta(context.redis, subredditId)).triggeredBy;
      }
      return '';
    });
    const [incidentCount, setIncidentCount] = useState<number>(async () =>
      getIncidentCount(context.redis, subredditId)
    );
    const [recentIncidents, setRecentIncidents] = useState<string>(async () =>
      JSON.stringify(await getRecentIncidents(context.redis, subredditId, 5))
    );


    useInterval(async () => {
      const [active, count, incidents] = await Promise.all([
        isLockdownActive(context.redis, subredditId),
        getIncidentCount(context.redis, subredditId),
        getRecentIncidents(context.redis, subredditId, 5),
      ]);

      setLockdownActive(active);
      setIncidentCount(count);
      setRecentIncidents(JSON.stringify(incidents));

      if (active) {
        const meta = await getLockdownMeta(context.redis, subredditId);
        setLockdownReason(meta.reason);
        setLockdownBy(meta.triggeredBy);
      } else {
        setLockdownReason('');
        setLockdownBy('');
      }
    }, POLL_INTERVAL_MS).start();


    const [velThreshold, setVelThreshold] = useState<number>(async () =>
      (await loadConfig(context.redis, subredditId)).velocityThreshold
    );
    const [velWindow, setVelWindow] = useState<number>(async () =>
      (await loadConfig(context.redis, subredditId)).velocityWindowSec
    );
    const [velEnabled, setVelEnabled] = useState<boolean>(async () =>
      (await loadConfig(context.redis, subredditId)).velocityEnabled
    );
    const [clusterThreshold, setClusterThreshold] = useState<number>(async () =>
      (await loadConfig(context.redis, subredditId)).clusterThreshold
    );
    const [clusterWindow, setClusterWindow] = useState<number>(async () =>
      (await loadConfig(context.redis, subredditId)).clusterWindowSec
    );
    const [clusterEnabled, setClusterEnabled] = useState<boolean>(async () =>
      (await loadConfig(context.redis, subredditId)).clusterEnabled
    );
    const [newAcctDays, setNewAcctDays] = useState<number>(async () =>
      (await loadConfig(context.redis, subredditId)).newAccountAgeDays
    );
    const [swarmEnabled, setSwarmEnabled] = useState<boolean>(async () =>
      (await loadConfig(context.redis, subredditId)).swarmEnabled
    );
    const [autoLockdownMin, setAutoLockdownMin] = useState<number>(async () =>
      (await loadConfig(context.redis, subredditId)).autoLockdownMinutes
    );
    const [manualLockdownMin, setManualLockdownMin] = useState<number>(async () =>
      (await loadConfig(context.redis, subredditId)).manualLockdownMinutes
    );
    const [autoQuarantine, setAutoQuarantine] = useState<boolean>(async () =>
      (await loadConfig(context.redis, subredditId)).autoQuarantine
    );



    const velocityForm = useForm(
      {
        title: 'Velocity Monitor Settings',
        description: 'Set the rate limit for submissions. Lower values = more sensitive detection.',
        fields: [
          {
            name: 'velocityThreshold',
            type: 'number',
            label: 'Rate limit (submissions per window)',
            helpText: TIPS.velocityThreshold,
            defaultValue: velThreshold,
          },
          {
            name: 'velocityWindowSec',
            type: 'number',
            label: 'Window size (seconds)',
            helpText: TIPS.velocityWindow,
            defaultValue: velWindow,
          },
          {
            name: 'velocityEnabled',
            type: 'boolean',
            label: 'Enable velocity monitor',
            defaultValue: velEnabled,
          },
        ],
      },
      async (values) => {
        const threshold = Math.max(1, Math.min(500, Number(values.velocityThreshold)));
        const window = Math.max(10, Math.min(300, Number(values.velocityWindowSec)));
        const enabled = Boolean(values.velocityEnabled);
        await patchConfig(context.redis, subredditId, {
          velocityThreshold: threshold,
          velocityWindowSec: window,
          velocityEnabled: enabled,
        });
        setVelThreshold(threshold);
        setVelWindow(window);
        setVelEnabled(enabled);
        context.ui.showToast('Velocity settings saved.');
      }
    );

    const clusterForm = useForm(
      {
        title: 'Text Cluster Settings',
        description: 'Detect coordinated identical content. Set threshold to 1 for single-account testing.',
        fields: [
          {
            name: 'clusterThreshold',
            type: 'number',
            label: 'Cluster threshold (unique accounts)',
            helpText: TIPS.clusterThreshold,
            defaultValue: clusterThreshold,
          },
          {
            name: 'clusterWindowSec',
            type: 'number',
            label: 'Cluster window (seconds)',
            helpText: TIPS.clusterWindow,
            defaultValue: clusterWindow,
          },
          {
            name: 'clusterEnabled',
            type: 'boolean',
            label: 'Enable text cluster detector',
            defaultValue: clusterEnabled,
          },
        ],
      },
      async (values) => {
        const threshold = Math.max(1, Math.min(200, Number(values.clusterThreshold)));
        const window = Math.max(30, Math.min(600, Number(values.clusterWindowSec)));
        const enabled = Boolean(values.clusterEnabled);
        await patchConfig(context.redis, subredditId, {
          clusterThreshold: threshold,
          clusterWindowSec: window,
          clusterEnabled: enabled,
        });
        setClusterThreshold(threshold);
        setClusterWindow(window);
        setClusterEnabled(enabled);
        context.ui.showToast('Cluster settings saved.');
      }
    );

    const swarmForm = useForm(
      {
        title: 'New-Account Swarm Settings',
        description: 'Detect coordinated activity from newly created accounts.',
        fields: [
          {
            name: 'newAccountAgeDays',
            type: 'number',
            label: 'New account age threshold (days)',
            helpText: TIPS.newAccountDays,
            defaultValue: newAcctDays,
          },
          {
            name: 'swarmEnabled',
            type: 'boolean',
            label: 'Enable new-account swarm detector',
            defaultValue: swarmEnabled,
          },
        ],
      },
      async (values) => {
        const days = Math.max(1, Math.min(365, Number(values.newAccountAgeDays)));
        const enabled = Boolean(values.swarmEnabled);
        await patchConfig(context.redis, subredditId, {
          newAccountAgeDays: days,
          swarmEnabled: enabled,
        });
        setNewAcctDays(days);
        setSwarmEnabled(enabled);
        context.ui.showToast('Swarm settings saved.');
      }
    );

    const lockdownForm = useForm(
      {
        title: 'Lockdown Settings',
        description: 'Configure lockdown durations and quarantine behaviour.',
        fields: [
          {
            name: 'autoLockdownMinutes',
            type: 'number',
            label: 'Auto lockdown duration (minutes)',
            helpText: TIPS.autoLockdown,
            defaultValue: autoLockdownMin,
          },
          {
            name: 'manualLockdownMinutes',
            type: 'number',
            label: 'Manual lockdown duration (minutes)',
            helpText: TIPS.manualLockdown,
            defaultValue: manualLockdownMin,
          },
          {
            name: 'autoQuarantine',
            type: 'boolean',
            label: 'Auto-quarantine flagged content',
            helpText: TIPS.autoQuarantine,
            defaultValue: autoQuarantine,
          },
        ],
      },
      async (values) => {
        const autoMin = Math.max(1, Math.min(1440, Number(values.autoLockdownMinutes)));
        const manualMin = Math.max(1, Math.min(1440, Number(values.manualLockdownMinutes)));
        const quarantine = Boolean(values.autoQuarantine);
        await patchConfig(context.redis, subredditId, {
          autoLockdownMinutes: autoMin,
          manualLockdownMinutes: manualMin,
          autoQuarantine: quarantine,
        });
        setAutoLockdownMin(autoMin);
        setManualLockdownMin(manualMin);
        setAutoQuarantine(quarantine);
        context.ui.showToast('Lockdown settings saved.');
      }
    );

    
    const formatTime = (ts: number): string => {
      const d = new Date(ts);
      return `${d.getUTCHours().toString().padStart(2, '0')}:${d.getUTCMinutes().toString().padStart(2, '0')} UTC`;
    };
    const incidentIcon = (type: string) =>
      type === 'velocity' ? '⚡' : type === 'cluster' ? '�' : '🔴';

    const parsedIncidents = (() => {
      try { return JSON.parse(recentIncidents) as Array<{ ts: number; type: string; reason: string }>; }
      catch { return []; }
    })();

    
    const handleLockdownToggle = async () => {
      try {
        const liveCfg = await loadConfig(context.redis, subredditId);
        if (lockdownActive) {
          await liftLockdown(context, subredditId, currentUsername);
          setLockdownActive(false);
          setLockdownReason('');
          setLockdownBy('');
         
          setRecentIncidents(JSON.stringify(await getRecentIncidents(context.redis, subredditId, 5)));
          context.ui.showToast('Lockdown lifted. Community is back to normal.');
        } else {
          await activateManualLockdown(context, subredditId, currentUsername, liveCfg);
          setLockdownActive(true);
          setLockdownReason(`Manual emergency lockdown (${liveCfg.manualLockdownMinutes}min)`);
          setLockdownBy(currentUsername);
          setIncidentCount(await getIncidentCount(context.redis, subredditId));
          setRecentIncidents(JSON.stringify(await getRecentIncidents(context.redis, subredditId, 5)));
          context.ui.showToast(`🔴 Emergency lockdown activated for ${liveCfg.manualLockdownMinutes} minutes.`);
        }
      } catch (err) {
        console.error('[RaidShield] Lockdown toggle error:', err);
        context.ui.showToast('Error updating lockdown state. Please try again.');
      }
    };

  
    if (!isMod) {
      return (
        <vstack padding="large" gap="medium" alignment="center middle" width="100%" height="100%">
          <text size="xxlarge">🛡️</text>
          <text size="large" weight="bold" alignment="center">Community Protection Active</text>
          <text size="small" alignment="center" wrap>
            This subreddit is protected by RaidShield. Automated systems monitor for coordinated spam and raid activity in real time.
          </text>
          {lockdownActive ? (
            <vstack border="thin" cornerRadius="medium" padding="medium" alignment="center middle" gap="small">
              <text size="small" weight="bold" color="red">⚠ Temporary Restrictions Active</text>
              <text size="xsmall" alignment="center" wrap>
                New submissions may be held for review. Normal activity will resume shortly.
              </text>
            </vstack>
          ) : (
            <vstack border="thin" cornerRadius="medium" padding="medium" alignment="center middle">
              <text size="small" color="green">● All systems nominal</text>
            </vstack>
          )}
        </vstack>
      );
    }

    const StatusTab = () => (
      <vstack gap="small" width="100%" grow>

        <hstack width="100%" gap="small">
          <vstack border="thin" cornerRadius="medium" padding="small" grow alignment="center middle">
            <text size="xxlarge" weight="bold">{String(incidentCount)}</text>
            <text size="xsmall">Threats Blocked (24h)</text>
          </vstack>
          <vstack border="thin" cornerRadius="medium" padding="small" grow alignment="center middle">
            <text size="large" weight="bold" color={lockdownActive ? 'red' : 'green'}>
              {lockdownActive ? 'LOCKED' : 'OPEN'}
            </text>
            <text size="xsmall">Community Status</text>
          </vstack>
        </hstack>

        {lockdownActive && lockdownReason ? (
          <vstack border="thin" cornerRadius="medium" padding="small" width="100%" gap="small">
            <text size="xsmall" weight="bold" color="red">⚠ Active Lockdown</text>
            <text size="xsmall" wrap>{lockdownReason}</text>
            {lockdownBy ? <text size="xsmall">By: {lockdownBy}</text> : null}
          </vstack>
        ) : null}

        <vstack border="thin" cornerRadius="medium" padding="small" width="100%" gap="small" grow>
          <text size="small" weight="bold">Recent Incidents</text>
          {parsedIncidents.length === 0 ? (
            <text size="xsmall">No incidents recorded yet. Detection is active.</text>
          ) : (
            parsedIncidents.map((inc, i) => (
              <hstack key={String(i)} gap="small" alignment="start middle">
                <text size="xsmall">{incidentIcon(inc.type)}</text>
                <text size="xsmall">{formatTime(inc.ts)}</text>
                <text size="xsmall" wrap grow>
                  {inc.reason.length > 55 ? inc.reason.substring(0, 55) + '…' : inc.reason}
                </text>
              </hstack>
            ))
          )}
        </vstack>

        <button
          width="100%"
          appearance={lockdownActive ? 'secondary' : 'destructive'}
          onPress={handleLockdownToggle}
        >
          {lockdownActive ? '✅ Lift Emergency Lockdown' : '🔴 Activate Emergency Lockdown'}
        </button>

      </vstack>
    );


    const SettingRow = (
      label: string,
      value: string,
      tipKey: keyof typeof TIPS,
      onEdit: () => void
    ) => (
      <hstack width="100%" alignment="start middle" gap="small">
        <text size="xsmall" grow>{label}</text>
        <text size="xsmall" weight="bold">{value}</text>
        <button size="small" appearance="plain" onPress={() => setTooltip(tooltip === TIPS[tipKey] ? '' : TIPS[tipKey])}>ℹ</button>
        <button size="small" appearance="plain" onPress={onEdit}>Edit</button>
      </hstack>
    );

    const SettingsTab = () => (
      <vstack gap="small" width="100%" grow>

        {tooltip ? (
          <vstack border="thin" cornerRadius="medium" padding="small" width="100%">
            <text size="xsmall" wrap>{tooltip}</text>
          </vstack>
        ) : null}

        <text size="small" weight="bold">⚡ Velocity Monitor</text>
        {SettingRow('Rate limit', `${velThreshold}/win`, 'velocityThreshold', () => context.ui.showForm(velocityForm))}
        {SettingRow('Window', `${velWindow}s`, 'velocityWindow', () => context.ui.showForm(velocityForm))}
        {SettingRow('Enabled', velEnabled ? 'ON' : 'OFF', 'velocityThreshold', () => context.ui.showForm(velocityForm))}

        <spacer size="small" />
        <text size="small" weight="bold">🔗 Text Cluster</text>
        {SettingRow('Threshold', `${clusterThreshold} accts`, 'clusterThreshold', () => context.ui.showForm(clusterForm))}
        {SettingRow('Window', `${clusterWindow}s`, 'clusterWindow', () => context.ui.showForm(clusterForm))}
        {SettingRow('Enabled', clusterEnabled ? 'ON' : 'OFF', 'clusterThreshold', () => context.ui.showForm(clusterForm))}

        <spacer size="small" />
        <text size="small" weight="bold">👤 New-Account Swarm</text>
        {SettingRow('Age limit', `${newAcctDays}d`, 'newAccountDays', () => context.ui.showForm(swarmForm))}
        {SettingRow('Enabled', swarmEnabled ? 'ON' : 'OFF', 'newAccountDays', () => context.ui.showForm(swarmForm))}

        <spacer size="small" />
        <text size="small" weight="bold">🔒 Lockdown</text>
        {SettingRow('Auto duration', `${autoLockdownMin}m`, 'autoLockdown', () => context.ui.showForm(lockdownForm))}
        {SettingRow('Manual duration', `${manualLockdownMin}m`, 'manualLockdown', () => context.ui.showForm(lockdownForm))}
        {SettingRow('Auto-quarantine', autoQuarantine ? 'ON' : 'OFF', 'autoQuarantine', () => context.ui.showForm(lockdownForm))}

        <spacer grow />
        <text size="xsmall" alignment="center">Tap ℹ for help · Tap Edit to change a setting</text>

      </vstack>
    );

   
    return (
      <vstack padding="medium" gap="small" width="100%" height="100%">

        <hstack width="100%" alignment="start middle">
          <text size="xlarge" weight="bold"> RaidShield</text>
          <spacer grow />
          <text size="small" weight="bold" color={lockdownActive ? 'red' : 'green'}>
            {lockdownActive ? '● LOCKDOWN' : '● NOMINAL'}
          </text>
        </hstack>

        <hstack width="100%" gap="small">
          <button
            appearance={activeTab === 'status' ? 'primary' : 'plain'}
            onPress={() => setActiveTab('status')}
            grow
          >
             Status
          </button>
          <button
            appearance={activeTab === 'settings' ? 'primary' : 'plain'}
            onPress={() => setActiveTab('settings')}
            grow
          >
            ⚙️ Settings
          </button>
        </hstack>

        {activeTab === 'status' ? StatusTab() : SettingsTab()}

        <text size="xsmall" alignment="center">RaidShield v1.0 · Mod console</text>

      </vstack>
    );
  },
});



Devvit.addMenuItem({
  label: '🛡️ Create RaidShield Dashboard',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_, context) => {
    const subredditId = context.subredditId ?? '';
    try {
      const subreddit = await context.reddit.getCurrentSubreddit();
      const post = await context.reddit.submitPost({
        title: '🛡️ RaidShield — Mod Operations Dashboard',
        subredditName: subreddit.name,
        preview: (
          <vstack alignment="center middle" height="100%" width="100%">
            <text size="large" weight="bold">🛡️ Loading RaidShield…</text>
          </vstack>
        ),
      });

      await setDashboardPostId(context.redis, subredditId, post.id);

      try {
        await post.distinguish();
        await post.sticky();
      } catch {
        // Non-fatal
      }

      context.ui.showToast('RaidShield Dashboard created and stickied!');
      context.ui.navigateTo(post);
    } catch (err) {
      console.error('[RaidShield] Failed to create dashboard post:', err);
      context.ui.showToast('Failed to create dashboard. Check app permissions.');
    }
  },
});
