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
 * Today that is `real-corpus`, whose suites need a corpus on disk that a
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
  /** `cargo nextest run -p veloqrs --test <name>` for each. */
  rustTests: string[];
  /** Whether the crate's own unit tests have to run. */
  rustLib: boolean;
  /** Whether the tracematch crate's suites have to run. */
  tracematchLib: boolean;
  /** TypeScript files to hand to `jest --findRelatedTests`. */
  typescript: string[];
  /**
   * Other files to hand to the same command: data Jest imports, and the tests
   * that read a changed file through `fs`.
   */
  related: string[];
  /** Whether the whole app project has to run, for a data file no test can be placed on. */
  jestApp: boolean;
  androidJvm: boolean;
  iosProject: boolean;
  rustLint: boolean;
  rustAll: boolean;
}

/** The local modules with JVM tests, each run by `npm run test:android:unit`. */
const ANDROID_JVM_MODULES = ['veloqrs', 'veloq-display', 'veloq-backup-exclusion'];

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

interface SuiteDependencies {
  /** Each file a suite compiles or reads, to the suites that do. */
  includedBy: Map<string, Set<string>>;
  /** Each suite, to the files it compiles or reads. */
  files: Map<string, Set<string>>;
  /** The suites whose sources name the fixture directory at all. */
  fixtureDirReaders: Set<string>;
}

const FIXTURE_DIR = `${RUST_TEST_DIR}fixtures`;

/** A source that opens something under the fixture directory, whatever it names. */
const NAMES_FIXTURE_DIR = /tests\/fixtures|["']fixtures["']/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether a source names a file by its own name. A suite builds a fixture path
 * from the directory and a bare name, so the literal `tests/fixtures/<name>`
 * never appears and the name is all there is to match.
 */
function namesFile(source: string, file: string): boolean {
  const base = file.slice(file.lastIndexOf('/') + 1);
  return new RegExp(`(?<![\\w.-])${escapeRegExp(base)}(?![\\w-])`).test(source);
}

function suiteDependencies(): SuiteDependencies {
  const fs = require('node:fs');
  const path = require('node:path');
  const includedBy = new Map<string, Set<string>>();
  const files = new Map<string, Set<string>>();
  const fixtureDirReaders = new Set<string>();
  const fixtures = filesUnder(FIXTURE_DIR, () => true);
  for (const target of testRoots()) {
    const pending = [target.path];
    const seen = new Set<string>();
    files.set(target.name, seen);
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
      const read = [
        ...includedFiles(source, file),
        ...fixtures.filter((fixture) => namesFile(source, fixture)),
      ];
      for (const included of read) {
        const consumers = includedBy.get(included) ?? new Set<string>();
        consumers.add(target.name);
        includedBy.set(included, consumers);
      }
      if (NAMES_FIXTURE_DIR.test(source)) fixtureDirReaders.add(target.name);
    }
  }
  return { includedBy, files, fixtureDirReaders };
}

/** The pseudo-module for items defined in `lib.rs` itself. */
const CRATE_ROOT = '';

function readRepoFile(file: string): string {
  return require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../..', file),
    'utf8'
  ) as string;
}

/** Every file under a directory whose name `keep` accepts, as repository paths; none when it is absent. */
function filesUnder(dir: string, keep: (name: string) => boolean): string[] {
  const fs = require('node:fs');
  const path = require('node:path');
  const found: string[] = [];
  // A checkout need not carry every root the planner looks under.
  if (!fs.existsSync(path.join(__dirname, '../..', dir))) return found;
  for (const entry of fs.readdirSync(path.join(__dirname, '../..', dir), {
    withFileTypes: true,
  }) as { name: string; isDirectory(): boolean }[]) {
    if (entry.name === 'node_modules') continue;
    const child = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(child, keep));
    else if (keep(entry.name)) found.push(child);
  }
  return found;
}

function rustFilesUnder(dir: string): string[] {
  return filesUnder(dir, (name) => name.endsWith('.rs'));
}

