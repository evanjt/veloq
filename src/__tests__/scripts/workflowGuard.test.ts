/**
 * Scenario: CI on main is a report, and each rule that keeps it true was lost
 * once to an edit every gate passed. With every save gate removed, a bench
 * linked again and an aggregator cut to two jobs, the tooling suite stayed
 * green. A scheduled coverage run that skipped a sha measured red read green.
 *
 * Expected behaviour: the guard refuses each of those shapes in fixture YAML,
 * names the file and the job, and passes a clean set.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-workflows.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'workflow-guard-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  initFixtureRepo(root);
  return root;
}

function runGuard(root?: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', root ? [SCRIPT, '--root', root] : [SCRIPT], {
      encoding: 'utf8',
      env: gitFreeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** A full commit sha, the only ref a third-party action may be pinned to. */
const PIN = '0123456789abcdef0123456789abcdef01234567';

const TEST_YML = `name: Test
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: \${{ github.ref != 'refs/heads/main' }}
jobs:
  jest:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/npm-ci
      - name: Restore Jest cache
        uses: actions/cache/restore@v6
        with:
          path: .jest-cache
          key: jest-\${{ github.sha }}
      - run: npm test
      - name: Save Jest cache
        if: \${{ !cancelled() && github.ref == 'refs/heads/main' }}
        uses: actions/cache/save@v6
        with:
          path: .jest-cache
          key: jest-\${{ github.sha }}
  rust:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
      - name: Cache Rust
        uses: Swatinem/rust-cache@${PIN} # v2
        with:
          save-if: \${{ github.ref == 'refs/heads/main' }}
      - name: Check Rust benches
        run: cargo check -p veloqrs --benches
  rust-advisories:
    uses: ./.github/workflows/rust-advisories.yml
  ci-required:
    needs: [jest, rust, rust-advisories]
    if: always()
    runs-on: ubuntu-24.04
    steps:
      - env:
          JEST: \${{ needs.jest.result }}
          RUST: \${{ needs.rust.result }}
          ADVISORIES: \${{ needs.rust-advisories.result }}
        run: for r in "$JEST" "$RUST" "$ADVISORIES"; do [ "$r" = success ] || exit 1; done
`;

const ADVISORIES_YML = `name: Advisories
on:
  workflow_call:
  schedule:
    - cron: "0 5 * * 1"
  workflow_dispatch:
jobs:
  audit:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
      - name: Scan the lockfile
        working-directory: rust
        run: cargo audit --deny warnings
`;

const BUILD_YML = `name: Build
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: \${{ github.ref != 'refs/heads/main' && github.ref_type != 'tag' }}
jobs:
  changes:
    runs-on: ubuntu-24.04
    outputs:
      native: \${{ steps.plan.outputs.native }}
    steps:
      - id: plan
        run: node scripts/ci-required.mjs build-plan
  build-android:
    needs: changes
    if: \${{ !cancelled() && needs.changes.outputs.native != 'false' }}
    runs-on: ubuntu-24.04
    steps:
      - name: Setup Gradle
        uses: gradle/actions/setup-gradle@${PIN} # v6
        with:
          cache-read-only: \${{ github.ref != 'refs/heads/main' }}
          cache-cleanup: on-success
      - name: Setup ccache
        uses: hendrikmuhs/ccache-action@${PIN} # v1.2.24
        with:
          key: ndk
          save: \${{ github.ref == 'refs/heads/main' }}
      - name: Compile the C++
        env:
          CMAKE_CXX_COMPILER_LAUNCHER: ccache
          CCACHE_COMPILERCHECK: content
        run: cmake --build build
  bundle-check:
    needs: changes
    if: needs.changes.outputs.native == 'false'
    runs-on: ubuntu-24.04
    steps:
      - run: npx expo export --platform android
  e2e-smoke:
    needs: build-android
    runs-on: ubuntu-24.04
    steps:
      - run: maestro test smoke.yaml
      - name: Fail on a freeze of our own app
        if: \${{ always() }}
        run: '! grep -qF "ANR in com.veloq" smoke-logcat.txt'
  build-required:
    needs: [changes, build-android, bundle-check, e2e-smoke]
    if: always()
    runs-on: ubuntu-24.04
    steps:
      - env:
          CHANGES: \${{ needs.changes.result }}
          NATIVE: \${{ needs.changes.outputs.native }}
          ANDROID: \${{ needs.build-android.result }}
          BUNDLE: \${{ needs.bundle-check.result }}
          SMOKE: \${{ needs.e2e-smoke.result }}
        run: node scripts/ci-required.mjs build-check
`;

const COVERAGE_YML = `name: Coverage
on:
  schedule:
    - cron: "0 3 * * *"
  workflow_dispatch:
jobs:
  coverage:
    runs-on: ubuntu-24.04
    steps:
      - name: Look for a run on this sha
        id: measured
        if: github.event_name == 'schedule'
        uses: actions/cache/restore@v6
        with:
          path: .measured
          key: coverage-outcome-\${{ github.sha }}-\${{ github.run_id }}
          restore-keys: coverage-outcome-\${{ github.sha }}-
      - name: Report the earlier result
        if: steps.measured.outputs.cache-matched-key != ''
        run: |
          outcome=$(cat .measured/outcome 2>/dev/null || true)
          if [ "$outcome" != success ]; then
            echo "::error::already measured: $outcome"
            exit 1
          fi
      - name: Measure
        id: measure
        if: steps.measured.outputs.cache-matched-key == ''
        run: npm run test:coverage
      - name: Record the outcome
        if: \${{ !cancelled() && github.ref == 'refs/heads/main' && (steps.measure.outcome == 'success' || steps.measure.outcome == 'failure') }}
        run: |
          mkdir -p .measured
          echo "\${{ steps.measure.outcome }}" > .measured/outcome
      - name: Save the record
        if: \${{ !cancelled() && github.ref == 'refs/heads/main' && (steps.measure.outcome == 'success' || steps.measure.outcome == 'failure') }}
        uses: actions/cache/save@v6
        with:
          path: .measured
          key: coverage-outcome-\${{ github.sha }}-\${{ github.run_id }}
`;

const HISTORY_COVERAGE_YML = `name: Coverage
on:
  schedule:
    - cron: "0 4 * * 1"
  workflow_dispatch:
permissions:
  contents: read
  actions: read
jobs:
  coverage:
    runs-on: ubuntu-24.04
    steps:
      - name: Look for a run on this sha
        id: earlier
        if: github.event_name == 'schedule'
        run: echo "outcome=$(node scripts/earlier-outcome.mjs "$REPO" coverage.yml "$SHA" "$RUN")" >> "$GITHUB_OUTPUT"
      - name: Report the earlier result
        if: steps.earlier.outputs.outcome != ''
        run: |
          if [ "$OUTCOME" != success ]; then
            exit 1
          fi
      - name: Measure
        id: measure
        if: steps.earlier.outputs.outcome == ''
        run: npm run test:coverage
`;

const NPM_ACTION = `name: npm ci
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v7
      with:
        node-version-file: .nvmrc
        package-manager-cache: false
    - id: npm-cache
      uses: actions/cache/restore@v6
      with:
        path: ~/.npm
        key: npm-\${{ hashFiles('package-lock.json') }}
    - shell: bash
      run: npm ci
    - if: github.ref == 'refs/heads/main' && steps.npm-cache.outputs.cache-hit != 'true'
      uses: actions/cache/save@v6
      with:
        path: ~/.npm
        key: \${{ steps.npm-cache.outputs.cache-primary-key }}
`;

const CLEAN: Record<string, string> = {
  '.github/workflows/test.yml': TEST_YML,
  '.github/workflows/build.yml': BUILD_YML,
  '.github/workflows/coverage.yml': COVERAGE_YML,
  '.github/workflows/rust-advisories.yml': ADVISORIES_YML,
  '.github/actions/npm-ci/action.yml': NPM_ACTION,
  '.nvmrc': '24\n',
  'package.json': JSON.stringify({ engines: { node: '^24.3.0' } }),
};

function withEdit(file: string, from: string, to: string): Record<string, string> {
  const before = CLEAN[file];
  if (!before.includes(from)) throw new Error(`fixture ${file} has no ${JSON.stringify(from)}`);
  return { ...CLEAN, [file]: before.replace(from, to) };
}

function refused(files: Record<string, string>): string {
  const { status, output } = runGuard(fixture(files));
  expect(status).toBe(1);
  return output;
}

it('passes a clean set', () => {
  const { status, output } = runGuard(fixture(CLEAN));
  expect(output).toContain('Workflow guard: caches write from main only');
  expect(status).toBe(0);
});

describe('native Rust profile', () => {
  it('refuses a local profile in workflow, job or step environment', () => {
    for (const edited of [
      TEST_YML.replace('concurrency:', 'env:\n  VELOQRS_RUST_PROFILE: release-dev\nconcurrency:'),
      TEST_YML.replace('  rust:\n', '  rust:\n    env:\n      VELOQRS_RUST_PROFILE: release-dev\n'),
      TEST_YML.replace(
        '      - name: Check Rust benches\n',
        '      - name: Check Rust benches\n        env:\n          VELOQRS_RUST_PROFILE: release-dev\n'
      ),
    ]) {
      const output = refused({ ...CLEAN, '.github/workflows/test.yml': edited });
      expect(output).toContain('VELOQRS_RUST_PROFILE must be release');
    }
  });

  it('refuses a local profile in a Gradle command', () => {
    const output = refused({
      ...CLEAN,
      '.github/workflows/build.yml': BUILD_YML.replace(
        '      - name: Setup ccache',
        '      - run: ./gradlew buildRustLibrary -PveloqrsRustProfile=release-dev\n      - name: Setup ccache'
      ),
    });
    expect(output).toContain('veloqrsRustProfile must be release');
  });
});

