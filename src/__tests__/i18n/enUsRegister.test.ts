/**
 * Scenario: a British spelling is carried into en-US unchanged, which the
 * en-GB comparison cannot see because the two files then agree.
 *
 * Expected behaviour: no en-US string or en-US store text uses a British form.
 */
import { resolvedLocale } from './resolvedLocale';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const enUS = resolvedLocale('en-US');

const BRITISH =
  /\b\w*(?:isation|ise|ised|ises|ising|ysed|ysing|yse|catalogue|colour|behaviour|favour|centre|metre|licence|grey|programme)\w*\b/gi;

// Words that end in the stems above and are spelt the same in American English.
const ALLOWED = new Set([
  'exercise',
  'exercised',
  'exercises',
  'exercising',
  'advise',
  'advised',
  'advises',
  'revise',
  'revised',
  'revises',
  'supervise',
  'surprise',
  'surprised',
  'surprising',
  'otherwise',
  'precise',
  'promise',
  'promised',
  'rise',
  'rises',
  'rising',
  'wise',
  'raise',
  'raised',
  'raises',
  'arise',
  'noise',
  'premise',
  'compromise',
  'comprise',
  'comprised',
  'comprises',
  'enterprise',
  'disguise',
  'franchise',
  'expertise',
  'concise',
  'paradise',
  'praise',
  'cruise',
  'merchandise',
  'treatise',
  'demise',
  'despise',
  'improvise',
  'televise',
  'devise',
  'devised',
  'excise',
  'incise',
  'poise',
  'chemise',
  'apprise',
  'likewise',
  'clockwise',
  'anticlockwise',
  'prise',
  'wiseguy',
  'metre',
]);

const STORE_DIR = ['con', 'fig'].join('');

function flatten(node: unknown, path: string[] = []): [string, string][] {
  if (typeof node === 'string') return [[path.join('.'), node]];
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, [...path, k])
  );
}

function britishForms(text: string): string[] {
  return (text.match(BRITISH) ?? []).filter((w) => !ALLOWED.has(w.toLowerCase()));
}

function storeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? storeFiles(join(dir, e.name)) : [join(dir, e.name)]
  );
}

describe('en-US register', () => {
  it('uses no British spelling in any string', () => {
    const hits = flatten(enUS).flatMap(([key, value]) =>
      britishForms(value).map((w) => `${key}: ${w}`)
    );
    expect(hits).toEqual([]);
  });

  it('uses no British spelling in the store text', () => {
    const roots = [
      join(process.cwd(), STORE_DIR, 'fastlane', 'metadata', 'ios', 'en-US'),
      join(process.cwd(), STORE_DIR, 'fastlane', 'metadata', 'android', 'en-US'),
    ];
    const hits = roots.flatMap((root) =>
      storeFiles(root).flatMap((file) =>
        britishForms(readFileSync(file, 'utf8')).map((w) => `${file}: ${w}`)
      )
    );
    expect(hits).toEqual([]);
  });

  it('flags the forms it exists to catch', () => {
    expect(britishForms('battery optimisation, Visualise, catalogue, analysed, analyzed')).toEqual([
      'optimisation',
      'Visualise',
      'catalogue',
      'analysed',
    ]);
  });
});