/** The first path segment after `src/`, which names the top-level module a source file belongs to. */
function topModuleOf(file: string): string {
  return file.slice(`${CRATE}src/`.length).replace(/\.rs$/, '').split('/')[0] ?? '';
}

/**
 * What `<prefix>::` leads to in a source: the identifier right after it, and,
 * for a `{ ... }` group, the leading identifier of each item at the group's
 * own depth. `self` and the empty case are reported as the prefix itself.
 */
function namesAfter(source: string, prefix: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(new RegExp(`\\b${prefix}::`, 'g'))) {
    let at = match.index + match[0].length;
    if (source[at] !== '{') {
      const name = source.slice(at).match(/^[a-zA-Z_]\w*/)?.[0];
      if (name) names.push(name);
      continue;
    }
    let depth = 0;
    let atItemStart = false;
    for (; at < source.length; at += 1) {
      const char = source[at] as string;
      if (char === '{') {
        depth += 1;
        atItemStart = depth === 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) break;
      } else if (char === ',') {
        atItemStart = depth === 1;
      } else if (atItemStart && /\S/.test(char)) {
        const name = source.slice(at).match(/^[a-zA-Z_]\w*/)?.[0];
        if (name) names.push(name);
        atItemStart = false;
      }
    }
  }
  return names;
}

interface ModuleGraph {
  modules: Set<string>;
  /** A module, to the modules its files name through `crate::`. */
  edges: Map<string, Set<string>>;
  /** What an item imported straight from the crate root can come from. */
  rootModules: Set<string>;
}

/**
 * The crate's top-level modules as `lib.rs` declares them, and for each the
 * modules its files name through `crate::`. Nested files belong to the module
 * they sit under.
 */
function moduleGraph(): ModuleGraph {
  const lib = readRepoFile(`${CRATE}src/lib.rs`);
  const modules = new Set(
    [...lib.matchAll(/^[ \t]*(?:pub(?:\([a-z]+\))?[ \t]+)?mod[ \t]+([a-zA-Z_]\w*)[ \t]*;/gm)].map(
      ([, name]) => name as string
    )
  );
  const edges = new Map<string, Set<string>>();
  for (const file of rustFilesUnder(`${CRATE}src`)) {
    const owner = file === `${CRATE}src/lib.rs` ? CRATE_ROOT : topModuleOf(file);
    const into = edges.get(owner) ?? new Set<string>();
    for (const name of namesAfter(readRepoFile(file), 'crate')) {
      if (modules.has(name) && name !== owner) into.add(name);
    }
    edges.set(owner, into);
  }
  // An item a suite imports from the crate root is defined in `lib.rs` or
  // re-exported from a module that `pub use` names.
  const rootModules = new Set<string>([CRATE_ROOT]);
  for (const [, name] of lib.matchAll(/^pub use ([a-zA-Z_]\w*)::/gm)) {
    if (modules.has(name as string)) rootModules.add(name as string);
  }
  return { modules, edges, rootModules };
}

function closure(start: Iterable<string>, edges: Map<string, Set<string>>): Set<string> {
  const reached = new Set<string>();
  const pending = [...start];
  while (pending.length > 0) {
    const module = pending.pop() as string;
    if (reached.has(module)) continue;
    reached.add(module);
    pending.push(...(edges.get(module) ?? []));
  }
  return reached;
}

/**
 * The crate modules each integration suite reaches: those it names as
 * `veloqrs::<module>`, the modules the crate root re-exports for anything it
 * imports from the root, and everything those files use in turn. A glob or
 * `extern crate` import cannot be narrowed, so it reaches every module.
 */
function modulesReachedBySuite(
  files: Map<string, Set<string>>,
  graph: ModuleGraph
): Map<string, Set<string>> {
  const reached = new Map<string, Set<string>>();
  for (const [suite, suiteFiles] of files) {
    const direct = new Set<string>();
    for (const file of suiteFiles) {
      if (!file.endsWith('.rs')) continue;
      const source = readRepoFile(file);
      if (/\bextern crate veloqrs\b|\bveloqrs::\*|\bveloqrs::\{[^}]*\*/.test(source)) {
        for (const module of [...graph.modules, CRATE_ROOT]) direct.add(module);
      }
      for (const name of namesAfter(source, 'veloqrs')) {
        if (graph.modules.has(name)) direct.add(name);
        else for (const root of graph.rootModules) direct.add(root);
      }
    }
    reached.set(suite, closure(direct, graph.edges));
  }
  return reached;
}