describe('caches', () => {
  it('refuses a Swatinem step without save-if', () => {
    const output = refused(
      withEdit(
        '.github/workflows/test.yml',
        "          save-if: ${{ github.ref == 'refs/heads/main' }}\n",
        ''
      )
    );
    expect(output).toContain('.github/workflows/test.yml (job rust step Cache Rust)');
    expect(output).toContain('Swatinem/rust-cache saves off main');
  });

  it('refuses a save-if widened past main', () => {
    const output = refused(
      withEdit(
        '.github/workflows/test.yml',
        "save-if: ${{ github.ref == 'refs/heads/main' }}",
        "save-if: ${{ github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch' }}"
      )
    );
    expect(output).toContain('Swatinem/rust-cache saves off main');
  });

  it('refuses a Swatinem step in a composite action without save-if', () => {
    const output = refused({
      ...CLEAN,
      '.github/actions/setup-rust/action.yml': `name: Setup Rust
runs:
  using: composite
  steps:
    - name: Cache Rust dependencies
      uses: Swatinem/rust-cache@${PIN} # v2
      with:
        workspaces: modules/veloqrs/rust
`,
    });
    expect(output).toContain(
      '.github/actions/setup-rust/action.yml (step Cache Rust dependencies)'
    );
  });

  it('refuses setup-gradle writing off main', () => {
    const output = refused(
      withEdit(
        '.github/workflows/build.yml',
        "          cache-read-only: ${{ github.ref != 'refs/heads/main' }}\n",
        ''
      )
    );
    expect(output).toContain('(job build-android step Setup Gradle)');
    expect(output).toContain('setup-gradle writes its cache off main');
  });

  it('refuses setup-gradle without cache-cleanup', () => {
    const output = refused(
      withEdit('.github/workflows/build.yml', '          cache-cleanup: on-success\n', '')
    );
    expect(output).toContain('(job build-android step Setup Gradle)');
    expect(output).toContain('Set cache-cleanup: on-success');
  });

  it('refuses ccache-action saving on every ref', () => {
    const output = refused(
      withEdit(
        '.github/workflows/build.yml',
        "save: ${{ github.ref == 'refs/heads/main' }}",
        "save: ${{ github.event_name != 'pull_request' }}"
      )
    );
    expect(output).toContain('(job build-android step Setup ccache)');
    expect(output).toContain('ccache-action saves off main');
  });

  it('refuses a ccache key saved without a timestamp', () => {
    const output = refused(
      withEdit(
        '.github/workflows/build.yml',
        '          key: ndk\n',
        '          key: ndk\n          append-timestamp: false\n'
      )
    );
    expect(output).toContain('(job build-android step Setup ccache)');
    expect(output).toContain('append-timestamp: false');
  });

  it('refuses a ccache launch that checks the compiler by mtime', () => {
    for (const check of ['', '          CCACHE_COMPILERCHECK: mtime\n']) {
      const output = refused(
        withEdit('.github/workflows/build.yml', '          CCACHE_COMPILERCHECK: content\n', check)
      );
      expect(output).toContain('(job build-android step Compile the C++)');
      expect(output).toContain('Set CCACHE_COMPILERCHECK: content');
    }
  });

  it('refuses an actions/cache/save gated off pull requests but not to main', () => {
    const output = refused(
      withEdit(
        '.github/workflows/test.yml',
        "if: ${{ !cancelled() && github.ref == 'refs/heads/main' }}",
        "if: ${{ !cancelled() && github.event_name != 'pull_request' }}"
      )
    );
    expect(output).toContain('(job jest step Save Jest cache)');
    expect(output).toContain('actions/cache/save runs off main');
  });

  it('refuses a save gate widened past main inside a group', () => {
    const output = refused(
      withEdit(
        '.github/workflows/coverage.yml',
        "- name: Save the record\n        if: ${{ !cancelled() && github.ref == 'refs/heads/main' && (steps.measure.outcome",
        "- name: Save the record\n        if: ${{ !cancelled() && (github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch') && (steps.measure.outcome"
      )
    );
    expect(output).toContain('(job coverage step Save the record)');
    expect(output).toContain('actions/cache/save runs off main');
  });

  it('refuses setup-gradle narrowed to read-only on pull requests alone', () => {
    const output = refused(
      withEdit(
        '.github/workflows/build.yml',
        "cache-read-only: ${{ github.ref != 'refs/heads/main' }}",
        "cache-read-only: ${{ github.ref != 'refs/heads/main' && github.event_name == 'pull_request' }}"
      )
    );
    expect(output).toContain('setup-gradle writes its cache off main');
  });

  it('refuses a combined actions/cache step', () => {
    const output = refused(
      withEdit(
        '.github/workflows/test.yml',
        'uses: actions/cache/restore@v6',
        'uses: actions/cache@v6'
      )
    );
    expect(output).toContain('(job jest step Restore Jest cache)');
    expect(output).toContain('actions/cache saves in a post step from any ref');
  });

  it('refuses setup-node with cache: npm', () => {
    const output = refused(
      withEdit(
        '.github/actions/npm-ci/action.yml',
        'node-version-file: .nvmrc',
        'node-version-file: .nvmrc\n        cache: npm'
      )
    );
    expect(output).toContain('.github/actions/npm-ci/action.yml (step actions/setup-node@v7)');
    expect(output).toContain('actions/setup-node with cache:');
  });

  it('refuses setup-node that leaves its package-manager cache on', () => {
    const output = refused(
      withEdit('.github/actions/npm-ci/action.yml', '        package-manager-cache: false\n', '')
    );
    expect(output).toContain('.github/actions/npm-ci/action.yml (step actions/setup-node@v7)');
    expect(output).toContain('package-manager-cache: false');
  });

  const nodeWorkflow = (withBlock: string) => ({
    ...CLEAN,
    '.github/workflows/node-tool.yml': `name: Node tool
on:
  pull_request:
jobs:
  check:
    runs-on: ubuntu-24.04
    steps:
      - name: Setup Node.js
        uses: actions/setup-node@v6
${withBlock}`,
  });

  it('refuses setup-node given a version rather than .nvmrc', () => {
    const output = refused(
      nodeWorkflow(
        '        with:\n          node-version: "22"\n          package-manager-cache: false\n'
      )
    );
    expect(output).toContain('node-tool.yml (job check step Setup Node.js)');
    expect(output).toContain('node-version-file: .nvmrc');
  });

  it('refuses setup-node that reads another version file', () => {
    const output = refused(
      nodeWorkflow(
        '        with:\n          node-version-file: .node-version\n          package-manager-cache: false\n'
      )
    );
    expect(output).toContain('node-tool.yml (job check step Setup Node.js)');
    expect(output).toContain('node-version-file: .nvmrc');
  });

  it('accepts setup-node reading .nvmrc in a workflow', () => {
    const { status } = runGuard(
      fixture(
        nodeWorkflow(
          '        with:\n          node-version-file: .nvmrc\n          package-manager-cache: false\n'
        )
      )
    );
    expect(status).toBe(0);
  });

  it('refuses a version passed to the npm-ci action', () => {
    const output = refused(
      withEdit(
        '.github/workflows/test.yml',
        '      - uses: ./.github/actions/npm-ci\n',
        '      - uses: ./.github/actions/npm-ci\n        with:\n          node-version: "22"\n'
      )
    );
    expect(output).toContain('test.yml (job jest step ./.github/actions/npm-ci)');
    expect(output).toContain('node-version');
  });

  it('refuses a tree with no .nvmrc', () => {
    const files = { ...CLEAN };
    delete files['.nvmrc'];
    expect(refused(files)).toContain('.nvmrc');
  });

  it.each([[{}], [{ engines: { node: '>=20' } }], [{ engines: { node: '^22.13.0' } }]])(
    'refuses package.json %j when it does not hold the .nvmrc major',
    (pkg) => {
      const output = refused({ ...CLEAN, 'package.json': JSON.stringify(pkg) });
      expect(output).toContain('package.json');
      expect(output).toContain('engines.node');
    }
  );

  const goWorkflow = (withBlock: string) => ({
    ...CLEAN,
    '.github/workflows/go-tool.yml': `name: Go tool
on:
  pull_request:
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - name: Setup Go
        uses: actions/setup-go@v6
${withBlock}`,
  });

  it('refuses setup-go that leaves its default dependency cache on', () => {
    const output = refused(goWorkflow('        with:\n          go-version: "1.23"\n'));
    expect(output).toContain('.github/workflows/go-tool.yml (job build step Setup Go)');
    expect(output).toContain('cache: false');
  });

  it('accepts setup-go with cache: false', () => {
    const files = goWorkflow(
      '        with:\n          go-version: "1.23"\n          cache: false\n'
    );
    const { status } = runGuard(fixture(files));
    expect(status).toBe(0);
  });

  it('refuses setup-ruby with bundler-cache', () => {
    const output = refused({
      ...CLEAN,
      '.github/workflows/release.yml': `name: Release
on:
  push:
    tags: ["*"]
jobs:
  deploy:
    runs-on: ubuntu-24.04
    steps:
      - name: Setup Ruby
        uses: ruby/setup-ruby@${PIN} # v1
        with:
          ruby-version: "3.4"
          bundler-cache: true
`,
    });
    expect(output).toContain('.github/workflows/release.yml (job deploy step Setup Ruby)');
    expect(output).toContain('bundler-cache');
  });
});

