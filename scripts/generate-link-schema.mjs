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
// It also writes web/connect/schema.json, the same shapes as one JSON Schema
// document for a client in any language: a definition per type, and per method
// its doc string, its params and result `$ref`, its write flag and the protocol window. It is
// read back from the TypeScript just rendered, so the two cannot disagree.
//
// Usage: node scripts/generate-link-schema.mjs [--check]
//   --check  compare with the files on disk and exit 1 on a difference

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { trackedText } from './lib/indexedSources.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const METHODS_FILE = 'web/connect/methods.json';
export const BINDINGS_FILE = 'modules/veloqrs/src/generated/veloqrs.ts';
export const SCHEMA_FILE = 'web/connect/schema.d.ts';
export const JSON_SCHEMA_FILE = 'web/connect/schema.json';
/**
 * The type the link names outside the method table: the reason a farewell event gives before the
 * phone hangs up, which a page reads to say why. The engine's enum is rendered like any other.
 */
export const FAREWELL_TYPE = 'DisconnectReason';
const PRETTIER = join(ROOT, 'node_modules/prettier/bin/prettier.cjs');
const PRETTIER_CONFIG = join(ROOT, 'config/.prettierrc');
const PRETTIER_IGNORE = join(ROOT, 'config/.prettierignore');

/** Types written out as themselves. */
const PRIMITIVES = new Set(['string', 'number', 'boolean', 'null', 'undefined']);
/** Types a field names that stand for a run of bytes. */
const BYTE_RUNS = new Set(['Uint8Array', 'Float32Array', 'ArrayBuffer']);

/**
 * Enums that carry data, which the bindings declare as classes and this
 * script cannot read back. serde writes one as its variant name, or as an
 * object holding the variant's fields under that name, with the fields in
 * camelCase (`rename_all_fields`). Each is written here, with the types it
 * names; the engine's tests pin the JSON each variant serialises to.
 * @type {Map<string, { text: string, refs: string[] }>}
 */
const DATA_ENUMS = new Map([
  [
    'FfiCorrelation',
    {
      text: [
        '  | { tooFew: {\n/** Unit: count. */ n: number } }',
        '  | { undefined: {\n/** Unit: count. */ n: number } }',
        '  | { inconclusive: {\n/** Unit: ratio. */ r: number; /** Unit: count. */ n: number; /** Unit: ratio. */ low: number; /** Unit: ratio. */ high: number } }',
        '  | { mover: {\n/** Unit: ratio. */ r: number; /** Unit: count. */ n: number; /** Unit: ratio. */ low: number; /** Unit: ratio. */ high: number } }',
      ].join('\n'),
      refs: [],
    },
  ],
  [
    'FfiCatalogueEmptyReason',
    {
      text: [
        "  | 'noGpsActivities'",
        '  | { notYetRun: {\n/** Unit: count. */ awaiting: number } }',
        '  | { running: {\nphase: string;\n/** Unit: percent. */ percent: number } }',
        '  | { held: { hold: FfiDetectionHold } }',
        '  | { noneFound: {\n/** Unit: count. */ minActivities: number } }',
      ].join('\n'),
      refs: ['FfiDetectionHold'],
    },
  ],
  [
    'FfiDetectionHold',
    {
      text: [
        "  | 'elevationPaused'",
        "  | 'elevationRunning'",
        '  | { elevationWaiting: {\n/** Unit: count. */ remaining: number } }',
        "  | 'cutover'",
      ].join('\n'),
      refs: [],
    },
  ],
]);

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

/** The JSON type a converter of a scalar reads and writes. */
const SCALAR_CONVERTERS = new Map([
  ['FfiConverterUInt8', 'number'],
  ['FfiConverterUInt16', 'number'],
  ['FfiConverterUInt32', 'number'],
  ['FfiConverterInt8', 'number'],
  ['FfiConverterInt16', 'number'],
  ['FfiConverterInt32', 'number'],
  ['FfiConverterFloat32', 'number'],
  ['FfiConverterFloat64', 'number'],
  ['FfiConverterBool', 'boolean'],
  ['FfiConverterString', 'string'],
]);

/**
 * The units of the fields of the data-carrying enums read off the bindings, which
 * carry no doc comment on a variant's field. Keyed `Enum.variant.field`.
 * @type {Map<string, string>}
 */
const ENUM_FIELD_UNITS = new Map([
  ['FfiMapEmptyReason.filtered.mapped', 'count'],
  ['FfiMapEmptyReason.tracksPending.activities', 'count'],
  ['FfiMapEmptyReason.tracksPending.pending', 'count'],
  ['FfiMapEmptyReason.noGps.activities', 'count'],
]);

