/**
 * The FFI surface, read from the `#[uniffi::export]` items in the Rust source.
 *
 * Computed on demand rather than committed: the Rust tree is the only input, so
 * a fresh clone derives the same manifest the tests read.
 */

import * as fs from 'fs';
import * as path from 'path';

export const RUST_SRC_DIR = path.resolve(__dirname, '../../modules/veloqrs/rust/veloqrs/src');

export interface FfiExport {
  name: string;
  camelName: string;
  /** Source file relative to the Rust `src` directory. */
  file: string;
  /** 1-indexed line of the `fn` declaration. */
  line: number;
  returnType: string;
  params: string[];
  /**
   * The item's doc comment on one line. UniFFI hashes the metadata buffer and
   * that buffer carries the docstring, so this is part of the ABI.
   */
  docs: string;
  /** The UniFFI Object that owns this method, if it is one. */
  object?: string;
}

export interface FfiExportInfo {
  name: string;
  camelName: string;
  file: string;
  line: number;
  paramCount: number;
  returnType: string;
  docs: string;
  object?: string;
}

export interface FfiManifest {
  FFI_EXPORTS: FfiExportInfo[];
  /** Every TypeScript function name (camelCase). */
  EXPECTED_TS_FUNCTIONS: Set<string>;
  /** Rust to TypeScript name, deduplicated across objects that share a method name. */
  RUST_TO_TS_NAME: Record<string, string>;
  /** Objects exposing methods through `#[uniffi::export] impl`, in first-seen order. */
  UNIFFI_OBJECTS: string[];
}

function snakeToCamel(name: string): string {
  return name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** The line index of the `}` closing the block opened at or after `startLine`. */
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

/** A function signature starting at `startLine`, or null when it is not one. */
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

  // An async export resolves to a promise in TypeScript, recorded as the awaited type.
  const match = signature.match(
    /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([\s\S]*?)\)(?:\s*->\s*([^{;]+?))?\s*[{;]/
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
    line: startLine + 1,
  };
}

/**
 * The doc comment above `declLine` on one line. Attributes and blank lines
 * between `///` blocks are skipped, as rustc attaches every outer doc block
 * above an item whether or not a blank line separates them.
 */
function docsAbove(lines: string[], declLine: number): string {
  const collected: string[] = [];
  for (let i = declLine - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('#[') || trimmed.length === 0) continue;
    if (trimmed.startsWith('///')) {
      collected.push(trimmed.slice(3).trim());
      continue;
    }
    break;
  }
  return collected.reverse().join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Every export in one file: standalone `#[uniffi::export] fn`, and every `fn`
 * inside an `#[uniffi::export] impl`, constructors included.
 */
function extractExportsFromFile(filePath: string, srcDir: string): FfiExport[] {
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  const exports: FfiExport[] = [];
  const relativePath = path.relative(srcDir, filePath);

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '#[uniffi::export]') continue;

    let declStart = i + 1;
    while (declStart < lines.length && lines[declStart].trim().startsWith('#[')) {
      declStart++;
    }
    if (declStart >= lines.length) continue;

    const firstDeclLine = lines[declStart].trim();

    if (/^impl(?:\s|<)/.test(firstDeclLine) || /^unsafe\s+impl/.test(firstDeclLine)) {
      // For `impl Trait for Foo` the concrete type is the object.
      const implName = (() => {
        const traitFor = firstDeclLine.match(/^impl(?:<[^>]*>)?\s+\S+\s+for\s+(\w+)/);
        if (traitFor) return traitFor[1];
        const direct = firstDeclLine.match(/^impl(?:<[^>]*>)?\s+(\w+)/);
        return direct ? direct[1] : undefined;
      })();

      const implEnd = findImplBlockEnd(lines, declStart);
      for (let j = declStart + 1; j < implEnd; j++) {
        const trimmed = lines[j].trim();
        if (trimmed.startsWith('//')) continue;
        if (!/^(?:pub\s+)?(?:async\s+)?fn\s+\w/.test(trimmed)) continue;

        const decl = parseFnDecl(lines, j);
        if (!decl) continue;

        exports.push({
          name: decl.name,
          camelName: snakeToCamel(decl.name),
          file: relativePath,
          line: decl.line,
          returnType: decl.returnType,
          params: decl.params,
          docs: docsAbove(lines, j),
          ...(implName !== undefined && { object: implName }),
        });
      }
      continue;
    }

    if (/^(?:pub\s+)?(?:async\s+)?fn\s+\w/.test(firstDeclLine)) {
      const decl = parseFnDecl(lines, declStart);
      if (!decl) continue;
      exports.push({
        name: decl.name,
        camelName: snakeToCamel(decl.name),
        file: relativePath,
        line: decl.line,
        returnType: decl.returnType,
        params: decl.params,
        // The comment sits above the export attribute, not above the `fn`.
        docs: docsAbove(lines, i),
      });
    }
  }

  return exports;
}

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

