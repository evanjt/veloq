/**
 * Scenario: every worktree merges through one checkout, and a whole-tree guard
 * that walks the disk judges whichever session has a file open there. An unsaved
 * literal in another session's file failed a landing that never touched it.
 *
 * Expected behaviour: with a clean file in the index and a violation only in the
 * working copy, the guard passes. The same violation staged fails it.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { gitFreeEnv, initFixtureRepo, runGit } from '../__shared__/gitFixture';

const SCRIPTS = join(__dirname, '../../../scripts');

interface Case {
  guard: string;
  /** Tracked files that make the fixture a complete clean tree. */
  tree: Record<string, string>;
  /** The one file the violation lands in. */
  target: string;
  clean: string;
  violation: string;
  args?: string[];
  baseline?: boolean;
}

// Assembled so the child-spawn scan in the git-fixture guard does not read these Rust fixtures as calls.
const BARE_SPAWN = ['std::thread::sp', 'awn(|| {})'].join('');

const JEST_SETUP = "require('./jest.tempDirs');\nafterAll(() => {\n  tracker.removeAll();\n});\n";

const CASES: Record<string, Case> = {
  'lint-rgba-literals': {
    guard: 'lint-rgba-literals.mjs',
    tree: {},
    target: 'src/a.ts',
    clean: 'export const a = 1;\n',
    violation: "export const a = 'rgba(0,0,0,0.5)';\n",
    baseline: true,
  },
  'lint-hand-rolled-buttons': {
    guard: 'lint-hand-rolled-buttons.mjs',
    tree: {},
    target: 'src/a.tsx',
    clean: 'export const a = 1;\n',
    violation: 'export const a = <Pressable onPress={f} />;\n',
    baseline: true,
  },
  'lint-engine-write-lock': {
    guard: 'lint-engine-write-lock.mjs',
    tree: {},
    target: 'modules/veloqrs/rust/veloqrs/src/a.rs',
    clean: 'fn a() {}\n',
    violation: 'fn a() { with_engine(|e| e.go()); }\n',
    baseline: true,
  },
  'lint-feature-imports': {
    guard: 'lint-feature-imports.mjs',
    tree: { 'src/features/b/deep/y.ts': 'export const y = 1;\n' },
    target: 'src/features/a/x.ts',
    clean: 'export const x = 1;\n',
    violation: "import { y } from '@/features/b/deep/y';\nexport const x = y;\n",
    baseline: true,
  },
  'lint-detect-recv': {
    guard: 'lint-detect-recv.mjs',
    tree: {},
    target: 'modules/veloqrs/rust/veloqrs/src/a.rs',
    clean: 'fn a() {}\n',
    violation: 'fn a() { let r = rx.recv().unwrap_or_default(); }\n',
  },
  'lint-bare-thread-spawn': {
    guard: 'lint-bare-thread-spawn.mjs',
    tree: {},
    target: 'modules/veloqrs/rust/veloqrs/src/a.rs',
    clean: `fn a() { crate::threads::spawn_named("veloq-a", || {}); }\n#[cfg(test)]\nmod tests {\n    fn t() { ${BARE_SPAWN}; }\n}\n`,
    violation: `fn a() { ${BARE_SPAWN}; }\n`,
  },
  'lint-point-shapes': {
    guard: 'lint-point-shapes.mjs',
    tree: {},
    target: 'src/features/a/Card.tsx',
    clean: "import type { LatLng } from '@/shared/geo/polyline';\n",
    violation: 'interface LatLng {\n  latitude: number;\n  longitude: number;\n}\n',
  },
  'lint-one-observer-vtable': {
    guard: 'lint-one-observer-vtable.mjs',
    tree: {},
    target: 'ios/Engine.swift',
    clean: 'let a = 1\n',
    violation: 'init_callback_vtable_engineobserver()\n',
  },
  'lint-verdict-palette': {
    guard: 'lint-verdict-palette.mjs',
    tree: {},
    target: 'src/a.ts',
    clean: 'export const a = 1;\n',
    violation: 'export const a = insightIcon.positive;\n',
  },
  'lint-window-dimensions': {
    guard: 'lint-window-dimensions.mjs',
    tree: {},
    target: 'src/a.ts',
    clean: 'export const a = 1;\n',
    violation: "export const a = Dimensions.get('window');\n",
  },
  'lint-test-temp-dirs': {
    guard: 'lint-test-temp-dirs.mjs',
    tree: { 'config/jest.setup.js': JEST_SETUP },
    target: 'src/a.test.ts',
    clean: 'it("a", () => {});\n',
    violation: `const dir = run("${'mk'}temp -d");\n`,
  },
  'lint-ffi-bigint': {
    guard: 'lint-ffi-bigint.mjs',
    tree: {},
    target: 'modules/veloqrs/src/generated/veloqrs.ts',
    clean: 'export type Record = {\n  count: number;\n};\n',
    violation: 'export type Record = {\n  count: /*i64*/ bigint;\n};\n',
  },
  'lint-setting-keys': {
    guard: 'lint-setting-keys.mjs',
    tree: {
      'src/shared/storage/migrateSettingsToSqlite.ts':
        "export const PREFERENCE_KEYS = ['known'];\n",
    },
    target: 'src/a.ts',
    clean: 'export const a = 1;\n',
    violation:
      "declare function setSetting(key: string, value: string): void;\nsetSetting('unlisted', 'x');\n",
  },
  'lint-rust-test-serial': {
    guard: 'lint-rust-test-serial.mjs',
    tree: {},
    target: 'modules/veloqrs/rust/veloqrs/src/a.rs',
    clean: '#[test]\nfn a() { let _s = serial_global_state(); engine_install(); }\n',
    violation: '#[test]\nfn a() { engine_install(); }\n',
  },
  'lint-rust-manifests': {
    guard: 'lint-rust-manifests.mjs',
    tree: {
      'modules/veloqrs/rust/Cargo.toml':
        '[workspace]\nmembers = ["veloqrs"]\n\n[profile.release]\nlto = true\ncodegen-units = 1\n',
      'modules/veloqrs/rust/veloqrs/Cargo.toml':
        '[package]\nname = "veloqrs"\nautotests = false\n\n[[test]]\nname = "a"\npath = "tests/a.rs"\n',
    },
    target: 'modules/veloqrs/rust/veloqrs/tests/a.rs',
    clean: '#[test]\nfn t() {}\n',
    violation: '#![cfg(feature = "synthetic")]\n\n#[test]\nfn t() {}\n',
  },
  'lint-generated-typechecked': {
    guard: 'lint-generated-typechecked.mjs',
    tree: {},
    target: 'modules/veloqrs/src/generated/veloqrs.ts',
    clean: 'export const a = 1;\n',
    violation: '// @ts-nocheck\nexport const a = 1;\n',
  },
  'lint-bash-empty-arrays': {
    guard: 'lint-bash-empty-arrays.mjs',
    tree: {},
    target: '.maestro/run.sh',
    clean: 'set -u\necho ok\n',
    violation: 'set -u\necho "${items[@]}"\n',
  },
};

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function write(root: string, path: string, contents: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

function runGuard(root: string, spec: Case): number | null {
  const args = [join(SCRIPTS, spec.guard), '--root', root, ...(spec.args ?? [])];
  if (spec.baseline) args.push('--baseline', join(root, 'baseline.json'));
  return spawnSync('node', args, { cwd: root, env: gitFreeEnv(), encoding: 'utf8' }).status;
}

describe.each(Object.entries(CASES))('%s', (_name, spec) => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'whole-tree-guard-'));
    roots.push(root);
    for (const [path, contents] of Object.entries(spec.tree)) write(root, path, contents);
    write(root, spec.target, spec.clean);
    if (spec.baseline) write(root, 'baseline.json', '{}\n');
    initFixtureRepo(root);
  });

  it('passes over a clean index', () => {
    expect(runGuard(root, spec)).toBe(0);
  });

  it('ignores a violation that only the working copy holds', () => {
    write(root, spec.target, spec.violation);

    expect(runGuard(root, spec)).toBe(0);
  });

  it('fails the same violation once it is staged', () => {
    write(root, spec.target, spec.violation);
    runGit(['add', spec.target], root);

    expect(runGuard(root, spec)).not.toBe(0);
  });
});

