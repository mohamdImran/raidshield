import { describe, it, expect } from 'vitest';
import { runScenario } from './simulation/engine.js';
import {
  velocityFloodScenario,
  textClusterScenario,
  newAccountSwarmScenario,
  mixedAttackScenario,
  benignTrafficScenario,
} from './simulation/scenarios.js';


const LATENCY_SLA_MS = 50;

function printReport(report: ReturnType<typeof runScenario> extends Promise<infer T> ? T : never) {
  const status = report.passed ? '✅ PASS' : '❌ FAIL';
  console.log(`\n${status}  ${report.scenario} [${report.attackType}]`);
  console.log(`  Events: ${report.totalEvents} | Quarantined: ${report.quarantinedCount} | Incidents: ${report.incidentCount}`);
  console.log(`  Lockdown: ${report.lockdownTripped ? '🔴 ACTIVE' : '🟢 CLEAR'}`);
  console.log(`  Latency — p50: ${report.p50LatencyMs.toFixed(2)}ms | p95: ${report.p95LatencyMs.toFixed(2)}ms | p99: ${report.p99LatencyMs.toFixed(2)}ms | max: ${report.maxLatencyMs.toFixed(2)}ms`);
  if (report.failures.length > 0) {
    report.failures.forEach((f) => console.log(`  ⚠️  ${f}`));
  }
}

describe('RaidShield Attack Simulation', () => {

  it('Scenario 1 — Velocity Flood: trips circuit breaker before all events processed', async () => {
    const report = await runScenario(velocityFloodScenario());
    printReport(report);

    expect(report.lockdownTripped, 'Circuit breaker must trip on velocity flood').toBe(true);
    expect(report.incidentCount, 'At least one incident must be logged').toBeGreaterThanOrEqual(1);
    expect(report.quarantinedCount, 'Content must be quarantined').toBeGreaterThan(0);
    expect(report.p95LatencyMs, `p95 latency must be under ${LATENCY_SLA_MS}ms`).toBeLessThan(LATENCY_SLA_MS);
    expect(report.failures).toHaveLength(0);
  });

  it('Scenario 2 — Text Cluster: detects coordinated identical content including homoglyph variants', async () => {
    const report = await runScenario(textClusterScenario());
    printReport(report);

    expect(report.lockdownTripped, 'Circuit breaker must trip on cluster attack').toBe(true);
    expect(report.incidentCount).toBeGreaterThanOrEqual(1);
    expect(report.quarantinedCount).toBeGreaterThan(0);
    expect(report.p95LatencyMs).toBeLessThan(LATENCY_SLA_MS);
    expect(report.failures).toHaveLength(0);
  });

  it('Scenario 3 — New-Account Swarm: detects >75% new-account traffic ratio', async () => {
    const report = await runScenario(newAccountSwarmScenario());
    printReport(report);

    expect(report.lockdownTripped, 'Circuit breaker must trip on new-account swarm').toBe(true);
    expect(report.incidentCount).toBeGreaterThanOrEqual(1);
    expect(report.p95LatencyMs).toBeLessThan(LATENCY_SLA_MS);
    expect(report.failures).toHaveLength(0);
  });

  it('Scenario 4 — Mixed Attack: handles multi-vector simultaneous attack', async () => {
    const report = await runScenario(mixedAttackScenario());
    printReport(report);

    expect(report.lockdownTripped, 'Circuit breaker must trip on mixed attack').toBe(true);
    expect(report.incidentCount).toBeGreaterThanOrEqual(1);
    expect(report.p95LatencyMs).toBeLessThan(LATENCY_SLA_MS);
    expect(report.failures).toHaveLength(0);
  });

  it('Scenario 5 — Benign Traffic: zero false positives on normal community activity', async () => {
    const report = await runScenario(benignTrafficScenario());
    printReport(report);

    expect(report.lockdownTripped, 'Must NOT trigger lockdown on benign traffic').toBe(false);
    expect(report.quarantinedCount, 'Must NOT quarantine legitimate content').toBe(0);
    expect(report.incidentCount, 'Must NOT log incidents for benign traffic').toBe(0);
    expect(report.p95LatencyMs).toBeLessThan(LATENCY_SLA_MS);
    expect(report.failures).toHaveLength(0);
  });

});

describe('RaidShield SLA Compliance', () => {

  it('all scenarios complete within the 120ms mathematical latency bound', async () => {
    const scenarios = [
      velocityFloodScenario(),
      textClusterScenario(),
      newAccountSwarmScenario(),
      mixedAttackScenario(),
      benignTrafficScenario(),
    ];

    const reports = await Promise.all(scenarios.map(runScenario));

    for (const report of reports) {
      expect(
        report.maxLatencyMs,
        `[${report.scenario}] max latency ${report.maxLatencyMs.toFixed(2)}ms exceeds 120ms SLA`
      ).toBeLessThan(120);
    }

    const allMaxLatencies = reports.map((r) => r.maxLatencyMs);
    const overallMax = Math.max(...allMaxLatencies);
    console.log(`\n  Overall max latency across all scenarios: ${overallMax.toFixed(2)}ms (SLA: 120ms)`);
  });

  it('detection rate: attack scenarios quarantine at least 10% of events before lockdown', async () => {
    const attackScenarios = [
      velocityFloodScenario(),
      textClusterScenario(),
      newAccountSwarmScenario(),
      mixedAttackScenario(),
    ];

    for (const scenario of attackScenarios) {
      const report = await runScenario(scenario);
      const quarantineRate = report.quarantinedCount / report.totalEvents;
      expect(
        quarantineRate,
        `[${report.scenario}] quarantine rate ${(quarantineRate * 100).toFixed(1)}% is too low`
      ).toBeGreaterThan(0.1);
    }
  });

});
