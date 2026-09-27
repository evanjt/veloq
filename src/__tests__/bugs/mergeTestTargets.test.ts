/**
 * Scenario: a merge that does not conflict ran the lint ceiling and no tests,
 * and twice produced a tree neither branch wrote. Both instances were Rust, so
 * a TypeScript-only gate would have sat green through both.
 *
 * Expected behaviour: the merge runs the suites it touched, the hook says so,
 * and a merge touching nothing testable runs nothing.
 */

import { spawnSync, execFileSync } from 'node:child_process';
import {
  chmodSync,
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

  it('names the grouped suite a module under its own directory belongs to', () => {
    const targets = mergeTestTargets([
      `${CRATE}/tests/wellness/summary.rs`,
      `${CRATE}/tests/wellness/main.rs`,
    ]);

    expect(targets.rustTests).toEqual(['wellness']);
  });

  it('names a directory suite for its main and its helper alike', () => {
    const targets = mergeTestTargets([`${CRATE}/tests/migration_support/mod.rs`]);

    expect(targets.rustTests).toEqual(['migration_support']);
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
  // tracematch gates `fold_resume` and its other synthetic suites on the
  // feature, and cargo skips an unnamed suite whose features are absent
  // rather than failing, so a plain run passes with those suites never built.
  it('runs the tracematch crate against its own manifest', () => {
    const commands = mergeTestCommands(mergeTestTargets(['modules/veloqrs/rust/tracematch']));

    expect(commands).toEqual([
      'cargo test --manifest-path modules/veloqrs/rust/tracematch/Cargo.toml -p tracematch --features synthetic',
    ]);
  });

  it('runs both crates when a merge moves the pointer and the parent source', () => {
    const commands = mergeTestCommands(
      mergeTestTargets(['modules/veloqrs/rust/tracematch', `${CRATE}/src/persistence/wellness.rs`])
    );

    expect(commands).toEqual([
      'cargo test --manifest-path modules/veloqrs/rust/veloqrs/Cargo.toml -p veloqrs --features synthetic --lib',
      'cargo test --manifest-path modules/veloqrs/rust/tracematch/Cargo.toml -p tracematch --features synthetic',
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

  /// Scenario: a merge edits one of the two suites gated on `real-corpus`.
  /// Named under `--features synthetic`, cargo refuses the whole command and
  /// the merge is left staged in the shared checkout with `MERGE_HEAD` set,
  /// for a reason that has nothing to do with the change.
  describe('a suite gated on a feature the merge lane cannot supply', () => {
    it('is left out of the command rather than naming it under the wrong feature', () => {
      const [command] = mergeTestCommands(
        mergeTestTargets([`${CRATE}/tests/corpus_preview_identity.rs`])
      );

      expect(command).toBeUndefined();
    });

    it('does not take the suites beside it down with it', () => {
      const [command] = mergeTestCommands(
        mergeTestTargets([
          `${CRATE}/tests/corpus_migration.rs`,
          `${CRATE}/tests/suite2_cache_coherence.rs`,
        ])
      );

      expect(command).toContain('--test suite2_cache_coherence');
      expect(command).not.toContain('corpus_migration');
    });

    it('reads the features from Cargo.toml rather than a second list of names', () => {
      const manifest = readFileSync(join(ROOT, CRATE, 'Cargo.toml'), 'utf8');
      const gated = Array.from(
        manifest.matchAll(/\[\[test\]\]\s*\nname = "([^"]+)"\s*\nrequired-features = \[([^\]]*)\]/g)
      ).filter(([, , features]) => !features.includes('synthetic'));

      expect(gated.length).toBeGreaterThan(0);
      for (const [, name] of gated) {
        const [command] = mergeTestCommands(mergeTestTargets([`${CRATE}/tests/${name}.rs`]));
        expect(command).toBeUndefined();
      }
    });
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
  const hook =
    readFileSync(join(ROOT, '.husky', 'pre-merge-commit'), 'utf8') +
    readFileSync(join(ROOT, 'scripts/merge-gates.sh'), 'utf8');

  // Command lines only: the prose in the battery names every gate it replaced,
  // so a match anywhere in the file passes with the gate itself deleted.
  const commands = hook
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  it('runs the suites the merge touched', () => {
    expect(commands).toContain('./scripts/check-merge-tests.sh');
  });

  it('holds the lint ceiling it was written for', () => {
    expect(commands).toContain('./scripts/check-merge-lint.sh');
  });

  it('runs the whole-tree guards, which a worktree commit never did', () => {
    expect(commands).toContain('npm run audit:guards');
  });

  it('runs the lint and the guards before the suites, so the cheap check fails first', () => {
    const suites = commands.indexOf('./scripts/check-merge-tests.sh');
    const lint = commands.indexOf('./scripts/check-merge-lint.sh');
    const guards = commands.indexOf('npm run audit:guards');

    // An absent gate indexes at -1, which is before everything.
    expect(Math.min(lint, guards)).toBeGreaterThan(-1);
    expect(lint).toBeLessThan(suites);
    expect(guards).toBeLessThan(suites);
  });

  it('stops at the first gate that fails rather than reporting and continuing', () => {
    const root = mkdtempSync(join(tmpdir(), 'merge-battery-'));
    try {
      mkdirSync(join(root, 'scripts'));
      mkdirSync(join(root, 'bin'));
      copyFileSync(join(ROOT, 'scripts/merge-gates.sh'), join(root, 'scripts/merge-gates.sh'));
      const stub = (path: string, body: string) => {
        writeFileSync(join(root, path), `#!/bin/sh\n${body}\n`);
        chmodSync(join(root, path), 0o755);
      };
      stub('scripts/check-merge-lint.sh', 'exit 1');
      // The second gate is `npx tsc`, so an `npx` that leaves a mark says it ran.
      stub('bin/npx', `touch "${join(root, 'second-gate-ran')}"`);

      const result = spawnSync('sh', ['scripts/merge-gates.sh'], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${join(root, 'bin')}:${process.env.PATH}`,
          VELOQ_MERGE_LOCK_HELD: '1',
        },
        encoding: 'utf8',
      });

      expect(result.status).not.toBe(0);
      expect(existsSync(join(root, 'second-gate-ran'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * Scenario: a merge adds `src/migrations/029_*.sql` and edits
 * `persistence/schema.rs`. Neither path is under `tests/`, so the plan named
 * `--lib` and nothing else, and the golden whose job is to catch a schema
 * change shipping without a migration was the one gate a schema change could
 * not fire. It has happened: a column was added to `gps_tracks` without
 * regenerating the fresh-install fixture, and the golden stayed red on the
 * integration branch until someone ran the suite for another reason.
 */
describe('the schema gates', () => {
  const SCHEMA_SUITES = ['migration_checksums', 'migration_upgrade', 'schema_golden'];

  it('runs on a new migration', () => {
    const targets = mergeTestTargets([`${CRATE}/src/migrations/029_stream_backfill.sql`]);

    expect(targets.rustTests).toEqual(SCHEMA_SUITES);
  });

  it('runs on an edit to an already-applied migration, which splits the installed base', () => {
    const targets = mergeTestTargets([`${CRATE}/src/migrations/012_sections.sql`]);

    expect(targets.rustTests).toContain('migration_checksums');
  });

  it('runs when the schema itself moves', () => {
    const targets = mergeTestTargets([`${CRATE}/src/persistence/schema.rs`]);

    expect(targets.rustTests).toEqual(SCHEMA_SUITES);
    expect(targets.rustLib).toBe(true);
  });

  it('runs on a fixture the golden reads', () => {
    const targets = mergeTestTargets([`${CRATE}/tests/fixtures/schema/v28_fresh.txt`]);

    expect(targets.rustTests).toContain('schema_golden');
  });

  it('names each suite once when the migration and the schema both moved', () => {
    const targets = mergeTestTargets([
      `${CRATE}/src/migrations/029_stream_backfill.sql`,
      `${CRATE}/src/persistence/schema.rs`,
      `${CRATE}/tests/schema_golden.rs`,
    ]);

    expect(targets.rustTests).toEqual(SCHEMA_SUITES);
  });

  it('leaves an ordinary source change alone', () => {
    const targets = mergeTestTargets([`${CRATE}/src/persistence/wellness.rs`]);

    expect(targets.rustTests).toEqual([]);
  });

  it('names suites that exist in the crate', () => {
    for (const suite of SCHEMA_SUITES) {
      expect(existsSync(join(ROOT, CRATE, 'tests', `${suite}.rs`))).toBe(true);
    }
  });
});