describe('action runtimes', () => {
  it('refuses a checkout major that runs on Node 20', () => {
    const output = refused(
      withEdit('.github/workflows/test.yml', 'actions/checkout@v7', 'actions/checkout@v4')
    );
    expect(output).toContain('.github/workflows/test.yml (job jest step actions/checkout@v4)');
    expect(output).toContain('runs on Node 20');
    expect(output).toContain('actions/checkout@v5');
  });

  it('refuses a cache restore major that runs on Node 20 inside a composite action', () => {
    const output = refused(
      withEdit(
        '.github/actions/npm-ci/action.yml',
        'actions/cache/restore@v6',
        'actions/cache/restore@v4'
      )
    );
    expect(output).toContain('.github/actions/npm-ci/action.yml (step actions/cache/restore@v4)');
    expect(output).toContain('runs on Node 20');
  });

  it('refuses a commit pin whose tag comment names a release on Node 20', () => {
    const output = refused(
      withEdit(
        '.github/workflows/build.yml',
        `hendrikmuhs/ccache-action@${PIN} # v1.2.24`,
        `hendrikmuhs/ccache-action@${PIN} # v1.2`
      )
    );
    expect(output).toContain('(job build-android step Setup ccache)');
    expect(output).toContain('hendrikmuhs/ccache-action@v1.2.21');
  });

  it('refuses an upload-artifact major the first bump left on Node 20', () => {
    const output = refused({
      ...CLEAN,
      '.github/workflows/report.yml': `name: Report
on:
  pull_request:
jobs:
  report:
    runs-on: ubuntu-24.04
    steps:
      - name: Upload report
        uses: actions/upload-artifact@v5
        with:
          name: report
          path: report
`,
    });
    expect(output).toContain('.github/workflows/report.yml (job report step Upload report)');
    expect(output).toContain('actions/upload-artifact@v6');
  });

  it('leaves a commit pin with no tag comment, and an action it has no record of, alone', () => {
    const { status, output } = runGuard(
      fixture({
        ...CLEAN,
        '.github/workflows/report.yml': `name: Report
on:
  pull_request:
jobs:
  report:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@0ad4b8fadaa221de15dcec353f45205ec38ea70b
      - uses: example-org/lantern-action@${PIN} # v1
`,
      })
    );
    expect(output).not.toContain('Node 20');
    expect(status).toBe(0);
  });
});

describe('schedules', () => {
  it('refuses a schedule with no measured-sha skip', () => {
    const output = refused({
      ...CLEAN,
      '.github/workflows/jest-coverage.yml': `name: Jest Coverage
on:
  schedule:
    - cron: "0 4 * * 1"
  workflow_dispatch:
jobs:
  coverage:
    runs-on: ubuntu-24.04
    steps:
      - run: npm run test:coverage
`,
    });
    expect(output).toContain('.github/workflows/jest-coverage.yml (on.schedule)');
  });

  it('refuses a lookup whose record is never saved', () => {
    const output = refused(
      withEdit(
        '.github/workflows/coverage.yml',
        'key: coverage-outcome-${{ github.sha }}-${{ github.run_id }}\n          restore-keys',
        'key: other-${{ github.sha }}-${{ github.run_id }}\n          restore-keys'
      )
    );
    expect(output).toContain('.github/workflows/coverage.yml (on.schedule)');
  });

  it('refuses a skip that only looks the record up, so it cannot read a red back', () => {
    const output = refused(
      withEdit(
        '.github/workflows/coverage.yml',
        'restore-keys: coverage-outcome-${{ github.sha }}-\n      - name: Report',
        'restore-keys: coverage-outcome-${{ github.sha }}-\n          lookup-only: true\n      - name: Report'
      )
    );
    expect(output).toContain('.github/workflows/coverage.yml (on.schedule)');
    expect(output).toContain('lookup-only');
  });

  it('refuses a record that holds the sha and not the outcome', () => {
    const output = refused(
      withEdit(
        '.github/workflows/coverage.yml',
        'echo "${{ steps.measure.outcome }}" > .measured/outcome',
        'echo "${{ github.sha }}" > .measured/sha'
      )
    );
    expect(output).toContain('.github/workflows/coverage.yml (on.schedule)');
    expect(output).toContain('outcome');
  });

  it('refuses a skip that reads a different file from the one the outcome is written to', () => {
    const output = refused(
      withEdit('.github/workflows/coverage.yml', '> .measured/outcome', '> .measured/result')
    );
    expect(output).toContain('.github/workflows/coverage.yml (on.schedule)');
    expect(output).toContain('.measured/result');
  });

  it('refuses an outcome that leaves out a check the skip replaces', () => {
    const output = refused(
      withEdit(
        '.github/workflows/coverage.yml',
        '        run: npm run test:coverage\n',
        "        run: npm run test:coverage\n      - name: Hold the floors\n        id: floors\n        if: steps.measured.outputs.cache-matched-key == ''\n        run: node check-floors.mjs\n"
      )
    );
    expect(output).toContain('.github/workflows/coverage.yml (on.schedule)');
    expect(output).toContain('leaves out Hold the floors');
  });

  it('refuses a skip that never fails on a sha measured red', () => {
    const output = refused(withEdit('.github/workflows/coverage.yml', '            exit 1\n', ''));
    expect(output).toContain('.github/workflows/coverage.yml (on.schedule)');
    expect(output).toContain('measured red');
  });

  it('refuses a record keyed on the sha alone, which a re-run by hand cannot supersede', () => {
    const file = '.github/workflows/coverage.yml';
    const yml = CLEAN[file];
    const at = yml.lastIndexOf('-${{ github.run_id }}');
    const output = refused({
      ...CLEAN,
      [file]: yml.slice(0, at) + yml.slice(at + '-${{ github.run_id }}'.length),
    });
    expect(output).toContain('.github/workflows/coverage.yml (on.schedule)');
    expect(output).toContain('cannot supersede');
  });

  it('refuses a skip keyed on cache-hit, which a prefix restore never sets', () => {
    const output = refused(
      withEdit(
        '.github/workflows/coverage.yml',
        "if: steps.measured.outputs.cache-matched-key != ''",
        "if: steps.measured.outputs.cache-hit == 'true'"
      )
    );
    expect(output).toContain('.github/workflows/coverage.yml (on.schedule)');
    expect(output).toContain('cache-matched-key');
  });

  it('refuses a weekly schedule that keeps its record in the cache', () => {
    const output = refused(
      withEdit('.github/workflows/coverage.yml', '"0 3 * * *"', '"0 4 * * 1"')
    );
    expect(output).toContain('.github/workflows/coverage.yml (on.schedule)');
    expect(output).toContain('run history');
  });

  it('allows a weekly schedule that reads its record from the run history', () => {
    const { status } = runGuard(
      fixture({ ...CLEAN, '.github/workflows/coverage.yml': HISTORY_COVERAGE_YML })
    );
    expect(status).toBe(0);
  });

  it('refuses a run-history record read without actions: read', () => {
    const output = refused({
      ...CLEAN,
      '.github/workflows/coverage.yml': HISTORY_COVERAGE_YML.replace('  actions: read\n', ''),
    });
    expect(output).toContain('.github/workflows/coverage.yml (on.schedule)');
    expect(output).toContain('actions: read');
  });

  it('refuses a run-history record that nothing reports', () => {
    const output = refused({
      ...CLEAN,
      '.github/workflows/coverage.yml': HISTORY_COVERAGE_YML.replace('            exit 1\n', ''),
    });
    expect(output).toContain('.github/workflows/coverage.yml (on.schedule)');
    expect(output).toContain('measured red');
  });

  it('allows the named E2E sweep', () => {
    const { status } = runGuard(
      fixture({
        ...CLEAN,
        '.github/workflows/e2e.yml': `name: E2E
on:
  schedule:
    - cron: '0 3 * * 0'
jobs:
  e2e-android:
    runs-on: ubuntu-24.04
    steps:
      - run: maestro test .maestro
`,
      })
    );
    expect(status).toBe(0);
  });

  it('allows the weekly code scan, whose query packs move without a push', () => {
    const { status } = runGuard(
      fixture({
        ...CLEAN,
        '.github/workflows/codeql.yml': `name: CodeQL
on:
  schedule:
    - cron: '30 4 * * 1'
jobs:
  scan:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
`,
      })
    );
    expect(status).toBe(0);
  });
});

describe('runner images', () => {
  const JEST_RUNNER = '  jest:\n    runs-on: ubuntu-24.04\n';

  it('refuses a job on a floating -latest label', () => {
    const output = refused(
      withEdit('.github/workflows/test.yml', JEST_RUNNER, '  jest:\n    runs-on: ubuntu-latest\n')
    );
    expect(output).toContain('.github/workflows/test.yml (job jest runs-on)');
    expect(output).toContain('ubuntu-latest');
  });

  it('refuses a floating label in a list of labels', () => {
    const output = refused(
      withEdit(
        '.github/workflows/test.yml',
        JEST_RUNNER,
        '  jest:\n    runs-on: [self-hosted, macos-latest]\n'
      )
    );
    expect(output).toContain('.github/workflows/test.yml (job jest runs-on)');
  });

  it('refuses a floating label reached through the matrix', () => {
    const output = refused(
      withEdit(
        '.github/workflows/test.yml',
        JEST_RUNNER,
        '  jest:\n    strategy:\n      matrix:\n        os: [ubuntu-24.04, windows-latest]\n    runs-on: ${{ matrix.os }}\n'
      )
    );
    expect(output).toContain('.github/workflows/test.yml (job jest runs-on)');
    expect(output).toContain('windows-latest');
  });

  it('accepts pinned labels, in a list and through the matrix', () => {
    const { status } = runGuard(
      fixture(
        withEdit(
          '.github/workflows/test.yml',
          JEST_RUNNER,
          '  jest:\n    strategy:\n      matrix:\n        os: [ubuntu-24.04, macos-26]\n    runs-on: ${{ matrix.os }}\n'
        )
      )
    );
    expect(status).toBe(0);
  });
});

