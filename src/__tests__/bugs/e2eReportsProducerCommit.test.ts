/**
 * Scenario: a build workflow restores a finished Dev app from the exact-key
 * cache, so the app under test was produced by an earlier commit than the one
 * the sweep reports as tested.
 *
 * Expected behaviour: each build workflow stores the producing commit beside
 * the cached app and exposes it as an output, and the sweep summary prints it
 * when it differs from the tested commit.
 */

import * as fs from 'fs';
import * as path from 'path';

const WORKFLOWS = path.resolve(__dirname, '../../../.github/workflows');

const yaml = require('js-yaml') as { load: (source: string) => unknown };

type Step = {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: { path?: string };
};
type Workflow = {
  on: { workflow_call: { outputs: Record<string, { value: string }> } };
  jobs: Record<string, { outputs?: Record<string, string>; steps?: Step[] }>;
};

function load(file: string): Workflow {
  return yaml.load(fs.readFileSync(path.join(WORKFLOWS, file), 'utf8')) as Workflow;
}

const builds = [
  { file: 'build-android.yml', restore: 'apk-cache', recordDir: 'android/app/build/outputs' },
  { file: 'build-ios.yml', restore: 'app-cache', recordDir: 'artifacts' },
];

describe.each(builds)('$file', ({ file, restore, recordDir }) => {
  const workflow = load(file);
  const steps = workflow.jobs.build.steps ?? [];

  it('caches the producing commit in the same entry as the app', () => {
    const cacheSteps = steps.filter((s) => s.uses?.startsWith('actions/cache/') && s.with?.path);
    const appCaches = cacheSteps.filter((s) =>
      s.with?.path?.match(/simulator-app\.zip|app-release\.apk/)
    );

    expect(appCaches).toHaveLength(2);
    for (const step of appCaches) {
      expect(step.with?.path).toContain(`${recordDir}/producer-commit`);
    }
  });

  it('writes the record from the checked-out commit only on a fresh build', () => {
    const writer = steps.find(
      (s) => s.run?.includes(`${recordDir}/producer-commit`) && s.run.includes('>')
    );

    expect(writer).toBeDefined();
    expect(writer?.run).toContain('git rev-parse HEAD');
  });

  it('exposes the recorded commit as a workflow output', () => {
    const reader = steps.find((s) => s.id === 'producer');

    expect(reader?.run).toContain(`${recordDir}/producer-commit`);
    expect(workflow.jobs.build.outputs?.producer_commit).toBe(
      '${{ steps.producer.outputs.commit }}'
    );
    expect(workflow.on.workflow_call.outputs.producer_commit.value).toBe(
      '${{ jobs.build.outputs.producer_commit }}'
    );
    expect(steps.findIndex((s) => s.id === 'producer')).toBeGreaterThan(
      steps.findIndex((s) => s.id === restore)
    );
  });
});

describe('e2e.yml summary', () => {
  const sweep = load('e2e.yml');
  const summary = sweep.jobs['e2e-summary'] as unknown as {
    needs: string[];
    steps: Step[];
  };
  const generate = summary.steps.find((s) => s.name === 'Generate summary');

  it('receives each build job and the commit that produced its app', () => {
    expect(summary.needs).toEqual(expect.arrayContaining(['build-android-dev', 'build-ios-dev']));
    expect(generate?.env?.ANDROID_PRODUCER).toBe(
      '${{ needs.build-android-dev.outputs.producer_commit }}'
    );
    expect(generate?.env?.IOS_PRODUCER).toBe('${{ needs.build-ios-dev.outputs.producer_commit }}');
    expect(generate?.env?.TESTED_COMMIT).toBe('${{ github.sha }}');
  });

  it('names a reused app only when its producer differs from the tested commit', () => {
    expect(generate?.run).toMatch(/\[ "\$producer" != "\$TESTED_COMMIT" \]/);
    expect(generate?.run).toMatch(/\[ -n "\$producer" \]/);
  });
});
