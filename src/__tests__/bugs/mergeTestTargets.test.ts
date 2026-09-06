/**
 * Scenario: a merge that does not conflict ran the lint ceiling and no tests,
 * and twice produced a tree neither branch wrote. Both instances were Rust, so
 * a TypeScript-only gate would have sat green through both.
 *
 * Expected behaviour: the merge runs the suites it touched, the hook says so,
 * and a merge touching nothing testable runs nothing.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import {
  hasTargets,
  mergeTestCommands,
  mergeTestTargets,
} from '../../../scripts/lib/mergeTestTargets';

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

  it('runs the tracematch suite when its pointer moves', () => {
    const targets = mergeTestTargets(['modules/veloqrs/rust/tracematch']);

    expect(targets.tracematchLib).toBe(true);
    expect(targets.rustLib).toBe(false);
  });

  it('runs the tracematch suite for a path inside the submodule', () => {
    const targets = mergeTestTargets([
      'modules/veloqrs/rust/tracematch/src/sections/unified.rs',
      'modules/veloqrs/rust/tracematch/tests/geolife_public_corpus.rs',
    ]);

    expect(targets.tracematchLib).toBe(true);
  });

  it('leaves tracematch alone for a merge that only moves the parent crate', () => {
    const targets = mergeTestTargets([`${CRATE}/src/persistence/wellness.rs`]);

    expect(targets.tracematchLib).toBe(false);
  });

  it('counts a tracematch pointer bump as something to run', () => {
    expect(hasTargets(mergeTestTargets(['modules/veloqrs/rust/tracematch']))).toBe(true);
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

describe('the commands a merge runs', () => {
  it('runs the tracematch crate against its own manifest', () => {
    const commands = mergeTestCommands(mergeTestTargets(['modules/veloqrs/rust/tracematch']));

    expect(commands).toEqual([
      'cargo test --manifest-path modules/veloqrs/rust/tracematch/Cargo.toml -p tracematch',
    ]);
  });

  it('runs both crates when a merge moves the pointer and the parent source', () => {
    const commands = mergeTestCommands(
      mergeTestTargets(['modules/veloqrs/rust/tracematch', `${CRATE}/src/persistence/wellness.rs`])
    );

    expect(commands).toEqual([
      'cargo test --manifest-path modules/veloqrs/rust/veloqrs/Cargo.toml -p veloqrs --features synthetic --lib',
      'cargo test --manifest-path modules/veloqrs/rust/tracematch/Cargo.toml -p tracematch',
    ]);
  });

  it('has no commands for a merge of documents alone', () => {
    expect(mergeTestCommands(mergeTestTargets(['README.md']))).toEqual([]);
  });

  // Sixty of the crate's suites carry `required-features = ["synthetic"]`,
  // and cargo refuses a `--test` naming one without the feature rather than
  // skipping it. The feature is additive and it is the lane CI runs, so every
  // veloqrs command carries it.
  it('runs the crate with the feature its gated suites require', () => {
    const [command] = mergeTestCommands(
      mergeTestTargets([`${CRATE}/tests/suite2_cache_coherence.rs`])
    );

    expect(command).toBe(
      'cargo test --manifest-path modules/veloqrs/rust/veloqrs/Cargo.toml -p veloqrs --features synthetic --test suite2_cache_coherence'
    );
  });

  it('carries the feature for the unit tests too, so one lane serves both', () => {
    const [command] = mergeTestCommands(mergeTestTargets([`${CRATE}/src/persistence/wellness.rs`]));

    expect(command).toContain('--features synthetic');
  });

  // The hook runs the line through `eval`, and every tab screen lives under
  // `src/app/(tabs)/`, so an unquoted path is a merge that cannot land.
  it.each([
    'src/app/(tabs)/map.tsx',
    'src/app/a space/screen.tsx',
    "src/app/it's/screen.tsx",
    'src/shared/app/period.ts',
  ])('hands %s to jest as one word the shell accepts', (path) => {
    const [command] = mergeTestCommands(mergeTestTargets([path]));

    const words = execFileSync('sh', [
      '-c',
      `set -- ${command.replace(/^npx jest .*?--passWithNoTests /, '')}; printf '%s\\n' "$@"`,
    ])
      .toString()
      .split('\n')
      .filter(Boolean);
    expect(words).toEqual([path]);
  });
});

describe('the merge hook', () => {
  const hook = readFileSync(join(ROOT, '.husky', 'pre-merge-commit'), 'utf8');

  it('runs the suites the merge touched', () => {
    expect(hook).toMatch(/check-merge-tests/);
  });

  it('runs the whole-tree guards, which a worktree commit never did', () => {
    expect(hook).toMatch(/npm run audit\b/);
  });

  it('runs them before the suites, so the cheap check fails first', () => {
    expect(hook.indexOf('npm run audit')).toBeLessThan(hook.indexOf('check-merge-tests'));
  });

  it('still holds the lint ceiling it was written for', () => {
    expect(hook).toMatch(/npm run lint\b/);
  });

  it('fails the merge rather than reporting and continuing', () => {
    expect(hook).toMatch(/^set -e$/m);
  });
});
