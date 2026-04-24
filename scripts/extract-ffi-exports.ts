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
  /** If set, this export is a method on a UniFFI Object with this name. */
  object?: string;
}

/**
 * Convert snake_case to camelCase (UniFFI's naming convention).
 */
function snakeToCamel(name: string): string {
  return name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Find the matching closing brace for an impl block starting at `startLine`.
 * Tracks brace depth to handle nested braces in method bodies.
 * Returns the line index (0-based) of the matching `}` or the end of file.
 */
function findImplBlockEnd(lines: string[], startLine: number): number {
  let depth = 0;
  let seenOpen = false;
  for (let i = startLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') {
        depth++;
        seenOpen = true;
      } else if (ch === '}') {
        depth--;
        if (seenOpen && depth === 0) return i;
      }
    }
  }
  return lines.length - 1;
}

/**
 * Extract a single function signature (name, params, return type) from a
 * multi-line declaration starting at `startLine`. Returns null if the
 * declaration does not look like a function (e.g. it's a `use`/`const`).
 */
function parseFnDecl(
  lines: string[],
  startLine: number
): { name: string; params: string[]; returnType: string; line: number } | null {
  let signature = '';
  for (let j = startLine; j < lines.length && j < startLine + 30; j++) {
    signature += lines[j] + ' ';
    if (lines[j].includes('{') || lines[j].trim().endsWith(';')) break;
  }
  signature = signature.replace(/\s+/g, ' ').trim();

  // Matches both `pub fn name(...)` and `fn name(...)` (methods inside impl
  // blocks often omit `pub`). Optional return type after `->`.
  const match = signature.match(
    /(?:pub\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([\s\S]*?)\)(?:\s*->\s*([^{;]+?))?\s*[{;]/
  );
  if (!match) return null;

  const [, name, paramsStr, returnType] = match;
  const params = paramsStr
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p !== '&self' && p !== '&mut self' && p !== 'self')
    .map((p) => p.split(':')[0]?.trim())
    .filter((p): p is string => !!p && p.length > 0);

  return {
    name,
    params,
    returnType: returnType?.trim() || 'void',
    line: startLine + 1, // 1-indexed
  };
}

/**
 * Parse a Rust file for #[uniffi::export] exports.
 *
 * Handles two shapes:
 *   1. Standalone functions:   `#[uniffi::export] pub fn name(...) { ... }`
 *   2. Impl blocks:            `#[uniffi::export] impl Foo { fn a(...); fn b(...); }`
 *
 * For impl blocks, every `fn` (or `pub fn`) inside the block is counted as an
 * individual export. Constructors marked with `#[uniffi::constructor]` and
 * plain methods are both included; UniFFI exposes all of them.
 */
function extractExportsFromFile(filePath: string): FfiExport[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const exports: FfiExport[] = [];

  const relativePath = path.relative(RUST_SRC_DIR, filePath);

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '#[uniffi::export]') continue;

    // Skip attribute-only lines after the `#[uniffi::export]` to find what it
    // decorates. This handles stacks like `#[uniffi::export]\n#[something]\nfn`.
    let declStart = i + 1;
    while (declStart < lines.length && lines[declStart].trim().startsWith('#[')) {
      declStart++;
    }
    if (declStart >= lines.length) continue;

    const firstDeclLine = lines[declStart].trim();

    // Case 1: `impl Foo {` block — iterate its methods.
    if (/^impl(?:\s|<)/.test(firstDeclLine) || /^unsafe\s+impl/.test(firstDeclLine)) {
      // Extract the type name. Handles `impl Foo`, `impl<T> Foo<T>`, and
      // `impl TraitName for Foo`. For trait impls we want the concrete type.
      const implName = (() => {
        const traitFor = firstDeclLine.match(/^impl(?:<[^>]*>)?\s+\S+\s+for\s+(\w+)/);
        if (traitFor) return traitFor[1];
        const direct = firstDeclLine.match(/^impl(?:<[^>]*>)?\s+(\w+)/);
        return direct ? direct[1] : undefined;
      })();

      const implEnd = findImplBlockEnd(lines, declStart);
      for (let j = declStart + 1; j < implEnd; j++) {
        const raw = lines[j];
        const trimmed = raw.trim();
        // Only consider lines that begin a fn declaration. `fn` must be
        // preceded by start-of-line, whitespace, or `pub` — we reject occurrences
        // inside comments or within parameter/type positions.
        if (trimmed.startsWith('//')) continue;
        if (!/^(?:pub\s+)?fn\s+\w/.test(trimmed)) continue;

        const decl = parseFnDecl(lines, j);
        if (!decl) continue;

        exports.push({
          name: decl.name,
          camelName: snakeToCamel(decl.name),
          file: relativePath,
          line: decl.line,
          returnType: decl.returnType,
          params: decl.params,
          object: implName,
        });
      }
      continue;
    }

    // Case 2: standalone function.
    if (/^(?:pub\s+)?fn\s+\w/.test(firstDeclLine)) {
      const decl = parseFnDecl(lines, declStart);
      if (!decl) continue;
      exports.push({
        name: decl.name,
        camelName: snakeToCamel(decl.name),
        file: relativePath,
        line: decl.line,
        returnType: decl.returnType,
        params: decl.params,
      });
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
    [
      ...existingContent.matchAll(
        /(?:["']name["']|name)\s*:\s*["']([A-Za-z0-9_]+)["']/g
      ),
    ].map((m) => m[1])
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

// Collect the set of `#[uniffi::export] impl` types so tests can assert the
// domain-object surface. Preserves first-seen order.
function collectUniffiObjects(allExports: FfiExport[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const exp of allExports) {
    if (exp.object && !seen.has(exp.object)) {
      seen.add(exp.object);
      out.push(exp.object);
    }
  }
  return out;
}

// Default: generate manifest
{
  console.log(`Found ${exports.length} FFI exports:\n`);

  const standaloneCount = exports.filter((e) => !e.object).length;
  const methodCount = exports.filter((e) => e.object).length;
  const uniffiObjects = collectUniffiObjects(exports);

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
      const prefix = exp.object ? `${exp.object}::` : '';
      console.log(`  ${exp.line}: ${prefix}${exp.name}(${params}) -> ${exp.returnType}`);
      console.log(`       TS: ${exp.camelName}`);
    }
  }

  console.log(
    `\n\nTotal: ${exports.length} FFI exports ` +
      `(${standaloneCount} standalone + ${methodCount} methods in ` +
      `${uniffiObjects.length} UniFFI Objects)`
  );

  // Output as TypeScript constant for tests
  const tsOutput = path.resolve(__dirname, '../src/__tests__/bindings/ffi-exports.generated.ts');
  const tsContent = `/**
 * AUTO-GENERATED - DO NOT EDIT
 * Generated by: npx tsx scripts/extract-ffi-exports.ts
 *
 * This file contains the expected FFI exports extracted from Rust source.
 * Used by tests to validate TypeScript bindings match Rust exports.
 *
 * ${standaloneCount} standalone \`#[uniffi::export]\` functions plus
 * ${methodCount} methods inside \`#[uniffi::export] impl\` blocks across
 * ${uniffiObjects.length} UniFFI Objects.
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
  /** If defined, the UniFFI Object that owns this method. */
  object?: string;
}

/**
 * All FFI exports from Rust source.
 * Total: ${exports.length} exports (${standaloneCount} standalone + ${methodCount} methods)
 */
export const FFI_EXPORTS: FfiExportInfo[] = ${JSON.stringify(
    exports.map(({ name, camelName, file, line, object }) =>
      object ? { name, camelName, file, line, object } : { name, camelName, file, line }
    ),
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
 *
 * Deduplicated — UniFFI objects share method names like \`new\`, \`remove\`,
 * \`create\`, etc. Use \`FFI_EXPORTS\` with \`file\`/\`line\` when the caller
 * needs to distinguish across objects.
 */
export const RUST_TO_TS_NAME: Record<string, string> = {
${Array.from(new Map(exports.map((e) => [e.name, e.camelName])).entries())
  .map(([name, camel]) => `  '${name}': '${camel}',`)
  .join('\n')}
};

/**
 * UniFFI Objects that expose methods via \`#[uniffi::export] impl\` blocks.
 * Each generates a TypeScript class in the generated bindings.
 */
export const UNIFFI_OBJECTS = [
${uniffiObjects.map((o) => `  '${o}',`).join('\n')}
] as const;
`;

  fs.writeFileSync(tsOutput, tsContent);
  console.log(`\nGenerated: ${tsOutput}`);
}
