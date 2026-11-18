/**
 * Scenario: a client that does not run the page's formatting code reads each measurement's unit
 * from `schema.json`, which takes the unit the engine declares beside the field.
 * Expected behaviour: the feed card, activity summary, period stats, day load and wellness day
 * name the unit of every numeric field; a unit removed from the engine leaves its field unitless;
 * and the numeric fields that declare no unit are the committed figure, which only ever shrinks.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(__dirname, '../../..');
const SCRIPT = join(REPO, 'scripts/generate-link-schema.mjs');
const METHODS = 'web/connect/methods.json';
const BINDINGS = 'modules/veloqrs/src/generated/veloqrs.ts';
const COMMITTED = join(REPO, 'web/connect/schema.json');

/** The types whose every numeric field is a measurement the page draws. */
const MEASURED = [
  'FfiFeedCard',
  'FfiActivitySummary',
  'FfiPeriodStats',
  'FfiDayLoad',
  'FfiWellnessDay',
];

/**
 * Numeric fields of the link's types that declare no unit, counted over the whole schema. A
 * field gains a unit by declaring one in the engine, and this figure drops with it; a new
 * numeric field without a unit fails until it declares one.
 */
const UNITLESS_FIGURE = 0;

type Property = {
  type?: string;
  anyOf?: Property[];
  items?: Property;
  unit?: string | { $ref: string };
};

type Schema = {
  $defs: Record<string, { properties?: Record<string, Property> }>;
  unitless: string[];
};

function isNumeric(property: Property): boolean {
  if (property.type === 'number') return true;
  if (property.type === 'array') return property.items !== undefined && isNumeric(property.items);
  return (property.anyOf ?? []).some(isNumeric);
}

function generateFrom(bindings: string): Schema {
  const root = mkdtempSync(join(tmpdir(), 'link-units-'));
  try {
    mkdirSync(join(root, 'web/connect'), { recursive: true });
    mkdirSync(join(root, BINDINGS, '..'), { recursive: true });
    cpSync(join(REPO, METHODS), join(root, METHODS));
    writeFileSync(join(root, BINDINGS), bindings);
    execFileSync('node', [SCRIPT, '--root', root], { stdio: 'pipe' });
    return JSON.parse(readFileSync(join(root, 'web/connect/schema.json'), 'utf8'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The bindings with the unit line removed from one field's doc comment. */
function withoutUnit(bindings: string, type: string, field: string): string {
  const start = bindings.indexOf(`export type ${type} = {`);
  const fieldAt = start + bindings.slice(start).search(new RegExp(`^  ${field}\\??: `, 'm'));
  const docStart = bindings.lastIndexOf('/**', fieldAt);
  const doc = bindings.slice(docStart, fieldAt);
  const stripped = doc.replace(/^\s*\* Unit: .*\n/m, '');
  return bindings.slice(0, docStart) + stripped + bindings.slice(fieldAt);
}

const committed = JSON.parse(readFileSync(COMMITTED, 'utf8')) as Schema;

it('names the unit of every numeric field of the measured types', () => {
  const missing: string[] = [];
  for (const name of MEASURED) {
    for (const [field, property] of Object.entries(committed.$defs[name].properties ?? {})) {
      if (isNumeric(property) && property.unit === undefined) missing.push(`${name}.${field}`);
    }
  }
  expect(missing).toEqual([]);
});

it('takes each unit from the engine declaration beside the field', () => {
  const unitOf = (type: string, field: string) => committed.$defs[type].properties?.[field]?.unit;
  expect(unitOf('FfiFeedCard', 'distance')).toBe('metre');
  expect(unitOf('FfiFeedCard', 'movingTime')).toBe('second');
  expect(unitOf('FfiFeedCard', 'avgHr')).toBe('beat_per_minute');
  expect(unitOf('FfiFeedCard', 'averageWeatherTemp')).toBe('degree_celsius');
  expect(unitOf('FfiActivitySummary', 'averageSpeed')).toBe('metre_per_second');
  expect(unitOf('FfiActivitySummary', 'averageCadence')).toEqual({
    $ref: '#/$defs/FfiCadenceUnit',
  });
  expect(unitOf('FfiPeriodStats', 'totalTss')).toBe('tss');
  expect(unitOf('FfiDayLoad', 'date')).toBe('iso_date');
  expect(unitOf('FfiWellnessDay', 'weight')).toBe('kilogram');
});

it('leaves a field unitless when the engine no longer declares its unit', () => {
  const bindings = readFileSync(join(REPO, BINDINGS), 'utf8');
  const declared = generateFrom(bindings);
  expect(declared.$defs.FfiFeedCard.properties?.distance?.unit).toBe('metre');

  const undeclared = generateFrom(withoutUnit(bindings, 'FfiFeedCard', 'distance'));
  expect(undeclared.$defs.FfiFeedCard.properties?.distance?.unit).toBeUndefined();
  expect(undeclared.unitless).toContain('FfiFeedCard.distance');
});

it('lists the numeric fields with no unit as the committed figure', () => {
  expect(committed.unitless).toHaveLength(UNITLESS_FIGURE);
});