/** Every export under `srcDir`, sorted by file then line. */
export function extractFfiExports(srcDir: string = RUST_SRC_DIR): FfiExport[] {
  const exports = findRustFiles(srcDir).flatMap((file) => extractExportsFromFile(file, srcDir));
  exports.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });
  return exports;
}

/**
 * Methods of every `#[uniffi::export(...)] trait`, such as the `with_foreign`
 * callback interfaces. The codegen copies their argument names into the C++
 * bridge, so the keyword check reads them, but they are not exports Rust
 * exposes to TypeScript and stay out of the manifest.
 */
export function extractTraitMethods(
  srcDir: string = RUST_SRC_DIR
): { name: string; object: string; file: string; line: number; params: string[] }[] {
  const methods: ReturnType<typeof extractTraitMethods> = [];
  for (const filePath of findRustFiles(srcDir)) {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    const file = path.relative(srcDir, filePath);
    for (let i = 0; i < lines.length; i++) {
      if (!/^#\[uniffi::export\(.*\)\]$/.test(lines[i].trim())) continue;
      let declStart = i + 1;
      while (declStart < lines.length && lines[declStart].trim().startsWith('#[')) declStart++;
      const trait = lines[declStart]?.trim().match(/^(?:pub\s+)?trait\s+(\w+)/);
      if (!trait) continue;
      const end = findImplBlockEnd(lines, declStart);
      for (let j = declStart + 1; j < end; j++) {
        if (!/^(?:async\s+)?fn\s+\w/.test(lines[j].trim())) continue;
        const decl = parseFnDecl(lines, j);
        if (decl) methods.push({ ...decl, object: trait[1], file });
      }
    }
  }
  return methods;
}

/** The manifest the binding tests read, built from `exports`. */
export function buildFfiManifest(exports: FfiExport[]): FfiManifest {
  const objects: string[] = [];
  for (const e of exports) {
    if (e.object && !objects.includes(e.object)) objects.push(e.object);
  }
  return {
    FFI_EXPORTS: exports.map(
      ({ name, camelName, file, line, object, params, returnType, docs }) => {
        const base = { name, camelName, file, line, paramCount: params.length, returnType, docs };
        return object ? { ...base, object } : base;
      }
    ),
    EXPECTED_TS_FUNCTIONS: new Set(exports.map((e) => e.camelName)),
    RUST_TO_TS_NAME: Object.fromEntries(new Map(exports.map((e) => [e.name, e.camelName]))),
    UNIFFI_OBJECTS: objects,
  };
}

let memo: FfiManifest | undefined;

/** The manifest of the checked-out Rust tree, read once per module instance. */
export function ffiManifest(): FfiManifest {
  memo ??= buildFfiManifest(extractFfiExports());
  return memo;
}

export const GENERATED_BINDINGS = path.resolve(
  __dirname,
  '../../modules/veloqrs/src/generated/veloqrs.ts'
);

const DECLARATION = /^ {0,2}(?:export )?(?:static )?(?:async )?(?:function )?\w+\s*\(/;

/** The JSDoc ending on the line above `line`, on one line, or '' when there is none. */
function jsDocAbove(lines: string[], line: number): string {
  if (lines[line - 1]?.trim() !== '*/') return '';
  const collected: string[] = [];
  for (let i = line - 2; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === '/**') break;
    collected.push(trimmed.replace(/^\*\s?/, ''));
  }
  return collected.reverse().join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * The docstring each export carries in the generated bindings, keyed as
 * `Object::name` or `<standalone>::name`. An export the bindings do not call
 * is absent.
 */
export function bindingDocs(exports: FfiExport[], bindingsSource: string): Map<string, string> {
  const lines = bindingsSource.split('\n');
  const docs = new Map<string, string>();
  for (const e of exports) {
    const symbols = e.object
      ? [
          `ubrn_uniffi_veloqrs_fn_method_${e.object.toLowerCase()}_${e.name}(`,
          `ubrn_uniffi_veloqrs_fn_constructor_${e.object.toLowerCase()}_${e.name}(`,
        ]
      : [`ubrn_uniffi_veloqrs_fn_func_${e.name}(`];
    const call = lines.findIndex((l) => symbols.some((s) => l.includes(s)));
    if (call < 0) continue;
    let decl = call;
    while (decl > 0 && !DECLARATION.test(lines[decl])) decl--;
    docs.set(exportKey(e), jsDocAbove(lines, decl));
  }
  return docs;
}

export function exportKey(e: { object?: string; name: string }): string {
  return `${e.object ?? '<standalone>'}::${e.name}`;
}

/**
 * Exports whose Rust doc comment differs from the one in the generated
 * bindings. The docstring is hashed into the checksum the bindings assert, so
 * each of these would fail `uniffiEnsureInitialized` with `ApiChecksumMismatch`.
 */
export function docDrift(exports: FfiExport[], bindingsSource: string): string[] {
  const generated = bindingDocs(exports, bindingsSource);
  return exports
    .filter((e) => generated.has(exportKey(e)) && generated.get(exportKey(e)) !== e.docs)
    .map(exportKey);
}
