/**
 * Scenario: `uniffi` hashes each export's whole metadata buffer, and that
 * buffer carries the docstring. So a doc comment is part of the ABI: editing
 * one moves the checksum the generated bindings assert at startup, and a build
 * from unregenerated bindings refuses to start with an `ApiChecksumMismatch`.
 * `B272` did exactly that and every gate passed, because the manifest recorded
 * names, arity and return types and nothing else.
 *
 * Expected behaviour: the manifest records each export's docstring, and
 * `ffi:check` fails when one changes without a regeneration.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const EXPORT_SCRIPT = path.join(REPO, 'scripts/extract-ffi-exports.ts');
const RUST_FILE = path.join(REPO, 'modules/veloqrs/rust/veloqrs/src/ffi.rs');

function check(): { code: number; out: string } {
  try {
    const out = execFileSync('npx', ['tsx', EXPORT_SCRIPT, '--check'], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
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

    try {
      fs.writeFileSync(
        RUST_FILE,
        original.replace(anchor, `${anchor}\n/// A line the checksum will notice.`)
      );
      const result = check();

      expect(result.code).not.toBe(0);
      expect(result.out).toMatch(/doc/i);
    } finally {
      fs.writeFileSync(RUST_FILE, original);
    }
  });
});
