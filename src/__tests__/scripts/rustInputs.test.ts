/**
 * Scenario: the native builds skip Cargo when a hash of the Rust tree is
 * unchanged, and CI restores a cached library on the same identity. A file the
 * crate embeds with `include_str!` (a migration's SQL) is compiled into the
 * library, so a hash that leaves it out ships an older schema after a SQL-only
 * change.
 * Expected behaviour: every file the crate compiles or embeds moves the hash,
 * nothing else does, and an embed that cannot be resolved stops the build.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(__dirname, '../../..');
const SCRIPT = join(ROOT, 'modules/veloqrs/scripts/rust-inputs.js');
const { hashRustInputs, rustInputFiles, parseFeatures } = require(SCRIPT) as {
  hashRustInputs: (rustDir: string, features?: string[]) => string;
  parseFeatures: (raw: string | undefined) => string[];
  rustInputFiles: (rustDir: string) => string[];
};
const yaml = require('js-yaml') as { load: (source: string) => unknown };

type Step = {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  with?: Record<string, string>;
};
type Workflow = { jobs: Record<string, { steps?: Step[] }> };

const LIB = `pub mod store;
pub fn schema() -> &'static str {
    include_str!("../migrations/001_init.sql")
}
`;
const STORE = `// include_str!("../no/such/file.sql") is how the store would read it.
pub fn seed() -> &'static [u8] {
    include_bytes!(
        "seed.bin"
    )
}
`;

let rustDir: string;

function write(file: string, contents: string) {
  const full = join(rustDir, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
}

beforeEach(() => {
  rustDir = mkdtempSync(join(tmpdir(), 'rust-inputs-'));
  write('Cargo.toml', '[workspace]\nmembers = ["engine"]\n');
  write('Cargo.lock', 'version = 4\n');
  write('.cargo/config.toml', '[build]\n');
  write('engine/Cargo.toml', '[package]\nname = "engine"\n');
  write('engine/src/lib.rs', LIB);
  write('engine/src/store.rs', STORE);
  write('engine/src/seed.bin', 'seed');
  write('engine/migrations/001_init.sql', 'SELECT 1;');
});
afterEach(() => rmSync(rustDir, { recursive: true, force: true }));

describe('the Rust input hash', () => {
  it('moves with the Cargo features, in both directions, whatever order they are named', () => {
    const plain = hashRustInputs(rustDir);
    const traced = hashRustInputs(rustDir, ['lock-trace']);
    expect(traced).not.toBe(plain);
    expect(hashRustInputs(rustDir, ['lock-trace'])).toBe(traced);
    expect(hashRustInputs(rustDir, [])).toBe(plain);
    expect(hashRustInputs(rustDir, ['b', 'a'])).toBe(hashRustInputs(rustDir, ['a', 'b']));
    expect(hashRustInputs(rustDir, ['a', 'b'])).not.toBe(hashRustInputs(rustDir, ['a']));
  });

  it('reads a feature list from comma or space separated text, sorted and without blanks', () => {
    expect(parseFeatures(undefined)).toEqual([]);
    expect(parseFeatures(' ')).toEqual([]);
    expect(parseFeatures('lock-trace, alpha,,alpha')).toEqual(['alpha', 'lock-trace']);
  });

  it('is unchanged when nothing the crate compiles has changed', () => {
    const first = hashRustInputs(rustDir);
    write('engine/README.md', 'notes');
    write('engine/target/release/libengine.so', 'built');
    write('engine/tests/fixtures/corpus.txt', 'not embedded');
    expect(hashRustInputs(rustDir)).toBe(first);
  });

  it('moves when only embedded migration SQL changes', () => {
    const before = hashRustInputs(rustDir);
    write('engine/migrations/001_init.sql', 'SELECT 2;');
    expect(hashRustInputs(rustDir)).not.toBe(before);
  });

  it('moves when a multi-line include_bytes resource changes, resolved beside its file', () => {
    const before = hashRustInputs(rustDir);
    write('engine/src/seed.bin', 'reseeded');
    expect(hashRustInputs(rustDir)).not.toBe(before);
  });

  it('takes in a resource once a source starts embedding it', () => {
    write('engine/migrations/002_index.sql', 'CREATE INDEX a ON b (c);');
    const unreferenced = hashRustInputs(rustDir);
    write('engine/migrations/002_index.sql', 'CREATE INDEX a ON b (d);');
    expect(hashRustInputs(rustDir)).toBe(unreferenced);

    write(
      'engine/src/lib.rs',
      `${LIB}pub const NEXT: &str = include_str!("../migrations/002_index.sql");\n`
    );
    const referenced = hashRustInputs(rustDir);
    write('engine/migrations/002_index.sql', 'CREATE INDEX a ON b (e);');
    expect(hashRustInputs(rustDir)).not.toBe(referenced);
    expect(rustInputFiles(rustDir)).toContain(join(rustDir, 'engine/migrations/002_index.sql'));
  });

  it('reads includes past literals that look like comments, and none inside comments', () => {
    write('engine/late.sql', 'SELECT 3;');
    write(
      'engine/src/lib.rs',
      `${LIB}pub const GLOB: &str = "src/**/*.rs";
