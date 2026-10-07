/**
 * Which suites a merge has to run, from the files it changes.
 *
 * A merge that does not conflict runs `pre-merge-commit`, which held the lint
 * ceiling and no tests at all. Twice that let through a tree neither branch
 * wrote: a reader change merged against a test written in parallel, and two
 * fixture edits each correct alone. Both were Rust, so a TypeScript-only gate
 * would have sat green through them.
 *
 * The whole suite is not the answer either. Every worktree merges into one
 * checkout, and the hook runs inside the merge, holding the merge lock, so a
 * three-and-a-half minute suite serialises every other session's merge behind
 * it. These are the targets the merge actually touched.
 */

const CRATE = 'modules/veloqrs/rust/veloqrs/';
const RUST_TEST_DIR = `${CRATE}tests/`;
const TRACEMATCH = 'modules/veloqrs/rust/tracematch';

/**
 * The one feature every command carries. It is additive and it is the lane CI
 * runs, so naming it costs the suites that do not need it nothing.
 */
const MERGE_FEATURE = 'synthetic';

/**
 * Suites whose `required-features` this lane cannot supply, read from the
 * manifest rather than written out here: a new `[[test]]` with a new feature
 * has to drop out of the plan on its own, not break the gate until somebody
 * adds it to a list.
 *
 * Today that is `real-corpus`, whose two suites need a corpus on disk that a
 * merge cannot assume exists. Cargo refuses a `--test` naming a suite whose
 * features are absent rather than skipping it, so one such name takes the
 * whole command down and the merge is left staged for a reason that has
 * nothing to do with the change. They are dropped, not run: do not add them
 * back by passing `--features real-corpus`.
 */
function unrunnableSuites(): Set<string> {
  return new Set(
    manifestTests()
      .filter(({ features }) => features.some((feature) => feature !== MERGE_FEATURE))
      .map(({ name }) => name)
  );
}

/**
 * Read once per process. The plan is built in one short-lived script, and the
 * manifest is the source of truth for what cargo will accept.
 */
let manifestCache: string | null = null;
function readManifest(): string {
  if (manifestCache === null) {
    // Resolved from this file rather than the working directory: the hook runs
    // from the repository root, the tests run from wherever jest was started.
    const path = require('node:path').join(__dirname, '../..', CRATE, 'Cargo.toml');
    manifestCache = require('node:fs').readFileSync(path, 'utf8') as string;
  }
  return manifestCache;
}

export interface MergeTargets {
  /** `cargo test -p veloqrs --test <name>` for each. */
  rustTests: string[];
  /** Whether the crate's own unit tests have to run. */
  rustLib: boolean;
  /** Whether the tracematch crate's suites have to run. */
  tracematchLib: boolean;
  /** TypeScript files to hand to `jest --findRelatedTests`. */
  typescript: string[];
}

interface ManifestTest {
  name: string;
  path: string;
  features: string[];
}

function manifestTests(): ManifestTest[] {
  return readManifest()
    .split('[[test]]')
    .slice(1)
    .map((stanza) => {
      const name = stanza.match(/^name = "([^"]+)"/m)?.[1];
      const path = stanza.match(/^path = "([^"]+)"/m)?.[1];
      const features = stanza.match(/^required-features = \[([^\]]*)\]/m)?.[1] ?? '';
      if (!name) return null;
      return {
        name,
        path: `${CRATE}${path ?? `tests/${name}.rs`}`,
        features: [...features.matchAll(/"([^"]+)"/g)].map((match) => match[1]),
      };
    })
    .filter((target): target is ManifestTest => target !== null);
}

function testRoots(): ManifestTest[] {
  const fs = require('node:fs');
  const path = require('node:path');
  const explicit = manifestTests();
  if (/^autotests\s*=\s*false\s*$/m.test(readManifest())) return explicit;
  const tests = path.join(__dirname, '../..', RUST_TEST_DIR);
  const discovered = (
    fs.readdirSync(tests, { withFileTypes: true }) as {
      name: string;
      isFile(): boolean;
      isDirectory(): boolean;
    }[]
  )
    .filter((entry) => entry.isFile() && entry.name.endsWith('.rs'))
    .map((entry) => ({
      name: entry.name.slice(0, -3),
      path: `${RUST_TEST_DIR}${entry.name}`,
      features: [],
    }));
  for (const entry of fs.readdirSync(tests, { withFileTypes: true })) {
    if (!entry.isDirectory() || !fs.existsSync(path.join(tests, entry.name, 'main.rs'))) continue;
    discovered.push({
      name: entry.name,
      path: `${RUST_TEST_DIR}${entry.name}/main.rs`,
      features: [],
    });
  }
  return [...new Map([...discovered, ...explicit].map((target) => [target.name, target])).values()];
}

