/**
 * Scenario: a scheduled sweep fails a flow, and the screenshots artefact holds
 * only Maestro's own failure dumps. The flows capture to `screenshots/<name>`,
 * which Maestro resolves against the working directory, the workspace, and the
 * collect steps searched only Maestro's own directories.
 *
 * Expected behaviour: each sweep's collect step gathers the captures the flows
 * took on purpose, and the smoke test uploads them.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const yaml = require('js-yaml') as { load: (source: string) => unknown };

const WORKFLOWS = path.resolve(__dirname, '../../../.github/workflows');

type Step = { name?: string; run?: string; with?: { name?: string; path?: string } };
type Workflow = { jobs: Record<string, { steps?: Step[] }> };

const load = (file: string) =>
  yaml.load(fs.readFileSync(path.join(WORKFLOWS, file), 'utf8')) as Workflow;

const collectSteps = Object.entries(load('e2e.yml').jobs).flatMap(([job, { steps }]) =>
  (steps ?? []).filter((s) => s.name === 'Collect screenshots').map((s) => [job, s.run!] as const)
);

describe('the weekly sweep', () => {
  it('has a collect step on each platform', () => {
    expect(collectSteps.map(([job]) => job).sort()).toEqual(['e2e-android', 'e2e-ios']);
  });

  it.each(collectSteps)('%s collects the captures the flows wrote', (_job, script) => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-workspace-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-home-'));
    fs.mkdirSync(path.join(workspace, 'screenshots'));
    fs.writeFileSync(path.join(workspace, 'screenshots/smoke-home.png'), 'png');
    fs.mkdirSync(path.join(home, '.maestro/tests/run'), { recursive: true });
    fs.writeFileSync(path.join(home, '.maestro/tests/run/screenshot-failed.png'), 'png');

    const run = spawnSync('bash', ['-c', script], {
      cwd: workspace,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, GITHUB_WORKSPACE: workspace },
    });

    expect(run.status).toBe(0);
    const collected = fs.readdirSync(path.join(workspace, 'screenshots-flat'));
    expect(collected.some((f) => f.startsWith('smoke-home-'))).toBe(true);
    expect(collected.some((f) => f.startsWith('screenshot-failed-'))).toBe(true);
  });
});

describe('the post-build smoke test', () => {
  it('uploads the screenshots directory the smoke flow writes to', () => {
    const uploads = Object.values(load('build.yml').jobs)
      .flatMap(({ steps }) => steps ?? [])
      .filter((s) => s.with?.name === 'e2e-smoke-screenshots')
      .flatMap((s) => (s.with?.path ?? '').split('\n').map((p) => p.trim()));

    expect(uploads).toContain('screenshots/');
  });
});
