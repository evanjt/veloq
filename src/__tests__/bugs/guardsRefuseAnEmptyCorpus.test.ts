/**
 * Scenario: a guard that cannot see its subject answers as though the subject
 * were present and empty. Four went that way in one day: two listing guards
 * under a foreign index each reported nothing over its ceiling and exited 0,
 * and two spawns that never started exited 1 having printed nothing, because a
 * `spawnSync` that fails to start answers a null status with the reason in
 * `error` and inheriting stdio prints nothing when there is no child.
 *
 * Expected behaviour: a zero and a silence are different answers. A guard whose
 * listing is empty refuses and says it read nothing, and a spawn reports why it
 * did not start before it exits on a status it never got.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const ROOT = join(__dirname, '../../..');
const SCRIPTS = join(ROOT, 'scripts');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/**
 * A checkout that tracks nothing the guard reads. `git init` with the files
 * left unstaged, so the listing comes back empty rather than the filter
 * emptying it: a fixture tracking only its own test data is a legitimate zero.
 */
function emptyCheckout(): string {
  const root = mkdtempSync(join(tmpdir(), 'empty-corpus-'));
  roots.push(root);
  writeFileSync(join(root, 'README.md'), 'x\n');
  runGit(['init', '-q'], root);
  return root;
}

function runGuard(script: string, root: string): { code: number; out: string } {
  try {
    // `gitFreeEnv` for the child too: the guard reads git itself, and a hook's
    // `GIT_DIR` beats the `--root` it was handed, so without this the guard
    // would answer about the repository running the suite.
    const out = execFileSync('node', [join(SCRIPTS, script), '--root', root], {
      encoding: 'utf8',
      env: gitFreeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** Every guard that judges a corpus it lists out of the index. */
const LISTING_GUARDS = [
  'lint-audit-ids.mjs',
  'lint-au-spelling.mjs',
  'lint-comment-line-refs.mjs',
  'lint-em-dashes.mjs',
];

describe.each(LISTING_GUARDS)('%s', (script) => {
  it('refuses a listing it read nothing from, rather than reporting a clean tree', () => {
    const { code, out } = runGuard(script, emptyCheckout());

    expect(code).toBe(1);
    expect(out).toMatch(/read nothing/i);
  });
});

/**
 * The idiom, reproduced rather than asserted from memory: a command that is not
 * there answers a null status, and `status ?? 1` turns that into a bare 1.
 */
describe('a spawn that never starts', () => {
  it('answers a null status with the reason in error', () => {
    const run = spawnSync(join(tmpdir(), 'definitely-not-here-veloq.sh'), [], {
      env: gitFreeEnv(),
      stdio: 'pipe',
    });

    expect(run.status).toBeNull();
    expect(run.error).toBeDefined();
  });

  it('is reported by every script that exits on a spawn status', () => {
    const offenders: string[] = [];
    for (const name of readdirSync(SCRIPTS)) {
      if (!/\.(mjs|ts)$/.test(name)) continue;
      const source = readFileSync(join(SCRIPTS, name), 'utf8');
      const spawns = [...source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*spawnSync\(/g)];
      for (const [, binding] of spawns) {
        const usesStatus = new RegExp(`\\b${binding}\\.status\\b`).test(source);
        const checksError = new RegExp(`\\b${binding}\\.error\\b`).test(source);
        if (usesStatus && !checksError) offenders.push(`${name}: ${binding}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('is something this guard can still find, or it is testing nothing', () => {
    const spawning = readdirSync(SCRIPTS).filter(
      (name) =>
        /\.(mjs|ts)$/.test(name) &&
        /=\s*spawnSync\(/.test(readFileSync(join(SCRIPTS, name), 'utf8'))
    );

    expect(spawning.length).toBeGreaterThan(2);
  });
});

/** The directory has to exist for the sweep above to mean anything. */
it('sweeps a scripts directory that is there', () => {
  mkdirSync(SCRIPTS, { recursive: true });
  expect(readdirSync(SCRIPTS).length).toBeGreaterThan(20);
});
