import type { RedisClient } from '@devvit/public-api';


export interface RaidShieldConfig {
  
  velocityWindowSec: number;
  velocityThreshold: number; 

  
  newAccountAgeDays: number;       
  newAccountRatioThreshold: number; 

 
  clusterWindowSec: number;        
  clusterThreshold: number;        

 
  autoLockdownMinutes: number;     
  manualLockdownMinutes: number;  

  
  velocityEnabled: boolean;        
  swarmEnabled: boolean;           
  clusterEnabled: boolean;         
  autoQuarantine: boolean;         
}



export const DEFAULT_CONFIG: RaidShieldConfig = {
  velocityWindowSec: 60,
  velocityThreshold: 30,
  newAccountAgeDays: 30,
  newAccountRatioThreshold: 0.75,
  clusterWindowSec: 180,
  clusterThreshold: 50,
  autoLockdownMinutes: 30,
  manualLockdownMinutes: 60,
  velocityEnabled: true,
  swarmEnabled: true,
  clusterEnabled: true,
  autoQuarantine: true,
};



const configKey = (subredditId: string) => `raidshield:config:${subredditId}`;



export async function loadConfig(
  redis: RedisClient,
  subredditId: string
): Promise<RaidShieldConfig> {
  try {
    const raw = await redis.get(configKey(subredditId));
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<RaidShieldConfig>;
    
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}


export async function saveConfig(
  redis: RedisClient,
  subredditId: string,
  config: RaidShieldConfig
): Promise<void> {
  await redis.set(configKey(subredditId), JSON.stringify(config));
}

export async function patchConfig(
  redis: RedisClient,
  subredditId: string,
  patch: Partial<RaidShieldConfig>
): Promise<RaidShieldConfig> {
  const current = await loadConfig(redis, subredditId);
  const updated = { ...current, ...patch };
  await saveConfig(redis, subredditId, updated);
  return updated;
}



export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateConfig(cfg: Partial<RaidShieldConfig>): ValidationResult {
  const errors: string[] = [];

  if (cfg.velocityWindowSec !== undefined && (cfg.velocityWindowSec < 10 || cfg.velocityWindowSec > 300)) {
    errors.push('Velocity window must be between 10 and 300 seconds.');
  }
  if (cfg.velocityThreshold !== undefined && (cfg.velocityThreshold < 1 || cfg.velocityThreshold > 500)) {
    errors.push('Velocity threshold must be between 1 and 500.');
  }
  if (cfg.newAccountAgeDays !== undefined && (cfg.newAccountAgeDays < 1 || cfg.newAccountAgeDays > 365)) {
    errors.push('New account age must be between 1 and 365 days.');
  }
  if (cfg.newAccountRatioThreshold !== undefined && (cfg.newAccountRatioThreshold < 0.1 || cfg.newAccountRatioThreshold > 1)) {
    errors.push('New account ratio must be between 0.1 and 1.0.');
  }
  if (cfg.clusterWindowSec !== undefined && (cfg.clusterWindowSec < 30 || cfg.clusterWindowSec > 600)) {
    errors.push('Cluster window must be between 30 and 600 seconds.');
  }
  if (cfg.clusterThreshold !== undefined && (cfg.clusterThreshold < 2 || cfg.clusterThreshold > 200)) {
    errors.push('Cluster threshold must be between 2 and 200.');
  }
  if (cfg.autoLockdownMinutes !== undefined && (cfg.autoLockdownMinutes < 1 || cfg.autoLockdownMinutes > 1440)) {
    errors.push('Auto lockdown duration must be between 1 and 1440 minutes.');
  }
  if (cfg.manualLockdownMinutes !== undefined && (cfg.manualLockdownMinutes < 1 || cfg.manualLockdownMinutes > 1440)) {
    errors.push('Manual lockdown duration must be between 1 and 1440 minutes.');
  }

  return { valid: errors.length === 0, errors };
}
