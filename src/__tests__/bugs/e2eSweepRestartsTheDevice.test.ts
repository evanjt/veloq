/**
 * Scenario: the weekly Android sweep meets the dead-device shape the gate
 * already survives. Every scheduled run since August died mid-suite and
 * reported the flows behind the death as failures.
 *
 * Expected behaviour: the sweep runs the suite through `run-suite.sh`, which
 * tells a device death from a failed step, restarts the device once and reruns
 * the flows the death took with it.
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SWEEP_PATH = path.join(REPO_ROOT, '.github/workflows/e2e.yml');

const yaml = require('js-yaml') as { load: (source: string) => unknown };

type Step = { name?: string; run?: string; with?: { script?: string; path?: string } };
type Job = { steps?: Step[] };

const sweep = yaml.load(fs.readFileSync(SWEEP_PATH, 'utf8')) as { jobs: Record<string, Job> };

const ANDROID_JOB = 'e2e-android';

/** Everything that job asks a shell to do, the emulator script included. */
function androidScripts(): string {
  return (sweep.jobs[ANDROID_JOB].steps ?? [])
    .flatMap((step) => [step.run ?? '', step.with?.script ?? ''])
    .join('\n');
}

it('runs the suite through run-suite.sh rather than maestro directly', () => {
  const scripts = androidScripts();

  expect(scripts).toMatch(/\.maestro\/run-suite\.sh\s+maestro-report\.xml/);
  expect(scripts).not.toMatch(/maestro" test \.maestro\/ --include-tags/);
});

it('keeps the retry pass reports, which are what say a death was recovered', () => {
  const uploads = (sweep.jobs[ANDROID_JOB].steps ?? [])
    .map((step) => step.with?.path ?? '')
    .filter((p) => p.includes('maestro-report.xml'))
    .join('\n');

  expect(uploads).toContain('retry-reports/');
});
