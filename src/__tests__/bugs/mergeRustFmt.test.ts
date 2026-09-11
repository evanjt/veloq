/**
 * Scenario: a worktree runs no hooks until `npm run prepare`, so a branch
 * commit made in one skips the `pre-commit` rustfmt gate entirely. The merge
 * back is the only chokepoint left, which is why the whole-tree guards live in
 * `pre-merge-commit`, and formatting was not among them.
 *
 * Expected behaviour: a merge checks the crate the way a commit checks its
 * staged files. The staged-file gate cannot serve here: a merge stages no
 * files of its own, so it would find nothing and pass.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describeWithTracematch } from '../support/tracematch';

const ROOT = join(__dirname, '../../..');
const hook = (name: string) => readFileSync(join(ROOT, '.husky', name), 'utf8');
/** What a merge runs, whichever hook git gives it: the caller and its battery. */
const merge = () =>
  hook('pre-merge-commit') + readFileSync(join(ROOT, 'scripts/merge-gates.sh'), 'utf8');

describe('a merge cannot carry unformatted Rust', () => {
  it('checks the crate, not the staged set, which a merge leaves empty', () => {
    expect(merge()).toMatch(/cargo fmt\b/);
    expect(merge()).not.toMatch(/lint:rust-fmt/);
  });

  it('checks rather than rewrites, so the merge fails instead of moving files', () => {
    expect(merge()).toMatch(/cargo fmt[^\n]*--check/);
  });

  it('still gates the staged set on a commit, where that is the right question', () => {
    expect(hook('pre-commit')).toMatch(/lint:rust-fmt/);
  });
});

describeWithTracematch('the tree the gate is being added over', () => {
  /**
   * The gate is worth nothing if it lands over a tree that already fails it,
   * which is the state this was found in.
   */
  it('is rustfmt clean today', () => {
    expect(() =>
      execFileSync('cargo', ['fmt', '-p', 'veloqrs', '--', '--check'], {
        cwd: join(ROOT, 'modules/veloqrs/rust'),
        encoding: 'utf8',
      })
    ).not.toThrow();
  });
});