describe('test shards', () => {
  const JEST_RUN = '      - run: npm test\n';
  const JEST_RUNNER = '  jest:\n    runs-on: ubuntu-24.04\n';

  function sharded(shards: string, run: string): Record<string, string> {
    const runner = withEdit(
      '.github/workflows/test.yml',
      JEST_RUNNER,
      `  jest:\n    strategy:\n      matrix:\n        shard: ${shards}\n    runs-on: ubuntu-24.04\n`
    );
    const before = runner['.github/workflows/test.yml'];
    return { ...runner, '.github/workflows/test.yml': before.replace(JEST_RUN, run) };
  }

  it('refuses a shard count past the matrix, which leaves the last shard unrun', () => {
    const output = refused(
      sharded('[1, 2]', '      - run: npm test -- --shard=${{ matrix.shard }}/3\n')
    );
    expect(output).toContain('.github/workflows/test.yml (job jest');
    expect(output).toContain('--shard');
  });

  it('refuses a matrix that skips a shard index', () => {
    const output = refused(
      sharded('[1, 3]', '      - run: npm test -- --shard=${{ matrix.shard }}/3\n')
    );
    expect(output).toContain('.github/workflows/test.yml (job jest');
  });

  it('refuses a fixed shard index, which runs one part of the suite', () => {
    const output = refused(sharded('[1, 2]', '      - run: npm test -- --shard=1/2\n'));
    expect(output).toContain('.github/workflows/test.yml (job jest');
  });

  it('accepts a shard count that matches the matrix', () => {
    const { status, output } = runGuard(
      fixture(sharded('[1, 2]', '      - run: npm test -- --shard=${{ matrix.shard }}/2\n'))
    );
    expect(output).not.toContain('--shard');
    expect(status).toBe(0);
  });
});

describe('caller text spliced into a shell', () => {
  const JEST_RUN = '      - run: npm test\n';

  it('refuses a dispatch input expanded inside a run body', () => {
    const output = refused(
      withEdit(
        '.github/workflows/test.yml',
        JEST_RUN,
        '      - name: Jest shard\n        run: npm test -- --shard=${{ inputs.shard }}\n'
      )
    );
    expect(output).toContain('.github/workflows/test.yml (job jest step Jest shard)');
    expect(output).toContain('inputs.shard');
  });

  it('refuses event text and the head ref inside a multi-line run body', () => {
    for (const expression of [
      '${{ github.event.pull_request.title }}',
      '${{github.head_ref}}',
      '${{ github.event.inputs.tier }}',
    ]) {
      const output = refused(
        withEdit(
          '.github/workflows/test.yml',
          JEST_RUN,
          `      - name: Jest\n        run: |\n          echo start\n          npm test -- ${expression}\n`
        )
      );
      expect(output).toContain('.github/workflows/test.yml (job jest step Jest)');
    }
  });

  it("refuses an input expanded inside an action's script", () => {
    const output = refused(
      withEdit(
        '.github/workflows/test.yml',
        JEST_RUN,
        `      - name: Emulator suite\n        uses: example-org/emulator-runner@${PIN}\n        with:\n          script: |\n            ./run.sh --include-tags=\${{ inputs.tier || 'tier0' }}\n`
      )
    );
    expect(output).toContain('.github/workflows/test.yml (job jest step Emulator suite)');
    expect(output).toContain('inputs.tier');
  });

  it('refuses an input expanded inside a composite action run body', () => {
    const output = refused(
      withEdit(
        '.github/actions/npm-ci/action.yml',
        'run: npm ci',
        'run: npm ci ${{ inputs.flags }}'
      )
    );
    expect(output).toContain('.github/actions/npm-ci/action.yml');
    expect(output).toContain('inputs.flags');
  });

  it('accepts the same values passed through env and read as quoted variables', () => {
    const { status } = runGuard(
      fixture(
        withEdit(
          '.github/workflows/test.yml',
          JEST_RUN,
          `      - name: Jest\n        env:\n          TIERS: \${{ inputs.tier || 'tier0' }}\n          TITLE: \${{ github.event.pull_request.title }}\n        run: npm test -- --tiers="$TIERS" --title="$TITLE"\n`
        )
      )
    );
    expect(status).toBe(0);
  });
});

describe('the smoke job and a frozen app', () => {
  const CHECK = `      - name: Fail on a freeze of our own app
        if: \${{ always() }}
        run: '! grep -qF "ANR in com.veloq" smoke-logcat.txt'
`;

  it('refuses a smoke job with no step that fails on an ANR in our app', () => {
    const output = refused(withEdit('.github/workflows/build.yml', CHECK, ''));
    expect(output).toContain('.github/workflows/build.yml (job e2e-smoke)');
    expect(output).toContain('ANR in com');
  });

  it('refuses an ANR check that only runs when the flow passed', () => {
    const output = refused(
      withEdit(
        '.github/workflows/build.yml',
        "        if: ${{ always() }}\n        run: '! grep",
        "        run: '! grep"
      )
    );
    expect(output).toContain('.github/workflows/build.yml (job e2e-smoke)');
  });
});

describe('cancelled pushes to main', () => {
  it('refuses a workflow that cancels main for a newer push', () => {
    const output = refused(
      withEdit(
        '.github/workflows/test.yml',
        "cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}",
        'cancel-in-progress: true'
      )
    );
    expect(output).toContain('.github/workflows/test.yml (concurrency)');
  });

  it('refuses a cancel gate widened to main by a disjunction', () => {
    const output = refused(
      withEdit(
        '.github/workflows/test.yml',
        "cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}",
        "cancel-in-progress: ${{ github.ref != 'refs/heads/main' || github.event_name == 'push' }}"
      )
    );
    expect(output).toContain('.github/workflows/test.yml (concurrency)');
  });

  it('refuses a job that cancels its own run on main', () => {
    const output = refused(
      withEdit(
        '.github/workflows/build.yml',
        '    needs: build-android\n',
        '    needs: build-android\n    concurrency:\n      group: smoke-${{ github.ref }}\n      cancel-in-progress: true\n'
      )
    );
    expect(output).toContain('.github/workflows/build.yml (job e2e-smoke concurrency)');
  });

  it('leaves a workflow that never runs on main alone', () => {
    const { status } = runGuard(
      fixture({
        ...CLEAN,
        '.github/workflows/pr.yml': `name: PR
on: pull_request
concurrency:
  group: pr-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  check:
    runs-on: ubuntu-24.04
    steps:
      - run: echo ok
`,
      })
    );
    expect(status).toBe(0);
  });
});

describe('aggregators', () => {
  it('refuses a job the aggregator does not need', () => {
    const output = refused(
      withEdit(
        '.github/workflows/test.yml',
        'needs: [jest, rust, rust-advisories]',
        'needs: [jest, rust-advisories]'
      )
    );
    expect(output).toContain('.github/workflows/test.yml (job ci-required): does not need rust');
  });

  it('refuses a needed job whose result is never read', () => {
    const output = refused(
      withEdit(
        '.github/workflows/build.yml',
        '          SMOKE: ${{ needs.e2e-smoke.result }}\n',
        ''
      )
    );
    expect(output).toContain(
      '(job build-required): needs e2e-smoke and never reads needs.e2e-smoke.result'
    );
  });

  const PLANNED = {
    ...CLEAN,
    '.github/workflows/test.yml': TEST_YML.replace(
      '  rust:\n    runs-on: ubuntu-24.04\n',
      '  plan:\n    runs-on: ubuntu-24.04\n    outputs:\n      rust: ${{ steps.p.outputs.rust }}\n    steps:\n      - id: p\n        run: echo rust=true >> "$GITHUB_OUTPUT"\n  rust:\n    needs: plan\n    if: needs.plan.outputs.rust == \'true\'\n    runs-on: ubuntu-24.04\n'
    )
      .replace('needs: [jest, rust, rust-advisories]', 'needs: [plan, jest, rust, rust-advisories]')
      .replace(
        '          JEST: ${{ needs.jest.result }}\n',
        '          PLAN: ${{ needs.plan.result }}\n          JEST: ${{ needs.jest.result }}\n'
      ),
  };

  it('refuses a job gated on a plan the aggregator never reads', () => {
    const output = refused(PLANNED);
    expect(output).toContain(
      '(job ci-required): rust runs only on needs.plan.outputs and the aggregator never reads them'
    );
  });

  it('accepts a gated job when the aggregator reads the plan it was gated on', () => {
    const tree = {
      ...PLANNED,
      '.github/workflows/test.yml': PLANNED['.github/workflows/test.yml'].replace(
        '          PLAN: ${{ needs.plan.result }}\n',
        '          PLAN: ${{ needs.plan.result }}\n          RUST_PLANNED: ${{ needs.plan.outputs.rust }}\n'
      ),
    };
    const { status, output } = runGuard(fixture(tree));
    expect(output).toContain('Workflow guard: caches write from main only');
    expect(status).toBe(0);
  });

  it('refuses a Build aggregator that never reads whether the change was native', () => {
    const output = refused(
      withEdit(
        '.github/workflows/build.yml',
        '          NATIVE: ${{ needs.changes.outputs.native }}\n',
        ''
      )
    );
    expect(output).toContain(
      '(job build-required): build-android runs only on needs.changes.outputs and the aggregator never reads them'
    );
    expect(output).toContain(
      '(job build-required): bundle-check runs only on needs.changes.outputs'
    );
  });

  it('refuses an aggregator that is skipped when a job fails', () => {
    const output = refused(withEdit('.github/workflows/build.yml', '    if: always()\n', ''));
    expect(output).toContain('(job build-required): an aggregator without if: always()');
  });

  it('refuses test.yml losing its aggregator', () => {
    const output = refused(
      withEdit(
        '.github/workflows/test.yml',
        '  ci-required:\n    needs: [jest, rust, rust-advisories]',
        '  report:\n    needs: [jest, rust, rust-advisories]'
      )
    );
    expect(output).toContain('.github/workflows/test.yml (jobs): has no *-required aggregator');
  });
});

