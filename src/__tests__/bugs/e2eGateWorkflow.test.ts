/**
 * Static guards for the PR-blocking E2E gate.
 *
 * Scenario: branch protection points at a workflow whose jobs can all be
 * skipped (a fork PR gets no build, a path filter drops the map suite), and a
 * skipped job reports neutral, which reads as green.
 * Expected behaviour: one always-run job decides the gate, the suite is never
 * rerun wholesale from the previous run's device state, and the App Store
 * rejection regression flow is inside the blocking set.
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const GATE_PATH = path.join(REPO_ROOT, '.github/workflows/e2e-gate.yml');
const IAP_FLOW_PATH = path.join(REPO_ROOT, '.maestro/settings-support-iap.yaml');

const yaml = require('js-yaml') as { load: (source: string) => unknown };

type Step = {
  name?: string;
  run?: string;
  env?: Record<string, string>;
  with?: { script?: string };
};
type Job = { needs?: string | string[]; if?: string; steps?: Step[] };

const gateSource = fs.readFileSync(GATE_PATH, 'utf8');
const gate = yaml.load(gateSource) as { jobs: Record<string, Job> };
const jobNames = Object.keys(gate.jobs);

const REQUIRED_JOB = 'gate-required';

function needsOf(job: Job): string[] {
  if (!job.needs) return [];
  return Array.isArray(job.needs) ? job.needs : [job.needs];
}

function scriptsOf(job: Job): string[] {
  return (job.steps ?? []).flatMap(
    (step) => [step.run, step.with?.script].filter(Boolean) as string[]
  );
}

// Where a step reads a job result: the `run` body, or the `env` block feeding it.
function resultRefsOf(job: Job): string {
  return (job.steps ?? [])
    .flatMap((step) => [step.run ?? '', ...Object.values(step.env ?? {})])
    .join('\n');
}

describe('e2e gate required job', () => {
  it('declares an always-run job for branch protection to point at', () => {
    expect(jobNames).toContain(REQUIRED_JOB);
    expect(gate.jobs[REQUIRED_JOB].if).toBe('always()');
  });

  it('depends on every other job, so none can be skipped into a green report', () => {
    const needs = needsOf(gate.jobs[REQUIRED_JOB]);
    const others = jobNames.filter((name) => name !== REQUIRED_JOB).sort();
    expect([...needs].sort()).toEqual(others);
  });

  it('treats a non-success result as a failure', () => {
    const refs = resultRefsOf(gate.jobs[REQUIRED_JOB]);
    for (const name of jobNames.filter((n) => n !== REQUIRED_JOB)) {
      expect(refs).toContain(`needs.${name}.result`);
    }
    expect(scriptsOf(gate.jobs[REQUIRED_JOB]).join('\n')).toMatch(/exit 1/);
  });
});

describe('e2e gate suite runs', () => {
  const suiteJobs = jobNames.filter((name) => name !== REQUIRED_JOB && name !== 'changes');

  it.each(suiteJobs)('%s never reruns a whole suite on failure', (name) => {
    for (const script of scriptsOf(gate.jobs[name])) {
      for (const line of script.split('\n')) {
        const runs = line.match(/maestro" test |maestro test /g) ?? [];
        expect(runs.length).toBeLessThan(2);
      }
    }
  });

  it('retries the failed flows instead, from a clean launch', () => {
    const script = scriptsOf(gate.jobs.gate).join('\n');
    expect(script).toContain('.maestro/run-suite.sh');
    const runner = path.join(REPO_ROOT, '.maestro/run-suite.sh');
    expect(fs.existsSync(runner)).toBe(true);
    expect(fs.statSync(runner).mode & 0o111).toBeGreaterThan(0);
  });
});

describe('store rejection regression flow', () => {
  const header = fs.readFileSync(IAP_FLOW_PATH, 'utf8').split('\n---')[0];
  const tags = [...header.matchAll(/^\s*-\s*([\w-]+)\s*(?:#.*)?$/gm)].map((m) => m[1]);

  it('is not quarantined out of the blocking gate', () => {
    expect(tags).not.toContain('flaky');
  });

  it('carries a tier the gate selects', () => {
    const gateTags = gateSource.match(/--include-tags=(tier[\d,tier]*)/)?.[1].split(',') ?? [];
    expect(gateTags.length).toBeGreaterThan(0);
    expect(tags.some((tag) => gateTags.includes(tag))).toBe(true);
  });
});
