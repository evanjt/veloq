/**
 * Scenario: the scheduled iOS sweep runs every flow tagged tier0 to tier3, 85 of
 * them, inside a 120 minute job. Three scheduled runs were cancelled at the two
 * hour mark having reached 77, 60 and 59 flows, and the summary job reported
 * success anyway, so a run in which iOS never finished read as green.
 *
 * Expected behaviour: the job is given time for every flow it is asked to run,
 * and the summary is red when a platform job did not succeed.
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const E2E_PATH = path.join(REPO_ROOT, '.github/workflows/e2e.yml');
const MAESTRO_DIR = path.join(REPO_ROOT, '.maestro');

const yaml = require('js-yaml') as { load: (source: string) => unknown };

type Job = {
  needs?: string | string[];
  if?: string;
  'timeout-minutes'?: number;
  steps?: unknown[];
};
const workflow = yaml.load(fs.readFileSync(E2E_PATH, 'utf8')) as { jobs: Record<string, Job> };

/**
 * Measured on the macOS runner: run 34746290972 reached 77 flows before it was
 * cancelled at 120 minutes, with the job's own setup inside that. Setup is
 * roughly a quarter of an hour, so a flow costs about 1.4 minutes.
 */
const MINUTES_PER_FLOW = 1.4;
const SETUP_MINUTES = 15;

/** The flows the sweep runs, by the tags in the job's `--include-tags`. */
function sweptFlowCount(): number {
  const tiers = ['tier0', 'tier1', 'tier2', 'tier3'];
  return fs
    .readdirSync(MAESTRO_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .filter((f) => {
      const source = fs.readFileSync(path.join(MAESTRO_DIR, f), 'utf8');
      return tiers.some((tier) => new RegExp(`^\\s*-\\s*${tier}\\s*$`, 'm').test(source));
    }).length;
}

describe('the scheduled iOS sweep', () => {
  it('is given time for every flow it runs', () => {
    const flows = sweptFlowCount();
    expect(flows).toBeGreaterThan(50);

    const needed = Math.ceil(flows * MINUTES_PER_FLOW + SETUP_MINUTES);
    expect(workflow.jobs['e2e-ios']['timeout-minutes']).toBeGreaterThanOrEqual(needed);
  });

  it('is red in the summary when a platform job did not succeed', () => {
    const summary = workflow.jobs['e2e-summary'];
    const steps = (summary.steps ?? []) as { name?: string; run?: string; if?: string }[];

    const verdict = steps.find((step) => /result/.test(step.run ?? ''));
    expect(verdict).toBeDefined();
    // A cancelled job is the shape this item was filed for, and it is neither
    // `failure` nor `skipped`, so the check is for `success` rather than a list
    // of the ways a job can go wrong.
    expect(verdict?.run).toMatch(/success/);
    expect(verdict?.run).toMatch(/exit 1/);
  });
});
