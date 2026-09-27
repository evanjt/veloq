#!/usr/bin/env npx tsx
/**
 * Print the FFI surface read from the Rust source.
 *
 * Usage:
 *   npx tsx scripts/extract-ffi-exports.ts
 *   npx tsx scripts/extract-ffi-exports.ts --json
 */

import { extractFfiExports, type FfiExport } from './lib/ffiExports';

const surface = extractFfiExports();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(surface, null, 2));
  process.exit(0);
}

const byFile = new Map<string, FfiExport[]>();
for (const e of surface) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e]);

for (const [file, fileExports] of byFile) {
  console.log(`\n${file} (${fileExports.length} exports):`);
  for (const e of fileExports) {
    const prefix = e.object ? `${e.object}::` : '';
    console.log(`  ${e.line}: ${prefix}${e.name}(${e.params.join(', ')}) -> ${e.returnType}`);
    console.log(`       TS: ${e.camelName}`);
  }
}

const standalone = surface.filter((e) => !e.object).length;
const objects = new Set(surface.flatMap((e) => (e.object ? [e.object] : [])));
console.log(
  `\nTotal: ${surface.length} FFI exports ` +
    `(${standalone} standalone + ${surface.length - standalone} methods in ` +
    `${objects.size} UniFFI Objects)`
);
