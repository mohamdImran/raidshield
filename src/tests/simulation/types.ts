export type AttackType = 'velocity' | 'cluster' | 'swarm' | 'mixed';

export interface SimulatedUser {
  id: string;
  name: string;
  accountAgeDays: number;
}

export interface SimulatedEvent {
  user: SimulatedUser;
  contentId: string;
  contentType: 'post' | 'comment';
  text: string;
  offsetMs: number;
}

export interface ScenarioConfig {
  name: string;
  description: string;
  attackType: AttackType;
  subredditId: string;
  events: SimulatedEvent[];
  expectedLockdown: boolean;
  expectedMinIncidents: number;
  maxLatencyMs: number;
}

export interface EventResult {
  contentId: string;
  quarantined: boolean;
  lockdownTripped: boolean;
  latencyMs: number;
  reason?: string;
}

export interface SimulationReport {
  scenario: string;
  attackType: AttackType;
  totalEvents: number;
  quarantinedCount: number;
  lockdownTripped: boolean;
  incidentCount: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  maxLatencyMs: number;
  passed: boolean;
  failures: string[];
}
