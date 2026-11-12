#!/usr/bin/env node
// Writes web/connect/schema.d.ts: the types the connect page reads off the
// link, copied from the engine's own generated bindings.
//
// The method table (web/connect/methods.json, rendered from `METHODS` in the
// engine) names the record each method asks and answers. This copies each of
// those records, and every record, enum and alias they reference, out of
// modules/veloqrs/src/generated/veloqrs.ts, then adds a `Methods` map from a
// method name to its params and result. The link carries JSON that serde
// writes, not the bytes UniFFI lifts, so the copy is rewritten to that form:
//   - an optional field is `T | null`, because serde writes `None` as null;
//   - an enum is the union of its variants' camelCase names;
//   - a byte or float run is `Base64`, one base64 string;
//   - a 64-bit integer is `number`, which is exact up to 2^53;
//   - a map is a plain object.
// A shape it cannot say that way stops the run with the type's name, so a
// method added over such a record is a decision rather than a wrong type.
//
// Usage: node scripts/generate-link-schema.mjs [--check]
//   --check  compare with the file on disk and exit 1 on a difference

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { trackedText } from './lib/indexedSources.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const METHODS_FILE = 'web/connect/methods.json';
export const BINDINGS_FILE = 'modules/veloqrs/src/generated/veloqrs.ts';
export const SCHEMA_FILE = 'web/connect/schema.d.ts';

/** Types written out as themselves. */
const PRIMITIVES = new Set(['string', 'number', 'boolean', 'null', 'undefined']);
/** Types a field names that stand for a run of bytes. */
const BYTE_RUNS = new Set(['Uint8Array', 'Float32Array', 'ArrayBuffer']);

/**
 * Every top-level declaration of the bindings, with the doc comment before it.
 * @param {string} text
 */
