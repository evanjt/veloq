/**
 * Scenario: every style sweep lowers counts in the one shared baseline file, so
 * two sweeps landing together conflict there, and the conflict waits on a hand
 * that can only ever choose the lower count.
 *
 * Expected behaviour: the merge driver takes the lower count per key, drops a
 * key one side took to zero, keeps a key one side added, and leaves a file it
 * cannot read as a conflict. Installed by `prepare`, a real merge of two sweeps
 * on that file completes on its own.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const REPO = resolve(__dirname, '../../..');
const DRIVER = join(REPO, 'scripts/merge-ratchet-baseline.mjs');
const INSTALL = join(REPO, 'scripts/install-merge-drivers.mjs');
const BASELINE = 'scripts/style-literal-baseline.json';

const boxes: string[] = [];
afterAll(() => {
  for (const box of boxes) rmSync(box, { recursive: true, force: true });
});

function box(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ratchet-merge-')));
  boxes.push(dir);
  return dir;
}

function drive(base: unknown, ours: unknown, theirs: unknown) {
  const dir = box();
  const files = { base, ours, theirs };
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  const r = spawnSync('node', [DRIVER, join(dir, 'base'), join(dir, 'ours'), join(dir, 'theirs')], {
    encoding: 'utf8',
    env: gitFreeEnv(),
  });
  return {
    status: r.status,
    output: `${r.stdout}${r.stderr}`,
    merged: readFileSync(join(dir, 'ours'), 'utf8'),
  };
}

describe('the ratchet baseline merge driver', () => {
  it('takes the lower count of each key the two sides both changed', () => {
    const base = { alpha: { 'a.tsx': 5, 'b.tsx': 4 }, opacity: { 'a.tsx': 3 } };
    const ours = { alpha: { 'a.tsx': 2, 'b.tsx': 4 }, opacity: { 'a.tsx': 3 } };
    const theirs = { alpha: { 'a.tsx': 3, 'b.tsx': 1 }, opacity: { 'a.tsx': 2 } };

    const { status, merged } = drive(base, ours, theirs);

    expect(status).toBe(0);
    expect(JSON.parse(merged)).toEqual({
      alpha: { 'a.tsx': 2, 'b.tsx': 1 },
      opacity: { 'a.tsx': 2 },
    });
  });

  it('drops a key one side took to zero, even where the other lowered it', () => {
    const base = { alpha: { 'a.tsx': 5, 'b.tsx': 4 } };
    const ours = { alpha: { 'b.tsx': 4 } };
    const theirs = { alpha: { 'a.tsx': 1, 'b.tsx': 4 } };

    expect(JSON.parse(drive(base, ours, theirs).merged)).toEqual({ alpha: { 'b.tsx': 4 } });
  });

  it('keeps a key one side added, and a class one side added', () => {
    const base = { alpha: { 'a.tsx': 5 } };
    const ours = { alpha: { 'a.tsx': 5, 'moved.tsx': 2 } };
    const theirs = { alpha: { 'a.tsx': 4 }, motion: { 'c.tsx': 1 } };

    expect(JSON.parse(drive(base, ours, theirs).merged)).toEqual({
      alpha: { 'a.tsx': 4, 'moved.tsx': 2 },
      motion: { 'c.tsx': 1 },
    });
  });

  it('writes the keys sorted, two-space indented, with a closing newline', () => {
    const { merged } = drive({}, { b: { z: 1, y: 2 } }, { a: {} });

    expect(merged).toBe('{\n  "a": {},\n  "b": {\n    "y": 2,\n    "z": 1\n  }\n}\n');
  });

  it('leaves a side it cannot read as a conflict, untouched', () => {
    const { status, merged } = drive({}, '<<<<<<< not json', { alpha: {} });

    expect(status).not.toBe(0);
    expect(merged).toBe('<<<<<<< not json');
  });

  it('leaves a value that is not a count as a conflict, since the lower one means nothing', () => {
    const { status, output } = drive({}, { note: 'kept by hand' }, { note: 'changed' });

    expect(status).not.toBe(0);
    expect(output).toContain('note');
  });
});

describe('two sweeps merged on the shared baseline file', () => {
  it('completes with no hand, holding the lower count per key', () => {
    const root = box();
    const git = (...args: string[]) => runGit(args, root);
    runGit(['init', '-q', '-b', 'main'], root);
    writeFileSync(join(root, '.gitattributes'), readFileSync(join(REPO, '.gitattributes')));
    const write = (body: object) => {
      mkdirSync(join(root, 'scripts'), { recursive: true });
      writeFileSync(join(root, BASELINE), `${JSON.stringify(body, null, 2)}\n`);
    };
    write({ alpha: { 'a.tsx': 5, 'b.tsx': 4 } });
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('checkout', '-q', '-b', 'sweep');
    write({ alpha: { 'a.tsx': 2, 'b.tsx': 4 } });
    git('commit', '-qam', 'one sweep');
    git('checkout', '-q', 'main');
    write({ alpha: { 'a.tsx': 3, 'b.tsx': 1 } });
    git('commit', '-qam', 'another sweep');

    const installed = spawnSync('node', [INSTALL], {
      cwd: root,
      env: gitFreeEnv(),
      encoding: 'utf8',
    });
    expect(installed.status).toBe(0);
    const merged = spawnSync('git', ['merge', '-q', '--no-edit', 'sweep'], {
      cwd: root,
      env: gitFreeEnv(),
      encoding: 'utf8',
    });

    expect(merged.status).toBe(0);
    expect(JSON.parse(readFileSync(join(root, BASELINE), 'utf8'))).toEqual({
      alpha: { 'a.tsx': 2, 'b.tsx': 1 },
    });
  });
});
