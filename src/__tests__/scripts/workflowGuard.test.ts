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
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/npm-ci
      - name: Restore Jest cache
        uses: actions/cache/restore@v4
        with:
          path: .jest-cache
          key: jest-\${{ github.sha }}
      - run: npm test
      - name: Save Jest cache
        if: \${{ !cancelled() && github.ref == 'refs/heads/main' }}
        uses: actions/cache/save@v4
        with:
          path: .jest-cache
          key: jest-\${{ github.sha }}
  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Cache Rust
        uses: Swatinem/rust-cache@v2
        with:
          save-if: \${{ github.ref == 'refs/heads/main' }}
      - name: Check Rust benches
        run: cargo check -p veloqrs --benches
  ci-required:
    needs: [jest, rust]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - env:
          JEST: \${{ needs.jest.result }}
          RUST: \${{ needs.rust.result }}
        run: for r in "$JEST" "$RUST"; do [ "$r" = success ] || exit 1; done
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
  build-android:
    runs-on: ubuntu-latest
    steps:
      - name: Setup Gradle
        uses: gradle/actions/setup-gradle@v6
        with:
          cache-read-only: \${{ github.ref != 'refs/heads/main' }}
          cache-cleanup: on-success
      - name: Setup ccache
        uses: hendrikmuhs/ccache-action@v1.2
        with:
          key: ndk
          save: \${{ github.ref == 'refs/heads/main' }}
  e2e-smoke:
    needs: build-android
    runs-on: ubuntu-latest
    steps:
      - run: maestro test smoke.yaml
  build-required:
    needs: [build-android, e2e-smoke]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - env:
          ANDROID: \${{ needs.build-android.result }}
          SMOKE: \${{ needs.e2e-smoke.result }}
        run: '[ "$ANDROID" = success ] && [ "$SMOKE" = success ]'
`;

const COVERAGE_YML = `name: Coverage
on:
  schedule:
    - cron: "0 3 * * *"
  workflow_dispatch:
jobs:
  coverage:
    runs-on: ubuntu-latest
    steps:
      - name: Look for a run on this sha
        id: measured
        if: github.event_name == 'schedule'
        uses: actions/cache/restore@v4
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
        uses: actions/cache/save@v4
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
    runs-on: ubuntu-latest
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
    - uses: actions/setup-node@v6
      with:
        node-version: "22"
        package-manager-cache: false
    - id: npm-cache
      uses: actions/cache/restore@v4
      with:
        path: ~/.npm
        key: npm-\${{ hashFiles('package-lock.json') }}
    - shell: bash
      run: npm ci
    - if: github.ref == 'refs/heads/main' && steps.npm-cache.outputs.cache-hit != 'true'
      uses: actions/cache/save@v4
      with:
        path: ~/.npm
        key: \${{ steps.npm-cache.outputs.cache-primary-key }}
`;

const CLEAN: Record<string, string> = {
  '.github/workflows/test.yml': TEST_YML,
  '.github/workflows/build.yml': BUILD_YML,
  '.github/workflows/coverage.yml': COVERAGE_YML,
  '.github/actions/npm-ci/action.yml': NPM_ACTION,
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
      uses: Swatinem/rust-cache@v2
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
        'uses: actions/cache/restore@v4',
        'uses: actions/cache@v4'
      )
    );
    expect(output).toContain('(job jest step Restore Jest cache)');
    expect(output).toContain('actions/cache saves in a post step from any ref');
  });

  it('refuses setup-node with cache: npm', () => {
    const output = refused(
      withEdit(
        '.github/actions/npm-ci/action.yml',
        'node-version: "22"',
        'node-version: "22"\n        cache: npm'
      )
    );
    expect(output).toContain('.github/actions/npm-ci/action.yml (step actions/setup-node@v6)');
    expect(output).toContain('actions/setup-node with cache:');
  });

  it('refuses setup-node that leaves its package-manager cache on', () => {
    const output = refused(
      withEdit('.github/actions/npm-ci/action.yml', '        package-manager-cache: false\n', '')
    );
    expect(output).toContain('.github/actions/npm-ci/action.yml (step actions/setup-node@v6)');
    expect(output).toContain('package-manager-cache: false');
  });

  const goWorkflow = (withBlock: string) => ({
    ...CLEAN,
    '.github/workflows/go-tool.yml': `name: Go tool
