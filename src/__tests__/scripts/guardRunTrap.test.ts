/**
 * Scenario: a Jest case runs a repository guard, or the guard runner, and
 * expects it to pass.
 *
 * Expected behaviour: the trap refuses it when the guard would read this
 * repository, whatever working directory or path it was handed. Only a guard
 * that takes its root from its working directory or `--root` can be pointed at
 * a fixture.
 */
import { execFileSync, fork, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const repo = path.join(__dirname, '../../..');
const script = (name: string) => path.join(repo, 'scripts', name);

describe('guard-run trap', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-trap-'));
  afterAll(() => fs.rmSync(fixture, { recursive: true, force: true }));

  it('refuses a guard that roots itself, even from a fixture working directory', () => {
    expect(() => spawnSync('node', [script('check-expo-sdk.mjs')], { cwd: fixture })).toThrow(
      /whole repository/
    );
  });

  it('refuses a guard that roots itself, given a fixture path argument', () => {
    expect(() => spawnSync('node', [script('check-expo-sdk.mjs'), fixture])).toThrow(
      /whole repository/
    );
  });

  it('allows a guard that takes --root to run over a fixture root', () => {
    expect(() =>
      spawnSync('node', [script('lint-ffi-bigint.mjs'), '--root', fixture], { timeout: 1 })
    ).not.toThrow();
  });

  it('allows a guard that reads its working directory to start in a fixture', () => {
    expect(() =>
      spawnSync('node', [script('lint-retired-names.mjs')], { cwd: fixture, timeout: 1 })
    ).not.toThrow();
  });

  it('refuses a guard run with no fixture', () => {
    expect(() => spawnSync('node', [script('lint-ffi-bigint.mjs')])).toThrow(/whole repository/);
  });

  it('refuses a guard started with fork', () => {
    expect(() => fork(script('lint-retired-names.mjs'), [], { silent: true })).toThrow(
      /whole repository/
    );
  });

  it('refuses the runner without --json, --list or --guards', () => {
    expect(() => execFileSync('node', [script('run-guards.mjs'), '--set', 'commit'])).toThrow(
      /run-guards/
    );
  });

  it.each(['--json', '--list'])('lets the runner list its guards with %s', (flag) => {
    const out = execFileSync('node', [script('run-guards.mjs'), '--set', 'commit', flag]);
    expect(out.length).toBeGreaterThan(0);
  });

  it.each(['audit', 'audit:guards', 'doctor'])('refuses npm run %s', (name) => {
    expect(() => spawnSync('npm', ['run', '--silent', name])).toThrow(/run-guards/);
  });
});