/**
 * A data-carrying enum as serde writes it with `rename_all = "camelCase"`: a
 * variant with no fields is its name as a string, one with fields is an object
 * with the name as its one key. The variants and their fields are read off the
 * enum's converter in the bindings, and a field of any type but a scalar stops
 * the run, since the scalar converters are the shapes known to match.
 * @param {string} name
 * @param {string} bindings
 */
function dataEnumType(name, bindings) {
  const start = bindings.indexOf(`const FfiConverterType${name} = (() => {`);
  const end = bindings.indexOf('\n})();', start);
  if (start < 0 || end < 0) throw new Error(`${name}: no converter in ${BINDINGS_FILE}`);
  const converter = bindings.slice(start, end);
  const read = converter.slice(0, converter.indexOf('writeIntoCursor'));
  const variants = [];
  for (const found of read.matchAll(
    new RegExp(`return new ${name}\\.(\\w+)\\((?:\\{([^}]*)\\})?\\);`, 'g')
  )) {
    const [, variant, body] = found;
    const key = `${variant[0].toLowerCase()}${variant.slice(1)}`;
    const fields = [];
    for (const field of (body ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)) {
      const parsed = /^(\w+): (\w+)\.readFromCursor\(c\)$/.exec(field);
      const type = parsed && SCALAR_CONVERTERS.get(parsed[2]);
      if (!parsed || !type || /[A-Z]/.test(parsed[1])) {
        throw new Error(`${name}.${variant}: cannot say the field \`${field}\` in JSON`);
      }
      const unit = ENUM_FIELD_UNITS.get(`${name}.${key}.${parsed[1]}`);
      fields.push(`${unit ? `/** Unit: ${unit}. */ ` : ''}${parsed[1]}: ${type}`);
    }
    variants.push(fields.length === 0 ? `'${key}'` : `{ ${key}: {\n${fields.join(';\n')} } }`);
  }
  if (variants.length === 0) throw new Error(`${name}: no variants in its converter`);
  return variants.join(' | ');
}

/**
 * The text as `npm run format` writes it, under the repository's Prettier
 * config. `format:check` reads the schema back, so a generated file that
 * Prettier would change fails the audit on the next run.
 * @param {string} text
 */
