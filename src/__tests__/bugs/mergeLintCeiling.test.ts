/**
 * Scenario: the lint ratchet went over its ceiling twice in one evening, both
 * times at a merge, and both times a human running `npm run lint` on a whim is
 * what found it.
 *
 * Expected behaviour: git runs `pre-commit` for a commit and
 * `pre-merge-commit` for a merge that does not conflict, and only the first
 * existed. A merge now checks the ceiling the same way a commit does.
 */

import { accessSync, constants, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');
const hook = (name: string) => readFileSync(join(ROOT, '.husky', name), 'utf8');

describe('a merge is gated the way a commit is', () => {
  it('has a pre-merge-commit hook at all', () => {
    expect(() =>
      accessSync(join(ROOT, '.husky', 'pre-merge-commit'), constants.F_OK)
    ).not.toThrow();
  });

  it('checks the lint ceiling, which is what drifted', () => {
    expect(hook('pre-merge-commit')).toMatch(/npm run lint\b/);
  });

  it('checks the ceiling uncached, so a merge cannot replay a stale pass', () => {
    expect(hook('pre-merge-commit')).not.toMatch(/lint:cached/);
  });

  it('refuses a foreign hook or index first, the same as a commit does', () => {
    expect(hook('pre-merge-commit')).toContain('check-commit-index.sh');
  });

  it('fails the merge rather than reporting and continuing', () => {
    expect(hook('pre-merge-commit')).toMatch(/^set -e$/m);
  });
});

describe('the ceiling is a real number, not a rounded one', () => {
  it('names the ceiling in the lint script', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.lint).toMatch(/--max-warnings \d+/);
  });
});
