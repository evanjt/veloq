/**
 * Scenario: the manifest records a `file:line` for every export, and any edit
 * above an export moves it.
 *
 * Expected behaviour: the computed manifest names the line that declares each
 * export in the tree it read, and follows an edit without a regeneration step.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { RUST_SRC_DIR, extractFfiExports, ffiManifest } from '../../../scripts/lib/ffiExports';

const RUST_FILE = path.join(RUST_SRC_DIR, 'ffi.rs');

describe('the FFI manifest records where an export sits', () => {
  it('records a line for every export', () => {
    const manifest = ffiManifest().FFI_EXPORTS;

    expect(manifest.length).toBeGreaterThan(0);
    expect(manifest.every((e) => e.line > 0)).toBe(true);
  });

  it('points every entry at the line declaring its function', () => {
    const sources = new Map<string, string[]>();
    const misplaced = ffiManifest().FFI_EXPORTS.filter((e) => {
      if (!sources.has(e.file)) {
        sources.set(e.file, fs.readFileSync(path.join(RUST_SRC_DIR, e.file), 'utf8').split('\n'));
      }
      const declared = sources.get(e.file)![e.line - 1] ?? '';
      return !new RegExp(`\\bfn\\s+${e.name}\\b`).test(declared);
    });

    expect(misplaced.map((e) => `${e.file}:${e.line} ${e.name}`)).toEqual([]);
  });

  it('follows a line added above every export in a file', () => {
    const before = extractFfiExports().filter((e) => e.file === 'ffi.rs');
    expect(before.length).toBeGreaterThan(0);

    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-ffi-pos-'));
    try {
      fs.cpSync(RUST_SRC_DIR, copy, { recursive: true });
      const copied = path.join(copy, 'ffi.rs');
      fs.writeFileSync(
        copied,
        `// A line nothing else notices.\n${fs.readFileSync(copied, 'utf8')}`
      );

      const after = extractFfiExports(copy).filter((e) => e.file === 'ffi.rs');

      expect(after.map((e) => e.line)).toEqual(before.map((e) => e.line + 1));
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  it('leaves the checked-in tree exactly as it found it', () => {
    expect(fs.readFileSync(RUST_FILE, 'utf8')).not.toContain('A line nothing else notices.');
  });
});
