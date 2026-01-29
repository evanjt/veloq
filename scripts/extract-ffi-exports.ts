#!/usr/bin/env npx tsx
/**
 * Extract FFI exports from Rust source files.
 *
 * Parses Rust source for #[uniffi::export] functions and outputs:
 * - JSON manifest of all exports
 * - TypeScript const for use in tests
 *
 * Usage:
 *   npx tsx scripts/extract-ffi-exports.ts
 *   npx tsx scripts/extract-ffi-exports.ts --json > ffi-manifest.json
 */

import * as fs from 'fs';
import * as path from 'path';

const RUST_SRC_DIR = path.resolve(__dirname, '../modules/veloqrs/rust/veloqrs/src');

interface FfiExport {
  name: string;
  camelName: string;
  file: string;
  line: number;
  returnType: string;
  params: string[];
}

/**
 * Convert snake_case to camelCase (UniFFI's naming convention).
 */
function snakeToCamel(name: string): string {
  return name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Parse a Rust file for #[uniffi::export] functions.
 * Handles both single-line and multi-line function signatures.
 */
function extractExportsFromFile(filePath: string): FfiExport[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const exports: FfiExport[] = [];

  const relativePath = path.relative(RUST_SRC_DIR, filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Look for #[uniffi::export]
    if (line.trim() === '#[uniffi::export]') {
      // Collect lines until we find the complete function signature (ends with {)
      let fnSignature = '';
      let fnStartLine = i + 1;

      for (let j = i + 1; j < lines.length && j < i + 20; j++) {
        fnSignature += lines[j] + ' ';
        if (lines[j].includes('{')) {
          break;
        }
      }

      // Normalize whitespace
      fnSignature = fnSignature.replace(/\s+/g, ' ').trim();

      // Match: pub fn function_name(params) -> ReturnType {
      // Or: pub fn function_name(params) {
      const fnMatch = fnSignature.match(/pub\s+fn\s+(\w+)\s*\((.*?)\)(?:\s*->\s*(.+?))?\s*\{/);
      if (fnMatch) {
        const [, name, paramsStr, returnType] = fnMatch;

        // Parse parameter names (not types, just names for documentation)
        const params = paramsStr
          .split(',')
          .map((p) => p.trim().split(':')[0]?.trim())
          .filter((p) => p && p.length > 0);

        exports.push({
          name,
          camelName: snakeToCamel(name),
          file: relativePath,
          line: fnStartLine + 1, // 1-indexed
          returnType: returnType?.trim() || 'void',
          params,
        });
      }
    }
  }

  return exports;
}

/**
 * Recursively find all .rs files in a directory.
 */
function findRustFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findRustFiles(fullPath));
    } else if (entry.name.endsWith('.rs')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Main extraction function.
 */
function extractAllFfiExports(): FfiExport[] {
  const rustFiles = findRustFiles(RUST_SRC_DIR);
  const allExports: FfiExport[] = [];

  for (const file of rustFiles) {
    const exports = extractExportsFromFile(file);
    allExports.push(...exports);
  }

  // Sort by file, then by line number
  allExports.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });

  return allExports;
}

// Main execution
const exports = extractAllFfiExports();
const outputJson = process.argv.includes('--json');
const checkMode = process.argv.includes('--check');

if (outputJson) {
  console.log(JSON.stringify(exports, null, 2));
  process.exit(0);
}

