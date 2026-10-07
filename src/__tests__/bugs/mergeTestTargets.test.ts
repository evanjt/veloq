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
  type Corpora,
} from '../../../scripts/lib/mergeTestTargets';

const ROOT = join(__dirname, '../../..');
const CRATE = 'modules/veloqrs/rust/veloqrs';
const NO_CORPORA: Corpora = {};

describe('which suites a merge runs', () => {
  it('names the grouped Rust suite whose source file the merge touched', () => {
    const targets = mergeTestTargets([`${CRATE}/tests/lap_time_backfill_scope.rs`]);

    expect(targets.rustTests).toEqual(['app', 'feature_gates']);
  });

  // The layout guards read every test source: a file no target owns, a stanza
  // with no recorded reason, a test reaching the engine without its binary's
  // serial guard. Edited alone, a test file can break them and nothing else
  // planned would run them.
  // The area-binary engine guard reads the crate's engine entry points by
  // name. A file that defines one is the change that can make that list stale.
  it('plans the test layout guards for a source file that defines an engine entry point', () => {
    const lifecycle = mergeTestTargets([`${CRATE}/src/persistence/mod.rs`]);
    const guardedReader = mergeTestTargets([`${CRATE}/src/objects/error.rs`]);
    const unrelated = mergeTestTargets([`${CRATE}/src/persistence/wellness.rs`]);

    expect(lifecycle.rustTests).toContain('feature_gates');
    expect(guardedReader.rustTests).toContain('feature_gates');
    expect(unrelated.rustTests).not.toContain('feature_gates');
  });

  it('plans the test layout guards for any changed test source, and only for those', () => {
    const changedTest = mergeTestTargets([`${CRATE}/tests/named_corridor_first_read.rs`]);
    const newUnownedTest = mergeTestTargets([`${CRATE}/tests/a_file_no_target_owns.rs`]);
    const helper = mergeTestTargets([`${CRATE}/tests/lifecycle_support/mod.rs`]);
    const fixture = mergeTestTargets([`${CRATE}/tests/fixtures/heatmap_parity_v1.txt`]);
    const source = mergeTestTargets([`${CRATE}/src/persistence/wellness.rs`]);

    expect(changedTest.rustTests).toEqual(['feature_gates', 'preview']);
    expect(newUnownedTest.rustTests).toEqual(['feature_gates']);
    expect(helper.rustTests).toContain('feature_gates');
    expect(fixture.rustTests).not.toContain('feature_gates');
    expect(source.rustTests).not.toContain('feature_gates');
  });

  it('runs the crate unit tests when a source file moved', () => {
    const targets = mergeTestTargets([`${CRATE}/src/persistence/wellness.rs`]);

    expect(targets.rustLib).toBe(true);
    expect(targets.rustTests).toEqual([]);
  });

  it('runs manifest readers and unit tests when the crate manifest changes', () => {
    const targets = mergeTestTargets([`${CRATE}/Cargo.toml`]);

    expect(targets.rustLib).toBe(true);
    expect(targets.rustTests).toEqual(['app', 'feature_gates']);
  });

  it('plans the area suite for a changed standalone Rust test source', () => {
    const cases = [
      ['heatmap_idempotent', 'heatmap_synthetic'],
      ['heatmap_work_is_cancellable', 'heatmap_synthetic'],
      ['migration_from_released_v12', 'migration'],
      ['preview_current', 'preview'],
      ['detection_seconds_wired', 'detection_global'],
    ];

    for (const [source, suite] of cases) {
      expect(mergeTestTargets([`${CRATE}/tests/${source}.rs`]).rustTests).toContain(suite);
    }
  });

  it('plans existing area suites for their newly included test sources', () => {
    const cases = [
      ['basemap_tilejson', 'app'],
      ['engine_init_failover', 'persistence'],
      ['detection_determinism', 'detection_synthetic'],
      ['section_filter_one_call', 'section'],
      ['suite2_concurrency_durability', 'suite2'],
    ];

    for (const [source, suite] of cases) {
      expect(mergeTestTargets([`${CRATE}/tests/${source}.rs`]).rustTests).toContain(suite);
    }
  });

  it('keeps push engine tests in their own process targets', () => {
    for (const source of ['push_engine_corrupt', 'push_engine_open', 'push_service_extension']) {
      expect(mergeTestTargets([`${CRATE}/tests/${source}.rs`]).rustTests).toEqual([
        'feature_gates',
        source,
      ]);
    }
  });

  it('plans the preview area for the signature cache assertion it gathers', () => {
    expect(
      mergeTestTargets([`${CRATE}/tests/grouping_preview_signature_cache.rs`]).rustTests
    ).toEqual(['feature_gates', 'preview']);
  });

  it('plans consumers of a helper without inventing a helper target', () => {
    const targets = mergeTestTargets([`${CRATE}/tests/lifecycle_support/mod.rs`]);

    expect(targets.rustTests).toEqual(expect.arrayContaining(['app_synthetic', 'suite2']));
    expect(targets.rustTests).not.toContain('lifecycle_support');
  });

  it('names the grouped suite a module under its own directory belongs to', () => {
    const targets = mergeTestTargets([
      `${CRATE}/tests/wellness/summary.rs`,
      `${CRATE}/tests/wellness/main.rs`,
    ]);

    expect(targets.rustTests).toEqual(['feature_gates', 'wellness']);
  });

  it('names a directory suite for its main and its helper alike', () => {
    const targets = mergeTestTargets([`${CRATE}/tests/migration_support/mod.rs`]);

    expect(targets.rustTests).toEqual([
      'app',
      'feature_gates',
      'migration',
      'persistence',
      'section',
    ]);
  });

  it('runs every schema suite that includes a changed shared module', () => {
    const targets = mergeTestTargets([`${CRATE}/tests/migration_support/mod.rs`]);

    expect(targets.rustTests).toContain('migration');
  });

  it('runs suites that include a changed released database fixture', () => {
    const targets = mergeTestTargets([`${CRATE}/tests/fixtures/v12_demo.sql`]);

    expect(targets.rustTests).toContain('migration');
    expect(targets.rustTests).toContain('persistence');
  });

  it('runs suites that load a changed fixture at runtime', () => {
    const checksums = mergeTestTargets([`${CRATE}/tests/fixtures/migration_checksums.txt`]);
    const heatmap = mergeTestTargets([`${CRATE}/tests/fixtures/heatmap_parity_v1.txt`]);

    expect(checksums.rustTests).toContain('migration');
    expect(heatmap.rustTests).toContain('heatmap_synthetic');
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

    expect(targets.rustTests).toEqual(['detection_global', 'feature_gates', 'section_synthetic']);
  });
});

