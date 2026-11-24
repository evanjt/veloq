/**
 * Scenario: a landing that adds a clippy lint under the Rust engine passed the landing gate,
 * which type-checked the Rust tree but never ran clippy, and failed the lint job in CI.
 * Expected behaviour: `scripts/land-gate.sh --list-lanes BASE` names the clippy lane when the
 * landing touches the Rust tree, names the command CI runs, and omits the lane otherwise.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const ROOT = resolve(__dirname, '../../..');
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const ENGINE_FILE = 'modules/veloqrs/rust/veloqrs/src/lib.rs';

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function fixture(): { root: string; base: string } {
  const root = mkdtempSync(join(tmpdir(), 'land-gate-rust-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'));
  cpSync(join(ROOT, 'scripts/land-gate.sh'), join(root, 'scripts/land-gate.sh'));
  write(root, ENGINE_FILE, 'pub fn one() {}\n');
  write(root, 'src/feature.ts', 'export const feature = 1;\n');
  runGit(['init', '-q', '-b', 'main'], root);
  runGit(['add', '-A'], root);
  runGit(['commit', '-q', '-m', 'Base'], root);
  const base = runGit(['rev-parse', 'HEAD'], root).trim();
  runGit(['checkout', '-q', '-b', 'landing'], root);
  return { root, base };
}

function plannedLanes(root: string, base: string): string[] {
  const run = spawnSync('sh', ['scripts/land-gate.sh', '--list-lanes', base], {
    cwd: root,
    env: gitFreeEnv(),
    encoding: 'utf8',
    timeout: 60_000,
  });
  expect(run.status).toBe(0);
  return run.stdout.split('\n').filter(Boolean);
}

describe('the landing gate plans the Rust lane a landing touches', () => {
  it('runs the CI clippy command when the engine changes', () => {
    const { root, base } = fixture();
    write(root, ENGINE_FILE, 'pub fn one() {}\npub fn two() {}\n');

    const lanes = plannedLanes(root, base);

    expect(lanes).toContain(
      'rust: cargo clippy -p veloqrs --all-targets --all-features -- -D warnings'
    );
  });

  it('plans no Rust lane when only the app changes', () => {
    const { root, base } = fixture();
    write(root, 'src/feature.ts', 'export const feature = 2;\n');

    const lanes = plannedLanes(root, base);

    expect(lanes.filter((lane) => lane.startsWith('rust'))).toEqual([]);
    expect(lanes).toContain('types');
  });
});
