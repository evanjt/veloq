/**
 * Scenario: the Rust jobs pinned 1.95.0 while the Android and iOS setup actions
 * floated on stable, and nothing locally named a version, so a build, a lint and
 * a formatting check could each run a different compiler. Once
 * `rust-toolchain.toml` at the repository root names one, rustup uses it for every
 * cargo run under that directory, and an action that installed another toolchain
 * has added its targets to a compiler nobody runs.
 *
 * Expected behaviour: the toolchain file pins an exact release with rustfmt and
 * clippy, every `dtolnay/rust-toolchain` step in this repository's workflows and
 * actions installs that same release, and the matching engine's own toolchain
 * file, which rustup prefers for every cargo run inside the submodule, names it
 * too. Each step is pinned to the commit of the action's branch for one release,
 * and the trailing comment names it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const TOOLCHAIN = join(ROOT, 'rust-toolchain.toml');
const SUBMODULE_TOOLCHAIN = join(ROOT, 'modules/veloqrs/rust/tracematch/rust-toolchain.toml');

function yamlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return yamlFiles(path);
    return /\.ya?ml$/.test(name) ? [path] : [];
  });
}

function channel(file: string = TOOLCHAIN): string {
  const match = /^channel\s*=\s*"([^"]+)"/m.exec(readFileSync(file, 'utf8'));
  if (!match) throw new Error(`${relative(ROOT, file)} names no channel`);
  return match[1];
}

describe('the Rust toolchain pin', () => {
  it('names an exact release with rustfmt and clippy', () => {
    const text = readFileSync(TOOLCHAIN, 'utf8');
    expect(channel()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(text).toMatch(/components\s*=\s*\[[^\]]*"rustfmt"/);
    expect(text).toMatch(/components\s*=\s*\[[^\]]*"clippy"/);
  });

  it('is the release every workflow and action installs', () => {
    const pinned = channel();
    const uses = yamlFiles(join(ROOT, '.github')).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/uses:\s*dtolnay\/rust-toolchain@([^\n]*)/g)].map(
        (m) => `${relative(ROOT, file)} @${m[1].replace(/^[0-9a-f]{40}\s+#\s*/, '').trim()}`
      )
    );
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.filter((use) => !use.endsWith(`@${pinned}`))).toEqual([]);
  });

  it('is the release the matching engine submodule pins', () => {
    expect(channel(SUBMODULE_TOOLCHAIN)).toBe(channel());
  });
});
