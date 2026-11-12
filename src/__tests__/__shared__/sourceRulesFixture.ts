import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from './gitFixture';

export const ROOT = join(__dirname, '../../..');
const SCRIPT = join(ROOT, 'scripts/lint-source-rules.mjs');

const roots: string[] = [];

/** Removes every fixture tree the calling suite made; run it from `afterAll`. */
export function removeFixtures(): void {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

export function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'source-rules-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  initFixtureRepo(root);
  return root;
}

export function runRule(rule: string, root: string): { status: number; output: string } {
  const args = [SCRIPT, '--rule', rule, '--root', root];
  try {
    const output = execFileSync('node', args, {
      cwd: ROOT,
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

export const real = (path: string) => readFileSync(join(ROOT, path), 'utf8');
