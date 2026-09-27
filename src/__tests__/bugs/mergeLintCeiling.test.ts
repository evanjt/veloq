/**
 * Scenario: the lint ratchet went over its ceiling twice in one evening, both
 * times at a merge, and both times a human running `npm run lint` on a whim is
 * what found it.
 *
 * Expected behaviour: git runs `pre-commit` for a commit and
 * `pre-merge-commit` for a merge that does not conflict, and only the first
 * existed. A merge now lints the same way a commit does.
 */

import { spawnSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');
const hook = (name: string) => readFileSync(join(ROOT, '.husky', name), 'utf8');
/** What a merge runs, whichever hook git gives it: the caller and its battery. */
const merge = () =>
  hook('pre-merge-commit') + readFileSync(join(ROOT, 'scripts/merge-gates.sh'), 'utf8');

describe('a merge is gated the way a commit is', () => {
  it('has a pre-merge-commit hook at all', () => {
    expect(() =>
      accessSync(join(ROOT, '.husky', 'pre-merge-commit'), constants.F_OK)
    ).not.toThrow();
  });

  it('runs lint, which is what drifted', () => {
    // Through the merge-scoped script, which counts the tree the merge
    // commits rather than the shared checkout on disk. Matched as a
    // command line, not anywhere in the file: the prose above it names the
    // working-tree invocation it replaced.
    const commands = merge()
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    expect(commands).toContain('./scripts/check-merge-lint.sh');
    expect(commands.some((line) => /^npm run lint\b/.test(line))).toBe(false);
  });

  it('lints uncached, so a merge cannot replay a stale pass', () => {
    const script = readFileSync(join(ROOT, 'scripts/check-merge-lint.sh'), 'utf8');
    const eslint = script.split('\n').filter((line) => line.includes('/.bin/eslint'));
    expect(eslint).toHaveLength(1);
    expect(eslint[0]).not.toMatch(/--cache/);
  });

  it('refuses a foreign hook or index first, the same as a commit does', () => {
    expect(hook('pre-merge-commit')).toContain('check-commit-index.sh');
  });

  it('fails the merge when its first check fails, rather than running on', () => {
    const root = mkdtempSync(join(tmpdir(), 'merge-hook-'));
    try {
      mkdirSync(join(root, '.husky'));
      mkdirSync(join(root, 'scripts'));
      copyFileSync(join(ROOT, '.husky/pre-merge-commit'), join(root, '.husky/pre-merge-commit'));
      const stub = (path: string, body: string) => {
        writeFileSync(join(root, path), `#!/bin/sh\n${body}\n`);
        chmodSync(join(root, path), 0o755);
      };
      stub('scripts/check-commit-index.sh', 'exit 1');
      stub('scripts/merge-gates.sh', 'touch battery-ran');

      const result = spawnSync('sh', ['.husky/pre-merge-commit'], { cwd: root, encoding: 'utf8' });

      expect(result.status).not.toBe(0);
      expect(existsSync(join(root, 'battery-ran'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