function formatAsRepository(text) {
  return execFileSync(
    process.execPath,
    [
      PRETTIER,
      '--config',
      PRETTIER_CONFIG,
      '--ignore-path',
      PRETTIER_IGNORE,
      '--stdin-filepath',
      SCHEMA_FILE,
    ],
    { cwd: ROOT, input: text, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
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
    const dataEnum = DATA_ENUMS.get(name);
    if (dataEnum) {
      const bound = declared.get(name);
      const doc = bound?.doc.length ? `${bound.doc.join('\n')}\n` : '';
      rendered.set(name, `${doc}export type ${name} =\n${dataEnum.text};\n`);
      for (const ref of dataEnum.refs) include(ref);
      return;
    }
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
    } else if (found.kind === 'alias' && found.body[0].trim() === '{}') {
      // An empty record is written on one line, `{};`, and is an object with no keys.
      rendered.set(name, `${doc}export type ${name} = Record<string, never>;\n`);
    } else if (found.kind === 'alias' && !/InstanceType/.test(found.body[0])) {
      const written = jsonType(name, found.body[0], refs);
      rendered.set(name, `export type ${name} = ${written};\n`);
    } else if (
      found.kind === 'other' ||
      (found.kind === 'alias' && /InstanceType/.test(found.body[0]))
    ) {
      rendered.set(name, `${doc}export type ${name} = ${dataEnumType(name, bindings)};\n`);
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
  include(FAREWELL_TYPE);
  const types = [...rendered.keys()].sort().map((name) => rendered.get(name));
  const methods = table.methods
    .map((method) => `  '${method.name}': { params: ${method.params}; result: ${method.result} };`)
    .join('\n');
  return formatAsRepository(
    [
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
    ].join('\n')
  );
}

/**
 * The units a field may declare, by the name the engine writes after `Unit:`
 * in the doc comment beside the field. The set is closed: an unknown name stops
 * the run, so a unit is never written that a client cannot look up here.
 * @type {Record<string, string>}
 */
export const UNITS = {
  metre: 'a length in metres',
  second: 'a duration in seconds',
  millisecond: 'a duration in milliseconds',
  metre_per_second: 'a speed in metres a second',
  watt: 'a power in watts',
  watt_per_kilogram: 'a power in watts a kilogram',
  beat_per_minute: 'a heart rate in beats a minute',
  kilogram: 'a mass in kilograms',
  kilocalorie: 'an energy in kilocalories',
  degree_celsius: 'a temperature in degrees Celsius',
  percent: 'a share of a whole, in percent',
  tss: 'a training load in TSS',
  tss_per_week: 'a change in training load over a week, in TSS',
  epoch_second: 'an instant as seconds since the Unix epoch',
  iso_date: 'a calendar date as YYYY-MM-DD',
  count: 'a number of things',
  point: 'a point on the rating or score scale the field names',
  degree: 'an angle of latitude or longitude, in degrees',
  hour: 'a duration in hours',
  day: 'a duration in days',
  year: 'a calendar year, as a whole number',
  month: 'a calendar month, 1 to 12',
  ratio: 'a dimensionless ratio, or a fraction of one',
  index: 'a position in a list, series or scale the field names, counted as its doc says',
  identifier: 'an opaque number that names a thing, compared and never added',
  code: 'a whole number from the small set its doc comment lists',
  byte: 'a size in bytes',
  epoch_millisecond: 'an instant as milliseconds since the Unix epoch',
  joule: 'an energy in joules',
  metre_per_hour: 'a climb rate in metres an hour',
  second_per_kilometre: 'a pace in seconds a kilometre',
  beat_second_per_kilometre: 'a heart rate in beats a minute times a pace in seconds a kilometre',
  tss_per_day: 'a change in training load a day, in TSS',
  tss_or_percent: 'form, in TSS or as a percent of fitness, as the flag beside the field says',
  trimp: 'a training impulse in TRIMP units',
  swolf: 'a swimming efficiency score: seconds plus strokes for a length',
  standard_deviation: 'a distance from an average, in standard deviations',
  varies: 'a number whose unit another field of the record, or the field doc, names',
};

const UNIT_LINE = /^Unit: ([A-Za-z_]\w*)\.$/;

/**
 * Split a field's doc comment into its prose and the unit its last line names,
 * if it names one. `Unit: FfiCadenceUnit.` names an enum: the number is in the
 * unit that enum's value gives, so the schema refers to that type.
 * @param {string | undefined} text
 * @returns {{ description: string | undefined, unit: string | undefined }}
 */
export function splitUnit(text) {
  if (text === undefined) return { description: undefined, unit: undefined };
  const lines = text.split('\n');
  const last = lines.length - 1;
  const match = UNIT_LINE.exec(lines[last]?.trim() ?? '');
  if (!match) return { description: text || undefined, unit: undefined };
  const rest = lines.slice(0, last).join('\n').trim();
  return { description: rest || undefined, unit: match[1] };
}

/**
 * The schema for a unit a field names: a vocabulary name as a string, or a
 * reference to the enum whose values are the units.
 * @param {string} owner
 * @param {string} unit
 */
function unitSchema(owner, unit) {
  if (Object.hasOwn(UNITS, unit)) return unit;
  if (/^[A-Z]/.test(unit)) return { $ref: `#/$defs/${unit}` };
  throw new Error(`${owner}: \`Unit: ${unit}.\` is not a unit in the vocabulary`);
}

/**
 * One type node of the rendered TypeScript as a JSON Schema. The grammar is
 * the one `jsonType` writes, and anything else stops the run.
 * @param {string} owner
 * @param {ts.TypeNode} node
 * @returns {Record<string, unknown>}
 */
function schemaOf(owner, node) {
  const here = (/** @type {ts.TypeNode} */ child) => schemaOf(owner, child);
  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword:
      return { type: 'string' };
    case ts.SyntaxKind.NumberKeyword:
      return { type: 'number' };
    case ts.SyntaxKind.BooleanKeyword:
      return { type: 'boolean' };
    case ts.SyntaxKind.NullKeyword:
      return { type: 'null' };
    default:
  }
  if (ts.isParenthesizedTypeNode(node)) return here(node.type);
  if (ts.isLiteralTypeNode(node)) {
    if (ts.isStringLiteral(node.literal)) return { const: node.literal.text };
    if (node.literal.kind === ts.SyntaxKind.NullKeyword) return { type: 'null' };
  }
  if (ts.isArrayTypeNode(node)) return { type: 'array', items: here(node.elementType) };
  if (ts.isUnionTypeNode(node)) {
    const parts = node.types.map(here);
    if (parts.every((part) => typeof part.const === 'string')) {
      return { type: 'string', enum: parts.map((part) => part.const) };
    }
    return { anyOf: parts };
  }
  if (ts.isTypeLiteralNode(node)) {
    /** @type {Record<string, unknown>} */
    const properties = {};
    for (const member of node.members) {
      if (!ts.isPropertySignature(member) || !member.type || !ts.isIdentifier(member.name)) {
        throw new Error(`${owner}: cannot read a member of an object type as JSON Schema`);
      }
      const doc = ts.getJSDocCommentsAndTags(member).find(ts.isJSDoc);
      const { description, unit } = splitUnit(
        doc ? ts.getTextOfJSDocComment(doc.comment) : undefined
      );
      properties[member.name.text] = {
        ...here(member.type),
        ...(description ? { description } : {}),
        ...(unit ? { unit: unitSchema(`${owner}.${member.name.text}`, unit) } : {}),
      };
    }
    return {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    };
  }
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const name = node.typeName.text;
    const args = node.typeArguments ?? [];
    if (name === 'Record' && args.length === 2) {
      return args[1].kind === ts.SyntaxKind.NeverKeyword
        ? { type: 'object', additionalProperties: false }
        : { type: 'object', additionalProperties: here(args[1]) };
    }
    if (args.length === 0) return { $ref: `#/$defs/${name}` };
  }
  throw new Error(`${owner}: cannot say \`${node.getText()}\` as JSON Schema`);
}

