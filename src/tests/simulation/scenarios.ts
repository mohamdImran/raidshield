import type { ScenarioConfig, SimulatedEvent, SimulatedUser } from './types.js';
import { DEFAULT_CONFIG } from '../../config.js';

const { velocityThreshold: VELOCITY_THRESHOLD, clusterThreshold: CLUSTER_THRESHOLD, newAccountAgeDays: NEW_ACCOUNT_AGE_DAYS } = DEFAULT_CONFIG;

function newAccount(id: string, ageDays = 2): SimulatedUser {
  return { id, name: `bot_${id}`, accountAgeDays: ageDays };
}

function legacyAccount(id: string): SimulatedUser {
  return { id, name: `user_${id}`, accountAgeDays: 365 };
}

export function velocityFloodScenario(): ScenarioConfig {
  const events: SimulatedEvent[] = [];
  const userCount = VELOCITY_THRESHOLD + 20; 

  for (let i = 0; i < userCount; i++) {
    const user = legacyAccount(`vf_user_${i}`);
    events.push({
      user,
      contentId: `post_vf_${i}`,
      contentType: 'post',
      text: `Unique post content from user ${i} about various topics`,
      offsetMs: Math.floor((i / userCount) * 55_000),
    });
  }

  return {
    name: 'Velocity Flood',
    description: `${userCount} accounts posting within 60s — triggers velocity circuit breaker`,
    attackType: 'velocity',
    subredditId: 'sim_sub_velocity',
    events,
    expectedLockdown: true,
    expectedMinIncidents: 1,
    maxLatencyMs: 50,
  };
}

export function textClusterScenario(): ScenarioConfig {
  const spamMessage = 'Join our crypto discord server discord.gg/freemoney pump guaranteed';
  const homoglyphVariant = 'J\u043Ein \u043Eur crypt\u043E disc\u043Erd server disc\u043Erd.gg/freemoney pump guaranteed';

  const events: SimulatedEvent[] = [];
  const userCount = CLUSTER_THRESHOLD + 10;

  for (let i = 0; i < userCount; i++) {
    const user = newAccount(`tc_user_${i}`, 5);
    const text = i % 5 === 0 ? homoglyphVariant : spamMessage;
    events.push({
      user,
      contentId: `comment_tc_${i}`,
      contentType: 'comment',
      text,
      offsetMs: Math.floor((i / userCount) * 150_000),
    });
  }

  return {
    name: 'Coordinated Text Cluster',
    description: `${userCount} accounts posting identical spam (with homoglyph variants) within 3 minutes`,
    attackType: 'cluster',
    subredditId: 'sim_sub_cluster',
    events,
    expectedLockdown: true,
    expectedMinIncidents: 1,
    maxLatencyMs: 50,
  };
}

export function newAccountSwarmScenario(): ScenarioConfig {
  const events: SimulatedEvent[] = [];
  const botCount = 30;
  const legacyCount = 4; 

  for (let i = 0; i < botCount; i++) {
    const user = newAccount(`sw_bot_${i}`, Math.floor(Math.random() * (NEW_ACCOUNT_AGE_DAYS - 1)) + 1);
    events.push({
      user,
      contentId: `post_sw_bot_${i}`,
      contentType: 'post',
      text: `Post from new account ${i} — varied content to avoid cluster detection`,
      offsetMs: i * 1_500, 
    });
  }

  for (let i = 0; i < legacyCount; i++) {
    const user = legacyAccount(`sw_legit_${i}`);
    events.push({
      user,
      contentId: `post_sw_legit_${i}`,
      contentType: 'post',
      text: `Normal post from established community member ${i}`,
      offsetMs: i * 8_000,
    });
  }

  return {
    name: 'New-Account Swarm',
    description: `${botCount} new accounts (<${NEW_ACCOUNT_AGE_DAYS}d old) flood alongside ${legacyCount} legitimate users`,
    attackType: 'swarm',
    subredditId: 'sim_sub_swarm',
    events,
    expectedLockdown: true,
    expectedMinIncidents: 1,
    maxLatencyMs: 50,
  };
}

export function mixedAttackScenario(): ScenarioConfig {
  const events: SimulatedEvent[] = [];
  const spamBase = 'Earn money fast click here now limited offer';

  for (let i = 0; i < 20; i++) {
    events.push({
      user: newAccount(`mx_v_${i}`, 3),
      contentId: `post_mx_v_${i}`,
      contentType: 'post',
      text: `${spamBase} variant ${i}`,
      offsetMs: i * 1_200,
    });
  }


  for (let i = 0; i < 30; i++) {
    events.push({
      user: newAccount(`mx_c_${i}`, 7),
      contentId: `comment_mx_c_${i}`,
      contentType: 'comment',
      text: spamBase, 
      offsetMs: 30_000 + i * 2_000,
    });
  }

  for (let i = 0; i < 5; i++) {
    events.push({
      user: legacyAccount(`mx_legit_${i}`),
      contentId: `post_mx_legit_${i}`,
      contentType: 'post',
      text: `Genuine community discussion post number ${i}`,
      offsetMs: 10_000 + i * 15_000,
    });
  }

  return {
    name: 'Mixed Sophisticated Attack',
    description: 'Multi-vector attack: velocity flood + content cluster + new-account swarm simultaneously',
    attackType: 'mixed',
    subredditId: 'sim_sub_mixed',
    events,
    expectedLockdown: true,
    expectedMinIncidents: 1,
    maxLatencyMs: 50,
  };
}


export function benignTrafficScenario(): ScenarioConfig {
  const events: SimulatedEvent[] = [];


  for (let i = 0; i < 20; i++) {
    events.push({
      user: legacyAccount(`bn_user_${i}`),
      contentId: `post_bn_${i}`,
      contentType: 'post',
      text: `Community discussion topic ${i}: ${['news', 'question', 'meme', 'rant', 'update'][i % 5]} post with unique content`,
      offsetMs: i * 30_000, 
    });
  }

  return {
    name: 'Benign Traffic (False Positive Check)',
    description: '20 established users posting varied content over 10 minutes — must NOT trigger lockdown',
    attackType: 'velocity', 
    subredditId: 'sim_sub_benign',
    events,
    expectedLockdown: false,
    expectedMinIncidents: 0,
    maxLatencyMs: 50,
  };
}

export const ALL_SCENARIOS = [
  velocityFloodScenario,
  textClusterScenario,
  newAccountSwarmScenario,
  mixedAttackScenario,
  benignTrafficScenario,
];
