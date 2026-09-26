/**
 * Scenario: `ffi:check` compares the manifest to Rust by name, arity, return
 * type and docstring, and by nothing positional, so a `file:line` that moved
 * passes. Twenty-three entries sat stale on main until an unrelated item
 * regenerated the manifest for one field and swept every one of them into its
 * own commit, where `git blame` on a manifest entry then names the wrong
 * session.
 *
 * Expected behaviour: the guard regenerates into memory and refuses anything
 * that differs from the committed file, so the skip fails the commit that made
 * it. A code move above an export is a manifest change, which is why
 * `ffi:manifest` is run after any FFI change at all.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const EXPORT_SCRIPT = path.join(REPO, 'scripts/extract-ffi-exports.ts');
const RUST_SRC_DIR = path.join(REPO, 'modules/veloqrs/rust/veloqrs/src');
const RUST_FILE = path.join(RUST_SRC_DIR, 'ffi.rs');

function check(srcDir?: string): { code: number; out: string } {
  try {
    const out = execFileSync('npx', ['tsx', EXPORT_SCRIPT, '--check'], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: srcDir ? { ...process.env, VELOQ_FFI_SRC_DIR: srcDir } : process.env,
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/** Run the guard over a copy of the Rust sources with `edit` applied to ffi.rs. */
function checkWithEditedSource(edit: (source: string) => string): { code: number; out: string } {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-ffi-pos-'));
  try {
    fs.cpSync(RUST_SRC_DIR, copy, { recursive: true });
    const copied = path.join(copy, 'ffi.rs');
    fs.writeFileSync(copied, edit(fs.readFileSync(copied, 'utf8')));
    return check(copy);
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
}

describe('the FFI manifest guards where an export sits', () => {
  it('passes on the tree as checked in', () => {
    expect(check().code).toBe(0);
  });

  it('records a line for every export, which is the thing that drifts', () => {
    const manifest = require(path.join(REPO, 'src/__tests__/bindings/ffi-exports.generated.ts'))
      .FFI_EXPORTS as { name: string; line?: number }[];

    expect(manifest.length).toBeGreaterThan(0);
    expect(manifest.every((e) => typeof e.line === 'number' && e.line > 0)).toBe(true);
  });

  it('fails when code above an export moves its line and nothing regenerated', () => {
    // A comment on its own line, above everything, so every export in the file
    // shifts by one and no signature, name or docstring changes at all. That
    // is the whole point: none of the existing checks can see it.
    const result = checkWithEditedSource((source) => `// A line nothing else notices.\n${source}`);

    expect(result.code).not.toBe(0);
    // The line it names is the one an agent runs, not a description of the
    // problem: a guard that refuses without saying what to do costs a search.
    expect(result.out).toMatch(/npm run ffi:manifest/);
  });

  it('leaves the checked-in tree exactly as it found it', () => {
    expect(fs.readFileSync(RUST_FILE, 'utf8')).not.toContain('A line nothing else notices.');
  });
});