/**
 * Whether a property's JSON Schema is a number, a run of numbers, or a union
 * that holds one.
 * @param {Record<string, any>} schema
 * @returns {boolean}
 */
export function isNumericSchema(schema) {
  if (schema.type === 'number') return true;
  if (schema.type === 'array') return schema.items !== undefined && isNumericSchema(schema.items);
  return (schema.anyOf ?? []).some(isNumericSchema);
}

/**
 * Collect the numeric fields under a schema that name no unit, as `Type.field`
 * paths, and check each unit that names an enum refers to a type that exists.
 * @param {string} path
 * @param {Record<string, any>} schema
 * @param {Record<string, unknown>} defs
 * @param {string[]} out
 */
function unitlessUnder(path, schema, defs, out) {
  for (const member of schema.anyOf ?? []) unitlessUnder(path, member, defs, out);
  for (const [field, property] of Object.entries(schema.properties ?? {})) {
    const at = `${path}.${field}`;
    if (property.unit !== undefined && typeof property.unit !== 'string') {
      const target = property.unit.$ref.slice('#/$defs/'.length);
      if (!Object.hasOwn(defs, target)) throw new Error(`${at}: unit ${target} is not a type`);
    }
    if (isNumericSchema(property) && property.unit === undefined) out.push(at);
    unitlessUnder(at, property, defs, out);
  }
  if (schema.items) unitlessUnder(`${path}[]`, schema.items, defs, out);
}

/**
 * The JSON Schema document for the method table, read off the rendered
 * TypeScript schema.
 * @param {{ protocol: number, minProtocol: number, methods: { name: string, doc: string, params: string, result: string, write: boolean }[] }} table
 * @param {string} declarations the text `renderSchema` returned
 */
export function renderJsonSchema(table, declarations) {
  const source = ts.createSourceFile(SCHEMA_FILE, declarations, ts.ScriptTarget.Latest, true);
  /** @type {Record<string, any>} */
  const defs = {};
  for (const statement of source.statements) {
    if (!ts.isTypeAliasDeclaration(statement) || statement.name.text === 'Methods') continue;
    const name = statement.name.text;
    const doc = ts.getJSDocCommentsAndTags(statement).find(ts.isJSDoc);
    const description = doc ? ts.getTextOfJSDocComment(doc.comment) : undefined;
    defs[name] = { ...schemaOf(name, statement.type), ...(description ? { description } : {}) };
  }
  /** @type {string[]} */
  const unitless = [];
  for (const [name, schema] of Object.entries(defs)) unitlessUnder(name, schema, defs, unitless);
  const document = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Veloq link protocol',
    description: `Every method of the link with the JSON it takes and answers, protocol ${table.minProtocol} to ${table.protocol}.`,
    protocol: table.protocol,
    minProtocol: table.minProtocol,
    units: UNITS,
    farewells: { $ref: `#/$defs/${FAREWELL_TYPE}` },
    methods: table.methods.map((method) => ({
      name: method.name,
      write: method.write,
      description: method.doc,
      params: { $ref: `#/$defs/${method.params}` },
      result: { $ref: `#/$defs/${method.result}` },
    })),
    $defs: Object.fromEntries(Object.entries(defs).sort(([a], [b]) => (a < b ? -1 : 1))),
    unitless: unitless.sort(),
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * The JSON Schema for the method table and bindings `read` returns.
 * @param {(file: string) => string | undefined} read
 */
export function currentJsonSchema(read) {
  const table = JSON.parse(read(METHODS_FILE) ?? '');
  return renderJsonSchema(table, currentSchema(read));
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
      for (const [file, current] of [
        [SCHEMA_FILE, currentSchema],
        [JSON_SCHEMA_FILE, currentJsonSchema],
      ]) {
        if (current(index) !== index(file)) {
          failure = `${file} is older than the method table or the engine's records. Run: node scripts/generate-link-schema.mjs`;
          break;
        }
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
    writeFileSync(join(root, JSON_SCHEMA_FILE), currentJsonSchema(onDisk));
  }
}