it('refuses cargo bench outside a bench workflow', () => {
  const output = refused(
    withEdit(
      '.github/workflows/test.yml',
      'cargo check -p veloqrs --benches',
      'cargo bench -p veloqrs --no-run'
    )
  );
  expect(output).toContain('(job rust step Check Rust benches)');
  expect(output).toContain('cargo bench links every bench');
});

it('refuses test.yml losing its bench type-check', () => {
  const output = refused(
    withEdit(
      '.github/workflows/test.yml',
      '      - name: Check Rust benches\n        run: cargo check -p veloqrs --benches\n',
      ''
    )
  );
  expect(output).toContain('.github/workflows/test.yml (jobs)');
  expect(output).toContain('cargo check --benches');
});

describe('Rust advisory scan', () => {
  it('refuses test.yml with no job reaching cargo audit', () => {
    const files = withEdit(
      '.github/workflows/test.yml',
      '  rust-advisories:\n    uses: ./.github/workflows/rust-advisories.yml\n',
      ''
    );
    files['.github/workflows/test.yml'] = files['.github/workflows/test.yml']
      .replace('needs: [jest, rust, rust-advisories]', 'needs: [jest, rust]')
      .replace('          ADVISORIES: ${{ needs.rust-advisories.result }}\n', '');
    const output = refused(files);
    expect(output).toContain('.github/workflows/test.yml (jobs)');
    expect(output).toContain('cargo audit --deny warnings');
  });

  it('refuses a scan that lets warnings through', () => {
    const output = refused(
      withEdit(
        '.github/workflows/rust-advisories.yml',
        'cargo audit --deny warnings',
        'cargo audit'
      )
    );
    expect(output).toContain('.github/workflows/test.yml (jobs)');
    expect(output).toContain('cargo audit --deny warnings');
  });

  it('refuses a scan that no schedule runs', () => {
    const output = refused(
      withEdit(
        '.github/workflows/rust-advisories.yml',
        '  schedule:\n    - cron: "0 5 * * 1"\n',
        ''
      )
    );
    expect(output).toContain('.github/workflows/test.yml (jobs)');
    expect(output).toContain('no scheduled workflow');
  });

  it('accepts the scan as a step of test.yml itself beside a scheduled copy', () => {
    const files = withEdit(
      '.github/workflows/test.yml',
      '        run: cargo check -p veloqrs --benches\n',
      '        run: cargo check -p veloqrs --benches\n      - run: cargo audit -D warnings\n'
    );
    const { status, output } = runGuard(fixture(files));
    expect(output).toContain('Workflow guard: caches write from main only');
    expect(status).toBe(0);
  });
});

it('refuses benches built by cargo test', () => {
  const output = refused(
    withEdit(
      '.github/workflows/test.yml',
      'cargo check -p veloqrs --benches',
      'cargo test -p veloqrs --benches --release'
    )
  );
  expect(output).toContain('(job rust step Check Rust benches)');
  expect(output).toContain('with --benches links every bench');
});

describe('benches linked through another route', () => {
  const benchStep = (run: string) =>
    withEdit('.github/workflows/test.yml', 'cargo check -p veloqrs --benches', run);

  it('refuses cargo test --all-targets', () => {
    const output = refused(benchStep('cargo test -p veloqrs --all-targets --release --no-run'));
    expect(output).toContain('(job rust step Check Rust benches)');
    expect(output).toContain('--all-targets');
  });

  it('refuses cargo build --all-targets', () => {
    const output = refused(benchStep('cargo build -p veloqrs --all-targets'));
    expect(output).toContain('--all-targets');
  });

  it('refuses cargo nextest with --benches', () => {
    const output = refused(
      benchStep('cargo nextest run -p veloqrs --benches --cargo-profile release')
    );
    expect(output).toContain('(job rust step Check Rust benches)');
    expect(output).toContain('--benches');
  });

  it('refuses a backslash-continued cargo test whose flag is on the next line', () => {
    const output = refused(
      withEdit(
        '.github/workflows/test.yml',
        '        run: cargo check -p veloqrs --benches',
        '        run: |\n          cargo test -p veloqrs \\\n            --benches --release'
      )
    );
    expect(output).toContain('(job rust step Check Rust benches)');
    expect(output).toContain('with --benches links every bench');
  });
});

describe('a gate made non-fatal', () => {
  it('refuses continue-on-error on the bench check', () => {
    const output = refused(
      withEdit(
        '.github/workflows/test.yml',
        '        run: cargo check -p veloqrs --benches',
        '        continue-on-error: true\n        run: cargo check -p veloqrs --benches'
      )
    );
    expect(output).toContain('(job rust step Check Rust benches)');
    expect(output).toContain('continue-on-error');
  });

  it('refuses continue-on-error on the step that reports an earlier result', () => {
    const output = refused(
      withEdit(
        '.github/workflows/coverage.yml',
        "        if: steps.measured.outputs.cache-matched-key != ''\n",
        "        if: steps.measured.outputs.cache-matched-key != ''\n        continue-on-error: true\n"
      )
    );
    expect(output).toContain('(job coverage step Report the earlier result)');
    expect(output).toContain('continue-on-error');
  });

  it('refuses continue-on-error on the step that reports a result read from the run history', () => {
    const output = refused({
      ...CLEAN,
      '.github/workflows/coverage.yml': HISTORY_COVERAGE_YML.replace(
        "        if: steps.earlier.outputs.outcome != ''\n",
        "        if: steps.earlier.outputs.outcome != ''\n        continue-on-error: true\n"
      ),
    });
    expect(output).toContain('(job coverage step Report the earlier result)');
    expect(output).toContain('continue-on-error');
  });

  it('refuses an exit made harmless by || true', () => {
    const output = refused(
      withEdit('.github/workflows/test.yml', 'run: npm test', 'run: npm test || exit 1 || true')
    );
    expect(output).toContain('(job jest');
    expect(output).toContain('|| true');
  });

  it('allows || true on a command that is not an exit', () => {
    const { status } = runGuard(
      fixture(withEdit('.github/workflows/test.yml', 'run: npm test', 'run: ls missing || true'))
    );
    expect(status).toBe(0);
  });
});

it('refuses an empty listing rather than passing it', () => {
  const { status, output } = runGuard(fixture({ 'README.txt': 'no workflows\n' }));
  expect(status).toBe(1);
  expect(output).toContain('read nothing');
});

describe('release APK architectures', () => {
  const RELEASE_APK = `    steps:
    - name: Build Android APK
      if: env.RELEASE_BUILD == 'true'
      run: cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a,arm64-v8a --build-cache --no-daemon
    - name: Build Android bundle
      if: env.RELEASE_BUILD == 'true'
      run: cd android && ./gradlew bundleRelease --build-cache --no-daemon
`;
  const withSteps = (steps: string) => ({
    ...CLEAN,
    '.github/workflows/build-android.yml': `name: Build Android
on:
  workflow_call:
jobs:
  apk:
    runs-on: ubuntu-24.04
    env:
      APP_VARIANT: \${{ inputs.variant }}
${steps}`,
  });

  it('passes an APK built for the phone architectures with the bundle on its own', () => {
    const { status } = runGuard(fixture(withSteps(RELEASE_APK)));
    expect(status).toBe(0);
  });

  it('refuses a release APK that carries an emulator architecture', () => {
    const output = refused(
      withSteps(RELEASE_APK.replace('armeabi-v7a,arm64-v8a', 'arm64-v8a,x86_64'))
    );
    expect(output).toContain(
      '.github/workflows/build-android.yml (job apk step Build Android APK)'
    );
    expect(output).toContain('emulator architecture');
  });

  it('refuses a release APK built with the default architecture list', () => {
    const output = refused(
      withSteps(RELEASE_APK.replace(' -PreactNativeArchitectures=armeabi-v7a,arm64-v8a', ''))
    );
    expect(output).toContain('emulator architecture');
  });

  it('refuses a release APK built in one invocation with the bundle', () => {
    const output = refused(
      withSteps(RELEASE_APK.replace('assembleRelease -P', 'assembleRelease bundleRelease -P'))
    );
    expect(output).toContain('bundleRelease');
  });
});

describe('Gradle build cache', () => {
  const STEPS = `    steps:
    - name: Run JVM unit tests
      run: |
        cd android
        ./gradlew :engine:testDebugUnitTest \\
          -PreactNativeArchitectures=arm64-v8a --build-cache --no-daemon
    - name: Build Android APK
      run: cd android && ./gradlew assembleRelease --build-cache --no-daemon
`;
  const withSteps = (steps: string) => ({
    ...CLEAN,
    '.github/workflows/build-android.yml': `name: Build Android
on:
  workflow_call:
jobs:
  apk:
    runs-on: ubuntu-24.04
    env:
      APP_VARIANT: \${{ inputs.variant }}
${steps}`,
  });

  it('passes every Gradle call that turns the build cache on', () => {
    const { status } = runGuard(fixture(withSteps(STEPS)));
    expect(status).toBe(0);
  });

  it('refuses a Gradle call that leaves the build cache off', () => {
    const output = refused(
      withSteps(STEPS.replace('assembleRelease --build-cache', 'assembleRelease'))
    );
    expect(output).toContain(
      '.github/workflows/build-android.yml (job apk step Build Android APK)'
    );
    expect(output).toContain('--build-cache');
  });

  it('reads the flag on a continuation line as part of its call', () => {
    const output = refused(withSteps(STEPS.replace('arm64-v8a --build-cache', 'arm64-v8a')));
    expect(output).toContain('(job apk step Run JVM unit tests)');
  });

  it('refuses each uncached call in a step that carries the flag on another', () => {
    const output = refused(
      withSteps(
        STEPS.replace(
          'assembleRelease --build-cache --no-daemon',
          'assembleRelease --build-cache --no-daemon && ./gradlew bundleRelease --no-daemon'
        )
      )
    );
    expect(output).toContain('(job apk step Build Android APK)');
  });

  it('does not read --no-build-cache as the flag', () => {
    const output = refused(
      withSteps(STEPS.replace('assembleRelease --build-cache', 'assembleRelease --no-build-cache'))
    );
    expect(output).toContain('(job apk step Build Android APK)');
  });
});