if (checkMode) {
  // Check mode: verify the manifest is up to date
  const tsOutput = path.resolve(__dirname, '../src/__tests__/bindings/ffi-exports.generated.ts');

  if (!fs.existsSync(tsOutput)) {
    console.error('ERROR: FFI manifest does not exist.');
    console.error('Run: npm run ffi:manifest');
    process.exit(1);
  }

  const existingContent = fs.readFileSync(tsOutput, 'utf-8');

  // Extract the count from existing file
  const countMatch = existingContent.match(/Total:\s*(\d+)\s*exports/);
  const existingCount = countMatch ? parseInt(countMatch[1], 10) : 0;

  if (existingCount !== exports.length) {
    console.error(`ERROR: FFI manifest is out of date!`);
    console.error(`Manifest has ${existingCount} exports, Rust source has ${exports.length}`);
    console.error('Run: npm run ffi:manifest');
    process.exit(1);
  }

  // Verify all function names match
  const existingNames = new Set(
    [...existingContent.matchAll(/"name":\s*"(\w+)"/g)].map((m) => m[1])
  );

  const missingInManifest: string[] = [];
  const extraInManifest: string[] = [];

  for (const exp of exports) {
    if (!existingNames.has(exp.name)) {
      missingInManifest.push(exp.name);
    }
  }

  const currentNames = new Set(exports.map((e) => e.name));
  for (const name of existingNames) {
    if (!currentNames.has(name)) {
      extraInManifest.push(name);
    }
  }

  if (missingInManifest.length > 0 || extraInManifest.length > 0) {
    console.error('ERROR: FFI manifest does not match Rust source!');
    if (missingInManifest.length > 0) {
      console.error('Missing from manifest:', missingInManifest.join(', '));
    }
    if (extraInManifest.length > 0) {
      console.error('Extra in manifest (removed from Rust):', extraInManifest.join(', '));
    }
    console.error('Run: npm run ffi:manifest');
    process.exit(1);
  }

  console.log(`✓ FFI manifest is up to date (${exports.length} exports)`);
  process.exit(0);
}

// Default: generate manifest
{
  console.log(`Found ${exports.length} FFI exports:\n`);

  // Group by file
  const byFile = new Map<string, FfiExport[]>();
  for (const exp of exports) {
    const list = byFile.get(exp.file) || [];
    list.push(exp);
    byFile.set(exp.file, list);
  }

  for (const [file, fileExports] of byFile) {
    console.log(`\n${file} (${fileExports.length} exports):`);
    for (const exp of fileExports) {
      const params = exp.params.length > 0 ? exp.params.join(', ') : '';
      console.log(`  ${exp.line}: ${exp.name}(${params}) -> ${exp.returnType}`);
      console.log(`       TS: ${exp.camelName}`);
    }
  }

  console.log(`\n\nTotal: ${exports.length} FFI exports`);

  // Output as TypeScript constant for tests
  const tsOutput = path.resolve(__dirname, '../src/__tests__/bindings/ffi-exports.generated.ts');
  const tsContent = `/**
 * AUTO-GENERATED - DO NOT EDIT
 * Generated by: npx tsx scripts/extract-ffi-exports.ts
 *
 * This file contains the expected FFI exports extracted from Rust source.
 * Used by tests to validate TypeScript bindings match Rust exports.
 */

export interface FfiExportInfo {
  /** Rust function name (snake_case) */
  name: string;
  /** TypeScript function name (camelCase) */
  camelName: string;
  /** Source file relative to rust/veloqrs/src */
  file: string;
  /** Line number in source file */
  line: number;
}

/**
 * All FFI exports from Rust source.
 * Total: ${exports.length} exports
 */
export const FFI_EXPORTS: FfiExportInfo[] = ${JSON.stringify(
    exports.map(({ name, camelName, file, line }) => ({ name, camelName, file, line })),
    null,
    2
  )};

/**
 * Expected TypeScript function names (camelCase).
 */
export const EXPECTED_TS_FUNCTIONS = new Set<string>([
${exports.map((e) => `  '${e.camelName}',`).join('\n')}
]);

/**
 * Rust to TypeScript name mapping.
 */
export const RUST_TO_TS_NAME: Record<string, string> = {
${exports.map((e) => `  '${e.name}': '${e.camelName}',`).join('\n')}
};
`;

  fs.writeFileSync(tsOutput, tsContent);
  console.log(`\nGenerated: ${tsOutput}`);
}