describe('the commands a merge runs', () => {
  // A test source edited alone plans the layout guards and nothing it cannot run.
  const LAYOUT_ONLY =
    'cargo test --manifest-path modules/veloqrs/rust/veloqrs/Cargo.toml -p veloqrs --features synthetic --test feature_gates';

  // tracematch gates `fold_resume` and its other synthetic suites on the
  // feature, and cargo skips an unnamed suite whose features are absent
  // rather than failing, so a plain run passes with those suites never built.
  it('runs the tracematch crate against its own manifest', () => {
    const commands = mergeTestCommands(
      mergeTestTargets(['modules/veloqrs/rust/tracematch']),
      NO_CORPORA
    );

    expect(commands).toEqual([
      'cargo test --manifest-path modules/veloqrs/rust/tracematch/Cargo.toml -p tracematch --features synthetic',
      expect.stringMatching(/^echo .*LAB_GEOLIFE_DIR/),
      expect.stringMatching(/^echo .*TRACEMATCH_CORPUS/),
    ]);
  });

  describe('the bitwise gates on a pointer bump', () => {
    const TM = 'modules/veloqrs/rust/tracematch';
    const SYNTHETIC = `cargo test --manifest-path ${TM}/Cargo.toml -p tracematch --features synthetic`;
    const GEOLIFE = `LAB_GEOLIFE_DIR='/data/geolife' cargo test --release --manifest-path ${TM}/Cargo.toml --features public-corpus --test geolife_bitwise`;
    const PRIVATE = `TRACEMATCH_CORPUS='/data/private' cargo test --release --manifest-path ${TM}/Cargo.toml --features real-corpus --test full_corpus_bitwise`;

    it('runs both golden comparisons when both corpora are present', () => {
      const commands = mergeTestCommands(mergeTestTargets([TM]), {
        geolife: '/data/geolife',
        private: '/data/private',
      });

      expect(commands).toEqual([SYNTHETIC, GEOLIFE, PRIVATE]);
    });

    it('prints one skip line per absent corpus and never a failing command', () => {
      const commands = mergeTestCommands(mergeTestTargets([TM]), NO_CORPORA);

      expect(commands).toEqual([
        SYNTHETIC,
        expect.stringMatching(/^echo .*LAB_GEOLIFE_DIR/),
        expect.stringMatching(/^echo .*TRACEMATCH_CORPUS/),
      ]);
      expect(commands.some((c) => c.includes('--features public-corpus'))).toBe(false);
      expect(commands.some((c) => c.includes('--features real-corpus'))).toBe(false);
    });

    it('runs only the corpus that is present', () => {
      const commands = mergeTestCommands(mergeTestTargets([TM]), { geolife: '/data/geolife' });

      expect(commands).toEqual([
        SYNTHETIC,
        GEOLIFE,
        expect.stringMatching(/^echo .*TRACEMATCH_CORPUS/),
      ]);
    });

    it('emits neither gate nor skip line when the pointer does not move', () => {
      const commands = mergeTestCommands(
        mergeTestTargets([`${CRATE}/src/persistence/wellness.rs`]),
        {
          geolife: '/data/geolife',
          private: '/data/private',
        }
      );

      expect(commands.join('\n')).not.toMatch(/bitwise|LAB_GEOLIFE_DIR|TRACEMATCH_CORPUS/);
    });
  });

  it('runs both crates when a merge moves the pointer and the parent source', () => {
    const commands = mergeTestCommands(
      mergeTestTargets(['modules/veloqrs/rust/tracematch', `${CRATE}/src/persistence/wellness.rs`]),
      NO_CORPORA
    );

    expect(commands).toEqual([
      'cargo test --manifest-path modules/veloqrs/rust/veloqrs/Cargo.toml -p veloqrs --features synthetic --lib',
      'cargo test --manifest-path modules/veloqrs/rust/tracematch/Cargo.toml -p tracematch --features synthetic',
      expect.stringMatching(/^echo .*LAB_GEOLIFE_DIR/),
      expect.stringMatching(/^echo .*TRACEMATCH_CORPUS/),
    ]);
  });

  it('has no commands for a merge of documents alone', () => {
    expect(mergeTestCommands(mergeTestTargets(['README.md']))).toEqual([]);
  });

  // Cargo refuses a gated suite named without its required feature.
  it('runs the crate with the feature its gated suites require', () => {
    const [command] = mergeTestCommands(
      mergeTestTargets([`${CRATE}/tests/suite2_cache_coherence.rs`])
    );

    expect(command).toBe(
      'cargo test --manifest-path modules/veloqrs/rust/veloqrs/Cargo.toml -p veloqrs --features synthetic --test feature_gates --test suite2'
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
      const commands = mergeTestCommands(
        mergeTestTargets([`${CRATE}/tests/corpus_preview_identity.rs`])
      );

      expect(commands).toEqual([LAYOUT_ONLY]);
    });

    it('does not take the suites beside it down with it', () => {
      const [command] = mergeTestCommands(
        mergeTestTargets([
          `${CRATE}/tests/corpus_migration.rs`,
          `${CRATE}/tests/suite2_cache_coherence.rs`,
        ])
      );

      expect(command).toContain('--test suite2');
      expect(command).not.toContain('corpus_migration');
    });

    it('reads the features from Cargo.toml rather than a second list of names', () => {
      const manifest = readFileSync(join(ROOT, CRATE, 'Cargo.toml'), 'utf8');
      const gated = Array.from(
        manifest.matchAll(
          /\[\[test\]\]\s*\nname = "([^"]+)"\s*\npath = "[^"]+"\s*\nrequired-features = \[([^\]]*)\]/g
        )
      ).filter(([, , features]) => !features.includes('synthetic'));

      expect(gated.length).toBeGreaterThan(0);
      for (const [, name] of gated) {
        const commands = mergeTestCommands(mergeTestTargets([`${CRATE}/tests/${name}.rs`]));
        expect(commands).toEqual([LAYOUT_ONLY]);
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

      const report = join(root, 'failed-gate');

      const result = spawnSync('sh', ['scripts/merge-gates.sh'], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${join(root, 'bin')}:${process.env.PATH}`,
          VELOQ_GATE_REPORT: report,
        },
        encoding: 'utf8',
      });

      expect(result.status).not.toBe(0);
      expect(existsSync(join(root, 'second-gate-ran'))).toBe(false);
      // The lander reads the name back to ask whether its target fails the same gate.
      expect(readFileSync(report, 'utf8').trim()).toBe('lint');
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
  const SCHEMA_SOURCES = [
    'migration_checksums',
    'migration_from_released_v12',
    'migration_upgrade',
    'migration_v02x_to_current',
    'schema_golden',
    'schema_overstated_version',
    'schema_version_divergence',
  ];
  const SCHEMA_SUITES = ['migration'];

  it('runs on a new migration', () => {
    const targets = mergeTestTargets([`${CRATE}/src/migrations/029_stream_backfill.sql`]);

    expect(targets.rustTests).toEqual(SCHEMA_SUITES);
  });

  it('runs on an edit to an already-applied migration, which splits the installed base', () => {
    const targets = mergeTestTargets([`${CRATE}/src/migrations/012_sections.sql`]);

    expect(targets.rustTests).toContain('migration');
  });

  it('runs when the schema itself moves', () => {
    const targets = mergeTestTargets([`${CRATE}/src/persistence/schema.rs`]);

    expect(targets.rustTests).toEqual(SCHEMA_SUITES);
    expect(targets.rustLib).toBe(true);
  });

  it('runs on a fixture the golden reads', () => {
    const targets = mergeTestTargets([`${CRATE}/tests/fixtures/schema/v28_fresh.txt`]);

    expect(targets.rustTests).toContain('migration');
  });

  it('names each suite once when the migration and the schema both moved', () => {
    const targets = mergeTestTargets([
      `${CRATE}/src/migrations/029_stream_backfill.sql`,
      `${CRATE}/src/persistence/schema.rs`,
      `${CRATE}/tests/schema_golden.rs`,
    ]);

    expect(targets.rustTests).toEqual(['feature_gates', ...SCHEMA_SUITES]);
  });

  it('leaves an ordinary source change alone', () => {
    const targets = mergeTestTargets([`${CRATE}/src/persistence/wellness.rs`]);

    expect(targets.rustTests).toEqual([]);
  });

  it('plans the grouped suite from every schema test source', () => {
    for (const source of SCHEMA_SOURCES) {
      expect(existsSync(join(ROOT, CRATE, 'tests', `${source}.rs`))).toBe(true);
      expect(mergeTestTargets([`${CRATE}/tests/${source}.rs`]).rustTests).toEqual([
        'feature_gates',
        ...SCHEMA_SUITES,
      ]);
    }
  });
});