/**
 * The integration suites a production source file can break, by the module it
 * belongs to. A source file that belongs to no declared module cannot be
 * placed, so it plans every suite rather than none.
 */
function suitesReaching(changed: string[], files: Map<string, Set<string>>): string[] {
  const sources = changed.filter((path) => path.startsWith(`${CRATE}src/`));
  if (sources.length === 0) return [];
  const graph = moduleGraph();
  const reached = modulesReachedBySuite(files, graph);
  const suites = new Set<string>();
  for (const source of sources) {
    // The migration scripts are embedded by the persistence module.
    const module =
      source === `${CRATE}src/lib.rs`
        ? CRATE_ROOT
        : source.startsWith(`${CRATE}src/migrations/`)
          ? 'persistence'
          : topModuleOf(source);
    if (module !== CRATE_ROOT && !graph.modules.has(module)) {
      return [...files.keys()];
    }
    for (const [suite, modules] of reached) if (modules.has(module)) suites.add(suite);
  }
  return [...suites];
}

interface SourceReaders {
  /** The crate sources that read a changed file other than by declaring it a module. */
  readers: string[];
  /** The changed files no crate source reads. */
  unread: string[];
  /** Whether any crate source opens something under the fixture directory. */
  namesFixtureDir: boolean;
}

/**
 * Which crate sources read the changed data files, through `include_str!`,
 * `include_bytes!` or a fixture's own name. Only their unit tests read a file
 * under `tests/`, so these plan `--lib` and not the suites reaching the module.
 * No test root declares them, so the file reaches them only through here.
 */