function modulePaths(source: string, file: string): string[] {
  const fs = require('node:fs');
  const path = require('node:path').posix;
  const declarations = source.matchAll(
    /^[ \t]*(?:#\[path[ \t]*=[ \t]*"([^"]+)"\][ \t]*\r?\n?[ \t]*)?mod[ \t]+([a-zA-Z_]\w*)[ \t]*;/gm
  );
  const modules: string[] = [];
  for (const [, override, name] of declarations) {
    const base = path.join(path.dirname(file), override ?? name);
    const candidates = override ? [base] : [`${base}.rs`, path.join(base, 'mod.rs')];
    const found = candidates.find((candidate) =>
      fs.existsSync(path.join(__dirname, '../..', candidate))
    );
    if (found) modules.push(found);
  }
  return modules;
}

function includedFiles(source: string, file: string): string[] {
  const fs = require('node:fs');
  const path = require('node:path').posix;
  const includes = source.matchAll(/\binclude(?:_str|_bytes)?!\s*\(\s*"([^"]+)"\s*\)/g);
  const macros = [...includes].map(([, name]) => path.join(path.dirname(file), name));
  const fixtures = [...source.matchAll(/"(tests\/fixtures\/[^"]+)"/g)].map(
    ([, name]) => `${CRATE}${name}`
  );
  return [...new Set([...macros, ...fixtures])].filter((included) => {
    const full = path.join(__dirname, '../..', included);
    return fs.existsSync(full) && fs.statSync(full).isFile();
  });
}

function suiteDependencies(): Map<string, Set<string>> {
  const fs = require('node:fs');
  const path = require('node:path');
  const includedBy = new Map<string, Set<string>>();
  for (const target of testRoots()) {
    const pending = [target.path];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const file = pending.pop();
      if (!file) continue;
      if (seen.has(file)) continue;
      seen.add(file);
      const suites = includedBy.get(file) ?? new Set<string>();
      suites.add(target.name);
      includedBy.set(file, suites);
      const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8') as string;
      pending.push(...modulePaths(source, file));
      for (const included of includedFiles(source, file)) {
        const consumers = includedBy.get(included) ?? new Set<string>();
        consumers.add(target.name);
        includedBy.set(included, consumers);
      }
    }
  }
  return includedBy;
}

/**
 * The suites a path drags in beyond the one it names.
 *
 * A schema or migration change is the class that destroys user data, and it
 * was the one class that could not reach its own gate: none of these paths is
 * under `tests/`, so the plan named `--lib` and stopped. The golden is a
 * tripwire nobody runs on purpose, so it has to be named here.
 *
 * The `migration` target owns the checksum, self-seeded upgrade and released
 * v12 upgrade tests, so one target covers every schema gate.
 */
const SCHEMA_SUITES = ['migration'];

/** Paths whose change is a schema change, whatever else the merge touched. */
function touchesSchema(path: string): boolean {
  return (
    path.startsWith(`${CRATE}src/migrations/`) ||
    path === `${CRATE}src/persistence/schema.rs` ||
    path.startsWith(`${RUST_TEST_DIR}fixtures/schema/`)
  );
}

/**
 * A merge touching the crate's sources runs its unit tests too: a reader
 * changed on one side and its caller on the other is the shape that got
 * through, and the integration suites alone do not cover it.
 */
function touchesRustSource(path: string): boolean {
  return path.startsWith(`${CRATE}src/`) || path === `${CRATE}Cargo.toml`;
}

/**
 * tracematch is a submodule, so its own merge happens inside a git the
 * superproject cannot gate. What reaches here is the pointer bump, one path
 * and no contents, and running the crate against it is the gate that is
 * achievable. A path inside the submodule counts too, for a caller that
 * expands the pointer itself.
 */
function touchesTracematch(path: string): boolean {
  return path === TRACEMATCH || path.startsWith(`${TRACEMATCH}/`);
}

function isTypeScript(path: string): boolean {
  return /\.(ts|tsx)$/.test(path) && !path.startsWith('modules/veloqrs/src/generated/');
}

/**
 * The guards on the test targets themselves read the manifest and every test
 * source: a source no target owns, a stanza with no recorded reason, a test in
 * an area binary that reaches the engine without that binary's serial guard.
 * A test file is the change that breaks them, so any one plans them.
 */
const LAYOUT_SUITE = 'feature_gates';

function touchesTestLayout(path: string): boolean {
  return (
    path === `${CRATE}Cargo.toml` ||
    (path.startsWith(RUST_TEST_DIR) && path.endsWith('.rs')) ||
    definesEngineEntryPoint(path)
  );
}

/**
 * The names the layout guard treats as reaching the process-wide engine, read
 * from the guard's own list so there is one list and not a copy here.
 */
function engineEntryNames(): string[] {
  const guard = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../..', RUST_TEST_DIR, 'test_layout.rs'),
    'utf8'
  ) as string;
  const list = guard.match(/const GLOBAL_ENGINE_CALLS: &\[&str\] = &\[([^\]]*)\];/)?.[1] ?? '';
  return [...list.matchAll(/"([^"]+)"/g)].flatMap((match) => match[1] ?? []);
}

/**
 * A crate source that defines or calls an engine entry point. Adding, renaming
 * or removing one there is the change that leaves the guard's list stale, and
 * the guard is the suite that checks the list against the source.
 */