describe('iOS simulator app entitlements', () => {
  const SIMULATOR_STEPS = `    steps:
    - name: Build simulator app
      run: |
        xcodebuild -workspace ios/Veloq.xcworkspace -scheme Veloq -sdk iphonesimulator \\
          ARCHS=arm64 CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES DEVELOPMENT_TEAM=
    - name: Verify and package simulator app
      run: |
        APP_PATH="ios/build/Build/Products/Release-iphonesimulator/Veloq.app"
        for bin in "$APP_PATH/Veloq" "$APP_PATH"/PlugIns/*.appex/*; do
          otool -l "$bin" | grep -q 'sectname __entitlements' || exit 1
        done
        strings -a "$APP_PATH/Veloq" | grep -q 'group.example.app' || exit 1
        zip -yr artifacts/app.zip Veloq.app
`;
  const withSteps = (steps: string) => ({
    ...CLEAN,
    '.github/workflows/build-ios.yml': `name: Build iOS
on:
  workflow_call:
jobs:
  sim:
    runs-on: macos-26
    env:
      APP_VARIANT: \${{ inputs.variant }}
${steps}`,
  });

  it('passes a simulator build that signs ad hoc and verifies the entitlements', () => {
    const { status } = runGuard(fixture(withSteps(SIMULATOR_STEPS)));
    expect(status).toBe(0);
  });

  it('refuses a simulator build with code signing switched off', () => {
    const output = refused(
      withSteps(SIMULATOR_STEPS.replace('CODE_SIGNING_ALLOWED=YES', 'CODE_SIGNING_ALLOWED=NO'))
    );
    expect(output).toContain('.github/workflows/build-ios.yml (job sim step Build simulator app)');
    expect(output).toContain('entitlements');
  });

  it('refuses a simulator build that leaves code signing unset', () => {
    const output = refused(withSteps(SIMULATOR_STEPS.replace(' CODE_SIGNING_ALLOWED=YES', '')));
    expect(output).toContain('entitlements');
  });

  it('refuses a packaged simulator app that is never checked for entitlements', () => {
    const output = refused(withSteps(SIMULATOR_STEPS.replace(/        for bin[\s\S]*?done\n/, '')));
    expect(output).toContain('step Verify and package simulator app');
    expect(output).toContain('__entitlements');
  });
});

/**
 * Scenario: the pull request, main, tag and E2E workflows each carried their
 * own copy of the Android and iOS builds, and a fix to one copy left the
 * others building the old way. A ccache key hashed `modules/**` after the Rust
 * libraries were restored into it, so a compiled binary keyed the cache.
 *
 * Expected behaviour: a native build runs only inside the platform's reusable
 * definition, a call into it passes what it declares, and every hashFiles() in
 * a building job is taken before the job writes into the checkout.
 */
describe('one build definition per platform', () => {
  const DEFINITION = `name: Build Android
on:
  workflow_call:
    inputs:
      variant:
        required: true
        type: string
      abis:
        required: false
        type: string
        default: arm64-v8a
jobs:
  build:
    runs-on: ubuntu-24.04
    env:
      APP_VARIANT: \${{ inputs.variant }}
    steps:
      - uses: actions/checkout@v7
      - name: Hash native inputs
        id: native
        run: echo "hash=\${{ hashFiles('modules/**/android/**') }}" >> "$GITHUB_OUTPUT"
      - name: Restore Rust libraries
        uses: actions/cache/restore@v6
        with:
          path: modules/engine/build
          key: rust-\${{ steps.native.outputs.hash }}
      - name: Build APK
        run: cd android && ./gradlew assembleRelease --build-cache --no-daemon
`;
  const CALLER = `name: E2E
on:
  workflow_dispatch:
jobs:
  build:
    uses: ./.github/workflows/build-android.yml
    with:
      variant: dev
`;
  const files = (definition = DEFINITION, caller = CALLER) => ({
    ...CLEAN,
    '.github/workflows/build-android.yml': definition,
    '.github/workflows/e2e.yml': caller,
  });

  it('passes a build reached through the shared definition', () => {
    const { status, output } = runGuard(fixture(files()));
    expect(output).toContain('each platform builds in one place');
    expect(status).toBe(0);
  });

  it.each([
    ['expo prebuild', 'npx expo prebuild --platform android'],
    ['a Gradle assemble or bundle', 'cd android && ./gradlew \\\n  bundleRelease --no-daemon'],
    [
      'xcodebuild',
      'xcodebuild -workspace ios/App.xcworkspace -scheme App -sdk iphonesimulator CODE_SIGNING_ALLOWED=YES',
    ],
    [
      'the Rust builder',
      'node modules/engine/scripts/build-rust.js ios --slice iphonesimulator:arm64',
    ],
    ['pod install', 'cd ios && pod install'],
    ['a fastlane build lane', 'bundle exec fastlane ios build_release'],
  ])('refuses %s outside the definitions', (name, run) => {
    const output = refused(
      files(
        DEFINITION,
        `${CALLER}  inline:
    runs-on: ubuntu-24.04
    steps:
      - name: Inline build
        run: ${JSON.stringify(run)}
`
      )
    );
    expect(output).toContain('.github/workflows/e2e.yml (job inline step Inline build)');
    expect(output).toContain(`${name} runs outside the shared build definitions`);
  });

  /**
   * Scenario: the code scan generates the Android project to compile our
   * Kotlin under the tracer, and packages nothing.
   *
   * Expected behaviour: the prebuild passes there and nowhere else, and an
   * assemble, a bundle or the Rust builder in the scan is still refused, even
   * in the step that runs the prebuild.
   */
  const SCAN = (run: string) => `name: CodeQL
on:
  pull_request:
jobs:
  scan:
    runs-on: ubuntu-24.04
    steps:
      - name: Generate Android native project
        run: ${JSON.stringify(run)}
`;

  it('passes the prebuild in the code scan', () => {
    const { status, output } = runGuard(
      fixture({
        ...files(),
        '.github/workflows/codeql.yml': SCAN(
          'CI=1 npx expo prebuild --platform android --no-install'
        ),
      })
    );
    expect(output).toContain('each platform builds in one place');
    expect(status).toBe(0);
  });

  it.each([
    ['a Gradle assemble or bundle', 'cd android && ./gradlew assembleRelease --build-cache'],
    [
      'a Gradle assemble or bundle',
      'npx expo prebuild --platform android\ncd android && ./gradlew bundleRelease --build-cache',
    ],
    ['the Rust builder', 'node modules/engine/scripts/build-rust.js android --abi arm64-v8a'],
    ['pod install', 'npx expo prebuild --platform ios && cd ios && pod install'],
  ])('refuses %s in the code scan', (name, run) => {
    const output = refused({
      ...files(),
      '.github/workflows/codeql.yml': SCAN(run),
    });
    expect(output).toContain(
      '.github/workflows/codeql.yml (job scan step Generate Android native project)'
    );
    expect(output).toContain(`${name} runs outside the shared build definitions`);
  });

  it('refuses the prebuild in any other workflow', () => {
    const output = refused({
      ...files(),
      '.github/workflows/lint.yml': SCAN('CI=1 npx expo prebuild --platform android --no-install'),
    });
    expect(output).toContain(
      '.github/workflows/lint.yml (job scan step Generate Android native project)'
    );
    expect(output).toContain('expo prebuild runs outside the shared build definitions');
  });

  it('refuses a definition that a push starts as well', () => {
    const output = refused(
      files(DEFINITION.replace('on:\n  workflow_call:', 'on:\n  push:\n  workflow_call:'))
    );
    expect(output).toContain('.github/workflows/build-android.yml (on)');
    expect(output).toContain('starts only from workflow_call');
  });

  it('refuses a call passing an input the definition does not declare', () => {
    const output = refused(
      files(DEFINITION, CALLER.replace('variant: dev', 'variant: dev\n      flavour: dev'))
    );
    expect(output).toContain('.github/workflows/e2e.yml (job build)');
    expect(output).toContain('passes flavour');
  });

  it('refuses a call leaving out a required input', () => {
    const output = refused(
      files(DEFINITION, CALLER.replace('    with:\n      variant: dev\n', ''))
    );
    expect(output).toContain('leaves out variant');
  });

  it('refuses a call to a workflow that is not reusable', () => {
    const output = refused(
      files(DEFINITION, CALLER.replace('build-android.yml', 'build-androd.yml'))
    );
    expect(output).toContain('calls .github/workflows/build-androd.yml');
  });

  it('refuses a key hashed after the build restored compiled libraries into the tree', () => {
    const output = refused(
      files(
        DEFINITION.replace(
          'key: rust-${{ steps.native.outputs.hash }}',
          'key: rust-${{ steps.native.outputs.hash }}\n      - name: Setup ccache\n        uses: hendrikmuhs/ccache-action@' +
            PIN +
            "\n        with:\n          key: ndk-${{ hashFiles('modules/**/android/**') }}\n          save: ${{ github.ref == 'refs/heads/main' }}"
        )
      )
    );
    expect(output).toContain('(job build step Setup ccache)');
    expect(output).toContain(
      'hashFiles() runs after Restore Rust libraries wrote into the checkout'
    );
  });

  it('refuses a key hashed after npm wrote node_modules', () => {
    const output = refused(
      files(
        DEFINITION.replace(
          '      - name: Build APK',
          "      - uses: ./.github/actions/npm-ci\n      - name: Restore Metro\n        uses: actions/cache/restore@v6\n        with:\n          path: /tmp/metro\n          key: metro-${{ hashFiles('**/package-lock.json') }}\n      - name: Build APK"
        )
      )
    );
    expect(output).toContain('(job build step Restore Metro)');
  });
});

