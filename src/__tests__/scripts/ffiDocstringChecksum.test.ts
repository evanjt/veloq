/**
 * Scenario: `uniffi` hashes each export's whole metadata buffer, and that
 * buffer carries the docstring. So a doc comment is part of the ABI: editing
 * one moves the checksum the generated bindings assert at startup, and a build
 * from unregenerated bindings refuses to start with an `ApiChecksumMismatch`.
 * A comment-only edit has already done exactly that with every gate passing,
 * because the manifest recorded names, arity and return types and nothing else.
 *
 * Expected behaviour: the manifest records each export's docstring, and
 * `ffi:check` fails when one changes without a regeneration.
 *
 * Proved against a copy, never against the checked-in tree. This test used to
 * edit `ffi.rs` in place and restore it in a `finally`, which a `finally` does
 * not reach when the worker is killed: on a fleet machine Jest workers are
 * killed under memory pressure often enough that the edit leaked by itself,
 * and then every later run failed the first case here, naming an FFI docstring
 * drift that did not exist. A leaked edit to a tracked source file is also a
 * commit hazard.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const EXPORT_SCRIPT = path.join(REPO, 'scripts/extract-ffi-exports.ts');
const RUST_SRC_DIR = path.join(REPO, 'modules/veloqrs/rust/veloqrs/src');
const RUST_FILE = path.join(RUST_SRC_DIR, 'ffi.rs');

/** Run the guard, optionally over a copy of the Rust sources instead. */
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

describe('the FFI manifest guards the docstring', () => {
  it('records a docstring for an exported function that has one', () => {
    const manifest = require(path.join(REPO, 'src/__tests__/bindings/ffi-exports.generated.ts'))
      .FFI_EXPORTS as { name: string; docs?: string }[];

    const documented = manifest.filter((e) => (e.docs ?? '').length > 0);

    expect(documented.length).toBeGreaterThan(0);
  });

  it('passes on the tree as checked in', () => {
    expect(check().code).toBe(0);
  });

  it('fails when a doc comment moves and the manifest has not been regenerated', () => {
    const original = fs.readFileSync(RUST_FILE, 'utf8');
    const anchor = '/// Start the elevation backfill on a background thread.';
    expect(original).toContain(anchor);

    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-ffi-src-'));
    try {
      fs.cpSync(RUST_SRC_DIR, copy, { recursive: true });
      const copied = path.join(copy, 'ffi.rs');
      fs.writeFileSync(
        copied,
        fs
          .readFileSync(copied, 'utf8')
          .replace(anchor, `${anchor}\n/// A line the checksum will notice.`)
      );

      const result = check(copy);

      expect(result.code).not.toBe(0);
      expect(result.out).toMatch(/doc/i);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  it('leaves the checked-in tree exactly as it found it', () => {
    // The point of the copy: kill this suite at any moment and `git status`
    // is still clean, so the next run does not report a drift that is its own.
    expect(fs.readFileSync(RUST_FILE, 'utf8')).not.toContain('the checksum will notice');
  });
});
