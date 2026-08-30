/**
 * Scenario: en-AU and en-GB carry different voices but the same orthography.
 *
 * Expected behaviour: the noun is `licence`, so `License` only survives inside
 * the proper name of a licence. en-US is the one variant that keeps the `-se`
 * spelling everywhere.
 */
import enAU from '@/i18n/locales/en-AU.json';
import enGB from '@/i18n/locales/en-GB.json';
import enUS from '@/i18n/locales/en-US.json';

const PROPER_NAMES = ['Open Database License', 'Apache License', 'MIT License', 'BSD License'];

function flatten(node: unknown, path: string[] = []): [string, string][] {
  if (typeof node === 'string') return [[path.join('.'), node]];
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, [...path, k])
  );
}

function offendingEntries(bundle: unknown): string[] {
  return flatten(bundle)
    .map(([key, value]) => {
      let stripped = value;
      for (const name of PROPER_NAMES) stripped = stripped.split(name).join('');
      return /Licens|licens/.test(stripped) ? `${key}: ${value}` : null;
    })
    .filter((entry): entry is string => entry !== null);
}

describe('British and Australian English spelling', () => {
  it.each([
    ['en-AU', enAU],
    ['en-GB', enGB],
  ])('%s spells the noun as licence outside proper names', (_locale, bundle) => {
    expect(offendingEntries(bundle)).toEqual([]);
  });

  it('en-US keeps the American spelling', () => {
    expect(offendingEntries(enUS).length).toBeGreaterThan(0);
  });

  it('en-AU states the full open-source licence, as en-GB does', () => {
    expect(enAU.about.openSource).toBe(enGB.about.openSource);
  });
});
