/**
 * Scenario: a local full run of the Maestro suite on a workstation. A flow
 * tagged `real-account` signs in to a real library and needs `API_KEY`, and
 * Maestro may be installed on PATH rather than under `~/.maestro/bin`.
 *
 * Expected behaviour: `run-suite.sh` leaves real-account flows out unless
 * `API_KEY` is set, on the plain and the sharded path, and it finds Maestro on
 * PATH when the home install is absent, saying which binary it chose.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const MAESTRO_DIR = path.resolve(__dirname, '../../../.maestro');
const BASH = fs.existsSync('/usr/bin/bash') ? '/usr/bin/bash' : '/bin/bash';
const SCRIPT = path.join(MAESTRO_DIR, 'run-suite.sh');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-suite-tags-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(dir, 'home'));
  const fake = path.join(bin, 'maestro');
  fs.writeFileSync(fake, `#!/usr/bin/env bash\necho "$*" >> "${dir}/calls.log"\nexit 0\n`, {
    mode: 0o755,
  });
  fs.symlinkSync(MAESTRO_DIR, path.join(dir, '.maestro'));
  return { dir, bin, fake };
}

function run(
  args: string[],
  env: Record<string, string | undefined>,
  setupResult: ReturnType<typeof setup>
) {
  const { dir } = setupResult;
  const result = spawnSync(
    BASH,
    [SCRIPT, path.join(dir, 'out.xml'), path.join(dir, 'd'), ...args],
    {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, CI: 'true', API_KEY: undefined, MAESTRO_BIN: undefined, ...env },
    }
  );
  const callsFile = path.join(dir, 'calls.log');
  const calls = fs.existsSync(callsFile)
    ? fs.readFileSync(callsFile, 'utf8').trim().split('\n')
    : [];
  return { status: result.status, output: result.stdout + result.stderr, calls };
}

describe('real-account flows in a local run', () => {
  it('are excluded when no API_KEY is set', () => {
    const s = setup();
    const r = run(['--exclude-tags=tier4,tier5'], { MAESTRO_BIN: s.fake }, s);
    expect(r.status).toBe(0);
    expect(r.calls[0]).toContain('--exclude-tags=tier4,tier5,real-account');
  });

  vaultIt('are excluded when no exclude list was given', () => {
    const s = setup();
    const r = run(['--include-tags=tier0'], { MAESTRO_BIN: s.fake }, s);
    expect(r.calls[0]).toContain('--include-tags=tier0');
    expect(r.calls[0]).toContain('--exclude-tags=real-account');
  });

  vaultIt('are left to the caller when API_KEY is set', () => {
    const s = setup();
    const r = run(['--exclude-tags=tier4'], { MAESTRO_BIN: s.fake, API_KEY: 'k' }, s);
    expect(r.calls[0]).toContain('--exclude-tags=tier4');
    expect(r.calls[0]).not.toContain('real-account');
  });

  it('are left out of a shard when no API_KEY is set', () => {
    const s = setup();
    const r = run(
      ['--include-tags=real-account'],
      { MAESTRO_BIN: s.fake, MAESTRO_SHARD: '1/1' },
      s
    );
    expect(r.output).toContain('selects no flow');
    expect(r.calls).toEqual([]);
  });

  vaultIt('are picked up by a shard when API_KEY is set', () => {
    const s = setup();
    const r = run(
      ['--include-tags=real-account'],
      { MAESTRO_BIN: s.fake, MAESTRO_SHARD: '1/1', API_KEY: 'k' },
      s
    );
    expect(r.calls[0]).toContain('first-sync-section-growth.yaml');
  });
});

describe('the Maestro binary', () => {
  vaultIt('falls back to the one on PATH when the home install is absent, and says so', () => {
    const s = setup();
    const r = run(
      ['--include-tags=tier0'],
      { HOME: path.join(s.dir, 'home'), PATH: `${s.bin}:${process.env.PATH}` },
      s
    );
    expect(r.status).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.output).toContain(`Using Maestro at ${s.fake}`);
  });

  vaultIt('prefers the home install when it exists', () => {
    const s = setup();
    const homeBin = path.join(s.dir, 'home', '.maestro', 'bin');
    fs.mkdirSync(homeBin, { recursive: true });
    fs.copyFileSync(s.fake, path.join(homeBin, 'maestro'));
    fs.chmodSync(path.join(homeBin, 'maestro'), 0o755);
    const r = run(
      ['--include-tags=tier0'],
      { HOME: path.join(s.dir, 'home'), PATH: `${s.bin}:${process.env.PATH}` },
      s
    );
    expect(r.output).toContain(`Using Maestro at ${path.join(homeBin, 'maestro')}`);
  });

  vaultIt('stops with a message when there is none', () => {
    const s = setup();
    const empty = path.join(s.dir, 'empty');
    fs.mkdirSync(empty);
    const r = run(['--include-tags=tier0'], { HOME: path.join(s.dir, 'home'), PATH: empty }, s);
    expect(r.status).toBe(1);
    expect(r.output).toContain('No Maestro found');
  });
});
