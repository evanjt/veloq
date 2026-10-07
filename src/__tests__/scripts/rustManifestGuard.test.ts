/**
 * Scenario: a test or bench file gated on a cargo feature without a matching
 * `required-features` stanza compiles to a binary that reports `ok. 0 passed`,
 * a `[profile.*]` in a workspace member is discarded by cargo, and the root and
 * the standalone tracematch release profiles can drift apart unnoticed.
 *
 * Expected behaviour: the guard fails each of those shapes and names the file
 * or manifest at fault. A gate the stanza names, a platform `cfg`, a gated
 * helper beside ungated tests, an area binary whose stanza carries the gate and
 * the exempt tracematch member pass. A checkout without the tracematch
 * submodule is judged on the rest. `npm run audit` runs it over this
 * repository.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-rust-manifests.mjs');
const RUST = 'modules/veloqrs/rust';
const CRATE = `${RUST}/veloqrs`;

const RELEASE = '[profile.release]\nlto = true\ncodegen-units = 1\nstrip = false\n';

const ROOT_MANIFEST = `[workspace]\nmembers = ["tracematch", "veloqrs"]\n\n${RELEASE}`;
const TRACEMATCH_MANIFEST = `[package]\nname = "tracematch"\n\n${RELEASE}`;
const CRATE_MANIFEST = [
  '[package]',
  'name = "veloqrs"',
  'autotests = false',
  '',
  '[[test]]',
  'name = "plain"',
  'path = "tests/plain.rs"',
  '',
  '[[test]]',
  'name = "gated"',
  'path = "tests/gated.rs"',
  'required-features = ["synthetic"]',
  '',
  '[[test]]',
  'name = "area"',
  'path = "tests/area/main.rs"',
  'required-features = ["synthetic"]',
  '',
  '[[bench]]',
  'name = "harness"',
  'required-features = ["synthetic"]',
  '',
].join('\n');

const GATED_CRATE_LEVEL = '#![cfg(feature = "synthetic")]\n\nuse std::fs;\n';
const GATED_ITEM = '#[cfg(feature = "synthetic")]\n#[test]\nfn gated() {}\n';
const PLAIN = '#[test]\nfn t() {}\n';

const BASE: Record<string, string> = {
  [`${RUST}/Cargo.toml`]: ROOT_MANIFEST,
  [`${RUST}/tracematch/Cargo.toml`]: TRACEMATCH_MANIFEST,
  [`${CRATE}/Cargo.toml`]: CRATE_MANIFEST,
  [`${CRATE}/tests/plain.rs`]: PLAIN,
  [`${CRATE}/tests/gated.rs`]: GATED_CRATE_LEVEL,
  [`${CRATE}/tests/area/main.rs`]: '#[path = "../shared.rs"]\nmod shared;\n',
  [`${CRATE}/tests/shared.rs`]: GATED_ITEM,
  [`${CRATE}/benches/harness.rs`]: GATED_CRATE_LEVEL,
};

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** The base tree with `files` laid over it; a null value removes the file. */
function fixture(files: Record<string, string | null>): string {
  const root = mkdtempSync(join(tmpdir(), 'rust-manifests-'));
  roots.push(root);
  for (const [path, contents] of Object.entries({ ...BASE, ...files })) {
    if (contents === null) continue;
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

function runGuard(root?: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', root ? [SCRIPT, '--root', root] : [SCRIPT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** The base manifest with one more `[[test]]` stanza appended. */
const withStanza = (name: string, path: string, extra = '') =>
  `${CRATE_MANIFEST}\n[[test]]\nname = "${name}"\npath = "${path}"\n${extra}`;

describe('feature gates', () => {
  it('passes the base tree', () => {
    const { status, output } = runGuard(fixture({}));
    expect(output).toContain('no violations');
    expect(status).toBe(0);
  });

  it('fails a crate-level gate on a test with no required-features', () => {
    const root = fixture({
      [`${CRATE}/Cargo.toml`]: withStanza('loose', 'tests/loose.rs'),
      [`${CRATE}/tests/loose.rs`]: GATED_CRATE_LEVEL,
    });
    const { status, output } = runGuard(root);
    expect(status).toBe(1);
    expect(output).toContain('tests/loose.rs');
    expect(output).toContain('synthetic');
  });

  it.each([
    ['gate before test', '#[cfg(feature = "synthetic")]\n#[test]\nfn g() {}\n'],
    ['test before gate', '#[test]\n#[cfg(feature = "synthetic")]\nfn g() {}\n'],
    ['async test', '#[cfg(feature = "synthetic")]\n#[tokio::test]\nasync fn g() {}\n'],
  ])('fails an item-level gate on a test with no stanza: %s', (_label, source) => {
    const root = fixture({
      [`${CRATE}/Cargo.toml`]: withStanza('loose', 'tests/loose.rs'),
      [`${CRATE}/tests/loose.rs`]: source,
    });
    const { status, output } = runGuard(root);
    expect(status).toBe(1);
    expect(output).toContain('tests/loose.rs');
  });

  it('passes a gated helper, a platform cfg and an ungated file', () => {
    const root = fixture({
      [`${CRATE}/Cargo.toml`]: withStanza('helper', 'tests/helper.rs'),
      [`${CRATE}/tests/helper.rs`]:
        '#[cfg(feature = "synthetic")]\nfn helper() {}\n\n#[cfg(target_os = "android")]\n#[test]\nfn p() {}\n',
    });
    expect(runGuard(root).status).toBe(0);
  });

  it('fails a gated bench with no [[bench]] stanza and names the stanza kind', () => {
    const root = fixture({ [`${CRATE}/benches/orphan.rs`]: GATED_CRATE_LEVEL });
    const { status, output } = runGuard(root);
    expect(status).toBe(1);
    expect(output).toContain('benches/orphan.rs');
    expect(output).toContain('[[bench]]');
  });

  it('does not take a test stanza for a bench of the same name', () => {
    const root = fixture({ [`${CRATE}/benches/plain.rs`]: GATED_CRATE_LEVEL });
    const { status, output } = runGuard(root);
    expect(status).toBe(1);
    expect(output).toContain('benches/plain.rs');
  });
});

describe('test targets', () => {
  it('fails when autotests is not false', () => {
    const root = fixture({
      [`${CRATE}/Cargo.toml`]: CRATE_MANIFEST.replace('autotests = false\n', ''),
    });
    const { status, output } = runGuard(root);
    expect(status).toBe(1);
    expect(output).toContain('autotests');
  });

  it('fails a test source no stanza owns', () => {
    const root = fixture({ [`${CRATE}/tests/stray.rs`]: PLAIN });
    const { status, output } = runGuard(root);
    expect(status).toBe(1);
    expect(output).toContain('tests/stray.rs');
  });

  it('fails a test source two stanzas own', () => {
    const root = fixture({
      [`${CRATE}/Cargo.toml`]: withStanza('again', 'tests/plain.rs'),
    });
    const { status, output } = runGuard(root);
    expect(status).toBe(1);
    expect(output).toContain('tests/plain.rs');
  });

  it('does not let a stanza name claim a source its path does not point at', () => {
    const root = fixture({
      [`${CRATE}/Cargo.toml`]: CRATE_MANIFEST.replace(
        'path = "tests/plain.rs"',
        'path = "tests/other.rs"'
      ),
      [`${CRATE}/tests/other.rs`]: PLAIN,
    });
    const { status, output } = runGuard(root);
    expect(status).toBe(1);
    expect(output).toContain('tests/plain.rs');
  });
});

describe('release profile', () => {
  it('fails when the tracematch profile differs from the root', () => {
    const root = fixture({
      [`${RUST}/tracematch/Cargo.toml`]: TRACEMATCH_MANIFEST.replace(
        'strip = false',
        'strip = true'
      ),
    });
    const { status, output } = runGuard(root);
    expect(status).toBe(1);
    expect(output).toContain('tracematch');
  });

  it('passes the same settings in another order and with comments', () => {
    const root = fixture({
      [`${RUST}/tracematch/Cargo.toml`]:
        '[package]\nname = "tracematch"\n\n[profile.release]\n# kept\nstrip = false\ncodegen-units = 1\nlto = true\n',
    });
    expect(runGuard(root).status).toBe(0);
  });

  it('judges the rest when the tracematch submodule is not checked out', () => {
    const root = fixture({ [`${RUST}/tracematch/Cargo.toml`]: null });
    expect(runGuard(root).status).toBe(0);
  });

  it('fails when the root declares no release profile', () => {
    const root = fixture({
      [`${RUST}/Cargo.toml`]: '[workspace]\nmembers = ["tracematch", "veloqrs"]\n',
    });
    const { status, output } = runGuard(root);
    expect(status).toBe(1);
    expect(output).toContain('[profile.release]');
  });

  it.each([
    ['codegen-units', 'codegen-units = 1', 'codegen-units = 16'],
    ['lto', 'lto = true', 'lto = false'],
  ])('fails a root that does not pin %s', (setting, from, to) => {
    const root = fixture({
      [`${RUST}/Cargo.toml`]: ROOT_MANIFEST.replace(from, to),
      [`${RUST}/tracematch/Cargo.toml`]: TRACEMATCH_MANIFEST.replace(from, to),
    });
    const { status, output } = runGuard(root);
    expect(status).toBe(1);
    expect(output).toContain(setting);
  });

  it.each(['"s"', '"z"'])('fails a root that optimises for size with %s', (level) => {
    const body = `${RELEASE}opt-level = ${level}\n`;
    const root = fixture({
      [`${RUST}/Cargo.toml`]: `[workspace]\nmembers = ["tracematch", "veloqrs"]\n\n${body}`,
      [`${RUST}/tracematch/Cargo.toml`]: `[package]\nname = "tracematch"\n\n${body}`,
    });
    const { status, output } = runGuard(root);
    expect(status).toBe(1);
    expect(output).toContain('opt-level');
  });

  it('fails a member other than tracematch that declares a profile', () => {
    const root = fixture({
      [`${CRATE}/Cargo.toml`]: `${CRATE_MANIFEST}\n[profile.release.package.dep]\nopt-level = 3\n`,
    });
    const { status, output } = runGuard(root);
    expect(status).toBe(1);
    expect(output).toContain(`${CRATE}/Cargo.toml`);
    expect(output).toContain('profile.release.package.dep');
  });

  it('fails when every member is exempt, since the ban would check nothing', () => {
    const root = fixture({
      [`${RUST}/Cargo.toml`]: ROOT_MANIFEST.replace('["tracematch", "veloqrs"]', '["tracematch"]'),
    });
    expect(runGuard(root).status).toBe(1);
  });
});