function sourceReaders(data: string[]): SourceReaders {
  if (data.length === 0) return { readers: [], unread: [], namesFixtureDir: false };
  const readers = new Set<string>();
  const read = new Set<string>();
  let namesFixtureDir = false;
  for (const file of rustFilesUnder(`${CRATE}src`)) {
    const source = readRepoFile(file);
    const included = includedFiles(source, file);
    if (NAMES_FIXTURE_DIR.test(source)) namesFixtureDir = true;
    for (const path of data) {
      const isFixture = path.startsWith(`${FIXTURE_DIR}/`);
      if (included.includes(path) || (isFixture && namesFile(source, path))) {
        readers.add(file);
        read.add(path);
      }
    }
  }
  return {
    readers: [...readers],
    unread: data.filter((path) => !read.has(path)),
    namesFixtureDir,
  };
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
  return (
    path.startsWith(`${CRATE}src/`) || path === `${CRATE}Cargo.toml` || touchesTracematch(path)
  );
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

/** Roots whose files Jest can import or a test can read. */
const JEST_ROOTS = ['src/', 'scripts/', 'config/', 'modules/veloqrs/src/'];

function underJestRoot(path: string): boolean {
  return (
    JEST_ROOTS.some((root) => path.startsWith(root)) &&
    !path.startsWith('modules/veloqrs/src/generated/')
  );
}

/** Files Jest resolves through `require` or `import`, so `--findRelatedTests` follows them. */
function isImportableData(path: string): boolean {
  return underJestRoot(path) && /\.(json|js|jsx|mjs|cjs)$/.test(path);
}

/** Changed files a test could read at runtime: data, not code and not prose. */
function isReadableData(path: string): boolean {
  return (
    !isTypeScript(path) &&
    !/\.(rs|md|toml|lock|kt|swift|java|gradle|plist|pbxproj)$/.test(path) &&
    /\.[a-z0-9]+$/i.test(path) &&
    !touchesTracematch(path)
  );
}

/**
 * Native sources a contract test reads through `fs` to hold them to the
 * TypeScript or Rust side. Nothing imports them, so only a test that names
 * one can be placed on it.
 */
function isNativeSource(path: string): boolean {
  return /\.(kt|swift|java|rs)$/.test(path) && !touchesTracematch(path);
}

interface JestPlan {
  related: string[];
  app: boolean;
}

/**
 * The Jest suites a changed non-TypeScript file can break. Importable data goes
 * to `--findRelatedTests`. A test that reads a file through `fs` names it, so
 * those tests are planned by the file's own name, and data by its directory
 * too. A data file under the app that no test can be placed on plans the
 * whole app project.
 */
function jestPlan(changed: string[]): JestPlan {
  const data = changed.filter(isReadableData);
  const native = changed.filter(isNativeSource);
  const related = new Set(changed.filter(isImportableData));
  if (data.length === 0 && native.length === 0) return { related: [...related], app: false };
  const tests = JEST_ROOTS.flatMap((root) =>
    filesUnder(root.slice(0, -1), (name) => /\.test\.tsx?$/.test(name))
  ).map((file) => ({ file, source: readRepoFile(file) }));
  // A native source sits in a directory such as `java` or `src` that every
  // test names, so only its own name places a test, and one no test names
  // leaves the app to its per-language commands.
  for (const path of native) {
    for (const { file, source } of tests) if (namesFile(source, path)) related.add(file);
  }
  let app = false;
  for (const path of data) {
    const named = tests.filter(({ source }) => namesFile(source, path));
    // A test that scans a directory names the directory and not each file in
    // it. `fixtures` is the name every fixture directory shares, so it places
    // nothing.
    const directory = path.split('/').slice(-2, -1)[0];
    const inDirectory =
      !directory || directory === 'fixtures'
        ? []
        : tests.filter(({ source }) =>
            new RegExp(`(?<=[/'"\`])${escapeRegExp(directory)}(?=[/'"\`])`).test(source)
          );
    for (const { file } of [...named, ...inDirectory]) related.add(file);
    const placed = named.length > 0 || inDirectory.length > 0 || isImportableData(path);
    if (!placed && path.startsWith('src/')) app = true;
  }
  return { related: [...related].sort(), app };
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
  const { includedBy, files, fixtureDirReaders } = suiteDependencies();
  const crateData = changed.filter(
    (path) => path.startsWith(CRATE) && !path.endsWith('.rs') && !path.startsWith(`${CRATE}src/`)
  );
  const { readers, unread, namesFixtureDir } = sourceReaders(crateData);
  // A fixture no suite and no crate source names is read some way this planner
  // cannot see, so every suite that opens the fixture directory stands in.
  const unplaced = unread.filter(
    (path) => path.startsWith(`${FIXTURE_DIR}/`) && !includedBy.has(path)
  );
  const tracematch = changed.some(touchesTracematch) ? [...files.keys()] : [];
  const named = [
    ...changed.flatMap((path) => [...(includedBy.get(path) ?? [])]),
    ...suitesReaching(changed, files),
    ...(unplaced.length > 0 ? [...fixtureDirReaders] : []),
    ...tracematch,
  ];
  const schema = changed.some(touchesSchema) ? SCHEMA_SUITES : [];
  const manifest = changed.includes(`${CRATE}Cargo.toml`) ? ['app'] : [];
  const layout = changed.some(touchesTestLayout) ? [LAYOUT_SUITE] : [];
  const jest = jestPlan(changed);
  const rustAll = changed.some((path) =>
    [
      'modules/veloqrs/rust/Cargo.toml',
      'modules/veloqrs/rust/Cargo.lock',
      'rust-toolchain.toml',
    ].includes(path)
  );
  const rustTests = [...new Set([...named, ...schema, ...manifest, ...layout])].filter(
    (n) => !unrunnable.has(n)
  );
  return {
    rustTests: rustTests.sort(),
    rustLib:
      changed.some(touchesRustSource) ||
      readers.length > 0 ||
      (unplaced.length > 0 && namesFixtureDir),
    tracematchLib: changed.some(touchesTracematch),
    typescript: changed.filter(isTypeScript).sort(),
    related: jest.related,
    jestApp: jest.app,
    androidJvm: changed.some((path) =>
      ANDROID_JVM_MODULES.some((module) => path.startsWith(`modules/${module}/android/`))
    ),
    iosProject: changed.some(
      (path) =>
        path === 'app.json' ||
        path === 'app.config.js' ||
        path.startsWith('ios/') ||
        path.startsWith('src/plugins/') ||
        /\/ios\//.test(path)
    ),
    rustLint: changed.some(
      (path) => path.startsWith('modules/veloqrs/rust/') || path === 'rust-toolchain.toml'
    ),
    rustAll,
  };
}

/** Whether there is anything at all to run. */
export function hasTargets(targets: MergeTargets): boolean {
  return (
    targets.rustTests.length > 0 ||
    targets.rustLib ||
    targets.tracematchLib ||
    targets.typescript.length > 0 ||
    targets.related.length > 0 ||
    targets.jestApp ||
    targets.androidJvm ||
    targets.iosProject ||
    targets.rustLint ||
    targets.rustAll
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

  if (targets.rustLint) {
    commands.push(
      'cargo clippy --manifest-path modules/veloqrs/rust/Cargo.toml -p veloqrs --all-targets --all-features -- -D warnings'
    );
  }
  if (targets.tracematchLib) {
    commands.push(
      `cargo clippy --manifest-path ${TRACEMATCH}/Cargo.toml -- -D clippy::iter_over_hash_type`
    );
  }

  // Most suites carry `required-features = ["synthetic"]`, and cargo
  // refuses a `--test` naming one without the feature rather than skipping it.
  // The ones this lane cannot supply are already out of `rustTests`.
  const cargo: string[] = [`--features ${MERGE_FEATURE}`];
  if (targets.rustLib) cargo.push('--lib');
  for (const name of targets.rustTests) cargo.push(`--test ${name}`);
  if (targets.rustAll) {
    commands.push(
      'cargo nextest run --manifest-path modules/veloqrs/rust/Cargo.toml -p veloqrs --features synthetic --profile ci'
    );
  } else if (cargo.length > 1) {
    commands.push(
      `cargo nextest run --manifest-path modules/veloqrs/rust/Cargo.toml -p veloqrs ${cargo.join(' ')} --profile ci`
    );
  }
  // tracematch gates `fold_resume` and its other synthetic suites the same way,
  // but a run that names no `--test` skips them quietly rather than refusing,
  // so without the feature the gate passes with those suites never built.
  if (targets.tracematchLib) {
    commands.push(
      `cargo nextest run --manifest-path ${TRACEMATCH}/Cargo.toml -p tracematch --features ${MERGE_FEATURE} --profile ci`
    );
    // A corpus gate runs where its data is and skips loudly where it is not,
    // because a pointer bump is the one change that moves fold output.
    commands.push(
      bitwiseCommand('LAB_GEOLIFE_DIR', corpora.geolife, 'public-corpus', 'geolife_bitwise'),
      bitwiseCommand('TRACEMATCH_CORPUS', corpora.private, 'real-corpus', 'full_corpus_bitwise')
    );
  }
  const jestFiles = [...targets.typescript, ...targets.related];
  if (jestFiles.length > 0) {
    commands.push(
      `npx jest --config config/jest.config.js --findRelatedTests --passWithNoTests ${jestFiles.map(shellQuote).join(' ')}`
    );
  }
  if (targets.jestApp) {
    commands.push('npx jest --config config/jest.config.js --selectProjects app');
  }
  if (targets.androidJvm) commands.push('./scripts/check-android-jvm.sh');
  if (targets.iosProject) {
    commands.push('node scripts/check-ios-project.mjs');
    commands.push(
      'npx jest --config config/jest.config.js --runInBand src/__tests__/plugins/nativeStringCatalogues.test.ts src/__tests__/plugins/withIosWidgetSharedSource.test.ts'
    );
  }

  return commands;
}
