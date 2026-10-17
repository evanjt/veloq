/**
 * Scenario: Test skips a job a Dependabot change cannot reach, and CI Required
 * judges every job's result. Build skips the native builds for a pull request
 * that reaches no native code, and Build Required judges a bundle check in
 * their place.
 * Expected behaviour: a job skipped while one of its areas is reached fails,
 * one skipped while none is reached passes, and every run but a Dependabot
 * pull request plans every job and both zones. A native build skipped while
 * the change reaches native code fails, and so does a failed bundle check.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../scripts/ci-required.mjs');

type Results = Record<string, string>;
type Plan = { areas: Record<string, boolean>; run: Record<string, boolean>; zones: string[] };

const ALL_PASSED: Results = {
  jest: 'success',
  js: 'success',
  rust: 'success',
  'rust-lint': 'success',
  'rust-advisories': 'success',
  'verify-bindings': 'success',
};

const EVERY_AREA = { appJs: true, rust: true, oauthProxy: true };
const NO_AREA = { appJs: false, rust: false, oauthProxy: false };

function call<T>(name: string, input: unknown): T {
  const driver = `
    import * as m from ${JSON.stringify(SCRIPT)};
    process.stdout.write(JSON.stringify(m[process.argv[1]](JSON.parse(process.argv[2]))));
  `;
  const out = execFileSync(
    'node',
    ['--input-type=module', '-e', driver, name, JSON.stringify(input)],
    { encoding: 'utf8' }
  );
  return JSON.parse(out);
}

function failures(areas: unknown, results: Results, changes = 'success'): string[] {
  return call<string[]>('ciRequired', { changes, areas, results });
}

function plan(input: Record<string, unknown>): Plan {
  return call<Plan>('plan', input);
}

describe('ciRequired', () => {
  it('fails a job skipped while its area is reached', () => {
    const out = failures({ ...NO_AREA, appJs: true }, { ...ALL_PASSED, jest: 'skipped' });
    expect(out).toEqual([expect.stringContaining('jest was skipped')]);
  });

  it('passes a job skipped while no area of its is reached', () => {
    expect(failures(NO_AREA, { ...ALL_PASSED, jest: 'skipped', rust: 'skipped' })).toEqual([]);
  });

  it('fails a job that failed while no area of its is reached', () => {
    const out = failures(NO_AREA, { ...ALL_PASSED, rust: 'failure' });
    expect(out).toEqual([expect.stringContaining('rust ended failure')]);
  });

  it('fails a cancelled job whatever the areas', () => {
    expect(failures(NO_AREA, { ...ALL_PASSED, js: 'cancelled' })).toHaveLength(1);
  });

  it('passes a job that succeeded while its area is reached', () => {
    expect(failures(EVERY_AREA, ALL_PASSED)).toEqual([]);
  });

  it('holds a job to any one of its areas, so the bindings run for an app change', () => {
    const out = failures(
      { ...NO_AREA, appJs: true },
      { ...ALL_PASSED, 'verify-bindings': 'skipped' }
    );
    expect(out).toHaveLength(1);
  });

  it('fails a skipped job on main, where every area is planned', () => {
    const { areas } = plan({ event: 'push' });
    expect(failures(areas, { ...ALL_PASSED, 'rust-advisories': 'skipped' })).toHaveLength(1);
  });

  it('fails every skip when the change detection failed and named no areas', () => {
    const skipped = Object.fromEntries(Object.keys(ALL_PASSED).map((job) => [job, 'skipped']));
    const out = failures(undefined, skipped, 'failure');
    expect(out).toHaveLength(1 + Object.keys(ALL_PASSED).length);
  });

  it('fails a job whose result is missing', () => {
    const { jest: _jest, ...rest } = ALL_PASSED;
    expect(failures(EVERY_AREA, rest)).toEqual(['jest ended unset']);
  });
});

describe('plan', () => {
  const dependabot = { event: 'pull_request', author: 'dependabot[bot]' };
  const pureJsBump = {
    ...dependabot,
    paths: ['package.json', 'package-lock.json'],
    areas: { appJs: true, native: false, rust: false, oauthProxy: false, workflows: false },
  };

  it('runs every job in both zones on a push to main', () => {
    const out = plan({ event: 'push' });
    expect(Object.values(out.run).every(Boolean)).toBe(true);
    expect(out.zones).toEqual(['Pacific/Kiritimati', 'America/Los_Angeles']);
  });

  it('runs every job for a pull request someone else opened, whatever it changes', () => {
    const out = plan({ ...pureJsBump, author: 'glassblower' });
    expect(out.areas).toEqual(EVERY_AREA);
    expect(out.zones).toHaveLength(2);
  });

  it('runs a pure JavaScript bump through the app jobs in one zone, without the advisories', () => {
    const out = plan(pureJsBump);
    expect(out.run).toEqual({
      jest: true,
      js: true,
      rust: true,
      'rust-lint': true,
      'rust-advisories': false,
      'verify-bindings': true,
    });
    expect(out.zones).toEqual(['Pacific/Kiritimati']);
  });

  it('keeps both zones for a bump of a native package', () => {
    const out = plan({ ...pureJsBump, areas: { ...pureJsBump.areas, native: true } });
    expect(out.zones).toHaveLength(2);
  });

  it('runs only the bindings check for a bump of the OAuth proxy', () => {
    const out = plan({
      ...dependabot,
      paths: ['oauth-proxy/package-lock.json'],
      areas: { appJs: false, native: false, rust: false, oauthProxy: true, workflows: false },
    });
    expect(Object.entries(out.run).filter(([, runs]) => runs)).toEqual([['verify-bindings', true]]);
  });

  it('runs nothing for an action bump outside this workflow', () => {
    const out = plan({
      ...dependabot,
      paths: ['.github/workflows/build.yml'],
      areas: { appJs: false, native: true, rust: false, oauthProxy: false, workflows: true },
    });
    expect(Object.values(out.run).some(Boolean)).toBe(false);
  });

  it('runs every job for a bump of an action this workflow runs', () => {
    for (const path of ['.github/workflows/test.yml', '.github/actions/npm-ci/action.yml']) {
      const out = plan({
        ...dependabot,
        paths: [path],
        areas: { appJs: false, native: true, rust: false, oauthProxy: false, workflows: true },
      });
      expect(out.areas).toEqual(EVERY_AREA);
    }
  });
});

const BUILT = {
  'build-android': 'success',
  'build-ios': 'success',
  'bundle-check': 'skipped',
  'e2e-smoke': 'skipped',
};
const BUNDLED = {
  'build-android': 'skipped',
  'build-ios': 'skipped',
  'bundle-check': 'success',
  'e2e-smoke': 'skipped',
};

function buildFailures(input: Record<string, unknown>): string[] {
  return call<string[]>('buildRequired', { event: 'pull_request', changes: 'success', ...input });
}

describe('buildRequired', () => {
  it('passes a change that reaches no native code on its bundle check alone', () => {
    expect(buildFailures({ native: false, results: BUNDLED })).toEqual([]);
  });

  it('fails a change that reaches native code when the iOS build was skipped', () => {
    const out = buildFailures({ native: true, results: { ...BUILT, 'build-ios': 'skipped' } });
    expect(out).toEqual([expect.stringContaining('build-ios was skipped')]);
  });

  it('fails a change that reaches native code when the Android build was skipped', () => {
    const out = buildFailures({ native: true, results: { ...BUILT, 'build-android': 'skipped' } });
    expect(out).toEqual([expect.stringContaining('build-android was skipped')]);
  });

  it('fails a change that reaches no native code when the bundle check failed', () => {
    const out = buildFailures({
      native: false,
      results: { ...BUNDLED, 'bundle-check': 'failure' },
    });
    expect(out).toEqual([expect.stringContaining('bundle-check ended failure')]);
  });

  it('fails a change that reaches no native code when the bundle check was skipped', () => {
    const out = buildFailures({
      native: false,
      results: { ...BUNDLED, 'bundle-check': 'skipped' },
    });
    expect(out).toHaveLength(1);
  });

  it('fails a native build that ran and failed though the change reaches no native code', () => {
    const out = buildFailures({
      native: false,
      results: { ...BUNDLED, 'build-android': 'failure' },
    });
    expect(out).toEqual([expect.stringContaining('build-android ended failure')]);
  });

  it('passes a change that reaches native code on both builds', () => {
    expect(buildFailures({ native: true, results: BUILT })).toEqual([]);
  });

  it('holds a change to both builds when the plan named nothing', () => {
    const out = buildFailures({ native: undefined, results: BUNDLED });
    expect(out).toHaveLength(2);
  });

  it('fails every run whose change detection failed', () => {
    const out = buildFailures({ changes: 'failure', native: true, results: BUILT });
    expect(out).toEqual([expect.stringContaining('change detection ended failure')]);
  });

  it('requires both builds and the smoke test on main', () => {
    const results = { ...BUILT, 'e2e-smoke': 'success' };
    expect(buildFailures({ event: 'push', native: true, results })).toEqual([]);
    expect(
      buildFailures({
        event: 'push',
        native: true,
        results: { ...results, 'e2e-smoke': 'skipped' },
      })
    ).toHaveLength(1);
  });
});

describe('buildsNative', () => {
  const pr = { event: 'pull_request' };

  it('builds natively on every run but a pull request', () => {
    for (const event of ['push', 'workflow_dispatch']) {
      expect(call<boolean>('buildsNative', { event, areas: { ...NO_AREA, native: false } })).toBe(
        true
      );
    }
  });

  it('skips the native builds for a pull request that reaches only app code', () => {
    const areas = { appJs: true, native: false, rust: false, oauthProxy: false };
    expect(call<boolean>('buildsNative', { ...pr, areas })).toBe(false);
  });

  it('builds natively for a pull request that reaches the engine crate, which both builds compile', () => {
    const areas = { appJs: false, native: false, rust: true, oauthProxy: false };
    expect(call<boolean>('buildsNative', { ...pr, areas })).toBe(true);
  });

  it('builds natively for a pull request whose areas are unknown', () => {
    expect(call<boolean>('buildsNative', { ...pr, areas: {} })).toBe(true);
  });
});

describe('check', () => {
  function check(env: Record<string, string>) {
    const inherited: NodeJS.ProcessEnv = { ...process.env };
    delete inherited.GITHUB_OUTPUT;
    return spawnSync('node', [SCRIPT, 'check'], {
      encoding: 'utf8',
      env: { ...inherited, ...env },
    });
  }
  const passed = {
    JEST: 'success',
    JS: 'success',
    RUST: 'success',
    RUST_LINT: 'success',
    RUST_ADVISORIES: 'skipped',
    VERIFY_BINDINGS: 'success',
  };

  it('exits 0 for an advisory scan skipped on an app-only change', () => {
    const out = check({
      ...passed,
      CHANGES: 'success',
      AREAS: JSON.stringify({ ...NO_AREA, appJs: true }),
    });
    expect(out.status).toBe(0);
  });

  it('exits 1 and names the job when the areas output is empty', () => {
    const out = check({ ...passed, CHANGES: 'success', AREAS: '' });
    expect(out.status).toBe(1);
    expect(out.stdout).toContain('::error::rust-advisories was skipped');
  });
});

describe('build-check', () => {
  function buildCheck(env: Record<string, string>) {
    const inherited: NodeJS.ProcessEnv = { ...process.env };
    delete inherited.GITHUB_OUTPUT;
    return spawnSync('node', [SCRIPT, 'build-check'], {
      encoding: 'utf8',
      env: { ...inherited, EVENT: 'pull_request', CHANGES: 'success', SMOKE: 'skipped', ...env },
    });
  }

  it('exits 0 for a change that reaches no native code and bundled', () => {
    const out = buildCheck({
      NATIVE: 'false',
      ANDROID: 'skipped',
      IOS: 'skipped',
      BUNDLE: 'success',
    });
    expect(out.status).toBe(0);
  });

  it('exits 1 and names the build when the native output is empty', () => {
    const out = buildCheck({ NATIVE: '', ANDROID: 'skipped', IOS: 'skipped', BUNDLE: 'success' });
    expect(out.status).toBe(1);
    expect(out.stdout).toContain('::error::build-android was skipped');
  });
});