/**
 * Scenario: the cases above are a hand-kept list, so a guard added after it
 * that walks the disk is never offered to it.
 *
 * Expected behaviour: every guard in the run list that is not an environment
 * check either reads through `scripts/lib/indexedSources.mjs` or says in its
 * own file why the disk is the right reader.
 */
const ON_PURPOSE = /on purpose/i;
const DISK_READ = /\b(readdirSync|readFileSync|globSync|opendirSync)\b/;

function guardScript(cmd: string[]): string | undefined {
  const direct = cmd.find((part) => /^scripts\/.*\.(mjs|js|ts|sh)$/.test(part));
  if (direct) return direct;
  const named = cmd.join(' ').match(/^npm run (?:--silent )?(\S+)$/)?.[1];
  if (!named) return undefined;
  const script: string = JSON.parse(readFileSync(join(SCRIPTS, '../package.json'), 'utf8')).scripts[
    named
  ];
  return script.match(/(scripts\/\S+\.(?:mjs|js|ts))/)?.[1];
}

describe('every guard in the run list', () => {
  const list: { name: string; kind: string; cmd: string[] }[] = JSON.parse(
    spawnSync('node', [join(SCRIPTS, 'run-guards.mjs'), '--list', '--json'], {
      env: gitFreeEnv(),
      encoding: 'utf8',
    }).stdout
  );

  it('names a script this check can read', () => {
    const unresolved = list.filter((g) => g.kind !== 'environment' && !guardScript(g.cmd));

    expect(unresolved.map((g) => g.name)).toEqual([]);
  });

  it('reads the index, or states why it reads the disk', () => {
    const offenders: string[] = [];
    for (const guard of list) {
      if (guard.kind === 'environment') continue;
      const script = guardScript(guard.cmd);
      if (!script) continue;
      const source = readFileSync(join(SCRIPTS, '..', script), 'utf8');
      if (!DISK_READ.test(source)) continue;
      if (source.includes('lib/indexedSources.mjs') || ON_PURPOSE.test(source)) continue;
      offenders.push(script);
    }

    expect(offenders).toEqual([]);
  });
});
