/**
 * Scenario: a job tree that has no install runs the gate, which reached the bindings step and
 * failed there with a message about a missing tool, naming nothing of the provisioning that
 * should have made the install.
 * Expected behaviour: the gate provisions a tree with no install before any lane runs. When
 * provisioning fails, or finishes without leaving an install, the gate refuses at once and names
 * the provisioning step; a tree with an install is not provisioned again.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const ROOT = resolve(__dirname, '../../..');
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** A repository holding the real gate and a provisioning script made from `provisionBody`. */
function fixture(provisionBody: string): string {
  const root = mkdtempSync(join(tmpdir(), 'land-gate-install-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'));
  cpSync(join(ROOT, 'scripts/land-gate.sh'), join(root, 'scripts/land-gate.sh'));
  write(root, 'scripts/provision-job-tree.sh', `#!/bin/sh\n${provisionBody}\n`);
  chmodSync(join(root, 'scripts/provision-job-tree.sh'), 0o755);
  write(root, 'src/feature.ts', 'export const feature = 1;\n');
  runGit(['init', '-q', '-b', 'main'], root);
  runGit(['add', '-A'], root);
  runGit(['commit', '-q', '-m', 'Base'], root);
  runGit(['checkout', '-q', '-b', 'job'], root);
  return root;
}

function gate(root: string): { status: number | null; output: string } {
  const run = spawnSync('sh', ['scripts/land-gate.sh'], {
    cwd: root,
    env: { ...gitFreeEnv(), PATH: process.env.PATH ?? '' },
    encoding: 'utf8',
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

describe('land gate install check', () => {
  it('refuses a job tree whose provisioning fails, naming the step', () => {
    const root = fixture('echo "npm ci failed" >&2\nexit 1');
    const { status, output } = gate(root);
    expect(status).not.toBe(0);
    expect(output).toContain('gate: provisioning the tree failed');
  });

  it('refuses a job tree whose provisioning finishes with no install', () => {
    const root = fixture('exit 0');
    const { status, output } = gate(root);
    expect(status).not.toBe(0);
    expect(output).toContain('gate: provisioning left no install');
  });

  it('provisions a tree with no install before any lane runs', () => {
    const root = fixture('touch "$(dirname "$0")/../provisioned"\nexit 1');
    gate(root);
    expect(existsSync(join(root, 'provisioned'))).toBe(true);
  });

  it('does not provision a tree that has an install', () => {
    const root = fixture('touch "$(dirname "$0")/../provisioned"\nexit 1');
    write(root, 'node_modules/.bin/tsc', '#!/bin/sh\nexit 0\n');
    chmodSync(join(root, 'node_modules/.bin/tsc'), 0o755);
    gate(root);
    expect(existsSync(join(root, 'provisioned'))).toBe(false);
  });
});