describe('compiled Rust libraries are saved when they exist', () => {
  const DEFINITION = `name: Build Android
on:
  workflow_call:
    inputs:
      variant:
        required: true
        type: string
jobs:
  build:
    runs-on: ubuntu-24.04
    env:
      APP_VARIANT: \${{ inputs.variant }}
    steps:
      - uses: actions/checkout@v7
      - name: Restore Rust libraries
        id: rust-cache
        uses: actions/cache/restore@v6
        with:
          path: modules/engine/build/rust/android
          key: rust-android-v1
      - name: Build Rust libraries
        id: build-rust
        run: cd android && ./gradlew :engine:buildRustLibrary --build-cache --no-daemon
      - name: Save Rust libraries
        if: github.ref == 'refs/heads/main' && steps.rust-cache.outputs.cache-hit != 'true' && steps.build-rust.outcome == 'success'
        uses: actions/cache/save@v6
        with:
          path: modules/engine/build/rust/android
          key: \${{ steps.rust-cache.outputs.cache-primary-key }}
      - name: Build APK
        run: cd android && ./gradlew assembleRelease --build-cache --no-daemon
`;
  const CALLER = `name: E2E
on:
  workflow_dispatch:
jobs:
  build:
    uses: ./.github/workflows/build-android.yml
    with:
      variant: dev
`;
  const files = (definition = DEFINITION) => ({
    ...CLEAN,
    '.github/workflows/build-android.yml': definition,
    '.github/workflows/e2e.yml': CALLER,
  });
  const SAVE = DEFINITION.slice(
    DEFINITION.indexOf('      - name: Save Rust libraries'),
    DEFINITION.indexOf('      - name: Build APK')
  );

  it('passes a save that follows the step that built the libraries', () => {
    const { status } = runGuard(fixture(files()));
    expect(status).toBe(0);
  });

  it('refuses a save that waits for the whole job to succeed', () => {
    const output = refused(
      files(DEFINITION.replace(" && steps.build-rust.outcome == 'success'", ' && success()'))
    );
    expect(output).toContain('(job build step Save Rust libraries)');
    expect(output).toContain('only when the step that built them succeeded');
  });

  it('refuses a save gated on a step that does not build the libraries', () => {
    const output = refused(
      files(
        DEFINITION.replace(
          "steps.build-rust.outcome == 'success'",
          "steps.rust-cache.outcome == 'success'"
        )
      )
    );
    expect(output).toContain('(job build step Save Rust libraries)');
  });

  it('refuses a save placed after later packaging steps', () => {
    const output = refused(files(DEFINITION.replace(SAVE, '') + SAVE));
    expect(output).toContain('(job build step Save Rust libraries)');
    expect(output).toContain('Place it directly after');
  });

  it('refuses a Rust library build with no save of its own', () => {
    const output = refused(files(DEFINITION.replace(SAVE, '')));
    expect(output).toContain('(job build step Build Rust libraries)');
    expect(output).toContain('is never saved');
  });
});

/**
 * Scenario: a tag release uploads to the stores in deploy jobs. A job that
 * skips itself for a missing credential, or is never started because the
 * artefact was not found, ends green with nothing uploaded.
 *
 * Expected behaviour: the guard refuses both shapes in a workflow a tag
 * starts, and passes a deploy that fails when its credential or artefact is
 * missing.
 */
describe('a tag release fails when a store deploy is skipped', () => {
  const RELEASE = `name: Release
on:
  push:
    tags:
      - "[0-9]+.[0-9]+.[0-9]+"
jobs:
  release:
    runs-on: ubuntu-24.04
    outputs:
      aab_path: \${{ steps.prepare.outputs.aab_path }}
    steps:
      - id: prepare
        name: Prepare release artifacts
        run: |
          AAB=$(find artifacts -name "*.aab" | head -1)
          if [ -z "$AAB" ]; then
            echo "::error::No AAB found" >&2
            exit 1
          fi
          echo "aab_path=$AAB" >> $GITHUB_OUTPUT
  deploy-play-store:
    needs: release
    runs-on: ubuntu-24.04
    steps:
      - name: Check for Play Store credentials
        id: check_creds
        env:
          PLAY_JSON: \${{ secrets.PLAY_JSON }}
        run: |
          if [ -z "$PLAY_JSON" ]; then
            echo "::error::PLAY_JSON is not configured" >&2
            exit 1
          fi
      - run: echo upload
`;
  const withRelease = (release: string) => ({
    ...CLEAN,
    '.github/workflows/release.yml': release,
  });

  it('passes a deploy that fails when its credential is missing', () => {
    const { status } = runGuard(fixture(withRelease(RELEASE)));
    expect(status).toBe(0);
  });

  it('refuses a deploy step that skips itself for a missing credential', () => {
    const output = refused(
      withRelease(
        RELEASE.replace(
          /echo "::error::PLAY_JSON is not configured" >&2\n\s+exit 1/,
          'echo "skip=true" >> $GITHUB_OUTPUT'
        )
      )
    );
    expect(output).toContain('.github/workflows/release.yml (job deploy-play-store step');
    expect(output).toContain('skips');
  });

  it('refuses a deploy job that runs only when the artefact was found', () => {
    const output = refused(
      withRelease(
        RELEASE.replace(
          '  deploy-play-store:\n    needs: release\n',
          "  deploy-play-store:\n    needs: release\n    if: needs.release.outputs.aab_path != ''\n"
        )
      )
    );
    expect(output).toContain('.github/workflows/release.yml (job deploy-play-store)');
    expect(output).toContain('artefact');
  });

  it('leaves a workflow no tag starts free to skip a deploy', () => {
    const files = withRelease(
      RELEASE.replace(
        /on:\n  push:\n    tags:\n      - "\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+"/,
        'on:\n  workflow_dispatch:'
      ).replace(
        /echo "::error::PLAY_JSON is not configured" >&2\n\s+exit 1/,
        'echo "skip=true" >> $GITHUB_OUTPUT'
      )
    );
    const { status } = runGuard(fixture(files));
    expect(status).toBe(0);
  });
});

/**
 * Scenario: a build definition uploads an artifact restored from the cache, or
 * built by a step that read the Expo configuration without the variant, and
 * nothing reads the identity the file carries.
 *
 * Expected behaviour: every artifact a build definition uploads is preceded by
 * the identity check against the selected variant, and one such check runs on
 * a cache hit too.
 */
describe('artifact identity', () => {
  const DEFINITION = `name: Build Android
on:
  workflow_call:
    inputs:
      variant:
        required: true
        type: string
jobs:
  build:
    runs-on: ubuntu-24.04
    env:
      APP_VARIANT: \${{ inputs.variant }}
    steps:
      - uses: actions/checkout@v7
      - name: Restore built APK
        id: apk-cache
        uses: actions/cache/restore@v6
        with:
          path: android/app/build/outputs/apk/release/app-release.apk
          key: android-app-\${{ inputs.variant }}
      - name: Build APK
        if: steps.apk-cache.outputs.cache-hit != 'true'
        run: cd android && ./gradlew assembleRelease --build-cache --no-daemon
      - name: Check artifact identity
        run: node scripts/build-record.js identity android/app/build/outputs/apk/release/app-release.apk --variant "$APP_VARIANT"
      - name: Upload APK artifact
        uses: actions/upload-artifact@v6
        with:
          name: apk
          path: android/app/build/outputs/apk/release/app-release.apk
      - name: Upload build log on failure
        if: failure()
        uses: actions/upload-artifact@v6
        with:
          name: log
          path: build.log
`;
  const CHECK =
    '      - name: Check artifact identity\n        run: node scripts/build-record.js identity android/app/build/outputs/apk/release/app-release.apk --variant "$APP_VARIANT"\n';
  const files = (definition = DEFINITION) => ({
    ...CLEAN,
    '.github/workflows/build-android.yml': definition,
  });

  it('passes an upload preceded by the identity check', () => {
    const { status, output } = runGuard(fixture(files()));
    expect(output).toContain('each platform builds in one place');
    expect(status).toBe(0);
  });

  it('refuses a definition with the identity step removed', () => {
    const output = refused(files(DEFINITION.replace(CHECK, '')));
    expect(output).toContain(
      '.github/workflows/build-android.yml (job build step Upload APK artifact)'
    );
    expect(output).toContain('build-record.js identity');
  });

  it('refuses an identity check placed after the upload', () => {
    const output = refused(
      files(
        DEFINITION.replace(CHECK, '').replace(
          '      - name: Upload build log',
          `${CHECK}      - name: Upload build log`
        )
      )
    );
    expect(output).toContain('(job build step Upload APK artifact)');
  });

  it('refuses an identity check that a cache hit skips', () => {
    const output = refused(
      files(
        DEFINITION.replace(
          '      - name: Check artifact identity\n',
          "      - name: Check artifact identity\n        if: steps.apk-cache.outputs.cache-hit != 'true'\n"
        )
      )
    );
    expect(output).toContain('(job build)');
    expect(output).toContain('cache hit');
  });

  it('refuses an identity check that names no variant', () => {
    const output = refused(files(DEFINITION.replace(' --variant "$APP_VARIANT"', '')));
    expect(output).toContain('(job build step Upload APK artifact)');
  });
});

/**
 * Scenario: a build definition sets the variant on the prebuild command alone,
 * so Gradle, the bundler and fastlane read the Expo configuration again
 * without it and embed the Dev identity in a production build.
 *
 * Expected behaviour: a job that builds natively in a definition carries
 * `APP_VARIANT: ${{ inputs.variant }}` in its own or the workflow's env, and no
 * step sets the variant for itself.
 */
