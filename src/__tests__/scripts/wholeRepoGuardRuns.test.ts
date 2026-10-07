/**
 * Scenario: a guard ships with a case that runs it over the whole repository
 * and expects it to exit 0. `npm run audit` already runs every guard the runner
 * lists, so the case checks nothing new, costs the suite the guard's whole run
 * on every change, and fails a red tree twice. Three such cases landed after
 * the rule against them, because nothing refused them.
 *
 * Expected behaviour: a Jest case that starts a guard the runner lists, in this
 * repository and with no fixture root, is refused at the spawn and names the
 * guard. A run pointed at a fixture, by its working directory or by a path
 * argument, goes ahead, and so does any script the runner does not list.
 */

import { execFileSync, execSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const GUARD = join(ROOT, 'scripts/lint-retired-names.mjs');
const REFUSAL = /is a guard scripts\/run-guards\.mjs lists/;

let fixture: string;

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), 'whole-repo-guard-'));
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe('a guard run over the whole repository', () => {
  it('is refused by absolute path, and names the guard', () => {
    expect(() => spawnSync('node', [GUARD], { encoding: 'utf8' })).toThrow(
      /scripts\/lint-retired-names\.mjs is a guard/
    );
  });

  it('is refused by a path relative to the repository it runs in', () => {
    expect(() =>
      execFileSync('node', ['scripts/check-license-coverage.mjs'], { cwd: ROOT, stdio: 'pipe' })
    ).toThrow(REFUSAL);
  });

  it('is refused through tsx', () => {
    expect(() =>
      spawnSync('npx', ['tsx', join(ROOT, 'scripts/ffi-usage-report.ts'), '--check-areas'], {
        cwd: ROOT,
      })
    ).toThrow(REFUSAL);
  });

  it('is refused through npm run under the guard name', () => {
    expect(() =>
      spawnSync('npm', ['run', '--silent', 'lint:retired-names'], { cwd: ROOT })
    ).toThrow(REFUSAL);
  });

  it('is refused as a shell command line', () => {
    expect(() => execSync(`node ${GUARD}`, { cwd: ROOT, stdio: 'pipe' })).toThrow(REFUSAL);
  });

  it('is refused inside a command line handed to a shell', () => {
    expect(() => spawnSync('sh', ['-c', `node ${GUARD} --verbose`], { cwd: ROOT })).toThrow(
      REFUSAL
    );
  });

  it('is refused when started asynchronously', () => {
    expect(() => spawn('node', [GUARD], { stdio: 'ignore' })).toThrow(REFUSAL);
  });

  it('is refused when the root it is handed is the repository itself', () => {
    expect(() => spawnSync('node', [GUARD, '--root', ROOT])).toThrow(REFUSAL);
  });
});

describe('a guard run against a fixture', () => {
  it('goes ahead when a root outside the repository is passed', () => {
    const run = spawnSync('node', [GUARD, '--root', fixture], { encoding: 'utf8' });

    expect(run.error).toBeUndefined();
    expect(typeof run.status).toBe('number');
  });

  it('goes ahead when the fixture is the working directory', () => {
    const run = spawnSync('node', [join(ROOT, 'scripts/lint-audit-ids.mjs')], {
      cwd: fixture,
      encoding: 'utf8',
    });

    expect(run.error).toBeUndefined();
    expect(typeof run.status).toBe('number');
  });

  it('goes ahead for a script the runner does not list', () => {
    const run = spawnSync('node', [join(ROOT, 'scripts/run-guards.mjs'), '--list'], {
      cwd: ROOT,
      encoding: 'utf8',
    });

    expect(run.status).toBe(0);
  });
});
