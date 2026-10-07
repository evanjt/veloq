import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(__dirname, '../../..');
const yaml = require('js-yaml') as { load: (source: string) => unknown };

type Step = {
  name?: string;
  id?: string;
  uses?: string;
  if?: string;
  run?: string;
  with?: Record<string, string>;
};
type Workflow = { jobs: Record<string, { steps: Step[]; with?: Record<string, string> }> };

function workflow(name: string): Workflow {
  return yaml.load(readFileSync(join(ROOT, `.github/workflows/${name}.yml`), 'utf8')) as Workflow;
}

function step(steps: Step[], name: string): Step {
  const found = steps.find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing step: ${name}`);
  return found;
}

function runScript(script: string, dir: string, env: Record<string, string> = {}) {
  return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('Android release configuration', () => {
  const steps = workflow('build-android').jobs.build.steps;
  const configStep = step(steps, 'Write google-services.json');
  const cacheStep = step(steps, 'Restore built APK/AAB');
  const action = yaml.load(
    readFileSync(join(ROOT, '.github/actions/write-google-services-stub/action.yml'), 'utf8')
  ) as { runs: { steps: Step[] } };
  const script = action.runs.steps[0].run ?? '';

  it('checks configuration before accepting a cached APK or AAB', () => {
    expect(steps.indexOf(configStep)).toBeLessThan(steps.indexOf(cacheStep));
    expect(configStep.if).toBeUndefined();
    expect(configStep.with?.['allow-stub']).toBe('${{ inputs.allow-stub }}');
    expect(cacheStep.with?.key).toContain('steps.native.outputs.toolchain');
  });

  it('allows the placeholder only for a pull request build', () => {
    const call = workflow('build').jobs['build-android'].with;
    expect(call?.variant).toBe('production');
    expect(call?.['allow-stub']).toBe("${{ github.event_name == 'pull_request' }}");
  });

  it('fails without the secret on main and dispatch builds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'veloq-google-services-'));
    try {
      const result = runScript(script, dir, {
        GOOGLE_SERVICES_JSON: '',
        ALLOW_STUB: 'false',
        PACKAGE_NAME: 'com.veloq.app',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('GOOGLE_SERVICES_JSON');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('allows the placeholder for pull request builds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'veloq-google-services-'));
    try {
      const result = runScript(script, dir, {
        GOOGLE_SERVICES_JSON: '',
        ALLOW_STUB: 'true',
        PACKAGE_NAME: 'com.veloq.app',
      });
      expect(result.status).toBe(0);
      expect(readFileSync(join(dir, 'google-services.json'), 'utf8')).toContain('com.veloq.app');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes the supplied configuration on a release build', () => {
    const dir = mkdtempSync(join(tmpdir(), 'veloq-google-services-'));
    const contents = '{"project_info":{"project_id":"veloq"}}';
    try {
      const result = runScript(script, dir, {
        GOOGLE_SERVICES_JSON: Buffer.from(contents).toString('base64'),
        ALLOW_STUB: 'false',
        PACKAGE_NAME: 'com.veloq.app',
      });
      expect(result.status).toBe(0);
      expect(readFileSync(join(dir, 'google-services.json'), 'utf8')).toBe(contents);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('release changelog', () => {
  const steps = workflow('release').jobs.release.steps;
  const changelog = step(steps, 'Read changelog');
  const script = (changelog.run ?? '').replace('${{ steps.version.outputs.version_code }}', '40');

  function runChangelog(app: object, fileCode?: number) {
    const dir = mkdtempSync(join(tmpdir(), 'veloq-release-notes-'));
    const output = join(dir, 'output');
    writeFileSync(join(dir, 'app.json'), JSON.stringify(app));
    if (fileCode !== undefined) {
      const folder = join(dir, 'config/fastlane/metadata/android/en-US/changelogs');
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, `${fileCode}.txt`), 'Release notes for this build');
    }
    const result = runScript(script, dir, { GITHUB_OUTPUT: output });
    rmSync(dir, { recursive: true, force: true });
    return result;
  }

  it('uses the shipped Android version code when the tag number differs', () => {
    const result = runChangelog({ expo: { android: { versionCode: 29 } } }, 29);
    expect(result.status).toBe(0);
  });

  it('fails when app.json has no Android version code', () => {
    const result = runChangelog({ expo: { android: {} } }, 40);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('versionCode');
  });

  it('fails when the shipped version has no release notes', () => {
    const result = runChangelog({ expo: { android: { versionCode: 29 } } });
    expect(result.status).not.toBe(0);
  });
});
