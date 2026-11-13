/**
 * Scenario: the checks CI catches most often (Jest under a western timezone, the
 * map-page smoke, the tooling suites, Rust advisories, the workflow lint) cost a
 * push and an hour each when they fail only there.
 *
 * Expected behaviour: `scripts/preflight.mjs` runs each of the five, passes the
 * Los Angeles timezone to Jest only, runs the rest after a failure, and exits
 * non-zero naming every check that failed.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/preflight.mjs');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'preflight-'));
  for (const tool of ['npm', 'npx', 'cargo']) {
    const path = join(dir, tool);
    writeFileSync(
      path,
      `#!/bin/sh\necho "$0 $* TZ=$TZ" >> "${dir}/calls.log"\n` +
        `case " $* " in *" $STUB_FAIL "*) exit 1;; esac\nexit 0\n`
    );
    chmodSync(path, 0o755);
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(fail = '__none__'): { code: number; out: string; calls: string[] } {
  let code = 0;
  let out = '';
  try {
    out = execFileSync('node', [SCRIPT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: dir + delimiter + process.env.PATH, STUB_FAIL: fail, TZ: 'UTC' },
    });
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    code = err.status;
    out = err.stdout + err.stderr;
  }
  let calls: string[] = [];
  try {
    calls = readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n');
  } catch {
    // no stub was called
  }
  return { code, out, calls };
}

describe('preflight', () => {
  it('runs the five checks and exits zero when all pass', () => {
    const { code, calls } = run();
    expect(code).toBe(0);
    const joined = calls.join('\n');
    expect(joined).toMatch(/test .*TZ=America\/Los_Angeles/);
    expect(joined).toContain('test:map-pages');
    expect(joined).toContain('test:tooling');
    expect(joined).toContain('audit --deny warnings');
    expect(joined).toContain('lint:workflows');
    expect(calls).toHaveLength(5);
  });

  it('runs Jest only under the Los Angeles timezone', () => {
    const { calls } = run();
    const others = calls.filter((c) => !/ test(\s|$)/.test(c));
    for (const c of others) expect(c).not.toContain('America/Los_Angeles');
  });

  it.each(['test:map-pages', 'test:tooling', 'lint:workflows', 'audit'])(
    'exits non-zero naming %s when it fails, and still runs the others',
    (failing) => {
      const { code, out, calls } = run(failing);
      expect(code).not.toBe(0);
      expect(out).toContain(failing);
      expect(calls).toHaveLength(5);
    }
  );

  it('fails when Jest under the Los Angeles timezone fails', () => {
    const { code, out } = run('test');
    expect(code).not.toBe(0);
    expect(out).toContain('America/Los_Angeles');
  });
});