export function readDeclarations(text) {
  const lines = text.split('\n');
  /** @type {Map<string, { kind: 'record' | 'enum' | 'alias' | 'other', doc: string[], body: string[] }>} */
  const found = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const record = /^export type (\w+) = \{$/.exec(line);
    const enumeration = /^export enum (\w+) \{$/.exec(line);
    const alias = /^export type (\w+) = (.+);$/.exec(line);
    const other = /^export type (\w+) =\s*$|^export type (\w+) = \w+<$/.exec(line);
    const name = record?.[1] ?? enumeration?.[1] ?? alias?.[1] ?? other?.[1] ?? other?.[2];
    if (!name) continue;
    const doc = [];
    for (let at = i - 1; at >= 0 && /^( ?\*|\/\*\*)/.test(lines[at]); at--) doc.unshift(lines[at]);
    const body = [];
    let kind = /** @type {'record' | 'enum' | 'alias' | 'other'} */ ('other');
    if (record || enumeration) {
      kind = record ? 'record' : 'enum';
      const close = record ? '};' : '}';
      let at = i + 1;
      while (lines[at] !== close) body.push(lines[at++]);
    } else if (alias) {
      kind = 'alias';
      body.push(alias[2]);
    }
    if (!found.has(name)) found.set(name, { kind, doc, body });
  }
  return found;
}

/**
 * Join a record body into one statement per field, with the doc lines kept.
 * @param {string[]} body
 */
function fieldsOf(body) {
  /** @type {{ doc: string[], text: string }[]} */
  const fields = [];
  let doc = [];
  let pending = '';
  for (const line of body) {
    const trimmed = line.trim();
    if (pending === '' && (trimmed.startsWith('/**') || trimmed.startsWith('*'))) {
      doc.push(line);
    } else if (trimmed !== '' || pending !== '') {
      pending += (pending ? ' ' : '') + trimmed;
      if (pending.endsWith(';')) {
        fields.push({ doc, text: pending });
        doc = [];
        pending = '';
      }
    }
  }
  return fields;
}

/**
 * Say a field's TypeScript type the way serde writes it, collecting the
 * names it refers to.
 * @param {string} owner
 * @param {string} type
 * @param {Set<string>} refs
 */
function jsonType(owner, type, refs) {
  let out = type
    .replace(/\/\*.*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\bbigint\b/g, 'number')
    .replace(/\| undefined/g, '| null');
  out = out.replace(/\bMap<\s*(\w+)\s*,/g, (_all, key) => {
    if (key !== 'string') throw new Error(`${owner}: a map keyed by ${key} is not a JSON object`);
    return 'Record<string,';
  });
  // The repository's lint writes an array as `T[]`.
  for (let before = ''; before !== out;) {
    before = out;
    out = out.replace(/\bArray<([^<>]+)>/g, (_all, item) =>
      /^[\w.]+$/.test(item) ? `${item}[]` : `(${item})[]`
    );
  }
  out = out.replace(/\b(\w+)\b/g, (word) => {
    if (BYTE_RUNS.has(word)) return 'Base64';
    if (PRIMITIVES.has(word) || word === 'Record' || word === 'Base64') {
      return word;
    }
    refs.add(word);
    return word;
  });
  return out;
}

/**
 * Render the schema text.
 * @param {{ protocol: number, methods: { name: string, params: string, result: string }[] }} table
 * @param {string} bindings
 */
export function renderSchema(table, bindings) {
  const declared = readDeclarations(bindings);
  /** @type {Map<string, string>} */
  const rendered = new Map();
  /** @param {string} name */
  function include(name) {
    if (rendered.has(name)) return;
    const found = declared.get(name);
    if (!found) throw new Error(`${name} is not declared in ${BINDINGS_FILE}`);
    rendered.set(name, ''); // a record that refers to itself
    /** @type {Set<string>} */
    const refs = new Set();
    const doc = found.doc.length ? `${found.doc.join('\n')}\n` : '';
    if (found.kind === 'record') {
      const fields = fieldsOf(found.body).map(({ doc: fieldDoc, text }) => {
        const match = /^(\w+)(\?)?: (.+);$/.exec(text);
        if (!match) throw new Error(`${name}: cannot read the field \`${text}\``);
        const [, field, optional, type] = match;
        const written = jsonType(`${name}.${field}`, type, refs);
        const lines = fieldDoc.length ? `${fieldDoc.join('\n')}\n` : '';
        return `${lines}  ${field}: ${optional ? `${written} | null` : written};`;
      });
      rendered.set(name, `${doc}export type ${name} = {\n${fields.join('\n')}\n};\n`);
    } else if (found.kind === 'enum') {
      const names = found.body
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('/') && !line.startsWith('*'))
        .map((line) => {
          const variant = /^(\w+)(?: = -?\d+)?,$/.exec(line);
          if (!variant) throw new Error(`${name}: the variant \`${line}\` carries data`);
          return `'${variant[1][0].toLowerCase()}${variant[1].slice(1)}'`;
        });
      rendered.set(name, `${doc}export type ${name} = ${names.join(' | ')};\n`);
    } else if (found.kind === 'alias' && !/InstanceType/.test(found.body[0])) {
      const written = jsonType(name, found.body[0], refs);
      rendered.set(name, `export type ${name} = ${written};\n`);
    } else {
      throw new Error(
        `${name} is a data-carrying enum or an object, which the link does not yet say in JSON`
      );
    }
    for (const ref of refs) include(ref);
  }

  for (const method of table.methods) {
    include(method.params);
    include(method.result);
  }
  const types = [...rendered.keys()].sort().map((name) => rendered.get(name));
  const methods = table.methods
    .map((method) => `  '${method.name}': { params: ${method.params}; result: ${method.result} };`)
    .join('\n');
  return [
    `// Generated by scripts/generate-link-schema.mjs from ${METHODS_FILE} and`,
    `// ${BINDINGS_FILE}. Do not edit: change the engine and generate again.`,
    '//',
    '// These are the shapes the link carries as JSON, protocol ' + table.protocol + '.',
    '',
    '/** A run of bytes as one base64 string; a run of floats is its little-endian bytes. */',
    'export type Base64 = string;',
    '',
    types.join('\n'),
    '/** The name of each method a linked browser may ask, with what it sends and gets back. */',
    'export type Methods = {',
    methods,
    '};',
    '',
  ].join('\n');
}

/**
 * The schema for the method table and bindings `read` returns.
 * @param {(file: string) => string | undefined} read
 */
export function currentSchema(read) {
  const table = read(METHODS_FILE);
  const bindings = read(BINDINGS_FILE);
  if (table === undefined || bindings === undefined) {
    throw new Error(`${METHODS_FILE} and ${BINDINGS_FILE} must both exist`);
  }
  return renderSchema(JSON.parse(table), bindings);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // `--root` points the script at another tree, so the rule itself can be tested.
  const rootFlag = process.argv.indexOf('--root');
  const root = rootFlag === -1 ? ROOT : resolve(process.argv[rootFlag + 1]);
  const onDisk = (/** @type {string} */ file) => {
    try {
      return readFileSync(join(root, file), 'utf8');
    } catch {
      return undefined;
    }
  };
  if (process.argv.includes('--check')) {
    // A drift check reads the index, so it judges the tree a commit or merge
    // records and not whichever half another session has open.
    const index = (/** @type {string} */ file) => trackedText(root, file);
    let failure = null;
    try {
      if (currentSchema(index) !== index(SCHEMA_FILE)) {
        failure = `${SCHEMA_FILE} is older than the method table or the engine's records. Run: node scripts/generate-link-schema.mjs`;
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (failure) {
      console.error(failure);
      process.exit(1);
    }
  } else {
    writeFileSync(join(root, SCHEMA_FILE), currentSchema(onDisk));
  }
}