describe('the variant holds for the whole job', () => {
  const JOB_ENV = '    env:\n      APP_VARIANT: ${{ inputs.variant }}\n';
  const DEFINITION = `name: Build Android
on:
  workflow_call:
    inputs:
      variant:
        required: true
        type: string
jobs:
  build:
    runs-on: ubuntu-24.04
${JOB_ENV}    steps:
      - uses: actions/checkout@v7
      - name: Prebuild
        run: npx expo prebuild --platform android
      - name: Build APK
        run: cd android && ./gradlew assembleRelease --build-cache --no-daemon
`;
  const files = (definition = DEFINITION) => ({
    ...CLEAN,
    '.github/workflows/build-android.yml': definition,
  });

  it('passes a variant set on the job', () => {
    const { status, output } = runGuard(fixture(files()));
    expect(output).toContain('each platform builds in one place');
    expect(status).toBe(0);
  });

  it('passes a variant set on the workflow', () => {
    const definition = DEFINITION.replace(JOB_ENV, '').replace(
      'jobs:\n',
      'env:\n  APP_VARIANT: ${{ inputs.variant }}\njobs:\n'
    );
    const { status } = runGuard(fixture(files(definition)));
    expect(status).toBe(0);
  });

  it('refuses a native build with no variant in its environment', () => {
    const output = refused(files(DEFINITION.replace(JOB_ENV, '')));
    expect(output).toContain('.github/workflows/build-android.yml (job build)');
    expect(output).toContain('APP_VARIANT');
  });

  it('refuses a variant the job fixes instead of taking from the caller', () => {
    const output = refused(files(DEFINITION.replace('${{ inputs.variant }}', 'production')));
    expect(output).toContain('(job build)');
    expect(output).toContain('inputs.variant');
  });

  it('refuses the variant set on the prebuild command alone', () => {
    const output = refused(
      files(
        DEFINITION.replace(JOB_ENV, '').replace(
          'run: npx expo prebuild',
          'run: APP_VARIANT=production npx expo prebuild'
        )
      )
    );
    expect(output).toContain('(job build step Prebuild)');
    expect(output).toContain('holds for this step alone');
  });

  it('refuses the variant exported inside one step', () => {
    const output = refused(
      files(
        DEFINITION.replace(
          'run: npx expo prebuild --platform android',
          'run: |\n          export APP_VARIANT=dev\n          npx expo prebuild --platform android'
        )
      )
    );
    expect(output).toContain('(job build step Prebuild)');
  });

  it('refuses a step env that overrides the job variant', () => {
    const output = refused(
      files(
        DEFINITION.replace(
          '      - name: Build APK\n',
          '      - name: Build APK\n        env:\n          APP_VARIANT: dev\n'
        )
      )
    );
    expect(output).toContain('(job build step Build APK)');
    expect(output).toContain('holds for this step alone');
  });
});

describe('third-party actions are pinned to a commit', () => {
  const pinned = (uses: string) => ({
    ...CLEAN,
    '.github/workflows/deploy.yml': `name: Deploy
on:
  workflow_dispatch:
jobs:
  sign:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/npm-ci
      - name: Load signing key
        uses: ${uses}
`,
  });

  it('refuses a third-party action pinned to a tag', () => {
    const output = refused(pinned('webfactory/ssh-agent@v0.10.0'));
    expect(output).toContain('.github/workflows/deploy.yml (job sign step Load signing key)');
    expect(output).toContain('webfactory/ssh-agent@v0.10.0 is not pinned to a commit');
  });

  it('refuses a branch name and a short sha', () => {
    expect(refused(pinned('taiki-e/install-action@nextest'))).toContain(
      'taiki-e/install-action@nextest is not pinned to a commit'
    );
    expect(refused(pinned('webfactory/ssh-agent@0123456'))).toContain('is not pinned to a commit');
  });

  it('refuses a sub-path action and an action with no ref', () => {
    expect(refused(pinned('gradle/actions/setup-gradle@v6'))).toContain(
      'gradle/actions/setup-gradle@v6 is not pinned to a commit'
    );
    expect(refused(pinned('webfactory/ssh-agent'))).toContain(
      'webfactory/ssh-agent is not pinned to a commit'
    );
  });

  it('refuses a tag in a composite action', () => {
    const output = refused({
      ...CLEAN,
      '.github/actions/setup-tool/action.yml': `name: Setup tool
runs:
  using: composite
  steps:
    - name: Setup Ruby
      uses: ruby/setup-ruby@v1
`,
    });
    expect(output).toContain('.github/actions/setup-tool/action.yml (step Setup Ruby)');
  });

  it('refuses a reusable workflow from another repository called at a tag', () => {
    const output = refused({
      ...CLEAN,
      '.github/workflows/deploy.yml': `name: Deploy
on:
  workflow_dispatch:
jobs:
  sign:
    uses: some-org/shared-workflows/.github/workflows/sign.yml@main
`,
    });
    expect(output).toContain('.github/workflows/deploy.yml (job sign)');
    expect(output).toContain('is not pinned to a commit');
  });

  it('passes a full commit sha with the tag in a comment', () => {
    const { status } = runGuard(fixture(pinned(`webfactory/ssh-agent@${PIN} # v0.10.0`)));
    expect(status).toBe(0);
  });

  it('refuses an uppercase sha, which is not how git names a commit', () => {
    expect(refused(pinned(`webfactory/ssh-agent@${PIN.toUpperCase()}`))).toContain(
      'is not pinned to a commit'
    );
  });

  it('leaves actions/* and local actions on their tags', () => {
    const { status } = runGuard(fixture(pinned('actions/upload-artifact@v6')));
    expect(status).toBe(0);
  });
});

describe('pod tool pinned through the bundle', () => {
  const POD_STEPS = `    steps:
      - name: Setup fastlane
        uses: ./.github/actions/setup-fastlane
      - name: Install Pods
        working-directory: ios
        env:
          BUNDLE_GEMFILE: \${{ github.workspace }}/config/fastlane/Gemfile
        run: bundle exec pod install
`;
  const GEMFILE = `source "https://rubygems.org"

gem "fastlane", "~> 2.240"
gem "cocoapods", "1.16.2"
`;
  const LOCKFILE = `GEM
  remote: https://rubygems.org/
  specs:
    cocoapods (1.16.2)
      xcodeproj (>= 1.27.0, < 2.0)
    fastlane (2.240.1)

PLATFORMS
  ruby

DEPENDENCIES
  cocoapods (= 1.16.2)
  fastlane (~> 2.240)
`;
  const files = (
    steps = POD_STEPS,
    gemfile = GEMFILE,
    lockfile = LOCKFILE
  ): Record<string, string> => ({
    ...CLEAN,
    '.github/workflows/build-ios.yml': `name: Build iOS
on:
  workflow_call:
jobs:
  pods:
    runs-on: macos-26
    env:
      APP_VARIANT: \${{ inputs.variant }}
${steps}`,
    'config/fastlane/Gemfile': gemfile,
    'config/fastlane/Gemfile.lock': lockfile,
  });

  it('passes pod install run through the bundle that pins the version', () => {
    const { status, output } = runGuard(fixture(files()));
    expect(output).toContain('Workflow guard:');
    expect(status).toBe(0);
  });

  it('refuses an unpinned gem install with its error swallowed', () => {
    const output = refused(
      files(
        POD_STEPS.replace(
          'run: bundle exec pod install',
          'run: |\n          gem install cocoapods 2>/dev/null || true\n          pod install'
        )
      )
    );
    expect(output).toContain('.github/workflows/build-ios.yml (job pods step Install Pods)');
    expect(output).toContain('gem install cocoapods');
  });

  it('refuses a gem install of cocoapods even with a version', () => {
    const output = refused(
      files(
        POD_STEPS.replace(
          'run: bundle exec pod install',
          'run: |\n          gem install cocoapods -v 1.16.2\n          bundle exec pod install'
        )
      )
    );
    expect(output).toContain('gem install cocoapods');
  });

  it('refuses pod run outside the bundle', () => {
    const output = refused(files(POD_STEPS.replace('bundle exec pod install', 'pod install')));
    expect(output).toContain('(job pods step Install Pods)');
    expect(output).toContain('bundle exec');
  });

  it('refuses a pod failure that is swallowed', () => {
    const output = refused(
      files(POD_STEPS.replace('bundle exec pod install', 'bundle exec pod install || true'))
    );
    expect(output).toContain('(job pods step Install Pods)');
    expect(output).toContain('swallow');
  });

  it('refuses pod run against a bundle other than the fastlane one', () => {
    const output = refused(
      files(
        POD_STEPS.replace(
          '        env:\n          BUNDLE_GEMFILE: ${{ github.workspace }}/config/fastlane/Gemfile\n',
          ''
        )
      )
    );
    expect(output).toContain('(job pods step Install Pods)');
    expect(output).toContain('BUNDLE_GEMFILE');
  });

  it('refuses a Gemfile that leaves cocoapods out or unpinned', () => {
    for (const gemfile of [
      GEMFILE.replace('gem "cocoapods", "1.16.2"\n', ''),
      GEMFILE.replace('"1.16.2"', '"~> 1.16"'),
      GEMFILE.replace(', "1.16.2"', ''),
    ]) {
      const output = refused(files(POD_STEPS, gemfile));
      expect(output).toContain('config/fastlane/Gemfile');
      expect(output).toContain('cocoapods');
    }
  });

  it('accepts the pin written with an equals sign', () => {
    const { status } = runGuard(
      fixture(files(POD_STEPS, GEMFILE.replace('"1.16.2"', '"= 1.16.2"')))
    );
    expect(status).toBe(0);
  });

  it('refuses a lockfile that resolves another cocoapods version', () => {
    const output = refused(
      files(POD_STEPS, GEMFILE, LOCKFILE.replace('cocoapods (1.16.2)', 'cocoapods (1.17.0)'))
    );
    expect(output).toContain('config/fastlane/Gemfile.lock');
    expect(output).toContain('1.17.0');
  });
});
