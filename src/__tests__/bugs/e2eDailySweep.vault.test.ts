/**
 * Scenario: the full E2E sweep is the daily scheduled work. Distributable builds
 * are not, and the sweep tests the Dev artifacts built from the default branch
 * head the run started on.
 *
 * Expected behaviour: E2E runs daily at 03:00 UTC on both platforms through the
 * Dev variant, and no scheduled path builds a store artifact or publishes.
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const WORKFLOWS = path.join(REPO_ROOT, '.github/workflows');

const yaml = require('js-yaml') as { load: (source: string) => unknown };

type Job = {
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
  steps?: { run?: string }[];
};
type Workflow = { on: Record<string, unknown>; jobs: Record<string, Job> };

function readWorkflow(name: string): Workflow {
  return yaml.load(fs.readFileSync(path.join(WORKFLOWS, name), 'utf8')) as Workflow;
}

describe('the daily E2E sweep', () => {
  const e2e = readWorkflow('e2e.yml');

  it('is scheduled daily at 03:00 UTC', () => {
    const schedule = e2e.on.schedule as { cron: string }[];
    expect(schedule.map((entry) => entry.cron)).toEqual(['0 3 * * *']);
  });

  it('keeps manual tier selection', () => {
    const dispatch = e2e.on.workflow_dispatch as { inputs: { tier: { default: string } } };
    expect(dispatch.inputs.tier.default).toBe('tier0,tier1,tier2,tier3');
  });

  it('builds and tests both platforms on a scheduled run', () => {
    for (const id of ['build-android-dev', 'build-ios-dev', 'e2e-android', 'e2e-ios']) {
      expect(e2e.jobs[id]).toBeDefined();
      expect(e2e.jobs[id].if ?? '').not.toMatch(/schedule/);
    }
  });

  it('tests the Dev variant and makes no store artifact', () => {
    for (const id of ['build-android-dev', 'build-ios-dev']) {
      const job = e2e.jobs[id];
      expect(job.with?.variant).toBe('dev');
      expect(job.with?.release).toBeUndefined();
    }
  });

  it('names the tested commit and the source hash in the summary', () => {
    const summary = e2e.jobs['e2e-summary'];
    const body = JSON.stringify(summary.steps);
    expect(body).toContain('github.sha');
    expect(body).toMatch(/source_hash|source-hash/);
  });
});

describe('scheduled distribution builds', () => {
  it('are gone: Build and Release run on push, pull request, tag or dispatch only', () => {
    expect(readWorkflow('build.yml').on).not.toHaveProperty('schedule');
    expect(readWorkflow('release.yml').on).not.toHaveProperty('schedule');
  });
});
