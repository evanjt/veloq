/**
 * Scenario: the nightly coverage lane instruments every workspace member, so
 * the detector crate's hot geometry loops carry coverage counters that twenty
 * threads update at once. Its lifecycle scenarios then run five times slower
 * than in a plain debug build and pass the per-test timeout, while the floors
 * read only the veloqrs crate's own lines.
 *
 * Expected behaviour: `coverage-rustc.sh`, the lane's workspace rustc wrapper,
 * drops `-C instrument-coverage` from the detector crate's compile in either
 * spelling, keeps every other argument in order, passes every other crate's
 * compile through untouched, and returns the compiler's exit status.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.join(__dirname, '../../../modules/veloqrs/scripts/coverage-rustc.sh');

let box: string;
let rustc: string;
let argsFile: string;

beforeEach(() => {
  box = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-rustc-'));
  argsFile = path.join(box, 'args');
  rustc = path.join(box, 'rustc');
  // A stand-in compiler that records each argument it was given on its own line.
  fs.writeFileSync(
    rustc,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\nexit "\${FAKE_RUSTC_EXIT:-0}"\n`,
    { mode: 0o755 }
  );
});

afterEach(() => fs.rmSync(box, { recursive: true, force: true }));

function compile(args: string[], exit = 0) {
  const result = spawnSync('bash', [SCRIPT, rustc, ...args], {
    encoding: 'utf8',
    env: { ...process.env, FAKE_RUSTC_EXIT: String(exit) },
    timeout: 20000,
  });
  const seen = fs.existsSync(argsFile)
    ? fs.readFileSync(argsFile, 'utf8').replace(/\n$/, '').split('\n')
    : null;
  return { status: result.status, stderr: result.stderr, seen };
}

const COVERAGE = ['-C', 'instrument-coverage', '--cfg=coverage', '--cfg=trybuild_no_target'];

it('compiles the detector crate without coverage counters', () => {
  const args = [
    '--crate-name',
    'tracematch',
    '--edition=2021',
    'tracematch/src/lib.rs',
    '-C',
    'debuginfo=2',
    '-C',
    'metadata=a path with spaces',
    ...COVERAGE,
  ];

  const { status, seen } = compile(args);

  expect(status).toBe(0);
  expect(seen).toEqual([
    '--crate-name',
    'tracematch',
    '--edition=2021',
    'tracematch/src/lib.rs',
    '-C',
    'debuginfo=2',
    '-C',
    'metadata=a path with spaces',
    '--cfg=coverage',
    '--cfg=trybuild_no_target',
  ]);
});

it('drops the joined and the valued spellings too', () => {
  const { seen } = compile([
    '--crate-name',
    'tracematch',
    'src/lib.rs',
    '-Cinstrument-coverage',
    '-C',
    'instrument-coverage=all',
    '-Copt-level=0',
  ]);

  expect(seen).toEqual(['--crate-name', 'tracematch', 'src/lib.rs', '-Copt-level=0']);
});

it('keeps coverage on the crate the floors measure and on its test binaries', () => {
  for (const crate of ['veloqrs', 'app_synthetic']) {
    const args = ['--crate-name', crate, 'veloqrs/src/lib.rs', ...COVERAGE];
    expect(compile(args).seen).toEqual(args);
  }
});

it('passes a call that names no crate straight through', () => {
  const args = ['-', '--crate-name', '___', '--print=cfg', '-C', 'instrument-coverage'];
  expect(compile(args).seen).toEqual(args);
  expect(compile(['-vV']).seen).toEqual(['-vV']);
});

it('returns the compiler exit status for either kind of crate', () => {
  expect(compile(['--crate-name', 'tracematch', ...COVERAGE], 3).status).toBe(3);
  expect(compile(['--crate-name', 'veloqrs', ...COVERAGE], 5).status).toBe(5);
});