on:
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Setup Go
        uses: actions/setup-go@v5
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
    runs-on: ubuntu-latest
    steps:
      - name: Setup Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: "3.4"
          bundler-cache: true
`,
    });
    expect(output).toContain('.github/workflows/release.yml (job deploy step Setup Ruby)');
    expect(output).toContain('bundler-cache');
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
    runs-on: ubuntu-latest
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
    runs-on: ubuntu-latest
    steps:
      - run: maestro test .maestro
`,
      })
    );
    expect(status).toBe(0);
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
    runs-on: ubuntu-latest
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
      withEdit('.github/workflows/test.yml', 'needs: [jest, rust]', 'needs: [jest]')
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

  it('refuses an aggregator that is skipped when a job fails', () => {
    const output = refused(withEdit('.github/workflows/build.yml', '    if: always()\n', ''));
    expect(output).toContain('(job build-required): an aggregator without if: always()');
  });

  it('refuses test.yml losing its aggregator', () => {
    const output = refused(
      withEdit(
        '.github/workflows/test.yml',
        '  ci-required:\n    needs: [jest, rust]',
        '  report:\n    needs: [jest, rust]'
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
      run: cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a,arm64-v8a --no-daemon
    - name: Build Android bundle
      if: env.RELEASE_BUILD == 'true'
      run: cd android && ./gradlew bundleRelease --no-daemon
`;
  const withSteps = (steps: string) => ({
    ...CLEAN,
    '.github/workflows/build-android.yml': `name: Build Android
on:
  workflow_call:
jobs:
  apk:
    runs-on: ubuntu-latest
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
    runs-on: macos-latest
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
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Hash native inputs
        id: native
        run: echo "hash=\${{ hashFiles('modules/**/android/**') }}" >> "$GITHUB_OUTPUT"
      - name: Restore Rust libraries
        uses: actions/cache/restore@v4
        with:
          path: modules/engine/build
          key: rust-\${{ steps.native.outputs.hash }}
      - name: Build APK
        run: cd android && ./gradlew assembleRelease --no-daemon
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
    runs-on: ubuntu-latest
    steps:
      - name: Inline build
        run: ${JSON.stringify(run)}
`
      )
    );
    expect(output).toContain('.github/workflows/e2e.yml (job inline step Inline build)');
    expect(output).toContain(`${name} runs outside the shared build definitions`);
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
          "key: rust-${{ steps.native.outputs.hash }}\n      - name: Setup ccache\n        uses: hendrikmuhs/ccache-action@v1.2\n        with:\n          key: ndk-${{ hashFiles('modules/**/android/**') }}\n          save: ${{ github.ref == 'refs/heads/main' }}"
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
          "      - uses: ./.github/actions/npm-ci\n      - name: Restore Metro\n        uses: actions/cache/restore@v4\n        with:\n          path: /tmp/metro\n          key: metro-${{ hashFiles('**/package-lock.json') }}\n      - name: Build APK"
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
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Restore Rust libraries
        id: rust-cache
        uses: actions/cache/restore@v4
        with:
          path: modules/engine/build/rust/android
          key: rust-android-v1
      - name: Build Rust libraries
        id: build-rust
        run: cd android && ./gradlew :engine:buildRustLibrary --no-daemon
      - name: Save Rust libraries
        if: github.ref == 'refs/heads/main' && steps.rust-cache.outputs.cache-hit != 'true' && steps.build-rust.outcome == 'success'
        uses: actions/cache/save@v4
        with:
          path: modules/engine/build/rust/android
          key: \${{ steps.rust-cache.outputs.cache-primary-key }}
      - name: Build APK
        run: cd android && ./gradlew assembleRelease --no-daemon
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