pub const QUOTE: char = '"';
pub fn first<'a>(x: &'a str) -> &'a str { x }
/* outer /* nested */ include_str!("../gone.sql") */
pub const RAW: &[u8] = br#"a "quoted" // not a comment"#;
pub const LATE: &str = include_str!("../late.sql");
`
    );
    expect(rustInputFiles(rustDir)).toContain(join(rustDir, 'engine/late.sql'));
  });

  it('refuses an embedded resource that has been deleted, naming it and its reader', () => {
    rmSync(join(rustDir, 'engine/migrations/001_init.sql'));
    expect(() => hashRustInputs(rustDir)).toThrow(
      /engine\/src\/lib\.rs:3 embeds \.\.\/migrations\/001_init\.sql, which does not exist/
    );
  });

  it('refuses an include whose path is not a literal it can resolve', () => {
    write(
      'engine/src/lib.rs',
      `${LIB}pub const X: &str = include_str!(concat!(env!("OUT_DIR"), "/x.sql"));\n`
    );
    expect(() => hashRustInputs(rustDir)).toThrow(/engine\/src\/lib\.rs:5 .*literal path/);
  });

  it('refuses a build script, whose inputs cannot be read from its source', () => {
    write('engine/build.rs', 'fn main() {}\n');
    expect(() => hashRustInputs(rustDir)).toThrow(/engine\/build\.rs/);
  });
});

describe('the CI Rust library caches', () => {
  const caches = ['build', 'build-android', 'build-ios', 'e2e', 'e2e-gate'].flatMap((name) => {
    const workflow = yaml.load(
      readFileSync(join(ROOT, `.github/workflows/${name}.yml`), 'utf8')
    ) as Workflow;
    return Object.entries(workflow.jobs).flatMap(([job, { steps = [] }]) =>
      steps
        .filter(
          (step) =>
            step.uses?.startsWith('actions/cache/restore') &&
            /modules\/veloqrs\/build\/rust\//.test(step.with?.path ?? '')
        )
        .map((step) => ({ label: `${name} ${job}`, step, steps }))
    );
  });

  it('finds every Rust library cache', () => {
    expect(caches.map(({ label }) => label)).toEqual(['build-android build', 'build-ios build']);
  });

  // Runs the step that names the key in a copy of the script and a fixture tree,
  // so the key is the shared hash rather than a second list of file kinds.
  it.each(caches.map((cache) => [cache.label, cache]))(
    '%s keys on the Rust input hash',
    (_, cache) => {
      const match = /steps\.([\w-]+)\.outputs\.([\w-]+)/.exec(cache.step.with?.key ?? '');
      expect(match).not.toBeNull();
      const [, id, output] = match!;
      const keyStep = cache.steps.find((step) => step.id === id);
      expect(keyStep?.run).toBeDefined();
      expect(cache.steps.indexOf(keyStep!)).toBeLessThan(cache.steps.indexOf(cache.step));

      const repo = mkdtempSync(join(tmpdir(), 'rust-inputs-ci-'));
      const fixture = join(repo, 'modules/veloqrs/rust');
      cpSync(rustDir, fixture, { recursive: true });
      mkdirSync(join(repo, 'modules/veloqrs/scripts'), { recursive: true });
      cpSync(SCRIPT, join(repo, 'modules/veloqrs/scripts/rust-inputs.js'));

      const run = () => {
        const outputFile = join(repo, `output-${Math.random()}`);
        writeFileSync(outputFile, '');
        const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', keyStep!.run!], {
          cwd: repo,
          encoding: 'utf8',
          env: { ...process.env, GITHUB_OUTPUT: outputFile },
        });
        const line = readFileSync(outputFile, 'utf8')
          .split('\n')
          .find((entry) => entry.startsWith(`${output}=`));
        return { status: result.status, value: line?.slice(output.length + 1) };
      };

      const before = run();
      expect(before).toEqual({ status: 0, value: hashRustInputs(fixture) });
      writeFileSync(join(fixture, 'engine/migrations/001_init.sql'), 'SELECT 2;');
      const after = run();
      expect(after.status).toBe(0);
      expect(after.value).not.toBe(before.value);
      rmSync(join(fixture, 'engine/migrations/001_init.sql'));
      expect(run().status).not.toBe(0);
    }
  );

  it('names every bundled floor tile in the real crate, so a tile change moves the hash', () => {
    const realRust = join(ROOT, 'modules/veloqrs/rust');
    const floor = join(realRust, 'veloqrs/floor');
    const files = rustInputFiles(realRust);
    const tiles = [
      'openmaptiles/0/0/0.pbf',
      'openmaptiles/1/0/0.pbf',
      'openmaptiles/1/0/1.pbf',
      'openmaptiles/1/1/0.pbf',
      'openmaptiles/1/1/1.pbf',
      'ne2_shaded/0/0/0.png',
      'ne2_shaded/1/0/0.png',
      'ne2_shaded/1/0/1.png',
      'ne2_shaded/1/1/0.png',
      'ne2_shaded/1/1/1.png',
    ].map((t) => join(floor, t));
    expect(files).toEqual(expect.arrayContaining(tiles));
  });
});
