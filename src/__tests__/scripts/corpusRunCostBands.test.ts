/**
 * Scenario: the warm-add budget, the attach band and the lifecycle band are
 * wall-clock gates that only mean something on the corpus machine, so the
 * corpus run is the one lane that runs them. A run that leaves one out lets a
 * per-activity slowdown through every landing.
 *
 * Expected behaviour: the corpus run invokes all three in release with the
 * corpus root set, reports each one's verdict, and exits non-zero when any
 * band fails, `--rebase` or not, since a rebase only ever rewrites a digest
 * golden.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../modules/veloqrs/rust/tracematch/scripts/corpus_run.sh');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

// Records every invocation, passes the lab, echoes the golden back as the
// digest gate's record, and fails whichever test target STUB_FAIL names.
const STUB_CARGO = `#!/usr/bin/env bash
echo "$* | TRACEMATCH_CORPUS=\${TRACEMATCH_CORPUS:-}" >> "$STUB_LOG"
[ "$1" = test ] || exit 0
target=""
prev=""
for arg in "$@"; do
  [ "$prev" = --test ] && target="$arg"
  prev="$arg"
done
if [ -n "\${TRACEMATCH_BITWISE_RECORD:-}" ]; then
  cp "$STUB_GOLDEN" "$TRACEMATCH_BITWISE_RECORD"
fi
if [ "$target" = "\${STUB_FAIL:-}" ]; then
  echo "cost regression against the recorded baseline:"
  exit 101
fi
echo "cost baselines within band: perf_stub_ms 1"
exit 0
`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'corpus-run-'));
  roots.push(root);
  const corpus = join(root, 'corpus');
  mkdirSync(join(corpus, 'fullcorpus'), { recursive: true });
  writeFileSync(join(corpus, 'fullcorpus', 'ride.gpx'), '<gpx></gpx>');
  const golden = join(corpus, 'fullcorpus', '_bitwise_golden.txt');
  writeFileSync(golden, 'A stub 0\nperf_stub_ms 1\n');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'cargo'), STUB_CARGO);
  chmodSync(join(bin, 'cargo'), 0o755);
  return { root, corpus, bin, golden, log: join(root, 'cargo.log') };
}

function run(fail = '', extra: string[] = []) {
  const f = fixture();
  const result = spawnSync(
    'bash',
    [SCRIPT, '--corpus', f.corpus, '--out', join(f.root, 'out'), '--no-geolife', ...extra],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${f.bin}:${process.env.PATH}`,
        STUB_LOG: f.log,
        STUB_GOLDEN: f.golden,
        STUB_FAIL: fail,
        TRACEMATCH_CORPUS: '',
      },
    }
  );
  const calls = readFileSync(f.log, 'utf8').trim().split('\n');
  return { ...result, calls, corpus: f.corpus };
}

function callFor(calls: string[], target: string) {
  return calls.find((c) => c.split(' | ')[0].split(' ').includes(target) && / --test /.test(c));
}

it.each([
  ['drip_budget', '-p tracematch', 'real-corpus'],
  ['attach_cost_band', '-p veloqrs', 'real-corpus'],
  ['lifecycle_cost_band', '-p veloqrs', 'synthetic,real-corpus'],
])('runs %s in release on the corpus', (target, pkg, features) => {
  const { status, calls, corpus } = run();
  const call = callFor(calls, target);
  expect(call).toBeDefined();
  expect(call).toContain(pkg);
  expect(call).toContain('--release');
  expect(call).toContain(`--features ${features} `);
  expect(call).toContain(`TRACEMATCH_CORPUS=${corpus}`);
  expect(status).toBe(0);
});

it('reports each band verdict beside the digest gate', () => {
  const { stdout } = run();
  for (const target of ['drip_budget', 'attach_cost_band', 'lifecycle_cost_band']) {
    expect(stdout).toMatch(new RegExp(`=== band: ${target}[\\s\\S]*?band passed`));
  }
});

it.each(['drip_budget', 'attach_cost_band', 'lifecycle_cost_band'])(
  'fails the run when %s fails its band',
  (target) => {
    const { status, stdout } = run(target);
    expect(status).not.toBe(0);
    expect(stdout).toMatch(new RegExp(`=== band: ${target}[\\s\\S]*?band FAILED`));
  }
);

it('fails the run on a failed band even when asked to rebase', () => {
  const { status } = run('attach_cost_band', ['--rebase']);
  expect(status).not.toBe(0);
});

it('runs no band when the gates are switched off', () => {
  const { calls } = run('', ['--no-gates']);
  expect(calls.filter((c) => / --test /.test(c))).toEqual([]);
});
