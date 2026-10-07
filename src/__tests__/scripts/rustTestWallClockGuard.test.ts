/**
 * Scenario: a Rust test asserted that a pooled read finished inside 100 ms of
 * the wall clock, and thirteen copies of it failed the per-push lane whenever
 * the machine was busy.
 *
 * Expected behaviour: the guard fails an assertion in veloqrs test code that
 * bounds a duration from above against `Duration::from_*` or `.elapsed()`, or
 * bounds a measured value from above in any spelling: `<=`, reversed operands,
 * milliseconds taken off it, a local or a helper holding it, or an `if` that
 * panics. It leaves production code, benches, hang guards in loop conditions
 * and against a deadline, lower bounds and message text alone.
 * `npm run audit` runs it over this repository.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-rust-test-wall-clock.mjs');
const CRATE = 'modules/veloqrs/rust/veloqrs';

function runGuard(root?: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', root ? [SCRIPT, '--root', root] : [SCRIPT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'rust-wall-clock-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('fails a read timed against a millisecond bound in an integration test', () => {
  const root = fixture({
    [`${CRATE}/tests/pooled.rs`]: [
      '#[test]',
      'fn reads_under_a_writer() {',
      '    let waited = started.elapsed();',
      '    assert!(',
      '        waited < Duration::from_millis(100),',
      '        "read waited {waited:?} for writer"',
      '    );',
      '}',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain(`${CRATE}/tests/pooled.rs:4`);
});

it('fails an elapsed bound inside a test module of a source file', () => {
  const root = fixture({
    [`${CRATE}/src/net/thing.rs`]: [
      'pub fn work() {}',
      '#[cfg(test)]',
      'mod tests {',
      '    #[test]',
      '    fn fast() {',
      '        assert!(started.elapsed() < LIMIT, "slow");',
      '        assert!(held < std::time::Duration::from_millis(16));',
      '    }',
      '}',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain(`${CRATE}/src/net/thing.rs:6`);
  expect(output).toContain(`${CRATE}/src/net/thing.rs:7`);
});

it('fails a bound named by a Duration constant', () => {
  const root = fixture({
    [`${CRATE}/src/objects/thing.rs`]: [
      '#[cfg(test)]',
      'mod tests {',
      '    #[test]',
      '    fn under_a_writer() {',
      '        const FRAME_BUDGET: Duration = Duration::from_millis(16);',
      '        const ROWS: usize = 4;',
      '        assert!(rows < ROWS);',
      '        assert!(waited < FRAME_BUDGET, "over a frame");',
      '    }',
      '}',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain(`${CRATE}/src/objects/thing.rs:8`);
  expect(output).not.toContain(`${CRATE}/src/objects/thing.rs:7`);
});

/** One test function in an integration test file, so each shape is read alone. */
function oneTest(body: string[]): string {
  return [
    '#[test]',
    'fn timed() {',
    '    let s = Instant::now();',
    ...body.map((l) => `    ${l}`),
    '}',
  ].join('\n');
}

it.each([
  ['an upper bound written with <=', ['assert!(s.elapsed() <= Duration::from_millis(100));'], 4],
  [
    'milliseconds taken off a measured local',
    ['let load = s.elapsed();', 'assert!(load.as_millis() < 500);'],
    5,
  ],
  [
    'float milliseconds held in a local',
    ['let m = s.elapsed().as_secs_f64() * 1000.0;', 'assert!(m <= 30.0);'],
    5,
  ],
  [
    'a bound held in a Duration local',
    [
      'let e = s.elapsed();',
      'let ladder: Duration = delays.iter().sum();',
      'assert!(e < ladder, "spent {e:?}");',
    ],
    6,
  ],
  ['reversed operands', ['assert!(Duration::from_millis(100) > s.elapsed());'], 4],
  ['reversed operands with >=', ['assert!(budget >= s.elapsed(), "over");'], 4],
  [
    'an if that panics past the bound',
    ['if s.elapsed() > Duration::from_millis(100) {', '    panic!("slow");', '}'],
    4,
  ],
  [
    'a measured value the other side of an if that panics',
    ['let waited = s.elapsed();', 'if LIMIT < waited { panic!("slow") }'],
    5,
  ],
  [
    'a median of samples collected from the clock',
    [
      'let mut samples = Vec::new();',
      'let elapsed = s.elapsed().as_secs_f64() * 1000.0;',
      'samples.push(elapsed);',
      'let median = samples[samples.len() / 2];',
      'assert!(median <= 300.0, "median {median:.1} ms");',
    ],
    8,
  ],
])('fails %s', (_shape, body, line) => {
  const root = fixture({ [`${CRATE}/tests/timed.rs`]: oneTest(body as string[]) });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain(`${CRATE}/tests/timed.rs:${line}`);
});