function definesEngineEntryPoint(path: string): boolean {
  if (!path.startsWith(`${CRATE}src/`) || !path.endsWith('.rs')) return false;
  const fs = require('node:fs');
  const file = require('node:path').join(__dirname, '../..', path);
  if (!fs.existsSync(file)) return false;
  const source = fs.readFileSync(file, 'utf8') as string;
  return engineEntryNames().some((name) => new RegExp(`\\b${name}\\b`).test(source));
}

/** The suites to run for a set of changed paths. */
export function mergeTestTargets(changed: string[]): MergeTargets {
  const unrunnable = unrunnableSuites();
  const dependencies = suiteDependencies();
  const named = changed.flatMap((path) => [...(dependencies.get(path) ?? [])]);
  const schema = changed.some(touchesSchema) ? SCHEMA_SUITES : [];
  const manifest = changed.includes(`${CRATE}Cargo.toml`) ? ['app'] : [];
  const layout = changed.some(touchesTestLayout) ? [LAYOUT_SUITE] : [];
  const rustTests = [...new Set([...named, ...schema, ...manifest, ...layout])].filter(
    (n) => !unrunnable.has(n)
  );
  return {
    rustTests: rustTests.sort(),
    rustLib: changed.some(touchesRustSource),
    tracematchLib: changed.some(touchesTracematch),
    typescript: changed.filter(isTypeScript).sort(),
  };
}

/** Whether there is anything at all to run. */
export function hasTargets(targets: MergeTargets): boolean {
  return (
    targets.rustTests.length > 0 ||
    targets.rustLib ||
    targets.tracematchLib ||
    targets.typescript.length > 0
  );
}

/** One shell word: the hook runs the line through `eval`, and `src/app/(tabs)/` is a path. */
function shellQuote(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

/** Data directories the bitwise gates read, each present only when it exists on disk. */
export interface Corpora {
  geolife?: string | undefined;
  private?: string | undefined;
}

/** `KEY = "value"` under `[env]` in the nearest cargo config above the repository, if any. */
function cargoConfigEnv(key: string): string | undefined {
  const fs = require('node:fs');
  const path = require('node:path');
  for (let dir = path.join(__dirname, '../..'); ; dir = path.dirname(dir)) {
    const file = path.join(dir, '.cargo', 'config.toml');
    if (fs.existsSync(file)) {
      const match = fs
        .readFileSync(file, 'utf8')
        .match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'));
      if (match) return match[1];
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

/**
 * Where the two golden comparisons find their data on this machine. The shell
 * variable wins, then the cargo config that sets it for local runs, and a
 * directory that does not exist counts as absent.
 */
export function detectCorpora(env: NodeJS.ProcessEnv = process.env): Corpora {
  const fs = require('node:fs');
  const exists = (dir: string | undefined) =>
    dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? dir : undefined;
  return {
    geolife: exists(env.LAB_GEOLIFE_DIR),
    private: exists(env.TRACEMATCH_CORPUS ?? cargoConfigEnv('TRACEMATCH_CORPUS')),
  };
}

function bitwiseCommand(variable: string, dir: string | undefined, feature: string, test: string) {
  if (!dir) return `echo ${shellQuote(`skipped ${test}: ${variable} is unset or missing`)}`;
  return `${variable}=${shellQuote(dir)} cargo test --release --manifest-path ${TRACEMATCH}/Cargo.toml --features ${feature} --test ${test}`;
}

/** The shell commands those targets call for, one per line, in order. */
export function mergeTestCommands(
  targets: MergeTargets,
  corpora: Corpora = detectCorpora()
): string[] {
  const commands: string[] = [];

  // Most suites carry `required-features = ["synthetic"]`, and cargo
  // refuses a `--test` naming one without the feature rather than skipping it.
  // The ones this lane cannot supply are already out of `rustTests`.
  const cargo: string[] = [`--features ${MERGE_FEATURE}`];
  if (targets.rustLib) cargo.push('--lib');
  for (const name of targets.rustTests) cargo.push(`--test ${name}`);
  if (cargo.length > 1) {
    commands.push(`cargo test --manifest-path ${CRATE}Cargo.toml -p veloqrs ${cargo.join(' ')}`);
  }
  // tracematch gates `fold_resume` and its other synthetic suites the same way,
  // but a run that names no `--test` skips them quietly rather than refusing,
  // so without the feature the gate passes with those suites never built.
  if (targets.tracematchLib) {
    commands.push(
      `cargo test --manifest-path ${TRACEMATCH}/Cargo.toml -p tracematch --features ${MERGE_FEATURE}`
    );
    // A corpus gate runs where its data is and skips loudly where it is not,
    // because a pointer bump is the one change that moves fold output.
    commands.push(
      bitwiseCommand('LAB_GEOLIFE_DIR', corpora.geolife, 'public-corpus', 'geolife_bitwise'),
      bitwiseCommand('TRACEMATCH_CORPUS', corpora.private, 'real-corpus', 'full_corpus_bitwise')
    );
  }
  if (targets.typescript.length > 0) {
    commands.push(
      `npx jest --config config/jest.config.js --findRelatedTests --passWithNoTests ${targets.typescript.map(shellQuote).join(' ')}`
    );
  }

  return commands;
}
