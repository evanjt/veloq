/**
 * Scenario: `uniffi` hashes each export's whole metadata buffer, and that
 * buffer carries the docstring. So a doc comment is part of the ABI: editing
 * one moves the checksum the generated bindings assert at startup, and a build
 * from unregenerated bindings refuses to start with an `ApiChecksumMismatch`.
 *
 * Expected behaviour: every export's Rust docstring equals the one the
 * generated bindings carry, so a comment edited without `npm run ffi:generate`
 * fails here.
 *
 * The failing case edits a copy of the Rust tree, never the checked-in one: a
 * Jest worker killed mid-test would otherwise leak the edit into `ffi.rs`.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  GENERATED_BINDINGS,
  RUST_SRC_DIR,
  bindingDocs,
  docDrift,
  extractFfiExports,
  ffiManifest,
} from '../../../scripts/lib/ffiExports';

const RUST_FILE = path.join(RUST_SRC_DIR, 'ffi.rs');
const ANCHOR = '/// Start the elevation backfill on a background thread.';

const bindings = (): string => fs.readFileSync(GENERATED_BINDINGS, 'utf8');

describe('the FFI docstring matches the generated bindings', () => {
  it('records a docstring for an exported function that has one', () => {
    const documented = ffiManifest().FFI_EXPORTS.filter((e) => e.docs.length > 0);

    expect(documented.length).toBeGreaterThan(0);
  });

  it('finds every export in the generated bindings', () => {
    const exports = extractFfiExports();

    expect(bindingDocs(exports, bindings()).size).toBe(exports.length);
  });

  it('reads the same docstrings the Rust source carries', () => {
    const drift = docDrift(extractFfiExports(), bindings());
    if (drift.length > 0) {
      console.error('Doc comments differ from the bindings. Run `npm run ffi:generate`:');
      drift.forEach((key) => console.error(`  ${key}`));
    }

    expect(drift).toEqual([]);
  });

  it('fails when a doc comment changes and the bindings have not been regenerated', () => {
    expect(fs.readFileSync(RUST_FILE, 'utf8')).toContain(ANCHOR);

    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-ffi-src-'));
    try {
      fs.cpSync(RUST_SRC_DIR, copy, { recursive: true });
      const copied = path.join(copy, 'ffi.rs');
      fs.writeFileSync(
        copied,
        fs
          .readFileSync(copied, 'utf8')
          .replace(ANCHOR, `${ANCHOR}\n/// A line the checksum will notice.`)
      );

      expect(docDrift(extractFfiExports(copy), bindings())).toEqual([
        '<standalone>::start_elevation_backfill',
      ]);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  it('fails when a doc comment is added to an export that had none', () => {
    const bare = extractFfiExports().find((e) => e.object === 'RouteManager' && !e.docs);
    expect(bare).toBeDefined();

    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-ffi-src-'));
    try {
      fs.cpSync(RUST_SRC_DIR, copy, { recursive: true });
      const copied = path.join(copy, bare!.file);
      const lines = fs.readFileSync(copied, 'utf8').split('\n');
      lines.splice(bare!.line - 1, 0, '    /// A comment the bindings never saw.');
      fs.writeFileSync(copied, lines.join('\n'));

      expect(docDrift(extractFfiExports(copy), bindings())).toEqual([
        `RouteManager::${bare!.name}`,
      ]);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  it('leaves the checked-in tree exactly as it found it', () => {
    expect(fs.readFileSync(RUST_FILE, 'utf8')).not.toContain('the checksum will notice');
  });
});