it('fails a bound on what a helper measured', () => {
  const root = fixture({
    [`${CRATE}/tests/read_path.rs`]: [
      'fn median_ms(engine: &mut Engine, iterations: u32) -> f64 {',
      '    let mut samples: Vec<f64> = Vec::new();',
      '    for _ in 0..iterations {',
      '        let start = Instant::now();',
      '        engine.read();',
      '        samples.push(start.elapsed().as_secs_f64() * 1000.0);',
      '    }',
      '    samples[samples.len() / 2]',
      '}',
      '#[test]',
      'fn fast() {',
      '    let median = median_ms(&mut engine, 15);',
      '    assert!(median <= 30.0, "{median:.2}ms");',
      '}',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain(`${CRATE}/tests/read_path.rs:13`);
});

it('leaves lower bounds and deadlines on measured values alone', () => {
  const root = fixture({
    [`${CRATE}/tests/timed.rs`]: oneTest([
      'let waited = s.elapsed();',
      'let deadline = Instant::now() + Duration::from_secs(30);',
      'assert!(waited >= Duration::from_millis(100), "returned before the backoff");',
      'assert!(waited.as_millis() > 99);',
      'assert!(Duration::from_millis(100) <= waited);',
      'assert!(Instant::now() < deadline, "hung");',
      'if waited < Duration::from_millis(100) { panic!("returned before the backoff") }',
      'if waited > Duration::from_secs(30) { return; }',
      'assert_eq!(waited.is_zero(), false);',
      'let before = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;',
      'assert!(stored.fetched_at >= before as f64);',
    ]),
  });

  expect(runGuard(root).status).toBe(0);
});

it('leaves production code, benches, loop hang guards, lower bounds and messages alone', () => {
  const root = fixture({
    [`${CRATE}/src/net/thing.rs`]: [
      'pub fn stale(at: Instant) -> bool {',
      '    assert!(at.elapsed() < Duration::from_secs(1));',
      '    at.elapsed() < Duration::from_secs(60)',
      '}',
      '#[cfg(test)]',
      'mod tests {',
      '    #[test]',
      '    fn bounded() {',
      '        while started.elapsed() < Duration::from_secs(30) {}',
      '        assert!(started.elapsed() >= Duration::from_millis(100));',
      '        assert!(t.connect <= Duration::from_secs(5));',
      '        assert!(ok, "took longer than < Duration::from_secs(5)");',
      '        // assert!(waited < Duration::from_millis(100));',
      '    }',
      '}',
    ].join('\n'),
    [`${CRATE}/benches/read_cost.rs`]:
      'fn main() { assert!(waited < Duration::from_millis(100)); }\n',
  });

  expect(runGuard(root).status).toBe(0);
});

describe('a channel wait whose expiry becomes the verdict', () => {
  const body = (lines: string[]) =>
    ['#[test]', 'fn t() {', ...lines.map((l) => `    ${l}`), '}'].join('\n');

  it.each([
    [
      'an option kept and asserted',
      [
        'let early = rx.recv_timeout(Duration::from_secs(2)).ok();',
        'assert!(early.is_some(), "settled");',
      ],
    ],
    [
      'a boolean derived from it',
      [
        'let early = rx.recv_timeout(Duration::from_secs(2)).ok();',
        'let settled = early.is_some();',
        'assert!(settled, "settled");',
      ],
    ],
    [
      'a boolean taken straight off the wait',
      ['let settled = rx.recv_timeout(Duration::from_secs(2)).is_ok();', 'assert!(settled);'],
    ],
    [
      'the wait inside the assertion',
      ['assert!(rx.recv_timeout(Duration::from_millis(200)).is_ok());'],
    ],
    [
      'a wait asserted with assert_eq',
      ['assert_eq!(rx.recv_timeout(Duration::from_secs(1)).is_ok(), true);'],
    ],
  ])('fails %s', (_name, lines) => {
    const root = fixture({ [`${CRATE}/tests/settle.rs`]: body(lines) });

    const { status, output } = runGuard(root);

    expect(status).toBe(1);
    expect(output).toContain(`${CRATE}/tests/settle.rs:`);
  });

  it('leaves a wait that must succeed, a long or variable deadline, a negative wait and a value only used alone', () => {
    const root = fixture({
      [`${CRATE}/tests/settle.rs`]: body([
        'let got = rx.recv_timeout(Duration::from_secs(30)).expect("settles");',
        'assert_eq!(got.len(), 1);',
        'let early = rx.recv_timeout(Duration::from_secs(2)).ok();',
        'let completed = early.or_else(|| rx.recv_timeout(Duration::from_secs(10)).ok()).unwrap();',
        'assert!(completed.ids.is_empty());',
        'assert!(rx.recv_timeout(Duration::from_millis(200)).is_err());',
        'assert!(rx.recv_timeout(Duration::from_secs(20)).is_ok());',
        'assert!(rx.recv_timeout(deadline).is_ok());',
      ]),
    });

    expect(runGuard(root).status).toBe(0);
  });
});
