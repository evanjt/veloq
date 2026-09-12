/**
 * Scenario: eleven of thirteen worktrees run no `pre-commit` at all, `tsc` is
 * skippable on the two that do, and the documented fallback is a CI workflow
 * that fires only on a push to main. Nothing here is pushed, so for the whole
 * of the current window a type error outside `--onlyChanged`'s blast radius had
 * no gate anywhere.
 *
 * Expected behaviour: the merge battery typechecks the whole tree. The merge is
 * the one chokepoint every branch passes through, and it runs in the main
 * checkout, which is the only tree where `tsc` resolves `veloqrs` to the module
 * a bundle would ship.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const battery = () => read('scripts/merge-gates.sh');

/** What a merge runs, whichever hook git hands it. */
const merge = () => read('.husky/pre-merge-commit') + battery();

describe('a merge cannot carry a type error', () => {
  it('typechecks the whole tree', () => {
    expect(merge()).toMatch(/tsc[^\n]*--noEmit/);
  });

  it('typechecks before it runs the suites, so it fails on the cheap check', () => {
    const text = battery();
    const typecheck = text.indexOf('tsc');
    const suites = text.indexOf('check-merge-tests.sh');
    expect(typecheck).toBeGreaterThan(-1);
    expect(suites).toBeGreaterThan(-1);
    expect(typecheck).toBeLessThan(suites);
  });

  it('cannot be skipped, since the merge is the only gate left', () => {
    expect(battery()).not.toMatch(/VELOQ_SKIP_GATES/);
  });
});

describe('the reason the merge battery is narrow', () => {
  /**
   * The battery said twice that its scope was narrow because it holds the build
   * lock. It does not: `merge-audit-branch.sh` takes the merge lock and nothing
   * else, and the android lock is taken by the build's own wrapper. A stale
   * reason is what keeps a gate out.
   */
  it('no longer claims the merge holds the build lock', () => {
    for (const path of [
      'scripts/merge-gates.sh',
      'scripts/check-merge-tests.sh',
      'scripts/lib/mergeTestTargets.ts',
    ]) {
      expect(read(path)).not.toMatch(/build lock/);
    }
  });

  it('is true of the merge script, which takes the merge lock alone', () => {
    const script = read('scripts/merge-audit-branch.sh');
    expect(script).toMatch(/veloq-merge\.lock/);
    expect(script).not.toMatch(/veloq-build\.lock/);
  });
});
