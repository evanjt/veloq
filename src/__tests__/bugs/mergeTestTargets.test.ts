/**
 * Scenario: a merge that does not conflict ran the lint ceiling and no tests,
 * and twice produced a tree neither branch wrote. Both instances were Rust, so
 * a TypeScript-only gate would have sat green through both.
 *
 * Expected behaviour: the merge runs the suites it touched, the hook says so,
 * and a merge touching nothing testable runs nothing.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { hasTargets, mergeTestTargets } from '../../../scripts/lib/mergeTestTargets';

const ROOT = join(__dirname, '../../..');
const CRATE = 'modules/veloqrs/rust/veloqrs';

describe('which suites a merge runs', () => {
  it('names the Rust suite whose own file the merge touched', () => {
    const targets = mergeTestTargets([`${CRATE}/tests/lap_time_backfill_scope.rs`]);

    expect(targets.rustTests).toEqual(['lap_time_backfill_scope']);
  });

  it('runs the crate unit tests when a source file moved', () => {
    const targets = mergeTestTargets([`${CRATE}/src/persistence/wellness.rs`]);

    expect(targets.rustLib).toBe(true);
    expect(targets.rustTests).toEqual([]);
  });

  it('takes a helper under tests/ as no suite of its own', () => {
    const targets = mergeTestTargets([`${CRATE}/tests/lifecycle_support/mod.rs`]);

    expect(targets.rustTests).toEqual([]);
  });

  it('hands the changed TypeScript to jest and nothing generated', () => {
    const targets = mergeTestTargets([
      'src/features/home/lib/widgetSnapshot.ts',
      'modules/veloqrs/src/generated/veloqrs.ts',
      'src/features/routes/components/SectionsList.tsx',
    ]);

    expect(targets.typescript).toEqual([
      'src/features/home/lib/widgetSnapshot.ts',
      'src/features/routes/components/SectionsList.tsx',
    ]);
  });

  it('has nothing to run for a merge of documents alone', () => {
    const targets = mergeTestTargets(['README.md', 'fastlane/metadata/en-AU/changelogs/29.txt']);

    expect(hasTargets(targets)).toBe(false);
  });

  it('lists each suite once however many of its files moved', () => {
    const targets = mergeTestTargets([
      `${CRATE}/tests/cutover.rs`,
      `${CRATE}/tests/cutover.rs`,
      `${CRATE}/tests/section_history.rs`,
    ]);

    expect(targets.rustTests).toEqual(['cutover', 'section_history']);
  });
});

describe('the merge hook', () => {
  const hook = readFileSync(join(ROOT, '.husky', 'pre-merge-commit'), 'utf8');

  it('runs the suites the merge touched', () => {
    expect(hook).toMatch(/check-merge-tests/);
  });

  it('still holds the lint ceiling it was written for', () => {
    expect(hook).toMatch(/npm run lint\b/);
  });

  it('fails the merge rather than reporting and continuing', () => {
    expect(hook).toMatch(/^set -e$/m);
  });
});
